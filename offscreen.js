// Offscreen stitcher: listens for 'stitch' messages, creates canvas, draws images sequentially,
// then returns a dataUrl via runtime message.

chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
  if (msg && msg.type === "stitch") {
    const { images, width, height, dpr, tabId } = msg;
    try {
      const cvs = document.createElement("canvas");
      cvs.width = Math.round(width * dpr);
      cvs.height = Math.round(height * dpr);
      const ctx = cvs.getContext("2d");

      for (const imgMeta of images) {
        const img = new Image();
        img.src = imgMeta.dataUrl;
        await new Promise((res, rej) => {
          img.onload = res;
          img.onerror = rej;
        });
        // Draw at (0, y*dpr)
        ctx.drawImage(img, 0, Math.round(imgMeta.y * dpr));
      }

      const dataUrl = cvs.toDataURL("image/png");
      chrome.runtime.sendMessage({ type: "stitched", dataUrl, tabId });
    } catch (e) {
      console.error("offscreen stitch error", e);
      chrome.runtime.sendMessage({ type: "stitched", error: String(e), tabId });
    }
  }
});
