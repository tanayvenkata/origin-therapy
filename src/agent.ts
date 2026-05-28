import { withItemContext } from "./tools.js";
import type { InboxItem, ItemOutput } from "./types.js";
import { triageItem } from "./llm/triage.js";

// Triage every inbox item into one audited, human-reviewable decision.
// Items run sequentially: the batch is small and the runtime is well under the
// "few minutes" budget, so sequential keeps the audit trace simple to reason about.
export async function runAgent(inbox: InboxItem[]): Promise<ItemOutput[]> {
  const outputs: ItemOutput[] = [];
  for (const item of inbox) {
    const output = await withItemContext(item.id, () => triageItem(item));
    outputs.push(output);
  }
  return outputs;
}
