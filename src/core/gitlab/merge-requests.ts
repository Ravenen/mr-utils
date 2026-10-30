import type { GitLabApi } from "@/core/gitlab/api";
import { requiredApprovals, type Settings } from "@/core/settings";
import { pruneMrRecords, readMrRecord, writeMrRecord, type MrRecord, type MrRef } from "@/core/storage/mr-records";
import { getActivityKey, makeBatches, parseUserId } from "@/utils/mr";
import {
  MERGE_REQUEST_NOTES_PAGE_QUERY,
  MERGE_REQUESTS_NOTES_QUERY,
  MERGE_REQUESTS_QUERY,
  type MergeRequestsResponse,
  type MrNode,
  type MrNotesNode,
  type Note,
  type NotesPage,
  type NotesPageResponse,
} from "./queries";

const MERGE_REQUESTS_BATCH_SIZE = 50;
const COLD_NOTES_BATCH_SIZE = 5;
const NOTES_BATCH_MAX_MRS = 10;
const NOTES_BATCH_MAX_COMMENTS = 150;
const UPDATE_WAVE_MS = 1500;

// Who is asking and what counts as approved; MR data depends on both
export interface LoadContext {
  api: GitLabApi;
  signal: AbortSignal;
  userId: number | null;
  settings: Pick<Settings, "approvalsSource" | "approvalsNeeded">;
}

export interface Activity {
  totalUserThreads: number;
  unresolvedUserThreads: number;
  repliesInUserThreads: number;
  otherComments: number;
}

export interface MrData extends Activity {
  totalThreads: number;
  unresolvedThreads: number;
  approvalsGiven: number;
  approvalsRequired: number;
  hasUserApproved: boolean;
  mrPath: string;
  // GitLab's MR state: "opened", "closed", "merged" or "locked"
  state?: string;
  isDraft?: boolean;
  isReady: boolean;
  hasConflicts: boolean;
  needsRebase: boolean;
  headSha?: string;
}

export const EMPTY_ACTIVITY: Activity = {
  totalUserThreads: 0,
  unresolvedUserThreads: 0,
  repliesInUserThreads: 0,
  otherComments: 0,
};

// All comments of an MR, following pagination from the first page
async function fetchAllNotes(ctx: LoadContext, projectPath: string, mrIid: string, firstPage: NotesPage) {
  const notes = [...firstPage.nodes];
  let pageInfo = firstPage.pageInfo;
  while (pageInfo.hasNextPage) {
    const data = await ctx.api.graphql<NotesPageResponse>(
      MERGE_REQUEST_NOTES_PAGE_QUERY,
      { projectPath, iid: String(mrIid), after: pageInfo.endCursor },
      ctx.signal,
    );
    const page = data?.project?.mergeRequest?.notes;
    if (!page) break;
    notes.push(...page.nodes);
    pageInfo = page.pageInfo;
  }
  return notes;
}

// Summarize comments relative to the current user. Notes come oldest first, so the first note
// seen for a discussion is the one that started it.
export function computeActivity(notes: Note[], userId: number | null): Activity {
  let totalUserThreads = 0,
    unresolvedUserThreads = 0,
    repliesInUserThreads = 0,
    otherComments = 0;
  const threadStartedByUser = new Map<string, boolean>();

  notes.forEach((note) => {
    const discussion = note.discussion;
    const isOtherUserNote = parseUserId(note.author?.id) !== userId;

    // Plain comments
    if (!discussion?.resolvable) {
      if (isOtherUserNote) otherComments++;
      return;
    }

    if (!threadStartedByUser.has(discussion.id)) {
      const isUserThread = !isOtherUserNote;
      threadStartedByUser.set(discussion.id, isUserThread);
      if (isUserThread) {
        totalUserThreads++;
        if (!discussion.resolved) unresolvedUserThreads++;
      }
    }
    if (!isOtherUserNote) return;
    if (threadStartedByUser.get(discussion.id)) repliesInUserThreads++;
    else otherComments++;
  });

  return { totalUserThreads, unresolvedUserThreads, repliesInUserThreads, otherComments };
}

