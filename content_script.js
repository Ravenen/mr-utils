// == GitLab MR Utils Content Script ==

let g_requiredApprovals;
let g_isKanbanView;
let g_resetChecksOnNewCommits;
let g_currentUserId;
let g_currentBoard = null;
let g_originalListContainer = null;
let g_listRunId = 0;

const MR_PAGE_RE = /merge_requests\/\d+/;
const STORAGE_SUFFIX = "/mr-utils";
const MAX_CONCURRENT_REQUESTS = 4;
const MAX_RETRIES = 3;
const ACTIVITY_CACHE_TTL_MS = 2 * 60 * 1000;
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

// Initialize global settings and user ID
async function initData() {
  const browserApi = getBrowserApi();
  const res = await browserApi.storage.sync.get(["approvalsNeeded", "kanbanView", "resetChecksOnNewCommits"]);
  g_requiredApprovals = parseInt(res.approvalsNeeded, 10) || 3;
  g_isKanbanView = res.kanbanView !== undefined ? res.kanbanView : true;
  g_resetChecksOnNewCommits = res.resetChecksOnNewCommits !== undefined ? res.resetChecksOnNewCommits : true;

  const parsedUrl = new URL(window.location.href);
  g_isKanbanView = g_isKanbanView && (!parsedUrl.searchParams.has("state") || parsedUrl.searchParams.get("state") === "opened");

  g_currentUserId = await getCurrentUserId();
}

// Clean up existing board (including boards left behind by stale runs)
function cleanupBoard() {
  document.querySelectorAll(".kanban-board").forEach(board => board.remove());
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
      const count = column.children.length;
      let countElement = header.querySelector('.kanban-count');
      if (!countElement) {
        countElement = document.createElement('span');
        countElement.classList.add('kanban-count');
        header.appendChild(countElement);
      }
      countElement.textContent = ` (${count})`;
    });
  }

  // Main: Process all MRs on the page
  async function processMergeRequests() {
    // Wait for MR elements to appear (an empty list never gets any, hence the timeout)
    const mergeRequestElementsArr = await waitFor(() => {
      const elements = getNativeMergeRequestElements();
      return elements.length > 0 ? elements : null;
    }, { isStale });
    if (!mergeRequestElementsArr || isStale()) return;

    let columns;
    if (g_isKanbanView) {
      const mrListContainer = mergeRequestElementsArr[0].closest("ul");
      if (!mrListContainer) {
        console.error("Cannot find the merge requests list container element.");
        return;
      }
      const kanbanBoard = createKanbanBoard(mrListContainer);
      columns = {
        "To Review": kanbanBoard.querySelector('[data-column="To Review"] .kanban-column-body'),
        Pending: kanbanBoard.querySelector('[data-column="Pending"] .kanban-column-body'),
        Approved: kanbanBoard.querySelector('[data-column="Approved"] .kanban-column-body'),
      };
    }

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

    // Render each MR as soon as its data arrives; order inside a column is kept via CSS `order`
    const onMergeRequestData = ({ index, mrElement }, mrData) => {
      if (isStale()) return;
      if (mrData) {
        addBadges(mrElement, mrData);
        if (mrData.isDraft) mrElement.classList.add("dimmed");
        if (mrData.isReady) mrElement.classList.add("mr-ready");
      }
      if (g_isKanbanView) {
        mrElement.classList.add("mr-card");
        mrElement.classList.remove("!gl-flex");
        // Remove all classes except 'issuable-meta' to fix styling issues
        const metaEl = mrElement.getElementsByClassName("issuable-meta")?.[0];
        if (metaEl) {
          metaEl.className = "issuable-meta"
        }
        let columnName;
        if (mrData?.hasUserApproved) columnName = "Approved";
        else if (mrData?.unresolvedUserThreads > 0) columnName = "Pending";
        else columnName = "To Review";
        if (mrData && ["Approved", "Pending"].includes(columnName)) addBanners(mrElement, mrData);
        moveToColumn(mrElement, columnName, columns, index);
        addColumnCounts(columns);
      } else if (mrData?.hasUserApproved && !mrData.isDraft) {
        mrElement.classList.add("greened");
      }
    };

    await getMergeRequestsData(items, onMergeRequestData, { isStale });
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

    // Merge blockers badges
    const statusBadges = [];
    if (mrData.hasConflicts) {
      statusBadges.push(constructBadge("Conflicts", "Merge request has conflicts with the target branch", "badge-danger"));
    } else if (mrData.needsRebase) {
      statusBadges.push(constructBadge("Rebase needed", "Source branch must be rebased onto the target branch", "badge-warning"));
    }
    if (statusBadges.length > 0) {
      const statusItem = document.createElement("li");
      statusItem.classList.add("mr-status-badges");
      statusBadges.forEach(badge => statusItem.appendChild(badge));
      controlsContainer.prepend(statusItem);
    }
  }

  // Add banners (NEW COMMITS/COMMENTS) to MR card
  function addBanners(mrElement, mrData) {
    const infoContainer = mrElement.querySelector(".issuable-main-info");
    if (!infoContainer) return;

    let bannersContainer = infoContainer.querySelector(".kanban-banners");
    if (!bannersContainer) {
      bannersContainer = document.createElement("div");
      bannersContainer.classList.add("kanban-banners");
      infoContainer.insertBefore(bannersContainer, infoContainer.firstChild);
    }

    // Fields missing from the saved record mean "never seen": no banner instead of a false one
    const saved = mrData.savedData;
    if (saved.head_sha && mrData.headSha && saved.head_sha !== mrData.headSha) {
      bannersContainer.appendChild(constructBanner("NEW COMMITS", "New commits since last visit", "badge-tier"));
    }
    if (saved.replies_in_user_threads !== undefined && mrData.repliesInUserThreads > saved.replies_in_user_threads) {
      bannersContainer.appendChild(constructBanner("NEW REPLIES", "New replies to your threads since last visit", "badge-info"));
    }
    if (saved.other_comments !== undefined && mrData.otherComments > saved.other_comments) {
      bannersContainer.appendChild(constructBanner("NEW COMMENTS", "New comments since last visit", "badge-warning"));
    }
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

  // Move MR element to kanban column
  function moveToColumn(mrElement, columnName, columns, index) {
    const clonedElement = mrElement.cloneNode(true);
    clonedElement.classList.add("mr-card");
    clonedElement.classList.remove("!gl-flex");
    clonedElement.style.order = index;

    columns[columnName].appendChild(clonedElement);
  }

  // Start processing
  processMergeRequests();
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

// GET from the GitLab API with a concurrency limit and Retry-After handling for 429
async function apiFetch(path) {
  await acquireRequestSlot();
  try {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(`${window.location.origin}/api/v4${path}`, { credentials: "same-origin" });
      if (response.status === 429 && attempt < MAX_RETRIES) {
        const retryAfter = parseInt(response.headers.get("retry-after"), 10);
        await sleep((Number.isFinite(retryAfter) ? retryAfter : 2 ** attempt) * 1000);
        continue;
      }
      if (!response.ok) throw new Error(`GitLab API ${response.status}: ${path}`);
      return response;
    }
  } finally {
    releaseRequestSlot();
  }
}

