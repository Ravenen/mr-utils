import { beforeEach, describe, expect, it } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";
import {
  DEFAULT_SETTINGS,
  exportSettings,
  loadSettings,
  migrateSettings,
  normalizeSettings,
  parseImportedSettings,
  requiredApprovals,
  saveSettings,
  watchSettings,
} from ".";

describe("migrateSettings", () => {
  it("gives defaults to a new install", () => {
    expect(migrateSettings({})).toEqual({ settings: DEFAULT_SETTINGS, migrated: false });
  });

  it("keeps a 1.5 user's settings, including their number of approvals as the source", () => {
    const { settings, migrated } = migrateSettings({
      approvalsNeeded: "2",
      kanbanView: false,
      boardLoading: "progressive",
      animateCards: false,
      resetChecksOnNewCommits: false,
    });
    expect(migrated).toBe(true);
    expect(settings).toEqual({
      version: 2,
      approvalsSource: "setting",
      approvalsNeeded: 2,
      kanbanView: false,
      boardLoading: "progressive",
      animateCards: false,
      approvalGuard: true,
      resetChecksOnNewCommits: false,
      hunkReview: true,
      hunkCollapseViewed: true,
      hunkHotkeys: true,
    });
  });

  it("lets a 1.5 user who never set approvals get them from GitLab", () => {
    expect(migrateSettings({ kanbanView: true }).settings.approvalsSource).toBe("gitlab");
  });

  it("reads current settings as they are", () => {
    const settings = { ...DEFAULT_SETTINGS, kanbanView: false };
    expect(migrateSettings({ settings })).toEqual({ settings, migrated: false });
  });
});

describe("normalizeSettings", () => {
  it("replaces invalid values with defaults", () => {
    expect(normalizeSettings({ approvalsNeeded: 0, boardLoading: "fast", kanbanView: "yes", extra: 1 })).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  it("turns a feature added after the stored settings on", () => {
    const older: Partial<typeof DEFAULT_SETTINGS> = { ...DEFAULT_SETTINGS, kanbanView: false };
    delete older.hunkReview;
    expect(normalizeSettings(older)).toEqual({ ...DEFAULT_SETTINGS, kanbanView: false });
  });
});

describe("requiredApprovals", () => {
  it("uses GitLab's rules only when asked to and present", () => {
    expect(requiredApprovals({ approvalsSource: "gitlab", approvalsNeeded: 3 }, 1)).toBe(1);
    expect(requiredApprovals({ approvalsSource: "gitlab", approvalsNeeded: 3 }, 0)).toBe(3);
    expect(requiredApprovals({ approvalsSource: "gitlab", approvalsNeeded: 3 }, null)).toBe(3);
    expect(requiredApprovals({ approvalsSource: "setting", approvalsNeeded: 3 }, 1)).toBe(3);
  });
});

describe("settings store", () => {
  beforeEach(() => fakeBrowser.reset());

  it("migrates 1.5 keys once and drops them", async () => {
    await browser.storage.sync.set({ approvalsNeeded: 4, kanbanView: false });
    expect(await loadSettings()).toMatchObject({ approvalsNeeded: 4, approvalsSource: "setting", kanbanView: false });
    expect(await browser.storage.sync.get(null)).toEqual({
      settings: expect.objectContaining({ version: 2, approvalsNeeded: 4 }),
    });
  });

  it("saves changes and tells watchers", async () => {
    const seen: boolean[] = [];
    watchSettings((settings) => seen.push(settings.kanbanView), new AbortController().signal);
    await saveSettings({ kanbanView: false });
    expect((await loadSettings()).kanbanView).toBe(false);
    expect(seen).toEqual([false]);
  });

  it("round-trips through export and import", () => {
    const settings = { ...DEFAULT_SETTINGS, approvalsNeeded: 5, boardLoading: "progressive" as const };
    expect(parseImportedSettings(exportSettings(settings))).toEqual(settings);
    expect(parseImportedSettings('{"kanbanView": false}').kanbanView).toBe(false);
    expect(() => parseImportedSettings("not json")).toThrow();
  });
});
