// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeApi, featureContext, mrPage, node, styledElements } from "@/test/fixtures";
import { approvalGuardFeature } from "./approval-guard";
import type { MrPageRoute } from "./seen-state";

const MR = "/g/p/-/merge_requests/1";
const approve = () => document.querySelector("[data-testid='approve-button']") as HTMLElement;
const merge = () => document.querySelector(".mr-widget-body-ready-merge")?.closest(".mr-section-container");
const hidden = (el: Element | null | undefined) => el?.classList.contains("mrflow-hidden");
const tick = (id: string) => (document.getElementById(`mrflow-${id}`) as HTMLInputElement).click();

async function mount(options: { revoke?: boolean; approved?: boolean } = {}) {
  if (!document.body.innerHTML) document.body.innerHTML = mrPage({ revoke: options.revoke });
  const approvedBy = options.approved ? { nodes: [{ id: "gid://gitlab/User/7" }] } : { nodes: [] };
  const { ctx, unmount } = featureContext<MrPageRoute>(MR, fakeApi({ 1: node(1, { approvedBy }) }));
  await approvalGuardFeature.mount(ctx);
  return unmount;
}

describe("approval guard", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("hides Approve and Merge until every check is ticked", async () => {
    await mount();
    expect(document.querySelectorAll(".mrflow-checks .gl-form-checkbox")).toHaveLength(2);
    expect(hidden(approve())).toBe(true);
    expect(hidden(merge())).toBe(true);

    tick("docs_check");
    expect(hidden(approve())).toBe(true);
    tick("branch_check");
    expect(hidden(approve())).toBe(false);
    expect(hidden(merge())).toBe(false);
    expect(JSON.parse(localStorage.getItem(`${MR}/mr-utils`) ?? "{}")).toMatchObject({
      docs_check: true,
      branch_check: true,
      checks_head_sha: "sha1",
    });
  });

  it("guards Merge and sits above the approvals when the user cannot approve", async () => {
    document.body.innerHTML = mrPage({ canApprove: false });
    await mount();
    const checks = document.querySelector(".mrflow-checks");
    expect(checks?.parentElement?.parentElement?.classList.contains("media-body")).toBe(true);
    expect(checks?.nextElementSibling?.querySelector("[data-testid='approvals-summary-content']")).not.toBeNull();
    expect(hidden(document.querySelector("[data-testid='widget-toggle']"))).toBe(false);
    expect(hidden(merge())).toBe(true);
    tick("docs_check");
    tick("branch_check");
    expect(hidden(merge())).toBe(false);
  });

  it("keeps Revoke approval reachable", async () => {
    await mount({ revoke: true });
    expect(hidden(approve())).toBe(false);
    expect(hidden(merge())).toBe(true);
  });

  it("unticks the checks after new commits", async () => {
    localStorage.setItem(
      `${MR}/mr-utils`,
      JSON.stringify({ docs_check: true, branch_check: true, checks_head_sha: "old" }),
    );
    await mount();
    expect((document.getElementById("mrflow-docs_check") as HTMLInputElement).checked).toBe(false);
    expect(hidden(merge())).toBe(true);
  });

  it("sets no inline styles and leaves nothing behind on unmount", async () => {
    document.body.innerHTML = mrPage();
    const before = document.body.innerHTML;
    const unmount = await mount();
    expect(styledElements()).toEqual([]);
    unmount();
    expect(document.body.innerHTML.replace(/ class=""/g, "")).toBe(before.replace(/ class=""/g, ""));
  });
});
