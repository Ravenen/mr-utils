import { prependIcon } from "./icons";

export type BadgeVariant = "success" | "danger" | "warning" | "info" | "tier" | "neutral";

// Pill badge (counts: threads, approvals)
export function badge(text: string, title: string, variant: BadgeVariant): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = `gl-badge badge badge-pill has-tooltip badge-${variant}`;
  el.textContent = text;
  el.title = title;
  return el;
}

// Square bold badge (NEW COMMITS, CONFLICTS, ...)
export function banner(text: string, title: string, variant: BadgeVariant): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = `gl-badge badge has-tooltip badge-${variant} font-weight-bold`;
  el.textContent = text;
  el.title = title;
  return el;
}

// Banner for something the author has to do: red, with an icon
export function actionBanner(text: string, title: string, iconName: string): HTMLSpanElement {
  const el = banner(text, title, "danger");
  el.classList.add("mrflow-banner-action");
  prependIcon(el, iconName);
  return el;
}
