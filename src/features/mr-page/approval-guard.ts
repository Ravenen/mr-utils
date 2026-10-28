import type { Feature, FeatureContext } from "@/core/lifecycle";
import { readMrState, writeMrState } from "@/core/storage/mr-state";
import { waitFor } from "@/utils/async";
import { loadMrPageData, type MrPageRoute } from "./seen-state";

const CHECKS = [
  { id: "docs_check", text: "Is documentation updated?" },
  { id: "branch_check", text: "Is merge target right?" },
];

// The approvals widget may never appear (own MR, merged MR, no permission), so give up after a while
const APPROVALS_WIDGET_TIMEOUT_MS = 60 * 1000;

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

    const approveBar = await waitFor(
      () => {
        const bar = findApproveBar();
        if (!bar || bar.textContent?.includes("Checking approval status")) return null;
        return findMergeBar() ? bar : null;
      },
      { timeout: APPROVALS_WIDGET_TIMEOUT_MS, signal: ctx.signal },
    );
    if (!approveBar?.parentElement || approveBar.parentElement.querySelector(".mr-utils-checks")) return;
    const approveBtn = approveBar.getElementsByTagName("button")[0];
    const mergeBar = findMergeBar();
    if (!approveBtn?.parentElement || !mergeBar) return;

    const updateApproveVisibility = () => {
      if (isConditionsChecked(mrPath)) {
        approveBtn.style.setProperty("display", "flex", "important");
        mergeBar.style.setProperty("display", "block", "important");
      } else {
        // Keep "Revoke approval" reachable
        if (!hasUserApproved && !approveBtn.textContent?.includes("Revoke approval"))
          approveBtn.style.setProperty("display", "none", "important");
        mergeBar.style.setProperty("display", "none", "important");
      }
    };

    const approveBtnContainer = approveBtn.parentElement;
    approveBtnContainer.style.height = "32px";
    updateApproveVisibility();

    const checksBar = document.createElement("div");
    checksBar.style.display = "block";
    checksBar.style.width = "100%";
    checksBar.classList.add("gl-z-1", "mr-utils-checks"); // gl-z-1 is needed for GitLab UI to be elevated above accessability elements

    const headingElement = document.createElement("p");
    headingElement.style.fontWeight = "600";
    headingElement.appendChild(document.createTextNode("Check following conditions to approve:"));
    checksBar.appendChild(headingElement);
    CHECKS.forEach(({ id, text }) => checksBar.appendChild(createCheck(mrPath, id, text, updateApproveVisibility)));

    approveBar.parentElement.prepend(checksBar);
    ctx.onCleanup(() => {
      checksBar.remove();
      approveBtnContainer.style.height = "";
      approveBtn.style.removeProperty("display");
      mergeBar.style.removeProperty("display");
    });
  },
};

function findApproveBar(): HTMLElement | null {
  return (
    document.getElementsByClassName("js-mr-approvals")[0]?.getElementsByTagName("button")[0]?.parentElement
      ?.parentElement ?? null
  );
}

function findMergeBar(): HTMLElement | null {
  return (
    document.getElementsByClassName("mr-widget-body-ready-merge")[0]?.parentElement?.parentElement?.parentElement ??
    null
  );
}

function createCheck(mrPath: string, id: string, text: string, onChange: () => void): HTMLElement {
  const block = document.createElement("div");
  block.style.display = "block";
  block.style.marginTop = "10px";
  block.style.marginBottom = "10px";

  const checkbox = document.createElement("input");
  checkbox.style.marginRight = "10px";
  checkbox.type = "checkbox";
  checkbox.id = id;

  const checkStatus = readMrState(mrPath);
  if (!checkStatus[id]) checkStatus[id] = false;
  checkbox.checked = Boolean(checkStatus[id]);
  writeMrState(mrPath, checkStatus);

  checkbox.onclick = () => {
    const state = readMrState(mrPath);
    state[id] = checkbox.checked;
    writeMrState(mrPath, state);
    onChange();
  };

  const checkboxLabel = document.createElement("label");
  checkboxLabel.htmlFor = id;
  checkboxLabel.appendChild(document.createTextNode(text));

  block.appendChild(checkbox);
  block.appendChild(checkboxLabel);
  return block;
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
