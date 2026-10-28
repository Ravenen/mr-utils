// == GitLab MR Utils Content Script ==

let g_requiredApprovals;
let g_isKanbanView;
let g_boardLoading;
let g_resetChecksOnNewCommits;
let g_currentUserId;
let g_currentBoard = null;
let g_originalListContainer = null;
let g_listRunId = 0;

const MR_PAGE_RE = /merge_requests\/\d+/;
const STORAGE_SUFFIX = "/mr-utils";
const MAX_CONCURRENT_REQUESTS = 4;
const MAX_RETRIES = 3;
const MAX_RETRY_AFTER_S = 10;
const MERGE_REQUESTS_BATCH_SIZE = 50;
const DISCUSSIONS_BATCH_SIZE = 5;
const STORE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const WAIT_TIMEOUT_MS = 30 * 1000;

// Helper: Get browser API (cross-browser)
function getBrowserApi() {
  return typeof browser !== "undefined" ? browser : chrome;
}

// Helper: Sleep
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper: Poll until getter returns a truthy value, the run goes stale, or the timeout expires
async function waitFor(getter, { timeout = WAIT_TIMEOUT_MS, interval = 100, isStale = () => false } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (isStale()) return null;
    const value = getter();
    if (value) return value;
    await sleep(interval);
  }
  return null;
}

// Helper: Read/write the per-MR record in localStorage
function readSavedData(mrPath) {
  try {
    return JSON.parse(localStorage.getItem(mrPath + STORAGE_SUFFIX)) || {};
  } catch {
    return {};
  }
}

function writeSavedData(mrPath, data) {
  localStorage.setItem(mrPath + STORAGE_SUFFIX, JSON.stringify(data));
}

// Helper: "/group/project/-/merge_requests/123/diffs" -> "/group/project/-/merge_requests/123"
function getCanonicalMrPath(pathname) {
  const match = pathname.match(/^(.*?\/merge_requests\/\d+)/);
  return match ? match[1] : pathname;
}

// Helper: "gid://gitlab/User/42" or 42 -> 42
function parseUserId(id) {
  if (id === undefined || id === null) return null;
  return parseInt(String(id).split("/").pop(), 10);
}

// Initialize global settings and user ID
async function initData() {
  const browserApi = getBrowserApi();
  const res = await browserApi.storage.sync.get(["approvalsNeeded", "kanbanView", "boardLoading", "resetChecksOnNewCommits"]);
  g_requiredApprovals = parseInt(res.approvalsNeeded, 10) || 3;
  g_isKanbanView = res.kanbanView !== undefined ? res.kanbanView : true;
  g_boardLoading = res.boardLoading === "progressive" ? "progressive" : "all";
  g_resetChecksOnNewCommits = res.resetChecksOnNewCommits !== undefined ? res.resetChecksOnNewCommits : true;

  const parsedUrl = new URL(window.location.href);
  g_isKanbanView = g_isKanbanView && (!parsedUrl.searchParams.has("state") || parsedUrl.searchParams.get("state") === "opened");

  g_currentUserId = await getCurrentUserId();
}

// Clean up existing board (including boards left behind by stale runs)
function cleanupBoard() {
  document.querySelectorAll(".kanban-board, .mrflow-alert").forEach(el => el.remove());
  g_currentBoard = null;
  if (g_originalListContainer) {
    g_originalListContainer.style.visibility = "";
    g_originalListContainer.style.position = "";
    g_originalListContainer.style.left = "";
    g_originalListContainer = null;
  }
}

// URL change detection
let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    onUrlChange();
  }
}).observe(document, { subtree: true, childList: true });

// Handle URL changes (e.g. GitLab's redirect to "?sort=...&state=opened", filters, pagination)
function onUrlChange() {
  if (!MR_PAGE_RE.test(location.pathname)) {
    cleanupBoard();
    mergeRequestsList();
  }
}

// == MR List (Kanban) ==

