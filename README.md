# Cedar Kids — Referral Inbox Triage Agent

An AI agent that turns a messy Monday-morning inbox (fax referrals, voicemails, portal messages, emails) into a sorted, **human-reviewable** action plan: one audited triage decision per item. It classifies, extracts intake, calls the practice's tools to inform and *prepare* the work, and flags everything for a human — it never sends, schedules, or gives clinical advice.

## 1. How to run

```bash
npm install
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env     # runtime LLM (see "Stack" for no-key behavior)

npm run triage   -- --input data/inbox.json --output output.json --trace .trace/tool-calls.jsonl
npm run validate -- --input data/inbox.json --output output.json --trace .trace/tool-calls.jsonl
npm run eval                                  # judgment eval vs a labeled answer key
```

All three default to those paths, so `npm run triage && npm run validate && npm run eval` works with no flags. Paths are never hardcoded. End-to-end runtime is ~2–3 minutes for the 8-item batch (sequential; see Architecture).

`npm run validate` checks **structural** correctness (schema + audit-trace match). `npm run eval` (`eval/answer-key.ts`) checks **judgment** correctness — the half a structural validator can't see — by diffing classification/urgency against a hand-labeled key. Current: **8/8**.

**Generalization check (overfitting guard):** because reviewers run hidden variants, I also ran the agent on 3 unseen adversarial items (`data/inbox.variants.json`): a *reworded* buried-safeguarding disclosure, an ALL-CAPS-but-routine billing dispute, and spam.

```bash
npm run triage -- --input data/inbox.variants.json --output output.variants.json --trace .trace/variants.jsonl
```

Results: the reworded safeguarding case → **P0** (rule generalizes, not pattern-matched), the angry billing dispute → **P2, not escalated** (tone ≠ urgency holds), spam → **P3**. The agent reasons from content, not from the visible 8.

## 2. Stack and runtime

- **TypeScript + Node LTS**, npm. No changes to the provided `tools.ts` / `validate.ts` / `index.ts` contracts.
- **Runtime LLM:** Anthropic `@anthropic-ai/sdk`, model `claude-sonnet-4-6`. The system prompt is sent with `cache_control` (ephemeral) so the ~1.5KB domain/policy prompt is cached across all 8 items.
- **Structured output:** the model's *judgment* is produced via `messages.parse` + `zodOutputFormat` (Zod schema in `src/llm/judgment.ts`), so the judgment fields are schema-valid by construction.
- **Graceful degradation:** if `ANTHROPIC_API_KEY` is absent or a call fails, the affected item falls back to a thin-but-valid record (it still surfaces any tool calls already made). `npm run triage` always produces a valid `output.json` and always passes `npm run validate`.

## 3. Architecture

Per item, a two-phase design separates *acting* from *judging*:

```
runAgent(inbox)                                    [src/agent.ts]
  └─ for each item, inside withItemContext(item.id):   [src/llm/triage.ts]
       Phase 1 — TOOL LOOP: Claude reads the item, calls the 8 real tools
                 (search_patient, verify_insurance, lookup_policy, find_slots,
                  hold_slot, create_task, draft_message, escalate) until end_turn.
                 Each call runs through src/tools.ts and writes the audit trace.
       Phase 2 — FINALIZE: a clean messages.parse() call (no tools) derives the
                 structured judgment from the item + a summary of what the tools returned.
       Phase 3 — ASSEMBLE: build the ItemOutput.
  └─ buildBatchOutput(items) → output.json            [src/index.ts, unchanged]
```

