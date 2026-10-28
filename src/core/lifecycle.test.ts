// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GitLabApi } from "./gitlab/api";
import { startFeatures, type Dependencies, type Feature } from "./lifecycle";
import type { Route } from "./router";
import type { Settings } from "./settings";

const SETTINGS: Settings = {
  approvalsNeeded: 2,
  kanbanView: true,
  boardLoading: "all",
  animateCards: true,
  resetChecksOnNewCommits: true,
};

// Navigation is driven by hand instead of by DOM mutations
function setup(features: Feature[]) {
  let onUrlChange: (href: string) => void = () => {};
  const deps: Dependencies = {
    api: {} as GitLabApi,
    loadSettings: async () => SETTINGS,
    getCurrentUserId: async () => 7,
    watchUrl: (onChange) => {
      onUrlChange = onChange;
    },
  };
  const root = new AbortController();
  startFeatures(features, deps, root.signal);
  const navigate = (path: string) => {
    history.replaceState(null, "", path);
    onUrlChange(location.href);
  };
  return { navigate, root };
}

// A feature that mounts a board after an async step, like the Kanban does
function boardFeature(log: string[]): Feature {
  return {
    name: "board",
    match: (route): route is Route => route.kind === "mr-list",
    async mount(ctx) {
      log.push(`mount ${ctx.route.url.search}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (ctx.signal.aborted) return void log.push(`stopped ${ctx.route.url.search}`);
      const board = document.createElement("div");
      board.className = "board";
      document.body.append(board);
      ctx.onCleanup(() => {
        board.remove();
        log.push(`cleanup ${ctx.route.url.search}`);
      });
    },
  };
}

const flush = () => vi.advanceTimersByTimeAsync(50);

describe("startFeatures", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("drops a mount superseded by GitLab's ?sort=...&state=opened redirect before it starts", async () => {
    vi.useFakeTimers();
    history.replaceState(null, "", "/g/p/-/merge_requests");
    const log: string[] = [];
    const { navigate } = setup([boardFeature(log)]);

    // GitLab redirects right after the page loads, while settings are still being read
    navigate("/g/p/-/merge_requests?sort=created_date&state=opened");
    await flush();

    expect(log).toEqual(["mount ?sort=created_date&state=opened"]);
    expect(document.querySelectorAll(".board")).toHaveLength(1);
  });

  it("stops a mount superseded by the redirect while it is running", async () => {
    vi.useFakeTimers();
    history.replaceState(null, "", "/g/p/-/merge_requests");
    const log: string[] = [];
    const { navigate } = setup([boardFeature(log)]);
    await vi.advanceTimersByTimeAsync(5);

    navigate("/g/p/-/merge_requests?sort=created_date&state=opened");
    await flush();

    expect(log).toEqual(["mount ", "mount ?sort=created_date&state=opened", "stopped "]);
    expect(document.querySelectorAll(".board")).toHaveLength(1);
  });

  it("cleans up before mounting again, so the page keeps one copy", async () => {
    vi.useFakeTimers();
    history.replaceState(null, "", "/g/p/-/merge_requests");
    const log: string[] = [];
    const { navigate } = setup([boardFeature(log)]);
    await flush();
    navigate("/g/p/-/merge_requests?page=2");
    await flush();

    expect(log).toEqual(["mount ", "cleanup ", "mount ?page=2"]);
    expect(document.querySelectorAll(".board")).toHaveLength(1);
  });

  it("does not remount when only the MR tab changes, and unmounts when leaving", async () => {
    vi.useFakeTimers();
    history.replaceState(null, "", "/g/p/-/merge_requests/1");
    const mounts: string[] = [];
    const signals: AbortSignal[] = [];
    const { navigate } = setup([
      {
        name: "page",
        match: (route): route is Route => route.kind === "mr-page",
        mount(ctx) {
          mounts.push(ctx.route.url.pathname);
          signals.push(ctx.signal);
        },
      },
    ]);
    await flush();
    navigate("/g/p/-/merge_requests/1/diffs");
    await flush();
    expect(mounts).toEqual(["/g/p/-/merge_requests/1"]);

    navigate("/g/p/-/merge_requests");
    await flush();
    expect(signals[0]?.aborted).toBe(true);
  });

  it("unmounts everything when the extension is unloaded", async () => {
    vi.useFakeTimers();
    history.replaceState(null, "", "/g/p/-/merge_requests");
    const log: string[] = [];
    const { root } = setup([boardFeature(log)]);
    await flush();
    root.abort();

    expect(log).toEqual(["mount ", "cleanup "]);
    expect(document.querySelector(".board")).toBeNull();
  });
});