async function mergeRequestsList() {
  // Every call supersedes the previous one; a superseded run stops at its next checkpoint
  const runId = ++g_listRunId;
  const isStale = () => runId !== g_listRunId;

  await initData();
  if (isStale()) return;

  // Native MR items only, never the clones on our own board
  function getNativeMergeRequestElements() {
    return [...document.querySelectorAll(".merge-request")].filter(el => !el.closest(".kanban-board"));
  }

  // Create Kanban board structure
  function createKanbanBoard(mrListContainer) {
    cleanupBoard();

    const kanbanBoard = document.createElement("div");
    kanbanBoard.classList.add("kanban-board");

    const columns = ["To Review", "Pending", "Approved"];
    columns.forEach(columnName => {
      const column = document.createElement("div");
      column.classList.add("kanban-column");
      column.dataset.column = columnName;

      const header = document.createElement("div");
      header.classList.add("kanban-column-header");
      header.textContent = columnName;

      const body = document.createElement("ul");
      body.classList.add("content-list", "mr-list", "issuable-list", "kanban-column-body");

      column.appendChild(header);
      column.appendChild(body);
      kanbanBoard.appendChild(column);
    });

    g_originalListContainer = mrListContainer;
    mrListContainer.parentNode.insertBefore(kanbanBoard, mrListContainer);
    mrListContainer.style.visibility = "hidden";
    mrListContainer.style.position = "absolute";
    mrListContainer.style.left = "-9999px";
    g_currentBoard = kanbanBoard;
    return kanbanBoard;
  }

  // Add MR count to each column header
  function addColumnCounts(columns) {
    Object.keys(columns).forEach(columnName => {
      const column = columns[columnName];
      const header = column.parentElement.querySelector('.kanban-column-header');
      const count = column.querySelectorAll(".mr-card").length;
      let countElement = header.querySelector('.kanban-count');
      if (!countElement) {
        countElement = document.createElement('span');
        countElement.classList.add('kanban-count');
        header.appendChild(countElement);
      }
      countElement.textContent = ` (${count})`;
    });
  }

  // Small native GitLab spinner in the column headers while details are still loading
  function setColumnsLoading(columns, isLoading) {
    Object.values(columns).forEach(column => {
      const header = column.parentElement.querySelector(".kanban-column-header");
      header.querySelector(".mrflow-loading")?.remove();
      if (!isLoading) return;
      const spinner = document.createElement("span");
      spinner.className = "mrflow-loading gl-spinner gl-spinner-sm gl-spinner-dark gl-ml-2 gl-align-middle";
      spinner.setAttribute("aria-label", "Loading");
      header.appendChild(spinner);
    });
  }

  function getColumnName(mrData) {
    if (mrData?.hasUserApproved) return "Approved";
    if (mrData?.unresolvedUserThreads > 0) return "Pending";
    return "To Review";
  }

  // Decorate an MR element (a board clone, or the native item in list view)
  function decorateMergeRequest(mrElement, mrData, { showSeenBanners }) {
    addBadges(mrElement, mrData);
    addBanners(mrElement, mrData, { showSeenBanners });
    if (mrData.isDraft) mrElement.classList.add("dimmed");
    if (mrData.isReady) mrElement.classList.add("mr-ready");
  }

  // Put a decorated clone of the native item into its column, replacing the item's previous card.
  // Order inside a column is kept via CSS `order`.
  const cards = new Map();
  function renderCard(columns, item, mrData) {
    const card = item.mrElement.cloneNode(true);
    card.classList.add("mr-card");
    card.classList.remove("!gl-flex");
    card.style.order = item.index;
    // Remove all classes except 'issuable-meta' to fix styling issues
    const metaEl = card.getElementsByClassName("issuable-meta")?.[0];
    if (metaEl) {
      metaEl.className = "issuable-meta"
    }
    const columnName = getColumnName(mrData);
    if (mrData) decorateMergeRequest(card, mrData, { showSeenBanners: columnName !== "To Review" });
    cards.get(item)?.remove();
    cards.set(item, card);
    columns[columnName].appendChild(card);
  }

  // Main: Process all MRs on the page
  async function processMergeRequests() {
    // Wait for MR elements to appear (an empty list never gets any, hence the timeout)
    const mergeRequestElementsArr = await waitFor(() => {
      const elements = getNativeMergeRequestElements();
      return elements.length > 0 ? elements : null;
    }, { isStale });
    if (!mergeRequestElementsArr || isStale()) return;

    // Collect MR references from the list
    const items = [];
    mergeRequestElementsArr.forEach((mrElement, index) => {
      if (mrElement.tagName !== "LI") return;
      const mrLink = mrElement.querySelector("[data-testid='issuable-title-link']");
      if (!mrLink) return;

      const url = new URL(mrLink.getAttribute("href"), window.location.origin);
      const matches = url.pathname.match(/^\/(.*?)\/-\/merge_requests\/(\d+)/);
      if (!matches) return;

      items.push({ index, mrElement, projectPath: matches[1], mrIid: matches[2] });
    });

    const onError = error => {
      if (!isStale()) showApiError(mergeRequestElementsArr[0].closest("ul"), error);
    };

    // Native list view: decorate the native items once all details are in
    if (!g_isKanbanView) {
      const dataByItem = new Map();
      await loadMergeRequestsData(items, {
        isStale, onError,
        onUpdate: updates => updates.forEach(([item, mrData]) => dataByItem.set(item, mrData)),
      });
      if (isStale()) return;
      dataByItem.forEach((mrData, item) => {
        decorateMergeRequest(item.mrElement, mrData, { showSeenBanners: false });
        if (mrData.hasUserApproved && !mrData.isDraft) item.mrElement.classList.add("greened");
      });
      return;
    }

    const mrListContainer = mergeRequestElementsArr[0].closest("ul");
    if (!mrListContainer) {
      console.error("Cannot find the merge requests list container element.");
      return;
    }
    const kanbanBoard = createKanbanBoard(mrListContainer);
    const columns = {
      "To Review": kanbanBoard.querySelector('[data-column="To Review"] .kanban-column-body'),
      Pending: kanbanBoard.querySelector('[data-column="Pending"] .kanban-column-body'),
      Approved: kanbanBoard.querySelector('[data-column="Approved"] .kanban-column-body'),
    };

    // Stage 1: lay the board out right away from what was last seen for each MR (if anything)
    items.forEach(item => renderCard(columns, item, readStoredMergeRequest(item)?.mrData || null));
    addColumnCounts(columns);
    setColumnsLoading(columns, true);

    // Stages 2 and 3: details from the API; updates come per batch or, by default, once per stage
    await loadMergeRequestsData(items, {
      isStale, onError,
      progressive: g_boardLoading === "progressive",
      onUpdate: updates => {
        if (isStale()) return;
        updates.forEach(([item, mrData]) => renderCard(columns, item, mrData));
        addColumnCounts(columns);
      },
    });
    if (!isStale()) setColumnsLoading(columns, false);
  }

  // Add badges to MR card
  function addBadges(mrElement, mrData) {
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
        'Total threads',
        mrData.unresolvedThreads === 0 ? "badge-success" : "badge-danger"
      );
      threadsBadgesContainer.appendChild(threadsBadge);
      prependIcon(threadsBadge, 'comments');

      if (mrData.totalUserThreads > 0) {
        const userThreadsBadge = constructBadge(
          `${mrData.totalUserThreads - mrData.unresolvedUserThreads}/${mrData.totalUserThreads}`,
          'Your threads',
          mrData.unresolvedUserThreads === 0 ? "badge-success" : "badge-danger"
        );
        threadsBadgesContainer.appendChild(userThreadsBadge);
        prependIcon(userThreadsBadge, 'comment-dots');
      }

      // Remove native comments badge if present
      const nativeCommentsBadge = controlsContainer.querySelector('[data-testid="comments-icon"]')?.parentNode?.parentNode;
      if (nativeCommentsBadge) {
        nativeCommentsBadge.insertAdjacentElement("afterend", threadsBadgesContainer);
        nativeCommentsBadge.remove();
      }
    }

    // Approvals badge
    const approvalsBadge = constructBadge(
      `${mrData.approvalsGiven}/${mrData.approvalsRequired}`,
      'Approvals number',
      mrData.approvalsGiven >= mrData.approvalsRequired ? "badge-success" : "badge-danger"
    );
    const nativeApprovalBadge = controlsContainer.querySelector('[data-testid="mr-approvals"]');
    if (nativeApprovalBadge) {
      nativeApprovalBadge.classList.add("gl-flex");
      nativeApprovalBadge.appendChild(approvalsBadge);
    }
  }

  // Add banners to MR card: actions needed (CONFLICTS/NEEDS REBASE) and news since last visit
  function addBanners(mrElement, mrData, { showSeenBanners }) {
    const infoContainer = mrElement.querySelector(".issuable-main-info");
    if (!infoContainer) return;

    const banners = [];
    if (mrData.hasConflicts) {
      banners.push(constructActionBanner("CONFLICTS", "Resolve conflicts with the target branch before merging", "warning-solid"));
    } else if (mrData.needsRebase) {
      banners.push(constructActionBanner("NEEDS REBASE", "Rebase the source branch onto the target branch before merging", "branch"));
    }

    // Fields missing from the saved record mean "never seen": no banner instead of a false one
    const saved = readSavedData(mrData.mrPath);
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
    banners.forEach(banner => bannersContainer.appendChild(banner));
  }

  // Badge factory
  function constructBadge(text, title, badgeStyle) {
    const badgeSpan = document.createElement("span");
    badgeSpan.className = `gl-badge badge badge-pill has-tooltip ${badgeStyle}`;
    badgeSpan.textContent = text;
    badgeSpan.title = title;
    return badgeSpan;
  }

  // Banner factory
  function constructBanner(text, title, badgeStyle) {
    const badgeSpan = document.createElement("span");
    badgeSpan.className = `gl-badge badge has-tooltip ${badgeStyle} font-weight-bold`;
    badgeSpan.textContent = text;
    badgeSpan.title = title;
    return badgeSpan;
  }

  // Banner for something the author has to do: red, with an icon
  function constructActionBanner(text, title, iconName) {
    const banner = constructBanner(text, title, "badge-danger");
    banner.classList.add("mrflow-banner-action");
    prependIcon(banner, iconName);
    return banner;
  }

  // SVG icon factory (uses GitLab's sprite; its URL is hashed per deploy, so take it from the page)
  function prependIcon(target, iconName) {
    const spriteUrl = getIconSpriteUrl();
    if (!spriteUrl) return;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('s14', 'gl-align-middle');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `${spriteUrl}#${iconName}`);
    svg.appendChild(use);
    target.prepend(svg);
  }

  // Start processing
  processMergeRequests();
}

