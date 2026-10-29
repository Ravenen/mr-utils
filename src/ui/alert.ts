import type { ApiError } from "@/core/gitlab/api";

// Pajamas alert (gl-alert), not dismissible
export function alert(message: string, variant: "warning" | "danger" | "info" = "warning"): HTMLDivElement {
  const el = document.createElement("div");
  el.className = `mrflow-alert gl-alert gl-alert-${variant} gl-alert-not-dismissible gl-my-3`;
  const content = document.createElement("div");
  content.className = "gl-alert-content";
  const body = document.createElement("div");
  body.className = "gl-alert-body";
  body.textContent = message;
  content.appendChild(body);
  el.appendChild(content);
  return el;
}

// Alert before the anchor when MR details could not be loaded, e.g. when the API rate limit is hit.
// One per page; the caller removes it.
export function showApiError(anchor: Element | null, error: unknown): HTMLElement | null {
  if (!anchor || document.querySelector(".mrflow-alert")) return null;
  const { status, retryAfter } = error as Partial<ApiError>;
  const minutes = retryAfter ? Math.ceil(retryAfter / 60) : null;
  const el = alert(
    status === 429
      ? `MRFlow: GitLab API rate limit reached${minutes ? `, try again in ~${minutes} min` : ""}. Some badges are missing.`
      : "MRFlow: could not load merge request details from GitLab. Some badges are missing.",
  );
  anchor.insertAdjacentElement("beforebegin", el);
  return el;
}
