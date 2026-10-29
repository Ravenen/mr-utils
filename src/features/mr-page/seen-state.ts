import { getMergeRequestData, type MrData } from "@/core/gitlab/merge-requests";
import type { Feature, FeatureContext } from "@/core/lifecycle";
import type { Route } from "@/core/router";
import { migrateMrState, readMrState, writeMrState } from "@/core/storage/mr-state";

export type MrPageRoute = Extract<Route, { kind: "mr-page" }>;

const SAVE_ON_HIDE_INTERVAL_MS = 60 * 1000;

// Remember what the user has seen on this MR (drives NEW COMMITS/REPLIES/COMMENTS banners in the list)
async function saveSeenState(ctx: FeatureContext<MrPageRoute>): Promise<MrData | null> {
  const { projectPath, iid, mrPath } = ctx.route;
  const mrData = await getMergeRequestData(ctx, projectPath, iid);
  if (!mrData || ctx.signal.aborted) return null;

  const saved = readMrState(mrPath);
  saved.head_sha = mrData.headSha;
  saved.other_comments = mrData.otherComments;
  saved.replies_in_user_threads = mrData.repliesInUserThreads;
  // Superseded by the fields above
  delete saved.comments_number;
  delete saved.commits_number;
  delete saved.replies_to_user_threads;
  writeMrState(mrPath, saved);
  return mrData;
}

// Fresh MR data, loaded once per page and shared by the MR page features (approval guard needs it too),
// also when one of them remounts after a settings change
const PAGE_DATA = "mr-page/data";
export function loadMrPageData(ctx: FeatureContext<MrPageRoute>): Promise<MrData | null> {
  let load = ctx.cache.get(PAGE_DATA) as Promise<MrData | null> | undefined;
  if (!load) {
    migrateMrState(ctx.route.url.pathname, ctx.route.mrPath);
    load = saveSeenState(ctx);
    ctx.cache.set(PAGE_DATA, load);
    // Loaded for a feature that went away: the next one loads again
    void load.then(() => {
      if (ctx.signal.aborted) ctx.cache.delete(PAGE_DATA);
    });
  }
  return load;
}

export const seenStateFeature: Feature<MrPageRoute> = {
  name: "mr-seen-state",
  match: (route): route is MrPageRoute => route.kind === "mr-page",
  // Reads no setting that changes what it does
  settings: [],
  async mount(ctx) {
    await loadMrPageData(ctx);

    // Refresh when the user leaves the tab, at most once a minute
    let lastSavedAt = Date.now();
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.visibilityState === "hidden" && Date.now() - lastSavedAt > SAVE_ON_HIDE_INTERVAL_MS) {
          lastSavedAt = Date.now();
          void saveSeenState(ctx);
        }
      },
      { signal: ctx.signal },
    );
  },
};