// Native GitLab alert above the list, e.g. when the API rate limit is hit
function showApiError(anchor, error) {
  if (!anchor || document.querySelector(".mrflow-alert")) return;
  const minutes = error.retryAfter ? Math.ceil(error.retryAfter / 60) : null;
  const message = error.status === 429
    ? `MRFlow: GitLab API rate limit reached${minutes ? `, try again in ~${minutes} min` : ""}. Some badges are missing.`
    : "MRFlow: could not load merge request details from GitLab. Some badges are missing.";

  const alert = document.createElement("div");
  alert.className = "mrflow-alert gl-alert gl-alert-warning gl-alert-not-dismissible gl-my-3";
  const content = document.createElement("div");
  content.className = "gl-alert-content";
  const body = document.createElement("div");
  body.className = "gl-alert-body";
  body.textContent = message;
  content.appendChild(body);
  alert.appendChild(content);
  const board = document.querySelector(".kanban-board");
  (board || anchor).insertAdjacentElement("beforebegin", alert);
}

// == API Helpers ==

let g_activeRequests = 0;
const g_requestQueue = [];

async function acquireRequestSlot() {
  if (g_activeRequests < MAX_CONCURRENT_REQUESTS) {
    g_activeRequests++;
    return;
  }
  await new Promise(resolve => g_requestQueue.push(resolve));
}

