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
import { localIsoDate } from "@/lib/localDate";

export function SnapshotRecorder({
  gross,
  net,
  marginUsed,
}: {
  /** NULL when the account's cash or margin loan is not known (Phase 1a). A
   *  snapshot is a permanent, append-only record of what the account was worth;
   *  a row derived from an unknown balance is a wrong day in the series that
   *  every later chart, day-change and reconciliation reads as fact. */
  gross: number | null;
  net: number | null;
  marginUsed: number | null;
}) {
  const scope = useAccountScope();
  const { data: snapshots = [], isLoading } = useSnapshots(scope);
  const record = useRecordSnapshot();

  useEffect(() => {
    if (scope.kind !== "account") return;
    // Nothing worth recording yet: a zero gross is the loading state, and a
    // row of zeroes would draw a day the account was worth nothing.
    if (gross === null || net === null || marginUsed === null) return;
    if (!(gross > 0)) return;
    if (isLoading || record.isPending) return;
    const series = balanceSeries(snapshots);
    // The owner's calendar day, not UTC. The previous check compared UTC dates,
    // so an evening session west of Greenwich recorded a second row for what
    // the user would call the same day.
    if (series.at(-1)?.date === localIsoDate()) return;
    record.mutate({ accountId: scope.accountId, gross, net, marginUsed });
    // `record` is deliberately not a dependency: including the mutation object
    // re-runs this whenever its own pending state changes, which turns a
    // once-a-day insert into a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, gross, net, marginUsed, snapshots, isLoading]);

  return null;
}
