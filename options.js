document.addEventListener("DOMContentLoaded", async () => {
  const folderInput = document.getElementById("folder");
  const saveBtn = document.getElementById("save");

  const opts = await new Promise((r) =>
    chrome.storage.sync.get({ folder: "autoscreenshots" }, r),
  );
  folderInput.value = opts.folder || "autoscreenshots";

  saveBtn.addEventListener("click", () => {
    const folder = folderInput.value.trim() || "autoscreenshots";
    chrome.storage.sync.set({ folder }, () => {
      saveBtn.textContent = "Saved";
      setTimeout(() => (saveBtn.textContent = "Save"), 1000);
    });
  });
});