function releaseRequestSlot() {
  const next = g_requestQueue.shift();
  if (next) next();
  else g_activeRequests--;
}

class ApiError extends Error {
  constructor(status, path, retryAfter) {
    super(`GitLab API ${status}: ${path}`);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

// Request the GitLab API with a concurrency limit. A 429 is retried only when GitLab asks
// for a short wait; a long Retry-After (gitlab.com can answer with ~1 hour) fails fast.
async function apiFetch(path, options = {}) {
  await acquireRequestSlot();
  try {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(`${window.location.origin}${path}`, { credentials: "same-origin", ...options });
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get("retry-after"), 10);
        const waitS = Number.isFinite(retryAfter) ? retryAfter : 2 ** attempt;
        if (attempt < MAX_RETRIES && waitS <= MAX_RETRY_AFTER_S) {
          await sleep(waitS * 1000);
          continue;
        }
        throw new ApiError(429, path, Number.isFinite(retryAfter) ? retryAfter : null);
      }
      if (!response.ok) throw new ApiError(response.status, path);
      return response;
    }
  } finally {
    releaseRequestSlot();
  }
}

// Identical requests still in flight (e.g. from a run superseded by GitLab's redirect) are shared
const g_inflightGraphql = new Map();

// GraphQL with the session cookie: GitLab treats a POST without the CSRF token as anonymous
function graphqlFetch(query, variables) {
  const body = JSON.stringify({ query, variables });
  if (g_inflightGraphql.has(body)) return g_inflightGraphql.get(body);

  const request = (async () => {
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute("content");
    const response = await apiFetch("/api/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}) },
      body,
    });
    const result = await response.json();
    if (result.errors?.length && !result.data) throw new Error(`GitLab GraphQL: ${result.errors[0].message}`);
    return result.data;
  })();
  g_inflightGraphql.set(body, request);
  request.finally(() => g_inflightGraphql.delete(body)).catch(() => {});
  return request;
}

