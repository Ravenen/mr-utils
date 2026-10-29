import { mergeRequestItemPath, mergeRequestItems, mergeRequestList } from "@/core/gitlab/dom";
import { loadMergeRequestsData, type MrData } from "@/core/gitlab/merge-requests";
import type { Feature, FeatureContext } from "@/core/lifecycle";
import type { Route } from "@/core/router";
import { readMrRecord, type MrRef } from "@/core/storage/mr-records";
import { showApiError } from "@/ui/alert";
import { waitFor } from "@/utils/async";
import { createBoard, type ColumnId } from "./board";
import { clearDecorations, decorateMergeRequest } from "./decorate";

type MrListRoute = Extract<Route, { kind: "mr-list" }>;

interface Item extends MrRef {
  key: string;
  element: HTMLElement;
}

const CARD_MOVE_MS = 400;
const CARD_SHIFT_MS = 250;

// MR list: a Kanban board laid over the native list, or badges and banners on the native items
export const mrListFeature: Feature<MrListRoute> = {
  name: "mr-list",
  match: (route): route is MrListRoute => route.kind === "mr-list",
  async mount(ctx) {
    // The board only makes sense for open MRs
    const state = ctx.route.url.searchParams.get("state");
    const kanban = ctx.settings.kanbanView && (state === null || state === "opened");

    // Wait for MR items to appear (an empty list never gets any, hence the timeout)
    const first = await waitFor(() => mergeRequestItems()[0], { signal: ctx.signal });
    const list = first && mergeRequestList(first);
    if (!list || ctx.signal.aborted) return;

    const onError = (error: unknown) => {
      if (ctx.signal.aborted) return;
      const anchor = list.previousElementSibling?.matches(".mrflow-board-header") ? list.previousElementSibling : list;
      const alert = showApiError(anchor, error);
      if (alert) ctx.onCleanup(() => alert.remove());
    };

    if (kanban) await mountBoard(ctx, list, onError);
    else await decorateNativeList(ctx, list, onError);
  },
};

// The MR items currently in the list. GitLab may re-create them at any time, so they are looked up
// again after every change of the list and matched to their data by key.
function readItems(list: HTMLElement): Item[] {
  return mergeRequestItems(list).flatMap((element) => {
    const href = mergeRequestItemPath(element);
    const matches = href && new URL(href, location.origin).pathname.match(/^\/(.*?)\/-\/merge_requests\/(\d+)/);
    if (!matches?.[1] || !matches[2]) return [];
    return [{ key: `${matches[1]}#${matches[2]}`, element, projectPath: matches[1], mrIid: matches[2] }];
  });
}

// Calls onChange when GitLab adds, removes or re-creates items of the list
function watchList(ctx: FeatureContext, list: HTMLElement, onChange: () => void) {
  const observer = new MutationObserver(() => {
    if (!ctx.signal.aborted) onChange();
  });
  observer.observe(list, { childList: true });
  ctx.onCleanup(() => observer.disconnect());
}

// Native list view: decorate the native items once all details are in
async function decorateNativeList(ctx: FeatureContext, list: HTMLElement, onError: (error: unknown) => void) {
  let items = readItems(list);
  const data = new Map<string, MrData>();
  const decorate = (item: Item) => {
    const mrData = data.get(item.key);
    if (mrData) decorateMergeRequest(item.element, mrData, { highlightApproved: true });
  };
  ctx.onCleanup(() => readItems(list).forEach((item) => clearDecorations(item.element)));

  await loadMergeRequestsData(ctx, items, {
    onError,
    onUpdate: (updates) => updates.forEach(([item, mrData]) => data.set(item.key, mrData)),
  });
  if (ctx.signal.aborted) return;
  items = readItems(list);
  items.forEach(decorate);
  watchList(ctx, list, () => readItems(list).forEach(decorate));
}

function columnOf(mrData: MrData | null | undefined): ColumnId {
  if (mrData?.hasUserApproved) return "approved";
  if (mrData && mrData.unresolvedUserThreads > 0) return "pending";
  return "review";
}

// Kanban over the native list. Stage 1 lays the board out from what was last seen; stages 2 and 3
// (the API) move the items between columns.
async function mountBoard(ctx: FeatureContext, list: HTMLElement, onError: (error: unknown) => void) {
  const board = createBoard(list);
  ctx.onCleanup(() => {
    board.destroy();
    readItems(list).forEach((item) => clearDecorations(item.element));
  });

  let items = readItems(list);
  // Latest data per MR: the stored record first, then what the API returns
  const data = new Map<string, MrData | null>();
  const remember = (item: Item) => {
    if (!data.has(item.key)) data.set(item.key, readMrRecord(ctx.userId, item)?.mrData ?? null);
  };

  const render = (item: Item) => {
    const mrData = data.get(item.key);
    const column = columnOf(mrData);
    board.place(item.element, column);
    if (mrData) decorateMergeRequest(item.element, mrData, { showSeenBanners: column !== "review" });
    else clearDecorations(item.element);
    board.track(item.element);
  };

  // FLIP: remember where every item is, apply the change, then slide each moved item from its old place.
  // Covers items changing columns and the items that shift to fill the gap.
  const animateMoves = (applyChange: () => void) => {
    const animate = ctx.settings.animateCards && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const before = animate
      ? new Map(
          items.map((item) => [
            item.element,
            { rect: item.element.getBoundingClientRect(), column: item.element.dataset.mrflowColumn },
          ]),
        )
      : null;
    applyChange();
    if (!before) return;

    for (const { element } of items) {
      const from = before.get(element);
      if (!from) continue;
      const to = element.getBoundingClientRect();
      const dx = from.rect.left - to.left;
      const dy = from.rect.top - to.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;

      // Items changing columns travel above the others
      const changesColumn = from.column !== element.dataset.mrflowColumn;
      if (changesColumn) element.dataset.mrflowMoving = "";
      const animation = element.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }],
        { duration: changesColumn ? CARD_MOVE_MS : CARD_SHIFT_MS, easing: "cubic-bezier(0.2, 0, 0, 1)" },
      );
      animation.onfinish = animation.oncancel = () => delete element.dataset.mrflowMoving;
    }
  };

  let loading = 0;
  const load = async (toLoad: Item[]) => {
    if (toLoad.length === 0) return;
    board.setLoading(++loading > 0);
    try {
      await loadMergeRequestsData(ctx, toLoad, {
        onError,
        progressive: ctx.settings.boardLoading === "progressive",
        onUpdate: (updates) =>
          animateMoves(() => {
            updates.forEach(([item, mrData]) => data.set(item.key, mrData));
            const updated = new Set(updates.map(([item]) => item.key));
            items.filter((item) => updated.has(item.key)).forEach(render);
            board.updateCounts();
          }),
      });
    } finally {
      if (!ctx.signal.aborted) board.setLoading(--loading > 0);
    }
  };

  // Stage 1: lay the board out right away from what was last seen for each MR (if anything)
  items.forEach(remember);
  items.forEach(render);
  board.updateCounts();

  // GitLab re-rendered the list: place the new or re-created items, load MRs not seen in this mount
  watchList(ctx, list, () => {
    items = readItems(list);
    const fresh = items.filter((item) => !data.has(item.key));
    fresh.forEach(remember);
    items.filter((item) => item.element.dataset.mrflowColumn === undefined).forEach(render);
    board.updateCounts();
    void load(fresh);
  });

  // Stages 2 and 3: details from the API; updates come per batch or, by default, once per stage
  await load(items);
}
