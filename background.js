// background service worker

const DEFAULT_FOLDER = "autoscreenshots";

async function getOptions() {
  return new Promise((res) =>
    chrome.storage.sync.get({ folder: DEFAULT_FOLDER, enabled: false }, res),
  );
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.set({
    folder: DEFAULT_FOLDER,
    enabled: false,
    clickCapture: false,
  });
});

// Listen for navigation completed to capture when enabled
chrome.webNavigation.onCompleted.addListener(async (details) => {
  if (details.frameId !== 0) return; // top frame only
  const opts = await new Promise((r) =>
    chrome.storage.sync.get({ enabled: false }, r),
  );
  if (!opts.enabled) return;

  try {
    await captureFullPage(details.tabId);
  } catch (e) {
    console.error("captureFullPage failed", e);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "manual_capture") {
    const delay = Number(msg.delay || 0);
    const tabId = sender.tab ? sender.tab.id : msg.tabId;
    setTimeout(() => captureFullPage(tabId).catch(console.error), delay);
    sendResponse({ started: true });
    return true;
  }
  return false;
});

async function captureFullPage(tabId) {
  if (!tabId) throw new Error("no tabId");

  // Ask content script for page metrics
  const metrics = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const totalHeight = Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
      );
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      const dpr = window.devicePixelRatio || 1;
      const originalScroll = window.scrollY;
      return {
        totalHeight,
        viewportHeight,
        viewportWidth,
        dpr,
        originalScroll,
      };
    },
  });

  const { totalHeight, viewportHeight, viewportWidth, dpr, originalScroll } =
    metrics[0].result;
  const steps = Math.ceil(totalHeight / viewportHeight);
  const images = [];

  // Scroll and capture each viewport
  for (let i = 0; i < steps; i++) {
    const y = i * viewportHeight;
    // scroll the page
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (scrollY) => window.scrollTo(0, scrollY),
      args: [y],
    });

    // small delay for layout
    await new Promise((r) => setTimeout(r, 250));

    // capture visible
    const data = await new Promise((resolve, reject) => {
      chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        resolve(dataUrl);
      });
    });
    images.push({ dataUrl: data, y });
  }

  // restore original scroll
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (y) => window.scrollTo(0, y),
    args: [originalScroll],
  });

  // Create offscreen document to stitch
  const url = "offscreen.html";
  const exists = await chrome.offscreen.hasDocument();
  if (!exists) {
    await chrome.offscreen.createDocument({
      url,
      reasons: ["DOM_PARSER"],
      justification: "Stitching screenshots",
    });
  }

  // send images to offscreen to stitch
  const stitchResult = await new Promise((resolve) => {
    const onResp = (m) => {
      if (m && m.type === "stitched" && m.tabId === tabId) {
        chrome.runtime.onMessage.removeListener(onResp);
        resolve(m.dataUrl);
      }
    };
    chrome.runtime.onMessage.addListener(onResp);
    chrome.runtime.sendMessage({
      type: "stitch",
      images,
      width: viewportWidth,
      height: totalHeight,
      dpr,
      tabId,
    });
  });

  // Download the stitched image
  const opts = await new Promise((r) =>
    chrome.storage.sync.get({ folder: DEFAULT_FOLDER }, r),
  );
  const folder = opts.folder || DEFAULT_FOLDER;
  const filename = `${folder}/screenshot-${Date.now()}.png`;
  await chrome.downloads.download({
    url: stitchResult,
    filename,
    conflictAction: "uniquify",
  });
}
