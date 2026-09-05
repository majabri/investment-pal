// What kind of rule a limit is, and whether anybody chose it.
//
// Rule 21: "Distinguish system safety rules, broker/regulatory constraints,
// user risk policy, strategy rules, and AI recommendations. These are NOT
// interchangeable and the UI must show which is which."
//
// Rule 15: "Defaults must be labelled as defaults and must never masquerade as
// user preferences."
//
// Both were violated the same way and in the same place. `ips_lite` stores a
// 30% position cap and a 25% margin cap — ADR-APP-004's signed-off defaults,
// legitimate as defaults — and nothing downstream could tell a default from a
// choice, or a preference from a hard constraint. The Settings form pre-filled
// them, the dashboard flagged breaches of them, and the committee prompt stated
// them to a model as "my investment policy", whether or not a person had ever
// opened the form.
//
// Why the distinction is not cosmetic: a user policy is the user's to relax. A
// regulatory or broker constraint is not, and an app that presents Reg-T beside
// a self-imposed cap in the same words invites someone to "adjust" the one they
// cannot adjust. A default is neither — it is the app's suggestion, and a user
// who has not seen it has not agreed to it.

/**
 * The five classes rule 21 requires be kept apart. Ordered from least to most
 * negotiable, which is the order the UI presents them in.
 */
export const POLICY_CLASSES = [
  "system_safety",
  "regulatory",
  "user_policy",
  "strategy",
  "ai_recommendation",
] as const;
export type PolicyClass = (typeof POLICY_CLASSES)[number];

/** Where a policy value came from. */
export const POLICY_SOURCES = ["user_set", "default", "legacy_unknown", "not_set"] as const;
export type PolicySource = (typeof POLICY_SOURCES)[number];

export type PolicyMeta = {
  /** What kind of rule this is. */
  policyClass: PolicyClass;
  /** Whether anybody chose it. */
  source: PolicySource;
};

/** How to name each class on screen. Short — it sits in a badge. */
export const POLICY_CLASS_LABEL: Record<PolicyClass, string> = {
  system_safety: "System safety",
  regulatory: "Broker / regulatory",
  user_policy: "Your policy",
  strategy: "Strategy rule",
  ai_recommendation: "AI suggestion",
};

/**
 * One sentence on what the class means for whether the limit may be moved.
 * This is the part that stops "Your policy" and "Broker / regulatory" reading
 * as the same kind of thing.
 */
export const POLICY_CLASS_MEANING: Record<PolicyClass, string> = {
  system_safety: "Enforced by the app. Not adjustable, and not a suggestion.",
  regulatory:
    "Set by the broker or a regulator. The app records it; changing the number here would not change the constraint.",
  user_policy: "Yours to set, and yours to change. The app enforces what you chose.",
  strategy: "Belongs to a strategy. It applies while that strategy does, and not otherwise.",
  ai_recommendation: "A suggestion. It binds nothing and must never be enforced as a limit.",
};

/** How to name each source on screen. */
export const POLICY_SOURCE_LABEL: Record<PolicySource, string> = {
  user_set: "You set this",
  default: "Default — you have not set this",
  legacy_unknown: "Unconfirmed — may be a default nobody chose",
  not_set: "Not set",
};

/**
 * Whether a value can be described as the user's own.
 *
 * `legacy_unknown` is deliberately NOT confirmed: a row written before the
 * provenance column existed may hold the user's choice or may hold the schema
 * default, and the app cannot tell. Treating it as confirmed is exactly the
 * masquerade rule 15 forbids — the same call made for `account_type_source`.
 */
export function policyIsConfirmed(source: PolicySource | null | undefined): boolean {
  return source === "user_set";
}

/**
 * Read a stored `caps_source` value.
 *
 * A NULL column, an empty string, or a value outside the vocabulary all mean
 * the same thing: nobody recorded where this came from. That is
 * `legacy_unknown`, never `user_set` — an unreadable provenance must not
 * promote itself into a confirmation.
 */
export function policySourceOf(stored: string | null | undefined): PolicySource {
  return stored === "user_set" ? "user_set" : "legacy_unknown";
}

/**
 * How to state a policy figure in a prompt, so a model is not told a default is
 * the user's decision.
 *
 * The committee prompt sent "Position cap 30%" as part of the user's stated
 * policy. A model reasoning from that will defend a limit nobody chose as
 * though it were a commitment.
 */
export function describePolicyForPrompt(label: string, value: string, meta: PolicyMeta): string {
  const provenance =
    meta.source === "user_set"
      ? "set by the user"
      : meta.source === "default"
        ? "the app's default, NOT set by the user"
        : meta.source === "not_set"
          ? "NOT SET"
          : "unconfirmed — may be an app default the user never chose";
  return `${label}: ${value} (${POLICY_CLASS_LABEL[meta.policyClass].toLowerCase()}; ${provenance})`;
}
