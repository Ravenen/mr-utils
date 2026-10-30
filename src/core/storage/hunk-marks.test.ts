import { beforeEach, describe, expect, it } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { hunkMarksKey, loadHunkMarks, pruneHunkMarks, saveHunkMarks, watchHunkMarks } from "./hunk-marks";

const KEY = hunkMarksKey("g/p", "1");
const DAY = 24 * 60 * 60 * 1000;

describe("hunk marks", () => {
  beforeEach(() => fakeBrowser.reset());

  it("are saved per MR, and an empty set removes the record", async () => {
    expect(await loadHunkMarks(KEY)).toEqual({});
    await saveHunkMarks(KEY, { a: 1, b: 2 });
    expect(await loadHunkMarks(KEY)).toEqual({ a: 1, b: 2 });
    expect(await loadHunkMarks(hunkMarksKey("g/p", "2"))).toEqual({});
    await saveHunkMarks(KEY, {});
    expect(await browser.storage.local.get(null)).toEqual({});
  });

  it("are pruned when untouched for 60 days, leaving other data alone", async () => {
    const now = Date.now();
    await browser.storage.local.set({
      [KEY]: { updatedAt: now - 61 * DAY, marks: { a: 1 } },
      [hunkMarksKey("g/p", "2")]: { updatedAt: now - 59 * DAY, marks: { b: 1 } },
      [hunkMarksKey("g/p", "3")]: "broken",
      other: { updatedAt: 0 },
    });
    await pruneHunkMarks(now);
    expect(Object.keys(await browser.storage.local.get(null)).sort()).toEqual(["hunk-marks/g/p/2", "other"]);
  });

  it("are watched for changes from other tabs", async () => {
    const seen: unknown[] = [];
    const controller = new AbortController();
    watchHunkMarks(KEY, (marks) => seen.push(marks), controller.signal);
    await saveHunkMarks(KEY, { a: 1 });
    await saveHunkMarks(hunkMarksKey("g/p", "2"), { b: 1 });
    controller.abort();
    await saveHunkMarks(KEY, { c: 1 });
    expect(seen).toEqual([{ a: 1 }]);
  });
});
