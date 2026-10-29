// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { mrList, mrPage } from "@/test/fixtures";
import {
  approvalsWidget,
  iconSpriteUrl,
  isRevokeApprovalButton,
  itemCommentsBadge,
  itemControls,
  mergeRequestItemPath,
  mergeRequestItems,
  mergeSection,
} from "./dom";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("MR list", () => {
  it("finds the items and their parts", () => {
    document.body.innerHTML = mrList(2);
    const items = mergeRequestItems();
    expect(items).toHaveLength(2);
    expect(mergeRequestItemPath(items[0] as Element)).toBe("/g/p/-/merge_requests/1");
    const controls = itemControls(items[0] as Element) as Element;
    expect(itemCommentsBadge(controls)?.dataset.testid).toBe("issuable-comments");
    expect(iconSpriteUrl()).toBe("/assets/icons-abc.svg");
  });

  it("finds the comments badge in the older markup", () => {
    document.body.innerHTML = mrList(1, { legacyComments: true });
    const controls = itemControls(mergeRequestItems()[0] as Element) as Element;
    expect(itemCommentsBadge(controls)?.parentElement).toBe(controls);
  });

  it("looks for items inside the given root", () => {
    document.body.innerHTML = `${mrList(2)}<div id="other">${mrList(1)}</div>`;
    expect(mergeRequestItems()).toHaveLength(3);
    expect(mergeRequestItems(document.getElementById("other") as HTMLElement)).toHaveLength(1);
  });
});

describe("MR page", () => {
  it("finds the approvals widget's content, its approve button and the merge section", () => {
    document.body.innerHTML = mrPage();
    const widget = approvalsWidget();
    expect(widget?.button?.textContent).toBe("Approve");
    expect(widget?.content.parentElement?.classList.contains("media-body")).toBe(true);
    expect(mergeSection()?.querySelector("[data-testid='mr-widget-content']")).not.toBeNull();
  });

  it("finds the widget without an approve button, and never takes its collapse button", () => {
    document.body.innerHTML = mrPage({ canApprove: false });
    const widget = approvalsWidget();
    expect(widget?.button).toBeNull();
    expect(widget?.content.parentElement?.classList.contains("media-body")).toBe(true);
  });

  it("waits while the approvals widget is loading", () => {
    document.body.innerHTML = mrPage({ loading: true });
    expect(approvalsWidget()).toBeNull();
    document.body.innerHTML = `<div class="js-mr-approvals">Checking approval status <button>Expand</button></div>`;
    expect(approvalsWidget()).toBeNull();
  });

  it("tells Approve from Revoke approval without reading the text", () => {
    document.body.innerHTML = mrPage({ revoke: true });
    const button = approvalsWidget()?.button as Element;
    button.textContent = "Скасувати схвалення";
    expect(isRevokeApprovalButton(button)).toBe(true);
    document.body.innerHTML = mrPage();
    expect(isRevokeApprovalButton(approvalsWidget()?.button as Element)).toBe(false);
  });

  it("falls back to the older markup", () => {
    document.body.innerHTML = mrPage({ legacy: true, revoke: true });
    const widget = approvalsWidget();
    expect(isRevokeApprovalButton(widget?.button as Element)).toBe(true);
    expect(widget?.content.classList.contains("state-container")).toBe(true);
  });
});
