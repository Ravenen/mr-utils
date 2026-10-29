import type { BrowserContext, Route } from "@playwright/test";
import type { DiffFileSpec, DiffsOptions } from "../src/test/diffs-markup";
import { diffsPage, listPage, mrPage } from "./pages";

export const ME = 7;
const gid = (id: number) => `gid://gitlab/User/${id}`;

export interface MockMr {
  iid: number;
  approvedByMe?: boolean;
  draft?: boolean;
  conflicts?: boolean;
  // My open threads; each gets a reply from someone else
  myOpenThreads?: number;
  // Comments from someone else (plain, not threads)
  otherComments?: number;
  updatedAt?: string;
}

interface Note {
  author: { id: string };
  discussion: { id: string; resolvable: boolean; resolved: boolean };
}

// A gitlab.com stand-in: serves the pages and answers the REST and GraphQL calls MRFlow makes,
// recording every GraphQL operation
export class MockGitLab {
  readonly operations: { name: string; iids: string[] }[] = [];
  mrs = new Map<number, MockMr>();
  notesPageSize = 100;
  // Answer GraphQL with 429 and this Retry-After (seconds)
  rateLimitedFor: number | null = null;
  redirectList = false;
  canApprove = true;
  // The Changes tab of every MR
  diffs: DiffFileSpec[] = [];
  diffsOptions: DiffsOptions & { lazy?: boolean } = {};

  constructor(
    readonly projectPath = "group/project",
    mrs: MockMr[] = [],
  ) {
    mrs.forEach((mr) => this.mrs.set(mr.iid, mr));
  }

  count(name: string): number {
    return this.operations.filter((op) => op.name === name).length;
  }

  async attach(context: BrowserContext): Promise<void> {
    await context.route("https://gitlab.com/**", (route) => this.handle(route));
  }

  private notes(mr: MockMr): Note[] {
    const notes: Note[] = [];
    for (let i = 0; i < (mr.myOpenThreads ?? 0); i++) {
      const discussion = { id: `t${mr.iid}-${i}`, resolvable: true, resolved: false };
      notes.push({ author: { id: gid(ME) }, discussion }, { author: { id: gid(9) }, discussion });
    }
    for (let i = 0; i < (mr.otherComments ?? 0); i++) {
      notes.push({ author: { id: gid(9) }, discussion: { id: `c${mr.iid}-${i}`, resolvable: false, resolved: false } });
    }
    return notes;
  }

  private page(mr: MockMr, after: string | null) {
    const all = this.notes(mr);
    const start = after ? Number(after) : 0;
    const end = start + this.notesPageSize;
    return { pageInfo: { hasNextPage: end < all.length, endCursor: String(end) }, nodes: all.slice(start, end) };
  }

  private node(mr: MockMr) {
    const notes = this.notes(mr);
    const threads = notes.filter((note) => note.discussion.resolvable && note.author.id === gid(ME)).length;
    return {
      iid: String(mr.iid),
      webUrl: `https://gitlab.com/${this.projectPath}/-/merge_requests/${mr.iid}`,
      draft: mr.draft ?? false,
      updatedAt: mr.updatedAt ?? "2026-10-01T00:00:00Z",
      detailedMergeStatus: mr.conflicts ? "CONFLICT" : "MERGEABLE",
      shouldBeRebased: false,
      conflicts: mr.conflicts ?? false,
      diffHeadSha: `sha${mr.iid}`,
      userNotesCount: notes.length,
      resolvableDiscussionsCount: threads,
      resolvedDiscussionsCount: 0,
      approvalsRequired: 0,
      approvedBy: { nodes: mr.approvedByMe ? [{ id: gid(ME) }] : [] },
    };
  }

  private async handle(route: Route) {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path.endsWith(".svg"))
      return route.fulfill({ contentType: "image/svg+xml", body: "<svg xmlns='http://www.w3.org/2000/svg'/>" });
    if (path === "/api/v4/user") return route.fulfill({ json: { id: ME, username: "me" } });
    if (path === "/api/graphql") {
      if (request.headers()["x-csrf-token"] !== "e2e-token") return route.fulfill({ status: 401, json: {} });
      const { query, variables } = request.postDataJSON() as { query: string; variables: Record<string, unknown> };
      const name = query.match(/query (\w+)/)?.[1] ?? "";
      const iids = (variables.iids as string[] | undefined) ?? [String(variables.iid)];
      this.operations.push({ name, iids });
      if (this.rateLimitedFor !== null)
        return route.fulfill({ status: 429, headers: { "Retry-After": String(this.rateLimitedFor) }, body: "" });

      const mrs = iids.flatMap((iid) => this.mrs.get(Number(iid)) ?? []);
      if (name === "MRFlowMergeRequestNotesPage")
        return route.fulfill({
          json: {
            data: { project: { mergeRequest: { notes: this.page(mrs[0] as MockMr, variables.after as string) } } },
          },
        });
      const nodes =
        name === "MRFlowMergeRequestsNotes"
          ? mrs.map((mr) => ({ iid: String(mr.iid), notes: this.page(mr, null) }))
          : mrs.map((mr) => this.node(mr));
      return route.fulfill({ json: { data: { project: { mergeRequests: { nodes } } } } });
    }

    const mrPageMatch = path.match(/\/-\/merge_requests\/(\d+)(\/diffs)?/);
    const html = mrPageMatch?.[2]
      ? diffsPage(this.diffs, this.diffsOptions)
      : mrPageMatch
        ? mrPage({ canApprove: this.canApprove })
        : listPage(this.projectPath, [...this.mrs.keys()], { redirect: this.redirectList });
    return route.fulfill({ contentType: "text/html", body: html });
  }
}
