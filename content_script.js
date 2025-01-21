var g_requiredApprovals;
var g_isKanbanView;
var g_currentUserId;

async function initData() {
  var browser = browser ? browser : chrome;

  const res = await browser.storage.sync.get(["approvalsNeeded", "kanbanView"]);
  g_requiredApprovals = parseInt(res.approvalsNeeded, 10) || 3;
  g_isKanbanView = res.kanbanView !== undefined ? res.kanbanView : true;

  const parsedUrl = new URL(window.location.href);
  if (parsedUrl.searchParams.has("state") && !parsedUrl.searchParams.has("state", "opened")) g_isKanbanView = false;

  console.log("requiredApprovals, isKanbanView: ", g_requiredApprovals, g_isKanbanView);

  g_currentUserId = await getCurrentUserId();
};


var g_url = window.location.pathname;
const mergeRequestRe = /merge_requests\/\d+/g;

if (g_url.match(mergeRequestRe)) mergeRequestPage();
else mergeRequestsList();

/*
 * mergeRequestsList
 */
async function mergeRequestsList() {
  await initData();

  // Create the kanban board structure
  function createKanbanBoard() {
    const kanbanBoard = document.createElement("div");
    kanbanBoard.classList.add("kanban-board");
    console.log("Kanban board created:", kanbanBoard);

    const columns = ["To Review", "Pending", "Approved"];

    columns.forEach((columnName) => {
      const column = document.createElement("div");
      column.classList.add("kanban-column");
      column.dataset.column = columnName;

      const header = document.createElement("div");
      header.classList.add("kanban-column-header");
      header.textContent = columnName;

      const body = document.createElement("ul");
      body.classList.add("content-list", "mr-list", "issuable-list");
      body.classList.add("kanban-column-body");

      column.appendChild(header);
      column.appendChild(body);
      kanbanBoard.appendChild(column);
    });

    // Insert the kanban board before the existing MR list and hide the original list
    const mrListContainer = document.querySelector(".content-list, .issues-list");
    console.log("Merge requests list container element:", mrListContainer);

    if (mrListContainer) {
      mrListContainer.parentNode.insertBefore(kanbanBoard, mrListContainer);
      mrListContainer.style.display = "none";
    } else {
      console.error("Cannot find the merge requests list container element.");
      return null;
    }

    return kanbanBoard;
  }

  function addColumnCounts(columns) {
    Object.keys(columns).forEach(columnName => {
        const column = columns[columnName];
        const header = column.parentElement.querySelector('.kanban-column-header');
        const count = column.children.length;

        // // Remove existing count if it exists
        // const existingCount = header.querySelector('.kanban-count');
        // if (existingCount) {
        //     existingCount.remove();
        // }

        // Add the new count
        const countElement = document.createElement('span');
        countElement.classList.add('kanban-count');
        countElement.textContent = ` (${count})`;

        header.appendChild(countElement);
    });
  }

  // Process each merge request
  async function processMergeRequests() {

    let mergeRequestElementsArr = await new Promise(async (resolve) => {
        let mr = document.querySelectorAll('.merge-request');  
        while (
          (mr = document.querySelectorAll('.merge-request')).length === 0
          && document.querySelector(".content-list")
        ) {
          await new Promise(r => setTimeout(r, 50))
        }

        resolve([...mr]);
      })

    console.log("Merge request elements found:", mergeRequestElementsArr);

    let columns;
    if (g_isKanbanView) {
      const kanbanBoard = createKanbanBoard();
      if (!kanbanBoard) return;

      columns = {
        "To Review": kanbanBoard.querySelector('[data-column="To Review"] .kanban-column-body'),
        Pending: kanbanBoard.querySelector('[data-column="Pending"] .kanban-column-body'),
        Approved: kanbanBoard.querySelector('[data-column="Approved"] .kanban-column-body'),
      };
      console.log("Kanban columns initialized:", columns);
    }

    const fetchPromises = mergeRequestElementsArr.map((mrElement, index) => {
      if (mrElement.tagName !== "LI") return Promise.resolve(null);

      const mrLink = mrElement.querySelector("[data-testid='issuable-title-link']");
      if (!mrLink) return Promise.resolve(null);

      const mrUrl = mrLink.getAttribute("href");
      console.log("Merge request URL:", mrUrl);

      // Parse the MR URL to extract projectPath and mrIid
      const url = new URL(mrUrl, window.location.origin);
      const path = url.pathname;
      const matches = path.match(/^\/(.*?)\/-\/merge_requests\/(\d+)/);
      if (!matches) {
        console.error("Unable to parse MR URL:", mrUrl);
        return Promise.resolve(null);
      }

      const projectPath = matches[1];
      const mrIid = matches[2];
      console.log("Project path:", projectPath);
      console.log("MR IID:", mrIid);

      return getMergeRequestData(projectPath, mrIid, g_currentUserId).then((mrData) => ({
        index, // Preserve the original index
        mrElement,
        mrData,
      }));
    });

    // Wait for all data to be fetched
    Promise.all(fetchPromises).then((results) => {
      results
        .filter(Boolean) // Remove any null results
        .sort((a, b) => a.index - b.index) // Sort by the original order
        .forEach(({ mrElement, mrData }) => {
          if (mrData) {
            addBadges(mrElement, mrData); // Add badges after appending
            if (mrData.isDraft) {
              mrElement.classList.add("dimmed");
            }
            if (g_isKanbanView) {
              // Place each MR in its respective column
              mrElement.classList.add("mr-card");
              mrElement.classList.remove("!gl-flex");
              // Determine the kanban column
              let columnName;
              if (mrData.hasUserApproved) {
                columnName = "Approved";
              } else if (mrData.unresolvedUserThreads > 0) {
                columnName = "Pending";
              } else {
                columnName = "To Review";
              }
              console.log(`Column assigned for MR: ${columnName}`);
              moveToColumn(mrElement, columnName, columns);
            } else if (mrData.hasUserApproved && !mrData.isDraft) {
              mrElement.classList.add("greened");
            }

            if(mrData.hasUserApproved)
            {
              addBanners(mrElement, mrData);
            }
          }
        });

      if (g_isKanbanView) {
        addColumnCounts(columns);
      }
    });
  }

  // Add badges to the MR element using GitLab's native styles
  function addBadges(mrElement, mrData) {
    console.log("Adding badges to MR card:", mrElement);

    // Find the controls section
    const controlsContainer = mrElement.querySelector(".controls");
    if (!controlsContainer) {
      console.error("Cannot find controls container in MR element.");
      return;
    }

    // Threads badge
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
      const commentsIcon = constructIcon('/assets/icons-8791a66659d025e0a4c801978c79a1fbd82db1d27d85f044a35728ea7cf0ae80.svg#comments');
      threadsBadge.prepend(commentsIcon);

      // User threads badge
      if (mrData.totalUserThreads > 0) {
        const userThreadsBadge = constructBadge(
          `${mrData.totalUserThreads - mrData.unresolvedUserThreads}/${mrData.totalUserThreads}`,
          'Your threads',
          mrData.unresolvedUserThreads === 0 ? "badge-success" : "badge-danger"
        );
        threadsBadgesContainer.appendChild(userThreadsBadge);

        // if(mrData.unresolvedUserThreads === 0)
        // {
        //   const checkmarkIcon = constructIcon('/assets/icons-8791a66659d025e0a4c801978c79a1fbd82db1d27d85f044a35728ea7cf0ae80.svg#review-checkmark');
        //   userThreadsBadge.prepend(checkmarkIcon);
        // }
        // else
        // {
        //   const warningIcon = constructIcon('/assets/icons-8791a66659d025e0a4c801978c79a1fbd82db1d27d85f044a35728ea7cf0ae80.svg#review-warning');
        //   userThreadsBadge.prepend(warningIcon);
        // }

        const userCommentsIcon = constructIcon('/assets/icons-8791a66659d025e0a4c801978c79a1fbd82db1d27d85f044a35728ea7cf0ae80.svg#comment-dots');
        userThreadsBadge.prepend(userCommentsIcon);
      }

      const nativeCommentsBadge = controlsContainer.querySelector('[data-testid="comments-icon"]')?.parentNode?.parentNode;
      console.log("Issuable comments: ", nativeCommentsBadge);
      
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

    const nativeApprovalBadge = controlsContainer.querySelector('[data-testid="mr-appovals"]');
    if (nativeApprovalBadge && nativeApprovalBadge.parentNode) {
      nativeApprovalBadge.parentNode.classList.add("gl-flex");
      nativeApprovalBadge.insertAdjacentElement("afterend", approvalsBadge);
    } else if (mrData.approvalsGiven > 0) {
      // badgesContainer.appendChild(approvalsBadge);
    }
    console.log("Badges added to MR card.");
  }

  function addBanners(mrElement, mrData)
  {
    console.log("Adding banners to MR card:", mrElement);

    const infoContainer = mrElement.querySelector(".issuable-main-info");
    if (!infoContainer) {
      console.error("Cannot find controls container in MR element.");
      return;
    }

    let bannersContainer = infoContainer.querySelector(".kanban-banners");
    if (!bannersContainer) {
      bannersContainer = document.createElement("div");
      bannersContainer.classList.add("kanban-banners");
      infoContainer.insertBefore(bannersContainer, infoContainer.firstChild);
    }

    if(mrData.savedCommitsNumber && mrData.savedCommitsNumber != mrData.commitsNumber)
    {
      const newCommitsBanner = constructBanner(`NEW COMMITS`, "New commits since last acknowledge", "badge-tier");
      bannersContainer.appendChild(newCommitsBanner);
    }

    if(mrData.savedCommentsNumber && mrData.savedCommentsNumber != mrData.commentsNumber)
      {
        const newCommentsBanner = constructBanner(`NEW COMMENTS`, "New comments since last acknowledge", "badge-warning");
        bannersContainer.appendChild(newCommentsBanner);
      }
    
    console.log("Banners added to MR card.");
  }

  // Construct a badge using GitLab's styles
  function constructBadge(text, title, badgeStyle) {
    const badgeSpan = document.createElement("span");
    badgeSpan.className = `gl-mt-1 gl-badge badge badge-pill has-tooltip ${badgeStyle}`;
    badgeSpan.textContent = text;
    badgeSpan.title = title;
    return badgeSpan;
  }

    // Construct a banner using GitLab's styles
    function constructBanner(text, title, badgeStyle) {
      const badgeSpan = document.createElement("span");
      badgeSpan.className = `gl-badge badge has-tooltip ${badgeStyle} font-weight-bold`;
      badgeSpan.textContent = text;
      badgeSpan.title = title;
      return badgeSpan;
    }

  function constructIcon(href) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('s14', 'gl-align-middle');
    svg.setAttribute('data-testid', 'comments-icon');
  
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', href);
  
    svg.appendChild(use);
  
    return svg;
  }


  // Move MR element to the appropriate kanban column
  function moveToColumn(mrElement, columnName, columns) {
    console.log(`Moving MR element to column: ${columnName}`, mrElement);
    columns[columnName].appendChild(mrElement);
  }

  // Initialize the script
  console.log("Initializing processMergeRequests...");
  if(!g_currentUserId) console.error("Could not obtain current user ID. Extension functionality may be limited.");
  processMergeRequests();
}

