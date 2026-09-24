/* ============================================================================
   Entry point: SSE transport, the tab registry, and init order.

   Module map (was one 1100-line classic script until 2026-08-05):

     api.js       token + fetch helper                       (leaf, no imports)
     bidi.js      the whole BiDi contract, spec rules 1-2    (leaf, no imports)
     controls.js  makeControls: pickers + posture, per cell
     render.js    renderEvent: stream events -> DOM
     chrome.js    sidebar, home state, replay
     perm.js      makePerm: the permission dialog, per cell
     composer.js  makeComposer: input, ZWNJ, send/stop, slash, per cell
     commands.js  the window-local commands of V2-PLAN §3.5
     agents.js    background-agents strip + per-agent drawer
     app.js       this file

   THE CELL. Three of those modules are FACTORIES (MA3-T1): a cell is one
   conversation's worth of window — a root element, the transcript in it, its
   status line, its composer, its controls, its permission dialog, and the tab
   it is currently showing. MA3-T2 builds 1, 2 or 4 of them into #grid from
   index.html's <template id="cell-tpl">. Everything that used to be a
   module-level singleton is reached through the cell, and `cell.tab` is read at
   CALL time because it changes under every closure each time a view is placed.

   THE THREE WINDOW-LEVEL CHORDS (Esc, Shift+Tab, Ctrl+O/T) are registered ONCE,
   at the foot of this file, and dispatched to the FOCUSED cell. Bound inside a
   factory they would have been registered per column, and one Esc would have
   stopped four turns.

   LOAD ORDER. render.js and chrome.js import each other on purpose (the
   renderer drives the sidebar; the sidebar replays through the renderer). That
   cycle is only safe because NO module body does work at evaluation time — the
   side effects live in initChrome() / initComposer(), called from here once
   every module is live, in the same order the single-file version ran them.
   Keep it that way: a `const` read across the cycle during evaluation is a
   temporal-dead-zone crash with a very unhelpful stack. Nothing may import THIS
   module either (it is the entry: its body runs last), which is why chrome.js
   is handed setTabBridge() rather than importing the switch itself.

   commands.js (v2.5) is imported BY composer.js and imports nothing that
   imports it back, so the cycle above is still the only one.

   strings.fa.js and vendor/marked.min.js stay CLASSIC scripts: they set window
   globals and classic scripts finish before any module runs.
   ========================================================================= */
"use strict";

import { renderMarkdown } from "./bidi.js";
import {
  renderEvent, setStatus, state, resetTurn, clearPulse,
  newRenderScope, withRenderTarget, inRenderTarget, initTranscript, applyChrome,
  setFocusedCell, shortModel, bubble,
} from "./render.js";
import {
  initChrome, initCellChrome, setTabBridge, setOpenTabs, setCurrentSession,
  setChrome, refreshProjects, backfillTab, refreshWhen, kebabMenu, tabTitle,
} from "./chrome.js";
import { runWindowCommand } from "./commands.js";
import { makePerm, dismissTabPermissions, setPermFocus } from "./perm.js";
import { makeComposer } from "./composer.js";
import { makeControls } from "./controls.js";
import { initAgents, applyAgents, refreshAgents, resetAgents } from "./agents.js";
import { api, token } from "./api.js";
import { initNewSession, openNewSession, newSessionOpen } from "./newsession.js";
import { initNotices, pushNotice, markRead, togglePanel } from "./notices.js";

const FA = window.STRINGS;

// Reused by history replay and by spec-test.html, so the acceptance tests
// exercise the shipping code path rather than a copy of it.
window.renderEvent = renderEvent;
window.renderMarkdown = renderMarkdown;
// Same seam for the agents strip: the harness paints it from a synthetic
// /api/agents payload, through the shipping builder rather than a copy.
window.renderAgents = applyAgents;
// And for the idle hint, whose hour the harness fast-forwards via `now`. THE
// window's own tick, not a second path to it — see tickIdle() at the foot of
// this file for why only one column is ever asked.
window.checkIdle = tickIdle;

/* No token means this page is not driving a server. spec-test.html DOES carry
   one (its subresources need the auth cookie) but is a rendering harness, so it
   opts out explicitly: a live stream would render real events into the middle
   of the test log, the never-ending request stops a headless --dump-dom run
   from ever settling (run_spec_test.py), and a /api/tabs answer would swap the
   harness's own view out from under it. */
const wantsTransport = token && !document.body.hasAttribute("data-render-only");

/* --- the tab registry -------------------------------------------------------

   N conversations, one window. The server runs a real `claude` process per tab
   and stamps every SSE event with the tab it belongs to; here each tab owns a
   DETACHED node holding its transcript and a render scope holding everything
   the renderer accumulates per conversation (the streaming bubble, the tool
   cards, the statusline data). Exactly one of those nodes' contents lives in
   #log at a time — the design is one visible view and N buffered ones, not a
   split pane.

   What makes this safe is the same seam the agents drawer replays through
   (render.js withRenderTarget), plus one rule: a background scope is marked
   `background: true`, and every call that would repaint the WINDOW rather than
   the transcript is gated on it. Anything a background tab learns about itself
   waits in `scope.chrome` and is applied here, at switch time. */

/* THE CELLS (MA3-T2). 1, 2 or 4 columns, stamped from index.html's
   <template id="cell-tpl"> into #grid. `cells` is exported for spec-test.html,
   which has no grid at all and IS the one cell (`root = document.body`),
   reaching this window's control set through it. */
export const cells = [];

/* Which cell the keyboard belongs to. An INDEX, not a reference: cells are
   created and removed by /split, and every caller asks rather than holding a
   pointer that a shrink would leave dangling. */
let focused = 0;

export function focusedCell() {
  return cells[focused] ?? cells[0] ?? null;
}

/* A tab lives in at most ONE cell. Both directions of that rule are read off
   this: placing a tab that is already on screen focuses its column instead of
   drawing it twice, and every "is this conversation being watched?" question
   (the unread counter, the auto-fill after a close) is the same lookup. */
export function cellOf(tab) {
  return tab ? cells.find((one) => one.tab === tab) ?? null : null;
}

function focusedTab() {
  return focusedCell()?.tab || null;
}

/* `body.busy` is still written — agents.js and the idle hint read it — but with
   a grid it can only mean ONE column, and the honest one is the column the
   keyboard is in. Each cell carries its own `.busy` (composer.setBusy), which
   is what its own stop button and spinner key off. */
function mirrorBusy() {
  document.body.classList.toggle("busy", !!focusedCell()?.composer?.isBusy());
}

/* One conversation's worth of window. `tab` is written by placeIn() below and
   read by every session-scoped POST the three factories make -- never cached by
   them, because it changes here. */
function makeCell(root) {
  const cell = {
    root,
    tab: "",
    cwd: "",            // the folder of the conversation in this column
    log: root.querySelector(".log"),
    statusline: root.querySelector(".statusline"),
    queueStrip: null,   // built lazily by render.js paintQueued()
    // The render scope a column uses while it holds no conversation. A cell
    // always has a scope, so setStatus() and paintQueued() always have somewhere
    // to write, and focus can move onto an empty column without `state` still
    // describing the one it left.
    blankScope: null,
    // composer.setBusy calls this; app.js decides what `body.busy` should say.
    onBusy: mirrorBusy,
  };
  // The same order the single-file version ran its init in: the dialog binds
  // before the composer's capture-phase key handler, and the controls last.
  cell.perm = makePerm(root, cell);
  cell.composer = makeComposer(root, cell);
  cell.controls = makeControls(root, cell);
  cell.blankScope = newRenderScope(false, cell, "");
  initCellChrome(cell);
  initPaneHeader(cell);
  return cell;
}

