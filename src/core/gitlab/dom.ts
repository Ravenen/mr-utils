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

// MR items of the native list (HAML and Vue lists both put "merge-request" on the <li>).
// `exclude` leaves out items inside our own containers, e.g. the board's cards.
export function mergeRequestItems(exclude: string, doc: Document = document): HTMLElement[] {
  return [...doc.querySelectorAll<HTMLElement>("li.merge-request")].filter((el) => !el.closest(exclude));
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
  // The row with the Approve / Revoke approval button; our checklist goes before it
  bar: HTMLElement;
  button: HTMLButtonElement;
}

// The approvals widget once it is loaded: null while it shows "Checking approval status" and when
// the user has no approve button (own MR, merged MR, no permission)
export function approvalsWidget(doc: Document = document): ApprovalsWidget | null {
  const widget = doc.querySelector(".js-mr-approvals");
  if (!widget) return null;
  const button =
    widget.querySelector<HTMLButtonElement>("button[data-testid='approve-button']") ??
    // Older markup: the first button, and the widget says when it is still loading
    (widget.textContent?.includes("Checking approval status") ? null : widget.querySelector("button"));
  const bar = button?.parentElement?.parentElement;
  return button && bar ? { bar, button } : null;
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
