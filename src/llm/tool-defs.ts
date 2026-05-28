import type Anthropic from "@anthropic-ai/sdk";

// JSON tool definitions exposed to Claude. Arg shapes mirror the provided
// functions in src/tools.ts exactly so Claude's tool_use input flows straight
// through to the real implementations without translation.
export const toolDefs: Anthropic.Tool[] = [
  {
    name: "search_patient",
    description:
      "Look up an existing patient by name and/or date of birth. Use to check whether an inbox item is about an existing patient before treating it as a brand-new referral.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Child's full name, if known." },
        dob: {
          type: "string",
          description: "Date of birth in YYYY-MM-DD format, if known.",
        },
      },
    },
  },
  {
    name: "verify_insurance",
    description:
      "Check coverage status (in_network, out_of_network, expired, unknown) for a payer. Use whenever an item names an insurance payer; the verified status supersedes what the referral document claims.",
    input_schema: {
      type: "object",
      properties: {
        payer: { type: "string", description: "Insurance payer / plan name." },
        member_id: { type: "string", description: "Member ID, if provided." },
      },
    },
  },
  {
    name: "lookup_policy",
    description:
      "Fetch the practice's policy snippets for a topic. Use to ground a decision in Cedar Kids policy before recommending an action.",
    input_schema: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          enum: [
            "service_lines",
            "insurance",
            "safeguarding",
            "clinical_advice",
            "scheduling",
            "cancellation",
            "language_access",
          ],
          description: "Policy topic to look up.",
        },
      },
      required: ["topic"],
    },
  },
  {
    name: "find_slots",
    description:
      "Find available evaluation slots, optionally filtered by discipline and language. Returns reviewable options; it does NOT book anything.",
    input_schema: {
      type: "object",
      properties: {
        discipline: {
          type: "string",
          enum: ["SLP", "OT", "PT"],
          description: "Requested discipline.",
        },
        preferences: {
          type: "string",
          description: "Free-text scheduling preferences (e.g. 'mornings').",
        },
        language: {
          type: "string",
          description: "Preferred provider language code, e.g. 'en' or 'es'.",
        },
      },
    },
  },
  {
    name: "hold_slot",
    description:
      "Place a pending_review hold on a slot for a patient. This is reviewable by staff and does NOT schedule the appointment. Only hold after coverage/eligibility concerns are cleared.",
    input_schema: {
      type: "object",
      properties: {
        slot_id: { type: "string", description: "slot_id from find_slots." },
        patient_ref: {
          type: "string",
          description: "Patient identifier or name to attach the hold to.",
        },
      },
      required: ["slot_id", "patient_ref"],
    },
  },
  {
    name: "create_task",
    description:
      "Create a follow-up task for a staff team. Use to route work that a human must complete (gathering missing info, benefits conversations, reschedules, same-hour safety review).",
    input_schema: {
      type: "object",
      properties: {
        assignee: {
          type: "string",
          enum: ["front_desk", "intake", "billing", "clinical_lead"],
          description: "Team that should own the task.",
        },
        title: { type: "string", description: "Short task title." },
        due: { type: "string", description: "Due date, YYYY-MM-DD." },
        notes: { type: "string", description: "Context for the assignee." },
      },
      required: ["assignee", "title", "due", "notes"],
    },
  },
  {
    name: "draft_message",
    description:
      "Draft a reply for human review. NEVER sends. Drafts must be empathetic and operational, must not provide clinical advice, and must not imply the message was sent.",
    input_schema: {
      type: "object",
      properties: {
        recipient: {
          type: "string",
          description: "Recipient name, email, or phone.",
        },
        channel: {
          type: "string",
          enum: ["portal", "email", "phone"],
          description: "Delivery channel for the draft.",
        },
        body: { type: "string", description: "The drafted message body." },
        language: {
          type: "string",
          enum: ["en", "es"],
          description: "Language of the draft.",
        },
      },
      required: ["recipient", "channel", "body"],
    },
  },
  {
    name: "escalate",
    description:
      "Escalate an item for urgent human attention. Use for P0 safeguarding/harm or P1 same-day operational issues. P0 also requires a same-hour clinical_lead review task.",
    input_schema: {
      type: "object",
      properties: {
        item_id: {
          type: "string",
          description: "The id of the inbox item being escalated.",
        },
        reason: { type: "string", description: "Why this is being escalated." },
        severity: {
          type: "string",
          enum: ["P0", "P1"],
          description: "Escalation severity.",
        },
      },
      required: ["item_id", "reason", "severity"],
    },
  },
];