// Fetch current user ID via GitLab API
function getCurrentUserId() {
  return fetch(`${window.location.origin}/api/v4/user`, { credentials: "same-origin" })
    .then((response) => response.json())
    .then((userData) => {
      console.log("Current User Data:", userData);
      return userData.id;
    })
    .catch((error) => {
      console.error("Error fetching current user data:", error);
      return null;
    });
}

// Fetch MR data
function getMergeRequestData(projectPath, mrIid) {
  if (!projectPath) return;
  console.log("Project path:", projectPath);

  const encodedProjectPath = encodeURIComponent(projectPath);

  const baseUrl = `${window.location.origin}/api/v4/projects/${encodedProjectPath}/merge_requests/${mrIid}`;

  console.log(`Fetching data for MR IID ${mrIid} from URL:`, baseUrl);

  const fetchDiscussions = async (baseUrl, mrIid) => {
    let discussions = [];
    let nextPage = 1; 
  
    while (nextPage) {
      const response = await fetch(`${baseUrl}/discussions?per_page=100&page=${nextPage}`, { credentials: "same-origin" });
  
      if (!response.ok) {
        console.error(`Error fetching discussions for MR ${mrIid}: ${response.status}`);
        return {};
      }
  
      const data = await response.json();
      discussions = discussions.concat(data);
  
      nextPage = response.headers.get("x-next-page"); 
    }
  
    return discussions;
  };

  return Promise.all([
    fetch(`${baseUrl}/`, { credentials: "same-origin" })
      .then((res) => res.json())
      .catch((err) => {
        console.error(`Error fetching discussions for MR ${mrIid}:`, err);
        return {};
      }),
    fetchDiscussions(baseUrl, mrIid),
    fetch(`${baseUrl}/approvals`, { credentials: "same-origin" })
      .then((res) => res.json())
      .catch((err) => {
        console.error(`Error fetching approvals for MR ${mrIid}:`, err);
        return {};
      }),
    fetch(`${baseUrl}/commits`, { credentials: "same-origin" })
      .then((res) => res.json())
      .catch((err) => {
        console.error(`Error fetching approvals for MR ${mrIid}:`, err);
        return {};
      }),
  ]).then(([mainData, discussionsData, approvalsData, commitsData]) => {
    console.log(`Main data for MR IID ${mrIid}:`, mainData);
    console.log(`Discussions data for MR IID ${mrIid}:`, discussionsData);
    console.log(`Approvals data for MR IID ${mrIid}:`, approvalsData);
    console.log(`Commits data for MR IID ${mrIid}:`, commitsData);

    const mrData = processMRData(mainData, discussionsData, approvalsData, commitsData);
    console.log(`Processed data for MR IID ${mrIid}:`, mrData);

    return mrData;
  });
}

