// Every GitLab selector the extension uses. When GitLab changes its markup, fix it here.
// Each lookup tries the stable hook first (data-testid, js- classes) and falls back to the older markup.

// <meta name="csrf-token">: GraphQL POSTs without it are answered as anonymous
export function csrfToken(doc: Document = document): string | null {
  return doc.querySelector('meta[name="csrf-token"]')?.getAttribute("content") ?? null;
}

// GitLab's icon sprite URL, e.g. "/assets/icons-<hash>.svg". It is hashed per deploy, so take it from the page.
export function iconSpriteUrl(doc: Document = document): string | null {
  const use = doc.querySelector('svg use[href*="/icons-"][href*=".svg#"]');
  return use?.getAttribute("href")?.split("#")[0] ?? null;
}

// == MR list ==

// MR items of the native list, in list order (HAML and Vue lists both put "merge-request" on the <li>)
export function mergeRequestItems(root: ParentNode = document): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("li.merge-request")];
}

// "/group/project/-/merge_requests/12" of an item
export function mergeRequestItemPath(item: Element): string | null {
  return item.querySelector("[data-testid='issuable-title-link']")?.getAttribute("href") ?? null;
}

export function mergeRequestList(item: Element): HTMLElement | null {
  return item.closest("ul");
}

export function itemMainInfo(item: Element): HTMLElement | null {
  return item.querySelector(".issuable-main-info");
}

export function itemMeta(item: Element): HTMLElement | null {
  return item.querySelector(".issuable-meta");
}

export function itemControls(item: Element): HTMLElement | null {
  return item.querySelector(".controls");
}

// The native comments count, replaced by our thread badges
export function itemCommentsBadge(controls: Element): HTMLElement | null {
  return (
    controls.querySelector<HTMLElement>("[data-testid='issuable-comments']") ??
    controls.querySelector("[data-testid='comments-icon']")?.closest<HTMLElement>(".controls > li") ??
    null
  );
}

export function itemApprovals(controls: Element): HTMLElement | null {
  return controls.querySelector("[data-testid='mr-approvals']");
}

// == MR page ==

export interface ApprovalsWidget {
  // Where the checklist goes: the start of the widget's content, above the approve row
  content: HTMLElement;
  // Approve / Revoke approval; null when the user cannot approve (own MR, no permission)
  button: HTMLButtonElement | null;
}

// The approvals widget once it is loaded; null while it loads
export function approvalsWidget(doc: Document = document): ApprovalsWidget | null {
  const widget = doc.querySelector(".js-mr-approvals");
  if (!widget) return null;
  const button = widget.querySelector<HTMLButtonElement>("button[data-testid='approve-button']");

  // Current markup (state_container.vue): a loader while loading, then the content in .media-body
  const body = widget.querySelector(".mr-widget-body");
  if (body?.querySelector(".media-body")) {
    if (body.querySelector(".mr-state-loader")) return null;
    const content = body.querySelector<HTMLElement>(".media-body > *");
    return content ? { content, button } : null;
  }

  // Older markup: the first button is Approve, and the widget says when it is still loading
  if (widget.textContent?.includes("Checking approval status")) return null;
  const legacyButton = button ?? widget.querySelector("button");
  const content = legacyButton?.parentElement?.parentElement?.parentElement;
  return legacyButton && content ? { content, button: legacyButton } : null;
}

// "Revoke approval" uses the default variant, "Approve" the confirm one; the text check covers older markup
export function isRevokeApprovalButton(button: Element): boolean {
  return button.classList.contains("btn-default") || Boolean(button.textContent?.includes("Revoke approval"));
}

// The merge section (merge button, its options and checks), once it is ready to merge
export function mergeSection(doc: Document = document): HTMLElement | null {
  const readyToMerge = doc.querySelector(".mr-widget-body-ready-merge");
  if (!readyToMerge) return null;
  return (
    readyToMerge.closest<HTMLElement>(".mr-section-container") ??
    readyToMerge.parentElement?.parentElement?.parentElement ??
    null
  );
}

// == MR changes (diffs) ==
// Two renderers: the Vue diffs app (diff_file.vue, diff_view.vue, diff_row.vue) and Rapid Diffs
// (server-rendered app/components/rapid_diffs, the default on gitlab.com). Both are read into the
// same shape here, so the features never see which one the page uses.

export type DiffChange = "added" | "removed";

export interface DiffLine {
  change: DiffChange;
  // The code without the +/- marker
  text: string;
}

export interface DiffHunk {
  // The "@@ -1,5 +1,6 @@" row; null for a hunk at the top of the file, which has none
  header: HTMLElement | null;
  // The hunk's line rows, in order (context, changed and expanded lines)
  rows: HTMLElement[];
  // Changed lines grouped in runs without context between them; in a run, removed lines come
  // before added ones in both inline and side-by-side views
  blocks: DiffLine[][];
}

export interface DiffFile {
  root: HTMLElement;
  // GitLab's file hash: the root's id, also on the file's row in the file tree
  id: string;
  path: string;
  // Differs from path for a renamed file
  oldPath: string;
  // GitLab's own "Viewed" checkbox; null when reviews are off or the user is signed out
  viewed: HTMLInputElement | null;
  // Where a badge goes in the file header: before the Viewed checkbox, or at the end of the header's controls
  headerSlot: { parent: HTMLElement; before: Element | null } | null;
  // Hunks with at least one changed line; none while the file is collapsed or still loading
  hunks: DiffHunk[];
}

const RAPID_FILE = "diff-file[data-testid='rd-diff-file']";
const VUE_FILE = ".diff-file.file-holder";

// Every diff file on the page, in page order
export function diffFiles(root: ParentNode = document): DiffFile[] {
  return [...root.querySelectorAll<HTMLElement>(`${RAPID_FILE}, ${VUE_FILE}`)].map(readDiffFile);
}

