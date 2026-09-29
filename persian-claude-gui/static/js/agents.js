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
  setRunningTasks, shortModel,
} from "./render.js";

const FA = window.STRINGS;

const POLL_LIST_MS = 3000;     // while anything is still running
const POLL_DRAWER_MS = 2000;   // while the open agent is still running

let registry = [];      // what /api/agents last reported, in its own order
let strip = null;       // the row of agents above the composer
let listTimer = 0;
let refreshTimer = 0;
let drawer = null;      // { id, panel, body, live, scope, cursor, empty }
let showHistory = false; // the panel's «پایان‌یافته» list, folded until asked
let panel = null;       // the Background tasks panel, while it is open
const progress = new Map();  // task id -> the CLI's latest system/task_progress
const cleared = new Set();   // finished ids the person wiped from the panel

/* --- the strip -------------------------------------------------------------- */

/* Built here rather than in index.html: it is pure chrome, and it has to exist
   on the spec harness too, which carries no composer markup of its own. It
   lands where the context notice already sits — the same kind of thing, a line
   ABOUT the conversation rather than part of it. */
/* MA3-T2: there is one registry per window (the helpers belong to the session
   the keyboard is in) but N columns it could be drawn in, so the strip is
   RE-ANCHORED on every paint rather than parked in whichever column happened
   to be first. Moving a node re-parents it, so this is one insert, not a
   rebuild — and `state.cell` is the column being painted, which refreshAgents()
   is already gated to the focused one (render.js onFocused). */
function stripEl() {
  if (!strip) {
    strip = document.createElement("div");
    strip.className = "agents-strip";
    strip.hidden = true;
  }
  const root = state.cell?.root ?? document;
  const anchor = root.querySelector(".context-notice");
  if (anchor) {
    if (strip.nextSibling !== anchor) anchor.before(strip);
  } else if (!strip.isConnected) {
    document.body.append(strip);
  }
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

/* The strip above the composer, since CLAUDE-AI-PARITY.md P3: nothing but
   the site's «N running task» chip — and only while the turn itself is over,
   since during a turn the same chip rides the working line (render.js). The
   rows, the history and the drawer's way in all moved into the panel. */
function paint() {
  const el = stripEl();
  const running = registry.filter((a) => a.status === "running");
  /* «کار در جریان است», published the way `busy` already is: as a body class.
     The composer's idle hint («مدتی از این گفتگو گذشته») fires on a quiet
     stretch, and a turn that dispatched helpers IS quiet — the model's own turn
     ended minutes ago while the agents keep working — so the hint arrived in the
     middle of a working session and the user read it as an error. This module
     is the only one that knows, and the class is the signal it already reads in
     the other direction below (`body.busy`, written by composer.js setBusy). */
  document.body.classList.toggle("agents-running", running.length > 0);
  setRunningTasks(running.length);
  if (panel) paintPanel();
  el.replaceChildren();
  if (!running.length || document.body.classList.contains("busy")) {
    el.hidden = true;
    return;
  }
  const n = running.length.toLocaleString("fa-IR");
  el.append(taskChip(running.length),
            label(FA.agentsWaiting.replace("{n}", n), "ag-wait"));
  el.hidden = false;
}

function taskChip(count) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "ag-chip";
  chip.textContent = FA.pulseTasks.replace("{n}", count.toLocaleString("fa-IR"));
  chip.addEventListener("click", () => openPanel());
  return chip;
}

/* --- the Background tasks panel (P3) -----------------------------------------

   After claude.ai/code's, from the user's screenshot: «در حال اجرا» cards —
   what it is doing, «عامل · ۱ دقیقه», the model, tokens, tool uses and the
   current step, «دیدن گزارش», a stop square — then «پایان‌یافته N ‹» folded,
   with a wipe for that list. The numbers are the CLI's own `system/task_progress`
   (wiki/cli-stream-json-findings.md §5.10); nothing here is estimated. */

/* The CLI's running report for one helper. Live only — a reload replays the
   hub's backlog, which carries these too, so the panel comes back filled. */
export function noteTaskProgress(ev) {
  const id = ev.task_id;
  if (!id) return;
  const was = progress.get(id) ?? {};
  progress.set(id, {
    tokens: ev.usage?.total_tokens ?? was.tokens,
    toolUses: ev.usage?.tool_uses ?? was.toolUses,
    lastTool: ev.last_tool_name ?? was.lastTool,
    description: ev.description ?? was.description,
  });
  if (panel) paintPanel();
}

function fmtCount(n) {
  if (typeof n !== "number") return "";
  return n >= 1000
    ? FA.thousands.replace("{n}", (Math.round(n / 100) / 10).toLocaleString("fa-IR"))
    : n.toLocaleString("fa-IR");
}

function nowDoing(tool) {
  if (!tool) return "";
  return FA.tasksNow?.[tool] ?? FA.tasksNow?.other ?? "";
}

