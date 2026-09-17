// What the committee has to hand back, in a shape the app can record (DEC-001,
// DEC-002, AI-001, §22.1).
//
// The prompt asks the model for a one-page CIO Action Sheet in prose. Prose
// was then pasted from another window and scraped with a regex for lines
// starting BUY/SELL/TRIM — which lost the evidence, the counterargument, the
// invalidation and the confidence, because a scraped line has none of them.
//
// This is the structured form. The model is asked for it AFTER the review, as
// JSON, over the same conversation; the schema refuses anything that does not
// fit; and the row that reaches `decisions` carries the contract fields the
// old scrape could not. The model's own verbs are kept where they are not on
// the contract — `parseAction` flags them rather than silently renaming a
// governed decision (the decisionEvidence.ts rule).

import { z } from "zod";

import { RECOMMENDATION_ACTIONS } from "./decisionEvidence";

/**
 * Which prompt produced the decision. Stamped on every row the committee
 * writes (DEC-003, CONST-003). The template is the OS v6.0 prompt, stored
 * verbatim in prompts.ts; this is that version, and it changes when the
 * template does.
 */
export const PROMPT_VERSION = "os-v6.0";

const text = (max: number) => z.string().trim().min(1).max(max);

/** One recommendation as the committee states it. */
export const structuredDecisionSchema = z.object({
  /** The contract's verb, or the committee's own if it insists — flagged downstream. */
  action: z.string().trim().toUpperCase().min(1).max(20),
  /** Ticker, or null for a portfolio-level action (margin, rotation, no action). */
  symbol: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9.^=/-]{1,20}$/)
    .nullable(),
  /** The sentence a person reads. Required: a decision with no statement is not one. */
  recommendation: text(600),
  /** 0–1, or null when the committee did not state one. Never defaulted. */
  confidence: z.number().min(0).max(1).nullable(),
  evidence: z.array(text(400)).max(12),
  counterargument: z.string().trim().max(600).nullable(),
  key_risks: z.array(text(300)).max(12),
  invalidation_conditions: z.array(text(300)).max(12),
});
export type StructuredDecision = z.infer<typeof structuredDecisionSchema>;

export const committeeOutputSchema = z.object({
  decisions: z.array(structuredDecisionSchema).max(25),
  /** The CIO's one-line summary. Optional; goes to the journal, not to a row. */
  cio_summary: z.string().trim().max(1200).nullable().optional(),
});
export type CommitteeOutput = z.infer<typeof committeeOutputSchema>;

/**
 * The instruction appended to the conversation to obtain the structured form.
 *
 * It names the contract verbs explicitly and maps the template's own words
 * onto them, so the model does not have to guess — and it says what to do
 * when there is nothing to recommend, because "no action" is a decision
 * (BR-012) and an empty list must be a statement, not a failure.
 */
export const EXTRACTION_INSTRUCTION = [
  "Now restate the committee's FINAL CIO ACTION SHEET as JSON and nothing else — no prose, no code fences.",
  "Schema: {\"decisions\": [{\"action\", \"symbol\", \"recommendation\", \"confidence\", \"evidence\", \"counterargument\", \"key_risks\", \"invalidation_conditions\"}], \"cio_summary\"}.",
  `"action" must be one of: ${RECOMMENDATION_ACTIONS.join(", ")}. Map TRIM to REDUCE, BUY MORE to ADD, WATCH to WAIT.`,
  "\"symbol\" is the ticker, or null for a portfolio-level action such as margin or cash.",
  "\"confidence\" is a number from 0 to 1, or null if you did not state one. Do not invent one.",
  "\"evidence\", \"key_risks\" and \"invalidation_conditions\" are arrays of short strings drawn from the review above. \"counterargument\" is the strongest case against, or null.",
  "If the review recommends no action, return {\"decisions\": [{\"action\": \"HOLD\", \"symbol\": null, \"recommendation\": \"<why no action>\", ...}]} — one HOLD row, never an empty list.",
].join("\n");

export type ParsedCommittee =
  | { ok: true; output: CommitteeOutput }
  | { ok: false; reason: string };

/**
 * The model's reply as the contract, or why not.
 *
 * Tolerates the two things models do despite being told not to — wrap the
 * JSON in a code fence, or preface it with a sentence — by taking the first
 * `{` to the last `}`. Anything else is refused with the schema's reason,
 * never partially accepted: a decision list with one bad entry is not a
 * shorter decision list.
 */
export function parseCommitteeJson(reply: string): ParsedCommittee {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return { ok: false, reason: "The committee's reply contained no JSON object." };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(reply.slice(start, end + 1));
  } catch {
    return { ok: false, reason: "The committee's reply was not valid JSON." };
  }
  const parsed = committeeOutputSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.length ? ` at ${first.path.join(".")}` : "";
    return { ok: false, reason: `The committee's reply did not fit the contract${where}: ${first?.message ?? "unknown"}.` };
  }
  if (parsed.data.decisions.length === 0) {
    // "Nothing to record" is a HOLD row by instruction. An empty list means
    // the model dodged the question, and recording nothing would look like a
    // review that concluded nothing.
    return { ok: false, reason: "The committee returned no decisions. A review that recommends no action should say so as a HOLD." };
  }
  return { ok: true, output: parsed.data };
}
