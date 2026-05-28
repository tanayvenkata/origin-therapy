import * as z from "zod/v4";

// Schema for the JUDGMENT half of an item's output only. The audited fields
// (tools_called, task_ids, escalation, draft_reply) and requires_human_review
// are derived/forced by the harness from the real trace, NOT by the model, so
// they are deliberately absent here.
export const JudgmentSchema = z.object({
  classification: z.enum([
    "new_referral",
    "existing_patient_request",
    "scheduling",
    "clinical_question",
    "billing_question",
    "missing_paperwork",
    "provider_followup",
    "complaint",
    "safeguarding",
    "spam",
    "other",
  ]),
  urgency: z.enum(["P0", "P1", "P2", "P3"]),
  extracted_intake: z.object({
    child_name: z.string().nullable(),
    dob_or_age: z.string().nullable(),
    parent_contact: z.string().nullable(),
    discipline: z.array(z.enum(["SLP", "OT", "PT"])).min(1).nullable(),
    diagnosis_or_concern: z.string().nullable(),
    payer: z.string().nullable(),
    member_id: z.string().nullable(),
  }),
  missing_info: z.array(z.string()),
  recommended_next_action: z.string().min(1),
  decision_rationale: z.string().min(1),
});

export type Judgment = z.infer<typeof JudgmentSchema>;