/* THE PANE HEADER'S THREE CONTROLS (BRIDGEMIND-PORT.md §D5): ⋯ the pane's
   menu, ⤢ fullscreen, ✕ take it off screen. Wired here and not in chrome.js
   because two of the three act on the grid, which this module owns. */
function initPaneHeader(cell) {
  const q = (cls) => cell.root.querySelector("." + cls);
  const menuBtn = q("pane-menu");
  if (!menuBtn) return;                 // spec-test.html: no pane header
  const name = (el, text) => {
    el.title = text;
    el.setAttribute("aria-label", text);
  };
  name(menuBtn, FA.paneMenu);
  name(q("pane-zoom"), FA.paneZoom);
  name(q("pane-close"), FA.paneClose);
  // The menu names live values (model, cost), so it is rebuilt on every open.
  const [, menu] = kebabMenu(() => paneMenuItems(cell), menuBtn);
  cell.root.append(menu);               // a popover: its parent only owns its lifetime
  q("pane-zoom").addEventListener("click", () => toggleZoom(cell));
  q("pane-close").addEventListener("click", () => takeOffScreen(cell));
  // An empty pane's one button opens the new-session page (§D8). In the home
  // state (one pane, nothing open) it is the whole page; in an empty pane of a
  // grid it asks for exactly one conversation, placed HERE.
  q("empty-btn")?.addEventListener("click", () =>
    openNewSession({ target: cells.length > 1 ? cell : null }));
}

function paneMenuItems(cell) {
  const s = (cell === focusedCell() ? state : scopeOf(cell))?.status ?? {};
  const items = [
    { icon: "", text: FA.paneModel.replace("{name}", s.model ? shortModel(s.model) : "—"),
      run: () => cell.controls.openModelPicker() },
    { icon: "", text: FA.paneEffort, run: () => cell.controls.openEffortPicker() },
    { icon: "", text: FA.paneStyle, run: () => cell.controls.openStylePicker() },
    { icon: "", text: FA.panePosture, run: () => cell.controls.openPosturePicker() },
  ];
  if (typeof s.cost === "number") {
    items.push({ note: FA.paneCost.replace("{cost}", "$" + s.cost.toFixed(2)) });
  }
  if (cells.length > 1) items.push({ icon: "", text: FA.paneEqualize, run: () => equalize() });
  items.push(null,
    { icon: "", text: FA.paneBranch, run: () => runWindowCommand("branch", "", cell) },
    null,
    { icon: "", text: FA.paneCloseChat, danger: true, run: () => closeTab(cell.tab) });
  return items;
}

/* FULLSCREEN (§D5): one pane fills the stage; the others stay in the DOM and
   keep receiving events (hidden, never parked). Leaving it is the same button,
   or Esc - but only when Esc would otherwise do nothing (see the Esc handler
   at the foot of this file): a stop always wins. */
let zoomed = null;

function toggleZoom(cell) {
  const grid = document.getElementById("grid");
  if (!grid) return;
  const on = !!cell && zoomed !== cell && cells.length > 1;
  zoomed = on ? cell : null;
  for (const one of cells) {
    one.root.classList.toggle("zoomed", one === zoomed);
    const btn = one.root.querySelector(".pane-zoom");
    if (btn) {
      const text = one === zoomed ? FA.paneUnzoom : FA.paneZoom;
      btn.title = text;
      btn.setAttribute("aria-label", text);
      btn.setAttribute("aria-pressed", String(one === zoomed));
    }
  }
  if (on) grid.dataset.zoomed = "true";
  else delete grid.dataset.zoomed;
  if (on) focusCell(cells.indexOf(cell), { focusInput: true });
}

/* ✕ on a pane: the conversation leaves the screen and stays open (§D5) -
   the sidebar still lists it, one click brings it back. */
function takeOffScreen(cell) {
  if (zoomed) toggleZoom(null);
  if (cells.length > 1) removeCell(cell);
  else blank(cell);
}

/* --- THE GRID THAT FITS N (BRIDGEMIND-PORT.md §D6) ---------------------------

   The number of panes is the number of conversations on screen, 1 to
   MAX_PANES. layoutFor() picks the column count whose panes read best (a pane
   wants to be ~1.5x wider than tall: text lines want width), refusing any
   layout whose panes fall under the minimum; the last row holds what is left
   and its panes share its whole width, so three panes are 2 + 1 with the third
   full-width. `strict: false` is the best effort a caller that must draw N
   panes anyway gets (`/split` on a small window, a restored layout) - only
   ADDING a pane is ever refused. */
const MAX_PANES = 6;          // = server.py MAX_TABS
const PANE_MIN_W = 360;
const PANE_MIN_H = 240;

export function layoutFor(n, W, H, gap = 8, strict = true) {
  let best = null;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const w = (W - (cols - 1) * gap) / cols;
    const h = (H - (rows - 1) * gap) / rows;
    if (strict && (w < PANE_MIN_W || h < PANE_MIN_H)) continue;
    // Strict ">" keeps the FEWER-columns layout on a tie.
    const score = Math.min(w / 1.5, h);
    if (!best || score > best.score) best = { cols, rows, score };
  }
  if (!best) return null;
  const last = n - best.cols * (best.rows - 1);
  return { rows: Array.from({ length: best.rows },
                            (_, r) => (r === best.rows - 1 ? last : best.cols)) };
}

/* Each row's panes, and each row, as flex-grow proportions. `null` = equal.
   Kept across a rebuild only while the shape is the same shape. */
let fractions = null;

function gapPx() {
  return parseFloat(getComputedStyle(document.body).getPropertyValue("--gap")) || 8;
}

function gridBox() {
  const r = document.getElementById("grid")?.getBoundingClientRect();
  return { W: r?.width || innerWidth, H: r?.height || innerHeight };
}

function shapeNow() {
  const { W, H } = gridBox();
  const n = cells.length;
  return (layoutFor(n, W, H, gapPx(), true) ?? layoutFor(n, W, H, gapPx(), false)).rows;
}

/* Rebuild #grid as rows of panes with a divider in every gutter. Cells are
   MOVED, never recreated - their logs, dialogs and composers go with them - but
   a detached element forgets its scroll offset and its focus, so both are put
   back. */
function arrangeGrid() {
  const grid = document.getElementById("grid");
  if (!grid || !cells.length) return;
  const shape = shapeNow();
  const same = fractions && fractions.rows.length === shape.length
    && fractions.rows.every((row, r) => row.length === shape[r]);
  if (!same) fractions = { rows: shape.map((c) => Array(c).fill(1)), rowH: shape.map(() => 1) };
  const scrolls = cells.map((one) => one.log.scrollTop);
  const active = document.activeElement;
  const frag = document.createDocumentFragment();
  let at = 0;
  shape.forEach((count, r) => {
    if (r) frag.append(divider("h", r - 1, 0));
    const row = document.createElement("div");
    row.className = "grid-row";
    for (let k = 0; k < count; k++) {
      if (k) row.append(divider("v", r, k - 1));
      row.append(cells[at++].root);
    }
    frag.append(row);
  });
  grid.replaceChildren(frag);
  applyFractions();
  cells.forEach((one, i) => { one.log.scrollTop = scrolls[i]; });
  if (active && active !== document.activeElement && document.contains(active)) {
    active.focus({ preventScroll: true });
  }
  // «۱»..«۶» in reading order - a removed pane renumbers the ones after it.
  cells.forEach((one, i) => {
    const badge = one.root.querySelector(".cell-badge");
    if (!badge) return;
    badge.textContent = (i + 1).toLocaleString("fa-IR");
    badge.title = (FA.cellBadgeTitle ?? "").replace("{n}", badge.textContent);
    one.root.setAttribute("aria-keyshortcuts", "Alt+" + (i + 1));
  });
}