// Get current user ID (cached for the tab session)
async function getCurrentUserId() {
  const cacheKey = "mr-utils/current-user-id";
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) return parseInt(cached, 10);
  try {
    const userData = await (await apiFetch("/api/v4/user")).json();
    sessionStorage.setItem(cacheKey, String(userData.id));
    return userData.id;
  } catch {
    return null;
  }
}

// Stage 2: everything except discussions. Cheap, so batches are large.
const MERGE_REQUESTS_QUERY = `
  query MRFlowMergeRequests($projectPath: ID!, $iids: [String!]) {
    project(fullPath: $projectPath) {
      mergeRequests(iids: $iids, first: 100) {
        nodes {
          iid
          webUrl
          draft
          updatedAt
          detailedMergeStatus
          shouldBeRebased
          conflicts
          diffHeadSha
          userNotesCount
          resolvableDiscussionsCount
          resolvedDiscussionsCount
          approvedBy { nodes { id } }
        }
      }
    }
  }`;

// Stage 3: discussions, only for MRs whose comments changed. Heavy, so batches are small.
const MERGE_REQUESTS_DISCUSSIONS_QUERY = `
  query MRFlowMergeRequestsDiscussions($projectPath: ID!, $iids: [String!]) {
    project(fullPath: $projectPath) {
      mergeRequests(iids: $iids, first: 100) {
        nodes {
          iid
          discussions(first: 100) {
            pageInfo { hasNextPage }
            nodes {
              resolvable
              resolved
              notes(first: 100) { nodes { system author { id } } }
            }
          }
        }
      }
    }
  }`;

// Fetch all discussions through REST (only for MRs with more than 100 discussions), in the GraphQL shape
async function fetchAllDiscussions(projectPath, mrIid) {
  const baseUrl = `/api/v4/projects/${encodeURIComponent(projectPath)}/merge_requests/${mrIid}`;
  let discussions = [];
  let nextPage = 1;
  while (nextPage) {
    const response = await apiFetch(`${baseUrl}/discussions?per_page=100&page=${nextPage}`);
    discussions = discussions.concat(await response.json());
    nextPage = response.headers.get("x-next-page");
  }
  return discussions.map(discussion => ({
    resolvable: !discussion.individual_note && discussion.notes.some(note => note.resolvable),
    resolved: discussion.notes[0]?.resolved === true,
    notes: { nodes: discussion.notes.map(note => ({ system: note.system, author: { id: note.author?.id } })) },
  }));
}

// Summarize discussions relative to the current user
function computeActivity(discussions) {
  let totalUserThreads = 0, unresolvedUserThreads = 0, repliesInUserThreads = 0, otherComments = 0;
  const isOtherUserNote = note => !note.system && parseUserId(note.author?.id) !== g_currentUserId;

  discussions.forEach(discussion => {
    const notes = discussion.notes?.nodes || [];
    if (notes.length === 0) return;

    // Plain comments and system notes
    if (!discussion.resolvable) {
      otherComments += notes.filter(isOtherUserNote).length;
      return;
    }

    if (parseUserId(notes[0].author?.id) === g_currentUserId) {
      totalUserThreads++;
      if (!discussion.resolved) unresolvedUserThreads++;
      repliesInUserThreads += notes.filter(isOtherUserNote).length;
    } else {
      otherComments += notes.filter(isOtherUserNote).length;
    }
  });

  return { totalUserThreads, unresolvedUserThreads, repliesInUserThreads, otherComments };
}

const EMPTY_ACTIVITY = { totalUserThreads: 0, unresolvedUserThreads: 0, repliesInUserThreads: 0, otherComments: 0 };

// Discussions only need refetching when one of these changes. updatedAt alone is not enough:
// GitLab throttles touching the MR when notes change.
function getActivityKey(mr) {
  return [mr.updatedAt, mr.userNotesCount, mr.resolvableDiscussionsCount, mr.resolvedDiscussionsCount].join("|");
}

// Combine a stage 2 node with (possibly not yet refreshed) per-user activity for UI
function processMRData(mr, activity) {
  const approvalsRequired = g_requiredApprovals;
  const approvedByIds = (mr.approvedBy?.nodes || []).map(user => parseUserId(user.id));
  const approvalsGiven = approvedByIds.length;
  const status = mr.detailedMergeStatus;
  const totalThreads = mr.resolvableDiscussionsCount || 0;

  return {
    ...(activity || EMPTY_ACTIVITY),
    totalThreads,
    unresolvedThreads: totalThreads - (mr.resolvedDiscussionsCount || 0),
    approvalsGiven,
    approvalsRequired,
    hasUserApproved: approvedByIds.includes(g_currentUserId),
    mrPath: mr.webUrl ? new URL(mr.webUrl).pathname : "",
    isDraft: mr.draft,
    isReady: status === "MERGEABLE" && approvalsGiven >= approvalsRequired,
    hasConflicts: mr.conflicts === true || status === "CONFLICT",
    needsRebase: mr.shouldBeRebased === true || status === "NEED_REBASE",
    headSha: mr.diffHeadSha,
  };
}

