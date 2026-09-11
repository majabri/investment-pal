// Records one balance snapshot per account per day. Renders nothing.
//
// Extracted from ProgressChart in Stage 5 so there is exactly one writer. There
// were about to be two — the dashboard's chart and the summary page — and two
// writers with slightly different "have we already recorded today?" checks is
// how a series acquires duplicate days that then disagree.
//
// Scoped, like everything else after Stage 1. The old writer stamped every row
// a single hardcoded scope string: one series for the whole household, so the chart kept
// blending TOD with the IRA, the kids' accounts, the 529s and crypto long after
// the live figures stopped.
import { useEffect } from "react";

import { useAccountScope } from "@/contexts/AccountContext";
import { useRecordSnapshot, useSnapshots } from "@/hooks/useAppData";
import { balanceSeries } from "@/lib/portfolioSummary";
import { snapshotDecision } from "@/lib/snapshotGate";
import { localIsoDate } from "@/lib/localDate";

export function SnapshotRecorder({
  gross,
  net,
  marginUsed,
  today = localIsoDate(),
}: {
  /** NULL when the account's cash or margin loan is not known (Phase 1a). A
   *  snapshot is a permanent, append-only record of what the account was worth;
   *  a row derived from an unknown balance is a wrong day in the series that
   *  every later chart, day-change and reconciliation reads as fact. */
  gross: number | null;
  net: number | null;
  marginUsed: number | null;
  /**
   * The owner's calendar day. Injectable for the same reason `localIsoDate`
   * takes a `now`: without a seam, a test can only catch a UTC-vs-local mix-up
   * during the hours the two disagree, so the proof would pass or fail by the
   * time of day it ran. Production never passes it.
   */
  today?: string;
}) {
  const scope = useAccountScope();
  const { data: snapshots = [], isLoading } = useSnapshots(scope);
  const record = useRecordSnapshot();

  useEffect(() => {
    if (scope.kind !== "account") return;
    // The decision lives in `lib/snapshotGate.ts`. It was four conditions here
    // with no test file — and one of them is the dependency array below, which
    // is a guard nothing could see. Moving the refusals somewhere pure is what
    // let them be proven; what stays here is the effect and its dependencies.
    const decision = snapshotDecision({
      gross,
      net,
      marginUsed,
      isAccountScope: true,
      isLoading,
      isPending: record.isPending,
      lastRecordedDate: balanceSeries(snapshots).at(-1)?.date ?? null,
      today,
    });
    if (!decision.record) return;
    record.mutate({ accountId: scope.accountId, ...decision.figures });
    // `record` is deliberately not a dependency: including the mutation object
    // re-runs this whenever its own pending state changes, which turns a
    // once-a-day insert into a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, gross, net, marginUsed, snapshots, isLoading, today]);

  return null;
}
