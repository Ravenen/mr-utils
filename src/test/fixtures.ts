// GitLab markup for tests, trimmed from GitLab's own components (issuable_item.vue,
// merge_requests_list_app.vue, approvals.vue, merge_widget.vue, mr_widget_options.vue)
import type { GitLabApi } from "@/core/gitlab/api";
import type { FeatureContext } from "@/core/lifecycle";
import type { MrNode } from "@/core/gitlab/queries";
import { parseRoute, type Route } from "@/core/router";
import type { Settings } from "@/core/settings";

export const SPRITE = '<svg><use href="/assets/icons-abc.svg#home"></use></svg>';

export function mrListItem(iid: number, { legacyComments = false } = {}): string {
  const comments = legacyComments
    ? `<li><a><span><svg data-testid="comments-icon"></svg></span> 3</a></li>`
    : `<li data-testid="issuable-comments"><a>3</a></li>`;
  return `
    <li class="issue merge-request !gl-flex" data-testid="issuable-item-wrapper">
      <div class="issuable-main-info">
        <div data-testid="issuable-title"><a data-testid="issuable-title-link" href="/g/p/-/merge_requests/${iid}">MR ${iid}</a></div>
      </div>
      <div class="issuable-meta @sm/panel:gl-max-w-2/8">
        <ul class="controls">
          ${comments}
          <li><button data-testid="mr-approvals">0 of 2</button></li>
        </ul>
      </div>
    </li>`;
}

export function mrList(count: number, options = {}): string {
  const items = Array.from({ length: count }, (_, i) => mrListItem(i + 1, options)).join("");
  return `${SPRITE}<div id="app"><ul class="content-list issuable-list">${items}</ul></div>`;
}

export function mrPage({ revoke = false, legacy = false } = {}): string {
  const button = legacy
    ? `<button class="btn">${revoke ? "Revoke approval" : "Approve"}</button>`
    : `<button class="btn ${revoke ? "btn-default" : "btn-confirm"}" data-testid="approve-button">${revoke ? "Revoke approval" : "Approve"}</button>`;
  return `${SPRITE}
    <div id="widget-state" class="mr-state-widget">
      <div class="js-mr-approvals mr-section-container">
        <div class="state-container">
          <div class="gl-flex gl-flex-col">
            <div class="gl-flex gl-flex-col gl-gap-3">${button}<div class="approvals-summary">Approval is optional</div></div>
          </div>
        </div>
      </div>
      <div class="mr-section-container">
        <div class="mr-widget-section" data-testid="mr-widget-content">
          <div data-testid="ready_to_merge_state">
            <div class="mr-widget-body mr-widget-body-ready-merge media">Merge</div>
          </div>
        </div>
      </div>
    </div>`;
}

export const node = (iid: number, extra: Partial<MrNode> = {}): MrNode => ({
  iid: String(iid),
  webUrl: `https://gitlab.com/g/p/-/merge_requests/${iid}`,
  draft: false,
  updatedAt: "2026-10-01T00:00:00Z",
  detailedMergeStatus: "MERGEABLE",
  shouldBeRebased: false,
  conflicts: false,
  diffHeadSha: `sha${iid}`,
  userNotesCount: 0,
  resolvableDiscussionsCount: 0,
  resolvedDiscussionsCount: 0,
  approvedBy: { nodes: [] },
  ...extra,
});

// A GitLab API answering MR queries from `nodes` (by iid); MRs have no comments
export function fakeApi(nodes: Record<string, MrNode>): GitLabApi {
  return {
    fetch: () => Promise.reject(new Error("REST is not expected")),
    async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
      const iids = (variables.iids as string[]) ?? [];
      const found = iids.flatMap((iid) => (nodes[iid] ? [nodes[iid]] : []));
      const isNotes = query.includes("MRFlowMergeRequestsNotes");
      return {
        project: {
          mergeRequests: {
            nodes: isNotes
              ? found.map((n) => ({ iid: n.iid, notes: { pageInfo: { hasNextPage: false }, nodes: [] } }))
              : found,
          },
        },
      } as T;
    },
  };
}

export const SETTINGS: Settings = {
  approvalsNeeded: 2,
  kanbanView: true,
  boardLoading: "all",
  animateCards: false,
  resetChecksOnNewCommits: true,
};

// A mount context for one feature, as startFeatures builds it
export function featureContext<R extends Route>(
  path: string,
  api: GitLabApi,
  settings: Partial<Settings> = {},
): { ctx: FeatureContext<R>; unmount: () => void } {
  const controller = new AbortController();
  const ctx = {
    route: parseRoute(`https://gitlab.com${path}`) as R,
    signal: controller.signal,
    settings: { ...SETTINGS, ...settings },
    userId: 7,
    api,
    onCleanup(fn: () => void) {
      controller.signal.addEventListener("abort", fn, { once: true });
    },
  };
  return { ctx, unmount: () => controller.abort() };
}

// Every element that carries an inline style
export const styledElements = (root: ParentNode = document) => [...root.querySelectorAll("[style]")];
