/* ============================================================================
   Background agents: the strip above the composer and the per-agent drawer.

   The CLI can dispatch helpers that keep working after the turn ends (the
   `Agent` tool with run_in_background). Everything here MIRRORS what the server
   read out of the transcript — the wrapper invents no agent state of its own,
   and the «در انتظار N عامل» line counts the registry rather than scraping the
   CLI's English notice (wiki/background-agents.md).

   Cyclic with render.js, exactly like chrome.js and for the same reason: the
   drawer replays an agent's own transcript through the SHIPPING renderer (plan
   §B-4, "one renderer, two sources"), and the renderer is what tells us a
   launch ack or a session reset landed. The cycle is safe under the one
   invariant that makes the existing one safe: NOTHING in this module body runs
   at evaluation time — initAgents() is called from app.js once every module is
   live. Only hoisted function declarations cross the edge, only at event time.
   ========================================================================= */
"use strict";

import { pathEl } from "./bidi.js";
import { api, token } from "./api.js";
import {
  bulkAppend, label, renderEvent, state, withRenderTarget, newRenderScope,
} from "./render.js";

const FA = window.STRINGS;

const POLL_LIST_MS = 3000;     // while anything is still running
const POLL_DRAWER_MS = 2000;   // while the open agent is still running

let registry = [];      // what /api/agents last reported, in its own order
let strip = null;       // the row of agents above the composer
let listTimer = 0;
let refreshTimer = 0;
let drawer = null;      // { id, panel, body, live, scope, cursor, empty }
let showHistory = false; // finished rows are folded behind the .ag-history toggle

/* --- the strip -------------------------------------------------------------- */

/* Built here rather than in index.html: it is pure chrome, and it has to exist
   on the spec harness too, which carries no composer markup of its own. It
   lands where the context notice already sits — the same kind of thing, a line
   ABOUT the conversation rather than part of it. */
function stripEl() {
  if (strip?.isConnected) return strip;
  strip = document.createElement("div");
  strip.id = "agents-strip";
  strip.hidden = true;
  const anchor = document.getElementById("context-notice");
  if (anchor) anchor.before(strip);
  else document.body.append(strip);
  return strip;
}

/* Seconds or milliseconds — both spellings of an epoch are in use around this
   codebase (transcript mtimes are seconds), so decide by magnitude instead of
   trusting one. */
function stamp(value) {
  const n = Number(value);
  if (!n) return 0;
  return n > 1e12 ? n : n * 1000;
}

/* How long it has been at it. Persian digits: this is prose in the chrome, not
   a technical value (spec rule 5). */
function elapsed(agent) {
  const start = stamp(agent.startedAt);
  const end = agent.status === "running" ? Date.now() : stamp(agent.finishedAt);
  if (!start || !end || end < start) return "";
  const seconds = Math.round((end - start) / 1000);
  const [key, n] = seconds < 60
    ? ["elapsedSeconds", seconds]
    : ["elapsedMinutes", Math.round(seconds / 60)];
  return FA[key].replace("{n}", n.toLocaleString("fa-IR"));
}

function dotEl(status) {
  const dot = label(status === "completed" ? "✓" : status === "stopped" ? "—" : "",
                    "ag-dot");
  dot.setAttribute("aria-hidden", "true");
  return dot;
}

/* A `command` is a shell command the CLI backgrounded: there is no subagent
   transcript on disk for it and there never will be, so it gets no drawer —
   and it is a <div>, not a disabled button. A control you can press and nothing
   happens is worse than one that was never offered. */
function rowEl(agent) {
  const openable = agent.kind === "agent";
  const row = document.createElement(openable ? "button" : "div");
  row.className = "ag-row";
  row.dataset.status = agent.status || "running";
  row.dataset.agentId = agent.id;   // read back by paint() to restore focus
  if (openable) {
    row.type = "button";
    row.title = FA.agentOpen;
    row.addEventListener("click", () => openDrawer(agent));
  }

  row.append(dotEl(agent.status));

  // The description is the model's own line about the work, usually English,
  // sitting in an RTL row: isolate it (spec rule 2). <bdi dir="auto"> rather
  // than a forced LTR, because the model may well write it in Persian.
  const desc = document.createElement("bdi");
  desc.className = "ag-desc";
  desc.setAttribute("dir", "auto");
  desc.textContent = agent.description || FA.agentRow;
  row.append(desc);

  // What kind of helper it is — muted, like the MCP row's server chip.
  const origin = agent.agentType || agent.model;
  if (origin) {
    const chip = pathEl(String(origin));
    chip.classList.add("ag-type");
    row.append(chip);
  }

  const when = elapsed(agent);
  if (when) row.append(label(when, "ag-time"));
  return row;
}