// Process MR discussions and approvals data
function processMRData(mainData, discussionsData, approvalsData, commitsData) {
  const isDraft = mainData.title.toLowerCase().includes("draft:");
  discussionsData = discussionsData.filter((discussion) => !discussion.individual_note);
  const totalThreads = discussionsData.length;
  let unresolvedThreads = 0;
  let totalUserThreads = 0;
  let unresolvedUserThreads = 0;

  discussionsData.forEach((discussion) => {
    const notes = discussion.notes;
    if (!notes || notes.length === 0) return;

    const rootNote = notes[0];

    const isUserNote = rootNote.author && rootNote.author.id == g_currentUserId;
    if (isUserNote) totalUserThreads++;

    const isResolved = rootNote.resolved;
    if (!isResolved) {
      unresolvedThreads++;
      if (isUserNote) unresolvedUserThreads++;
    }
  });

  const approvalsRequired = g_requiredApprovals; // Desired number of approvals
  const approvalsGiven = approvalsData.approved_by ? approvalsData.approved_by.length : 0;
  const hasUserApproved = approvalsData.approved_by
    ? approvalsData.approved_by.some((user) => user.user && user.user.id == g_currentUserId)
    : false;

  console.log(`MR data processed - Total threads: ${totalThreads}, Unresolved threads: ${unresolvedThreads}`);
  console.log(`User threads - Total: ${totalUserThreads}, Unresolved: ${unresolvedUserThreads}`);
  console.log(`Approvals given: ${approvalsGiven}, Has user approved: ${hasUserApproved}`);

  const commentsNumber = mainData.user_notes_count;
  const commitsNumber = commitsData.length;
  
  const mrUrl = new URL(mainData.web_url);
  const pathname = mrUrl.pathname; 

  var savedData = JSON.parse(localStorage.getItem(pathname + "/mr-utils"));
  if (!savedData) {
    savedData = {};
  }

  const savedCommentsNumber = savedData["comments_number"];
  const savedCommitsNumber = savedData["commits_number"];

  return {
    totalThreads,
    unresolvedThreads,
    totalUserThreads,
    unresolvedUserThreads,
    approvalsGiven,
    approvalsRequired,
    hasUserApproved,
    isDraft,
    commentsNumber,
    savedCommentsNumber,
    commitsNumber,
    savedCommitsNumber,
  };
}

