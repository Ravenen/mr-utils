// Settings: one versioned object in storage.sync. Normalizing and migrating are pure, so they are
// shared by the content script, the popup, the options page and import.

export const SETTINGS_VERSION = 2;

export interface Settings {
  version: typeof SETTINGS_VERSION;
  // Where the number of required approvals comes from: GitLab's approval rules, or approvalsNeeded
  approvalsSource: "gitlab" | "setting";
  // Required approvals when approvalsSource is "setting", or when the MR has no approval rules
  approvalsNeeded: number;
  kanbanView: boolean;
  boardLoading: "all" | "progressive";
  animateCards: boolean;
  approvalGuard: boolean;
  resetChecksOnNewCommits: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  approvalsSource: "gitlab",
  approvalsNeeded: 3,
  kanbanView: true,
  boardLoading: "all",
  animateCards: true,
  approvalGuard: true,
  resetChecksOnNewCommits: true,
};

// Keys MRFlow 1.x kept at the top level of storage.sync
export const LEGACY_KEYS = ["approvalsNeeded", "kanbanView", "boardLoading", "animateCards", "resetChecksOnNewCommits"];

const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);

// Any object (stored, imported, half-filled) to valid settings: unknown or invalid fields get defaults
export function normalizeSettings(raw: unknown): Settings {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const approvalsNeeded = parseInt(String(value.approvalsNeeded), 10);
  return {
    version: SETTINGS_VERSION,
    approvalsSource: value.approvalsSource === "setting" ? "setting" : DEFAULT_SETTINGS.approvalsSource,
    approvalsNeeded: approvalsNeeded >= 1 ? approvalsNeeded : DEFAULT_SETTINGS.approvalsNeeded,
    kanbanView: bool(value.kanbanView, DEFAULT_SETTINGS.kanbanView),
    boardLoading: value.boardLoading === "progressive" ? "progressive" : "all",
    animateCards: bool(value.animateCards, DEFAULT_SETTINGS.animateCards),
    approvalGuard: bool(value.approvalGuard, DEFAULT_SETTINGS.approvalGuard),
    resetChecksOnNewCommits: bool(value.resetChecksOnNewCommits, DEFAULT_SETTINGS.resetChecksOnNewCommits),
  };
}

// What storage.sync holds to settings. `migrated` tells the caller to write them back and drop the 1.x keys.
export function migrateSettings(stored: Record<string, unknown>): { settings: Settings; migrated: boolean } {
  const current = stored.settings as { version?: unknown } | undefined;
  if (current && typeof current === "object" && current.version === SETTINGS_VERSION) {
    return { settings: normalizeSettings(current), migrated: false };
  }

  // 1.x: flat keys. A user who set the number of approvals keeps it as the source, as before;
  // everyone else gets the number from GitLab's approval rules.
  const legacy = Object.fromEntries(LEGACY_KEYS.filter((key) => key in stored).map((key) => [key, stored[key]]));
  if (Object.keys(legacy).length > 0) {
    return {
      settings: normalizeSettings({
        ...legacy,
        approvalsSource: "approvalsNeeded" in legacy ? "setting" : "gitlab",
      }),
      migrated: true,
    };
  }
  return { settings: DEFAULT_SETTINGS, migrated: false };
}

// The number of approvals an MR needs: GitLab's rules when asked for and present, otherwise the setting
export function requiredApprovals(
  settings: Pick<Settings, "approvalsSource" | "approvalsNeeded">,
  fromGitLab: number | null | undefined,
): number {
  if (settings.approvalsSource === "gitlab" && fromGitLab && fromGitLab > 0) return fromGitLab;
  return settings.approvalsNeeded;
}
