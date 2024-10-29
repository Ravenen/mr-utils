var browser = browser ? browser : chrome;

document.getElementById("saveSettings").addEventListener("click", () => {
  let approvalsNeeded = document.getElementById("approvalsNeeded").value;
  let kanbanView = document.getElementById("kanbanView").checked;

  approvalsNeeded = parseInt(approvalsNeeded, 10);

  browser.storage.sync.set({ approvalsNeeded: approvalsNeeded, kanbanView: kanbanView }).then(
    () => {
      const alertMessage = document.getElementById("alertMessage");
      alertMessage.classList.add("show");

      // Hide the alert after 3 seconds
      setTimeout(() => {
        alertMessage.classList.remove("show");
      }, 3000);
    },
    () => {
      console.error("Error saving settings");

      // Show the error alert
      const errorMessage = document.getElementById("errorMessage");
      errorMessage.classList.add("show", "error-message");

      // Hide the error alert after 3 seconds
      setTimeout(() => {
        errorMessage.classList.remove("show");
      }, 3000);
    }
  );
});

// Load existing settings on popup open
window.addEventListener("DOMContentLoaded", async () => {
  const res = await browser.storage.sync.get(["approvalsNeeded", "kanbanView"]);
  const savedApprovalsNeeded = parseInt(res.approvalsNeeded, 10) || 3;
  const savedKanbanView = res.kanbanView !== undefined ? res.kanbanView : true;

  document.getElementById("approvalsNeeded").value = savedApprovalsNeeded;
  document.getElementById("kanbanView").checked = savedKanbanView;
});
