// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Route } from "@/core/router";
import { fakeApi, featureContext, mrList, node, styledElements } from "@/test/fixtures";
import { mrListFeature } from ".";

type MrListRoute = Extract<Route, { kind: "mr-list" }>;

const nodes = {
  1: node(1, { approvedBy: { nodes: [{ id: "gid://gitlab/User/7" }] } }),
  2: node(2, { conflicts: true }),
  3: node(3, { draft: true }),
  4: node(4),
};

const column = (name: string) =>
  [...document.querySelectorAll(`[data-column="${name}"] .mr-card [data-testid='issuable-title-link']`)].map(
    (a) => a.textContent,
  );

describe("MR list", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("lays out the board in list order and decorates the cards", async () => {
    document.body.innerHTML = mrList(4);
    const { ctx } = featureContext<MrListRoute>("/g/p/-/merge_requests", fakeApi(nodes));
    await mrListFeature.mount(ctx);

    expect(column("To Review")).toEqual(["MR 2", "MR 3", "MR 4"]);
    expect(column("Approved")).toEqual(["MR 1"]);
    expect(document.querySelector("[data-column='To Review'] .kanban-count")?.textContent).toBe(" (3)");
    const conflicts = document.querySelector("[data-column='To Review'] .mr-card .mrflow-banner-action");
    expect(conflicts?.textContent).toBe("CONFLICTS");
    expect(conflicts?.querySelector("use")?.getAttribute("href")).toBe("/assets/icons-abc.svg#warning-solid");
    expect(document.querySelector("[data-column='Approved'] .mrflow-approvals-badge")?.textContent).toBe("1/2");
    expect(document.querySelector(".mrflow-loading")).toBeNull();
    expect(document.querySelector("#app > ul")?.classList.contains("mrflow-offscreen")).toBe(true);
  });

  it("sets no inline styles and restores the native list on unmount", async () => {
    document.body.innerHTML = mrList(4);
    const before = document.body.innerHTML;
    const { ctx, unmount } = featureContext<MrListRoute>("/g/p/-/merge_requests", fakeApi(nodes));
    await mrListFeature.mount(ctx);
    expect(styledElements()).toEqual([]);

    unmount();
    expect(document.querySelector(".kanban-board")).toBeNull();
    expect(document.body.innerHTML.replace(/ class=""/g, "")).toBe(before.replace(/ class=""/g, ""));
  });

  it("decorates the native list when the board is off, and cleans up", async () => {
    document.body.innerHTML = mrList(2);
    const { ctx, unmount } = featureContext<MrListRoute>("/g/p/-/merge_requests", fakeApi(nodes), {
      kanbanView: false,
    });
    await mrListFeature.mount(ctx);
    expect(document.querySelector(".kanban-board")).toBeNull();
    expect(document.querySelector("li.merge-request")?.classList.contains("greened")).toBe(true);

    unmount();
    expect(document.querySelector(".mrflow-approvals-badge, .kanban-badges, .greened")).toBeNull();
  });

  it("shows the native list for closed and merged MRs", async () => {
    document.body.innerHTML = mrList(1);
    const { ctx } = featureContext<MrListRoute>("/g/p/-/merge_requests?state=merged", fakeApi(nodes));
    await mrListFeature.mount(ctx);
    expect(document.querySelector(".kanban-board")).toBeNull();
  });
});
