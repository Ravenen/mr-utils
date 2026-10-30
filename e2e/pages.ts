import { diffFilesMarkup, diffTreeMarkup, type DiffFileSpec, type DiffsOptions } from "../src/test/diffs-markup";

// GitLab pages for the e2e tests. The markup is trimmed from GitLab's own components
// (issuable_item.vue, merge_requests_list_app.vue, approvals.vue, merge_widget.vue) and holds no real data.

const TITLES = [
  "Fix flaky pipeline in the deploy stage",
  "Add dark mode to the settings page",
  "Draft: Refactor the approvals widget",
  "Bump dependency versions",
  "Update the merge request docs",
  "Improve error messages for 429 responses",
  "Remove the legacy API client",
  "Speed up the board",
];

export const SPRITE = "/assets/icons-e2e.svg";

export function listItem(projectPath: string, iid: number): string {
  return `
    <li id="issuable_${iid}" class="issue merge-request !gl-flex gl-flex-col" data-testid="issuable-item-wrapper">
      <div class="issuable-main-info">
        <div data-testid="issuable-title" class="issue-title title">
          <a href="/${projectPath}/-/merge_requests/${iid}" data-testid="issuable-title-link">${TITLES[(iid - 1) % TITLES.length]}</a>
        </div>
        <div class="issuable-info"><span data-testid="issuable-reference">!${iid}</span> created by <span class="author">Jane Doe</span></div>
      </div>
      <div class="issuable-meta">
        <ul class="controls">
          <li data-testid="issuable-comments"><a href="#"><svg><use href="${SPRITE}#comments"></use></svg> ${iid}</a></li>
          <li><button data-testid="mr-approvals"><span>0 of 2</span></button></li>
        </ul>
      </div>
    </li>`;
}

// An MR list. With `redirect`, the page does what GitLab does on load: rewrites the URL to the default
// sort and re-renders the list (new <li> elements) a moment later.
export function listPage(projectPath: string, iids: number[], { redirect = false } = {}): string {
  const items = iids.map((iid) => listItem(projectPath, iid)).join("");
  const rerender = redirect
    ? `<script>
        setTimeout(() => {
          history.replaceState(null, "", location.pathname + "?sort=created_date&state=opened");
          document.querySelector("ul.issuable-list").innerHTML = ${JSON.stringify(items)};
        }, 50);
      </script>`
    : "";
  return `<!doctype html><html><head><meta name="csrf-token" content="e2e-token"><title>Merge requests</title></head>
    <body><svg hidden><use href="${SPRITE}#home"></use></svg>
      <main><ul class="content-list issuable-list issues-list">${items}</ul></main>${rerender}</body></html>`;
}

// The MR widget: approvals as approvals.vue renders them inside state_container.vue, then the merge section.
// Without `canApprove` there is no approve button, as on your own MR.
export function mrPage({ canApprove = true } = {}): string {
  const approve = canApprove
    ? `<button class="btn btn-confirm btn-sm gl-button" data-testid="approve-button">Approve</button>`
    : "";
  return `<!doctype html><html><head><meta name="csrf-token" content="e2e-token"><title>Merge request</title></head>
    <body><svg hidden><use href="${SPRITE}#home"></use></svg>
      <div id="widget-state" class="mr-state-widget">
        <div class="js-mr-approvals mr-section-container">
          <div class="mr-widget-body media gl-flex gl-items-center">
            <div class="gl-mr-3 gl-flex gl-h-6 gl-w-6"></div>
            <div class="gl-flex gl-w-full">
              <div class="media-body gl-leading-normal">
                <div class="gl-flex gl-flex-col">
                  <div class="gl-flex gl-flex-col gl-gap-3">${approve}<div data-testid="approvals-summary-content">Requires 2 approvals</div></div>
                </div>
              </div>
              <div class="gl-border-l"><button class="btn btn-default btn-icon" data-testid="widget-toggle">Collapse</button></div>
            </div>
          </div>
        </div>
        <div class="mr-section-container">
          <div class="mr-widget-section" data-testid="mr-widget-content">
            <div data-testid="ready_to_merge_state"><div class="mr-widget-body mr-widget-body-ready-merge">Ready to merge!</div></div>
          </div>
        </div>
      </div></body></html>`;
}

// The Changes tab: the file tree and the diff files of the Vue diffs app or of Rapid Diffs (src/test/diffs-markup.ts).
// With `lazy`, the files come a moment after the page, as GitLab loads them in batches.
export function diffsPage(files: DiffFileSpec[], options: DiffsOptions & { lazy?: boolean } = {}): string {
  const tabs = `<ul class="merge-request-tabs nav-tabs"><li class="diffs-tab js-diffs-tab active" data-testid="diffs-tab" id="diffs-tab">
      <a data-action="diffs" href="#">Changes <span class="gl-badge badge badge-pill badge-neutral">${files.length}</span></a></li></ul>`;
  const markup = tabs + diffTreeMarkup(files) + diffFilesMarkup(files, options);
  const body = options.lazy
    ? `<div id="diffs"></div><script>setTimeout(() => { document.getElementById("diffs").innerHTML = ${JSON.stringify(markup)}; }, 100);</script>`
    : markup;
  return `<!doctype html><html><head><meta name="csrf-token" content="e2e-token"><title>Changes</title></head>
    <body><svg hidden><use href="${SPRITE}#home"></use></svg>${body}</body></html>`;
}
