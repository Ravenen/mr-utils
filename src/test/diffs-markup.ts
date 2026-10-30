// Diff files as GitLab renders them, for unit and e2e tests. Trimmed from the Vue diffs app
// (diff_file.vue, diff_file_header.vue, diff_view.vue, diff_row.vue, diff_expansion_cell.vue) and from
// Rapid Diffs (diff_file_component, merge_request_diff_file_component, inline/parallel_hunk_component).
// No imports: the e2e pages use it too.

export type DiffRenderer = "vue" | "rapid";
export type DiffViewType = "inline" | "parallel";

export interface DiffHunkSpec {
  // "@@ -10,6 +10,7 @@ fn"; leave out for a hunk at the top of the file, which GitLab shows without one
  header?: string;
  // " context", "-removed", "+added"
  lines: string[];
}

export interface DiffFileSpec {
  path: string;
  oldPath?: string;
  hunks: DiffHunkSpec[];
}

export interface DiffsOptions {
  renderer?: DiffRenderer;
  view?: DiffViewType;
  // GitLab's own "Viewed" checkbox (off when the user cannot review)
  reviews?: boolean;
}

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// GitLab's file hash stand-in: the diff file's id and its file tree row's data-file-row
export const hashOf = (path: string) =>
  [...path]
    .reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7)
    .toString(16)
    .padStart(8, "0");

interface Row {
  left?: { change: "added" | "removed" | null; text: string };
  right?: { change: "added" | "removed" | null; text: string };
}

// Lines to rows: inline has one per line; side by side pairs each run of removed lines with the added ones after it
function rows(lines: string[], view: DiffViewType): Row[] {
  const parsed = lines.map((line) => ({
    change: line[0] === "+" ? ("added" as const) : line[0] === "-" ? ("removed" as const) : null,
    text: line.slice(1),
  }));
  if (view === "inline") return parsed.map((line) => ({ left: line }));

  const result: Row[] = [];
  for (let i = 0; i < parsed.length;) {
    const line = parsed[i] as (typeof parsed)[number];
    if (line.change === null) {
      result.push({ left: line, right: line });
      i++;
      continue;
    }
    const removed: typeof parsed = [];
    const added: typeof parsed = [];
    while (parsed[i]?.change === "removed") removed.push(parsed[i++] as (typeof parsed)[number]);
    while (parsed[i]?.change === "added") added.push(parsed[i++] as (typeof parsed)[number]);
    for (let j = 0; j < Math.max(removed.length, added.length); j++) result.push({ left: removed[j], right: added[j] });
  }
  return result;
}

const vueType = (change: "added" | "removed" | null | undefined) =>
  change === "added" ? " new" : change === "removed" ? " old" : "";

function vueSide(side: "left" | "right", cell: Row["left"], parallel: boolean): string {
  if (!cell)
    return `<div data-testid="${side}-side" class="diff-grid-${side} ${side}-side">
      <div class="diff-td diff-line-num old_line empty-cell">&nbsp;</div>
      <div class="diff-td line-coverage ${side}-side empty-cell"></div>
      <div class="diff-td line-inline-findings ${side}-side empty-cell"></div>
      <div class="diff-td line_content with-coverage ${side}-side empty-cell${parallel ? " parallel" : ""}"></div>
    </div>`;
  const type = vueType(cell.change);
  return `<div data-testid="${side}-side" class="diff-grid-${side} ${side}-side">
      <div class="diff-td diff-line-num${type}"><a data-linenumber="1"></a></div>
      ${parallel ? "" : `<div class="diff-td diff-line-num${type}"><a data-linenumber="1"></a></div>`}
      <div class="diff-td line-coverage ${side}-side${type}"></div>
      <div class="diff-td line-inline-findings ${side}-side${type}"></div>
      <div class="diff-td line_content with-coverage ${side}-side${type}${parallel ? " parallel" : ""}"><span class="line">${escape(cell.text)}</span></div>
    </div>`;
}

