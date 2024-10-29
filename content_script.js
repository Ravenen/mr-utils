// content_script.js

(function () {
  let currentUserId;

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
    const mrListContainer = document.querySelector(".mr-list");
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

  // Process each merge request
  function processMergeRequests() {
    const kanbanBoard = createKanbanBoard();
    if (!kanbanBoard) return;

    const columns = {
      "To Review": kanbanBoard.querySelector('[data-column="To Review"] .kanban-column-body'),
      Pending: kanbanBoard.querySelector('[data-column="Pending"] .kanban-column-body'),
      Approved: kanbanBoard.querySelector('[data-column="Approved"] .kanban-column-body'),
    };
    console.log("Kanban columns initialized:", columns);

    const mergeRequestElements = document.getElementsByClassName("merge-request");
    console.log("Merge request elements found:", mergeRequestElements);

    for (let mrElement of mergeRequestElements) {
      if (mrElement.tagName !== "LI") continue;

      const mrLink = mrElement.querySelector(".merge-request-title-text a");
      if (mrLink) {
        const mrUrl = mrLink.getAttribute("href");
        console.log("Merge request URL:", mrUrl);

        // Parse the MR URL to extract projectPath and mrIid
        const url = new URL(mrUrl, window.location.origin);
        const path = url.pathname;
        const matches = path.match(/^\/(.*?)\/-\/merge_requests\/(\d+)/);
        if (matches) {
          const projectPath = matches[1];
          const mrIid = matches[2];
          console.log("Project path:", projectPath);
          console.log("MR IID:", mrIid);
          getMergeRequestData(projectPath, mrIid, mrElement, columns);
        } else {
          console.error("Unable to parse MR URL:", mrUrl);
        }
      }
    }
  }

  // Fetch MR data and decide its kanban column
  function getMergeRequestData(projectPath, mrIid, mrElement, columns) {
    if (!projectPath) return;
    console.log("Project path:", projectPath);

    const encodedProjectPath = encodeURIComponent(projectPath);

    const baseUrl = `${window.location.origin}/api/v4/projects/${encodedProjectPath}/merge_requests/${mrIid}`;

    console.log(`Fetching data for MR IID ${mrIid} from URL:`, baseUrl);

    Promise.all([
      fetch(`${baseUrl}/discussions?per_page=200`, { credentials: "same-origin" })
        .then((res) => res.json())
        .catch((err) => {
          console.error(`Error fetching discussions for MR ${mrIid}:`, err);
          return [];
        }),
      fetch(`${baseUrl}/approvals`, { credentials: "same-origin" })
        .then((res) => res.json())
        .catch((err) => {
          console.error(`Error fetching approvals for MR ${mrIid}:`, err);
          return {};
        }),
    ])
      .then(([discussionsData, approvalsData]) => {
        console.log(`Discussions data for MR IID ${mrIid}:`, discussionsData);
        console.log(`Approvals data for MR IID ${mrIid}:`, approvalsData);

        const mrData = processMRData(discussionsData, approvalsData);
        console.log(`Processed data for MR IID ${mrIid}:`, mrData);

        addBadges(mrElement, mrData);
        moveToColumn(mrElement, mrData.columnName, columns);
      })
      .catch((error) => console.error("Error processing MR data:", error));
  }

  // Process MR discussions and approvals data
  function processMRData(discussionsData, approvalsData) {
    discussionsData = discussionsData.filter((discussion) => !discussion.individual_note);
    const totalThreads = discussionsData.length;
    let unresolvedThreads = 0;
    let totalUserThreads = 0;
    let unresolvedUserThreads = 0;

    discussionsData.forEach((discussion) => {
      const notes = discussion.notes;
      if (!notes || notes.length === 0) return;

      const rootNote = notes[0];

      const isUserNote = rootNote.author && rootNote.author.id == currentUserId;
      if (isUserNote) totalUserThreads++;

      const isResolved = rootNote.resolved;
      if (!isResolved) {
        unresolvedThreads++;
        if (isUserNote) unresolvedUserThreads++;
      }
    });

    const approvalsRequired = 2; // Desired number of approvals
    const approvalsGiven = approvalsData.approved_by ? approvalsData.approved_by.length : 0;
    const hasUserApproved = approvalsData.approved_by
      ? approvalsData.approved_by.some((user) => user.user && user.user.id == currentUserId)
      : false;

    console.log(`MR data processed - Total threads: ${totalThreads}, Unresolved threads: ${unresolvedThreads}`);
    console.log(`User threads - Total: ${totalUserThreads}, Unresolved: ${unresolvedUserThreads}`);
    console.log(`Approvals given: ${approvalsGiven}, Has user approved: ${hasUserApproved}`);

    // Determine the kanban column
    let columnName;
    if (hasUserApproved) {
      columnName = "Approved";
    } else if (unresolvedUserThreads > 0) {
      columnName = "Pending";
    } else {
      columnName = "To Review";
    }
    console.log(`Column assigned for MR: ${columnName}`);

    return {
      totalThreads,
      unresolvedThreads,
      totalUserThreads,
      unresolvedUserThreads,
      approvalsGiven,
      approvalsRequired,
      hasUserApproved,
      columnName,
    };
  }

  // Add badges to the MR element using GitLab's native styles
  function addBadges(mrElement, mrData) {
    mrElement.classList.add("mr-card");
    console.log("Adding badges to MR card:", mrElement);

    // Find the controls section
    const controlsContainer = mrElement.querySelector(".controls");
    if (!controlsContainer) {
      console.error("Cannot find controls container in MR element.");
      return;
    }

    // // Create a container for badges if it doesn't exist
    // let badgesContainer = controlsContainer.querySelector(".kanban-badges");
    // if (!badgesContainer) {
    //   badgesContainer = document.createElement("div");
    //   badgesContainer.classList.add("kanban-badges", "gl-display-flex", "gl-flex-wrap", "gl-mt-2");
    //   controlsContainer.appendChild(badgesContainer);
    // }

    // Threads badge
    if (mrData.totalThreads > 0) {
      let threadsBadgesContainer = controlsContainer.querySelector(".kanban-badges");
      if (!threadsBadgesContainer) {
        threadsBadgesContainer = document.createElement("div");
        threadsBadgesContainer.classList.add("kanban-badges", "gl-display-flex", "gl-flex-wrap", "gl-mt-2");
        controlsContainer.appendChild(threadsBadgesContainer);
      }

      const threadsBadge = constructBadge(
        `${mrData.totalThreads - mrData.unresolvedThreads}/${mrData.totalThreads}`,
        mrData.unresolvedThreads === 0 ? "badge-success" : "badge-danger"
      );
      threadsBadgesContainer.appendChild(threadsBadge);

      // User threads badge
      if (mrData.totalUserThreads > 0) {
        const userThreadsBadge = constructBadge(
          `${mrData.totalUserThreads - mrData.unresolvedUserThreads}/${mrData.totalUserThreads}`,
          mrData.unresolvedUserThreads === 0 ? "badge-success" : "badge-danger"
        );
        threadsBadgesContainer.appendChild(userThreadsBadge);
      }

      const commentsBadge = controlsContainer.querySelector('[data-testid="issuable-comments"]');
      if (commentsBadge) {
        commentsBadge.insertAdjacentElement("afterend", threadsBadgesContainer);
      }
    }

    // Approvals badge
    const approvalsBadge = constructBadge(
      `${mrData.approvalsGiven}/${mrData.approvalsRequired}`,
      mrData.approvalsGiven >= mrData.approvalsRequired ? "badge-success" : "badge-danger"
    );

    const nativeApprovalBadge = controlsContainer.querySelector('[data-testid="mr-appovals"]');
    if (nativeApprovalBadge && nativeApprovalBadge.parentNode) {
      nativeApprovalBadge.insertAdjacentElement("afterend", approvalsBadge);
    } else if (mrData.approvalsGiven > 0) {
      // badgesContainer.appendChild(approvalsBadge);
    }
    console.log("Badges added to MR card.");
  }

  // Construct a badge using GitLab's styles
  function constructBadge(text, badgeStyle) {
    // const badgeLi = document.createElement("li");
    // badgeLi.className = `gl-flex !gl-mr-0`;
    const badgeSpan = document.createElement("span");
    badgeSpan.className = `gl-badge badge badge-pill sm ${badgeStyle}`;
    badgeSpan.textContent = text;
    // badgeLi.appendChild(badgeSpan);
    return badgeSpan;
  }

  // Move MR element to the appropriate kanban column
  function moveToColumn(mrElement, columnName, columns) {
    console.log(`Moving MR element to column: ${columnName}`, mrElement);
    columns[columnName].appendChild(mrElement);
  }

  // Initialize the script
  console.log("Initializing processMergeRequests...");
  getCurrentUserId().then((userId) => {
    if (userId) {
      currentUserId = userId;
      processMergeRequests();
    } else {
      console.error("Could not obtain current user ID. Extension functionality may be limited.");
    }
  });
})();
