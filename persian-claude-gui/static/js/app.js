/* ============================================================================
   Entry point: SSE transport, the tab registry, and init order.

   Module map (was one 1100-line classic script until 2026-08-05):

     api.js       token + fetch helper                       (leaf, no imports)
     bidi.js      the whole BiDi contract, spec rules 1-2    (leaf, no imports)
     controls.js  model picker + approval pill               (imports api.js)
     render.js    renderEvent: stream events -> DOM
     chrome.js    sidebar, home state, replay, permission dialog
     composer.js  input, ZWNJ, send/stop, attachments, slash
     agents.js    background-agents strip + per-agent drawer
     app.js       this file

   LOAD ORDER. render.js and chrome.js import each other on purpose (the
   renderer drives the sidebar; the sidebar replays through the renderer). That
   cycle is only safe because NO module body does work at evaluation time — the
   side effects live in initChrome() / initComposer(), called from here once
   every module is live, in the same order the single-file version ran them.
   Keep it that way: a `const` read across the cycle during evaluation is a
   temporal-dead-zone crash with a very unhelpful stack. Nothing may import THIS
   module either (it is the entry: its body runs last), which is why chrome.js
   is handed setTabBridge() rather than importing the switch itself.

   strings.fa.js and vendor/marked.min.js stay CLASSIC scripts: they set window
   globals and classic scripts finish before any module runs.
   ========================================================================= */
"use strict";

import { renderMarkdown } from "./bidi.js";
import {
  renderEvent, setStatus, setAgents, state, resetTurn, clearPulse,
  newRenderScope, withRenderTarget,
} from "./render.js";
import {
  initChrome, setTabBridge, setOpenTabs, setCurrentSession, setChrome,
  refreshProjects, dismissTabPermissions,
} from "./chrome.js";
import {
  initComposer, snapshotComposer, restoreComposer, setBusy, setSlashCommands,
  noteContext, contextFull, checkIdle, setComposerBlank,
} from "./composer.js";
import {
  initControls, snapshotControls, restoreControls, applyInitInfo,
  setModelResolved, setOutputStyle, setEffortState, setPostureState,
  setAutoCount, noteAutoAction,
} from "./controls.js";
import { initAgents, applyAgents, refreshAgents, resetAgents } from "./agents.js";
import { api, token } from "./api.js";

// Reused by history replay and by spec-test.html, so the acceptance tests
// exercise the shipping code path rather than a copy of it.
window.renderEvent = renderEvent;
window.renderMarkdown = renderMarkdown;
// Same seam for the agents strip: the harness paints it from a synthetic
// /api/agents payload, through the shipping builder rather than a copy.
window.renderAgents = applyAgents;
// And for the idle hint, whose hour the harness fast-forwards via `now`.
window.checkIdle = checkIdle;

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

const log = document.getElementById("log");

export const tabs = new Map();   // tab -> {node, scope, chrome}
export let activeTab = null;
let tabList = [];                // the server's own view, for the sidebar

/* Lazily created: events for a tab arrive before /api/tabs can answer, and
   dropping them would lose the opening of a conversation. */
function tabEntry(tab) {
  let entry = tabs.get(tab);
  if (!entry) {
    entry = { node: document.createElement("div"),
              scope: newRenderScope(true), chrome: null };
    tabs.set(tab, entry);
  }
  return entry;
}

/* The untagged path is the original one and stays exactly as it was: it is what
   the spec harness drives, and what a server that knows nothing about tabs
   would send. */
export function routeEvent(ev) {
  const tab = typeof ev.tab === "string" ? ev.tab : "";
  if (!tab || tab === activeTab) {
    renderEvent(ev);
  } else {
    const entry = tabEntry(tab);
    withRenderTarget(entry.node, entry.scope, () => renderEvent(ev));
  }
  if (tab) noteTabEvent(ev, tab);
}

/* WHERE A TAB'S OUTPUT LANDS RIGHT NOW. Everything that renders a transcript
   the user did not just watch arrive — history replay, a resumed session's
   backfill — is separated from its own render by an await, and by the time it
   comes back the tab it was fetched for may be parked or gone. Resolving the
   destination HERE, at render time, is what stops it writing into whichever
   conversation happens to be on screen: the next parkActive() would copy that
   foreign transcript into the active tab and keep it there.

   The callback is handed the node it is writing into, so a caller that starts
   from an empty view can clear the right one. A tab that was closed while the
   fetch was out gets no callback at all — the output has nowhere to go, and
   inventing a home for it is how a closed conversation comes back. */
export function renderInTab(tab, fn) {
  // No tab / the visible one: the live log and the live scope, exactly as
  // before tabs existed. `!tab` is the harness and the blank view, where #log
  // belongs to no conversation and nothing can be clobbered.
  if (!tab || tab === activeTab) {
    fn(log);
    return;
  }
  const entry = tabs.get(tab);
  if (!entry) return;
  withRenderTarget(entry.node, entry.scope, () => fn(entry.node));
}

/* Identity (session id), folder and busy are the server's to know, and every
   event below changes one of them. Asking is cheaper than mirroring the
   server's bookkeeping here and drifting from it. */
const TAB_NEWS = new Set(["user_echo", "resumed", "cli_exited", "reset"]);

function noteTabEvent(ev, tab) {
  if (ev.type === "wrapper" && ev.subtype === "closed") {
    dropTab(tab);
    return;
  }
  if ((ev.type === "system" && ev.subtype === "init") || ev.type === "result"
      || (ev.type === "wrapper" && TAB_NEWS.has(ev.subtype))) {
    refreshTabs();
  }
}

