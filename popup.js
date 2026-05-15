document.addEventListener("DOMContentLoaded", async () => {
  const enable = document.getElementById("enable");
  const delayInput = document.getElementById("delay");
  const takeBtn = document.getElementById("take");

  const opts = await new Promise((r) =>
    chrome.storage.sync.get({ enabled: false }, r),
  );
  enable.checked = !!opts.enabled;

  const clickCheckbox = document.getElementById("clickCapture");
  const opts2 = await new Promise((r) =>
    chrome.storage.sync.get({ clickCapture: false }, r),
  );
  clickCheckbox.checked = !!opts2.clickCapture;

  enable.addEventListener("change", () => {
    chrome.storage.sync.set({ enabled: enable.checked });
  });

  clickCheckbox.addEventListener("change", () => {
    chrome.storage.sync.set({ clickCapture: clickCheckbox.checked });
  });

  takeBtn.addEventListener("click", async () => {
    const secs = Number(delayInput.value) || 0;
    // send message to background to start manual capture for the active tab
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    chrome.runtime.sendMessage(
      { type: "manual_capture", delay: secs * 1000, tabId: tab.id },
      (resp) => {
        // silent
      },
    );
    window.close();
  });
});