function vueFile(file: DiffFileSpec, view: DiffViewType, reviews: boolean): string {
  const parallel = view === "parallel";
  const hash = hashOf(file.path);
  const body = file.hunks
    .map((hunk) => {
      const header = hunk.header
        ? `<div class="diff-grid-row diff-tr line_holder match expansion">
            <div class="diff-grid-left diff-grid-2-col left-side">
              <div class="diff-td diff-line-num"><button type="button" class="js-unfold diff-line-expand-button"></button></div>
              <div class="diff-td line_content left-side">${escape(hunk.header)}</div>
            </div>
            ${parallel ? `<div class="diff-grid-right diff-grid-2-col right-side"><div class="diff-td diff-line-num"></div><div class="diff-td line_content left-side">${escape(hunk.header)}</div></div>` : ""}
          </div>`
        : "";
      const lines = rows(hunk.lines, view)
        .map(
          (row) => `<div class="diff-grid-row diff-tr line_holder${parallel ? " parallel" : ""}">
            ${vueSide("left", row.left, parallel)}${parallel ? vueSide("right", row.right, parallel) : ""}
          </div>`,
        )
        .join("");
      return header + lines;
    })
    .join("");
  const review = reviews
    ? `<div class="gl-form-checkbox custom-checkbox custom-control -gl-mb-3 gl-mr-5 gl-flex gl-items-center">
        <input type="checkbox" class="custom-control-input" id="review-${hash}" data-testid="fileReviewCheckbox" />
        <label for="review-${hash}" class="custom-control-label">Viewed</label>
      </div>`
    : "";
  return `<div id="${hash}" data-path="${escape(file.path)}" class="diff-file file-holder has-body">
      <div class="js-file-title file-title file-title-flex-parent">
        <div class="file-header-content"><span class="file-title-name">${escape(file.path)}</span></div>
        <div class="file-actions gl-flex gl-items-center">${review}</div>
      </div>
      <div id="diff-content-${hash}" class="diff-content" data-testid="content-area">
        <div class="diff-viewer">
          <div class="diff-grid diff-table code code-syntax-highlight-theme diff-wrap-lines js-syntax-highlight text-file${parallel ? "" : " inline-diff-view"}">${body}</div>
        </div>
      </div>
    </div>`;
}

function rapidNumber(cell: Row["left"], position: string): string {
  const change = cell?.change ? ` data-change="${cell.change}"` : "";
  return `<td class="rd-line-number"${change} data-position="${position}"><a class="rd-line-link" data-line-number="1"></a></td>`;
}

function rapidContent(cell: Row["left"], position: string | null): string {
  const change = cell?.change ? ` data-change="${cell.change}"` : "";
  const at = position ? ` data-position="${position}"` : "";
  return `<td class="rd-line-content"${change}${at} data-gfm-source="true"><pre class="rd-line-text"><span class="line">${escape(cell?.text ?? "")}</span>\n</pre></td>`;
}

