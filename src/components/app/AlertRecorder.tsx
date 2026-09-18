// Sends the dashboard's live alert set to the record. Renders nothing.
//
// One writer, like `SnapshotRecorder`. The decision to write is
// `lib/alertRecord.ts`'s `recordDecision`, pure and tested; what stays here
// is the effect and its dependencies. The guard that matters most: nothing is
// sent until the evaluation is complete, because a half-loaded set would
// resolve real alerts and their re-raise a moment later would clear the
// holder's acknowledgements.
import { useEffect, useRef } from "react";

import { evaluationKey, raisePayload, recordDecision } from "@/lib/alertRecord";
import type { Alert } from "@/lib/alerts";
import { useRaiseAlerts } from "@/hooks/useAlertRecord";

export function AlertRecorder({
  alerts,
  accountId,
  evaluationComplete,
  failed = false,
}: {
  alerts: readonly Alert[];
  accountId: string | null;
  evaluationComplete: boolean;
  failed?: boolean;
}) {
  const raise = useRaiseAlerts();
  // Per account: switching accounts must send that account's set once.
  const lastSent = useRef<{ accountId: string; key: string } | null>(null);

  const { items } = raisePayload(alerts);
  const key = evaluationKey(items);

  useEffect(() => {
    const decision = recordDecision({
      accountId,
      evaluationComplete,
      failed,
      lastSentKey: lastSent.current?.accountId === accountId ? lastSent.current.key : null,
      key,
      isPending: raise.isPending,
    });
    if (!decision.write || accountId === null) return;
    lastSent.current = { accountId, key }; // optimistic; a failure clears it below
    raise.mutate(
      { accountId, items },
      { onError: () => { lastSent.current = null; } },
    );
    // `items` is derived from `key`; `raise` is stable per React Query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, evaluationComplete, failed, key, raise.isPending]);

  return null;
}
