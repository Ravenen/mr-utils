import { describe, expect, it } from "vitest";
import { getActivityKey, getCanonicalMrPath, makeBatches, parseUserId } from "./mr";

describe("getCanonicalMrPath", () => {
  it("drops the tab suffix", () => {
    expect(getCanonicalMrPath("/group/project/-/merge_requests/123/diffs")).toBe("/group/project/-/merge_requests/123");
  });
  it("keeps paths that are not an MR", () => {
    expect(getCanonicalMrPath("/group/project/-/merge_requests")).toBe("/group/project/-/merge_requests");
  });
});

describe("parseUserId", () => {
  it("parses GraphQL global ids and numbers", () => {
    expect(parseUserId("gid://gitlab/User/42")).toBe(42);
    expect(parseUserId(42)).toBe(42);
    expect(parseUserId(null)).toBeNull();
  });
});

describe("getActivityKey", () => {
  it("joins the fields that change when comments change", () => {
    expect(
      getActivityKey({ updatedAt: "t", userNotesCount: 3, resolvableDiscussionsCount: 2, resolvedDiscussionsCount: 1 }),
    ).toBe("t|3|2|1");
  });
});

describe("makeBatches", () => {
  const item = (projectPath: string, weight = 0) => ({ projectPath, weight });

  it("groups by project and caps batch size", () => {
    const batches = makeBatches([item("a"), item("b"), item("a"), item("a")], { maxItems: 2 });
    expect(batches.map((b) => [b.projectPath, b.batch.length])).toEqual([
      ["a", 2],
      ["a", 1],
      ["b", 1],
    ]);
  });

  it("caps total weight and gives an oversized item its own batch", () => {
    const batches = makeBatches([item("a", 100), item("a", 60), item("a", 200), item("a", 10)], {
      maxItems: 10,
      maxWeight: 150,
      weightOf: (i) => i.weight,
    });
    expect(batches.map((b) => b.batch.map((i) => i.weight))).toEqual([[100], [60], [200], [10]]);
  });
});
