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

  const initialMetrics = await getPageMetrics(tabId);
  const { viewportWidth, dpr, originalScroll } = initialMetrics;
  let totalHeight = initialMetrics.totalHeight;
  let viewportHeight = initialMetrics.viewportHeight;
  let maxScrollY = initialMetrics.maxScrollY;
  const images = [];

  // Scroll and capture each viewport
  let targetY = 0;
  let lastCapturedY = -1;
  for (let i = 0; i < 200; i++) {
    await scrollPageTo(tabId, targetY);
    const captured = await waitForScrollPosition(tabId, targetY);

    if (i > 0 && captured.scrollY <= lastCapturedY + 2) break;

    // capture visible
    const data = await captureVisiblePng();

    totalHeight = Math.max(totalHeight, captured.totalHeight);
    viewportHeight = captured.viewportHeight || viewportHeight;
    maxScrollY = Math.max(maxScrollY, captured.maxScrollY);
    images.push({ dataUrl: data, y: captured.scrollY });
    lastCapturedY = captured.scrollY;

    if (captured.scrollY >= maxScrollY - 2) break;

    const nextY = Math.min(captured.scrollY + viewportHeight, maxScrollY);
    if (nextY <= captured.scrollY + 2) break;
    targetY = nextY;
  }

  // restore original scroll
  await scrollPageTo(tabId, originalScroll);

  if (!images.length) {
    throw new Error("No viewport images captured");
  }

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
  const stitchResult = await new Promise((resolve, reject) => {
    const onResp = (m) => {
      if (m && m.type === "stitched" && m.tabId === tabId) {
        chrome.runtime.onMessage.removeListener(onResp);
        if (m.error) reject(new Error(m.error));
        else resolve(m.dataUrl);
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

async function getPageMetrics(tabId) {
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const root = document.documentElement;
      const body = document.body;
      const scroller = document.scrollingElement || root;
      const viewportHeight =
        window.innerHeight || root.clientHeight || scroller.clientHeight;
      const viewportWidth =
        window.innerWidth || root.clientWidth || scroller.clientWidth;
      const totalHeight = Math.max(
        scroller.scrollHeight,
        root.scrollHeight,
        body ? body.scrollHeight : 0,
        root.offsetHeight,
        body ? body.offsetHeight : 0,
        viewportHeight,
      );
      const scrollY =
        window.scrollY ||
        window.pageYOffset ||
        scroller.scrollTop ||
        root.scrollTop ||
        (body ? body.scrollTop : 0) ||
        0;

      return {
        totalHeight,
        viewportHeight,
        viewportWidth,
        dpr: window.devicePixelRatio || 1,
        scrollY,
        maxScrollY: Math.max(0, totalHeight - viewportHeight),
        originalScroll: scrollY,
      };
    },
  });

  return result[0].result;
}

async function scrollPageTo(tabId, y) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (y) => {
      const root = document.documentElement;
      const body = document.body;
      const scroller = document.scrollingElement || root;
      const previousRootBehavior = root.style.scrollBehavior;
      const previousBodyBehavior = body ? body.style.scrollBehavior : "";

      root.style.scrollBehavior = "auto";
      if (body) body.style.scrollBehavior = "auto";

      try {
        const targetY = Math.max(0, Number(y) || 0);
        window.scrollTo(0, targetY);
        scroller.scrollTop = targetY;
        root.scrollTop = targetY;
        if (body) body.scrollTop = targetY;
      } finally {
        root.style.scrollBehavior = previousRootBehavior;
        if (body) body.style.scrollBehavior = previousBodyBehavior;
      }
    },
    args: [y],
  });
}

async function waitForScrollPosition(tabId, targetY) {
  let metrics = await getPageMetrics(tabId);
  for (let i = 0; i < 20; i++) {
    const expectedY = Math.min(Math.max(0, targetY), metrics.maxScrollY);
    if (Math.abs(metrics.scrollY - expectedY) <= 2) break;
    await sleep(75);
    metrics = await getPageMetrics(tabId);
  }

  await sleep(100);
  return getPageMetrics(tabId);
}

async function captureVisiblePng() {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      resolve(dataUrl);
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