// Get current user ID (cached for the tab session)
async function getCurrentUserId() {
  const cacheKey = "mr-utils/current-user-id";
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) return parseInt(cached, 10);
  try {
    const userData = await (await apiFetch("/user")).json();
    sessionStorage.setItem(cacheKey, String(userData.id));
    return userData.id;
  } catch {
    return null;
  }
}

// Fetch all discussions (paginated)
async function fetchDiscussions(baseUrl) {
  let discussions = [];
  let nextPage = 1;
  while (nextPage) {
    const response = await apiFetch(`${baseUrl}/discussions?per_page=100&page=${nextPage}`);
    discussions = discussions.concat(await response.json());
    nextPage = response.headers.get("x-next-page");
  }
  return discussions;
}

// Summarize discussions and approvals relative to the current user
function computeActivity(discussionsData, approvalsData) {
  let totalThreads = 0, unresolvedThreads = 0, totalUserThreads = 0, unresolvedUserThreads = 0;
  let repliesInUserThreads = 0, otherComments = 0;
  const isOtherUserNote = note => !note.system && note.author && note.author.id != g_currentUserId;

  discussionsData.forEach(discussion => {
    const notes = discussion.notes;
    if (!notes || notes.length === 0) return;

    if (discussion.individual_note) {
      otherComments += notes.filter(isOtherUserNote).length;
      return;
    }

    const rootNote = notes[0];
    const isUserThread = rootNote.author && rootNote.author.id == g_currentUserId;
    totalThreads++;
    if (!rootNote.resolved) unresolvedThreads++;
    if (isUserThread) {
      totalUserThreads++;
      if (!rootNote.resolved) unresolvedUserThreads++;
      repliesInUserThreads += notes.filter(isOtherUserNote).length;
    } else {
      otherComments += notes.filter(isOtherUserNote).length;
    }
  });

  const approvedBy = approvalsData.approved_by || [];
  return {
    totalThreads,
    unresolvedThreads,
    totalUserThreads,
    unresolvedUserThreads,
    repliesInUserThreads,
    otherComments,
    approvalsGiven: approvedBy.length,
    hasUserApproved: approvedBy.some(user => user.user && user.user.id == g_currentUserId),
  };
}