// The diff file a node is in (or is), for reading only the files a change touched
export function diffFileRoot(node: Node): HTMLElement | null {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest<HTMLElement>(`${RAPID_FILE}, ${VUE_FILE}`) ?? null;
}

// Diff files inside a node GitLab added (a batch of files, or a single one)
export function diffFileRootsIn(node: Node): HTMLElement[] {
  if (!(node instanceof Element)) return [];
  const own = node.matches(`${RAPID_FILE}, ${VUE_FILE}`) ? [node as HTMLElement] : [];
  return [...own, ...node.querySelectorAll<HTMLElement>(`${RAPID_FILE}, ${VUE_FILE}`)];
}

export function readDiffFile(root: HTMLElement): DiffFile {
  return root.matches(RAPID_FILE) ? rapidDiffFile(root) : vueDiffFile(root);
}

// Is this GitLab's Viewed checkbox of a diff file?
export function isDiffFileViewedCheckbox(element: EventTarget | null): element is HTMLInputElement {
  return (
    element instanceof HTMLInputElement &&
    (element.matches("input[data-viewed-checkbox]") ||
      element.matches(
        `${VUE_FILE} .file-title [data-testid='fileReviewCheckbox'], ${VUE_FILE} .file-title [data-testid='fileReviewCheckbox'] input`,
      ))
  );
}

// Files in the file tree (the same Vue component in both renderers), by file hash
export function diffTreeRows(root: ParentNode = document): { row: HTMLElement; fileId: string }[] {
  return [...root.querySelectorAll<HTMLElement>("[data-testid='file-row'][data-file-row]")].map((row) => ({
    row,
    fileId: row.dataset.fileRow ?? "",
  }));
}

function rapidDiffFile(root: HTMLElement): DiffFile {
  let data: { new_path?: string; old_path?: string } = {};
  try {
    data = JSON.parse(root.dataset.fileData ?? "{}");
  } catch {
    // Keep the empty paths: the file is still shown, it just cannot be told apart
  }
  const path = data.new_path ?? "";
  const viewed = root.querySelector<HTMLInputElement>("input[data-viewed-checkbox]");
  const info = root.querySelector<HTMLElement>(".rd-diff-file-info");
  const rows = [...root.querySelectorAll<HTMLElement>("tr[data-hunk-header], tr[data-hunk-lines]")];
  return {
    root,
    id: root.id,
    path,
    oldPath: data.old_path ?? path,
    viewed,
    headerSlot: info ? { parent: info, before: info.querySelector(".rd-viewed-toggle") } : null,
    hunks: splitHunks(
      rows,
      (row) => row.hasAttribute("data-hunk-header"),
      (row) =>
        [...row.querySelectorAll<HTMLElement>("td.rd-line-content[data-change]")].flatMap((cell) => {
          const change = cell.dataset.change;
          if (change !== "added" && change !== "removed") return [];
          return [{ change, text: (cell.querySelector(".rd-line-text")?.textContent ?? "").replace(/\n$/, "") }];
        }),
    ),
  };
}

function vueDiffFile(root: HTMLElement): DiffFile {
  const path = root.dataset.path ?? "";
  // The header's checkbox: GitLab puts the test id on the <input> (inheritAttrs: false) or its wrapper
  const review = root.querySelector(".file-title [data-testid='fileReviewCheckbox']");
  const viewed = review instanceof HTMLInputElement ? review : (review?.querySelector("input") ?? null);
  const actions = root.querySelector<HTMLElement>(".file-title .file-actions");
  const reviewWrapper = viewed?.closest(".gl-form-checkbox") ?? null;
  // Rows of the grid (diff_view.vue) or of the older table; comment rows (notes_holder) are skipped
  const rows = [...root.querySelectorAll<HTMLElement>(".diff-content .line_holder")];
  return {
    root,
    id: root.id,
    path,
    oldPath: root.dataset.oldPath ?? path,
    viewed,
    headerSlot: actions
      ? { parent: actions, before: reviewWrapper?.parentElement === actions ? reviewWrapper : null }
      : null,
    hunks: splitHunks(
      rows,
      (row) => row.classList.contains("match"),
      (row) =>
        [...row.querySelectorAll<HTMLElement>(".line_content")].flatMap((cell) => {
          const change = cell.classList.contains("new") ? "added" : cell.classList.contains("old") ? "removed" : null;
          return change ? [{ change, text: cell.textContent ?? "" } as DiffLine] : [];
        }),
    ),
  };
}

// Rows to hunks: a header row starts a new one. Changed lines of consecutive rows make a block.
function splitHunks(
  rows: HTMLElement[],
  isHeader: (row: HTMLElement) => boolean,
  changes: (row: HTMLElement) => DiffLine[],
): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let hunk: DiffHunk | null = null;
  let block: DiffLine[] | null = null;
  const closeBlock = () => {
    if (block && hunk) {
      // Side by side pairs a removed and an added line per row: put them in inline order
      hunk.blocks.push([
        ...block.filter((line) => line.change === "removed"),
        ...block.filter((line) => line.change === "added"),
      ]);
    }
    block = null;
  };

  for (const row of rows) {
    if (isHeader(row)) {
      closeBlock();
      hunk = { header: row, rows: [], blocks: [] };
      hunks.push(hunk);
      continue;
    }
    if (!hunk) {
      hunk = { header: null, rows: [], blocks: [] };
      hunks.push(hunk);
    }
    hunk.rows.push(row);
    const lines = changes(row);
    if (lines.length === 0) closeBlock();
    else (block ??= []).push(...lines);
  }
  closeBlock();
  // A header after the last hunk only expands the rest of the file
  return hunks.filter((h) => h.blocks.length > 0);
}
