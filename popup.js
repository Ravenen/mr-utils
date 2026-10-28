const browserApi = typeof browser !== "undefined" ? browser : chrome;

function showMessage(id) {
  const message = document.getElementById(id);
  message.classList.add("show");
  setTimeout(() => message.classList.remove("show"), 3000);
}

document.getElementById("saveSettings").addEventListener("click", () => {
  const approvalsNeeded = parseInt(document.getElementById("approvalsNeeded").value, 10);
  const kanbanView = document.getElementById("kanbanView").checked;
  const resetChecksOnNewCommits = document.getElementById("resetChecksOnNewCommits").checked;
  const boardLoading = document.getElementById("boardLoading").value;
  const animateCards = document.getElementById("animateCards").checked;

  if (!Number.isInteger(approvalsNeeded) || approvalsNeeded < 1) {
    showMessage("errorMessage");
    return;
  }

  browserApi.storage.sync.set({ approvalsNeeded, kanbanView, boardLoading, animateCards, resetChecksOnNewCommits }).then(
    () => showMessage("alertMessage"),
    () => showMessage("errorMessage")
  );
});

// Load settings on popup open
window.addEventListener("DOMContentLoaded", async () => {
  const res = await browserApi.storage.sync.get(["approvalsNeeded", "kanbanView", "boardLoading", "animateCards", "resetChecksOnNewCommits"]);
  document.getElementById("approvalsNeeded").value = parseInt(res.approvalsNeeded, 10) || 3;
  document.getElementById("kanbanView").checked = res.kanbanView !== undefined ? res.kanbanView : true;
  document.getElementById("boardLoading").value = res.boardLoading === "progressive" ? "progressive" : "all";
  document.getElementById("animateCards").checked = res.animateCards !== undefined ? res.animateCards : true;
  document.getElementById("resetChecksOnNewCommits").checked = res.resetChecksOnNewCommits !== undefined ? res.resetChecksOnNewCommits : true;
});
