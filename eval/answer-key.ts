import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { BatchOutput, Classification, Urgency } from "../src/types.js";

// Judgment eval. The provided validator (npm run validate) checks STRUCTURAL
// correctness (schema + trace match). It does NOT check whether the triage
// JUDGMENT is right. This is that missing half: a hand-labeled answer key for
// the visible batch, focused on the dimensions that carry clinical/operational
// risk (urgency, classification). Run: npm run eval [-- --output output.json]
//
// `classification` accepts a set of acceptable labels per item (some items are
// legitimately ambiguous, e.g. existing-patient vs scheduling). `urgency` is
// exact — it is the highest-signal safety dimension.
interface Expectation {
  urgency: Urgency;
  classification: Classification[];
  note?: string;
}

const ANSWER_KEY: Record<string, Expectation> = {
  item_1: { urgency: "P2", classification: ["new_referral"] },
  item_2: {
    urgency: "P0",
    classification: ["safeguarding"],
    note: "buried safeguarding disclosure must override the routine wrapper",
  },
  item_3: { urgency: "P2", classification: ["new_referral"] },
  item_4: {
    urgency: "P2",
    classification: ["new_referral", "existing_patient_request"],
  },
  item_5: { urgency: "P2", classification: ["clinical_question"] },
  item_6: { urgency: "P2", classification: ["missing_paperwork"] },
  item_7: { urgency: "P2", classification: ["new_referral"] },
  item_8: {
    urgency: "P1",
    classification: ["scheduling", "existing_patient_request"],
    note: "loud tone is not P0; same-day reschedule is P1",
  },
};

function parseOutputPath(argv: string[]): string {
  const i = argv.indexOf("--output");
  return i >= 0 && argv[i + 1] ? argv[i + 1] : "output.json";
}

function main(): void {
  const outputPath = parseOutputPath(process.argv.slice(2));
  const output = JSON.parse(
    readFileSync(resolve(process.cwd(), outputPath), "utf8"),
  ) as BatchOutput;

  let pass = 0;
  let fail = 0;

  for (const [id, expected] of Object.entries(ANSWER_KEY)) {
    const item = output.items.find((it) => it.item_id === id);
    if (!item) {
      console.log(`FAIL ${id}: no output produced`);
      fail += 1;
      continue;
    }

    const urgencyOk = item.urgency === expected.urgency;
    const classOk = expected.classification.includes(item.classification);

    if (urgencyOk && classOk) {
      console.log(`PASS ${id}: ${item.classification} / ${item.urgency}`);
      pass += 1;
    } else {
      const parts: string[] = [];
      if (!urgencyOk) parts.push(`urgency ${item.urgency} != ${expected.urgency}`);
      if (!classOk) {
        parts.push(
          `classification ${item.classification} not in [${expected.classification.join(", ")}]`,
        );
      }
      console.log(
        `FAIL ${id}: ${parts.join("; ")}${expected.note ? `  (${expected.note})` : ""}`,
      );
      fail += 1;
    }
  }

  console.log(`\n${pass}/${pass + fail} judgments match the answer key.`);
  if (fail > 0) process.exitCode = 1;
}

main();