/*
 * mergeRequestsList
 */

/*
 * mergeRequestPage
 */
var approveBtn = null;
var checksBar = null;
var mergeBar = null;

function createCheck(id, text) {
  var block = document.createElement("div");
  block.setAttribute("style", "display: block");
  block.style.marginTop = "10px";
  block.style.marginBottom = "10px";

  var checkbox = document.createElement("input");
  checkbox.style.marginRight = "10px";
  checkbox.type = "checkbox";
  checkbox.name = id;
  checkbox.id = id;

  var checkStatus = JSON.parse(localStorage.getItem(g_url + "/mr-utils"));
  if (!checkStatus) {
    checkStatus = {};
  }
  if (!checkStatus[id]) {
    checkStatus[id] = false;
  }
  checkbox.checked = checkStatus[id];
  localStorage.setItem(g_url + "/mr-utils", JSON.stringify(checkStatus));

  checkbox.onclick = (cb) => {
    let obj = JSON.parse(localStorage.getItem(g_url + "/mr-utils"));
    obj[id] = cb.target.checked;
    localStorage.setItem(g_url + "/mr-utils", JSON.stringify(obj));
    updateApproveVisibility();
  };

  var checkboxLabel = document.createElement("label");
  checkboxLabel.htmlFor = id;
  checkboxLabel.appendChild(document.createTextNode(text));

  block.appendChild(checkbox);
  block.appendChild(checkboxLabel);

  return block;
}

