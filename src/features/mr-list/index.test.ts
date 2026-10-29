// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Route } from "@/core/router";
import { fakeApi, featureContext, mrList, mrListItem, node, styledElements } from "@/test/fixtures";
import { mrListFeature } from ".";

type MrListRoute = Extract<Route, { kind: "mr-list" }>;

const nodes = {
  1: node(1, { approvedBy: { nodes: [{ id: "gid://gitlab/User/7" }] } }),
  2: node(2, { conflicts: true, resolvableDiscussionsCount: 2, resolvedDiscussionsCount: 1 }),
  3: node(3, { draft: true }),
  4: node(4),
  5: node(5, { approvedBy: { nodes: [{ id: "gid://gitlab/User/7" }] } }),
};

const list = () => document.querySelector("#app > ul") as HTMLElement;
const item = (iid: number) =>
  document.querySelector(`a[href="/g/p/-/merge_requests/${iid}"]`)?.closest("li") as HTMLElement;
const column = (name: string) =>
  [...list().querySelectorAll(`:scope > [data-mrflow-column="${name}"] [data-testid='issuable-title-link']`)].map(
    (a) => a.textContent,
  );
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function mountList(path = "/g/p/-/merge_requests", settings = {}, count = 4) {
  document.body.innerHTML = mrList(count);
  const { ctx, unmount } = featureContext<MrListRoute>(path, fakeApi(nodes), settings);
  await mrListFeature.mount(ctx);
  return unmount;
}

describe("MR list board", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
  });

  it("lays the native items out in columns, in list order, without cloning them", async () => {
    await mountList();
    expect(list().hasAttribute("data-mrflow-board")).toBe(true);
    expect(list().children).toHaveLength(4);
    expect(column("review")).toEqual(["MR 2", "MR 3", "MR 4"]);
    expect(column("approved")).toEqual(["MR 1"]);
    expect([...document.querySelectorAll(".mrflow-column-count")].map((el) => el.textContent)).toEqual([
      " (3)",
      " (0)",
      " (1)",
    ]);
    expect(document.querySelector(".mrflow-loading")).toBeNull();
  });

  it("decorates the native items", async () => {
    await mountList();
    const conflicts = item(2).querySelector(".mrflow-banner-action");
    expect(conflicts?.textContent).toBe("CONFLICTS");
    expect(conflicts?.querySelector("use")?.getAttribute("href")).toBe("/assets/icons-abc.svg#warning-solid");
    expect(item(2).querySelector(".mrflow-badges")?.textContent).toBe("1/2");
    // The native comments count is hidden, not taken from under GitLab's Vue
    expect(item(2).querySelector("[data-testid='issuable-comments']")?.hasAttribute("data-mrflow-replaced")).toBe(true);
    expect(item(1).querySelector(".mrflow-approvals-badge")?.textContent).toBe("1/2");
    expect(item(3).hasAttribute("data-mrflow-draft")).toBe(true);
  });

  it("places items GitLab re-creates or adds, and loads the new MRs", async () => {
    await mountList();
    // GitLab re-renders MR 1 and appends MR 5
    const fresh = document.createElement("template");
    fresh.innerHTML = mrListItem(1) + mrListItem(5);
    item(1).replaceWith(fresh.content.firstElementChild as Element);
    list().appendChild(fresh.content.lastElementChild as Element);
    await settle();
    await settle();

    expect(column("approved")).toEqual(["MR 1", "MR 5"]);
    expect(item(1).querySelector(".mrflow-approvals-badge")?.textContent).toBe("1/2");
    expect(document.querySelector("[data-column='approved'] .mrflow-column-count")?.textContent).toBe(" (2)");
  });

  it("sets no inline styles and restores the native list on unmount", async () => {
    document.body.innerHTML = mrList(4);
    const before = document.body.innerHTML;
    const { ctx, unmount } = featureContext<MrListRoute>("/g/p/-/merge_requests", fakeApi(nodes));
    await mrListFeature.mount(ctx);
    expect(styledElements()).toEqual([]);
    expect(document.head.querySelector("style[data-mrflow]")).not.toBeNull();

    unmount();
    expect(document.body.innerHTML.replace(/ class=""/g, "")).toBe(before.replace(/ class=""/g, ""));
    expect(document.head.querySelector("style[data-mrflow]")).toBeNull();
  });

  it("shows the native list for closed and merged MRs", async () => {
    await mountList("/g/p/-/merge_requests?state=merged", {}, 1);
    expect(list().hasAttribute("data-mrflow-board")).toBe(false);
  });
});

describe("MR list remounted after a settings change", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
  });

  it("turns the board off and on again with the details already loaded, without requests", async () => {
    document.body.innerHTML = mrList(4);
    let requests = 0;
    const api = fakeApi(nodes);
    const counting = {
      ...api,
      graphql: (...args: Parameters<typeof api.graphql>) => (requests++, api.graphql(...args)),
    };
    const first = featureContext<MrListRoute>("/g/p/-/merge_requests", counting as typeof api);
    await mrListFeature.mount(first.ctx);
    expect(requests).toBeGreaterThan(0);

    requests = 0;
    first.unmount();
    const off = featureContext<MrListRoute>(
      "/g/p/-/merge_requests",
      counting as typeof api,
      { kanbanView: false },
      first.ctx.cache,
    );
    await mrListFeature.mount(off.ctx);
    expect(item(1).hasAttribute("data-mrflow-approved")).toBe(true);

    off.unmount();
    const on = featureContext<MrListRoute>("/g/p/-/merge_requests", counting as typeof api, {}, first.ctx.cache);
    await mrListFeature.mount(on.ctx);
    expect(column("approved")).toEqual(["MR 1"]);
    expect(requests).toBe(0);
  });

  it("loads again when the approvals settings change, as the badges depend on them", async () => {
    document.body.innerHTML = mrList(2);
    let requests = 0;
    const api = fakeApi(nodes);
    const counting = {
      ...api,
      graphql: (...args: Parameters<typeof api.graphql>) => (requests++, api.graphql(...args)),
    };
    const first = featureContext<MrListRoute>("/g/p/-/merge_requests", counting as typeof api);
    await mrListFeature.mount(first.ctx);
    first.unmount();

    requests = 0;
    const next = featureContext<MrListRoute>(
      "/g/p/-/merge_requests",
      counting as typeof api,
      { approvalsNeeded: 1 },
      first.ctx.cache,
    );
    await mrListFeature.mount(next.ctx);
    expect(requests).toBeGreaterThan(0);
    expect(item(1).querySelector(".mrflow-approvals-badge")?.textContent).toBe("1/1");
  });
});

describe("MR list without the board", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
  });

  it("decorates the native items, highlights approved ones and cleans up", async () => {
    const unmount = await mountList("/g/p/-/merge_requests", { kanbanView: false }, 2);
    expect(list().hasAttribute("data-mrflow-board")).toBe(false);
    expect(item(1).hasAttribute("data-mrflow-approved")).toBe(true);
    expect(item(1).querySelector(".mrflow-approvals-badge")).not.toBeNull();

    unmount();
    expect(document.querySelector(".mrflow-approvals-badge, .mrflow-badges, [data-mrflow-approved]")).toBeNull();
  });
});
