const browserApi = typeof browser !== "undefined" ? browser : chrome;

document.getElementById("saveSettings").addEventListener("click", () => {
  let approvalsNeeded = parseInt(document.getElementById("approvalsNeeded").value, 10);
  let kanbanView = document.getElementById("kanbanView").checked;

  browserApi.storage.sync.set({ approvalsNeeded, kanbanView }).then(
    () => {
      const alertMessage = document.getElementById("alertMessage");
      alertMessage.classList.add("show");
      setTimeout(() => alertMessage.classList.remove("show"), 3000);
    },
    () => {
      const errorMessage = document.getElementById("errorMessage");
      errorMessage.classList.add("show", "error-message");
      setTimeout(() => errorMessage.classList.remove("show"), 3000);
    }
  );
});

// Load settings on popup open
window.addEventListener("DOMContentLoaded", async () => {
  const res = await browserApi.storage.sync.get(["approvalsNeeded", "kanbanView"]);
  document.getElementById("approvalsNeeded").value = parseInt(res.approvalsNeeded, 10) || 3;
  document.getElementById("kanbanView").checked = res.kanbanView !== undefined ? res.kanbanView : true;
});