// Combine a stage 2 node with (possibly not yet refreshed) per-user activity for UI
export function processMRData(ctx: LoadContext, mr: MrNode, activity: Activity | null | undefined): MrData {
  const approvalsRequired = requiredApprovals(ctx.settings, mr.approvalsRequired);
  const approvedByIds = (mr.approvedBy?.nodes || []).map((user) => parseUserId(user.id));
  const approvalsGiven = approvedByIds.length;
  const status = mr.detailedMergeStatus;
  const totalThreads = mr.resolvableDiscussionsCount || 0;

  return {
    ...(activity || EMPTY_ACTIVITY),
    totalThreads,
    unresolvedThreads: totalThreads - (mr.resolvedDiscussionsCount || 0),
    approvalsGiven,
    approvalsRequired,
    hasUserApproved: approvedByIds.includes(ctx.userId),
    mrPath: mr.webUrl ? new URL(mr.webUrl).pathname : "",
    state: mr.state,
    isDraft: mr.draft,
    isReady: status === "MERGEABLE" && approvalsGiven >= approvalsRequired,
    hasConflicts: mr.conflicts === true || status === "CONFLICT",
    needsRebase: mr.shouldBeRebased === true || status === "NEED_REBASE",
    headSha: mr.diffHeadSha,
  };
}

async function fetchNodes<N extends { iid: string }>(
  ctx: LoadContext,
  query: string,
  projectPath: string,
  batch: MrRef[],
): Promise<Map<string, N>> {
  const data = await ctx.api.graphql<MergeRequestsResponse<N>>(
    query,
    { projectPath, iids: batch.map((item) => String(item.mrIid)) },
    ctx.signal,
  );
  return new Map((data?.project?.mergeRequests?.nodes || []).map((mr) => [String(mr.iid), mr]));
}

// Activity for every MR of a batch whose comments came back
async function fetchActivities<T extends MrRef>(
  ctx: LoadContext,
  projectPath: string,
  batch: T[],
): Promise<[T, Activity][]> {
  const nodesByIid = await fetchNodes<MrNotesNode>(ctx, MERGE_REQUESTS_NOTES_QUERY, projectPath, batch);
  return Promise.all(
    batch.flatMap((item) => {
      const node = nodesByIid.get(String(item.mrIid));
      if (!node) return [];
      return [
        fetchAllNotes(ctx, projectPath, item.mrIid, node.notes).then((notes): [T, Activity] => [
          item,
          computeActivity(notes, ctx.userId),
        ]),
      ];
    }),
  );
}

export interface LoadOptions<T> {
  onUpdate: (updates: [T, MrData][]) => void;
  onError?: (error: unknown) => void;
  progressive?: boolean;
}