function applyFractions() {
  const rows = [...document.querySelectorAll("#grid > .grid-row")];
  rows.forEach((row, r) => {
    row.style.flexGrow = String(fractions.rowH[r] ?? 1);
    [...row.querySelectorAll(":scope > .cell")].forEach((el, k) => {
      el.style.flexGrow = String(fractions.rows[r]?.[k] ?? 1);
    });
  });
}

function equalize(row = null) {
  if (!fractions) return;
  if (row === null) {
    fractions = { rows: fractions.rows.map((r) => r.map(() => 1)),
                  rowH: fractions.rowH.map(() => 1) };
  } else {
    fractions.rows[row] = fractions.rows[row].map(() => 1);
  }
  applyFractions();
  saveLayout();
}

/* A gutter you can grab (§D6). The 8px of ground IS the divider; it draws a
   bar only on hover, focus and drag. `kind` "v" sits between panes k and k+1 of
   row r, "h" between rows r and r+1. Geometry is read from rects, never from
   "left"/"right" assumptions, so RTL needs no special case. */
function divider(kind, r, k) {
  const d = document.createElement("div");
  d.className = "divider " + kind;
  d.tabIndex = 0;
  d.setAttribute("role", "separator");
  d.setAttribute("aria-orientation", kind === "v" ? "vertical" : "horizontal");
  d.setAttribute("aria-label", FA.dividerLabel);
  d.title = FA.dividerLabel;
  d.addEventListener("pointerdown", (e) => startDrag(e, d, kind, r, k));
  d.addEventListener("dblclick", () => equalize(kind === "v" ? r : null));
  d.addEventListener("keydown", (e) => {
    const step = { ArrowLeft: -24, ArrowRight: 24, ArrowUp: -24, ArrowDown: 24 }[e.key];
    const axisOk = kind === "v" ? /Left|Right/.test(e.key) : /Up|Down/.test(e.key);
    if (step && axisOk) {
      e.preventDefault();
      resizePair(kind, r, k, step);
    } else if (e.key === "Enter") {
      e.preventDefault();
      equalize(kind === "v" ? r : null);
    }
  });
  return d;
}

/* The two boxes a divider sits between, and their share of the fractions. */
function pairOf(kind, r, k) {
  if (kind === "v") {
    const row = document.querySelectorAll("#grid > .grid-row")[r];
    const panes = row ? [...row.querySelectorAll(":scope > .cell")] : [];
    return { a: panes[k], b: panes[k + 1], list: fractions.rows[r], ia: k, ib: k + 1 };
  }
  const rows = [...document.querySelectorAll("#grid > .grid-row")];
  return { a: rows[r], b: rows[r + 1], list: fractions.rowH, ia: r, ib: r + 1 };
}

/* Move a divider by `delta` physical px (+ = right/down). */
function resizePair(kind, r, k, delta) {
  const { a, b, list, ia, ib } = pairOf(kind, r, k);
  if (!a || !b) return;
  const ra = a.getBoundingClientRect();
  const rb = b.getBoundingClientRect();
  const horizontal = kind === "v";
  // Which of the two is on the physical low side (left, or top).
  const aLow = horizontal ? ra.left < rb.left : ra.top < rb.top;
  const sizeA = horizontal ? ra.width : ra.height;
  const sizeB = horizontal ? rb.width : rb.height;
  const total = sizeA + sizeB;
  const floor = Math.min(horizontal ? PANE_MIN_W / 2 : PANE_MIN_H / 2, total / 2 - 1);
  const lowSize = (aLow ? sizeA : sizeB) + delta;
  const clamped = Math.max(floor, Math.min(total - floor, lowSize));
  const newA = aLow ? clamped : total - clamped;
  const sum = list[ia] + list[ib];
  list[ia] = sum * (newA / total);
  list[ib] = sum - list[ia];
  applyFractions();
}

function startDrag(e, d, kind, r, k) {
  e.preventDefault();
  let last = kind === "v" ? e.clientX : e.clientY;
  try { d.setPointerCapture(e.pointerId); } catch (err) { /* synthetic event */ }
  d.classList.add("dragging");
  const move = (m) => {
    const now = kind === "v" ? m.clientX : m.clientY;
    resizePair(kind, r, k, now - last);
    last = now;
  };
  const up = () => {
    d.classList.remove("dragging");
    d.removeEventListener("pointermove", move);
    d.removeEventListener("pointerup", up);
    d.removeEventListener("pointercancel", up);
    saveLayout();
  };
  d.addEventListener("pointermove", move);
  d.addEventListener("pointerup", up);
  d.addEventListener("pointercancel", up);
}

/* The window changed size: redraw only if the best SHAPE changed. Nothing is
   parked - minimums apply to adding panes, never to a window getting smaller. */
let resizeTimer = 0;
addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!fractions || !cells.length) return;
    const shape = shapeNow();
    if (shape.length !== fractions.rows.length
        || shape.some((c, r) => c !== fractions.rows[r].length)) arrangeGrid();
  }, 150);
});

/* One pane out of the grid; its conversation is parked, not closed. */
function removeCell(cell) {
  const at = cells.indexOf(cell);
  if (at < 0 || cells.length < 2) return;
  if (zoomed) toggleZoom(null);
  park(cell);
  cell.perm.retire();
  cells.splice(at, 1);
  cell.root.remove();
  if (at < focused || focused >= cells.length) focused = Math.max(0, focused - 1);
  document.getElementById("grid").dataset.split = String(cells.length);
  applyRail(cells.length);
  arrangeGrid();
  saveLayout();
  applyFocus({ focusInput: false });
}

/* One more pane, when the window has room for it (§D6). The sidebar's «باز
   کردن در قاب تازه» asks this; `false` means it did not fit and the caller
   places the conversation in the focused pane instead - never a silent drop. */
function addPane() {
  if (cells.length >= MAX_PANES) return false;
  let { W, H } = gridBox();
  // Going from one pane to two collapses the sidebar to the rail (§1), so the
  // room the new layout will really have is the tree's width more.
  if (railOverride === null && !document.body.classList.contains("rail")) {
    const side = document.getElementById("sidebar")?.getBoundingClientRect().width ?? 0;
    W += Math.max(0, side - 48);
  }
  if (!layoutFor(cells.length + 1, W, H, gapPx(), true)) return false;
  setSplit(cells.length + 1);
  focusCell(cells.length - 1);
  return true;
}

