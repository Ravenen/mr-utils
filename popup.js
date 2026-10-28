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

  if (!Number.isInteger(approvalsNeeded) || approvalsNeeded < 1) {
    showMessage("errorMessage");
    return;
  }

  browserApi.storage.sync.set({ approvalsNeeded, kanbanView, resetChecksOnNewCommits }).then(
    () => showMessage("alertMessage"),
    () => showMessage("errorMessage")
  );
});

// Load settings on popup open
window.addEventListener("DOMContentLoaded", async () => {
  const res = await browserApi.storage.sync.get(["approvalsNeeded", "kanbanView", "resetChecksOnNewCommits"]);
  document.getElementById("approvalsNeeded").value = parseInt(res.approvalsNeeded, 10) || 3;
  document.getElementById("kanbanView").checked = res.kanbanView !== undefined ? res.kanbanView : true;
  document.getElementById("resetChecksOnNewCommits").checked = res.resetChecksOnNewCommits !== undefined ? res.resetChecksOnNewCommits : true;
});
