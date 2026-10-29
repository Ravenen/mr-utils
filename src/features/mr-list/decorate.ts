import { itemApprovals, itemCommentsBadge, itemControls, itemMainInfo } from "@/core/gitlab/dom";
import type { MrData } from "@/core/gitlab/merge-requests";
import { readMrState } from "@/core/storage/mr-state";
import { actionBanner, badge, banner } from "@/ui/badge";
import { prependIcon } from "@/ui/icons";

// GitLab's Vue rewrites `class` on re-render, so state on native items lives in data attributes
const FLAGS = ["mrflowDraft", "mrflowReady", "mrflowApproved"] as const;
const ADDED = ".mrflow-badges, .mrflow-banners, .mrflow-approvals-badge";

// Decorate a native MR item. Idempotent: replaces what an earlier call added.
export function decorateMergeRequest(
  mrElement: HTMLElement,
  mrData: MrData,
  { showSeenBanners = false, highlightApproved = false } = {},
): void {
  clearDecorations(mrElement);
  addBadges(mrElement, mrData);
  addBanners(mrElement, mrData, showSeenBanners);
  if (mrData.isDraft) mrElement.dataset.mrflowDraft = "";
  if (mrData.isReady) mrElement.dataset.mrflowReady = "";
  if (highlightApproved && mrData.hasUserApproved && !mrData.isDraft) mrElement.dataset.mrflowApproved = "";
}

// Remove everything decorateMergeRequest added and show the native comments count again
export function clearDecorations(mrElement: HTMLElement): void {
  mrElement.querySelectorAll(ADDED).forEach((el) => el.remove());
  mrElement.querySelectorAll<HTMLElement>("[data-mrflow-replaced]").forEach((el) => delete el.dataset.mrflowReplaced);
  FLAGS.forEach((flag) => delete mrElement.dataset[flag]);
}

function addBadges(mrElement: Element, mrData: MrData) {
  const controls = itemControls(mrElement);
  if (!controls) return;

  // Threads badges, in place of the native comments count. The native element is hidden, not removed:
  // it belongs to GitLab's Vue, which fails to patch nodes taken from under it.
  if (mrData.totalThreads > 0) {
    const container = document.createElement("div");
    container.className = "mrflow-badges";
    const threadsBadge = badge(
      `${mrData.totalThreads - mrData.unresolvedThreads}/${mrData.totalThreads}`,
      "Total threads",
      mrData.unresolvedThreads === 0 ? "success" : "danger",
    );
    container.appendChild(threadsBadge);
    prependIcon(threadsBadge, "comments");

    if (mrData.totalUserThreads > 0) {
      const userThreadsBadge = badge(
        `${mrData.totalUserThreads - mrData.unresolvedUserThreads}/${mrData.totalUserThreads}`,
        "Your threads",
        mrData.unresolvedUserThreads === 0 ? "success" : "danger",
      );
      container.appendChild(userThreadsBadge);
      prependIcon(userThreadsBadge, "comment-dots");
    }

    const nativeComments = itemCommentsBadge(controls);
    if (nativeComments) {
      nativeComments.dataset.mrflowReplaced = "";
      nativeComments.insertAdjacentElement("afterend", container);
    } else {
      controls.appendChild(container);
    }
  }

  // Approvals badge
  const approvalsBadge = badge(
    `${mrData.approvalsGiven}/${mrData.approvalsRequired}`,
    "Approvals number",
    mrData.approvalsGiven >= mrData.approvalsRequired ? "success" : "danger",
  );
  approvalsBadge.classList.add("mrflow-approvals-badge");
  itemApprovals(controls)?.appendChild(approvalsBadge);
}

// Banners: actions needed (CONFLICTS/NEEDS REBASE) and news since last visit
function addBanners(mrElement: Element, mrData: MrData, showSeenBanners: boolean) {
  const infoContainer = itemMainInfo(mrElement);
  if (!infoContainer) return;

  const banners = [];
  if (mrData.hasConflicts) {
    banners.push(actionBanner("CONFLICTS", "Resolve conflicts with the target branch before merging", "warning-solid"));
  } else if (mrData.needsRebase) {
    banners.push(
      actionBanner("NEEDS REBASE", "Rebase the source branch onto the target branch before merging", "branch"),
    );
  }

  // Fields missing from the saved record mean "never seen": no banner instead of a false one
  const saved = readMrState(mrData.mrPath);
  if (showSeenBanners) {
    if (saved.head_sha && mrData.headSha && saved.head_sha !== mrData.headSha) {
      banners.push(banner("NEW COMMITS", "New commits since last visit", "tier"));
    }
    if (saved.replies_in_user_threads !== undefined && mrData.repliesInUserThreads > saved.replies_in_user_threads) {
      banners.push(banner("NEW REPLIES", "New replies to your threads since last visit", "info"));
    }
    if (saved.other_comments !== undefined && mrData.otherComments > saved.other_comments) {
      banners.push(banner("NEW COMMENTS", "New comments since last visit", "warning"));
    }
  }
  if (banners.length === 0) return;

  const container = document.createElement("div");
  container.className = "mrflow-banners";
  banners.forEach((el) => container.appendChild(el));
  infoContainer.insertBefore(container, infoContainer.firstChild);
}
