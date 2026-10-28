import type { ApiError } from "@/core/gitlab/api";

// GitLab's icon sprite URL, e.g. "/assets/icons-<hash>.svg". It is hashed per deploy, so take it from the page.
export function getIconSpriteUrl(): string | null {
  const use = document.querySelector('svg use[href*="/icons-"][href*=".svg#"]');
  return use?.getAttribute("href")?.split("#")[0] ?? null;
}

// SVG icon from GitLab's sprite, put before the target's content
export function prependIcon(target: Element, iconName: string): void {
  const spriteUrl = getIconSpriteUrl();
  if (!spriteUrl) return;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("s14", "gl-align-middle");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `${spriteUrl}#${iconName}`);
  svg.appendChild(use);
  target.prepend(svg);
}

export function constructBadge(text: string, title: string, badgeStyle: string): HTMLSpanElement {
  const badgeSpan = document.createElement("span");
  badgeSpan.className = `gl-badge badge badge-pill has-tooltip ${badgeStyle}`;
  badgeSpan.textContent = text;
  badgeSpan.title = title;
  return badgeSpan;
}

export function constructBanner(text: string, title: string, badgeStyle: string): HTMLSpanElement {
  const badgeSpan = document.createElement("span");
  badgeSpan.className = `gl-badge badge has-tooltip ${badgeStyle} font-weight-bold`;
  badgeSpan.textContent = text;
  badgeSpan.title = title;
  return badgeSpan;
}

// Banner for something the author has to do: red, with an icon
export function constructActionBanner(text: string, title: string, iconName: string): HTMLSpanElement {
  const banner = constructBanner(text, title, "badge-danger");
  banner.classList.add("mrflow-banner-action");
  prependIcon(banner, iconName);
  return banner;
}

// Native GitLab alert before the anchor, e.g. when the API rate limit is hit. Removed by the caller.
export function showApiError(anchor: Element | null, error: unknown): HTMLElement | null {
  if (!anchor || document.querySelector(".mrflow-alert")) return null;
  const { status, retryAfter } = error as Partial<ApiError>;
  const minutes = retryAfter ? Math.ceil(retryAfter / 60) : null;
  const message =
    status === 429
      ? `MRFlow: GitLab API rate limit reached${minutes ? `, try again in ~${minutes} min` : ""}. Some badges are missing.`
      : "MRFlow: could not load merge request details from GitLab. Some badges are missing.";

  const alert = document.createElement("div");
  alert.className = "mrflow-alert gl-alert gl-alert-warning gl-alert-not-dismissible gl-my-3";
  const content = document.createElement("div");
  content.className = "gl-alert-content";
  const body = document.createElement("div");
  body.className = "gl-alert-body";
  body.textContent = message;
  content.appendChild(body);
  alert.appendChild(content);
  anchor.insertAdjacentElement("beforebegin", alert);
  return alert;
}
