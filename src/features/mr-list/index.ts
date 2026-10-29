import { loadMergeRequestsData, type MrData } from "@/core/gitlab/merge-requests";
import type { Feature, FeatureContext } from "@/core/lifecycle";
import type { Route } from "@/core/router";
import type { MrRef } from "@/core/storage/mr-records";
import { readMrRecord } from "@/core/storage/mr-records";
import { itemMeta, mergeRequestItemPath, mergeRequestItems, mergeRequestList } from "@/core/gitlab/dom";
import { showApiError } from "@/ui/alert";
import { spinner } from "@/ui/spinner";
import { waitFor } from "@/utils/async";
import { DECORATION_CLASSES, DECORATION_SELECTOR, decorateMergeRequest } from "./decorate";

type MrListRoute = Extract<Route, { kind: "mr-list" }>;
type ColumnName = "To Review" | "Pending" | "Approved";
type Columns = Record<ColumnName, HTMLElement>;

interface Item extends MrRef {
  index: number;
  mrElement: HTMLElement;
}

const COLUMN_NAMES: ColumnName[] = ["To Review", "Pending", "Approved"];
const CARD_MOVE_MS = 400;
const CARD_SHIFT_MS = 250;

// MR list: a Kanban board over the native list, or badges and banners on the native items
export const mrListFeature: Feature<MrListRoute> = {
  name: "mr-list",
  match: (route): route is MrListRoute => route.kind === "mr-list",
  async mount(ctx) {
    // The board only makes sense for open MRs
    const state = ctx.route.url.searchParams.get("state");
    const kanban = ctx.settings.kanbanView && (state === null || state === "opened");

    // Wait for MR elements to appear (an empty list never gets any, hence the timeout)
    const elements = await waitFor(
      () => {
        const found = mergeRequestItems(".kanban-board");
        return found.length > 0 ? found : null;
      },
      { signal: ctx.signal },
    );
    if (!elements || ctx.signal.aborted) return;

    const items = collectItems(elements);
    const listContainer = elements[0] ? mergeRequestList(elements[0]) : null;
    const onError = (error: unknown) => {
      if (ctx.signal.aborted) return;
      const alert = showApiError(document.querySelector(".kanban-board") ?? listContainer, error);
      if (alert) ctx.onCleanup(() => alert.remove());
    };

    if (kanban) await mountBoard(ctx, items, listContainer, onError);
    else await decorateNativeList(ctx, items, onError);
  },
};

function collectItems(elements: HTMLElement[]): Item[] {
  const items: Item[] = [];
  elements.forEach((mrElement, index) => {
    const href = mergeRequestItemPath(mrElement);
    if (!href) return;
    const matches = new URL(href, location.origin).pathname.match(/^\/(.*?)\/-\/merge_requests\/(\d+)/);
    if (!matches?.[1] || !matches[2]) return;
    items.push({ index, mrElement, projectPath: matches[1], mrIid: matches[2] });
  });
  return items;
}

// Native list view: decorate the native items once all details are in
async function decorateNativeList(ctx: FeatureContext, items: Item[], onError: (error: unknown) => void) {
  const dataByItem = new Map<Item, MrData>();
  await loadMergeRequestsData(ctx, items, {
    onError,
    onUpdate: (updates) => updates.forEach(([item, mrData]) => dataByItem.set(item, mrData)),
  });
  if (ctx.signal.aborted) return;
  dataByItem.forEach((mrData, item) => {
    decorateMergeRequest(item.mrElement, mrData);
    if (mrData.hasUserApproved && !mrData.isDraft) item.mrElement.classList.add("greened");
  });
  ctx.onCleanup(() =>
    items.forEach(({ mrElement }) => {
      mrElement.querySelectorAll(DECORATION_SELECTOR).forEach((el) => el.remove());
      mrElement.classList.remove(...DECORATION_CLASSES);
    }),
  );
}

