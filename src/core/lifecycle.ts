import type { GitLabApi } from "@/core/gitlab/api";
import { parseRoute, watchUrl, type Route } from "@/core/router";
import type { Settings } from "@/core/settings";
import { isAbortError } from "@/utils/async";

export interface FeatureContext<R extends Route = Route> {
  route: R;
  // Fires when the feature is superseded (navigation to another key) or the extension is unloaded.
  // Pass it to every request and wait; check it after every await.
  signal: AbortSignal;
  settings: Settings;
  userId: number | null;
  api: GitLabApi;
  // Run fn on unmount (right away if already unmounted). Everything a feature adds to the page must
  // be removed here, so that mounting again is idempotent.
  onCleanup(fn: () => void): void;
}

// A feature keeps no state outside mount(): it lives in the closure and is torn down through onCleanup
export interface Feature<R extends Route = Route> {
  name: string;
  match(route: Route): route is R;
  mount(ctx: FeatureContext<R>): void | Promise<void>;
}

export interface Dependencies {
  api: GitLabApi;
  loadSettings(): Promise<Settings>;
  getCurrentUserId(signal: AbortSignal): Promise<number | null>;
  watchUrl?: typeof watchUrl;
}

// Mounts the features matching the current route and remounts them on every navigation that changes
// the route key. The previous mount is aborted and cleaned up first.
export function startFeatures(features: Feature[], deps: Dependencies, signal: AbortSignal): void {
  let current: { key: string; controller: AbortController } | null = null;

  const navigate = (href: string) => {
    const route = parseRoute(href);
    if (current?.key === route.key) return;
    current?.controller.abort();
    if (signal.aborted) return;

    const controller = new AbortController();
    signal.addEventListener("abort", () => controller.abort(), { once: true, signal: controller.signal });
    current = { key: route.key, controller };
    void mount(
      features.filter((feature) => feature.match(route)),
      route,
      controller.signal,
    );
  };

  const mount = async (matching: Feature[], route: Route, mountSignal: AbortSignal) => {
    if (matching.length === 0) return;
    const [settings, userId] = await Promise.all([deps.loadSettings(), deps.getCurrentUserId(mountSignal)]);
    if (mountSignal.aborted) return;

    const ctx: FeatureContext = {
      route,
      signal: mountSignal,
      settings,
      userId,
      api: deps.api,
      onCleanup(fn) {
        if (mountSignal.aborted) runCleanup(fn);
        else mountSignal.addEventListener("abort", () => runCleanup(fn), { once: true });
      },
    };
    await Promise.all(
      matching.map(async (feature) => {
        try {
          await feature.mount(ctx);
        } catch (error) {
          if (!mountSignal.aborted || !isAbortError(error)) console.error(`MRFlow: ${feature.name} failed`, error);
        }
      }),
    );
  };

  (deps.watchUrl ?? watchUrl)(navigate, signal);
  signal.addEventListener("abort", () => current?.controller.abort(), { once: true });
  navigate(location.href);
}

function runCleanup(fn: () => void) {
  try {
    fn();
  } catch (error) {
    console.error("MRFlow: cleanup failed", error);
  }
}
