// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import type { GitLabApi } from "./api";
import {
  computeActivity,
  EMPTY_ACTIVITY,
  getMergeRequestData,
  loadMergeRequestsData,
  processMRData,
  type LoadContext,
  type MrData,
} from "./merge-requests";
import type { MrNode, Note } from "./queries";

const ME = 7;
const user = (id: number) => ({ id: `gid://gitlab/User/${id}` });
const thread = (id: string, resolved = false) => ({ id, resolvable: true, resolved });
const comment = (id: string) => ({ id, resolvable: false, resolved: false });

describe("computeActivity", () => {
  it("counts my threads, replies to them and other people's comments", () => {
    const notes: Note[] = [
      { author: user(ME), discussion: thread("a") }, // my open thread
      { author: user(9), discussion: thread("a") }, // a reply to it
      { author: user(ME), discussion: thread("b", true) }, // my resolved thread
      { author: user(9), discussion: thread("c") }, // someone else's thread
      { author: user(ME), discussion: thread("c") }, // my reply there: not counted
      { author: user(9), discussion: comment("d") }, // a plain comment
      { author: user(ME), discussion: comment("e") }, // my plain comment: not counted
    ];
    expect(computeActivity(notes, ME)).toEqual({
      totalUserThreads: 2,
      unresolvedUserThreads: 1,
      repliesInUserThreads: 1,
      otherComments: 2,
    });
  });
});

const node = (iid: number, extra: Partial<MrNode> = {}): MrNode => ({
  iid: String(iid),
  webUrl: `https://gitlab.com/g/p/-/merge_requests/${iid}`,
  draft: false,
  updatedAt: "2026-10-01T00:00:00Z",
  detailedMergeStatus: "MERGEABLE",
  shouldBeRebased: false,
  conflicts: false,
  diffHeadSha: `sha${iid}`,
  userNotesCount: 2,
  resolvableDiscussionsCount: 2,
  resolvedDiscussionsCount: 1,
  approvedBy: { nodes: [] },
  ...extra,
});

describe("processMRData", () => {
  const ctx = { userId: ME, settings: { approvalsNeeded: 2 } } as LoadContext;

  it("is ready when mergeable with enough approvals", () => {
    const data = processMRData(ctx, node(1, { approvedBy: { nodes: [user(ME), user(8)] } }), null);
    expect(data).toMatchObject({
      approvalsGiven: 2,
      approvalsRequired: 2,
      hasUserApproved: true,
      isReady: true,
      totalThreads: 2,
      unresolvedThreads: 1,
      mrPath: "/g/p/-/merge_requests/1",
      headSha: "sha1",
      ...EMPTY_ACTIVITY,
    });
  });

  it("flags conflicts and rebase from either field", () => {
    expect(processMRData(ctx, node(1, { detailedMergeStatus: "CONFLICT" }), null).hasConflicts).toBe(true);
    expect(processMRData(ctx, node(1, { conflicts: true }), null).hasConflicts).toBe(true);
    expect(processMRData(ctx, node(1, { detailedMergeStatus: "NEED_REBASE" }), null).needsRebase).toBe(true);
    expect(processMRData(ctx, node(1, { shouldBeRebased: true }), null).isReady).toBe(false);
  });
});

// A GitLab that answers from `nodes` and `notes` and records every request
function fakeGitLab(nodes: Map<string, MrNode>, notes: Map<string, Note[]>, { pageSize = 100, failProject = "" } = {}) {
  const requests: { name: string; projectPath: string; iids: string[] }[] = [];
  const page = (iid: string, after: string | null) => {
    const all = notes.get(iid) ?? [];
    const start = after ? Number(after) : 0;
    const end = start + pageSize;
    return { pageInfo: { hasNextPage: end < all.length, endCursor: String(end) }, nodes: all.slice(start, end) };
  };
  const api: GitLabApi = {
    fetch: () => Promise.reject(new Error("REST is not expected")),
    async graphql<T>(query: string, variables: Record<string, unknown>, signal: AbortSignal): Promise<T> {
      signal.throwIfAborted();
      const name = query.match(/query (\w+)/)?.[1] ?? "";
      const projectPath = String(variables.projectPath);
      const iids = (variables.iids as string[] | undefined) ?? [String(variables.iid)];
      requests.push({ name, projectPath, iids });
      await Promise.resolve();
      if (projectPath === failProject) throw new Error("boom");
      const key = (iid: string) => `${projectPath}#${iid}`;
      if (name === "MRFlowMergeRequestNotesPage")
        return { project: { mergeRequest: { notes: page(key(iids[0] ?? ""), variables.after as string) } } } as T;
      const found = iids.filter((iid) => nodes.has(key(iid)));
      if (name === "MRFlowMergeRequestsNotes")
        return {
          project: { mergeRequests: { nodes: found.map((iid) => ({ iid, notes: page(key(iid), null) })) } },
        } as T;
      return { project: { mergeRequests: { nodes: found.map((iid) => nodes.get(key(iid))) } } } as T;
    },
  };
  const count = (name: string) => requests.filter((r) => r.name === name).length;
  return { api, requests, count };
}