/* Nearest pane in an arrow's direction, from the rects (§D6/§D7). */
function nearestPane(dir) {
  const here = focusedCell()?.root.getBoundingClientRect();
  if (!here) return -1;
  const cx = here.left + here.width / 2;
  const cy = here.top + here.height / 2;
  let best = -1;
  let bestD = Infinity;
  cells.forEach((one, i) => {
    if (one === focusedCell()) return;
    const r = one.root.getBoundingClientRect();
    if (!r.width) return;
    const past = dir === "left" ? r.right <= here.left + 1
      : dir === "right" ? r.left >= here.right - 1
      : dir === "up" ? r.bottom <= here.top + 1
      : r.top >= here.bottom - 1;
    if (!past) return;
    const d = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

/* One more column, from the template index.html carries. Cell order is DOM
   order and the page is dir="rtl", so cell «۱» is the TOP-RIGHT one — which is
   what the badge in each topbar is for. */
function addCell() {
  const grid = document.getElementById("grid");
  const tpl = document.getElementById("cell-tpl");
  const root = tpl.content.firstElementChild.cloneNode(true);
  grid.append(root);
  const cell = makeCell(root);
  cells.push(cell);
  const badge = root.querySelector(".cell-badge");
  if (badge) {
    badge.textContent = cells.length.toLocaleString("fa-IR");
    badge.title = (FA.cellBadgeTitle ?? "").replace("{n}", badge.textContent);
  }
  return cell;
}

/* `/split 1|2|4` (js/commands.js) and nothing else. Shrinking PARKS the removed
   columns' tabs — the server tab stays open and the sidebar still lists it,
   because a layout key must never close a conversation — and hands any
   permission those columns were asking to a dialog that still exists. */
export function setSplit(n, keepRail) {
  const grid = document.getElementById("grid");
  const tpl = document.getElementById("cell-tpl");
  if (!grid || !tpl) return false;      // spec-test.html: no grid, not our verb
  const want = Math.max(1, Math.min(MAX_PANES, Math.round(Number(n)) || 1));
  // The sidebar's width follows the split, and a split change expires whatever
  // the toggle last said (§1). BEFORE the columns are stamped, so the track
  // and the column count change in one layout rather than two — the same
  // ordering §9 flags for restoreLayout, applied at the source instead.
  // keepRail is restoreLayout's: the override it just read out of storage IS
  // the memory of a press, so this call must not expire it.
  if (!keepRail) railOverride = null;
  if (zoomed) toggleZoom(null);   // a layout change ends fullscreen
  applyRail(want);
  while (cells.length > want) {
    const cell = cells[cells.length - 1];
    park(cell);                          // its transcript goes back to its buffer
    cells.pop();
    cell.perm.retire();                  // ...and whatever it was asking moves
    cell.root.remove();
  }
  while (cells.length < want) {
    const cell = addCell();
    // Nothing to send TO yet: the box says so rather than 404ing on submit.
    cell.composer.setBlank(true);
  }
  grid.dataset.split = String(want);
  arrangeGrid();
  saveLayout();
  if (focused >= cells.length) focused = cells.length - 1;
  applyFocus({ focusInput: false });
  return true;
}

/* --- the rail (TERMINAL-REDESIGN.md §1) --------------------------------------

   The sidebar has two widths: the tree (272px) and a 48px rail carrying the
   mark, «+», the split segments stacked, one status dot per open conversation
   and the help link. At 4-up the tree was spending ~120px per column on empty
   space — (1052-288)/2 = 382px a column, against (1052-48-1)/2 = 501px with
   the rail, which is finally past the 496px wiki/grid.md records as the width
   that first broke this shell.

   So the width FOLLOWS THE SPLIT rather than being a preference the reader has
   to find: `/split 2|4` collapses, `/split 1` opens. The toggle in the head is
   the override, and it lasts until the next split change — the layout the user
   just asked for wins over a press they made three layouts ago.

   `null` means "no press to honour"; a boolean is the toggle's answer. It is
   never read anywhere else: everything downstream reads `body.rail`, which is
   also the only thing CSS can see. */
let railOverride = null;

function applyRail(split) {
  const rail = railOverride ?? split !== 1;
  document.body.classList.toggle("rail", rail);
  const btn = document.getElementById("btn-rail");
  if (!btn) return;                     // spec-test.html has no sidebar
  // The button is named after WHAT IT DOES NEXT, not after the state it is in:
  // a control labelled with its own state reads as a label and gets pressed by
  // accident. `title` for the pointer, `aria-label` for the screen reader —
  // there is no text inside it to name it, and this is a control surface for a
  // reader who never opens a terminal.
  const word = FA[rail ? "sidebarExpand" : "sidebarCollapse"] ?? "";
  btn.title = word;
  btn.setAttribute("aria-label", word);
  btn.setAttribute("aria-expanded", String(!rail));
}

function toggleRail() {
  railOverride = !document.body.classList.contains("rail");
  applyRail(cells.length);
  saveLayout();
}

export const tabs = new Map();   // tab -> {node, scope, chrome, cell}
let tabList = [];                // the server's own view, for the sidebar
// Finished turns a BACKGROUND tab collected since it was last on screen.
// tab -> count; the entry is dropped the moment the tab becomes visible.
const unread = new Map();

/* Lazily created: events for a tab arrive before /api/tabs can answer, and
   dropping them would lose the opening of a conversation. */
function tabEntry(tab) {
  let entry = tabs.get(tab);
  if (!entry) {
    entry = { node: document.createElement("div"),
              scope: newRenderScope(true, null, tab), chrome: null, cell: null };
    tabs.set(tab, entry);
  }
  return entry;
}

/* WHERE A CONVERSATION'S OUTPUT GOES: the log of the column it is placed in
   while it is on screen, and its own detached buffer while it is parked. Both
   are the same call, which is what keeps a placed-but-unfocused column and a
   background tab from needing two code paths. */
function targetOf(entry) {
  return entry.cell ? entry.cell.log : entry.node;
}

/* The untagged path is the original one and stays exactly as it was: it is what
   the spec harness drives, and what a server that knows nothing about tabs
   would send.

   `state` MIRRORS THE FOCUSED COLUMN'S SCOPE, which is why the focused tab
   renders directly: everything that reads the renderer's state from outside a
   render (the /status block, the agents strip) means "the conversation the
   keyboard is in", and withRenderTarget puts `state` back the way it found it.
   Every other tab — placed in another column or parked — is rendered with
   `state` pointed at its own scope for the length of the call. */
export function routeEvent(ev) {
  const tab = typeof ev.tab === "string" ? ev.tab : "";
  if (!tab || tab === focusedTab()) {
    renderEvent(ev);
  } else {
    const entry = tabEntry(tab);
    withRenderTarget(targetOf(entry), entry.scope, () => renderEvent(ev));
  }
  if (tab) noteTabEvent(ev, tab);
}

/* WHERE A TAB'S OUTPUT LANDS RIGHT NOW. Everything that renders a transcript
   the user did not just watch arrive — history replay, a resumed session's
   backfill — is separated from its own render by an await, and by the time it
   comes back the tab it was fetched for may be parked or gone. Resolving the
   destination HERE, at render time, is what stops it writing into whichever
   conversation happens to be on screen: the next park() would copy that
   foreign transcript into the wrong column and keep it there.

   The callback is handed the node it is writing into, so a caller that starts
   from an empty view can clear the right one. A tab that was closed while the
   fetch was out gets no callback at all — the output has nowhere to go, and
   inventing a home for it is how a closed conversation comes back. */
export function renderInTab(tab, fn) {
  // No tab: the harness and the blank view, where the column belongs to no
  // conversation and nothing can be clobbered.
  if (!tab) {
    const cell = focusedCell();
    if (cell) fn(cell.log);
    return;
  }
  if (tab === focusedTab()) {
    fn(focusedCell().log);
    return;
  }
  const entry = tabs.get(tab);
  if (!entry) return;
  const target = targetOf(entry);
  withRenderTarget(target, entry.scope, () => fn(target));
}

/* Identity (session id), folder and busy are the server's to know, and every
   event below changes one of them. Asking is cheaper than mirroring the
   server's bookkeeping here and drifting from it. */
const TAB_NEWS = new Set(["user_echo", "resumed", "cli_exited", "reset",
                          "idle_sync"]);

function noteTabEvent(ev, tab) {
  if (ev.type === "wrapper" && ev.subtype === "closed") {
    dropTab(tab);
    return;
  }
  // A turn that finished in a conversation nobody is looking at. NOT a replayed
  // one: an SSE backlog replay re-runs every finished turn through the renderer
  // (wiki/frontend-modules.md), so counting those would have a reload invent a
  // dozen new messages. And not a stop either — whoever pressed it knows.
  if (ev.type === "result" && !cellOf(tab) && !ev.replayed
      && ev.terminal_reason !== "aborted_streaming") {
    unread.set(tab, (unread.get(tab) ?? 0) + 1);
  }
  // The notification centre (§D9): the same "nobody saw it" rule, widened to
  // any pane but the one the keyboard is in, and to a permission request.
  if (!ev.replayed && !(tab === focusedTab() && !document.hidden)) {
    if (ev.type === "result" && ev.terminal_reason !== "aborted_streaming") {
      pushNotice(tab, ev.is_error ? "failed" : "done", titleOf(tab));
    } else if (ev.type === "wrapper" && ev.subtype === "permission_request") {
      pushNotice(tab, "needs", titleOf(tab));
    }
  }
  // The dot is derived from render state this window already holds, so it
  // repaints off the event itself instead of waiting out the /api/tabs round
  // trip below. `command_lifecycle` is here and not in TAB_NEWS because it
  // changes nothing the SERVER would answer differently — it is the event that
  // empties the uuid ledger, which is the whole of `running`.
  if (ev.type === "result" || ev.type === "command_lifecycle"
      || (ev.type === "wrapper" && TAB_NEWS.has(ev.subtype))) {
    paintTabs();
  }
  if ((ev.type === "system" && ev.subtype === "init") || ev.type === "result"
      || (ev.type === "wrapper" && TAB_NEWS.has(ev.subtype))) {
    refreshTabs();
  }
}

function titleOf(tab) {
  const entry = tabList.find((t) => t.tab === tab);
  return entry ? tabTitle(entry) : FA.tabFresh;
}

/* A notice (or the OS notification) says "go there": focus the pane holding
   it, or put it in the focused pane, then flash that pane once (§D9). */
async function jumpTo(tab) {
  if (!tabs.has(tab) && !tabList.some((t) => t.tab === tab)) return;
  if (newSessionOpen()) document.querySelector("#new-session .ns-cancel")?.click();
  await switchTab(tab);
  const cell = cellOf(tab);
  if (!cell) return;
  cell.root.classList.remove("flash");
  void cell.root.offsetWidth;        // restart the animation on a second jump
  cell.root.classList.add("flash");
  setTimeout(() => cell.root.classList.remove("flash"), 700);
}
window.addEventListener("pcg:jump", (e) => {
  window.focus();
  jumpTo(e.detail?.tab);
});

/* What this WINDOW knows about each conversation and the server does not: the
   uuid ledger says whether it is working, and the last result says whether it
   failed. chrome.js folds the pair together with its own permission queue into
   the one status a dot is painted from — see tabStatus() there. Nothing is
   mirrored: both values are read off the scope that owns them. */
function tabFacts() {
  const facts = {};
  for (const [tab, entry] of tabs) {
    // `state` mirrors the FOCUSED column's scope and is written to directly, so
    // for that one tab it is the live truth and its registry copy is stale.
    // Every other scope — a placed but unfocused column included — is written
    // back by withRenderTarget at the end of each event.
    const scope = tab === focusedTab() ? state : entry.scope;
    facts[tab] = { running: scope.outstanding.size > 0,
                   error: !!scope.error,
                   unread: unread.get(tab) ?? 0 };
  }
  return facts;
}

function paintTabs() {
  setOpenTabs(tabList, focusedTab(), tabFacts());
}

/* --- switching --------------------------------------------------------------

   The acceptance bar: NO per-session state may survive into another tab. That
   is why the restore below is unconditional and total — every chip is painted
   from this conversation's own snapshot or from nothing, never left showing
   what the previous one had. This project has already shipped that defect three
   times with a single session and a restart (statusline, model picker, armed
   delete); with six live conversations it would be the norm. */

/* THE SCOPE A COLUMN IS SHOWING. Every column has one, even an empty one, so
   nothing downstream has to ask "and what if there is no conversation?". */
function scopeOf(cell) {
  if (!cell) return null;
  return tabs.get(cell.tab)?.scope ?? cell.blankScope ?? null;
}

/* `state` mirrors the FOCUSED column's scope (routeEvent above says why). These
   two are the only places that mirror is opened and closed: everything else
   either renders through withRenderTarget, which does its own save/restore, or
   reads `state` and means the focused conversation. */
function stashFocusedScope() {
  const scope = scopeOf(focusedCell());
  if (scope) Object.assign(scope, state);
}

function adoptFocusedScope() {
  const scope = scopeOf(focusedCell());
  if (scope) Object.assign(state, scope);
}

/* This column stops showing its conversation. The conversation is NOT closed:
   its transcript goes back to its own buffer node, its chrome is snapshotted,
   and the server tab stays open — which is what makes `/split 1` and "put a
   fifth session on screen" safe. */
function park(cell) {
  const tab = cell.tab;
  const entry = tab && tabs.get(tab);
  cell.tab = "";
  saveLayout();
  if (!entry) return;
  // Read BEFORE the move: an emptied log reports scrollTop 0, so the other
  // order silently sends every returning tab back to the top.
  entry.scrollTop = cell.log.scrollTop;
  entry.node.replaceChildren(...cell.log.childNodes);
  // Only the focused column's live truth is in `state`; every other scope was
  // written back by withRenderTarget at the end of its last event.
  if (cell === focusedCell()) Object.assign(entry.scope, state);
  entry.scope.background = true;
  // No cell: this conversation is not on screen any more, which is the one
  // thing render.js gates every chrome-shaped write on.
  entry.scope.cell = null;
  entry.cell = null;
  entry.chrome = { controls: cell.controls.snapshot(),
                   composer: cell.composer.snapshot() };
}

/* No conversation in this column: it was closed, or its tab moved to another
   column. The column itself stays on screen and shows the welcome box. */
function blank(cell) {
  if (!cell) return;
  park(cell);                       // whatever it held goes back to its buffer
  cell.log.replaceChildren();
  const scope = newRenderScope(false, cell, "");
  cell.blankScope = scope;
  withRenderTarget(cell.log, scope, () => {
    resetTurn();
    cell.controls.restore(null);
    cell.composer.restore(null);
    setStatus({});
  });
  if (cell === focusedCell()) {
    Object.assign(state, scope);
    setCurrentSession(null);
    resetAgents();
  }
  // Nothing to send TO: a POST with no tab 404s, and the generic «ارسال نشد»
  // bubble that follows is a dead end for a reader who does not know what a
  // tab is. The box says why instead, and placeIn() below puts it back.
  cell.composer.setBlank(true);
  mirrorBusy();
  paintTabs();
}

/* THE ONE PLACE A CONVERSATION GOES ON SCREEN. A tab lives in at most one
   column, so a tab already placed elsewhere is taken out of that column first
   rather than drawn twice. */
function placeIn(cell, tab) {
  const entry = tabEntry(tab);
  const holder = cellOf(tab);
  if (holder && holder !== cell) blank(holder);
  if (cell.tab && cell.tab !== tab) park(cell);

  cell.log.replaceChildren(...entry.node.childNodes);
  entry.node.replaceChildren();
  entry.cell = cell;
  entry.scope.background = false;
  // The cell this conversation is now on screen in, and which conversation the
  // cell is showing. Both are read at call time by everything downstream.
  entry.scope.cell = cell;
  entry.scope.tab = tab;
  cell.tab = tab;
  cell.blankScope = null;
  saveLayout();

  // The restore reads and writes THIS conversation's scope, whether or not the
  // keyboard is in this column — which is what withRenderTarget is for. The
  // acceptance bar it serves: no per-session state may survive into another
  // tab, so every chip is painted from this conversation's own snapshot or from
  // nothing. This project has shipped that defect three times already.
  withRenderTarget(cell.log, entry.scope, () => {
    cell.controls.restore(entry.chrome?.controls);
    cell.composer.restore(entry.chrome?.composer);
    setStatus({});                     // repaint from THIS session's own status
    applyChrome(cell, state.chrome);   // what landed while it was in the background
    state.chrome = {};
  });
  // Back where the reader left this conversation; a tab being opened for the
  // first time starts at its newest message, like every other chat view.
  cell.log.scrollTop = entry.scrollTop ?? cell.log.scrollHeight;

  setChrome(entry.scope.status.cwd || "", cell);
  if (cell === focusedCell()) {
    adoptFocusedScope();
    setCurrentSession(entry.scope.status.sessionId ?? null);
    refreshAgents();   // the strip belongs to the session now on screen
    markRead(tab);     // the bell's notices for it are read by looking (§D9)
  }
  mirrorBusy();
  // On screen is read: whatever landed while this one was parked is not news
  // any more, so the count goes rather than being decremented by anything.
  unread.delete(tab);
  // A conversation is on screen again: there is somewhere for a message to go.
  cell.composer.setBlank(false);
  paintTabs();
  /* A conversation whose rows this window has never seen. The hub replays only
     what it published, and a resumed session's transcript was fetched by the
     client and published nowhere -- so a reloaded window opens on an empty
     column with the greeting over it (pcg-1ug). Here, at the one point every
     placement routes through, and only for a column that has nothing to show:
     chrome.js backfillTab decides the rest. */
  if (wantsTransport && !cell.log.childElementCount) backfillTab(tab);
  refreshProjects();
}

/* Synchronous half of a switch: DOM, render state and chrome, into the FOCUSED
   column. Separate from switchTab() below so the spec harness can drive it
   without a server. */
export function applySwitch(tab) {
  const cell = focusedCell();
  if (cell) placeIn(cell, tab);
}

/* This file used to hold a second copy of the apply table, and the two drifted.
   It is render.js APPLY now — one table, whether the fact arrived live or was
   parked while the tab was in the background (render.js applyChrome). */

/* --- focus ------------------------------------------------------------------

   Which column the keyboard is in. It follows a pointerdown or a focusin inside
   a cell (capture, at the foot of this file), Alt+1..4, and asking for a tab
   that is already on screen somewhere else. */

function applyFocus({ focusInput = false, post = true } = {}) {
  const cell = focusedCell();
  for (const [at, one] of cells.entries()) {
    one.root.classList?.toggle("focused", at === focused);
  }
  setFocusedCell(cell);
  adoptFocusedScope();
  mirrorBusy();
  if (!cell) return;
  if (cell.tab) markRead(cell.tab);
  // The one sidebar, the one project list and the one agents strip follow the
  // keyboard: with four columns answering at once there is no other honest
  // answer to "which conversation is this window about?".
  setChrome(state.status.cwd || cell.cwd || "", cell);
  setCurrentSession(state.status.sessionId ?? null);
  refreshProjects();
  refreshAgents();
  if (focusInput) cell.composer.focus();
  // Keeps /api/tabs.active — and therefore a reload — pointing at the column
  // being used. NEVER relied on for routing: click-then-Enter beats the POST,
  // which is why every session-scoped request carries its own `tab`.
  if (post && cell.tab && wantsTransport) {
    api("/api/tab/activate", { tab: cell.tab }).catch(() => {});
  }
  paintTabs();
}

export function focusCell(index, opts = {}) {
  if (!cells.length) return;
  const next = Math.max(0, Math.min(index, cells.length - 1));
  if (next === focused) {
    if (opts.focusInput) focusedCell().composer.focus();
    return;
  }
  // A render moved the keyboard (a dialog focusing itself): `state` is some
  // other scope until withRenderTarget gives it back, so stashing now would
  // file one conversation under another. After the render, not never.
  if (inRenderTarget()) {
    queueMicrotask(() => focusCell(index, opts));
    return;
  }
  stashFocusedScope();     // the column being left keeps what it was showing
  focused = next;
  applyFocus(opts);
}

/* The server decides which tab a tab-less endpoint routes to — so the POST goes
   first and a refusal (that tab is gone) switches nothing. A tab already on
   screen is not re-placed: the keyboard moves to its column instead, which is
   the whole of "a tab lives in at most one cell". */
export async function switchTab(tab) {
  if (!tab) return;
  const holder = cellOf(tab);
  if (holder) {
    focusCell(cells.indexOf(holder), { focusInput: true });
    return;
  }
  if (!focusedCell()) return;
  try {
    await api("/api/tab/activate", { tab });
  } catch (err) {
    refreshTabs();   // it is not there any more; the list will say so
    return;
  }
  applySwitch(tab);
  refreshTabs();
}

export async function closeTab(tab) {
  let res;
  try {
    res = await api("/api/tab/close", { tab });
  } catch (err) {
    refreshTabs();
    return;
  }
  dropTab(tab, res.active);
}

/* The one choke point every close routes through — the ✕, and the server's own
   tagged `wrapper/closed`. Two things outlive the node if they are not stopped
   here, and neither shows up as an error: the turn's 500 ms pulse interval,
   which lives in the SCOPE and would go on painting a detached node until the
   window is reloaded (blank() only reaches the column's own), and any
   permission this conversation was still waiting on — the server denies those
   before the drop, so the resolved event usually arrives first, but a dialog
   left asking on behalf of a dead CLI can only be answered into nothing. */
function dropTab(tab, nextActive) {
  const entry = tabs.get(tab);
  if (entry) {
    clearPulse(entry.scope);
    entry.node.replaceChildren();
    tabs.delete(tab);
  }
  unread.delete(tab);
  dismissTabPermissions(tab);
  const cell = cellOf(tab);
  if (cell) {
    blank(cell);
    // Only the focused column refills itself, and only from a conversation no
    // other column is already showing — a tab must never be drawn twice, and a
    // column the user is not in must not change what it says under them.
    if (cell === focusedCell()) {
      const free = [...tabs.keys()].filter((one) => !cellOf(one));
      const next = nextActive && tabs.has(nextActive) && !cellOf(nextActive)
        ? nextActive : free.at(-1);
      // switchTab, not applySwitch: the server routes every tab-less request by
      // ITS active tab, so a view this window picked on its own would type into
      // one conversation and send to another.
      if (next) switchTab(next);
    }
  }
  refreshTabs();
}

/* --- what the server says is open ------------------------------------------ */

let tabsTimer = 0;

export function refreshTabs() {
  if (!wantsTransport) return;
  clearTimeout(tabsTimer);
  tabsTimer = setTimeout(loadTabs, 200);
}

async function loadTabs() {
  let data;
  try {
    data = await api("/api/tabs");
  } catch (err) {
    return;   // best-effort chrome; the next event asks again
  }
  applyTabs(data);
}

/* --- the layout survives a reload (pcg-6nf.8) --------------------------------

   How many columns are on screen, and which conversation is in each one, is a
   fact about THIS WINDOW: the server has no cell index and no split count, and
   giving it one would make it the owner of something it cannot see. So the
   layout is remembered here, in sessionStorage rather than localStorage -- the
   server binds a random free port every run, so the page origin differs run to
   run and neither store survives a relaunch, but localStorage would leave one
   dead entry per port behind forever while sessionStorage cleans itself up when
   the window closes. The scope is therefore exactly what was asked for: across
   a RELOAD, not across a relaunch.

   This is the first and only client-side persistence in this project. Keep it
   that way: one key, one shape, and a try/catch around both ends because a
   window with site data blocked must still boot. */
const LAYOUT_KEY = "pcg.layout";

function saveLayout() {
  try {
    sessionStorage.setItem(LAYOUT_KEY, JSON.stringify(
      { v: 2, split: cells.length, cells: cells.map((one) => one.tab || ""),
        // The dividers' positions (§D6); a v1 record simply has none.
        rows: fractions?.rows, rowH: fractions?.rowH,
        // The EFFECTIVE width, not the override: a boolean that disagrees with
        // the saved split is itself the record that the toggle was pressed, so
        // one field carries both facts and an older record simply reads as
        // "follow the split" (§1).
        rail: document.body.classList.contains("rail") }));
  } catch (err) {
    // No store, no memory of the layout. Everything else still works.
  }
}

/* ONCE per page load, and it says how many conversations it actually put back.
   applyTabs() runs on every reconnect too, and a reconnect after the user has
   closed everything must not resurrect the layout they left behind; zero
   placed means the caller's own pick runs, exactly as it does today. */
let layoutRestored = false;

function restoreLayout(alive) {
  if (layoutRestored) return 0;
  layoutRestored = true;
  let saved;
  try {
    saved = JSON.parse(sessionStorage.getItem(LAYOUT_KEY) || "null");
  } catch (err) {
    return 0;            // absent, or something else wrote over the key
  }
  if (!saved || !Array.isArray(saved.cells)) return 0;
  // §9: the class goes on BEFORE setSplit, or a restored 4-up is laid out
  // twice — once against a 272px sidebar and again against 48. A stored value
  // that disagrees with the stored split is the toggle's press; one that
  // agrees needs no override, so a record written before this existed (no
  // `rail` key at all) restores as plain follow-the-split.
  const rail = !!saved.rail;
  if (rail !== (saved.split !== 1)) railOverride = rail;
  document.body.classList.toggle("rail", rail);
  if (Array.isArray(saved.rows) && Array.isArray(saved.rowH)) {
    fractions = { rows: saved.rows, rowH: saved.rowH };   // kept if the shape matches
  }
  setSplit(saved.split, true);
  let placed = 0;
  for (const [at, tab] of saved.cells.entries()) {
    // POSITIONAL: cell 2 gets what was in cell 2. A conversation the server no
    // longer lists is dropped silently and its column stays blank rather than
    // the layout shuffling up around the hole.
    if (!tab || !alive.has(tab) || !cells[at] || cellOf(tab)) continue;
    placeIn(cells[at], tab);
    placed += 1;
  }
  // Including the column this window booted with: nothing to send TO, so the
  // box says so rather than 404ing on submit (setSplit does this for the
  // columns it adds; a hole in a restored layout is the same state).
  for (const one of cells) if (!one.tab) one.composer.setBlank(true);
  return placed;
}

/* THE SNAPSHOT ADDS, IT NEVER DELETES. A GET served mid-spawn answers without
   the tab that is being spawned, so pruning on it dropped the entry holding
   that conversation's buffered `wrapper/init_info` — the slash commands and the
   model catalogue, replayed only on a fresh SSE subscribe, so nothing would
   ever ask for them again — and could bounce the view to the snapshot's stale
   active. A tab goes away when the server SAYS it went away (dropTab, off a
   tagged `wrapper/closed`) and at no other moment.

   Exported for the same reason applySwitch() is: it is the whole of what a
   /api/tabs answer does, and the spec harness drives it without a server. */
export function applyTabs(data) {
  tabList = Array.isArray(data.tabs) ? data.tabs : [];
  const alive = new Set(tabList.map((t) => t.tab));
  for (const entry of tabList) tabEntry(entry.tab);

  // Boot and reconnect only: every event so far has been buffered into its own
  // tab, and this is the moment one of them becomes the visible conversation.
  // With a conversation already on screen the snapshot's `active` is a second
  // opinion about a question this window has answered more recently.
  // ...and it is also where the layout this window had before a reload is
  // put back (restoreLayout above). It answers 0 when there is nothing
  // saved or nothing left of it, and then this branch runs unchanged.
  if (!focusedTab() && !restoreLayout(alive)) {
    const free = tabList.map((t) => t.tab).filter((one) => !cellOf(one));
    // Showing what the server already calls active needs no POST; picking a
    // different one does, or this window would send into another conversation.
    if (alive.has(data.active) && !cellOf(data.active)) applySwitch(data.active);
    else if (free.length) switchTab(free.at(-1));
    else blank(focusedCell());
  }
  paintTabs();
}

// chrome.js draws the sidebar and the session rows; it asks for a switch or a
// close through here rather than importing this module (see the load-order
// note above).
setTabBridge({
  switchTo: switchTab, close: closeTab,
  // Read at CALL time, never cached: the sidebar starts a replay before an
  // await and renders after it, and the answer can differ between the two.
  active: () => focusedTab(),
  renderIn: renderInTab,
  // MA3-T2: which column the keyboard is in, all of them, and the layout verb
  // `/split` reaches through chrome.js. Handed in rather than imported — this
  // is the entry module and its body runs last.
  focused: focusedCell,
  cells: () => cells,
  split: setSplit,
  addPane,
  newSession: (opts) => openNewSession(opts),
});

/* The new-session page's view of the grid (BRIDGEMIND-PORT.md §D8). Handed in,
   because newsession.js may not import this module. */
function stageBox() {
  const r = document.getElementById("stage")?.getBoundingClientRect();
  return { W: r?.width || innerWidth, H: r?.height || innerHeight };
}

initNotices({
  jump: jumpTo,
  alive: (tab) => tabs.has(tab) || tabList.some((t) => t.tab === tab),
  title: titleOf,
});

initNewSession({
  currentCwd: () => state.status.cwd || focusedCell()?.cwd || "",
  openCount: () => tabList.length,
  // Would N panes fit this window? Measured off #stage (the grid is hidden
  // while the page is open), with the sidebar at the width N panes will give
  // it: more than one collapses it to the rail (§1) unless a press says not.
  fits(n) {
    if (n <= 1) return true;
    let { W, H } = stageBox();
    if (railOverride === null && !document.body.classList.contains("rail")) {
      const side = document.getElementById("sidebar")?.getBoundingClientRect().width ?? 0;
      W += Math.max(0, side - 48);
    }
    return !!layoutFor(n, W, H, gapPx(), true);
  },
  focusBack: () => focusedCell()?.composer.focus(),
  // Slot order is pane order: slot ۱ in pane ۱. A target is the empty pane
  // whose button asked, and it gets the one conversation.
  async place(opened, target) {
    if (target && opened.length === 1 && cells.includes(target)) {
      focusCell(cells.indexOf(target));
      applySwitch(opened[0]);
    } else {
      setSplit(opened.length);
      opened.forEach((tab, i) => {
        focusCell(i);
        applySwitch(tab);
      });
      focusCell(0);
    }
    refreshTabs();
    focusedCell()?.composer.focus();
  },
  say: (tab, text) => renderInTab(tab, () => bubble("error", text)),
});

initChrome();

/* --- transport ------------------------------------------------------------ */

const events = wantsTransport
  ? new EventSource("/api/events?t=" + encodeURIComponent(token))
  : null;
if (events) events.onmessage = (e) => {
  let parsed;
  try {
    parsed = JSON.parse(e.data);
  } catch (err) {
    console.error("bad SSE payload", err, e.data);
    return;
  }
  try {
    routeEvent(parsed);
  } catch (err) {
    console.error("render failed", err, parsed);
  }
};
if (events) events.onerror = () => setStatus({});

/* The first column. Here rather than at the top of the file for the reason the
   load-order note gives: this is where initComposer()/initControls() used to
   run, after initChrome() and after every module is live. spec-test.html has no
   #grid and no template — the harness IS the cell, with `document.body` as its
   root (an ELEMENT, so `cell.root.classList` and `.querySelector` both work). */
if (document.getElementById("grid")) {
  addCell();
  arrangeGrid();
  document.getElementById("btn-rail")?.addEventListener("click", toggleRail);
  applyRail(1);   // names the toggle before anything has changed the split
} else cells.push(makeCell(document.body));

setPermFocus(focusedCell);
setFocusedCell(focusedCell());
cells[0].root.classList?.add("focused");
// Boot with the column on screen and no conversation in it: what loadTabs()
// replaces a moment from now.
state.cell = cells[0];

initAgents();
// Ctrl+O, the TUI's transcript mode: one key that opens every tool result in
// the column at once (render.js toggleTranscript, wiki/tui-keys.md Global).
// Registered once and aimed at the focused column, like the two below.
initTranscript(focusedCell);

/* --- the window's own keys --------------------------------------------------

   Three chords, one registration each, dispatched to the focused column. They
   used to be bound inside makeComposer(), which was correct while there was one
   composer and wrong the moment there were four (MA3 §3). */

/* Esc stops the running turn, the way it does in the TUI. Routed through the
   stop button's own click, so there is one interrupt path and not two — and
   because that handler disables the button until the POST comes back, a
   held-down Esc is one request rather than thirty.

   Anything dismissible that is open owns Esc first. What counts as "open" is
   asked of the focused CELL for the things a cell has one of each of (its
   dialogs, its two popups) and of the DOCUMENT for the things the window has
   one of (a popover, the `?` sheet) — the old check named `#slash-popup` and
   `#file-popup`, ids that stopped existing at MA3-T0. `defaultPrevented` covers
   whatever claims the key after this was written (the sidebar's rename field
   already does). Idle Esc stays unbound on purpose: the TUI clears the box with
   it, and here the box holds the only copy of what was typed. */
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || e.defaultPrevented) return;
  const cell = focusedCell();
  // Fullscreen exits on Esc only when Esc would otherwise do NOTHING (§D5):
  // not while a turn runs (that Esc is a stop, the TUI's rule), not while a
  // dialog, popup or the key sheet is open, and not with text in the prompt.
  if (zoomed && cell && !cell.composer.isBusy()
      && !document.querySelector(":popover-open")
      && !document.getElementById("keys")?.open
      && !cell.root.querySelector("dialog[open], .slash-popup:not([hidden]), "
                                  + ".file-popup:not([hidden])")
      && !cell.root.querySelector(".input")?.value) {
    e.preventDefault();
    toggleZoom(null);
    return;
  }
  if (!cell?.composer.isBusy()) return;
  if (document.querySelector(":popover-open")) return;
  if (document.getElementById("keys")?.open) return;
  if (cell.root.querySelector("dialog[open], .slash-popup:not([hidden]), "
                              + ".file-popup:not([hidden])")) return;
  e.preventDefault();
  cell.composer.stop();
});