// Kanban: cards are clones of the native items, the native list is moved off screen.
// Stage 1 lays the board out from what was last seen; stages 2 and 3 (the API) move the cards.
async function mountBoard(
  ctx: FeatureContext,
  items: Item[],
  listContainer: HTMLElement | null,
  onError: (error: unknown) => void,
) {
  if (!listContainer?.parentNode) {
    console.error("MRFlow: cannot find the merge requests list container element.");
    return;
  }

  // A board left by an older mount must not stay (mounting is idempotent)
  document.querySelectorAll(".kanban-board").forEach((el) => el.remove());
  const { board, columns } = createBoard();
  listContainer.parentNode.insertBefore(board, listContainer);
  // Off screen rather than display:none, so that GitLab keeps rendering it and we can clone the items
  listContainer.classList.add("mrflow-offscreen");
  ctx.onCleanup(() => {
    board.remove();
    listContainer.classList.remove("mrflow-offscreen");
  });

  // Put a decorated clone of the native item into its column, replacing the item's previous card.
  // Cards keep the order of the native list.
  const cards = new Map<Item, HTMLElement>();
  const renderCard = (item: Item, mrData: MrData | null) => {
    const card = item.mrElement.cloneNode(true) as HTMLElement;
    card.classList.add("mr-card");
    card.classList.remove("!gl-flex");
    card.dataset.mrflowIndex = String(item.index);
    // Remove all classes except 'issuable-meta' to fix styling issues
    const metaEl = itemMeta(card);
    if (metaEl) metaEl.className = "issuable-meta";
    const columnName = getColumnName(mrData);
    if (mrData) decorateMergeRequest(card, mrData, { showSeenBanners: columnName !== "To Review" });
    cards.get(item)?.remove();
    cards.set(item, card);
    const column = columns[columnName];
    const next = [...column.children].find((el) => Number((el as HTMLElement).dataset.mrflowIndex) > item.index);
    column.insertBefore(card, next ?? null);
  };

  // FLIP: remember where every card is, apply the change, then slide each moved card from its old place.
  // Covers cards changing columns and the cards that shift to fill the gap.
  const animateCardMoves = (applyChange: () => void) => {
    const before = new Map(
      [...cards].map(([item, card]) => [item, { rect: card.getBoundingClientRect(), column: card.parentElement }]),
    );
    applyChange();
    if (!ctx.settings.animateCards || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    cards.forEach((card, item) => {
      const from = before.get(item);
      if (!from) return;
      const to = card.getBoundingClientRect();
      const dx = from.rect.left - to.left;
      const dy = from.rect.top - to.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;

      // Cards changing columns travel above the others
      const changesColumn = from.column !== card.parentElement;
      if (changesColumn) card.classList.add("mrflow-card-moving");
      const animation = card.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }], {
        duration: changesColumn ? CARD_MOVE_MS : CARD_SHIFT_MS,
        easing: "cubic-bezier(0.2, 0, 0, 1)",
      });
      animation.onfinish = animation.oncancel = () => card.classList.remove("mrflow-card-moving");
    });
  };

  // Stage 1: lay the board out right away from what was last seen for each MR (if anything)
  items.forEach((item) => renderCard(item, readMrRecord(ctx.userId, item)?.mrData ?? null));
  updateColumnCounts(columns);
  setColumnsLoading(columns, true);

  // Stages 2 and 3: details from the API; updates come per batch or, by default, once per stage
  await loadMergeRequestsData(ctx, items, {
    onError,
    progressive: ctx.settings.boardLoading === "progressive",
    onUpdate: (updates) =>
      animateCardMoves(() => {
        updates.forEach(([item, mrData]) => renderCard(item, mrData));
        updateColumnCounts(columns);
      }),
  });
  if (!ctx.signal.aborted) setColumnsLoading(columns, false);
}

function createBoard(): { board: HTMLElement; columns: Columns } {
  const board = document.createElement("div");
  board.classList.add("kanban-board");
  const columns = {} as Columns;
  COLUMN_NAMES.forEach((columnName) => {
    const column = document.createElement("div");
    column.classList.add("kanban-column");
    column.dataset.column = columnName;

    const header = document.createElement("div");
    header.classList.add("kanban-column-header");
    header.textContent = columnName;

    const body = document.createElement("ul");
    body.classList.add("content-list", "mr-list", "issuable-list", "kanban-column-body");

    column.appendChild(header);
    column.appendChild(body);
    board.appendChild(column);
    columns[columnName] = body;
  });
  return { board, columns };
}

function getColumnName(mrData: MrData | null): ColumnName {
  if (mrData?.hasUserApproved) return "Approved";
  if (mrData && mrData.unresolvedUserThreads > 0) return "Pending";
  return "To Review";
}

function columnHeader(column: HTMLElement): HTMLElement | null {
  return column.parentElement?.querySelector(".kanban-column-header") ?? null;
}

// MR count in each column header
function updateColumnCounts(columns: Columns) {
  Object.values(columns).forEach((column) => {
    const header = columnHeader(column);
    if (!header) return;
    let countElement = header.querySelector(".kanban-count");
    if (!countElement) {
      countElement = document.createElement("span");
      countElement.classList.add("kanban-count");
      header.appendChild(countElement);
    }
    countElement.textContent = ` (${column.querySelectorAll(".mr-card").length})`;
  });
}

// Small native GitLab spinner in the column headers while details are still loading
function setColumnsLoading(columns: Columns, isLoading: boolean) {
  Object.values(columns).forEach((column) => {
    const header = columnHeader(column);
    if (!header) return;
    header.querySelector(".mrflow-loading")?.remove();
    if (!isLoading) return;
    header.appendChild(spinner());
  });
}