/* --- switching --------------------------------------------------------------

   The acceptance bar: NO per-session state may survive into another tab. That
   is why the restore below is unconditional and total — every chip is painted
   from this conversation's own snapshot or from nothing, never left showing
   what the previous one had. This project has already shipped that defect three
   times with a single session and a restart (statusline, model picker, armed
   delete); with six live conversations it would be the norm. */

function parkActive() {
  const entry = tabs.get(activeTab);
  if (!entry) return;
  // Read BEFORE the move: an emptied #log reports scrollTop 0, so the other
  // order silently sends every returning tab back to the top.
  entry.scrollTop = log.scrollTop;
  entry.node.replaceChildren(...log.childNodes);
  Object.assign(entry.scope, state);
  entry.scope.background = true;
  entry.chrome = { controls: snapshotControls(), composer: snapshotComposer() };
}

/* Synchronous half of a switch: DOM, render state and chrome. Separate from
   switchTab() below so the spec harness can drive it without a server. */
export function applySwitch(tab) {
  const entry = tabEntry(tab);
  if (activeTab && activeTab !== tab) parkActive();
  // Whatever #log holds belonged to the tab just parked. Anything left when no
  // tab owned the view is content no conversation claims — only the harness
  // can produce that, and it puts its own DOM back itself.
  log.replaceChildren(...entry.node.childNodes);

  entry.scope.background = false;
  Object.assign(state, entry.scope);
  restoreControls(entry.chrome?.controls);
  restoreComposer(entry.chrome?.composer);
  setStatus({});                       // repaint from THIS session's own status
  applyChrome(state.chrome);           // what landed while it was in the background
  entry.scope.chrome = state.chrome = {};
  setChrome(state.status.cwd || "");
  setCurrentSession(state.status.sessionId ?? null);
  // Back where the reader left this conversation; a tab being opened for the
  // first time starts at its newest message, like every other chat view.
  log.scrollTop = entry.scrollTop ?? log.scrollHeight;

  activeTab = tab;
  // A conversation is on screen again: there is somewhere for a message to go.
  setComposerBlank(false);
  setOpenTabs(tabList, activeTab);
  refreshProjects();
  refreshAgents();   // the strip belongs to the session now on screen
}

/* The chrome-shaped facts a background tab collected (render.js toChrome).
   Applied after the snapshot restore, because they are newer than it. */
function applyChrome(deltas) {
  const d = deltas ?? {};
  // The conversation was cleared while we were away: its snapshot describes a
  // session that no longer exists.
  if (d.reset) {
    restoreControls(null);
    restoreComposer(null);
  }
  if (d.initInfo) applyInitInfo(d.initInfo);
  if (d.slash) setSlashCommands(d.slash);
  if (d.agents) setAgents(d.agents);
  if (d.model) setModelResolved(d.model);
  if (d.outputStyle) setOutputStyle(d.outputStyle);
  if (d.effort) setEffortState(d.effort);
  if (d.posture) setPostureState(d.posture, d.autoCount ?? 0);
  for (const action of d.autoActions ?? []) noteAutoAction(action.tool, action.why);
  if (typeof d.autoCount === "number") setAutoCount(d.autoCount);
  if (typeof d.context === "number") noteContext(d.context);
  if (d.contextFull) contextFull();
  if (typeof d.busy === "boolean") setBusy(d.busy);
}

/* No conversation on screen at all: the last tab was closed. */
function blankView() {
  log.replaceChildren();
  resetTurn();
  Object.assign(state, newRenderScope(false));
  restoreControls(null);
  restoreComposer(null);
  setStatus({});
  setCurrentSession(null);
  resetAgents();
  // Nothing to send TO: a POST with no tab 404s, and the generic «ارسال نشد»
  // bubble that follows is a dead end for a reader who does not know what a
  // tab is. The box says why instead, and applySwitch() above puts it back.
  setComposerBlank(true);
  activeTab = null;
}

/* The server decides which tab is active — every tab-less endpoint routes by
   it — so the POST goes first and a refusal (that tab is gone) switches
   nothing. */
export async function switchTab(tab) {
  if (!tab || tab === activeTab) return;
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
   window is reloaded (blankView only reaches the ACTIVE tab's), and any
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
  dismissTabPermissions(tab);
  if (tab === activeTab) {
    blankView();
    // switchTab, not applySwitch: the server routes every tab-less request by
    // ITS active tab, so a view this window picked on its own would type into
    // one conversation and send to another.
    const next = nextActive && tabs.has(nextActive)
      ? nextActive : [...tabs.keys()].at(-1);
    if (next) switchTab(next);
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
  if (!activeTab) {
    // Showing what the server already calls active needs no POST; picking a
    // different one does, or this window would send into another conversation.
    if (alive.has(data.active)) applySwitch(data.active);
    else if (tabList.length) switchTab(tabList.at(-1).tab);
    else blankView();
  }
  setOpenTabs(tabList, activeTab);
}

// chrome.js draws the sidebar and the session rows; it asks for a switch or a
// close through here rather than importing this module (see the load-order
// note above).
setTabBridge({
  switchTo: switchTab, close: closeTab,
  // Read at CALL time, never cached: the sidebar starts a replay before an
  // await and renders after it, and the answer can differ between the two.
  active: () => activeTab,
  renderIn: renderInTab,
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

initComposer();
initControls();
initAgents();
// Which conversations are open, and which one this window is looking at. The
// stream is already filling their buffers by now; this is what puts one of them
// on screen — unqueued, because until it answers the window shows nothing.
if (wantsTransport) loadTabs();