const STAGE2 = "MRFlowMergeRequests";
const NOTES = "MRFlowMergeRequestsNotes";

function project(projectPath: string, count: number, extra: (iid: number) => Partial<MrNode> = () => ({})) {
  const nodes = new Map<string, MrNode>();
  const notes = new Map<string, Note[]>();
  const items = [];
  for (let iid = 1; iid <= count; iid++) {
    nodes.set(`${projectPath}#${iid}`, node(iid, extra(iid)));
    notes.set(`${projectPath}#${iid}`, [
      { author: user(ME), discussion: thread(`t${iid}`) },
      { author: user(9), discussion: thread(`t${iid}`) },
    ]);
    items.push({ projectPath, mrIid: String(iid) });
  }
  return { nodes, notes, items };
}

async function load(api: GitLabApi, items: { projectPath: string; mrIid: string }[], options = {}) {
  const updates: [string, MrData][][] = [];
  const errors: unknown[] = [];
  const signal = new AbortController().signal;
  await loadMergeRequestsData({ api, signal, userId: ME, settings: { approvalsNeeded: 2 } }, items, {
    onUpdate: (batch) => updates.push(batch.map(([item, data]) => [`${item.projectPath}#${item.mrIid}`, data])),
    onError: (error) => errors.push(error),
    ...options,
  });
  return { updates, errors, last: new Map(updates.flat()) };
}