**Why this shape:**
- **The system prompt is the safety artifact** (`src/prompt.ts`). It encodes the urgency calibration and the two failure modes the data tests: a safeguarding signal *buried inside* a routine request is still P0 (the routine wrapper doesn't lower urgency), and loud/emotional tone ("URGENT!!!") is *not* a reason to escalate.
- **Audited fields are derived from the real trace, never from the model.** `tools_called` is `getToolCallsForItem(item.id)` passed through unchanged; `task_ids`, `escalation`, and `draft_reply` are read back out of the recorded tool calls. So every action-bearing field in the output is provably backed by an audit-trace entry — the output cannot claim an action that didn't happen.
- **`requires_human_review` is always `true`** and the action model is *reversible preparation only*: draft (never send), find/hold (never schedule), recommend (never decide).
- **Safety invariants are repair-not-reject.** A small `repairInvariants` coerces to the safe state (e.g. `safeguarding ⇒ P0`, escalation severity raises urgency) rather than throwing — a safety agent should never *discard* a decision because it was internally inconsistent; it should make it safe.
- **Sequential** processing: the batch is tiny and well under the runtime budget, and sequential keeps the audit trace trivial to reason about.

### Results on the visible batch

`npm run validate` → **Validation passed.** Summary: `p0=1, p1=1, requires_human_review=8`.

| item | classification | urgency | note |
|---|---|---|---|
| item_1 | new_referral | P2 | BCBS in-network → slots found + held, intake task |
| **item_2** | **safeguarding** | **P0** | buried disclosure caught → escalate P0 + clinical-lead task + neutral draft only |
| item_3 | new_referral | P2 | Kaiser **out-of-network** → **no hold**, billing task (policy-correct) |
| item_4 | new_referral | P2 | Aetna in-network → slots held |
| item_5 | clinical_question | P2 | routed to evaluation; **no clinical advice** in draft |
| item_6 | missing_paperwork | P2 | blank referral → task to gather info, missing_info populated |
| item_7 | new_referral | P2 | Spanish → **draft in Spanish**, bilingual provider matched, Medicaid verified |
| **item_8** | scheduling | **P1** | "URGENT!!!" reschedule → **P1, not P0** (over-escalation avoided) |

## 4. Failure modes and production eval

**Failure modes I worry about:**
- **Under-escalation (the dangerous one):** a safeguarding signal phrased obliquely. Mitigated by an explicit "buried disclosure" rule in the prompt + the `safeguarding ⇒ P0` repair. A missed P0 is the worst outcome, so the system is biased to surface, not suppress.
- **Over-escalation:** tone-driven false P0s. Explicitly addressed in the prompt; item_8 confirms it holds.
- **Extraction errors / hallucinated intake:** the model could invent a DOB or payer. Partly bounded by `missing_info` discipline and human review on every item.
- **Model/API failure mid-batch:** handled by the per-item fallback so one bad item can't break the batch or the audit trace. The fallback fails *safe* — it aligns urgency/classification with any escalation already in the trace, so a pre-failure P0 can't be downgraded to P2. (Known edge: the validator's batch-wide "≥3 distinct tools" floor is a property nothing enforces if the API is fully down for every item; I'd rather fail loudly there than inject performative tool calls the rubric penalizes.)
- **Non-determinism:** runtime LLM means outputs can vary run-to-run; the tool stubs are deterministic, but judgment is not.

**How I'd evaluate this in production (the part that matters for a regulated, high-trust setting):**
- **Labeled eval set** with the dimensions that carry clinical/operational risk: urgency (especially P0 recall — optimize for *not missing* safeguarding), classification accuracy, and a safety rubric for drafts (no clinical advice, no investigative questions, never implies "sent").
- **Asymmetric metrics:** track P0 *recall* separately and treat a missed safeguarding case as a hard failure, while monitoring over-escalation rate as a cost (alert fatigue) rather than a safety event.
- **The audit trace is the compliance backbone.** Because every output field is tied to a recorded tool call, each decision is fully reconstructable — which is exactly what an FDA-style / clinical-governance review needs. I'd persist traces, add an LLM-as-judge for draft tone at scale, and gate releases on the eval set + a red-team set of obfuscated safeguarding phrasings.
- **Online:** monitor human override rate per category as a drift signal; a rising override rate on a category is the cue to revisit the prompt.

## 5. What I chose not to build, and why

- **No concurrency.** ~60s of wall-time savings wasn't worth the AsyncLocalStorage debugging risk under a time box; runtime is already within budget.
- **No full eval *framework*.** I built a lightweight `npm run eval` (answer-key diff on classification + urgency, plus the unseen-variant generalization check) but stopped short of a metrics harness with P0-recall / draft-safety scoring — that fuller version is the production path in §4 and §6.
- **No Zod `.refine()` for cross-field rules.** Zod refinements *reject*; a safety net should *repair*. So Zod owns the output shape and a tiny imperative function owns the safety invariants.
- **Minimal `extracted_intake` normalization.** I pass through the model's extraction rather than canonicalizing DOB formats / phone numbers; fine for triage, would matter for downstream EHR writes.
- **No retries on transient API errors** — would add in production; under time box, the fallback covers it.

## 6. What I would do with another 4 hours

1. **Grow `npm run eval` into a real gate:** expand the labeled set (+ a red-team set of obfuscated safeguarding phrasings) and score P0 recall, classification accuracy, and a draft-safety rubric — turning today's pass/fail answer-key diff into a release gate.
2. **Harden the fallback/assembly into one shared path** so a pre-failure draft or escalation is never dropped from the audit record (currently the fallback re-derives a subset).
3. **Add transient-error retries with backoff** around the API calls, marked `audit_exempt: "retry"` so retries don't pollute the trace.
4. **LLM-as-judge for draft tone** (empathy, no clinical advice, no "sent" implication) to scale the safety check beyond the 8 visible items.
5. **Confidence + abstention:** when extraction confidence is low, explicitly route to a human with the uncertainty surfaced, rather than emitting a best-guess.