// Discussions + approvals for one MR, reused for a short time while the MR is unchanged
async function getMergeRequestActivity(projectPath, mainData, { useCache }) {
  const baseUrl = `/projects/${encodeURIComponent(projectPath)}/merge_requests/${mainData.iid}`;
  const cacheKey = `mr-utils/activity/${g_currentUserId}/${projectPath}/${mainData.iid}`;
  if (useCache) {
    try {
      const cached = JSON.parse(sessionStorage.getItem(cacheKey));
      if (cached && cached.updatedAt === mainData.updated_at && Date.now() - cached.fetchedAt < ACTIVITY_CACHE_TTL_MS) {
        return cached.activity;
      }
    } catch {}
  }

  const [discussionsData, approvalsData] = await Promise.all([
    fetchDiscussions(baseUrl),
    apiFetch(`${baseUrl}/approvals`).then(res => res.json()),
  ]);
  const activity = computeActivity(discussionsData, approvalsData);
  try {
    sessionStorage.setItem(cacheKey, JSON.stringify({ updatedAt: mainData.updated_at, fetchedAt: Date.now(), activity }));
  } catch {}
  return activity;
}

// Fetch data for many MRs: one list request per project (up to 100 iids), then activity per MR.
// onData(item, mrData) is called per item as soon as it is ready; mrData is null on failure.
async function getMergeRequestsData(items, onData, { isStale = () => false, useCache = true } = {}) {
  const itemsByProject = new Map();
  items.forEach(item => {
    if (!itemsByProject.has(item.projectPath)) itemsByProject.set(item.projectPath, []);
    itemsByProject.get(item.projectPath).push(item);
  });

  const tasks = [];
  for (const [projectPath, projectItems] of itemsByProject) {
    for (let i = 0; i < projectItems.length; i += 100) {
      const chunk = projectItems.slice(i, i + 100);
      const query = chunk.map(item => `iids[]=${item.mrIid}`).join("&");
      tasks.push((async () => {
        let mainDataByIid = new Map();
        try {
          const list = await (await apiFetch(`/projects/${encodeURIComponent(projectPath)}/merge_requests?${query}&per_page=100`)).json();
          mainDataByIid = new Map(list.map(mr => [String(mr.iid), mr]));
        } catch (error) {
          console.error("MRFlow: failed to load merge requests", error);
        }
        await Promise.all(chunk.map(async item => {
          const mainData = mainDataByIid.get(String(item.mrIid));
          let mrData = null;
          if (mainData && !isStale()) {
            try {
              const activity = await getMergeRequestActivity(projectPath, mainData, { useCache });
              mrData = processMRData(mainData, activity);
            } catch (error) {
              console.error("MRFlow: failed to load merge request activity", error);
            }
          }
          onData(item, mrData);
        }));
      })());
    }
  }
  await Promise.all(tasks);
}

// Fetch data for a single MR
async function getMergeRequestData(projectPath, mrIid) {
  let result = null;
  await getMergeRequestsData([{ projectPath, mrIid }], (_, mrData) => { result = mrData; }, { useCache: false });
  return result;
}

// Process MR data for UI
function processMRData(mainData, activity) {
  const approvalsRequired = g_requiredApprovals;
  const mrPath = mainData.web_url ? new URL(mainData.web_url).pathname : "";

  return {
    ...activity,
    approvalsRequired,
    isDraft: mainData.draft,
    isReady: mainData.detailed_merge_status === 'mergeable' && activity.approvalsGiven >= approvalsRequired,
    needsRebase: mainData.detailed_merge_status === 'need_rebase',
    hasConflicts: mainData.has_conflicts === true || mainData.detailed_merge_status === 'conflict',
    headSha: mainData.sha,
    savedData: readSavedData(mrPath),
  };
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