function paint() {
  const el = stripEl();
  // replaceChildren() below rebuilds every row from scratch on each 3s poll,
  // which silently threw focus to <body> mid-tab for a keyboard/screen-reader
  // user — every poll cycle, for as long as any agent ran. Save which agent
  // (if any) owned focus and hand it back to the equivalent new row rather
  // than reconciling the DOM node-by-node (a bigger diff for the same fix).
  const focusedId = el.contains(document.activeElement)
    ? document.activeElement.dataset.agentId : null;
  el.replaceChildren();

  // The strip is about what is happening NOW — it sits above the composer,
  // where the CLI prints "Waiting for N background agents". A finished agent
  // has already reported back in the transcript, so its row does not show by
  // default (finished-rows-shown-forever was the original complaint) — but it
  // must stay reachable, since a row's own click is the only way into the
  // drawer. `registry` still holds every entry the server reported: the
  // toggle below folds it open, and an open drawer polls its own agent by id
  // regardless of this filter.
  const running = registry.filter((a) => a.status === "running");
  const finished = registry.filter((a) => a.status !== "running");
  /* «کار در جریان است», published the way `busy` already is: as a body class.
     The composer's idle hint («مدتی از این گفتگو گذشته») fires on a quiet
     stretch, and a turn that dispatched helpers IS quiet — the model's own turn
     ended minutes ago while the agents keep working — so the hint arrived in the
     middle of a working session and the user read it as an error. This module
     is the only one that knows, and the class is the signal it already reads in
     the other direction three lines below (`body.busy`, written by composer.js
     setBusy). A shared import would close a third module cycle for one boolean. */
  document.body.classList.toggle("agents-running", running.length > 0);
  if (!running.length && !finished.length) {
    el.hidden = true;
    return;
  }
  for (const agent of running) el.append(rowEl(agent));

  if (finished.length) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "ag-history";
    toggle.textContent = FA.agentHistory.replace("{n}", finished.length.toLocaleString("fa-IR"));
    toggle.addEventListener("click", () => { showHistory = !showHistory; paint(); });
    el.append(toggle);
    if (showHistory) {
      for (const agent of finished) el.append(rowEl(agent));
    }
  }

  if (focusedId) {
    el.querySelector(`[data-agent-id="${CSS.escape(focusedId)}"]`)?.focus();
  }

  // The CLI prints "Waiting for N background agents" once its own turn is over
  // and helpers are still out. Same fact, in Persian, counted off the registry
  // — never parsed out of a message. Still running-only: a finished agent is
  // not something anyone is waiting for.
  if (running.length && !document.body.classList.contains("busy")) {
    el.append(label(FA.agentsWaiting.replace("{n}", running.length.toLocaleString("fa-IR")),
                    "ag-wait"));
  }
  el.hidden = false;
}

/* --- polling ---------------------------------------------------------------- */

/* The strip is about the LIVE conversation, so the session is whatever the
   renderer last heard from system/init; with none the server answers for the
   session it is running. `id`, not `session`: both endpoints mirror
   /api/session's parameter names exactly. */
function agentsUrl(path, extra) {
  const params = new URLSearchParams(extra ?? {});
  if (state.status.sessionId) params.set("id", state.status.sessionId);
  if (state.status.cwd) params.set("cwd", state.status.cwd);
  return path + "?" + params;
}

/* Debounced like the sidebar's own refresh, and for the same reason: replaying
   a transcript pushes one `result` event per turn through the renderer, and
   every one of them asks for this. */
export function refreshAgents() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(loadAgents, 300);
}

async function loadAgents() {
  if (!token) return;
  // Captured before the await: a project/session switch clears state.status
  // .sessionId synchronously (resetStatus), but a request already in flight
  // for the OLD session can still land after it — without this check its
  // answer would overwrite a just-cleared registry with the old session's
  // agents.
  const forSession = state.status.sessionId;
  try {
    const data = await api(agentsUrl("/api/agents"));
    if (state.status.sessionId !== forSession) return;   // session changed under us
    registry = Array.isArray(data.agents) ? data.agents : [];
    paint();
  } catch (err) {
    // best-effort chrome; the next poll retries. `registry` is left exactly
    // as it was, so arm() below still reschedules off the last-known state —
    // a transient failure (e.g. a brief 404 while a session resumes) must not
    // read as "nothing is running any more" and go silent forever.
  } finally {
    arm();
  }
}

