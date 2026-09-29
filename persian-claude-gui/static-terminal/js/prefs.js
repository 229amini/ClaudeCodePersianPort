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
   overrides ZOOM_MODE, which is how a gate exercises either branch without
   editing this file.

   CSS since 2026-09-29, on the user's report that a 2K screen at 100%
   Windows scaling draws everything small: only this mode can START larger
   (autoZoom), because Edge's own level is per origin and the origin changes
   every run. That made M4 ours to answer, and it failed as feared: under
   `:root { zoom }` a rect is in SCREEN px while a style length is in CSS px,
   so every menu placed from a rect landed `zoom` times too far out. Every
   such write now goes through cssPx() (wiki/grid.md §"App zoom").
   ========================================================================= */
"use strict";

export const ZOOM_MODE = "css";
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
let base = 1;          // this screen's own level (autoZoom); Ctrl+0 returns here

/* The level that makes this screen read like a 1920-wide one: a 2560 x 1440
   panel at 100% scaling is 1.33, and the nearest step at or under it (with a
   little slack, so 2048 -> 1.1) is 1.25. Never below 1: a small screen keeps
   its size. `screen.width` is already in CSS px, so Windows' own scaling is
   counted once, not twice. The WINDOW caps it too: `@media` rules do not see
   root zoom, so a half-screen window zoomed 125% would get the layout of a
   window a quarter wider than the room it really has. Below AUTO_MIN_ROOM CSS
   px of width the level steps down. */
const AUTO_MIN_ROOM = 1100;

export function autoZoom(width = window.screen?.width || 1920,
                         room = window.innerWidth || 1920) {
  const ratio = width / 1920;
  return ZOOM_STEPS.filter((s) => s >= 1 && s <= ratio + 0.05
                                  && (s === 1 || room / s >= AUTO_MIN_ROOM)).pop() ?? 1;
}

/* Screen px -> CSS px. A rect, innerWidth and a pointer's clientX are in
   screen px; a style length, offsetWidth and scrollHeight are in CSS px.
   Measured on Chromium 141: a popover given `left: rect.left` at zoom 1.25
   lands at 1.25 x rect.left. 1 in native mode, so it costs nothing there. */
export function cssPx(v) {
  return v / zoom;
}

function applyZoom(value) {
  zoom = ZOOM_STEPS.includes(value) ? value : base;
  document.documentElement.style.setProperty("--zoom", String(zoom));
  const readout = document.getElementById("side-zoom");
  if (readout) {
    readout.hidden = zoom === base;
    readout.textContent = (window.STRINGS?.sideZoom ?? "{n}")
      .replace("{n}", Math.round(zoom * 100).toLocaleString("fa-IR"));
  }
}

/* One step in `dir` (+1 / -1), or back to this screen's own level with 0. */
export function zoomBy(dir) {
  const at = ZOOM_STEPS.indexOf(zoom);
  const next = dir === 0 ? base
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
  base = autoZoom();
  applyZoom(readPref(ZOOM_KEY) ?? base);
  // Until the user picks a level, the automatic one follows the window.
  window.addEventListener("resize", () => {
    const was = base;
    base = autoZoom();
    if (base !== was && readPref(ZOOM_KEY) === null) applyZoom(base);
    else applyZoom(zoom);     // the readout compares against the new base
  });
  document.addEventListener("keydown", (e) => {
    if (!e.ctrlKey || e.altKey || e.metaKey) return;
    const dir = ZOOM_CODES[e.code];
    if (dir === undefined) return;
    e.preventDefault();
    zoomBy(dir);
  }, true);
}