/* Shift+Tab cycles the approval posture, as it does in the TUI — the TUI has no
   "focus is elsewhere" state, so this binds on the document. Through
   controls.js's own cycler, which is the pill's code path: one choke point, so
   the chip still waits for the server's echo.

   It has to give the key back wherever Tab navigation or typing is the actual
   point. The rule is inverted from the obvious one: the focused composer's own
   textarea cycles, everything editable or focus-trapping does not, and the inert
   parts of the page (body, the transcript) fall through to the cycle. A closed
   `[popover]` is display:none, so focus cannot be inside one and the bare
   attribute selector needs no state check.

   Typing in the composer with the slash popup OPEN still cycles — that is the
   pre-rework behaviour and it is deliberate: bare Tab accepts the completion
   (see the popup's own handler), Shift+Tab was never its key. */
document.addEventListener("keydown", (e) => {
  if (e.key !== "Tab" || !e.shiftKey) return;
  const cell = focusedCell();
  if (!cell) return;
  if (e.target !== cell.composer.input && e.target?.closest?.(
      "input, select, textarea, [contenteditable], "
      + "dialog[open], [popover], .slash-popup:not([hidden])")) return;
  // Held down, the key auto-repeats around 30 times a second, and every one of
  // those would POST /api/posture and push a set_permission_mode at the CLI.
  // One press, one change.
  if (e.repeat) {
    e.preventDefault();
    return;
  }
  // Nothing to cycle — no posture confirmed for this conversation yet — so the
  // key is not ours: leave it to the browser's reverse focus nav rather than
  // swallowing it into a no-op.
  if (!cell.controls.cyclePosture()) return;
  e.preventDefault();   // or focus moves on the way past
});

