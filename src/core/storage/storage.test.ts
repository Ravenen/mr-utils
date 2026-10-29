// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MrRecord } from "./mr-records";
import { pruneMrRecords, readMrRecord, writeMrRecord } from "./mr-records";
import { migrateMrState, readMrState, writeMrState } from "./mr-state";

beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());

describe("mr-state", () => {
  it("folds a record kept under a tab path into the canonical MR path", () => {
    const mrPath = "/g/p/-/merge_requests/1";
    localStorage.setItem(`${mrPath}/diffs/mr-utils`, JSON.stringify({ docs_check: true, head_sha: "old" }));
    writeMrState(mrPath, { head_sha: "new" });

    migrateMrState(`${mrPath}/diffs/`, mrPath);

    expect(readMrState(mrPath)).toEqual({ docs_check: true, head_sha: "new" });
    expect(localStorage.getItem(`${mrPath}/diffs/mr-utils`)).toBeNull();
  });

  it("reads a broken record as empty", () => {
    localStorage.setItem("/g/p/-/merge_requests/1/mr-utils", "{");
    expect(readMrState("/g/p/-/merge_requests/1")).toEqual({});
  });
});

describe("mr-records", () => {
  const ref = { projectPath: "g/p", mrIid: "1" };
  const record = { activityKey: "k" } as MrRecord;

  it("keeps records per user under the published key", () => {
    writeMrRecord(7, ref, record);
    expect(localStorage.getItem("mr-utils/mr/7/g/p/1")).not.toBeNull();
    expect(readMrRecord(7, ref)).toMatchObject(record);
    expect(readMrRecord(8, ref)).toBeNull();
  });

  it("prunes records older than 30 days and broken ones", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01"));
    writeMrRecord(7, ref, record);
    localStorage.setItem("mr-utils/mr/7/g/p/2", "{");
    localStorage.setItem("unrelated", "{");

    vi.setSystemTime(new Date("2026-01-30"));
    pruneMrRecords();
    expect(readMrRecord(7, ref)).not.toBeNull();
    expect(localStorage.getItem("mr-utils/mr/7/g/p/2")).toBeNull();

    vi.setSystemTime(new Date("2026-02-01"));
    pruneMrRecords();
    expect(readMrRecord(7, ref)).toBeNull();
    expect(localStorage.getItem("unrelated")).toBe("{");
  });
});
