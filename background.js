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
  const metricsResult = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const root = document.documentElement;
      const body = document.body;
      const scroller = document.scrollingElement || root;
      const totalHeight = Math.max(
        scroller.scrollHeight,
        root.scrollHeight,
        body ? body.scrollHeight : 0,
        root.offsetHeight,
        body ? body.offsetHeight : 0,
      );
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      const dpr = window.devicePixelRatio || 1;
      const originalScroll =
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
        dpr,
        originalScroll,
      };
    },
  });

  let { totalHeight, viewportHeight, viewportWidth, dpr, originalScroll } =
    metricsResult[0].result;
  let maxScrollY = Math.max(0, totalHeight - viewportHeight);
  const images = [];

  // Scroll and capture each viewport
  let targetY = 0;
  for (let i = 0; i < 200; i++) {
    const scrollResult = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (scrollY) => {
        const root = document.documentElement;
        const body = document.body;
        const scroller = document.scrollingElement || root;
        const previousRootBehavior = root.style.scrollBehavior;
        const previousBodyBehavior = body ? body.style.scrollBehavior : "";

        const getMetrics = () => {
          const viewportHeight = window.innerHeight || root.clientHeight;
          const totalHeight = Math.max(
            scroller.scrollHeight,
            root.scrollHeight,
            body ? body.scrollHeight : 0,
            root.offsetHeight,
            body ? body.offsetHeight : 0,
          );
          return {
            maxScrollY: Math.max(0, totalHeight - viewportHeight),
            totalHeight,
            viewportHeight,
          };
        };

        const getY = () =>
          window.scrollY ||
          window.pageYOffset ||
          scroller.scrollTop ||
          root.scrollTop ||
          (body ? body.scrollTop : 0) ||
          0;

        const scrollInstantly = (y) => {
          try {
            window.scrollTo({ left: 0, top: y, behavior: "instant" });
          } catch (e) {
            window.scrollTo(0, y);
          }
          scroller.scrollTop = y;
          root.scrollTop = y;
          if (body) body.scrollTop = y;
        };

        root.style.scrollBehavior = "auto";
        if (body) body.style.scrollBehavior = "auto";

        try {
          let metrics = getMetrics();
          const targetY = Math.max(0, Math.min(scrollY, metrics.maxScrollY));

          for (let attempts = 0; attempts < 20; attempts++) {
            scrollInstantly(targetY);
            await new Promise((r) => setTimeout(r, 50));
            metrics = getMetrics();
            if (Math.abs(getY() - targetY) <= 2) break;
          }

          await new Promise((r) => requestAnimationFrame(() => r()));
          await new Promise((r) => requestAnimationFrame(() => r()));

          metrics = getMetrics();
          return {
            y: getY(),
            maxScrollY: metrics.maxScrollY,
            totalHeight: metrics.totalHeight,
            viewportHeight: metrics.viewportHeight,
          };
        } finally {
          root.style.scrollBehavior = previousRootBehavior;
          if (body) body.style.scrollBehavior = previousBodyBehavior;
        }
      },
      args: [targetY],
    });

    // small delay for layout
    await new Promise((r) => setTimeout(r, 100));

    // capture visible
    const data = await new Promise((resolve, reject) => {
      chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        resolve(dataUrl);
      });
    });

    const captured = scrollResult[0].result;
    totalHeight = Math.max(totalHeight, captured.totalHeight);
    viewportHeight = captured.viewportHeight || viewportHeight;
    maxScrollY = Math.max(maxScrollY, captured.maxScrollY);
    images.push({ dataUrl: data, y: captured.y });

    if (captured.y >= maxScrollY - 2) break;

    const nextY = Math.min(captured.y + viewportHeight, maxScrollY);
    if (nextY <= captured.y + 2) break;
    targetY = nextY;
  }

  // restore original scroll
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
        try {
          window.scrollTo({ left: 0, top: y, behavior: "instant" });
        } catch (e) {
          window.scrollTo(0, y);
        }
        scroller.scrollTop = y;
        root.scrollTop = y;
        if (body) body.scrollTop = y;
      } finally {
        root.style.scrollBehavior = previousRootBehavior;
        if (body) body.style.scrollBehavior = previousBodyBehavior;
      }
    },
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
