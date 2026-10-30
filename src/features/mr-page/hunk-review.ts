import {
  diffFileRoot,
  diffFileRootsIn,
  diffFiles,
  diffTreeRows,
  isDiffFileViewedCheckbox,
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
import { blockIds } from "@/utils/hunks";
import { loadMrPageData, type MrPageRoute } from "./seen-state";

const CONTROL = "mrflow-hunk-control";
const HEADER = "mrflow-hunk-header";
const FILE_PROGRESS = "mrflow-hunk-progress";
const TREE_PROGRESS = "mrflow-hunk-tree-progress";
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
export const hunkReviewFeature: Feature<MrPageRoute> = {
  name: "hunk-review",
  match: (route): route is MrPageRoute => route.kind === "mr-page",
  settings: ["hunkReview"],
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
          control.appendChild(
            checkbox("Viewed", {
              onChange: (checked) => {
                setMarks(controlIds.get(owner) ?? [], checked);
                const root = diffFileRoot(owner);
                if (root) renderFile(readDiffFile(root));
                renderTree();
              },
            }).root,
          );
          host.appendChild(control);
          added.add(control);
        }
        controlIds.set(control, ids);
        const input = control.querySelector("input");
        if (input) input.checked = viewed;
        hunk.rows.forEach((row) => {
          if (row.hasAttribute("data-mrflow-hunk-viewed") !== viewed)
            row.toggleAttribute("data-mrflow-hunk-viewed", viewed);
        });
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

    const renderTree = () => {
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
    };

    const renderAll = () => {
      diffFiles().forEach(renderFile);
      renderTree();
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
        renderTree();
      },
      { signal: ctx.signal },
    );

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
        renderTree();
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    renderAll();

    ctx.onCleanup(() => {
      observer.disconnect();
      cancelAnimationFrame(scheduled);
      added.forEach((el) => el.remove());
      for (const attr of ["data-mrflow-hunk-header", "data-mrflow-hunk-viewed"])
        document.querySelectorAll(`[${attr}]`).forEach((el) => el.removeAttribute(attr));
    });
  },
};

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
  const first = hunk.rows[0];
  if (!first) return null;
  const previous = first.previousElementSibling;
  if (previous instanceof HTMLElement && previous.classList.contains(HEADER)) return previous;
  const header = document.createElement(first.tagName === "TR" ? "tr" : "div");
  header.className = HEADER;
  first.before(header);
  added.add(header);
  return header;
}
