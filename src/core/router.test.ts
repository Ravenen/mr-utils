import { describe, expect, it } from "vitest";
import { parseRoute } from "./router";

const at = (path: string) => parseRoute(`https://gitlab.com${path}`);

describe("parseRoute", () => {
  it("recognizes MR lists by scope", () => {
    expect(at("/group/sub/project/-/merge_requests")).toMatchObject({ kind: "mr-list", scope: "project" });
    expect(at("/groups/group/sub/-/merge_requests")).toMatchObject({ kind: "mr-list", scope: "group" });
    expect(at("/dashboard/merge_requests?assignee_username=me")).toMatchObject({
      kind: "mr-list",
      scope: "dashboard",
    });
  });

  it("gives a list a new key for every filter, sort or page", () => {
    expect(at("/g/p/-/merge_requests").key).not.toBe(at("/g/p/-/merge_requests?sort=created_date&state=opened").key);
    expect(at("/g/p/-/merge_requests/").key).toBe(at("/g/p/-/merge_requests").key);
  });

  it("recognizes an MR page and its tab", () => {
    expect(at("/group/sub/project/-/merge_requests/42/diffs")).toMatchObject({
      kind: "mr-page",
      projectPath: "group/sub/project",
      iid: "42",
      mrPath: "/group/sub/project/-/merge_requests/42",
      tab: "diffs",
    });
    expect(at("/g/p/-/merge_requests/42")).toMatchObject({ kind: "mr-page", tab: "overview" });
  });

  it("keeps the same key across the tabs of an MR", () => {
    expect(at("/g/p/-/merge_requests/42").key).toBe(at("/g/p/-/merge_requests/42/commits?foo=1#note_1").key);
  });

  it("treats anything else as other", () => {
    expect(at("/g/p/-/merge_requests/new").kind).toBe("other");
    expect(at("/g/p/-/issues").kind).toBe("other");
  });
});
