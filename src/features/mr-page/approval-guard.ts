import { approvalsWidget, isRevokeApprovalButton, mergeSection } from "@/core/gitlab/dom";
import type { Feature, FeatureContext } from "@/core/lifecycle";
import { readMrState, writeMrState } from "@/core/storage/mr-state";
import { checkbox } from "@/ui/checkbox";
import { waitFor } from "@/utils/async";
import { loadMrPageData, type MrPageRoute } from "./seen-state";

// Stored as "<id>" in the MR state; the ids are published, keep them
const CHECKS = [
  { id: "docs_check", text: "Is documentation updated?" },
  { id: "branch_check", text: "Is merge target right?" },
];

// The approvals widget may never appear (own MR, merged MR, no permission), so give up after a while
const APPROVALS_WIDGET_TIMEOUT_MS = 60 * 1000;
const HIDDEN = "mrflow-hidden";

// Hides Approve and Merge until every check is ticked
export const approvalGuardFeature: Feature<MrPageRoute> = {
  name: "approval-guard",
  match: (route): route is MrPageRoute => route.kind === "mr-page",
  async mount(ctx) {
    const { mrPath } = ctx.route;
    const mrData = await loadMrPageData(ctx);
    if (ctx.signal.aborted) return;
    const hasUserApproved = mrData?.hasUserApproved ?? false;
    if (mrData) resetChecksIfNeeded(ctx, mrData.headSha);

    const found = await waitFor(
      () => {
        const widget = approvalsWidget();
        const merge = mergeSection();
        return widget && merge ? { ...widget, merge } : null;
      },
      { timeout: APPROVALS_WIDGET_TIMEOUT_MS, signal: ctx.signal },
    );
    if (!found || found.content.querySelector(".mrflow-checks")) return;
    const { content, button, merge } = found;

    // Without an approve button (own MR, no permission) the checklist still guards Merge
    const updateVisibility = () => {
      const allChecked = isConditionsChecked(mrPath);
      // Keep "Revoke approval" reachable
      button?.classList.toggle(HIDDEN, !allChecked && !hasUserApproved && !isRevokeApprovalButton(button));
      merge.classList.toggle(HIDDEN, !allChecked);
    };
    updateVisibility();

    // gl-z-1 lifts the checklist above GitLab's accessibility overlays
    const checks = document.createElement("div");
    checks.className = "mrflow-checks gl-z-1 gl-mb-4 gl-flex gl-flex-col gl-gap-3";
    const heading = document.createElement("p");
    heading.className = "gl-font-bold gl-m-0 gl-mb-3";
    heading.textContent = "Check following conditions to approve:";
    checks.appendChild(heading);
    CHECKS.forEach(({ id, text }) => checks.appendChild(createCheck(mrPath, id, text, updateVisibility)));

    content.insertBefore(checks, content.firstChild);
    ctx.onCleanup(() => {
      checks.remove();
      button?.classList.remove(HIDDEN);
      merge.classList.remove(HIDDEN);
    });
  },
};

function createCheck(mrPath: string, id: string, text: string, onChange: () => void): HTMLElement {
  const state = readMrState(mrPath);
  if (!state[id]) state[id] = false;
  writeMrState(mrPath, state);

  return checkbox(text, {
    id: `mrflow-${id}`,
    checked: Boolean(state[id]),
    onChange: (checked) => {
      const latest = readMrState(mrPath);
      latest[id] = checked;
      writeMrState(mrPath, latest);
      onChange();
    },
  }).root;
}

// Are all checks ticked? (and is there at least one)
function isConditionsChecked(mrPath: string): boolean {
  const checks = Object.entries(readMrState(mrPath))
    .filter(([key]) => key.endsWith("_check"))
    .map(([, value]) => value);
  return checks.length > 0 && checks.every(Boolean);
}

// Untick all checks when the MR head moved since they were ticked
function resetChecksIfNeeded(ctx: FeatureContext<MrPageRoute>, headSha: string | undefined) {
  if (!headSha) return;
  const { mrPath } = ctx.route;
  const saved = readMrState(mrPath);
  if (ctx.settings.resetChecksOnNewCommits && saved.checks_head_sha && saved.checks_head_sha !== headSha) {
    Object.keys(saved)
      .filter((key) => key.endsWith("_check"))
      .forEach((key) => {
        saved[key] = false;
      });
  }
  saved.checks_head_sha = headSha;
  writeMrState(mrPath, saved);
}
