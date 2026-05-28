import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  configureTrace,
  getToolCallsForItem,
  withItemContext,
} from "../tools.js";
import type { InboxItem } from "../types.js";
import { runItemSkeleton } from "./loop.js";

// Throwaway spike: prove the plumbing on one item.
// Usage: npx tsx src/llm/smoke.ts [item_index]
async function main(): Promise<void> {
  const inbox = JSON.parse(
    readFileSync(resolve(process.cwd(), "data/inbox.json"), "utf8"),
  ) as InboxItem[];

  const index = Number(process.argv[2] ?? "0");
  const item = inbox[index];
  if (!item) throw new Error(`No item at index ${index}`);

  configureTrace({ path: ".trace/smoke.jsonl" });

  console.log(`\n=== Running ${item.id} (${item.channel}) ===\n`);
  const finalText = await withItemContext(item.id, () =>
    runItemSkeleton(item),
  );

  console.log("--- model final text ---");
  console.log(finalText || "(none)");

  console.log("\n--- tool calls recorded for this item ---");
  for (const call of getToolCallsForItem(item.id)) {
    console.log(`${call.name}  ->  ${call.result_summary}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
