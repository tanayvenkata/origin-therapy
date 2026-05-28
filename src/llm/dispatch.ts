import {
  create_task,
  draft_message,
  escalate,
  find_slots,
  hold_slot,
  lookup_policy,
  search_patient,
  verify_insurance,
} from "../tools.js";

// Maps a Claude tool_use block to the real implementation in src/tools.ts.
// Must be called inside withItemContext(item.id, ...) so the tool records the
// audit trace under the correct item. Returns a JSON string for the tool_result
// block fed back to Claude (result_summary + structured data the model can reason on).
export async function dispatchTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  const result = await callTool(name, input);
  return JSON.stringify({
    result_summary: result.result_summary,
    data: result.data,
  });
}

async function callTool(
  name: string,
  input: Record<string, unknown>,
): Promise<{ result_summary: string; data: unknown }> {
  switch (name) {
    case "search_patient":
      return search_patient(input as { name?: string; dob?: string });
    case "verify_insurance":
      return verify_insurance(input as { payer?: string; member_id?: string });
    case "lookup_policy":
      return lookup_policy(input as Parameters<typeof lookup_policy>[0]);
    case "find_slots":
      return find_slots(input as Parameters<typeof find_slots>[0]);
    case "hold_slot":
      return hold_slot(input as Parameters<typeof hold_slot>[0]);
    case "create_task":
      return create_task(input as Parameters<typeof create_task>[0]);
    case "draft_message":
      return draft_message(input as Parameters<typeof draft_message>[0]);
    case "escalate":
      return escalate(input as Parameters<typeof escalate>[0]);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