/* Poll only while something is actually running — a finished list is final
   until the next launch, and this window may sit open for hours. */
function arm() {
  clearTimeout(listTimer);
  if (registry.some((a) => a.status === "running")) {
    listTimer = setTimeout(loadAgents, POLL_LIST_MS);
  }
}

/* Painting from a payload is its own export so the spec harness can drive the
   strip without a server (app.js publishes it as window.renderAgents, the same
   seam window.renderEvent already is). */
export function applyAgents(list) {
  registry = Array.isArray(list) ? list : [];
  paint();
}

/* --- the drawer -------------------------------------------------------------- */

/* One agent's own transcript, replayed through renderEvent — NOT a second
   renderer (plan §B-4). withRenderTarget swaps the renderer's log element and
   its per-turn state for the duration of the replay; the scope lives here, so
   the agent's tool cards can never land in the main transcript's
   state.toolCards and vice versa.

   [popover] does the hard parts natively, as it does for the ⋯ menu: top layer,
   light dismiss on an outside click, and Escape. Built fresh on every open so
   there is no stale cursor or half-rendered body to reset. */
function openDrawer(agent) {
  closeDrawer();

  const panel = document.createElement("div");
  panel.id = "agent-drawer";
  panel.popover = "auto";

  const head = document.createElement("header");
  head.className = "ag-head";
  head.dataset.status = agent.status || "running";
  const desc = document.createElement("bdi");
  desc.className = "ag-desc";
  desc.setAttribute("dir", "auto");
  desc.textContent = agent.description || FA.agentRow;
  head.append(desc);

  const origin = agent.agentType || agent.model;
  if (origin) {
    const chip = pathEl(String(origin));
    chip.classList.add("ag-type");
    head.append(chip);
  }

  const live = document.createElement("span");
  live.className = "ag-live";
  live.hidden = agent.status !== "running";
  live.append(dotEl("running"), label(FA.agentRunning));
  head.append(live);

  const close = document.createElement("button");
  close.type = "button";
  close.className = "ag-close";
  close.textContent = "×";
  close.title = FA.agentClose;
  close.setAttribute("aria-label", FA.agentClose);
  // Straight to closeDrawer, not hidePopover: the `toggle` event is queued, not
  // synchronous, so going the long way round leaves the panel in the DOM for a
  // task longer than the click that dismissed it.
  close.addEventListener("click", () => closeDrawer());
  head.append(close);

  const body = document.createElement("div");
  body.className = "ag-log";
  panel.append(head, body);
  document.body.append(panel);

  // Escape and the light-dismiss click arrive only here — one exit either way,
  // so the poll can never outlive the panel. Guarded on the module-level
  // drawer still being THIS panel: hidePopover() on an old panel runs
  // synchronously, but its `toggle` event is only QUEUED, so opening a second
  // agent's drawer before the first one's queued event fires would otherwise
  // call the module-global closeDrawer() and tear down the NEW panel instead
  // of the one that actually closed.
  panel.addEventListener("toggle", (e) => {
    if (e.newState === "closed" && drawer?.panel === panel) closeDrawer();
  });

  drawer = { id: agent.id, panel, body, live, head, scope: newRenderScope(),
             cursor: 0, empty: false, fails: 0 };
  panel.showPopover();
  pollDrawer();
}

