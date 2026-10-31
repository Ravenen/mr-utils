import {
  changesTabLink,
  diffFileRoot,
  diffFileRootsIn,
  diffFiles,
  diffTreeRows,
  isDiffFileViewedCheckbox,
  hunkSpan,
  readDiffFile,
  type DiffFile,
  type DiffHunk,
} from "@/core/gitlab/dom";
import type { Feature } from "@/core/lifecycle";
import {
  hunkMarksKey,
  loadHunkMarks,
  pruneHunkMarks,
  removeHunkMarks,
  saveHunkMarks,
  watchHunkMarks,
} from "@/core/storage/hunk-marks";
import { badge } from "@/ui/badge";
import { checkbox } from "@/ui/checkbox";
import { prependIcon } from "@/ui/icons";
import { blockIds } from "@/utils/hunks";
import { loadMrPageData, type MrPageRoute } from "./seen-state";

const CONTROL = "mrflow-hunk-control";
const HEADER = "mrflow-hunk-header";
const FILE_PROGRESS = "mrflow-hunk-progress";
const TREE_PROGRESS = "mrflow-hunk-tree-progress";
const LEFT = "mrflow-hunks-left";
const TOGGLE = "mrflow-hunk-toggle";
const BLOCK_CONTROL = "mrflow-block-control";
const BLOCK_PLACEHOLDER = "mrflow-block-placeholder";
const PRUNED = "hunk-review/pruned";

interface Progress {
  viewed: number;
  total: number;
}