function taskCard(agent) {
  const live = agent.status === "running";
  const card = document.createElement("div");
  card.className = "tk-card";
  card.dataset.status = agent.status || "running";
  card.dataset.agentId = agent.id;
  const p = progress.get(agent.id) ?? {};

  const top = document.createElement("div");
  top.className = "tk-top";
  const title = document.createElement("bdi");
  title.className = "tk-title";
  title.setAttribute("dir", "auto");
  title.textContent = agent.description || p.description || FA.agentRow;
  top.append(title);
  if (live) {
    const stop = document.createElement("button");
    stop.type = "button";
    stop.className = "tk-stop";
    stop.title = FA.tasksStop;
    stop.setAttribute("aria-label", FA.tasksStop);
    stop.addEventListener("click", () => stopTask(agent, stop));
    top.append(stop);
  }
  card.append(top);

  const kind = document.createElement("div");
  kind.className = "tk-meta";
  kind.append(label(agent.kind === "agent" ? FA.tasksKindAgent : FA.tasksKindCommand, "tk-kind"));
  const when = elapsed(agent);
  if (when) kind.append(label(when, "tk-time"));
  card.append(kind);

  const facts = document.createElement("div");
  facts.className = "tk-meta";
  if (agent.model) {
    const m = pathEl(shortModel(String(agent.model)));
    m.classList.add("tk-model");
    facts.append(m);
  }
  if (typeof p.tokens === "number") facts.append(label(FA.tasksTokens.replace("{n}", fmtCount(p.tokens)), "tk-fact"));
  if (typeof p.toolUses === "number") facts.append(label(FA.tasksToolUses.replace("{n}", fmtCount(p.toolUses)), "tk-fact"));
  if (live && p.lastTool) facts.append(label(nowDoing(p.lastTool), "tk-now"));
  if (facts.childElementCount) card.append(facts);

  // A backgrounded shell command has no transcript on disk and never will, so
  // it gets no way in — a link that opens onto nothing is worse than none.
  if (agent.kind === "agent") {
    const view = document.createElement("button");
    view.type = "button";
    view.className = "tk-view";
    view.textContent = FA.tasksView;
    view.addEventListener("click", () => openDrawer(agent));
    card.append(view);
  }
  return card;
}

async function stopTask(agent, button) {
  button.disabled = true;
  try {
    await api("/api/control", { tab: state.tab, subtype: "stop_task",
                                params: { task_id: agent.id } });
  } catch (err) {
    button.disabled = false;
    return;
  }
  refreshAgents();
}

function paintPanel() {
  if (!panel) return;
  const running = registry.filter((a) => a.status === "running");
  const finished = registry.filter((a) => a.status !== "running" && !cleared.has(a.id));
  const focusedId = panel.body.contains(document.activeElement)
    ? document.activeElement.closest("[data-agent-id]")?.dataset.agentId : null;
  panel.body.replaceChildren();
  panel.body.append(label(FA.tasksRunning, "tk-section"));
  if (running.length) for (const a of running) panel.body.append(taskCard(a));
  else panel.body.append(label(FA.tasksNone, "tk-empty"));
  if (finished.length) {
    const row = document.createElement("div");
    row.className = "tk-finished-row";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "tk-finished";
    toggle.setAttribute("aria-expanded", String(showHistory));
    toggle.textContent = FA.tasksFinished.replace("{n}", finished.length.toLocaleString("fa-IR"));
    toggle.addEventListener("click", () => { showHistory = !showHistory; paintPanel(); });
    const wipe = document.createElement("button");
    wipe.type = "button";
    wipe.className = "tk-clear";
    wipe.title = FA.tasksClear;
    wipe.setAttribute("aria-label", FA.tasksClear);
    wipe.addEventListener("click", () => {
      for (const a of finished) cleared.add(a.id);
      paintPanel();
    });
    row.append(toggle, wipe);
    panel.body.append(row);
    if (showHistory) for (const a of finished) panel.body.append(taskCard(a));
  }
  if (focusedId) {
    panel.body.querySelector(`[data-agent-id="${CSS.escape(focusedId)}"] button`)?.focus();
  }
}

export function openPanel() {
  if (panel) { paintPanel(); return true; }
  closeDrawer();
  const el = document.createElement("div");
  el.id = "tasks-panel";
  el.popover = "auto";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", FA.tasksTitle);
  const head = document.createElement("header");
  head.className = "tk-head";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "ag-close";
  close.textContent = "×";
  close.title = FA.agentClose;
  close.setAttribute("aria-label", FA.agentClose);
  close.addEventListener("click", () => closePanel());
  head.append(label(FA.tasksTitle, "tk-heading"), close);
  const body = document.createElement("div");
  body.className = "tk-body";
  el.append(head, body);
  document.body.append(el);
  el.addEventListener("toggle", (e) => {
    if (e.newState === "closed" && panel?.el === el) closePanel();
  });
  panel = { el, body };
  el.showPopover();
  paintPanel();
  refreshAgents();
  return true;
}

function closePanel() {
  if (!panel) return;
  const el = panel.el;
  panel = null;
  if (el.matches(":popover-open")) el.hidePopover();
  el.remove();
}

window.addEventListener("pcg:tasks", () => openPanel());

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
/* `/tasks` (V2-PLAN §3.5): the TUI's «show me the background work» opens the
   panel. False when there is nothing to show, so the caller says so in its
   own words rather than opening an empty box. */
export function unfoldAgents() {
  if (!registry.length) return false;
  showHistory = true;
  openPanel();
  return true;
}

export function resetAgents() {
  clearTimeout(listTimer);
  clearTimeout(refreshTimer);
  listTimer = refreshTimer = 0;
  closeDrawer();
  closePanel();
  registry = [];
  progress.clear();
  cleared.clear();
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
