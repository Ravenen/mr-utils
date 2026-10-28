import type { MrData } from "@/core/gitlab/merge-requests";
import { readMrState } from "@/core/storage/mr-state";
import { constructActionBanner, constructBadge, constructBanner, prependIcon } from "@/ui/gitlab";

// Everything decorate() adds to an MR item, for cleaning up native items in list view
export const DECORATION_SELECTOR = ".kanban-badges, .kanban-banners, .mrflow-approvals-badge";
export const DECORATION_CLASSES = ["dimmed", "mr-ready", "greened"];

// Decorate an MR element (a board card, or the native item in list view)
export function decorateMergeRequest(mrElement: Element, mrData: MrData, { showSeenBanners = false } = {}): void {
  addBadges(mrElement, mrData);
  addBanners(mrElement, mrData, showSeenBanners);
  if (mrData.isDraft) mrElement.classList.add("dimmed");
  if (mrData.isReady) mrElement.classList.add("mr-ready");
}

function addBadges(mrElement: Element, mrData: MrData) {
  const controlsContainer = mrElement.querySelector(".controls");
  if (!controlsContainer) return;

  // Threads badges
  if (mrData.totalThreads > 0) {
    let threadsBadgesContainer = controlsContainer.querySelector(".kanban-badges");
    if (!threadsBadgesContainer) {
      threadsBadgesContainer = document.createElement("div");
      threadsBadgesContainer.classList.add("kanban-badges");
      controlsContainer.appendChild(threadsBadgesContainer);
    }
    const threadsBadge = constructBadge(
      `${mrData.totalThreads - mrData.unresolvedThreads}/${mrData.totalThreads}`,
      "Total threads",
      mrData.unresolvedThreads === 0 ? "badge-success" : "badge-danger",
    );
    threadsBadgesContainer.appendChild(threadsBadge);
    prependIcon(threadsBadge, "comments");

    if (mrData.totalUserThreads > 0) {
      const userThreadsBadge = constructBadge(
        `${mrData.totalUserThreads - mrData.unresolvedUserThreads}/${mrData.totalUserThreads}`,
        "Your threads",
        mrData.unresolvedUserThreads === 0 ? "badge-success" : "badge-danger",
      );
      threadsBadgesContainer.appendChild(userThreadsBadge);
      prependIcon(userThreadsBadge, "comment-dots");
    }

    // Replace the native comments badge if present
    const nativeCommentsBadge = controlsContainer.querySelector('[data-testid="comments-icon"]')?.parentElement
      ?.parentElement;
    if (nativeCommentsBadge) {
      nativeCommentsBadge.insertAdjacentElement("afterend", threadsBadgesContainer);
      nativeCommentsBadge.remove();
    }
  }

  // Approvals badge
  const approvalsBadge = constructBadge(
    `${mrData.approvalsGiven}/${mrData.approvalsRequired}`,
    "Approvals number",
    mrData.approvalsGiven >= mrData.approvalsRequired ? "badge-success" : "badge-danger",
  );
  approvalsBadge.classList.add("mrflow-approvals-badge");
  const nativeApprovalBadge = controlsContainer.querySelector('[data-testid="mr-approvals"]');
  if (nativeApprovalBadge) {
    nativeApprovalBadge.classList.add("gl-flex");
    nativeApprovalBadge.appendChild(approvalsBadge);
  }
}

// Banners: actions needed (CONFLICTS/NEEDS REBASE) and news since last visit
function addBanners(mrElement: Element, mrData: MrData, showSeenBanners: boolean) {
  const infoContainer = mrElement.querySelector(".issuable-main-info");
  if (!infoContainer) return;

  const banners = [];
  if (mrData.hasConflicts) {
    banners.push(
      constructActionBanner("CONFLICTS", "Resolve conflicts with the target branch before merging", "warning-solid"),
    );
  } else if (mrData.needsRebase) {
    banners.push(
      constructActionBanner("NEEDS REBASE", "Rebase the source branch onto the target branch before merging", "branch"),
    );
  }

  // Fields missing from the saved record mean "never seen": no banner instead of a false one
  const saved = readMrState(mrData.mrPath);
  if (showSeenBanners) {
    if (saved.head_sha && mrData.headSha && saved.head_sha !== mrData.headSha) {
      banners.push(constructBanner("NEW COMMITS", "New commits since last visit", "badge-tier"));
    }
    if (saved.replies_in_user_threads !== undefined && mrData.repliesInUserThreads > saved.replies_in_user_threads) {
      banners.push(constructBanner("NEW REPLIES", "New replies to your threads since last visit", "badge-info"));
    }
    if (saved.other_comments !== undefined && mrData.otherComments > saved.other_comments) {
      banners.push(constructBanner("NEW COMMENTS", "New comments since last visit", "badge-warning"));
    }
  }
  if (banners.length === 0) return;

  let bannersContainer = infoContainer.querySelector(".kanban-banners");
  if (!bannersContainer) {
    bannersContainer = document.createElement("div");
    bannersContainer.classList.add("kanban-banners");
    infoContainer.insertBefore(bannersContainer, infoContainer.firstChild);
  }
  banners.forEach((banner) => bannersContainer.appendChild(banner));
}
