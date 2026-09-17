// The record of one import (§20.2, IMP-004).
import { describe, expect, test } from "bun:test";

import {
  batchDiff,
  committedPatch,
  failedPatch,
  importSyncLine,
  sameFileNote,
  sha256Hex,
  stagedBatch,
  utf8ByteLength,
} from "@/lib/importBatch";

describe("sha256Hex", () => {
  test("NEGATIVE CONTROL: a published test vector", async () => {
    // FIPS 180-4, "abc".
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  test("lower-case hex, 64 characters — the shape the CHECK admits", async () => {
    expect(await sha256Hex("Account Number,Symbol\n")).toMatch(/^[0-9a-f]{64}$/);
  });
  test("a one-byte change is a different file", async () => {
    expect(await sha256Hex("a,b,c")).not.toBe(await sha256Hex("a,b,d"));
  });
});

describe("utf8ByteLength", () => {
  test("bytes, not characters", () => {
    expect(utf8ByteLength("abc")).toBe(3);
    expect(utf8ByteLength("€")).toBe(3);
    expect(utf8ByteLength("")).toBe(0);
  });
});

describe("stagedBatch", () => {
  test("the row before the commit: staged, with the file's facts", () => {
    const row = stagedBatch({
      userId: "u",
      accountId: "a",
      fileName: "positions.csv",
      fileSizeBytes: 1234,
      checksum: "a".repeat(64),
      parsedRows: 14,
      validRows: 12,
    });
    expect(row.outcome).toBe("staged");
    expect(row.source).toBe("imported");
    expect(row.file_name).toBe("positions.csv");
    expect(row.checksum_sha256).toHaveLength(64);
    expect(row.parsed_rows).toBe(14);
    expect(row.valid_rows).toBe(12);
    expect(row).not.toHaveProperty("finished_at");
  });
  test("a pasted import has no file name and several destinations have no single account", () => {
    const row = stagedBatch({ userId: "u", accountId: null, fileName: null, fileSizeBytes: 9, checksum: "b".repeat(64), parsedRows: 1, validRows: 1 });
    expect(row.file_name).toBeNull();
    expect(row.account_id).toBeNull();
  });
});

describe("batchDiff and the closing patches", () => {
  const diff = batchDiff(
    [{ accountId: "a", accountName: "Test", inserted: 2, updated: 10, removed: 1, cash: null }],
    3,
  );
  test("the diff carries the RPC's counts and the cash null, per account", () => {
    expect(diff.accounts[0]).toEqual({ account_id: "a", account_name: "Test", inserted: 2, updated: 10, removed: 1, cash: null });
    expect(diff.skipped_lines).toBe(3);
  });
  test("committed closes with the diff and a finish time", () => {
    const p = committedPatch(diff, "a", new Date("2026-09-17T12:00:00Z"));
    expect(p.outcome).toBe("committed");
    expect(p.account_id).toBe("a");
    expect(committedPatch(diff, null).account_id).toBeNull();
    expect(p.finished_at).toBe("2026-09-17T12:00:00.000Z");
    expect(p.diff).toEqual(diff);
    expect(p).not.toHaveProperty("error");
  });
  test("failed closes with the whole error message", () => {
    const p = failedPatch(new Error("Account x does not belong to the signed-in user"));
    expect(p.outcome).toBe("failed");
    expect(p.error).toBe("Account x does not belong to the signed-in user");
    expect(failedPatch("plain string").error).toBe("plain string");
  });
});

describe("sameFileNote", () => {
  test("NEGATIVE CONTROL: never imported, nothing to say", () => {
    expect(sameFileNote([])).toBeNull();
  });
  test("a staged or failed prior attempt is not a prior import", () => {
    expect(sameFileNote([{ started_at: "2026-09-10T10:00:00Z", outcome: "failed" }])).toBeNull();
    expect(sameFileNote([{ started_at: "2026-09-10T10:00:00Z", outcome: "staged" }])).toBeNull();
  });
  test("a committed prior import is named by its latest date", () => {
    const s = sameFileNote([
      { started_at: "2026-09-10T10:00:00Z", outcome: "committed" },
      { started_at: "2026-09-12T10:00:00Z", outcome: "committed" },
    ])!;
    expect(s).toContain("2026-09-12");
    expect(s).toContain("2 times");
    expect(s).toContain("changes nothing");
  });
});

describe("importSyncLine", () => {
  test("ties the sync-log line to its batch", () => {
    const l = importSyncLine({ userId: "u", batchId: "b", accounts: 2, saved: 12, removed: 1 });
    expect(l.batch_id).toBe("b");
    expect(l.source).toBe("portfolio_csv");
    expect(l.detail).toBe("12 positions across 2 accounts; 1 removed");
  });
});