describe("loadMergeRequestsData", () => {
  beforeEach(() => localStorage.clear());

  it("cold: one cheap query per 50 MRs, comments in batches of 5 alongside it", async () => {
    const { nodes, notes, items } = project("g/p", 7);
    const gitlab = fakeGitLab(nodes, notes);
    const { updates, last } = await load(gitlab.api, items);

    expect(gitlab.count(STAGE2)).toBe(1);
    expect(gitlab.requests.filter((r) => r.name === NOTES).map((r) => r.iids.length)).toEqual([5, 2]);
    expect(gitlab.requests).toHaveLength(3);
    // Grouped updates: after stage 2, then when comments are in
    expect(updates.length).toBeLessThanOrEqual(2);
    expect(last.get("g/p#1")).toMatchObject({ totalUserThreads: 1, unresolvedUserThreads: 1, repliesInUserThreads: 1 });
  });

  it("warm and unchanged: only the cheap query, activity comes from the stored record", async () => {
    const { nodes, notes, items } = project("g/p", 7);
    await load(fakeGitLab(nodes, notes).api, items);

    const gitlab = fakeGitLab(nodes, notes);
    const { last } = await load(gitlab.api, items);
    expect(gitlab.requests.map((r) => r.name)).toEqual([STAGE2]);
    expect(last.get("g/p#3")).toMatchObject({ repliesInUserThreads: 1 });
  });

  it("warm and changed: comments only for changed MRs, heavy ones in batches of their own", async () => {
    const { nodes, notes, items } = project("g/p", 6);
    await load(fakeGitLab(nodes, notes).api, items);

    // MR 1 and 2 got comments: 100 and 60 of them do not fit in one 150-comment batch
    nodes.set("g/p#1", node(1, { userNotesCount: 100, updatedAt: "2026-10-02T00:00:00Z" }));
    nodes.set("g/p#2", node(2, { userNotesCount: 60, updatedAt: "2026-10-02T00:00:00Z" }));
    nodes.set("g/p#3", node(3, { userNotesCount: 3, updatedAt: "2026-10-02T00:00:00Z" }));
    const gitlab = fakeGitLab(nodes, notes);
    await load(gitlab.api, items);

    expect(gitlab.count(STAGE2)).toBe(1);
    expect(gitlab.requests.filter((r) => r.name === NOTES).map((r) => r.iids)).toEqual([["1"], ["2", "3"]]);
  });

  it("an MR without comments needs no comment request even when never seen", async () => {
    const { nodes, notes, items } = project("g/p", 2, () => ({ userNotesCount: 0 }));
    await load(fakeGitLab(nodes, notes).api, items);
    const gitlab = fakeGitLab(nodes, notes);
    await load(gitlab.api, items);
    expect(gitlab.requests.map((r) => r.name)).toEqual([STAGE2]);
  });

  it("batches per project", async () => {
    const a = project("g/a", 2);
    const b = project("g/b", 1);
    const gitlab = fakeGitLab(new Map([...a.nodes, ...b.nodes]), new Map([...a.notes, ...b.notes]));
    await load(gitlab.api, [...a.items, ...b.items]);
    expect(gitlab.requests.filter((r) => r.name === STAGE2).map((r) => r.projectPath)).toEqual(["g/a", "g/b"]);
    expect(gitlab.requests).toHaveLength(4);
  });

  it("follows comment pagination", async () => {
    const { nodes, notes, items } = project("g/p", 1);
    const gitlab = fakeGitLab(nodes, notes, { pageSize: 1 });
    const { last } = await load(gitlab.api, items);
    expect(gitlab.count("MRFlowMergeRequestNotesPage")).toBe(1);
    expect(last.get("g/p#1")).toMatchObject({ repliesInUserThreads: 1 });
  });

  it("reports each update right away when progressive", async () => {
    const { nodes, notes, items } = project("g/p", 3);
    const { updates } = await load(fakeGitLab(nodes, notes).api, items, { progressive: true });
    expect(updates.every((batch) => batch.length === 1)).toBe(true);
  });

  it("keeps the MRs of other projects when one project fails", async () => {
    const a = project("g/a", 1);
    const b = project("g/b", 1);
    const gitlab = fakeGitLab(new Map([...a.nodes, ...b.nodes]), new Map([...a.notes, ...b.notes]), {
      failProject: "g/b",
    });
    const { errors, last } = await load(gitlab.api, [...a.items, ...b.items]);
    expect(errors.length).toBeGreaterThan(0);
    expect(last.has("g/a#1")).toBe(true);
    expect(last.has("g/b#1")).toBe(false);
  });

  it("stops requesting and reporting once aborted", async () => {
    const { nodes, notes, items } = project("g/p", 7);
    const gitlab = fakeGitLab(nodes, notes);
    const controller = new AbortController();
    const updates: unknown[] = [];
    const errors: unknown[] = [];
    const loading = loadMergeRequestsData(
      { api: gitlab.api, signal: controller.signal, userId: ME, settings: { approvalsNeeded: 2 } },
      items,
      { onUpdate: (batch) => updates.push(batch), onError: (error) => errors.push(error) },
    );
    controller.abort();
    await loading;
    expect(updates).toEqual([]);
    expect(errors).toEqual([]);
  });
});

describe("getMergeRequestData", () => {
  beforeEach(() => localStorage.clear());

  it("loads one MR with two requests and remembers it for the list", async () => {
    const { nodes, notes, items } = project("g/p", 1);
    const gitlab = fakeGitLab(nodes, notes);
    const ctx = { api: gitlab.api, signal: new AbortController().signal, userId: ME, settings: { approvalsNeeded: 2 } };
    const data = await getMergeRequestData(ctx, "g/p", "1");
    expect(data).toMatchObject({ totalUserThreads: 1, headSha: "sha1" });
    expect(gitlab.requests.map((r) => r.name).sort()).toEqual([STAGE2, NOTES].sort());

    // The list then needs only the cheap query
    const list = fakeGitLab(nodes, notes);
    await load(list.api, items);
    expect(list.requests.map((r) => r.name)).toEqual([STAGE2]);
  });
});