// What was last shown for an MR: lays out the board before the API answers, and lets
// discussions be skipped while they are unchanged. Kept in localStorage, pruned after STORE_MAX_AGE_MS.
function storeKey({ projectPath, mrIid }) {
  return `mr-utils/mr/${g_currentUserId}/${projectPath}/${mrIid}`;
}

function readStoredMergeRequest(item) {
  try {
    return JSON.parse(localStorage.getItem(storeKey(item)));
  } catch {
    return null;
  }
}

function writeStoredMergeRequest(item, record) {
  try {
    localStorage.setItem(storeKey(item), JSON.stringify({ ...record, storedAt: Date.now() }));
  } catch {}
}

function pruneStoredMergeRequests() {
  const now = Date.now();
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (!key?.startsWith("mr-utils/mr/")) continue;
    try {
      if (now - (JSON.parse(localStorage.getItem(key))?.storedAt || 0) > STORE_MAX_AGE_MS) localStorage.removeItem(key);
    } catch {
      localStorage.removeItem(key);
    }
  }
}

// Run fn(projectPath, batchItems) for every project and batch of `size` items
function forEachBatch(items, size, fn) {
  const itemsByProject = new Map();
  items.forEach(item => {
    if (!itemsByProject.has(item.projectPath)) itemsByProject.set(item.projectPath, []);
    itemsByProject.get(item.projectPath).push(item);
  });
  const tasks = [];
  for (const [projectPath, projectItems] of itemsByProject) {
    for (let i = 0; i < projectItems.length; i += size) {
      tasks.push(fn(projectPath, projectItems.slice(i, i + size)));
    }
  }
  return Promise.all(tasks);
}

async function fetchNodes(query, projectPath, batch) {
  const data = await graphqlFetch(query, { projectPath, iids: batch.map(item => String(item.mrIid)) });
  return new Map((data?.project?.mergeRequests?.nodes || []).map(mr => [String(mr.iid), mr]));
}

// Load MR details in two stages:
//   2. one cheap query per MERGE_REQUESTS_BATCH_SIZE MRs (approvals, status, thread counts);
//   3. discussions per DISCUSSIONS_BATCH_SIZE MRs, only for MRs whose comments changed since stored.
// onUpdate([[item, mrData], ...]) is called per batch when progressive, otherwise once per stage.
// MRs that fail to load are simply not updated; onError(error) is called per failed batch.
async function loadMergeRequestsData(items, { onUpdate, onError = () => {}, isStale = () => false, progressive = false }) {
  pruneStoredMergeRequests();
  const stored = new Map(items.map(item => [item, readStoredMergeRequest(item)]));
  const nodes = new Map();

  const runStage = async (stageItems, batchSize, loadBatch) => {
    const stageUpdates = [];
    await forEachBatch(stageItems, batchSize, async (projectPath, batch) => {
      if (isStale()) return;
      let updates = [];
      try {
        updates = await loadBatch(projectPath, batch);
      } catch (error) {
        console.error("MRFlow: failed to load merge requests", error);
        onError(error);
      }
      if (isStale() || updates.length === 0) return;
      if (progressive) onUpdate(updates);
      else stageUpdates.push(...updates);
    });
    if (!isStale() && stageUpdates.length > 0) onUpdate(stageUpdates);
  };

  // Stage 2
  await runStage(items, MERGE_REQUESTS_BATCH_SIZE, async (projectPath, batch) => {
    const nodesByIid = await fetchNodes(MERGE_REQUESTS_QUERY, projectPath, batch);
    return batch.filter(item => nodesByIid.has(String(item.mrIid))).map(item => {
      const mr = nodesByIid.get(String(item.mrIid));
      const record = stored.get(item);
      const activityKey = getActivityKey(mr);
      // No comments at all: nothing to fetch in stage 3
      const activity = mr.userNotesCount === 0 ? EMPTY_ACTIVITY : record?.activity;
      const isActivityFresh = mr.userNotesCount === 0 || record?.activityKey === activityKey;
      nodes.set(item, { mr, activityKey, needsDiscussions: !isActivityFresh });
      const mrData = processMRData(mr, activity);
      if (isActivityFresh) writeStoredMergeRequest(item, { mrData, activity, activityKey });
      return [item, mrData];
    });
  });

  // Stage 3
  const needDiscussions = items.filter(item => nodes.get(item)?.needsDiscussions);
  if (needDiscussions.length === 0 || isStale()) return;
  const runDiscussions = async (projectPath, batch) => {
    const nodesByIid = await fetchNodes(MERGE_REQUESTS_DISCUSSIONS_QUERY, projectPath, batch);
    return Promise.all(batch.filter(item => nodesByIid.has(String(item.mrIid))).map(async item => {
      const discussionsNode = nodesByIid.get(String(item.mrIid)).discussions;
      const discussions = discussionsNode.pageInfo.hasNextPage
        ? await fetchAllDiscussions(projectPath, item.mrIid)
        : discussionsNode.nodes;
      const { mr, activityKey } = nodes.get(item);
      const activity = computeActivity(discussions);
      const mrData = processMRData(mr, activity);
      writeStoredMergeRequest(item, { mrData, activity, activityKey });
      return [item, mrData];
    }));
  };
  await runStage(needDiscussions, DISCUSSIONS_BATCH_SIZE, runDiscussions);
}

