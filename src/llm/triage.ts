import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { SYSTEM_PROMPT, renderItem } from "../prompt.js";
import { getToolCallsForItem } from "../tools.js";
import type { InboxItem, ItemOutput, ToolCall } from "../types.js";
import { getClient, MODEL } from "./client.js";
import { dispatchTool } from "./dispatch.js";
import { type Judgment, JudgmentSchema } from "./judgment.js";
import { toolDefs } from "./tool-defs.js";

const MAX_ITERATIONS = 12;

// Cached system block: identical across all 8 items, so prompt caching makes
// every item after the first cheap on the capped key.
const systemBlocks: Anthropic.TextBlockParam[] = [
  { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
];

// Triage one item. MUST run inside withItemContext(item.id, ...) so tool calls
// record under this item. Always returns a valid ItemOutput; on any failure it
// falls back to a thin-but-valid record that still surfaces the audit trail.
export async function triageItem(item: InboxItem): Promise<ItemOutput> {
  try {
    await runToolLoop(item);
    const judgment = await finalize(item);
    return assemble(item, judgment);
  } catch (error) {
    console.error(`[triage] ${item.id} failed:`, errMsg(error));
    return fallback(item, errMsg(error));
  }
}

// Phase 1: let Claude gather facts and prepare reversible actions via tools.
async function runToolLoop(item: InboxItem): Promise<void> {
  const anthropic = getClient();
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: renderItem(item) },
  ];

  for (let i = 0; i < MAX_ITERATIONS; i += 1) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: systemBlocks,
      tools: toolDefs,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });
    if (response.stop_reason !== "tool_use") return;

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: await dispatchTool(
          block.name,
          block.input as Record<string, unknown>,
        ),
      });
    }
    messages.push({ role: "user", content: toolResults });
  }
}

// Phase 2: derive structured judgment from the item + what the tools returned.
// Clean parse() call with no tools, so the model can only emit the judgment.
async function finalize(item: InboxItem): Promise<Judgment> {
  const anthropic = getClient();
  const calls = getToolCallsForItem(item.id);
  const activity = calls.length
    ? calls
        .map((c) => `- ${c.name}(${JSON.stringify(c.args)}) -> ${c.result_summary}`)
        .join("\n")
    : "(no tools were called)";

  const prompt = [
    renderItem(item),
    "",
    "Tool activity you performed for this item:",
    activity,
    "",
    "Now produce your final structured triage decision for this item, consistent with the actions above and the safety rules.",
  ].join("\n");

  const message = await anthropic.messages.parse({
    model: MODEL,
    max_tokens: 1500,
    system: systemBlocks,
    messages: [{ role: "user", content: prompt }],
    output_config: { format: zodOutputFormat(JudgmentSchema) },
  });

  if (!message.parsed_output) {
    throw new Error("finalize returned no parsed_output");
  }
  return message.parsed_output;
}

// Phase 3: assemble the full ItemOutput. Audited fields come from the trace,
// never from the model. requires_human_review is always true.
function assemble(item: InboxItem, judgment: Judgment): ItemOutput {
  const tools_called = getToolCallsForItem(item.id);
  const escalation = deriveEscalation(tools_called);
  const repaired = repairInvariants(judgment, escalation);

  return {
    item_id: item.id,
    classification: repaired.classification,
    urgency: repaired.urgency,
    requires_human_review: true,
    extracted_intake: repaired.extracted_intake,
    missing_info: repaired.missing_info,
    tools_called,
    recommended_next_action: repaired.recommended_next_action,
    draft_reply: deriveDraftReply(tools_called),
    task_ids: deriveTaskIds(tools_called),
    escalation,
    decision_rationale: repaired.decision_rationale,
  };
}

// Coerce-to-safe (never reject): keep urgency consistent with the actions taken
// and never let a safeguarding classification sit below P0.
function repairInvariants(
  judgment: Judgment,
  escalation: ItemOutput["escalation"],
): Judgment {
  let urgency = judgment.urgency;
  if (judgment.classification === "safeguarding") urgency = "P0";
  if (escalation?.severity === "P0") urgency = "P0";
  else if (escalation?.severity === "P1" && (urgency === "P2" || urgency === "P3")) {
    urgency = "P1";
  }
  return { ...judgment, urgency };
}

function deriveTaskIds(calls: ToolCall[]): string[] {
  return calls.flatMap((c) => {
    if (c.name !== "create_task") return [];
    const match = /created task (\S+) for/.exec(c.result_summary);
    return match ? [match[1]] : [];
  });
}

function deriveEscalation(calls: ToolCall[]): ItemOutput["escalation"] {
  const escalations = calls.filter((c) => c.name === "escalate");
  const last = escalations[escalations.length - 1];
  if (!last) return null;
  const severity = last.args.severity;
  const reason = last.args.reason;
  if ((severity === "P0" || severity === "P1") && typeof reason === "string") {
    return { reason, severity };
  }
  return null;
}

function deriveDraftReply(calls: ToolCall[]): string | null {
  const drafts = calls.filter((c) => c.name === "draft_message");
  const last = drafts[drafts.length - 1];
  const body = last?.args.body;
  return typeof body === "string" ? body : null;
}

function fallback(item: InboxItem, reason: string): ItemOutput {
  return {
    item_id: item.id,
    classification: "other",
    urgency: "P2",
    requires_human_review: true,
    extracted_intake: {
      child_name: null,
      dob_or_age: null,
      parent_contact: null,
      discipline: null,
      diagnosis_or_concern: null,
      payer: null,
      member_id: null,
    },
    missing_info: ["Automated triage failed for this item; manual review required."],
    tools_called: getToolCallsForItem(item.id),
    recommended_next_action:
      "Manually triage this item; the automated agent could not complete it.",
    draft_reply: null,
    task_ids: deriveTaskIds(getToolCallsForItem(item.id)),
    escalation: deriveEscalation(getToolCallsForItem(item.id)),
    decision_rationale: `Fallback output: automated triage error (${reason}).`,
  };
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
