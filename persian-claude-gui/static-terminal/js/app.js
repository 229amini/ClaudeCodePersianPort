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
  newRenderScope, withRenderTarget, initTranscript, applyChrome,
  setFocusedCell,
} from "./render.js";
import {
  initChrome, initCellChrome, setTabBridge, setOpenTabs, setCurrentSession,
  setChrome, refreshProjects, backfillTab,
} from "./chrome.js";
import { makePerm, dismissTabPermissions, setPermFocus } from "./perm.js";
import { makeComposer } from "./composer.js";
import { makeControls } from "./controls.js";
import { initAgents, applyAgents, refreshAgents, resetAgents } from "./agents.js";
import { api, token } from "./api.js";

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
  return cell;
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
  const want = n === 2 ? 2 : n === 4 ? 4 : 1;
  // The sidebar's width follows the split, and a split change expires whatever
  // the toggle last said (§1). BEFORE the columns are stamped, so the track
  // and the column count change in one layout rather than two — the same
  // ordering §9 flags for restoreLayout, applied at the source instead.
  // keepRail is restoreLayout's: the override it just read out of storage IS
  // the memory of a press, so this call must not expire it.
  if (!keepRail) railOverride = null;
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
  saveLayout();
  paintSplitControl(want);
  if (focused >= cells.length) focused = cells.length - 1;
  applyFocus({ focusInput: false });
  return true;
}

/* --- the sidebar's segmented control ----------------------------------------

   Ported verbatim from the web edition (static/js/app.js paintSplitControl),
   which is the point: it is the same control over the same window fact. The
   terminal edition reached the grid through `/split` alone, and the user's
   own read was that a non-technical reader cannot find a layout that has no
   visible affordance (TERMINAL-REDESIGN.md §3). A declared departure from
   V2-PLAN §2's "no chips": this is chrome about the WINDOW, not a mirror of a
   CLI capability.

   It POSTS NOTHING. How many conversations are on screen is a fact about this
   window, not about the server -- the tabs it parks stay open exactly as they
   were, and /api/tab/activate still follows the keyboard through applyFocus. */
const SPLIT_OPTIONS = [1, 2, 4];

function paintSplitControl(active) {
  const seg = document.getElementById("split-seg");
  if (!seg) return;
  if (!seg.children.length) {
    seg.setAttribute("aria-label", FA.splitLabel ?? "");
    for (const n of SPLIT_OPTIONS) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "seg";
      b.dataset.split = String(n);
      b.textContent = n.toLocaleString("fa-IR");
      b.title = (FA.splitOptionTitle ?? "").replace("{n}", b.textContent);
      b.addEventListener("click", () => setSplit(n));
      seg.append(b);
    }
  }
  for (const b of seg.children) {
    b.setAttribute("aria-pressed", String(Number(b.dataset.split) === active));
  }
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
      { split: cells.length, cells: cells.map((one) => one.tab || ""),
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
  paintSplitControl(1);
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

/* Alt+1..4 moves the keyboard between columns. `e.code`, never `e.key`: a
   Persian keyboard layout puts «۱» in `e.key` and the chord would never match
   (js/choice.js carries the same trap for the numbered dialogs). */
const DIGIT_CODES = ["Digit1", "Digit2", "Digit3", "Digit4"];

document.addEventListener("keydown", (e) => {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const at = DIGIT_CODES.indexOf(e.code);
  if (at < 0 || at >= cells.length) return;
  e.preventDefault();
  focusCell(at, { focusInput: true });
});

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
}
setInterval(tickIdle, 60_000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) tickIdle();
});

focusedCell()?.composer.focus();
// Which conversations are open, and which one this window is looking at. The
// stream is already filling their buffers by now; this is what puts one of them
// on screen — unqueued, because until it answers the window shows nothing.
if (wantsTransport) loadTabs();