function isConditionsChecked() {
  var checkStatus = JSON.parse(localStorage.getItem(g_url + "/mr-utils"));
  return checkStatus && Object.keys(checkStatus).reduce((res, current) => res && checkStatus[current], true);
}

function updateApproveVisibility() {
  if (isConditionsChecked()) {
    if (approveBtn) {
      approveBtn.style.setProperty("display", "flex", "important");
      mergeBar.style.setProperty("display", "block", "important");
    }
  } else {
    if (!approveBtn.textContent.includes("Revoke approval\n"))
      approveBtn.style.setProperty("display", "none", "important");
    mergeBar.style.setProperty("display", "none", "important");
  }
}

async function updateSavedData() {
  const body = document.querySelector('body');
  const projectPath = body.attributes['data-project-full-path'].value;
  const mrIid = body.attributes['data-page-type-id'].value;
  const mrData = await getMergeRequestData(projectPath, mrIid);

  var savedData = JSON.parse(localStorage.getItem(g_url + "/mr-utils"));
  if (!savedData) {
    savedData = {};
  }
  savedData["comments_number"] = mrData.commentsNumber;
  savedData["commits_number"] = mrData.commitsNumber;
  localStorage.setItem(g_url + "/mr-utils", JSON.stringify(savedData));
}

async function mergeRequestPage() {
  await initData();

  var intervalId = window.setInterval(function () {
    try {
      var approveBar = document.getElementsByClassName("js-mr-approvals")[0].getElementsByTagName("button")[0]
        .parentElement.parentElement;
    } catch (error) {
      console.log(error);
    }

    if (!approveBar || approveBar.textContent.includes("Checking approval status")) return;

    approveBtn = approveBar.getElementsByTagName("button")[0];
    mergeBar =
      document.getElementsByClassName("mr-widget-body-ready-merge")[0].parentElement.parentElement.parentElement;

    approveBtn.parentElement.style.height = "32px";
    approveBtn.addEventListener('click', () => updateSavedData());

    updateApproveVisibility();

    checksBar = document.createElement("div");
    checksBar.setAttribute("style", "display: block");
    checksBar.setAttribute("style", "width: 100%");

    var headingElement = document.createElement("p");
    var headingText = document.createTextNode("Check following conditions to approve:");
    headingElement.style.fontWeight = "600";
    headingElement.appendChild(headingText);

    checkDocs = createCheck("docs_check", "Is documentation updated?");
    checkTarget = createCheck("branch_check", "Is merge target right?");

    checksBar.appendChild(headingElement);
    checksBar.appendChild(checkDocs);
    checksBar.appendChild(checkTarget);

    approveBar.parentElement.prepend(checksBar);

    clearInterval(intervalId);
  }, 100);
}
/*
 * mergeRequestPage
 */
