# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Origin AI Engineering take-home: a **referral inbox triage agent** for a fictional pediatric therapy practice (Cedar Kids Therapy). It reads a batch of messy inbox items (`InboxItem[]` — fax referrals, voicemail transcripts, portal messages, emails) and produces one structured, human-reviewable triage decision per item. See `README.md` for the full brief, rubric, and urgency calibration (P0–P3).

The core implementation work lives in `src/agent.ts` (`runAgent`), which is currently a stub that throws.

## Commands

```bash
npm install
npm run triage    # runs the agent; writes output.json + .trace/tool-calls.jsonl
npm run validate  # validates output.json against schema + trace + business rules
npm run typecheck # tsc --noEmit
npm run package    # tarball of the submission files
```

`triage` and `validate` default to `data/inbox.json`, `output.json`, `.trace/tool-calls.jsonl`. Override with `-- --input X --output Y --trace Z`. **Never hardcode these paths** — reviewers run the same commands against hidden synthetic inputs.

The full self-check loop is `npm run triage && npm run validate`. There is no test runner; the validator *is* the test.

## Architecture

The data flow is a fixed pipeline with one editable middle stage:

`src/index.ts` (CLI) → `runAgent(inbox)` in **`src/agent.ts`** → `buildBatchOutput(items)` → `output.json`

- **`src/index.ts`** — entry point. Parses flags, calls `configureTrace()`, reads the inbox, invokes `runAgent`, wraps results with `buildBatchOutput`, writes the file. Do not change its contract.
- **`src/agent.ts`** — the only file you implement. Returns `ItemOutput[]`, one per inbox item.
- **`src/tools.ts`** — the 8 provided tools (`search_patient`, `verify_insurance`, `lookup_policy`, `find_slots`, `hold_slot`, `create_task`, `draft_message`, `escalate`) plus trace plumbing. **Do not modify, reimplement, or bypass these** — they write the audit trace the validator checks. Tool stubs are deterministic (hardcoded name/DOB/payer matches), which is what makes the output reproducible.
- **`src/llm/`** — candidate-authored LLM scaffolding (not part of the original starter). `client.ts` (Anthropic SDK, `MODEL = claude-sonnet-4-6`), `tool-defs.ts` (Claude tool schemas mirroring `src/tools.ts` arg shapes 1:1), `dispatch.ts` (maps a Claude `tool_use` block to the real tool fn). Runtime LLM usage is optional; the agent could also be rules-based.
- **`src/types.ts`** — all shared types. `ItemOutput` is the per-item contract; `schema/output.schema.json` is the authoritative output shape.
- **`src/validate.ts`** — standalone validator (AJV + business rules). Read this to understand exactly what "correct" means.

### Audit-trace contract (the part that's easy to get wrong)

Tool calls are tracked via `AsyncLocalStorage` keyed by item id. The validator cross-checks `output.json` against `.trace/tool-calls.jsonl` field-by-field, so the agent **must**:

1. Wrap every item's tool calls in `await withItemContext(item.id, async () => { ... })`. A tool called outside this context throws `ToolCallOutsideItemContext`.
2. Build each item's `tools_called[]` from `getToolCallsForItem(item.id)` and pass those entries through **unchanged** (do not re-summarize, re-order args, or reconstruct them). The validator compares `name`, `args`, and `result_summary` exactly.
3. Surface every non-`audit_exempt` trace call exactly once across the whole output — not zero times, not duplicated.
4. Use the real `call_id`s from the returned tool results; never copy the `example_*` ids from `data/example_output.json`.

### Validator rules beyond JSON-schema

- **Every** item must have `requires_human_review: true` (this is a hard rule, not per-item judgment).
- At least **3 distinct tool names** must appear across the batch; irrelevant/performative calls are penalized in review.
- Exactly one output item per input id (no missing, duplicate, or unknown ids).
- `summary` counts must come from `buildBatchOutput` — do not hand-compute them.
- Forbidden tools `schedule_appointment` and `send_message` must never appear (in output or trace). Use `draft_message`/`find_slots`/`hold_slot` instead — the agent drafts and recommends but never sends or books.

## Conventions

- ESM throughout (`"type": "module"`). Relative imports use **`.js` extensions even for `.ts` source** (e.g. `import { runAgent } from "./agent.js"`) — required by the NodeNext/`tsx` setup. Match this.
- `ANTHROPIC_API_KEY` is read from `.env` (gitignored). `.env.example` documents it.
- Synthetic data only; never add real PHI. Do not commit `.env`, `node_modules/`, or `.trace/`.
- If you edit `data/policies.md`, mirror the change in the hardcoded `policySnippets` map in `src/tools.ts` (they are kept in sync deliberately).
