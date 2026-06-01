document.addEventListener("DOMContentLoaded", async () => {
  const enable = document.getElementById("enable");
  const delayInput = document.getElementById("delay");
  const takeBtn = document.getElementById("take");
  const intervalToggle = document.getElementById("intervalToggle");
  const intervalStatus = document.getElementById("intervalStatus");
  let visibleIntervalRunning = false;

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

  intervalToggle.addEventListener("click", async () => {
    intervalToggle.disabled = true;
    const type = visibleIntervalRunning
      ? "visible_interval_stop"
      : "visible_interval_start";

    try {
      const resp = await sendVisibleIntervalMessage(type);
      updateVisibleIntervalUi(!!resp.running, !resp.error);
    } catch (error) {
      updateVisibleIntervalUi(false, false);
    }
  });

  refreshVisibleIntervalStatus();

  async function refreshVisibleIntervalStatus() {
    try {
      const resp = await sendVisibleIntervalMessage("visible_interval_status");
      updateVisibleIntervalUi(!!resp.running, !resp.error);
    } catch (error) {
      updateVisibleIntervalUi(false, false);
    }
  }

  async function sendVisibleIntervalMessage(type) {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab || !tab.id) throw new Error("No active tab");

    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, tabId: tab.id }, (resp) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(resp || {});
      });
    });
  }

  function updateVisibleIntervalUi(running, supported) {
    visibleIntervalRunning = running;
    intervalToggle.disabled = !supported;
    intervalToggle.dataset.running = running ? "true" : "false";
    intervalToggle.setAttribute("aria-pressed", running ? "true" : "false");
    intervalToggle.textContent = running ? "Stop" : "Start every 5s";

    if (!supported) {
      intervalStatus.textContent = "Unavailable on this page";
    } else {
      intervalStatus.textContent = running ? "Running" : "Stopped";
    }
  }
});
