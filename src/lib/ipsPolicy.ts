// The IPS-lite policy record and its signed-off defaults.
//
// These are governance values (ADR-APP-004 for the caps, ADR-APP-007 for the
// rate), not data-layer code, and they live here rather than in useAppData so
// that anything needing them — components, tests, prompt builders — can read
// them without pulling in the Supabase client. `useAppData` re-exports both, so
// existing imports are unaffected.
import { MARGIN_POLICY_UNSET, type MarginPolicy } from "@/lib/marginCost";

export type IpsLite = {
  position_cap_pct: number;
  position_cap_hard: boolean;
  margin_cap_pct: number;
} & MarginPolicy;

// Signed-off defaults (ADR-APP-004): 30% soft position cap, 25% margin cap.
export const IPS_LITE_DEFAULTS: IpsLite = {
  position_cap_pct: 30,
  position_cap_hard: false,
  margin_cap_pct: 25,
  // The caps have signed-off defaults (ADR-APP-004). The margin RATE does not
  // and must not (ADR-APP-007): unset means unset, and the UI suppresses the
  // cost figure rather than computing with a fallback.
  ...MARGIN_POLICY_UNSET,
};