/* While Alt is held, every pane shows its digit (§D5): the `[۱]` badges read
   as debug labels at rest, and Alt is the moment their number is the answer. */
document.addEventListener("keydown", (e) => {
  if (e.key === "Alt") document.body.classList.add("alt-held");
});
document.addEventListener("keyup", (e) => {
  if (e.key === "Alt") document.body.classList.remove("alt-held");
});
window.addEventListener("blur", () => document.body.classList.remove("alt-held"));

/* Alt+1..4 moves the keyboard between columns. `e.code`, never `e.key`: a
   Persian keyboard layout puts «۱» in `e.key` and the chord would never match
   (js/choice.js carries the same trap for the numbered dialogs). */
const DIGIT_CODES = ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6"];

/* THE WINDOW'S PANE KEYS (BRIDGEMIND-PORT.md §D7), in one table so a chord the
   Windows measurement (M1) rules out is one line here and one row in
   wiki/tui-keys.md. All are Alt + `e.code`, in CAPTURE, and swallowed, so the
   prompt's own arrow handling (history) never sees an Alt+arrow. */
const PANE_KEYS = {
  ArrowLeft: () => focusCell(nearestPane("left"), { focusInput: true }),
  ArrowRight: () => focusCell(nearestPane("right"), { focusInput: true }),
  ArrowUp: () => focusCell(nearestPane("up"), { focusInput: true }),
  ArrowDown: () => focusCell(nearestPane("down"), { focusInput: true }),
  BracketRight: () => focusCell((focused + 1) % cells.length, { focusInput: true }),
  BracketLeft: () => focusCell((focused - 1 + cells.length) % cells.length, { focusInput: true }),
  Enter: () => toggleZoom(zoomed ? null : focusedCell()),
  Equal: () => equalize(),
  KeyN: () => (newSessionOpen() ? null : openNewSession()),
  KeyB: () => togglePanel(),
};
// Keys that mean something with one pane too (the rest move between panes).
const SOLO_KEYS = new Set(["KeyN", "KeyB"]);

