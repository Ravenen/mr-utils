import type { Activity, MrData } from "@/core/gitlab/merge-requests";

// What was last shown for an MR: lays out the board before the API answers, and lets
// comments be skipped while they are unchanged. Kept in localStorage, pruned after STORE_MAX_AGE_MS.
const STORE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const PREFIX = "mr-utils/mr/";

export interface MrRef {
  projectPath: string;
  mrIid: string;
}

export interface MrRecord {
  mrData: MrData;
  activity: Activity;
  activityKey: string;
  storedAt?: number;
}

function storeKey(userId: number | null, { projectPath, mrIid }: MrRef): string {
  return `${PREFIX}${userId}/${projectPath}/${mrIid}`;
}

export function readMrRecord(userId: number | null, ref: MrRef): MrRecord | null {
  try {
    return JSON.parse(localStorage.getItem(storeKey(userId, ref)) ?? "null");
  } catch {
    return null;
  }
}

export function writeMrRecord(userId: number | null, ref: MrRef, record: MrRecord): void {
  try {
    localStorage.setItem(storeKey(userId, ref), JSON.stringify({ ...record, storedAt: Date.now() }));
  } catch {
    // Quota exceeded: the board just starts empty next time
  }
}

export function pruneMrRecords(): void {
  const now = Date.now();
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    try {
      if (now - (JSON.parse(localStorage.getItem(key) ?? "null")?.storedAt || 0) > STORE_MAX_AGE_MS)
        localStorage.removeItem(key);
    } catch {
      localStorage.removeItem(key);
    }
  }
}
