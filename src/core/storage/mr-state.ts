// Per-MR state in localStorage["<canonical MR path>/mr-utils"]: approval checks and what the user
// has seen (drives NEW COMMITS/REPLIES/COMMENTS banners in the list). The format is published, keep it.
const STORAGE_SUFFIX = "/mr-utils";

export interface MrState {
  head_sha?: string;
  other_comments?: number;
  replies_in_user_threads?: number;
  checks_head_sha?: string;
  // "<id>_check": ticked or not
  [key: string]: unknown;
}

export function readMrState(mrPath: string): MrState {
  try {
    return JSON.parse(localStorage.getItem(mrPath + STORAGE_SUFFIX) ?? "null") || {};
  } catch {
    return {};
  }
}

export function writeMrState(mrPath: string, data: MrState): void {
  localStorage.setItem(mrPath + STORAGE_SUFFIX, JSON.stringify(data));
}

// Records used to be keyed by the raw path ("/123/diffs", "/123/commits", ...): fold them into the canonical one
export function migrateMrState(rawPathname: string, mrPath: string): void {
  const rawPath = rawPathname.replace(/\/$/, "");
  if (rawPath === mrPath || localStorage.getItem(rawPath + STORAGE_SUFFIX) === null) return;
  writeMrState(mrPath, { ...readMrState(rawPath), ...readMrState(mrPath) });
  localStorage.removeItem(rawPath + STORAGE_SUFFIX);
}