document.addEventListener("keydown", (e) => {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const at = DIGIT_CODES.indexOf(e.code);
  if (at >= 0) {
    if (at >= cells.length) return;
    e.preventDefault();
    focusCell(at, { focusInput: true });
    return;
  }
  const act = PANE_KEYS[e.code];
  if (!act || (cells.length < 2 && !SOLO_KEYS.has(e.code))) return;
  // The nearest-pane keys with nothing in that direction do nothing, quietly.
  if (e.code.startsWith("Arrow") && nearestPane(e.code.slice(5).toLowerCase()) < 0) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  act();
}, true);

/* Focus follows the pointer and the keyboard, in CAPTURE so it lands before the
   click does anything: whatever the click is about, it is about that column. */
for (const type of ["pointerdown", "focusin"]) {
  document.addEventListener(type, (e) => {
    const root = e.target?.closest?.(".cell");
    if (!root) return;
    const at = cells.findIndex((one) => one.root === root);
    if (at >= 0) focusCell(at);
  }, true);
}

/* The idle hint's clock: ONE per window rather than one per column (an interval
   bound in a factory would outlive a column `/split 1` removed). The minute tick
   catches a window that never lost focus; visibilitychange makes the return
   itself instant instead of up-to-a-minute late.

   THE FOCUSED COLUMN ONLY. The hint's own gate is `body.agents-running`, and
   that class describes the conversation agents.js last painted for — the
   focused one, because refreshAgents() is gated on it (render.js onFocused).
   There is no per-tab background-agent registry anywhere in this window, so
   ticking all four columns asked three of them a question about somebody else's
   agents: «مدتی از این گفتگو گذشته» over a column whose helpers are still
   working, which is exactly the misread that put the gate there. A column the
   keyboard is not in is judged when the keyboard arrives (focus repaints the
   strip) and not before. */
function tickIdle(now) {
  focusedCell()?.composer.checkIdle(now);
  refreshWhen();   // the sidebar's «N دقیقه پیش» rides the same clock
}
setInterval(tickIdle, 60_000);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  tickIdle();
  // Back at the window: the conversation in front of you is read (§D9).
  if (focusedTab()) markRead(focusedTab());
});

focusedCell()?.composer.focus();
// Which conversations are open, and which one this window is looking at. The
// stream is already filling their buffers by now; this is what puts one of them
// on screen — unqueued, because until it answers the window shows nothing.
if (wantsTransport) loadTabs();