// A "Viewed" checkbox on every hunk of the Changes tab, in both diffs renderers and both views.
// Marks are kept per block of changed lines (src/utils/hunks.ts), so after a new push the blocks it
// did not touch stay viewed. A file shows its progress in its header and in the file tree; when all
// its hunks are viewed, GitLab's own Viewed checkbox of the file is ticked, and unticking it clears
// the file's hunks. GitLab mounts and drops diff files as they load and scroll, so the page is watched
// and only the files a change touched are read again.
// Viewed hunks are collapsed (their header stays, with a button to show the lines), the Changes tab
// counts the hunks left, and Shift+] / Shift+[ go to the next / previous hunk not viewed (GitLab
// already uses ] and [ for files).
// A hunk with several blocks of changed lines also gets a checkbox on each block (on its first line),
// and a viewed block collapses to a thin row of ours; the hunk's checkbox is then half ticked.
export const hunkReviewFeature: Feature<MrPageRoute> = {
  name: "hunk-review",
  match: (route): route is MrPageRoute => route.kind === "mr-page",
  settings: ["hunkReview", "hunkBlockReview", "hunkCollapseViewed", "hunkHotkeys"],
  async mount(ctx) {
    if (!ctx.settings.hunkReview) return;
    const key = hunkMarksKey(ctx.route.projectPath, ctx.route.iid);
    let marks = await loadHunkMarks(key);
    if (ctx.signal.aborted) return;
    let persist = true;
    if (!ctx.cache.has(PRUNED)) {
      ctx.cache.set(PRUNED, true);
      void pruneHunkMarks();
    }
    // A merged or closed MR is not reviewed any more: its marks live on this page only
    void loadMrPageData(ctx).then((data) => {
      if (ctx.signal.aborted || (data?.state !== "merged" && data?.state !== "closed")) return;
      persist = false;
      void removeHunkMarks(key);
    });

    const added = new Set<Element>();
    // The ids of the hunk a checkbox stands for, as of the last time its file was read
    const controlIds = new WeakMap<Element, string[]>();
    const progress = new Map<string, Progress>();
    // Files whose Viewed checkbox was unticked while collapsed: their hunks are cleared once shown
    const pendingUnmark = new Set<string>();
    let syncing = false;
    // Viewed hunks ("hunk:<first block id>") and blocks (by id) the user opened again
    const expanded = new Set<string>();
    const collapse = ctx.settings.hunkCollapseViewed;
    const blockReview = ctx.settings.hunkBlockReview;
    // The block a block checkbox or a collapsed block's row stands for, as of the last read of its file
    const blockOf = new WeakMap<Element, string>();

    const isMarked = (id: string) => id in marks;
    const save = () => {
      if (persist) void saveHunkMarks(key, marks);
    };
    const setMarks = (ids: string[], viewed: boolean) => {
      const now = Date.now();
      marks = { ...marks };
      ids.forEach((id) => {
        if (viewed) marks[id] = now;
        else delete marks[id];
      });
      save();
    };

    const renderFile = (file: DiffFile) => {
      const hunkIds = idsOf(file);
      if (hunkIds.length > 0 && pendingUnmark.delete(file.id)) setMarks(hunkIds.flat(), false);

      let viewedCount = 0;
      file.hunks.forEach((hunk, index) => {
        const ids = hunkIds[index] ?? [];
        // Renamed in the MR: blocks ticked under the old path still count
        const oldIds = file.oldPath !== file.path ? (idsOf(file, file.oldPath)[index] ?? []) : [];
        const viewed = ids.every((id, i) => isMarked(id) || isMarked(oldIds[i] ?? ""));
        if (viewed) viewedCount++;

        const host = hunkHost(hunk, added);
        if (!host) return;
        let control = host.querySelector<HTMLElement>(`:scope > .${CONTROL}`);
        if (!control) {
          control = document.createElement(host.tagName === "TR" ? "td" : "div");
          control.className = CONTROL;
          const owner = control;
          const rerender = () => {
            const root = diffFileRoot(owner);
            if (root) renderFile(readDiffFile(root));
            renderSummary();
          };
          // Showing a hunk's lines shows its viewed blocks too
          const setExpanded = (ids: string[], on: boolean) =>
            [`hunk:${ids[0] ?? ""}`, ...ids].forEach((id) => (on ? expanded.add(id) : expanded.delete(id)));
          if (collapse) {
            control.appendChild(
              toggleButton(() => {
                const ids = controlIds.get(owner) ?? [];
                setExpanded(ids, !expanded.has(`hunk:${ids[0] ?? ""}`));
                rerender();
              }),
            );
          }
          control.appendChild(
            checkbox("Viewed", {
              onChange: (checked) => {
                const ids = controlIds.get(owner) ?? [];
                setMarks(ids, checked);
                // Ticked again later: collapsed again
                if (!checked) setExpanded(ids, false);
                rerender();
              },
            }).root,
          );
          host.appendChild(control);
          added.add(control);
        }
        controlIds.set(control, ids);
        const blocksViewed = ids.map((id, i) => isMarked(id) || isMarked(oldIds[i] ?? ""));
        const input = control.querySelector("input");
        if (input) {
          input.checked = viewed;
          input.indeterminate = !viewed && blocksViewed.some(Boolean);
        }
        hunk.rows.forEach((row) => setFlag(row, "data-mrflow-hunk-viewed", viewed));

        const collapsed = collapse && viewed && !expanded.has(`hunk:${ids[0] ?? ""}`);
        const showBlocks = blockReview && hunk.blocks.length > 1;
        setFlag(control, "data-mrflow-has-blocks", showBlocks);
        hunk.blockRows.forEach((rows, j) =>
          renderBlock(rows, ids[j] ?? "", showBlocks, blocksViewed[j] ?? false, collapsed),
        );
        hunkSpan(hunk).forEach((row) => setFlag(row, "data-mrflow-hunk-collapsed", collapsed));
        const toggle = control.querySelector<HTMLButtonElement>(`.${TOGGLE}`);
        if (toggle) renderToggle(toggle, viewed, collapsed, hunk.rows.length);
      });

      // Rows of ours left before lines that are no longer a collapsed block's
      file.root.querySelectorAll(`.${BLOCK_PLACEHOLDER}`).forEach((row) => {
        if (!row.nextElementSibling?.hasAttribute("data-mrflow-block-collapsed")) row.remove();
      });

      // A collapsed file shows no lines: keep what it showed last
      if (file.hunks.length > 0) progress.set(file.id, { viewed: viewedCount, total: file.hunks.length });
      renderFileProgress(file, progress.get(file.id), added);

      const allViewed = file.hunks.length > 0 && viewedCount === file.hunks.length;
      if (allViewed && file.viewed && !file.viewed.checked && !file.viewed.disabled) {
        syncing = true;
        file.viewed.click();
        syncing = false;
      }
    };

    // A block's checkbox on its first line, and while it is viewed and collapsed, a row of ours before it
    const renderBlock = (rows: HTMLElement[], id: string, show: boolean, viewed: boolean, hunkCollapsed: boolean) => {
      const first = rows[0];
      if (!first) return;
      let control = first.querySelector<HTMLElement>(`:scope > .${BLOCK_CONTROL}`);
      const collapsed = show && collapse && viewed && !hunkCollapsed && !expanded.has(id);
      hunkSpan({ rows }).forEach((row) => setFlag(row, "data-mrflow-block-collapsed", collapsed));
      setFlag(first, "data-mrflow-block-start", show);
      if (!show) {
        control?.remove();
        return;
      }

      const rerender = (owner: Element) => {
        const root = diffFileRoot(owner);
        if (root) renderFile(readDiffFile(root));
        renderSummary();
      };
      const toggleBlock = (owner: Element, checked: boolean) => {
        const blockId = blockOf.get(owner) ?? "";
        setMarks([blockId], checked);
        if (!checked) expanded.delete(blockId);
        rerender(owner);
      };
      if (!control) {
        control = document.createElement(first.tagName === "TR" ? "td" : "div");
        control.className = BLOCK_CONTROL;
        const owner = control;
        // A viewed block shown again: collapsed again from here
        if (collapse) {
          control.appendChild(
            toggleButton(() => {
              expanded.delete(blockOf.get(owner) ?? "");
              rerender(owner);
            }),
          );
        }
        const box = checkbox("", { onChange: (checked) => toggleBlock(owner, checked) });
        box.input.setAttribute("aria-label", "Viewed");
        box.input.title = "Viewed";
        control.appendChild(box.root);
        first.appendChild(control);
        added.add(control);
      }
      blockOf.set(control, id);
      const input = control.querySelector("input");
      if (input) input.checked = viewed;
      const blockToggle = control.querySelector<HTMLButtonElement>(`.${TOGGLE}`);
      if (blockToggle) renderToggle(blockToggle, viewed, false, rows.length);

      let placeholder = first.previousElementSibling;
      if (!placeholder?.classList.contains(BLOCK_PLACEHOLDER)) placeholder = null;
      if (!collapsed) {
        placeholder?.remove();
        return;
      }
      if (!placeholder) {
        const row = document.createElement(first.tagName === "TR" ? "tr" : "div");
        row.className = BLOCK_PLACEHOLDER;
        const cell = document.createElement(first.tagName === "TR" ? "td" : "div");
        cell.className = `${BLOCK_PLACEHOLDER}-control`;
        // Laid out as a hunk header: the button and the checkbox at the right end
        const toggle = toggleButton(() => {
          expanded.add(blockOf.get(row) ?? "");
          rerender(row);
        });
        const box = checkbox("Viewed", { checked: true, onChange: (checked) => toggleBlock(row, checked) });
        cell.append(toggle, box.root);
        row.appendChild(cell);
        first.before(row);
        added.add(row);
        placeholder = row;
      }
      blockOf.set(placeholder, id);
      const toggle = placeholder.querySelector<HTMLButtonElement>(`.${TOGGLE}`);
      if (toggle) renderToggle(toggle, true, true, rows.length);
    };

    const renderSummary = () => {
      for (const { row, fileId } of diffTreeRows()) {
        const shown = progress.get(fileId);
        let el = row.querySelector<HTMLElement>(`:scope > .${TREE_PROGRESS}`);
        if (!shown) {
          el?.remove();
          continue;
        }
        if (!el) {
          el = document.createElement("span");
          el.className = `${TREE_PROGRESS} gl-ml-2 gl-shrink-0 gl-text-sm`;
          row.appendChild(el);
          added.add(el);
        }
        const text = `${shown.viewed}/${shown.total}`;
        if (el.textContent !== text) el.textContent = text;
        el.title = `${shown.viewed} of ${shown.total} hunks viewed`;
        el.toggleAttribute("data-mrflow-done", shown.viewed === shown.total);
      }
      renderHunksLeft(progress, added);
    };

    const renderAll = () => {
      diffFiles().forEach(renderFile);
      renderSummary();
    };

    // GitLab's Viewed checkbox of a file, ticked or unticked by the user
    document.addEventListener(
      "change",
      (event) => {
        if (syncing || !isDiffFileViewedCheckbox(event.target)) return;
        const root = diffFileRoot(event.target);
        if (!root) return;
        const file = readDiffFile(root);
        const ids = idsOf(file).flat();
        if (event.target.checked) setMarks(ids, true);
        else {
          setMarks(ids, false);
          // Shown again only after GitLab expands the file
          if (ids.length === 0) pendingUnmark.add(file.id);
        }
        renderFile(file);
        renderSummary();
      },
      { signal: ctx.signal },
    );

    if (ctx.settings.hunkHotkeys) {
      document.addEventListener(
        "keydown",
        (event) => {
          if (!event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
          // By key position, so that it works on any keyboard layout
          const step = event.code === "BracketRight" ? 1 : event.code === "BracketLeft" ? -1 : 0;
          if (step === 0) return;
          const target = nextUnviewed(step);
          if (!target) return;
          event.preventDefault();
          const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
          target.scrollIntoView({ block: "center", behavior: smooth ? "smooth" : "auto" });
          target.animate(
            [
              { boxShadow: "inset 0 0 0 2px var(--gl-focus-ring-outer-color, #1f75cb)" },
              { boxShadow: "inset 0 0 0 2px transparent" },
            ],
            { duration: 1200, easing: "ease-out" },
          );
        },
        { signal: ctx.signal },
      );
    }

    watchHunkMarks(
      key,
      (changed) => {
        marks = changed;
        renderAll();
      },
      ctx.signal,
    );

    // One pass per frame over the files the changes touched; our own additions settle in one more pass
    const dirty = new Set<HTMLElement>();
    let scheduled = 0;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const root = diffFileRoot(record.target);
        if (root) dirty.add(root);
        else record.addedNodes.forEach((node) => diffFileRootsIn(node).forEach((r) => dirty.add(r)));
      }
      scheduled ||= requestAnimationFrame(() => {
        scheduled = 0;
        const roots = [...dirty].filter((root) => root.isConnected);
        dirty.clear();
        roots.forEach((root) => renderFile(readDiffFile(root)));
        renderSummary();
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    renderAll();

    ctx.onCleanup(() => {
      observer.disconnect();
      cancelAnimationFrame(scheduled);
      added.forEach((el) => el.remove());
      for (const attr of [
        "data-mrflow-hunk-header",
        "data-mrflow-hunk-viewed",
        "data-mrflow-hunk-collapsed",
        "data-mrflow-block-start",
        "data-mrflow-block-collapsed",
      ])
        document.querySelectorAll(`[${attr}]`).forEach((el) => el.removeAttribute(attr));
    });
  },
};

function setFlag(element: Element, name: string, on: boolean) {
  if (element.hasAttribute(name) !== on) element.toggleAttribute(name, on);
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

// The next (step 1) or previous (-1) hunk header or block line not viewed, from the middle of the
// window, where the last one gone to was put. A hunk with block checkboxes is gone through by block.
function nextUnviewed(step: 1 | -1): HTMLElement | null {
  const middle = window.innerHeight / 2;
  const selector = `.${CONTROL}:not([data-mrflow-has-blocks]), .${BLOCK_CONTROL}`;
  const headers = [...document.querySelectorAll<HTMLElement>(selector)]
    .filter((control) => !control.querySelector<HTMLInputElement>("input[type=checkbox]")?.checked)
    .map((control) => control.parentElement)
    .filter((header): header is HTMLElement => header !== null);
  const top = (header: HTMLElement) => header.getBoundingClientRect().top;
  return step === 1
    ? (headers.find((header) => top(header) > middle + 1) ?? null)
    : (headers.reverse().find((header) => top(header) < middle - 1) ?? null);
}

// A viewed hunk's or block's button: "> N lines" while collapsed, "v N lines" while shown
function renderToggle(toggle: HTMLButtonElement, viewed: boolean, collapsed: boolean, lines: number) {
  toggle.hidden = !viewed;
  const label = collapsed ? "Show lines" : "Hide lines";
  toggle.setAttribute("aria-expanded", String(!collapsed));
  toggle.setAttribute("aria-label", `${label} (${lines})`);
  toggle.title = label;
  const count = toggle.querySelector(".gl-button-text");
  const text = lines === 1 ? "1 line" : `${lines} lines`;
  if (count && count.textContent !== text) count.textContent = text;
  const use = toggle.querySelector("use");
  const icon = collapsed ? "chevron-right" : "chevron-down";
  if (use && !use.getAttribute("href")?.endsWith(`#${icon}`))
    use.setAttribute("href", use.getAttribute("href")?.replace(/#.*$/, `#${icon}`) ?? "");
}

// Pajamas tertiary button that shows or hides a viewed hunk's or block's lines
function toggleButton(onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `${TOGGLE} gl-button btn btn-sm btn-default btn-default-tertiary gl-mr-2`;
  button.hidden = true;
  // How many lines it hides, while collapsed
  const count = document.createElement("span");
  count.className = "gl-button-text";
  button.appendChild(count);
  prependIcon(button, "chevron-down");
  button.addEventListener("click", onClick);
  return button;
}

// "N left" next to the Changes tab's file count: hunks not viewed in the files shown so far
function renderHunksLeft(progress: Map<string, Progress>, added: Set<Element>) {
  const link = changesTabLink();
  let el = link?.querySelector<HTMLElement>(`.${LEFT}`) ?? null;
  if (!link || progress.size === 0) {
    el?.remove();
    return;
  }
  const left = [...progress.values()].reduce((sum, { viewed, total }) => sum + total - viewed, 0);
  if (!el) {
    el = badge("", "", "neutral");
    el.classList.add(LEFT, "gl-ml-1");
    link.appendChild(el);
    added.add(el);
  }
  const text = left === 0 ? "all viewed" : `${left} left`;
  if (el.textContent !== text) el.textContent = text;
  el.title = left === 0 ? "Every hunk viewed" : `${left} hunks not viewed yet`;
  el.classList.toggle("badge-success", left === 0);
  el.classList.toggle("badge-neutral", left > 0);
}

// Block ids of each hunk of a file
function idsOf(file: DiffFile, path = file.path): string[][] {
  const ids = blockIds(
    path,
    file.hunks.flatMap((hunk) => hunk.blocks),
  );
  let next = 0;
  return file.hunks.map((hunk) => ids.slice(next, (next += hunk.blocks.length)));
}

// "2/3 hunks" in the file header, next to GitLab's Viewed checkbox
function renderFileProgress(file: DiffFile, shown: Progress | undefined, added: Set<Element>) {
  let el = file.root.querySelector<HTMLElement>(`.${FILE_PROGRESS}`);
  if (!shown || !file.headerSlot) {
    el?.remove();
    return;
  }
  const done = shown.viewed === shown.total;
  const variant = done ? "success" : "neutral";
  if (!el) {
    el = badge("", "", variant);
    el.classList.add(FILE_PROGRESS, "gl-mr-3");
    file.headerSlot.parent.insertBefore(el, file.headerSlot.before);
    added.add(el);
  }
  const text = `${shown.viewed}/${shown.total} hunks`;
  if (el.textContent !== text) el.textContent = text;
  el.title = `${shown.viewed} of ${shown.total} hunks viewed`;
  el.classList.toggle("badge-success", done);
  el.classList.toggle("badge-neutral", !done);
}

// Where the hunk's checkbox goes: GitLab's "@@" row, or for the hunk at the top of a file, which has
// none, a row of ours put before its first line (a <tr> in Rapid Diffs' table, a <div> in the Vue grid)
function hunkHost(hunk: DiffHunk, added: Set<Element>): HTMLElement | null {
  if (hunk.header) {
    if (!hunk.header.hasAttribute("data-mrflow-hunk-header")) hunk.header.setAttribute("data-mrflow-hunk-header", "");
    return hunk.header;
  }
  let first: Element | undefined = hunk.rows[0];
  if (!first) return null;
  // A collapsed first block puts its row of ours between this header and the hunk's first line
  while (first.previousElementSibling?.classList.contains(BLOCK_PLACEHOLDER)) first = first.previousElementSibling;
  const previous = first.previousElementSibling;
  if (previous instanceof HTMLElement && previous.classList.contains(HEADER)) return previous;
  const header = document.createElement(first.tagName === "TR" ? "tr" : "div");
  header.className = HEADER;
  first.before(header);
  added.add(header);
  return header;
}