// Fetch fresh data for a single MR (both stages, no shortcuts) and remember it for the list; null on failure
async function getMergeRequestData(projectPath, mrIid) {
  try {
    return await fetchMergeRequestData(projectPath, mrIid);
  } catch (error) {
    console.error("MRFlow: failed to load the merge request", error);
    return null;
  }
}

async function fetchMergeRequestData(projectPath, mrIid) {
  const item = { projectPath, mrIid };
  const nodesByIid = await fetchNodes(MERGE_REQUESTS_QUERY, projectPath, [item]);
  const mr = nodesByIid.get(String(mrIid));
  if (!mr) return null;
  const discussionsNode = (await fetchNodes(MERGE_REQUESTS_DISCUSSIONS_QUERY, projectPath, [item])).get(String(mrIid))?.discussions;
  const discussions = !discussionsNode ? [] : discussionsNode.pageInfo.hasNextPage
    ? await fetchAllDiscussions(projectPath, mrIid)
    : discussionsNode.nodes;
  const activity = computeActivity(discussions);
  const mrData = processMRData(mr, activity);
  writeStoredMergeRequest(item, { mrData, activity, activityKey: getActivityKey(mr) });
  return mrData;
}

// GitLab's icon sprite URL, e.g. "/assets/icons-<hash>.svg"
function getIconSpriteUrl() {
  const use = document.querySelector('svg use[href*="/icons-"][href*=".svg#"]');
  return use ? use.getAttribute("href").split("#")[0] : null;
}

// == MR Page (Approve Checks) ==

let approveBtn = null;
let checksBar = null;
let mergeBar = null;
let g_hasUserApproved = false;
const g_mrPath = getCanonicalMrPath(location.pathname);

// Records used to be keyed by the raw path ("/123/diffs", "/123/commits", ...): fold them into the canonical one
function migrateSavedData() {
  const rawPath = location.pathname.replace(/\/$/, "");
  if (rawPath === g_mrPath || localStorage.getItem(rawPath + STORAGE_SUFFIX) === null) return;
  writeSavedData(g_mrPath, { ...readSavedData(rawPath), ...readSavedData(g_mrPath) });
  localStorage.removeItem(rawPath + STORAGE_SUFFIX);
}

// Create a checklist item
function createCheck(id, text) {
  const block = document.createElement("div");
  block.style.display = "block";
  block.style.marginTop = "10px";
  block.style.marginBottom = "10px";

  const checkbox = document.createElement("input");
  checkbox.style.marginRight = "10px";
  checkbox.type = "checkbox";
  checkbox.id = id;

  const checkStatus = readSavedData(g_mrPath);
  if (!checkStatus[id]) checkStatus[id] = false;
  checkbox.checked = checkStatus[id];
  writeSavedData(g_mrPath, checkStatus);

  checkbox.onclick = (cb) => {
    const obj = readSavedData(g_mrPath);
    obj[id] = cb.target.checked;
    writeSavedData(g_mrPath, obj);
    updateApproveVisibility();
  };

  const checkboxLabel = document.createElement("label");
  checkboxLabel.htmlFor = id;
  checkboxLabel.appendChild(document.createTextNode(text));

  block.appendChild(checkbox);
  block.appendChild(checkboxLabel);

  return block;
}

