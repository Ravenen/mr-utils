import { spinner } from "@/ui/spinner";

export type ColumnId = "review" | "pending" | "approved";
export const COLUMNS: { id: ColumnId; title: string }[] = [
  { id: "review", title: "To Review" },
  { id: "pending", title: "Pending" },
  { id: "approved", title: "Approved" },
];

// Grid rows are ROW_PX high; a card spans as many as its height plus CARD_GAP_PX needs, so every
// column stacks its cards without the gaps that shared row heights would leave
const ROW_PX = 4;
const CARD_GAP_PX = 10;

export interface Board {
  header: HTMLElement;
  // Put a native item into a column (it stays where it is in the DOM)
  place(item: HTMLElement, column: ColumnId): void;
  // Size the item's row span to its height now, and keep it in step from then on
  track(item: HTMLElement): void;
  updateCounts(): void;
  setLoading(isLoading: boolean): void;
  destroy(): void;
}

// The board is the native <ul> itself, laid out as a three-column grid (see style.css): GitLab keeps
// rendering it, and its popovers, tooltips and links keep working. Column headers sit above it.
export function createBoard(list: HTMLElement): Board {
  const header = document.createElement("div");
  header.className = "mrflow-board-header";
  const columnHeaders = new Map<ColumnId, HTMLElement>();
  for (const { id, title } of COLUMNS) {
    const el = document.createElement("div");
    el.className = "mrflow-column-header";
    el.dataset.column = id;
    const name = document.createElement("span");
    name.textContent = title;
    const count = document.createElement("span");
    count.className = "mrflow-column-count";
    el.append(name, count);
    header.appendChild(el);
    columnHeaders.set(id, el);
  }
  list.insertAdjacentElement("beforebegin", header);
  list.dataset.mrflowBoard = "";

  // Row spans as CSS rules, one per span value in use, instead of inline styles
  const spanStyle = document.createElement("style");
  spanStyle.dataset.mrflow = "board-spans";
  document.head.appendChild(spanStyle);
  const spans = new Set<number>();
  const setSpan = (item: HTMLElement, height: number) => {
    const span = Math.max(1, Math.ceil((height + CARD_GAP_PX) / ROW_PX));
    if (!spans.has(span)) {
      spans.add(span);
      spanStyle.sheet?.insertRule(`[data-mrflow-board] > [data-mrflow-span="${span}"] { grid-row-end: span ${span}; }`);
    }
    item.dataset.mrflowSpan = String(span);
  };
  const resizeObserver =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver((entries) =>
          entries.forEach((entry) => setSpan(entry.target as HTMLElement, entry.borderBoxSize[0]?.blockSize ?? 0)),
        );
  const tracked = new WeakSet<HTMLElement>();

  // The column bodies are drawn by the header cells (style.css): they need the list's height
  const heightRule = spanStyle.sheet?.cssRules[spanStyle.sheet.insertRule(".mrflow-board-header {}")] as
    CSSStyleRule | undefined;
  const setListHeight = () => heightRule?.style.setProperty("--mrflow-list-height", `${list.offsetHeight}px`);
  setListHeight();
  const listObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(setListHeight);
  listObserver?.observe(list);

  return {
    header,
    place(item, column) {
      item.dataset.mrflowColumn = column;
    },
    track(item) {
      setSpan(item, item.getBoundingClientRect().height);
      if (tracked.has(item)) return;
      tracked.add(item);
      resizeObserver?.observe(item);
    },
    updateCounts() {
      for (const [id, el] of columnHeaders) {
        const count = list.querySelectorAll(`:scope > [data-mrflow-column="${id}"]`).length;
        const countEl = el.querySelector(".mrflow-column-count");
        if (countEl) countEl.textContent = ` (${count})`;
      }
    },
    setLoading(isLoading) {
      for (const el of columnHeaders.values()) {
        el.querySelector(".mrflow-loading")?.remove();
        if (isLoading) el.appendChild(spinner());
      }
    },
    destroy() {
      resizeObserver?.disconnect();
      listObserver?.disconnect();
      header.remove();
      spanStyle.remove();
      delete list.dataset.mrflowBoard;
      for (const item of list.querySelectorAll<HTMLElement>("[data-mrflow-column], [data-mrflow-span]")) {
        delete item.dataset.mrflowColumn;
        delete item.dataset.mrflowSpan;
      }
    },
  };
}
