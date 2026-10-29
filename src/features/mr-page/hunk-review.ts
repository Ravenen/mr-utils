import { diffFiles, type DiffHunk } from "@/core/gitlab/dom";
import type { Feature } from "@/core/lifecycle";
import { checkbox } from "@/ui/checkbox";
import type { MrPageRoute } from "./seen-state";

const CONTROL = "mrflow-hunk-control";
const HEADER = "mrflow-hunk-header";

// A "Viewed" checkbox on every hunk of the Changes tab, in both diffs renderers and both views.
// GitLab mounts and drops diff files as they load and scroll, so the page is watched and the
// checkboxes are put back whenever a hunk is missing one.
export const hunkReviewFeature: Feature<MrPageRoute> = {
  name: "hunk-review",
  match: (route): route is MrPageRoute => route.kind === "mr-page",
  settings: ["hunkReview"],
  mount(ctx) {
    if (!ctx.settings.hunkReview) return;
    // Until marks are stored per hunk content: what is ticked on this page, by file and hunk position
    const viewed = new Set<string>();
    const added = new Set<Element>();

    const apply = () => {
      for (const file of diffFiles()) {
        file.hunks.forEach((hunk, index) => {
          const key = `${file.path}#${index}`;
          const host = hunkHost(hunk, added);
          if (!host || host.querySelector(`:scope > .${CONTROL}`)) return;

          const control = document.createElement(host.tagName === "TR" ? "td" : "div");
          control.className = CONTROL;
          control.appendChild(
            checkbox("Viewed", {
              checked: viewed.has(key),
              onChange: (checked) => {
                if (checked) viewed.add(key);
                else viewed.delete(key);
                hunk.rows.forEach((row) => row.toggleAttribute("data-mrflow-hunk-viewed", checked));
              },
            }).root,
          );
          host.appendChild(control);
          added.add(control);
          hunk.rows.forEach((row) => row.toggleAttribute("data-mrflow-hunk-viewed", viewed.has(key)));
        });
      }
    };

    // One pass per frame, however many nodes GitLab adds at once; our own additions settle in one more pass
    let scheduled = 0;
    const observer = new MutationObserver(() => {
      if (!scheduled) scheduled = requestAnimationFrame(() => ((scheduled = 0), apply()));
    });
    observer.observe(document.body, { childList: true, subtree: true });
    apply();

    ctx.onCleanup(() => {
      observer.disconnect();
      cancelAnimationFrame(scheduled);
      added.forEach((el) => el.remove());
      document
        .querySelectorAll("[data-mrflow-hunk-header]")
        .forEach((el) => el.removeAttribute("data-mrflow-hunk-header"));
      document
        .querySelectorAll("[data-mrflow-hunk-viewed]")
        .forEach((el) => el.removeAttribute("data-mrflow-hunk-viewed"));
    });
  },
};

// Where the hunk's checkbox goes: GitLab's "@@" row, or for the hunk at the top of a file, which has
// none, a row of ours put before its first line (a <tr> in Rapid Diffs' table, a <div> in the Vue grid)
function hunkHost(hunk: DiffHunk, added: Set<Element>): HTMLElement | null {
  if (hunk.header) {
    hunk.header.setAttribute("data-mrflow-hunk-header", "");
    return hunk.header;
  }
  const first = hunk.rows[0];
  if (!first) return null;
  const previous = first.previousElementSibling;
  if (previous instanceof HTMLElement && previous.classList.contains(HEADER)) return previous;
  const header = document.createElement(first.tagName === "TR" ? "tr" : "div");
  header.className = HEADER;
  first.before(header);
  added.add(header);
  return header;
}
