import { browser } from "wxt/browser";

export interface Settings {
  approvalsNeeded: number;
  kanbanView: boolean;
  boardLoading: "all" | "progressive";
  animateCards: boolean;
  resetChecksOnNewCommits: boolean;
}

const KEYS = ["approvalsNeeded", "kanbanView", "boardLoading", "animateCards", "resetChecksOnNewCommits"];

// Read on every navigation, so changes made in the popup apply on the next page
export async function loadSettings(): Promise<Settings> {
  const res = await browser.storage.sync.get(KEYS);
  return {
    approvalsNeeded: parseInt(String(res.approvalsNeeded), 10) || 3,
    kanbanView: res.kanbanView !== undefined ? Boolean(res.kanbanView) : true,
    boardLoading: res.boardLoading === "progressive" ? "progressive" : "all",
    animateCards: res.animateCards !== undefined ? Boolean(res.animateCards) : true,
    resetChecksOnNewCommits: res.resetChecksOnNewCommits !== undefined ? Boolean(res.resetChecksOnNewCommits) : true,
  };
}