function rapidFile(file: DiffFileSpec, view: DiffViewType, reviews: boolean): string {
  const hash = hashOf(file.path);
  const data = JSON.stringify({ viewer: `text_${view}`, old_path: file.oldPath ?? file.path, new_path: file.path });
  const tbodies = file.hunks
    .map((hunk, index) => {
      const header = hunk.header
        ? `<tr class="rd-hunk-header rd-hunk-header-${view}" data-hunk-header>
            <td class="rd-hunk-header-buttons"${view === "inline" ? ' colspan="2"' : ""}><button type="button" class="rd-expand-lines-button" data-click="expandLines" data-expand-direction="up"></button></td>
            <td class="rd-hunk-header-content"${view === "parallel" ? ' colspan="3"' : ""}>${escape(hunk.header)}</td>
          </tr>`
        : "";
      const lines = rows(hunk.lines, view)
        .map((row, i) =>
          view === "inline"
            ? `<tr class="rd-hunk-lines rd-hunk-lines-inline" data-hunk-lines data-testid="hunk-lines-inline" id="line_${hash}_${index}_${i}">
                ${rapidNumber(row.left, "old")}${rapidNumber(row.left, "new")}${rapidContent(row.left, null)}
              </tr>`
            : `<tr class="rd-hunk-lines rd-hunk-lines-parallel" data-hunk-lines data-testid="hunk-lines-parallel" id="line_${hash}_${index}_${i}">
                ${rapidNumber(row.left, "old")}${rapidContent(row.left, "old")}${rapidNumber(row.right, "new")}${rapidContent(row.right, "new")}
              </tr>`,
        )
        .join("");
      return `<tbody class="rd-text-view-content">${header}${lines}</tbody>`;
    })
    .join("");
  // The last header only expands the rest of the file
  const tail = `<tbody class="rd-text-view-content"><tr class="rd-hunk-header rd-hunk-header-${view}" data-hunk-header>
      <td class="rd-hunk-header-buttons"><button type="button" class="rd-expand-lines-button" data-click="expandLines" data-expand-direction="down"></button></td>
      <td class="rd-hunk-header-content"></td></tr></tbody>`;
  const review = reviews
    ? `<div class="rd-viewed-toggle"><div class="gl-form-checkbox custom-control custom-checkbox">
        <input type="checkbox" name="code-review-${hash}" id="code-review-${hash}" value="1" data-click="toggleViewed" data-viewed-checkbox="" class="custom-control-input" />
        <label class="custom-control-label" for="code-review-${hash}"><span>Viewed</span></label>
      </div></div>`
    : "";
  return `<diff-file class="rd-diff-file-component" data-file-data="${escape(data).replace(/"/g, "&quot;")}" data-testid="rd-diff-file" id="${hash}">
      <article class="rd-diff-file">
        <div class="rd-diff-file-header-sticky"><header class="rd-diff-file-header" data-testid="rd-diff-file-header">
          <div class="rd-diff-file-header-main"><h2 class="rd-diff-file-title">${escape(file.path)}</h2></div>
          <div class="rd-diff-file-info">${review}</div>
        </header></div>
        <details class="rd-diff-file-details" data-file-body="" open><summary></summary>
          <div class="rd-diff-file-body" data-testid="rd-diff-file-body">
            <table class="rd-text-view-root code-syntax-highlight-theme">${tbodies}${tail}</table>
          </div>
        </details>
      </article>
      <diff-file-mounted></diff-file-mounted>
    </diff-file>`;
}

// The diff files of an MR's Changes tab
export function diffFilesMarkup(
  files: DiffFileSpec[],
  { renderer = "vue", view = "inline", reviews = true }: DiffsOptions = {},
): string {
  const markup = files.map((file) => (renderer === "rapid" ? rapidFile : vueFile)(file, view, reviews)).join("");
  return renderer === "rapid"
    ? `<article class="rd-app" data-rapid-diffs><div class="rd-app-body"><section class="rd-app-content">
        <div class="rd-app-diffs-list"><div data-diffs-list>${markup}</div></div></section></div></article>`
    : `<div class="tab-pane diffs" id="diffs"><div class="diff-files-holder"><div class="files">${markup}</div></div></div>`;
}

// The file tree (file_row.vue): one row per file, linked to its diff file by hash
export function diffTreeMarkup(files: DiffFileSpec[]): string {
  const rows = files
    .map(
      (file) => `<div data-testid="file-row-container" class="gl-flex gl-items-center">
        <button type="button" class="file-row gl-flex-grow-1" data-file-row="${hashOf(file.path)}" data-testid="file-row" aria-label="${escape(file.path)}">
          <span class="file-row-name gl-min-w-0" data-testid="file-row-name-container">${escape(file.path.split("/").pop() ?? "")}</span>
        </button>
      </div>`,
    )
    .join("");
  return `<nav class="diff-tree-list" aria-label="File browser">${rows}</nav>`;
}

// A small MR: one file with a hunk at the top (no header) and one further down, and one more file
export const SAMPLE_DIFF: DiffFileSpec[] = [
  {
    path: "src/board.ts",
    hunks: [
      {
        lines: [
          " import { badge } from './badge';",
          "-import { old } from './old';",
          "+import { spinner } from './spinner';",
          " ",
        ],
      },
      {
        header: "@@ -20,6 +20,8 @@ export function board()",
        lines: [
          "   const columns = createColumns();",
          "-  render(columns);",
          "+  render(columns, { animate });",
          "+  observe(columns);",
          "   return columns;",
          "+  // done",
        ],
      },
    ],
  },
  {
    path: "README.md",
    hunks: [
      {
        header: "@@ -1,3 +1,3 @@",
        lines: [" # MRFlow", "-Kanban for GitLab", "+Kanban and hunk review for GitLab", " "],
      },
    ],
  },
];
