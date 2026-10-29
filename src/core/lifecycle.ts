import type { GitLabApi } from "@/core/gitlab/api";
import { parseRoute, watchUrl, type Route } from "@/core/router";
import type { Settings } from "@/core/settings";
import { isAbortError } from "@/utils/async";

export interface FeatureContext<R extends Route = Route> {
  route: R;
  // Fires when the feature is superseded (navigation to another key, a change of one of its settings)
  // or the extension is unloaded. Pass it to every request and wait; check it after every await.
  signal: AbortSignal;
  settings: Settings;
  userId: number | null;
  api: GitLabApi;
  // Lives as long as the page (the route key): kept when a feature remounts after a settings change,
  // dropped on navigation. For data already loaded on this page, so that a remount needs no requests.
  cache: Map<string, unknown>;
  // Run fn on unmount (right away if already unmounted). Everything a feature adds to the page must
  // be removed here, so that mounting again is idempotent.
  onCleanup(fn: () => void): void;
}

// A feature keeps no state outside mount(): it lives in the closure and is torn down through onCleanup
export interface Feature<R extends Route = Route> {
  name: string;
  match(route: Route): route is R;
  // The settings it reads: it remounts only when one of these changes (any change when not given)
  settings?: readonly (keyof Settings)[];
  mount(ctx: FeatureContext<R>): void | Promise<void>;
}

export interface Dependencies {
  api: GitLabApi;
  loadSettings(): Promise<Settings>;
  getCurrentUserId(signal: AbortSignal): Promise<number | null>;
  // Calls onChange when the settings change, e.g. in the popup
  watchSettings?(onChange: () => void, signal: AbortSignal): void;
  watchUrl?: typeof watchUrl;
}

interface Page {
  key: string;
  route: Route;
  controller: AbortController;
  cache: Map<string, unknown>;
  settings: Settings | null;
  userId: number | null;
  mounted: Map<Feature, AbortController>;
}

// Mounts the features matching the current route. A navigation that changes the route key unmounts
// them all and mounts the new page's; a settings change remounts only the features that read a
// changed setting. An unmount aborts the feature's signal and runs its cleanups.
export function startFeatures(features: Feature[], deps: Dependencies, signal: AbortSignal): void {
  let page: Page | null = null;

  const mountFeature = (current: Page, feature: Feature) => {
    const controller = new AbortController();
    current.controller.signal.addEventListener("abort", () => controller.abort(), {
      once: true,
      signal: controller.signal,
    });
    current.mounted.set(feature, controller);
    const featureSignal = controller.signal;
    const ctx: FeatureContext = {
      route: current.route,
      signal: featureSignal,
      settings: current.settings as Settings,
      userId: current.userId,
      api: deps.api,
      cache: current.cache,
      onCleanup(fn) {
        if (featureSignal.aborted) runCleanup(fn);
        else featureSignal.addEventListener("abort", () => runCleanup(fn), { once: true });
      },
    };
    void (async () => {
      try {
        await feature.mount(ctx);
      } catch (error) {
        if (!featureSignal.aborted || !isAbortError(error)) console.error(`MRFlow: ${feature.name} failed`, error);
      }
    })();
  };

  const navigate = (href: string) => {
    const route = parseRoute(href);
    if (page?.key === route.key) return;
    page?.controller.abort();
    if (signal.aborted) return;

    const current: Page = {
      key: route.key,
      route,
      controller: new AbortController(),
      cache: new Map(),
      settings: null,
      userId: null,
      mounted: new Map(),
    };
    signal.addEventListener("abort", () => current.controller.abort(), {
      once: true,
      signal: current.controller.signal,
    });
    page = current;
    void start(current);
  };

  const start = async (current: Page) => {
    const matching = features.filter((feature) => feature.match(current.route));
    if (matching.length === 0) return;
    const [settings, userId] = await Promise.all([
      deps.loadSettings(),
      deps.getCurrentUserId(current.controller.signal),
    ]);
    if (current.controller.signal.aborted) return;
    // A settings change while loading may have set newer settings already
    current.settings ??= settings;
    current.userId = userId;
    matching.forEach((feature) => mountFeature(current, feature));
  };

  const onSettingsChange = async () => {
    const current = page;
    if (!current) return;
    const settings = await deps.loadSettings();
    if (current.controller.signal.aborted) return;
    const previous = current.settings;
    current.settings = settings;
    if (!previous) return; // still starting: it mounts with these settings

    for (const [feature, controller] of current.mounted) {
      const keys = feature.settings ?? (Object.keys(settings) as (keyof Settings)[]);
      if (!keys.some((key) => previous[key] !== settings[key])) continue;
      controller.abort();
      mountFeature(current, feature);
    }
  };

  (deps.watchUrl ?? watchUrl)(navigate, signal);
  deps.watchSettings?.(() => void onSettingsChange(), signal);
  signal.addEventListener("abort", () => page?.controller.abort(), { once: true });
  navigate(location.href);
}

function runCleanup(fn: () => void) {
  try {
    fn();
  } catch (error) {
    console.error("MRFlow: cleanup failed", error);
  }
}
