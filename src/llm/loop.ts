import type Anthropic from "@anthropic-ai/sdk";
import type { InboxItem } from "../types.js";
import { getClient, MODEL } from "./client.js";
import { dispatchTool } from "./dispatch.js";
import { toolDefs } from "./tool-defs.js";

const MAX_ITERATIONS = 10;

// SKELETON-only placeholder prompt. The real safety/judgment prompt comes later;
// for the spike we only need Claude to exercise the tools so we can prove the
// plumbing (tool_use -> tools.ts -> audit trace).
const SKELETON_SYSTEM =
  "You are triaging one item from a pediatric therapy practice's shared inbox. " +
  "Use the available tools to gather any facts you need (insurance, policy, patient lookup, slots) " +
  "and to prepare reviewable actions (tasks, drafts, holds, escalations). " +
  "When you have done what is appropriate for this item, stop.";

function itemText(item: InboxItem): string {
  return [
    `id: ${item.id}`,
    `channel: ${item.channel}`,
    `received_at: ${item.received_at}`,
    `sender: ${item.sender}`,
    `subject: ${item.subject}`,
    `body: ${item.body}`,
    `attachments: ${item.attachments.join(", ") || "(none)"}`,
  ].join("\n");
}

// Runs the tool-use loop for a single item. Must be called inside
// withItemContext(item.id, ...). Returns the model's final text (skeleton only).
export async function runItemSkeleton(item: InboxItem): Promise<string> {
  const anthropic = getClient();
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: itemText(item) },
  ];

  let finalText = "";

  for (let i = 0; i < MAX_ITERATIONS; i += 1) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SKELETON_SYSTEM,
      tools: toolDefs,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      finalText = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      break;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const output = await dispatchTool(
        block.name,
        block.input as Record<string, unknown>,
      );
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: output,
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  return finalText;
}
