// content script: listens for user clicks and triggers a manual capture when enabled.
let clickCaptureEnabled = false;

function handleClick(e) {
  // Use Shift+Click as the manual capture gesture to avoid accidental captures.
  if (!clickCaptureEnabled) return;
  if (!e.shiftKey) return;
  chrome.runtime.sendMessage({ type: "manual_capture", delay: 0 });
}

function updateFromStorage(items) {
  clickCaptureEnabled = !!items.clickCapture;
  if (clickCaptureEnabled) {
    document.addEventListener("click", handleClick, true);
  } else {
    document.removeEventListener("click", handleClick, true);
  }
}

// Initialize
chrome.storage.sync.get({ clickCapture: false }, (items) =>
  updateFromStorage(items),
);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.clickCapture) {
    updateFromStorage({ clickCapture: changes.clickCapture.newValue });
  }
});
