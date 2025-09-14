// == GitLab MR Utils Content Script ==

let g_requiredApprovals;
let g_isKanbanView;
let g_currentUserId;
let g_currentBoard = null;
let g_originalListContainer = null;

// Helper: Get browser API (cross-browser)
function getBrowserApi() {
  return typeof browser !== "undefined" ? browser : chrome;
}

// Helper: Sleep
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Initialize global settings and user ID
async function initData() {
  const browserApi = getBrowserApi();
  const res = await browserApi.storage.sync.get(["approvalsNeeded", "kanbanView"]);
  g_requiredApprovals = parseInt(res.approvalsNeeded, 10) || 3;
  g_isKanbanView = res.kanbanView !== undefined ? res.kanbanView : true;

  const parsedUrl = new URL(window.location.href);
  g_isKanbanView = g_isKanbanView && (!parsedUrl.searchParams.has("state") || parsedUrl.searchParams.get("state") === "opened");

  g_currentUserId = await getCurrentUserId();
}

// Clean up existing board
function cleanupBoard() {
  if (g_currentBoard) {
    g_currentBoard.remove();
    g_currentBoard = null;
    if (g_originalListContainer) {
      g_originalListContainer.style.visibility = "";
      g_originalListContainer.style.position = "";
      g_originalListContainer.style.left = "";
      g_originalListContainer = null;
    }
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

// Handle URL changes
async function onUrlChange() {
  if (!g_url.match(mergeRequestRe)) {
    cleanupBoard();
    mergeRequestsList();
  }
}

// Routing: MR page or MR list
const g_url = window.location.pathname;
const mergeRequestRe = /merge_requests\/\d+/g;

if (g_url.match(mergeRequestRe)) {
  mergeRequestPage();
} else {
  mergeRequestsList();
}

// == MR List (Kanban) ==

async function mergeRequestsList() {
  await initData();

  // Create Kanban board structure
  function createKanbanBoard() {
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

    const mrListContainer = document.querySelector(".content-list, .issues-list");
    if (mrListContainer) {
      g_originalListContainer = mrListContainer;
      mrListContainer.parentNode.insertBefore(kanbanBoard, mrListContainer);
      mrListContainer.style.visibility = "hidden";
      mrListContainer.style.position = "absolute";
      mrListContainer.style.left = "-9999px";
    } else {
      console.error("Cannot find the merge requests list container element.");
      return null;
    }
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
    // Wait for MR elements to appear
    let mergeRequestElementsArr = await (async () => {
      let mr;
      while ((mr = document.querySelectorAll('.merge-request')).length === 0) {
        await sleep(50);
      }
      return [...mr];
    })();

    let columns;
    if (g_isKanbanView) {
      const kanbanBoard = createKanbanBoard();
      if (!kanbanBoard) return;
      columns = {
        "To Review": kanbanBoard.querySelector('[data-column="To Review"] .kanban-column-body'),
        Pending: kanbanBoard.querySelector('[data-column="Pending"] .kanban-column-body'),
        Approved: kanbanBoard.querySelector('[data-column="Approved"] .kanban-column-body'),
      };
    }

    // Fetch MR data for each MR element
    const fetchPromises = mergeRequestElementsArr.map((mrElement, index) => {
      if (mrElement.tagName !== "LI") return Promise.resolve(null);
      const mrLink = mrElement.querySelector("[data-testid='issuable-title-link']");
      if (!mrLink) return Promise.resolve(null);

      const mrUrl = mrLink.getAttribute("href");
      const url = new URL(mrUrl, window.location.origin);
      const path = url.pathname;
      const matches = path.match(/^\/(.*?)\/-\/merge_requests\/(\d+)/);
      if (!matches) return Promise.resolve(null);

      const projectPath = matches[1];
      const mrIid = matches[2];
      return getMergeRequestData(projectPath, mrIid).then(mrData => ({
        index, mrElement, mrData
      }));
    });

    Promise.all(fetchPromises).then(results => {
      results
        .filter(Boolean)
        .sort((a, b) => a.index - b.index)
        .forEach(({ mrElement, mrData }) => {
          if (!mrData) return;
          addBadges(mrElement, mrData);
          if (mrData.isDraft) mrElement.classList.add("dimmed");
          if (mrData.isReady) mrElement.classList.add("ready");
          if (g_isKanbanView) {
            mrElement.classList.add("mr-card");
            mrElement.classList.remove("!gl-flex");
            // Remove all classes except 'issuable-meta' to fix styling issues
            const metaEl = mrElement.getElementsByClassName("issuable-meta")?.[0];
            if (metaEl) {
              metaEl.className = "issuable-meta"
            }
            let columnName;
            if (mrData.hasUserApproved) columnName = "Approved";
            else if (mrData.unresolvedUserThreads > 0) columnName = "Pending";
            else columnName = "To Review";
            if (["Approved", "Pending"].includes(columnName)) addBanners(mrElement, mrData);
            moveToColumn(mrElement, columnName, columns);
          } else if (mrData.hasUserApproved && !mrData.isDraft) {
            mrElement.classList.add("greened");
          }
        });
      if (g_isKanbanView) addColumnCounts(columns);
    });
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
      threadsBadge.prepend(constructIcon('comments'));

      if (mrData.totalUserThreads > 0) {
        const userThreadsBadge = constructBadge(
          `${mrData.totalUserThreads - mrData.unresolvedUserThreads}/${mrData.totalUserThreads}`,
          'Your threads',
          mrData.unresolvedUserThreads === 0 ? "badge-success" : "badge-danger"
        );
        threadsBadgesContainer.appendChild(userThreadsBadge);
        userThreadsBadge.prepend(constructIcon('comment-dots'));
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

    if (mrData.savedCommitsNumber != mrData.commitsNumber) {
      bannersContainer.appendChild(constructBanner("NEW COMMITS", "New commits since last visit", "badge-tier"));
    }
    if (mrData.savedRepliesToUserThreads != mrData.repliesToUserThreads) {
      bannersContainer.appendChild(constructBanner("NEW REPLIES", "New replies to your threads since last visit", "badge-info"));
    }
    if (mrData.savedCommentsNumber != mrData.commentsNumber && (mrData.commentsNumber - mrData.savedCommentsNumber != mrData.repliesToUserThreads - mrData.savedRepliesToUserThreads)) {
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

  // SVG icon factory (uses GitLab's sprite)
  function constructIcon(iconType) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('s14', 'gl-align-middle');
    svg.setAttribute('data-testid', 'comments-icon');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    // Use GitLab's sprite for icons
    const iconMap = {
      'comments': '/assets/icons-8791a66659d025e0a4c801978c79a1fbd82db1d27d85f044a35728ea7cf0ae80.svg#comments',
      'comment-dots': '/assets/icons-8791a66659d025e0a4c801978c79a1fbd82db1d27d85f044a35728ea7cf0ae80.svg#comment-dots'
    };
    use.setAttribute('href', iconMap[iconType] || iconMap['comments']);
    svg.appendChild(use);
    return svg;
  }

  // Move MR element to kanban column
  function moveToColumn(mrElement, columnName, columns) {
    const clonedElement = mrElement.cloneNode(true);
    clonedElement.classList.add("mr-card");
    clonedElement.classList.remove("!gl-flex");
    
    // Ensure click events are preserved on the clone
    const originalLinks = mrElement.querySelectorAll('a');
    const clonedLinks = clonedElement.querySelectorAll('a');
    originalLinks.forEach((link, index) => {
      if (clonedLinks[index]) {
        clonedLinks[index].href = link.href;
        clonedLinks[index].onclick = link.onclick;
      }
    });

    columns[columnName].appendChild(clonedElement);
  }

  // Start processing
  processMergeRequests();
}

// == API Helpers ==

// Get current user ID
function getCurrentUserId() {
  return fetch(`${window.location.origin}/api/v4/user`, { credentials: "same-origin" })
    .then(response => response.json())
    .then(userData => userData.id)
    .catch(() => null);
}

// Fetch MR data (main, discussions, approvals, commits)
function getMergeRequestData(projectPath, mrIid) {
  if (!projectPath) return Promise.resolve(null);
  const encodedProjectPath = encodeURIComponent(projectPath);
  const baseUrl = `${window.location.origin}/api/v4/projects/${encodedProjectPath}/merge_requests/${mrIid}`;

  // Fetch all discussions (paginated)
  const fetchDiscussions = async () => {
    let discussions = [];
    let nextPage = 1;
    while (nextPage) {
      const response = await fetch(`${baseUrl}/discussions?per_page=100&page=${nextPage}`, { credentials: "same-origin" });
      if (!response.ok) return [];
      const data = await response.json();
      discussions = discussions.concat(data);
      nextPage = response.headers.get("x-next-page");
    }
    return discussions;
  };

  return Promise.all([
    fetch(`${baseUrl}/`, { credentials: "same-origin" }).then(res => res.json()).catch(() => ({})),
    fetchDiscussions(),
    fetch(`${baseUrl}/approvals`, { credentials: "same-origin" }).then(res => res.json()).catch(() => ({})),
    fetch(`${baseUrl}/commits`, { credentials: "same-origin" }).then(res => res.json()).catch(() => ([])),
  ]).then(([mainData, discussionsData, approvalsData, commitsData]) =>
    processMRData(mainData, discussionsData, approvalsData, commitsData)
  );
}

// Process MR data for UI
function processMRData(mainData, discussionsData, approvalsData, commitsData) {
  const isDraft = mainData.draft;
  discussionsData = (discussionsData || []).filter(d => !d.individual_note);
  const totalThreads = discussionsData.length;
  let unresolvedThreads = 0, totalUserThreads = 0, unresolvedUserThreads = 0, repliesToUserThreads = 0;

  discussionsData.forEach(discussion => {
    const notes = discussion.notes;
    if (!notes || notes.length === 0) return;
    const rootNote = notes[0];
    const isUserNote = rootNote.author && rootNote.author.id == g_currentUserId;
    if (isUserNote) totalUserThreads++;
    if (!rootNote.resolved) {
      unresolvedThreads++;
      if (isUserNote) 
      {
        unresolvedUserThreads++;
        if (notes.length > 1) {
          repliesToUserThreads += notes.filter(note => note.author && note.author.id != g_currentUserId).length;
        }
      }

    }
  });

  const approvalsRequired = g_requiredApprovals;
  const approvalsGiven = approvalsData.approved_by ? approvalsData.approved_by.length : 0;
  const hasUserApproved = approvalsData.approved_by
    ? approvalsData.approved_by.some(user => user.user && user.user.id == g_currentUserId)
    : false;

  const isReady = mainData.detailed_merge_status === 'mergeable' && approvalsGiven >= approvalsRequired;

  const commentsNumber = mainData.user_notes_count || 0;
  const commitsNumber = Array.isArray(commitsData) ? commitsData.length : 0;

  const mrUrl = mainData.web_url ? new URL(mainData.web_url) : null;
  const pathname = mrUrl ? mrUrl.pathname : "";
  let savedData = {};
  try {
    savedData = JSON.parse(localStorage.getItem(pathname + "/mr-utils")) || {};
  } catch {}
  const savedCommentsNumber = savedData["comments_number"];
  const savedCommitsNumber = savedData["commits_number"];
  const savedRepliesToUserThreads = savedData["replies_to_user_threads"];

  return {
    totalThreads,
    unresolvedThreads,
    totalUserThreads,
    unresolvedUserThreads,
    repliesToUserThreads,
    approvalsGiven,
    approvalsRequired,
    hasUserApproved,
    isDraft,
    commentsNumber,
    savedCommentsNumber,
    commitsNumber,
    savedCommitsNumber,
    savedRepliesToUserThreads,
    isReady,
  };
}

// == MR Page (Approve Checks) ==

let approveBtn = null;
let checksBar = null;
let mergeBar = null;

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

  let checkStatus = {};
  try {
    checkStatus = JSON.parse(localStorage.getItem(g_url + "/mr-utils")) || {};
  } catch {}
  if (!checkStatus[id]) checkStatus[id] = false;
  checkbox.checked = checkStatus[id];
  localStorage.setItem(g_url + "/mr-utils", JSON.stringify(checkStatus));

  checkbox.onclick = (cb) => {
    let obj = JSON.parse(localStorage.getItem(g_url + "/mr-utils")) || {};
    obj[id] = cb.target.checked;
    localStorage.setItem(g_url + "/mr-utils", JSON.stringify(obj));
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
  // Retrieve all check statuses from localStorage
  const checkStatus = JSON.parse(localStorage.getItem(g_url + "/mr-utils")) || {};

  // Filter only keys ending with "_check"
  const checks = Object.entries(checkStatus)
    .filter(([key]) => key.endsWith("_check"))
    .map(([, value]) => value);

  // Return true if there is at least one check and all are checked
  return checks.length > 0 && checks.every(Boolean);
}

// Show/hide approve button and merge bar
function updateApproveVisibility() {
  if (!approveBtn || !mergeBar) return;
  if (isConditionsChecked()) {
    approveBtn.style.setProperty("display", "flex", "important");
    mergeBar.style.setProperty("display", "block", "important");
  } else {
    if (!approveBtn.textContent.includes("Revoke approval\n"))
      approveBtn.style.setProperty("display", "none", "important");
    mergeBar.style.setProperty("display", "none", "important");
  }
}

async function updateSavedData() {
  const body = document.querySelector('body');
  const projectPath = body?.attributes['data-project-full-path']?.value;
  const mrIid = body?.attributes['data-page-type-id']?.value;
  if (!projectPath || !mrIid) return;
  const mrData = await getMergeRequestData(projectPath, mrIid);

  let savedData = {};
  try {
    savedData = JSON.parse(localStorage.getItem(g_url + "/mr-utils")) || {};
  } catch {}
  savedData["comments_number"] = mrData.commentsNumber;
  savedData["commits_number"] = mrData.commitsNumber;
  savedData["replies_to_user_threads"] = mrData.repliesToUserThreads;
  localStorage.setItem(g_url + "/mr-utils", JSON.stringify(savedData));
}

// Main: MR page logic
async function mergeRequestPage() {
  await initData();
  // Debounce utility
  function debounce(fn, delay) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // Debounced updateSavedData
  const debouncedUpdateSavedData = debounce(updateSavedData, 1000);

  // Add: Update saved data on any button click (debounced)
  document.addEventListener('click', function (e) {
    if (e.target?.tagName === 'BUTTON' || e.target?.parentElement?.tagName === 'BUTTON') {
      debouncedUpdateSavedData();
    }
  }, true);

  updateSavedData();

  const intervalId = window.setInterval(function () {
    let approveBar;
    try {
      approveBar = document.getElementsByClassName("js-mr-approvals")[0]?.getElementsByTagName("button")[0]?.parentElement?.parentElement;
    } catch {}
    if (!approveBar || approveBar.textContent.includes("Checking approval status")) return;

    approveBtn = approveBar.getElementsByTagName("button")[0];
    mergeBar = document.getElementsByClassName("mr-widget-body-ready-merge")[0]?.parentElement?.parentElement?.parentElement;
    if (!approveBtn || !mergeBar) return;

    approveBtn.parentElement.style.height = "32px";

    updateApproveVisibility();

    checksBar = document.createElement("div");
    checksBar.style.display = "block";
    checksBar.style.width = "100%";
    checksBar.classList.add("gl-z-1"); // Needed for GitLab UI to be elevated above accessability elements

    const headingElement = document.createElement("p");
    headingElement.style.fontWeight = "600";
    headingElement.appendChild(document.createTextNode("Check following conditions to approve:"));

    checksBar.appendChild(headingElement);
    checksBar.appendChild(createCheck("docs_check", "Is documentation updated?"));
    checksBar.appendChild(createCheck("branch_check", "Is merge target right?"));

    approveBar.parentElement.prepend(checksBar);

    clearInterval(intervalId);
  }, 100);
}
