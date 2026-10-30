import { browser } from "wxt/browser";

// Reviewed blocks of code per MR (src/utils/hunks.ts), in storage.local["hunk-marks/<project>/<iid>"]:
// { updatedAt, marks: { <block id>: <time ticked> } }. storage.local because an MR with many files
// outgrows localStorage's share of the page origin, and GitLab's own data lives there.
// MRs untouched for MAX_AGE_MS are pruned; merged and closed ones are dropped when opened.
const PREFIX = "hunk-marks/";
const MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;

export type HunkMarks = Record<string, number>;

interface Stored {
  updatedAt: number;
  marks: HunkMarks;
}

export function hunkMarksKey(projectPath: string, iid: string): string {
  return `${PREFIX}${projectPath}/${iid}`;
}

function marksOf(value: unknown): HunkMarks {
  const marks = (value as Stored | undefined)?.marks;
  return marks && typeof marks === "object" ? { ...marks } : {};
}

export async function loadHunkMarks(key: string): Promise<HunkMarks> {
  const stored = await browser.storage.local.get(key);
  return marksOf(stored[key]);
}

// No marks left: the record goes away
export async function saveHunkMarks(key: string, marks: HunkMarks): Promise<void> {
  if (Object.keys(marks).length === 0) return browser.storage.local.remove(key);
  await browser.storage.local.set({ [key]: { updatedAt: Date.now(), marks } satisfies Stored });
}

export function removeHunkMarks(key: string): Promise<void> {
  return browser.storage.local.remove(key);
}

export async function pruneHunkMarks(now = Date.now()): Promise<void> {
  const stored = await browser.storage.local.get(null);
  const old = Object.entries(stored)
    .filter(([key, value]) => key.startsWith(PREFIX) && !(now - ((value as Stored)?.updatedAt || 0) <= MAX_AGE_MS))
    .map(([key]) => key);
  if (old.length > 0) await browser.storage.local.remove(old);
}

// Calls onChange with the MR's marks when another tab changes them
export function watchHunkMarks(key: string, onChange: (marks: HunkMarks) => void, signal: AbortSignal): void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === "local" && key in changes) onChange(marksOf(changes[key]?.newValue));
  };
  browser.storage.onChanged.addListener(listener);
  signal.addEventListener("abort", () => browser.storage.onChanged.removeListener(listener), { once: true });
}
