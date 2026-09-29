/* ============================================================================
   Window preferences: app zoom and where this window remembers things
   (BRIDGEMIND-PORT.md §D13).

   Built so a measurement on the target machine swaps ONE value here, not a
   design. Both constants wait on the Windows probe (probe_edge.py):

   ZOOM_MODE    "native" - Edge's own Ctrl+= / Ctrl+- / Ctrl+0. Nothing to
                build; chosen if M2 shows the level survives a relaunch.
                "css" - `:root { zoom }` in steps, the three chords handled
                here, a readout in the sidebar footer. Needs M4 (the popovers
                land under their anchors at 125%).
   PREFS_STORE  "session" - dies with the window (the port changes every run,
                so localStorage would leave a dead entry per port).
                "local" - only with a stable port (server.py would have to
                reuse the last one); survives a relaunch.

   A LEAF: imports nothing, like api.js and choice.js. `<html data-zoom-mode>`
   overrides ZOOM_MODE, which is how a gate exercises the CSS branch without
   editing this file.
   ========================================================================= */
"use strict";

export const ZOOM_MODE = "native";
export const PREFS_STORE = "session";

const ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.5];
const ZOOM_KEY = "pcg.zoom";

function store() {
  try {
    return PREFS_STORE === "local" ? window.localStorage : window.sessionStorage;
  } catch (err) {
    return null;          // site data blocked: the window still boots
  }
}

export function readPref(key) {
  try {
    return JSON.parse(store()?.getItem(key) ?? "null");
  } catch (err) {
    return null;
  }
}

export function writePref(key, value) {
  try {
    store()?.setItem(key, JSON.stringify(value));
  } catch (err) {
    // A full or blocked store costs the preference, never the window.
  }
}

export function zoomMode() {
  return document.documentElement.dataset.zoomMode || ZOOM_MODE;
}

let zoom = 1;

function applyZoom(value) {
  zoom = ZOOM_STEPS.includes(value) ? value : 1;
  document.documentElement.style.setProperty("--zoom", String(zoom));
  const readout = document.getElementById("side-zoom");
  if (readout) {
    readout.hidden = zoom === 1;
    readout.textContent = (window.STRINGS?.sideZoom ?? "{n}")
      .replace("{n}", Math.round(zoom * 100).toLocaleString("fa-IR"));
  }
}

/* One step in `dir` (+1 / -1), or back to 100% with 0. */
export function zoomBy(dir) {
  const at = ZOOM_STEPS.indexOf(zoom);
  const next = dir === 0 ? 1
    : ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, at + dir))];
  applyZoom(next);
  writePref(ZOOM_KEY, next);
  return next;
}

export function currentZoom() {
  return zoom;
}

/* Ctrl+= / Ctrl+- / Ctrl+0, by `e.code` (a Persian layout's `e.key` is not
   the same key). Only in CSS mode: in native mode they are Edge's, untouched. */
const ZOOM_CODES = { Equal: 1, NumpadAdd: 1, Minus: -1, NumpadSubtract: -1,
                     Digit0: 0, Numpad0: 0 };

export function initZoom() {
  if (zoomMode() !== "css") return;
  document.documentElement.classList.add("css-zoom");
  applyZoom(readPref(ZOOM_KEY) ?? 1);
  document.addEventListener("keydown", (e) => {
    if (!e.ctrlKey || e.altKey || e.metaKey) return;
    const dir = ZOOM_CODES[e.code];
    if (dir === undefined) return;
    e.preventDefault();
    zoomBy(dir);
  }, true);
}