// Are all checks ticked?
function isConditionsChecked() {
  const checks = Object.entries(readSavedData(g_mrPath))
    .filter(([key]) => key.endsWith("_check"))
    .map(([, value]) => value);

  // Return true if there is at least one check and all are checked
  return checks.length > 0 && checks.every(Boolean);
}

// Untick all checks when the MR head moved since they were ticked
function resetChecksIfNeeded(headSha) {
  if (!headSha) return;
  const savedData = readSavedData(g_mrPath);
  if (g_resetChecksOnNewCommits && savedData.checks_head_sha && savedData.checks_head_sha !== headSha) {
    Object.keys(savedData)
      .filter(key => key.endsWith("_check"))
      .forEach(key => { savedData[key] = false; });
  }
  savedData.checks_head_sha = headSha;
  writeSavedData(g_mrPath, savedData);
}

// Show/hide approve button and merge bar
function updateApproveVisibility() {
  if (!approveBtn || !mergeBar) return;
  if (isConditionsChecked()) {
    approveBtn.style.setProperty("display", "flex", "important");
    mergeBar.style.setProperty("display", "block", "important");
  } else {
    // Keep "Revoke approval" reachable
    if (!g_hasUserApproved && !approveBtn.textContent.includes("Revoke approval"))
      approveBtn.style.setProperty("display", "none", "important");
    mergeBar.style.setProperty("display", "none", "important");
  }
}

// Remember what the user has seen on this MR (drives NEW COMMITS/REPLIES/COMMENTS banners in the list)
async function updateSavedData() {
  const body = document.querySelector('body');
  const projectPath = body?.attributes['data-project-full-path']?.value;
  const mrIid = body?.attributes['data-page-type-id']?.value;
  if (!projectPath || !mrIid) return null;
  const mrData = await getMergeRequestData(projectPath, mrIid);
  if (!mrData) return null;

  const savedData = readSavedData(g_mrPath);
  savedData["head_sha"] = mrData.headSha;
  savedData["other_comments"] = mrData.otherComments;
  savedData["replies_in_user_threads"] = mrData.repliesInUserThreads;
  // Superseded by the fields above
  delete savedData["comments_number"];
  delete savedData["commits_number"];
  delete savedData["replies_to_user_threads"];
  writeSavedData(g_mrPath, savedData);
  return mrData;
}

// Main: MR page logic
async function mergeRequestPage() {
  await initData();
  migrateSavedData();

  const mrData = await updateSavedData();
  if (mrData) {
    g_hasUserApproved = mrData.hasUserApproved;
    resetChecksIfNeeded(mrData.headSha);
  }

  // Refresh "seen" state when the user leaves the tab, at most once a minute
  let lastSavedAt = Date.now();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && Date.now() - lastSavedAt > 60 * 1000) {
      lastSavedAt = Date.now();
      updateSavedData();
    }
  });

  // The approvals widget may never appear (own MR, merged MR, no permission), so give up after a while
  const approveBar = await waitFor(() => {
    const bar = document.getElementsByClassName("js-mr-approvals")[0]?.getElementsByTagName("button")[0]?.parentElement?.parentElement;
    if (!bar || bar.textContent.includes("Checking approval status")) return null;
    const mergeBarEl = document.getElementsByClassName("mr-widget-body-ready-merge")[0]?.parentElement?.parentElement?.parentElement;
    return mergeBarEl ? bar : null;
  }, { timeout: 60 * 1000 });
  if (!approveBar || approveBar.parentElement.querySelector(".mr-utils-checks")) return;

  approveBtn = approveBar.getElementsByTagName("button")[0];
  mergeBar = document.getElementsByClassName("mr-widget-body-ready-merge")[0]?.parentElement?.parentElement?.parentElement;

  approveBtn.parentElement.style.height = "32px";

  updateApproveVisibility();

  checksBar = document.createElement("div");
  checksBar.style.display = "block";
  checksBar.style.width = "100%";
  checksBar.classList.add("gl-z-1", "mr-utils-checks"); // gl-z-1 is needed for GitLab UI to be elevated above accessability elements

  const headingElement = document.createElement("p");
  headingElement.style.fontWeight = "600";
  headingElement.appendChild(document.createTextNode("Check following conditions to approve:"));

  checksBar.appendChild(headingElement);
  checksBar.appendChild(createCheck("docs_check", "Is documentation updated?"));
  checksBar.appendChild(createCheck("branch_check", "Is merge target right?"));

  approveBar.parentElement.prepend(checksBar);
}

// Routing: MR page or MR list
if (MR_PAGE_RE.test(location.pathname)) {
  mergeRequestPage();
} else {
  mergeRequestsList();
}
