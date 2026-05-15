# Auto Fullpage Screenshot (Chrome Extension)

Features:

- Automatically captures a stitched full-page PNG on each top-level navigation when enabled.
- Manual timed capture from the popup (so you can open modals or menus before capture).
- Option to set a subfolder inside Downloads for saved screenshots.

Limitations & notes:

- Chrome extensions cannot write arbitrary filesystem paths; screenshots are saved via the downloads API into the user's Downloads folder (you can specify a subfolder name).
- Full-page capture is done by scrolling the page and capturing viewports, then stitching in an offscreen document. Very tall pages may produce large images.
- Full-page capture is done by scrolling the page and capturing viewports, then stitching in an offscreen document. Very tall pages may produce large images.
- Capture-on-click: the extension supports "Shift+Click" capture (toggleable in the popup). Hold Shift and click anywhere on the page to trigger a manual full-page capture. This avoids accidental captures while keeping the workflow quick.

Install for development:

1. Open chrome://extensions
2. Enable "Developer mode"
3. Click "Load unpacked" and pick this repository folder

Files of interest:

- `manifest.json` - extension manifest
- `background.js` - service worker and capture orchestration
- `content_script.js` - (lightweight) content script
- `offscreen.html` / `offscreen.js` - stitches images
- `popup.html` / `popup.js` - controls
- `options.html` / `options.js` - settings