async function pollDrawer() {
  if (!drawer || !token) return;
  // Captured before the await, and compared by IDENTITY below, not by id:
  // close-then-reopen the SAME agent makes a new drawer object carrying the
  // same id, and an id check alone would let this in-flight request's answer
  // land in the new drawer once it resolves.
  const forDrawer = drawer;
  let data;
  try {
    data = await api(agentsUrl("/api/agent", { agent: forDrawer.id, after: forDrawer.cursor }));
  } catch (err) {
    if (drawer !== forDrawer) return;
    // agent_file_path() 404s until the CLI actually creates the transcript —
    // true for the first few seconds of ANY agent's life, not a failure. Only
    // a real error (network down, 5xx) counts against the retry cap below —
    // otherwise a brand-new agent hits the cap during its own startup window,
    // shows FA.sendFailed (wrong: nothing was ever "sent"), and never polls
    // again even though the transcript would have appeared moments later.
    if (/-> 404$/.test(err.message)) {
      if (!forDrawer.empty) {
        forDrawer.empty = true;
        forDrawer.body.append(label(FA.agentEmpty, "meta ag-empty"));
      }
      forDrawer.timer = setTimeout(pollDrawer, POLL_DRAWER_MS);
      return;
    }
    if (++forDrawer.fails >= 3) {
      // strings.fa.js is off-limits for this fix (not in the edit set) and
      // has no "could not load this agent" key; FA.disconnected ("اتصال قطع
      // شد") already says the true thing — the poll could not reach the
      // server — which FA.sendFailed ("ارسال ناموفق بود", about SENDING a
      // message) never did.
      forDrawer.body.append(label(FA.disconnected, "meta ag-empty"));
      return;
    }
    forDrawer.timer = setTimeout(pollDrawer, POLL_DRAWER_MS);
    return;
  }
  if (drawer !== forDrawer) return;   // closed (or closed+reopened) while the request was out
  forDrawer.fails = 0;

  const events = Array.isArray(data.events) ? data.events : [];
  if (events.length) {
    forDrawer.empty = false;
    forDrawer.body.querySelector(".ag-empty")?.remove();
    // Decided ONCE, before the append changes scrollHeight: follow the tail
    // only if the reader was already there (or the drawer is still empty — the
    // first fill always lands pinned). An unconditional pin yanked a reader
    // who had scrolled up back to the bottom on every poll.
    const stick = !forDrawer.body.childElementCount ||
      forDrawer.body.scrollHeight - forDrawer.body.scrollTop
        - forDrawer.body.clientHeight < 80;
    withRenderTarget(forDrawer.body, forDrawer.scope, () => {
      // Every append in the loop would ask whether the reader is at the bottom
      // and force a layout to answer — for nothing, since `stick` above already
      // decided for the whole batch. Same skip chrome.js's replay takes.
      bulkAppend(() => {
        for (const event of events) renderEvent(event);
      });
    });
    if (stick) forDrawer.body.scrollTop = forDrawer.body.scrollHeight;
  }
  if (typeof data.next === "number") forDrawer.cursor = data.next;

  // The CLI is authoritative about what this agent is; the row we opened from
  // is a copy of the same fields, one poll older.
  if (data.meta?.description) forDrawer.head.querySelector(".ag-desc").textContent =
    data.meta.description;
  forDrawer.live.hidden = !data.running;
  forDrawer.head.dataset.status = data.running ? "running" : "completed";

  if (!forDrawer.body.childElementCount && !forDrawer.empty) {
    forDrawer.empty = true;
    forDrawer.body.append(label(FA.agentEmpty, "meta ag-empty"));
  }
  if (data.running) forDrawer.timer = setTimeout(pollDrawer, POLL_DRAWER_MS);
}

function closeDrawer() {
  if (!drawer) return;
  const panel = drawer.panel;
  clearTimeout(drawer.timer);
  drawer = null;                // before hidePopover: its toggle re-enters here
  if (panel.matches(":popover-open")) panel.hidePopover();
  panel.remove();
}

/* --- lifecycle --------------------------------------------------------------- */

/* Everything this module owns dies with the session it belonged to: the list,
   the strip, both timers and an open drawer. Called from the renderer's
   `reset` — the one choke point every session swap goes through (project
   switch, new chat and resume all restart the CLI through it). State surviving
   a swap is this project's known defect family. */
export function resetAgents() {
  clearTimeout(listTimer);
  clearTimeout(refreshTimer);
  listTimer = refreshTimer = 0;
  closeDrawer();
  registry = [];
  showHistory = false;
  paint();
  // No refreshAgents() here: this runs from render.js's `wrapper/reset`
  // handler, which clears state.status.sessionId via resetStatus() right
  // before calling here — agentsUrl() only sends `id` when it is truthy, and
  // the server hard-requires it (unlike `cwd`), so a refresh fired from this
  // point is provably always a 400. render.js's system/init case calls
  // refreshAgents() once session_id is genuinely known — a resumed session
  // may already have helpers out, and that is what picks them up.
}

export function initAgents() {
  // A reloaded window lands mid-flight often enough to be worth one request:
  // the agents kept running while it was gone.
  refreshAgents();
}