// Load MR details:
//   2. one cheap query per MERGE_REQUESTS_BATCH_SIZE MRs (approvals, status, thread counts);
//   3. comments, only for MRs whose comments changed since stored. For MRs never seen before this
//      starts right away, in parallel with stage 2; otherwise after it, batched by comment count.
// onUpdate([[item, mrData], ...]) gets the updates as they come when progressive; otherwise they are
// grouped: when stage 2 is done, then UPDATE_WAVE_MS later, then when everything is done.
// MRs that fail to load are simply not updated; onError(error) is called per failed batch.
// Nothing is reported once ctx.signal fires.
export async function loadMergeRequestsData<T extends MrRef>(
  ctx: LoadContext,
  items: T[],
  { onUpdate, onError = () => {}, progressive = false }: LoadOptions<T>,
): Promise<void> {
  const isStale = () => ctx.signal.aborted;
  pruneMrRecords();
  interface State {
    record: MrRecord | null;
    mr: MrNode | null;
    activity: Activity | null;
  }
  const state = new Map<T, State>(
    items.map((item) => [item, { record: readMrRecord(ctx.userId, item), mr: null, activity: null }]),
  );
  const stateOf = (item: T) => state.get(item) as State;

  let pending = new Map<T, MrData>();
  const flush = () => {
    if (isStale() || pending.size === 0) return;
    const updates = [...pending];
    pending = new Map();
    onUpdate(updates);
  };
  const update = (item: T) => {
    const s = stateOf(item);
    if (!s.mr || isStale()) return;
    const fallbackActivity = s.mr.userNotesCount === 0 ? EMPTY_ACTIVITY : s.record?.activity;
    pending.set(item, processMRData(ctx, s.mr, s.activity || fallbackActivity));
    if (progressive) flush();
  };
  const store = (item: T) => {
    const s = stateOf(item);
    if (s.mr && s.activity)
      writeMrRecord(ctx.userId, item, {
        mrData: processMRData(ctx, s.mr, s.activity),
        activity: s.activity,
        activityKey: getActivityKey(s.mr),
      });
  };
  const onActivity = ([item, activity]: [T, Activity]) => {
    stateOf(item).activity = activity;
    store(item);
    update(item);
  };
  const run = async (batches: { projectPath: string; batch: T[] }[], load: (p: string, b: T[]) => Promise<void>) => {
    await Promise.all(
      batches.map(async ({ projectPath, batch }) => {
        if (isStale()) return;
        try {
          await load(projectPath, batch);
        } catch (error) {
          if (isStale()) return;
          console.error("MRFlow: failed to load merge requests", error);
          onError(error);
        }
      }),
    );
  };
  const loadActivities = (projectPath: string, batch: T[]) =>
    fetchActivities(ctx, projectPath, batch).then((results) => results.forEach(onActivity));

  // Stage 2. Started first so that its requests are ahead of stage 3 in the request queue.
  const stage2 = run(makeBatches(items, { maxItems: MERGE_REQUESTS_BATCH_SIZE }), async (projectPath, batch) => {
    const nodesByIid = await fetchNodes<MrNode>(ctx, MERGE_REQUESTS_QUERY, projectPath, batch);
    batch.forEach((item) => {
      const mr = nodesByIid.get(String(item.mrIid));
      if (!mr) return;
      const s = stateOf(item);
      s.mr = mr;
      // Stored activity is still exact when the comments did not change
      if (!s.activity && (mr.userNotesCount === 0 || s.record?.activityKey === getActivityKey(mr))) {
        s.activity = mr.userNotesCount === 0 ? EMPTY_ACTIVITY : (s.record?.activity ?? null);
      }
      store(item);
      update(item);
    });
  });

  // Stage 3 for MRs never seen before: nothing to compare against, so no need to wait for stage 2
  const coldItems = items.filter((item) => !stateOf(item).record?.activity);
  const coldStage = run(makeBatches(coldItems, { maxItems: COLD_NOTES_BATCH_SIZE }), loadActivities);

  await stage2;
  flush();
  if (isStale()) return;

  // Stage 3 for MRs seen before whose comments changed, heavy MRs in batches of their own
  const changedItems = items.filter((item) => {
    const s = stateOf(item);
    return s.mr && !s.activity && s.record?.activity;
  });
  const waveTimer = progressive ? null : setTimeout(flush, UPDATE_WAVE_MS);
  await Promise.all([
    coldStage,
    run(
      makeBatches(changedItems, {
        maxItems: NOTES_BATCH_MAX_MRS,
        maxWeight: NOTES_BATCH_MAX_COMMENTS,
        weightOf: (item) => stateOf(item).mr?.userNotesCount || 0,
      }),
      loadActivities,
    ),
  ]);
  if (waveTimer) clearTimeout(waveTimer);
  flush();
}

// Fresh data for a single MR (no shortcuts), remembered for the list; null on failure
export async function getMergeRequestData(
  ctx: LoadContext,
  projectPath: string,
  mrIid: string,
): Promise<MrData | null> {
  try {
    const item = { projectPath, mrIid };
    const [nodesByIid, activities] = await Promise.all([
      fetchNodes<MrNode>(ctx, MERGE_REQUESTS_QUERY, projectPath, [item]),
      fetchActivities(ctx, projectPath, [item]),
    ]);
    const mr = nodesByIid.get(String(mrIid));
    if (!mr) return null;
    const activity = activities[0]?.[1] || EMPTY_ACTIVITY;
    const mrData = processMRData(ctx, mr, activity);
    writeMrRecord(ctx.userId, item, { mrData, activity, activityKey: getActivityKey(mr) });
    return mrData;
  } catch (error) {
    if (!ctx.signal.aborted) console.error("MRFlow: failed to load the merge request", error);
    return null;
  }
}
