// Small native GitLab spinner (gl-spinner)
export function spinner(label = "Loading"): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = "mrflow-loading gl-spinner gl-spinner-sm gl-spinner-dark gl-ml-2 gl-align-middle";
  el.setAttribute("aria-label", label);
  return el;
}
