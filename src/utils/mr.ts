// Pure helpers shared by the content script. Kept free of DOM and globals so they can be unit-tested.

// "/group/project/-/merge_requests/123/diffs" -> "/group/project/-/merge_requests/123"
export function getCanonicalMrPath(pathname: string): string {
  const match = pathname.match(/^(.*?\/merge_requests\/\d+)/);
  return match?.[1] ?? pathname;
}

// "gid://gitlab/User/42" or 42 -> 42
export function parseUserId(id: string | number | null | undefined): number | null {
  if (id === undefined || id === null) return null;
  return parseInt(String(id).split("/").pop() ?? "", 10);
}

export interface ActivityKeySource {
  updatedAt?: string;
  userNotesCount?: number;
  resolvableDiscussionsCount?: number;
  resolvedDiscussionsCount?: number;
}

// Comments only need refetching when one of these changes. updatedAt alone is not enough:
// GitLab throttles touching the MR when notes change.
export function getActivityKey(mr: ActivityKeySource): string {
  return [mr.updatedAt, mr.userNotesCount, mr.resolvableDiscussionsCount, mr.resolvedDiscussionsCount].join("|");
}

export interface Batch<T> {
  projectPath: string;
  batch: T[];
}

// Split items into per-project batches of at most maxItems items and, when weightOf is given,
// at most maxWeight total weight (an item heavier than maxWeight gets a batch of its own)
export function makeBatches<T extends { projectPath: string }>(
  items: T[],
  {
    maxItems,
    maxWeight = Infinity,
    weightOf = () => 0,
  }: { maxItems: number; maxWeight?: number; weightOf?: (item: T) => number },
): Batch<T>[] {
  const itemsByProject = new Map<string, T[]>();
  items.forEach((item) => {
    const projectItems = itemsByProject.get(item.projectPath) ?? [];
    projectItems.push(item);
    itemsByProject.set(item.projectPath, projectItems);
  });
  const batches: Batch<T>[] = [];
  for (const [projectPath, projectItems] of itemsByProject) {
    let batch: T[] = [],
      weight = 0;
    for (const item of projectItems) {
      const itemWeight = weightOf(item);
      if (batch.length > 0 && (batch.length >= maxItems || weight + itemWeight > maxWeight)) {
        batches.push({ projectPath, batch });
        batch = [];
        weight = 0;
      }
      batch.push(item);
      weight += itemWeight;
    }
    if (batch.length > 0) batches.push({ projectPath, batch });
  }
  return batches;
}
