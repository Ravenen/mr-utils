import { getCanonicalMrPath } from "@/utils/mr";

export type MrListScope = "project" | "group" | "dashboard";
export type MrTab = "overview" | "commits" | "pipelines" | "diffs";

// What page we are on. Features remount only when `key` changes: an MR keeps its key across tabs,
// a list gets a new one on every filter, sort or page change.
export type Route =
  | { kind: "mr-list"; key: string; url: URL; scope: MrListScope }
  | { kind: "mr-page"; key: string; url: URL; projectPath: string; iid: string; mrPath: string; tab: MrTab }
  | { kind: "other"; key: string; url: URL };

const MR_PAGE_RE = /^\/(.+?)(?:\/-)?\/merge_requests\/(\d+)(?:\/([^/]+))?\/?$/;
const TABS: readonly string[] = ["commits", "pipelines", "diffs"];

export function parseRoute(href: string): Route {
  const url = new URL(href);
  const path = url.pathname.replace(/\/+$/, "");

  const page = path.match(MR_PAGE_RE);
  if (page) {
    const [, projectPath = "", iid = "", tab = ""] = page;
    const mrPath = getCanonicalMrPath(url.pathname);
    return {
      kind: "mr-page",
      key: `mr-page:${mrPath}`,
      url,
      projectPath,
      iid,
      mrPath,
      tab: TABS.includes(tab) ? (tab as MrTab) : "overview",
    };
  }

  const scope: MrListScope | null =
    path === "/dashboard/merge_requests"
      ? "dashboard"
      : /^\/groups\/.+\/-\/merge_requests$/.test(path)
        ? "group"
        : /^\/.+\/-\/merge_requests$/.test(path)
          ? "project"
          : null;
  if (scope) return { kind: "mr-list", key: `mr-list:${path}${url.search}`, url, scope };

  return { kind: "other", key: `other:${path}`, url };
}

// Calls onChange(href) whenever the URL changes. GitLab changes it with history.pushState/replaceState,
// which a content script cannot hook, so watch what comes with it: DOM updates, popstate and,
// where the browser has it, the Navigation API.
export function watchUrl(onChange: (href: string) => void, signal: AbortSignal): void {
  let lastHref = location.href;
  const check = () => {
    if (signal.aborted || location.href === lastHref) return;
    lastHref = location.href;
    onChange(lastHref);
  };

  const observer = new MutationObserver(check);
  observer.observe(document, { subtree: true, childList: true });
  signal.addEventListener("abort", () => observer.disconnect(), { once: true });

  window.addEventListener("popstate", check, { signal });
  const navigation = (window as { navigation?: EventTarget }).navigation;
  navigation?.addEventListener("currententrychange", check, { signal });
}
