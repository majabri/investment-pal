// The record of one import (§20.2, IMP-004).
//
// An import used to leave holdings and, on some screens, a `sync_log` line.
// The file it came from, its checksum, how many rows it carried and what the
// commit did were gone once the toast closed — so "reimport of the same
// state is idempotent" (IMP-004) could not be checked against anything, and
// "which import put this position here" had no answer.
//
// `import_batches` (migration 20260917150000) holds that record. This module
// builds the rows and the sentences; the component does the I/O. Pure apart
// from `sha256Hex`, which is Web Crypto and runs in the browser and in bun.

import type { Insert, Update } from "@/lib/dbRows";

/** The one source this screen is. No AI value, as with every source column. */
export const CSV_IMPORT_SOURCE = "imported" as const;

/** SHA-256 of the text as received, lower-case hex — what the CHECK expects. */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The size the CHECK records: bytes of the text, not characters. */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** What one account's commit did, as the RPC reported it. */
export type AccountOutcome = {
  accountId: string;
  accountName: string;
  inserted: number;
  updated: number;
  removed: number;
  /** NULL = the file carried no cash line; the column was left alone. */
  cash: number | null;
};

/**
 * The `diff` column: per account, what the commit did. Counts from the RPC's
 * own return value, never recomputed here — the database did the work and
 * its figures are the record.
 */
export function batchDiff(accounts: readonly AccountOutcome[], skippedLines: number) {
  return {
    accounts: accounts.map((a) => ({
      account_id: a.accountId,
      account_name: a.accountName,
      inserted: a.inserted,
      updated: a.updated,
      removed: a.removed,
      cash: a.cash,
    })),
    skipped_lines: skippedLines,
  };
}

/**
 * The row written BEFORE the commit runs: outcome `staged`. If the commit
 * never finishes — tab closed, network gone — the batch stays `staged`, which
 * is a true statement about what happened.
 */
export function stagedBatch(input: {
  userId: string;
  /** The one destination when there is one; NULL when the file maps to several. */
  accountId: string | null;
  fileName: string | null;
  fileSizeBytes: number;
  checksum: string;
  parsedRows: number;
  validRows: number;
}): Insert<"import_batches"> {
  return {
    user_id: input.userId,
    account_id: input.accountId,
    source: CSV_IMPORT_SOURCE,
    file_name: input.fileName,
    file_size_bytes: input.fileSizeBytes,
    checksum_sha256: input.checksum,
    parsed_rows: input.parsedRows,
    valid_rows: input.validRows,
    outcome: "staged",
  };
}

/**
 * The patch that closes a batch that committed. `accountId` is the one
 * destination when there was one — it can be known only after the commit,
 * because an account named in the file may have been created by it.
 */
export function committedPatch(
  diff: ReturnType<typeof batchDiff>,
  accountId: string | null,
  finishedAt: Date = new Date(),
): Update<"import_batches"> {
  return { outcome: "committed", account_id: accountId, diff, finished_at: finishedAt.toISOString() };
}

/**
 * The patch that closes a batch that did not. `error` is the message as
 * thrown, whole: a truncated error is a clue with the end cut off.
 */
export function failedPatch(error: unknown, finishedAt: Date = new Date()): Update<"import_batches"> {
  const message = error instanceof Error ? error.message : String(error);
  return { outcome: "failed", error: message, finished_at: finishedAt.toISOString() };
}

/**
 * The sentence shown when this exact file has been committed before
 * (IMP-004). Null when it has not. Informational, not a refusal: importing
 * the same statement twice is safe by design, and the holder may be doing it
 * on purpose after a failed first attempt.
 */
export function sameFileNote(prior: readonly { started_at: string; outcome: string }[]): string | null {
  const committed = prior.filter((p) => p.outcome === "committed");
  if (committed.length === 0) return null;
  const latest = committed.map((p) => p.started_at).sort().at(-1)!;
  return `This exact file was already imported on ${latest.slice(0, 10)}${committed.length > 1 ? ` (${committed.length} times)` : ""}. Importing it again changes nothing the first import did not.`;
}

/** The sync-log line an import writes, tied to its batch. */
export function importSyncLine(input: {
  userId: string;
  batchId: string;
  accounts: number;
  saved: number;
  removed: number;
}): Insert<"sync_log"> {
  return {
    user_id: input.userId,
    source: "portfolio_csv",
    status: "success",
    batch_id: input.batchId,
    detail: `${input.saved} position${input.saved === 1 ? "" : "s"} across ${input.accounts} account${input.accounts === 1 ? "" : "s"}; ${input.removed} removed`,
  };
}
