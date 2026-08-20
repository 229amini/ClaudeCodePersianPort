/* ============================================================================
   The renderer: stream events -> DOM.

   ONE RENDERER, TWO SOURCES (plan §B-4). renderEvent() is fed by the live SSE
   stream (app.js) and by replayed ~/.claude/projects/<cwd>/*.jsonl history
   (chrome.js). Do not fork a second history path.

   Anything that renders model or user text goes through renderMarkdown() so the
   two BiDi passes in bidi.js run on it.
   ========================================================================= */
"use strict";

import { renderMarkdown, pathEl, linesAuto, fillInline, autoDir } from "./bidi.js";
/* Cyclic on purpose: the renderer drives the sidebar, and the sidebar replays
   through the renderer. Only hoisted function declarations cross this edge, and
   only at event time — never while the modules are still evaluating. */
import {
  setChrome, refreshProjects, setCurrentSession,
  showPermission, dismissPermission,
} from "./chrome.js";
import { setBusy, setSlashCommands, noteContext, contextFull, isAway } from "./composer.js";
import { api, token } from "./api.js";
import {
  applyInitInfo, setModelResolved, setPostureState, setAutoCount, noteAutoAction,
  setEffortState, setOutputStyle, resetControls,
} from "./controls.js";
/* Cyclic for the same reason chrome.js is: the agents drawer replays a
   background agent's transcript back through this renderer. Same invariant —
   nothing crosses the edge until event time. */
import { refreshAgents, resetAgents } from "./agents.js";

const FA = window.STRINGS;

/* `let`, not `const`: withRenderTarget() below points it somewhere else for the
   length of one replay. Every append in this file goes through it. */
let log = document.getElementById("log");
const statusline = document.getElementById("statusline");

/* The CLI's own wording for a turn the user stopped, seen in both live events
   and replayed transcripts: "[Request interrupted by user]" and
   "[Request interrupted by user for tool use]". */
const INTERRUPT_NOTE = /^\s*\[Request interrupted by user/;

/* A finished background agent reports itself as a <task-notification> block
   that the CLI then auto-submits as an ordinary `user` message — so left alone
   it renders as the USER pasting forty lines of XML at themselves, in both the
   live stream and history replay. The launch ack is the mirror image: its text
   is internal metadata (agentId, output_file) and it says so itself.
   Both measured — wiki/background-agents.md. */
const TASK_NOTE = /^\s*<task-notification>/;
const ASYNC_LAUNCH = /^\s*Async agent launched/;

/* Plain text out of a tool_result's own `content` — either a bare string or
   the usual [{"type": "text", ...}] block array. Measured: 36 of 38 real
   launch acks on this machine arrive as the block-array shape, so testing
   ASYNC_LAUNCH against JSON.stringify(content) (an array, so it starts with
   "[") never matched and the ack fell through to the raw-output branch.
   Mirrors server.py's _tool_result_text — same shape, same fallback. */
function toolResultText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.filter((p) => p?.type === "text").map((p) => p.text ?? "").join(" ");
  }
  return "";
}

/* The CLI's own phrasings for "this conversation will not fit any more".
   Matched loosely on purpose — the numbers in the real message are interpolated
   and the wording drifts across versions — but FATAL-ONLY, which is the part
   that had to be measured rather than guessed.
   Read out of the shipped bundle 2026-08-18. Fatal:

     "Context exceeds the {n}-token limit by {m} tokens — run /compact or
      /clear to continue."                                    (hard_limit)
     "Context limit reached · /compact or /clear to continue"  (the CLI's own
      context_limit → cleared_context_limit error, which CLEARS the session)
     "prompt is too long" / "input is too long for requested model"
      (the API's, and the pair the bundle's own overflow detector tests for)

   Deliberately NOT matched — these are warnings the CLI redraws and takes back
   by itself, and a notice that appears mid-work and vanishes reads as a
   malfunction to a non-technical user:

     "Context low ({n}% remaining) · Run /compact to compact & continue"
     "Context is {n} tokens past the {m}-token compaction window — run /compact
      to continue."

   Note both warnings say "/compact", never "/compact or /clear" — that phrase
   only appears in the two fatal messages, which is what makes it safe to keep
   as the drift catch-all. The percentage-driven notice (composer.js noteContext)
   is what covers the warning half; this door is only for the turn that failed
   outright, where no percentage ever arrives. */
const CONTEXT_EXHAUSTED =
  /context (exceeds|limit reached)|\/compact or \/clear|(prompt|input) is too long/i;

/* --- DOM builders --------------------------------------------------------- */

function atBottom() {
  return log.scrollHeight - log.scrollTop - log.clientHeight < 80;
}

/* A replay is N appends of a transcript that is already finished, so every one
   of its atBottom() reads is a forced layout for an answer nobody can act on —
   the view only has to end up at the bottom once. chrome.js renderInto() wraps
   its loop in this and scrolls itself afterwards. */
let bulk = 0;

export function bulkAppend(fn) {
  bulk++;
  try { fn(); } finally { bulk--; }
}

function append(el, { stick = true } = {}) {
  const wasAtBottom = stick && !bulk && atBottom();
  toolHome(el).append(el);
  if (wasAtBottom) log.scrollTop = log.scrollHeight;
  return el;
}

/* ONE DOM WRITE PER FRAME for the streaming bubble.
   A text delta used to rewrite the whole bubble (`textContent = state.
   streamText`) and then read the scroll offset back — an O(n) write plus a
   forced layout per TOKEN, so an answer of n tokens cost O(n²) relayouts while
   the user was reading it. The text still accumulates per delta; only the paint
   is coalesced onto the next frame, which is the rate the screen updates at
   anyway.

   The queue is keyed by the BUBBLE and carries its own target because
   withRenderTarget() swaps `log` and `state` for the length of a SYNCHRONOUS
   replay (a background tab, the agents drawer) — the rAF callback runs long
   after that swap is undone, so it must read neither. */
const paintQueue = new Map();   // bubble -> { target, text }
let paintFrame = 0;
/* How much of a streaming answer the per-frame direction measurement reads.
   See the call below — this is a cost bound, not a correctness one. */
const STREAM_DIR_SAMPLE = 2000;

function queueStreamText(el, target, text) {
  paintQueue.set(el, { target, text });
  if (paintFrame) return;
  paintFrame = requestAnimationFrame(() => {
    paintFrame = 0;
    for (const [node, { target: t, text: s }] of paintQueue) {
      // NOT `node.isConnected`: a parked tab's transcript lives in a DETACHED
      // buffer node (app.js), where every node reports disconnected and the
      // whole background conversation would stop painting. `contains` answers
      // the question that is actually being asked — is this still the bubble's
      // scroller — for an attached and a buffered target alike. The text lands
      // either way (it is one idempotent write, and a bubble that moved between
      // the queue and the frame must not lose a chunk); only the scroll needs
      // a box that really holds it.
      const live = t.contains(node);
      const stick = live && t.scrollHeight - t.scrollTop - t.clientHeight < 80;
      node.textContent = s;
      // `.msg` is unicode-bidi:plaintext, which re-decides direction from the
      // paragraph's own FIRST strong character and ignores `dir` — so a
      // majority-Persian answer opening with a Latin term streams left-to-right
      // until the markdown render corrects it. Measure the accumulated text
      // instead, once per frame (`.streaming` in style.css is what lets the
      // attribute win). Same helper the settled blocks use — never a second
      // direction algorithm.
      //
      // BOUNDED, and only here: unbounded this is a regex scan of the whole
      // answer allocating an array of every matched character, ~60x/s for the
      // length of the stream — the O(n)-per-frame cost the coalescing above
      // exists to remove, put straight back beside it. The verdict is stable
      // long before this many characters, and when the message closes
      // applyDirection() re-measures the finished markdown exactly.
      autoDir(node, STREAM_DIR_SAMPLE);
      if (stick) t.scrollTop = t.scrollHeight;
    }
    paintQueue.clear();
  });
}

/* The queued paint is plain text and would land AFTER the markdown that
   replaces it, wiping a finished answer back to its own source. Both halves of
   ending a stream live here so neither can be forgotten: drop the pending
   paint, and take the bubble out of the live-stream direction rule. Must run
   immediately before the replaceChildren() that settles the bubble. */
function endStreamPaint(el) {
  if (!el) return;
  paintQueue.delete(el);
  el.classList.remove("streaming");
}

/* A run of consecutive tool calls collapses into ONE row — «۱ فایل خوانده شد،
   ۱۱ فرمان اجرا شد» — the way the CLI's own transcript does it. Eleven cards
   between two sentences is noise, and the whole point of this window is that a
   non-technical reader can follow the conversation; the group keeps every card
   exactly one click away instead of hiding it.

   Two deliberate limits:
   - The group forms on the SECOND card. A lone Bash call reads better as
     itself than as «۱ فرمان اجرا شد», so the first card goes in the log and is
     pulled into the group only if a second one follows it.
   - Anything that is not a plain tool card ends the run: a sentence, a
     question, a todo list, the result line. That is what makes the grouping
     mean "these happened together" rather than "these are the same tool".

   `.ask` is excluded because a question the user must answer can never be
   folded shut, and the group itself is built by hand rather than through
   card(): card() appends, append() calls this, and a `.card.tool` group would
   route itself straight back in.

   `.thinking` IS part of the run. With interleaved thinking the model thinks
   between every call, so a thinking card that ENDED the run shattered a
   fifteen-step turn into fifteen groups of one, separated by fifteen identical
   content-free «در حال فکر کردن» rows — the ladder the user reported. It joins
   the run instead, and is deliberately not counted in the summary: the row says
   what HAPPENED, and thinking is not one of the things that happened. */
function isRunnable(el) {
  if (!el.classList) return false;
  if (el.classList.contains("thinking")) return true;
  return el.classList.contains("tool") && !el.classList.contains("ask")
         && !el.classList.contains("group");
}

function groupSummaryText(counts) {
  const parts = [];
  for (const [name, n] of counts) {
    // An MCP name has no Persian noun and never will (the server set is
    // per-machine) — falling back to `name` reintroduces the forty-character
    // mcp__<server>__<tool> identifier that toolSummary() below was
    // specifically split apart for (bead pcg-9jx). mcpName() is the same
    // split, reused rather than duplicated.
    const mcp = mcpName(name);
    const noun = FA.toolGroupNouns?.[name] ?? FA.toolVerbs?.[name] ?? (mcp ? mcp.tool : name);
    parts.push(n.toLocaleString("fa-IR") + " " + noun);
  }
  return parts.join("، ");
}

function toolHome(el) {
  if (!isRunnable(el)) {
    state.run = null;
    return log;
  }
  const run = state.run ??= { first: null, group: null, counts: new Map() };
  const name = el.dataset.tool;
  if (name) run.counts.set(name, (run.counts.get(name) ?? 0) + 1);

  if (!run.group) {
    if (!run.first) {          // first of a possible run: stays inline
      run.first = el;
      return log;
    }
    const details = document.createElement("details");
    details.className = "card tool group";
    const summary = document.createElement("summary");
    summary.append(icon("run"), label("", "tool-verb"));
    details.append(summary);
    const body = document.createElement("div");
    body.className = "card-body";
    details.append(body);
    run.first.replaceWith(details);   // takes the first card's place in the log
    body.append(run.first);
    run.group = { details, body, text: summary.lastChild };
  }
  // A run of nothing but thinking has no action to count; it still needs a row
  // that says something, so it names itself.
  run.group.text.textContent = run.counts.size
    ? groupSummaryText(run.counts) : FA.thinking;
  return run.group.body;
}

/* --- a polling loop is one pair, not sixteen rows ---------------------------

   A model waiting on something writes the same sentence and makes the same call
   over and over — «منتظر می‌مانم.» then «خوانده شد b7j0iksrd.output», eight
   times — and the transcript becomes sixteen rows that say one thing. Three or
   more CONSECUTIVE identical pairs collapse into ONE, with the count on the row.

   THREE, not two. A pair that happens twice is a retry as often as it is a
   loop, and folding something the reader can still see both halves of costs
   more than it saves — so pair two stays on screen and is removed only once
   pair three proves it was a loop.

   IDENTICAL is decided on the assistant text's SOURCE markdown and the tool
   row's own summary text, never on rendered DOM: two cycles of the same loop
   differ by a tool_use id, an elapsed counter and a diff stat, and none of
   those is what the reader is seeing twice.

   ponytail: the pair is [sentence][ONE tool card], adjacent, both at the top
   level of the log. Two shapes therefore never fold, and both fail SAFE — the
   adjacency test simply does not match, nothing is removed and the transcript
   renders exactly as it did before this existed:
     - a cycle that makes two calls, which toolHome() folds into a `.group`
       first, so the card's parent is the group body rather than the log;
     - a loop with INTERLEAVED THINKING, which is the same thing by another
       route: a thinking card is runnable, so it wraps the pair's card into a
       group and the chain resets every cycle. A thinking-heavy polling loop
       therefore keeps all sixteen rows.
   The upgrade path for both, when a real one shows up: detect the pair on the
   EVENT stream inside renderEvent(), where a thinking delta and a tool_use are
   distinguishable, instead of on the DOM the events produced. Not worth it for
   the loop that was reported, which polls once per cycle with no thinking. */
const CYCLE_MIN = 3;

/* A sentence. Its other half, if it has one, is the next tool card. */
function openCycle(el, src) {
  state.cycle = { el, src };
}

/* The call arrived. Everything here is read from the DOM as it stands, which is
   what makes the adjacency test mean anything: whatever else landed between the
   two halves — a thought, a todo list, a second call, another turn — is sitting
   between them, and that ends the chain. */
function closeCycle(details, summary, id) {
  const open = state.cycle;
  state.cycle = null;
  const rep = state.repeat;
  if (!open || details.parentElement !== log
      || open.el.nextElementSibling !== details) {
    state.repeat = null;
    return;
  }
  const pair = { el: open.el, details, id };
  // The two halves are compared as two FIELDS, never joined into one key:
  // any separator is a character one of them could legitimately contain.
  // And consecutive means consecutive — the run so far has to end exactly
  // where this pair starts, or something the reader saw in between is
  // being skipped over.
  if (!rep || rep.src !== open.src || rep.summary !== summary
      || rep.pairs.at(-1).details.nextElementSibling !== open.el) {
    state.repeat = { src: open.src, summary, count: 1, pairs: [pair] };
    return;
  }
  rep.count += 1;
  rep.pairs.push(pair);
  // `count`, not `pairs.length`: after the first fold there is one pair left on
  // screen and the threshold would never be reached again.
  if (rep.count < CYCLE_MIN) return;   // still on screen; still might be a retry

  /* THE NEWEST PAIR SURVIVES, not the first. Two reasons, and the second is a
     data-loss bug rather than a preference:
     - what a reader wants out of a folded polling loop is the LAST poll — the
       one that finally said something — so that is the output the row opens to;
     - the surviving pair's `tool_result` has NOT arrived yet, and it is routed
       by state.toolCards. Keeping the first pair instead left every later
       cycle's id mapped to a body that had just been detached, so each new
       result was appended into nothing: the folded row kept cycle 1's output
       and the loop's terminal output existed nowhere, live and in replay both.
     The ids of the pairs being dropped go with them — their bodies are gone and
     nothing may append to them again. */
  for (const old of rep.pairs.splice(0, rep.pairs.length - 1)) {
    old.el.remove();
    old.details.remove();
    state.toolCards.delete(old.id);
  }
  /* Nothing removed above can be the OPEN run's first card — the surviving
     pair's own sentence reset the run a moment ago — but the cost of being
     wrong is silent and total: toolHome() calls run.first.replaceWith(group) on
     a parentless node, which is a no-op, so the group never enters the log and
     every card of that run renders into a detached subtree. Cheaper to check
     than to reason about. */
  if (state.run && !state.run.group && state.run.first
      && !log.contains(state.run.first)) {
    state.run = null;
  }
  // Persian digits: this is prose chrome, not a technical value (spec rule 5).
  // Built fresh on the surviving row — the previous badge left with its card.
  details.querySelector(":scope > summary")
    ?.append(label(FA.cycleRepeat.replace("{n}", faNum(rep.count)), "tool-repeat"));
}

/* A tool_result whose card is gone: a replay that lost the tool_use, another
   tab's id, a cycle the fold above dropped. It belongs in the log itself — but
   it has to arrive there through append(), which is the ONE seam that asks
   toolHome() where a node goes. A bare `log.append()` skips that, so an open
   run group survives the orphan output and the next tool card lands INSIDE the
   group — rendered visually before output that actually came first. Transcript
   order inverted, and only on the truncated transcripts this fallback exists
   for, which is the last place anyone would look. */
function intoCard(body, el) {
  if (body) body.append(el);
  else append(el);
  return el;
}

export function bubble(kind, text) {
  const el = document.createElement("div");
  el.className = "msg " + kind;
  el.setAttribute("dir", "auto");
  if (text !== undefined) el.textContent = text;
  return append(el);
}

function card(kind, summaryNodes, { open = false, tool = "" } = {}) {
  const details = document.createElement("details");
  details.className = "card " + kind;
  details.open = open;
  // Read by toolHome() below, so it has to be set before append() runs.
  if (tool) details.dataset.tool = tool;

  const summary = document.createElement("summary");
  summary.append(...summaryNodes);
  details.append(summary);

  const body = document.createElement("div");
  body.className = "card-body";
  details.append(body);

  append(details);
  return { details, body };
}

export function label(text, cls) {
  const span = document.createElement("span");
  if (cls) span.className = cls;
  span.textContent = text;
  return span;
}

function block(cls, text) {
  const el = document.createElement("div");
  el.className = cls;
  el.textContent = text;
  return el;
}

/* --- renderer state ------------------------------------------------------- */

export const state = {
  streamBubble: null,    // assistant bubble currently receiving text deltas
  streamText: "",        // raw markdown accumulated during streaming
  thinkingBody: null,
  thinkingPeek: null,    // the collapsed row's one-line preview of that thought
  pulse: null,           // the live "still working" line for the turn in flight
  // Turns in flight, mirroring the server's own count (server.py _inflight):
  // the CLI queues mid-turn sends and answers each with its OWN result event,
  // so "the batch is done" is count==0, not "a result arrived". Settling the
  // pulse on every result left the queued turns running with no status line
  // and no stop button — the CLI shows ONE status for the whole queue.
  inflight: 0,
  toolCards: new Map(),  // tool_use_id -> body element
  run: null,             // the consecutive-tool-call group being filled
  cycle: null,           // the [sentence][call] pair being assembled
  repeat: null,          // the run of identical pairs being counted
  status: {},
  // True only while rendering a conversation the user is NOT looking at (a
  // background tab, app.js). Everything below toChrome() reads it.
  background: false,
  // Where a background tab's chrome-shaped facts wait for their turn: posture,
  // effort, model, busy… app.js drains this when the tab is switched to.
  chrome: {},
};

/* THE WINDOW BELONGS TO ONE CONVERSATION AT A TIME.
   The transcript is per tab (see withRenderTarget below) but the statusline,
   the chips, the pill and the busy flag are single elements shared by all of
   them — so a background tab's event must not touch them, or six sessions
   repaint one window and the user reads another conversation's model, cost and
   permission level. The value is parked in that tab's own scope instead and
   applied when the user switches to it (app.js applyChrome()).

   Last-write-wins per key is the whole storage model, and it is enough because
   every one of these is a scalar the CLI re-announces: nothing accumulates
   except the auto-approval list, which says so at its own call site. */
function toChrome(key, value, apply) {
  if (state.background) state.chrome[key] = value;
  else apply(value);
}

/* keepPulse: a boundary INSIDE a queued batch (turn 2 of 3 starting) clears the
   stream state like any turn boundary, but the one status line spans the whole
   batch and must survive it. */
export function resetTurn(keepPulse = false) {
  // Both halves of ending a stream, always together: without endStreamPaint the
  // bubble keeps `.streaming` (so its unicode-bidi stays `isolate` instead of
  // settling) and keeps its queued paint, which lands one more frame later.
  // Every teardown that is NOT an assistant close comes through here — a
  // stopped turn, idle_sync, a dead CLI — so pairing it here pairs all of them.
  endStreamPaint(state.streamBubble);
  state.streamBubble = null;
  state.streamText = "";
  state.thinkingBody = null;
  state.thinkingPeek = null;
  state.run = null;
  // A turn boundary is not the middle of a polling loop. `repeat` goes too: it
  // holds DOM nodes, and a chain surviving into the next session is this
  // project's oldest defect family.
  state.cycle = null;
  state.repeat = null;
  if (!keepPulse) clearPulse();
}

/* --- the turn's pulse -------------------------------------------------------

   "Is it still working?" had exactly one answer in this window: the stop button
   appeared. Four minutes of a subagent reading files looked identical to a
   hung process. The CLI answers it with one live line — a turning glyph, a word
   for what it is doing, how long it has been at it, how much it has written —
   and this is that line.

   It is a transcript ENTRY, not chrome. While the turn runs `order: 1` pins it
   last (a flex reorder, so nothing appended after it can race it and no DOM
   move is needed); when the turn ends the class comes off and it settles where
   it was appended, as that turn's own record — «بافتن — ۵ دقیقه و ۳۲ ثانیه»
   stays in the history the way the CLI's closing line does.

   The verb is drawn once per turn, not re-drawn on a timer. The CLI rotates it;
   here the glyph carries the motion and a sentence that rewrites itself every
   few seconds is the opposite of what this window is for. */
const PULSE_GLYPHS = ["✻", "✽", "✢", "·", "✢", "✽"];

const STILL = matchMedia("(prefers-reduced-motion: reduce)");

function faNum(n) {
  return n.toLocaleString("fa-IR");
}

/* «۳۲ ثانیه» / «۵ دقیقه و ۳۲ ثانیه». The existing elapsed strings round a turn
   to whole minutes, which is the one thing this line must not do — a counter
   that sits on «۵ دقیقه» for sixty seconds reads as frozen. */
function fmtDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return FA.elapsedSeconds.replace("{n}", faNum(s));
  return FA.elapsedMinSec.replace("{m}", faNum(Math.floor(s / 60)))
                         .replace("{s}", faNum(s % 60));
}

function fmtTokens(n) {
  const value = n < 1000 ? faNum(n)
    : FA.thousands.replace("{n}", faNum(Math.round(n / 100) / 10));
  return FA.pulseTokens.replace("{n}", value);
}

function paintPulse(p) {
  // Under reduced motion the glyph holds still; the counters below are
  // information, not animation, so they keep ticking.
  if (!STILL.matches) p.glyph.textContent = PULSE_GLYPHS[p.frame++ % PULSE_GLYPHS.length];
  const parts = [fmtDuration(Date.now() - p.started)];
  const tokens = p.base + p.live;
  if (tokens) parts.push(fmtTokens(tokens));
  p.meta.textContent = parts.join(" · ");
}

/* Defaults to the scope currently being rendered into. The argument exists for
   ONE caller: app.js dropping a tab, whose 500 ms interval lives in that tab's
   scope and would otherwise keep painting a detached node for the life of the
   window — the tab is not the one on screen, so `state` is not its scope and
   resetTurn() cannot reach it. */
export function clearPulse(scope = state) {
  const pulse = scope.pulse;
  if (!pulse) return;
  clearInterval(pulse.timer);
  // A pulse only reaches here still wearing "live" when something is
  // abandoning it without settling it first — a `reset`, a dead CLI, or a
  // resetTurn() that did not ask to keep it. settlePulse() always strips the
  // class before calling this, so a settled pulse (the turn's permanent
  // closing line) is never touched here — only the orphaned node is removed.
  if (pulse.el.classList.contains("live")) pulse.el.remove();
  scope.pulse = null;
}

/* The verb is decorative while the turn runs, but it stays on as that turn's
   permanent closing line — and a refresh REPLAYS the hub's history, which runs
   startPulse() again for every turn in it. Math.random() there re-rolled the
   word on every reload, so a finished turn wore a different verb each time the
   window was reopened. Derived from the prompt instead: same turn, same verb,
   for as long as the transcript lives. */
function pickVerb(seed) {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return FA.pulseVerbs[h % FA.pulseVerbs.length];
}

function startPulse(seed) {
  clearPulse();
  const el = document.createElement("div");
  el.className = "pulse live";
  const glyph = label(PULSE_GLYPHS[0], "pulse-glyph");
  glyph.setAttribute("aria-hidden", "true");
  const verb = pickVerb(seed);
  const text = label(FA.pulseRunning.replace("{verb}", verb), "pulse-verb");
  // The counters abut Persian prose and are written in Persian digits, so they
  // are prose too — dir="auto" resolves them against their own content rather
  // than being forced LTR, which is the spec's first trap (rule 1).
  const meta = label("", "pulse-meta");
  meta.setAttribute("dir", "auto");
  el.append(glyph, text, meta);
  // A screen reader should hear the outcome, not sixty ticks of a stopwatch.
  el.setAttribute("aria-live", "off");
  append(el);
  const p = state.pulse =
    { el, glyph, text, meta, verb, started: Date.now(),
      base: 0, live: 0, cliMs: 0, frame: 0 };
  p.timer = setInterval(() => paintPulse(p), 500);
  paintPulse(p);
}

function settlePulse() {
  const p = state.pulse;
  if (!p) return;
  // Before the rewrite and the move below, for the reason append() reads first:
  // the closing line is longer than the running one and dropping `live` changes
  // where it sits, so a read taken afterwards answers about a box that no
  // longer exists.
  const wasAtBottom = atBottom();
  p.glyph.textContent = PULSE_GLYPHS[0];
  // Our wall clock is what the live line counted; `cliMs` is the CLI's own
  // duration_ms, summed over the turn's results. Live, the wall clock is always
  // the larger (it starts at the echo, before the CLI has the message), so the
  // settled line never jumps. In a replay the whole turn arrives in one burst
  // and the wall clock reads zero — which is the «۰ ثانیه» after a refresh.
  const elapsed = Math.max(Date.now() - p.started, p.cliMs);
  p.text.textContent = FA.pulseDone.replace("{verb}", p.verb)
                                   .replace("{time}", fmtDuration(elapsed));
  const tokens = p.base + p.live;
  p.meta.textContent = tokens ? fmtTokens(tokens) : "";
  // `order: 1` only made it LOOK last; in the DOM it is still sitting where the
  // turn began, ahead of everything the turn produced. Dropping the class
  // without this would snap the closing line back above its own turn.
  p.el.parentElement?.append(p.el);
  p.el.classList.remove("live");   // stops being "now", becomes this turn's record
  // clearPulse() runs only now, after the class is off: it removes an
  // abandoned "live" node from the DOM, and a settled pulse must not look
  // like one to it. JS runs this function to completion with no interleaving,
  // so moving the call here (rather than before the settle above) changes
  // nothing else — it only stops the interval and clears state.pulse.
  clearPulse();
  if (wasAtBottom) log.scrollTop = log.scrollHeight;
}

/* --- rendering somewhere other than the transcript --------------------------

   The agents drawer shows one background agent's own transcript, and plan §B-4
   forbids a second history path for it — it has to be THIS renderer. Everything
   here writes to exactly two module-level things: `log` and `state`. So the
   seam is to swap both for the length of a replay and give them back after.

   The caller owns the scope, which is the point: a drawer that polls keeps its
   own tool cards across chunks, and they can never collide with the main
   transcript's state.toolCards (a tool_use id is only unique within one
   transcript, and both sides are streaming).

   Concurrent tabs (app.js) reuse the same seam with `background: true` scopes:
   N buffered conversations rendering into detached nodes, one of them visible.

   The statusline is deliberately NOT swapped: /api/agent returns the same
   user+assistant filtered event shape /api/session does, so nothing a replay
   can carry reaches setStatus in the first place. */
export function newRenderScope(background = false) {
  return { streamBubble: null, streamText: "", thinkingBody: null,
           thinkingPeek: null, pulse: null, inflight: 0, toolCards: new Map(),
           run: null, cycle: null, repeat: null,
           status: {}, background, chrome: {} };
}

export function withRenderTarget(target, scope, fn) {
  const savedLog = log;
  const savedState = { ...state };
  log = target;
  Object.assign(state, scope);
  try {
    fn();
  } finally {
    Object.assign(scope, state);   // what the replay built stays with the scope
    log = savedLog;
    Object.assign(state, savedState);
  }
}

/* One-line stroke icons, keyed by what the tool DOES rather than by its name,
   so an unlisted tool still lands on a sensible glyph. */
const ICON_PATHS = {
  edit: "M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z",
  read: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6",
  run: "M4 17l6-5-6-5M12 19h8",
  find: "M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16ZM21 21l-4.3-4.3",
  web: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3c2.5 2.5 2.5 15.5 0 18M12 3c-2.5 2.5-2.5 15.5 0 18",
  task: "M9 11l3 3L20 6M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  // The CLI's own ✻, as a stroke: thinking is a step on the same rail as the
  // calls around it, so it needs a glyph in the same gutter or the rail breaks.
  think: "M12 4v16M4.9 8l14.2 8M19.1 8L4.9 16",
};

const TOOL_ICONS = {
  Read: "read", Write: "edit", Edit: "edit", MultiEdit: "edit", NotebookEdit: "edit",
  Bash: "run", BashOutput: "run", KillShell: "run",
  Glob: "find", Grep: "find",
  WebFetch: "web", WebSearch: "web",
  Task: "task", Skill: "task", AskUserQuestion: "task", ExitPlanMode: "task",
  Agent: "task",
};

function icon(kind) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "tool-icon");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", ICON_PATHS[kind] ?? ICON_PATHS.run);
  svg.append(path);
  return svg;
}

/* A tool row names the file, not the path to it — `MainActivity.kt`, not forty
   characters of `D:\…`. The full value is one click away in the params below
   and in the tooltip, which is where someone who needs it will look. A command
   keeps its head instead: `git status` identifies the call, `git` does not. */
function targetText(hint) {
  const value = String(hint);
  if (!/[\\/]/.test(value)) return value.slice(0, 60);
  if (/\s/.test(value)) return value.slice(0, 60);   // a command line, not a path
  return value.split(/[\\/]/).filter(Boolean).pop() || value;
}

/* An MCP tool arrives as `mcp__<server>__<tool>` and will never have a verb:
   the server set is per-machine, so strings.fa.js cannot enumerate it. Split
   the identifier instead of dumping all forty characters into the rail — the
   tool names the action, the server says where it came from. Fallback only. */
function mcpName(name) {
  const m = /^mcp__(.+?)__(.+)$/.exec(name);
  return m && { server: m[1], tool: m[2] };
}

/* Subagents, from `initialize.agents` — [{name, description, model?}]. Like the
   MCP servers the set is per-machine (project agents, plugins), so it can never
   live in strings.fa.js. There is no control subtype that PICKS one — the model
   dispatches them itself — so this is a label, not a picker: it lets a Task row
   say which agent ran instead of only «کار فرعی». */
const agents = new Map();   // name -> description

export function setAgents(list) {
  agents.clear();
  for (const agent of Array.isArray(list) ? list : []) {
    if (agent?.name) agents.set(agent.name, agent.description || "");
  }
}

function toolSummary(name, toolInput) {
  /* `Agent` dispatches a background helper, and its NAME says nothing — five
     helpers would be five identical «Agent» rows. What tells them apart is the
     one line the model wrote about the work (input.description); the subagent
     type, or the model it runs on, is where it came from — the same split as
     the MCP row below. */
  if (name === "Agent") {
    const nodes = [icon("task")];
    // The model usually writes it in English, and it is sitting in an RTL row:
    // isolate it (spec rule 2). <bdi dir="auto"> rather than a forced LTR,
    // because the same field in Persian must still read right-to-left.
    const desc = document.createElement("bdi");
    desc.className = "tool-name";
    desc.setAttribute("dir", "auto");
    desc.textContent = toolInput?.description || FA.toolVerbs.Agent;
    nodes.push(desc);
    const origin = toolInput?.subagent_type || toolInput?.model;
    if (origin) {
      const chip = pathEl(String(origin));
      chip.classList.add("tool-server");
      chip.title = agents.get(origin) || String(origin);
      nodes.push(chip);
    }
    return nodes;
  }
  const verb = FA.toolVerbs?.[name];
  const mcp = verb ? null : mcpName(name);
  const nodes = [icon(TOOL_ICONS[name]),
                 label(mcp ? mcp.tool : (verb ?? name),
                       verb ? "tool-verb" : "tool-name")];
  if (mcp) {
    // Latin identifier in an RTL row: isolate it, same as any path (rule 2).
    const srv = pathEl(mcp.server);
    srv.classList.add("tool-server");
    nodes.push(srv);
  }
  // The one parameter that identifies the call, LTR-isolated. Task and Skill
  // name no file at all, so the agent or skill they dispatch is what tells the
  // rows apart — without it every subagent is the same «کار فرعی» line.
  const hint = toolInput?.file_path ?? toolInput?.path ?? toolInput?.command
            ?? toolInput?.pattern ?? toolInput?.url
            ?? toolInput?.subagent_type ?? toolInput?.skill;
  if (hint) {
    const target = pathEl(targetText(hint));
    target.classList.add("tool-target");
    // What an agent IS, when the CLI told us — otherwise the value itself.
    target.title = agents.get(hint) || String(hint);
    nodes.push(target);
  }
  // «+12 −3» on the collapsed row: the size of the change, without opening it.
  // Latin digits — this abuts a technical value (spec rule 5).
  const diff = diffOf(name, toolInput);
  if (diff && (diff.added || diff.removed)) {
    const stat = label("", "diff-stat");
    if (diff.added) stat.append(label("+" + diff.added, "d-add"));
    if (diff.removed) stat.append(label("−" + diff.removed, "d-del"));
    nodes.push(stat);
  }
  if (!hint && Array.isArray(toolInput?.questions)) {
    // A question has no path to name, so the row carries its header. NOT
    // through pathEl: the header is prose the model wrote and may be Persian,
    // and forcing it LTR is the spec's first trap.
    const heads = toolInput.questions.map((q) => q.header).filter(Boolean);
    if (heads.length) {
      const el = label(heads.join("، "), "tool-target");
      el.setAttribute("dir", "auto");
      nodes.push(el);
    }
  }
  return nodes;
}

/* Tool parameters, key by key. Used by BOTH the tool card and the permission
   dialog (chrome.js) so the user sees the same thing when a call is announced
   and when they are asked to approve it — spec rule 8.

   Not JSON.stringify: it escapes every backslash, so a Windows path arrives as
   C:\\Users\\... and Persian content arrives as \u06cc\u0627. The person
   approving this is non-technical and must see the real text they are trusting. */
export function renderParamRows(toolInput) {
  const frag = document.createDocumentFragment();
  for (const [key, value] of Object.entries(toolInput ?? {})) {
    const row = document.createElement("div");
    row.className = "param-row";
    row.append(label(key, "param-key"));
    const box = document.createElement("div");
    box.className = "tool-output";   // LTR container; linesAuto restores per-line direction
    box.append(linesAuto(typeof value === "string"
      ? value
      : JSON.stringify(value, null, 2)));
    row.append(box);
    frag.append(row);
  }
  return frag;
}

/* --- diffs -----------------------------------------------------------------

   An Edit carries old_string/new_string, a Write carries content. Rendering
   those as two param blobs makes the reader diff them by eye, which is exactly
   the job a computer should do — and the person doing it here is the one being
   asked to APPROVE the change.

   The line numbers count within the hunk, not within the file: an Edit's
   old_string is a fragment and the CLI never says where it sits. Numbering it
   from the file's start would be a confident lie.

   `.diff` already exists in the spec's base CSS (LTR + isolate + monospace +
   its own scroll box) — this fills it rather than inventing a container. */

const DIFF_MAX_ROWS = 400;      // beyond this the box is scrolled, not read
const DIFF_MAX_CELLS = 250000;  // the LCS table is O(n·m); a big Write skips it

/* Which input keys the diff already speaks for, so they are not ALSO printed
   underneath it as raw parameters. */
const DIFF_KEYS = {
  Write: ["content"],
  Edit: ["old_string", "new_string"],
  MultiEdit: ["edits"],
};

function lineDiff(beforeText, afterText) {
  const a = beforeText ? beforeText.split("\n") : [];
  const b = afterText ? afterText.split("\n") : [];
  if (!a.length || !b.length || a.length * b.length > DIFF_MAX_CELLS) {
    // Nothing to align — one side is empty (a Write) or the pair is big enough
    // that the table costs more than the alignment is worth.
    return [...a.map((text) => ({ type: "del", text })),
            ...b.map((text) => ({ type: "add", text }))];
  }

  // Standard LCS length table, filled from the end so the walk below is
  // forward — which keeps the output in file order without a reverse.
  const n = a.length, m = b.length, w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[i] === b[j]
        ? dp[(i + 1) * w + j + 1] + 1
        : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }

  const rows = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) rows.push({ type: "same", text: a[i++] }), j++;
    else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) rows.push({ type: "del", text: a[i++] });
    else rows.push({ type: "add", text: b[j++] });
  }
  while (i < n) rows.push({ type: "del", text: a[i++] });
  while (j < m) rows.push({ type: "add", text: b[j++] });
  return rows;
}

/* The before/after pairs a tool call implies, or null when it implies none.
   Unlisted tools fall through to plain parameters — never guess a shape. */
function diffPairs(name, input) {
  if (!input) return null;
  if (name === "Write" && typeof input.content === "string") {
    return [{ before: "", after: input.content }];
  }
  if (name === "Edit"
      && typeof input.old_string === "string" && typeof input.new_string === "string") {
    return [{ before: input.old_string, after: input.new_string }];
  }
  if (name === "MultiEdit" && Array.isArray(input.edits)) {
    return input.edits
      .filter((e) => typeof e?.old_string === "string")
      .map((e) => ({ before: e.old_string, after: e.new_string ?? "" }));
  }
  return null;
}

export function diffOf(name, input) {
  const pairs = diffPairs(name, input);
  if (!pairs?.length) return null;
  const rows = [];
  for (const pair of pairs) {
    if (rows.length) rows.push({ type: "gap" });
    rows.push(...lineDiff(pair.before, pair.after));
  }
  return {
    rows,
    added: rows.filter((r) => r.type === "add").length,
    removed: rows.filter((r) => r.type === "del").length,
  };
}

function renderDiff(diff) {
  const box = document.createElement("div");
  box.className = "diff";
  let oldNo = 0, newNo = 0;
  for (const row of diff.rows.slice(0, DIFF_MAX_ROWS)) {
    const line = document.createElement("div");
    line.className = "dl " + row.type;
    if (row.type === "gap") { box.append(line); continue; }
    if (row.type !== "add") oldNo++;
    if (row.type !== "del") newNo++;
    line.append(label(row.type === "add" ? "" : String(oldNo), "dn"),
                label(row.type === "del" ? "" : String(newNo), "dn"),
                label(row.type === "add" ? "+" : row.type === "del" ? "−" : " ", "dm"));
    // Per LINE, not per box: an Edit whose content is Persian must read
    // right-to-left inside an LTR diff (spec rule 8, same as tool output).
    const text = label(row.text, "dt");
    text.setAttribute("dir", "auto");
    line.append(text);
    box.append(line);
  }
  if (diff.rows.length > DIFF_MAX_ROWS) {
    box.append(label(FA.diffTruncated.replace("{n}", diff.rows.length - DIFF_MAX_ROWS),
                     "dl meta"));
  }
  return box;
}

/* What a tool call shows once opened, and in the permission dialog. ONE
   function for both so the thing being approved is the thing being shown —
   the two used to differ, and the dialog's version was the worse one. */
export function renderToolDetail(name, toolInput) {
  const frag = document.createDocumentFragment();
  // The plan is the whole point of plan mode: it is what the person is being
  // asked to consent to, and it is written as markdown for a human to read.
  // Through renderParamRows it would arrive as a monospace `plan:` blob in an
  // LTR box — technically correct and nobody reads it.
  if (name === "ExitPlanMode" && typeof toolInput?.plan === "string") {
    const wrap = document.createElement("div");
    wrap.className = "msg assistant plan-body";
    wrap.append(renderMarkdown(toolInput.plan));
    frag.append(wrap);
    return frag;
  }
  const diff = diffOf(name, toolInput);
  if (diff) {
    frag.append(renderDiff(diff));
    const rest = { ...toolInput };
    for (const key of DIFF_KEYS[name] ?? []) delete rest[key];
    frag.append(renderParamRows(rest));
  } else {
    frag.append(renderParamRows(toolInput));
  }
  return frag;
}

/* AskUserQuestion, in the transcript. The dialog (chrome.js) is what the user
   ANSWERS; this is the record of it, and in history replay it is the only thing
   there is — so it has to read as a question rather than as a JSON dump.
   Both halves live here because both are fed by the one renderer. */
/* --- AskUserQuestion prose: ONE implementation, two chromes -----------------

   The tool is rendered twice — as the dialog the user answers in (chrome.js
   renderQuestions) and as the card the transcript keeps (renderQuestionBody
   below) — and every word of it is markdown the model wrote. The two differ in
   chrome (a fieldset with radio inputs, versus a list) and must not differ in
   anything else, because they already did: when the dialog's question and
   legend were moved onto the inline pipeline, the transcript's header stayed
   raw textContent, so the same header read scrambled in one of the two places
   and nothing said so. The callers own their elements; these own what goes in.

   Two functions and not one, because they are two different operations: a
   header or a question MEASURES ITSELF, while an option row measures its
   CONTAINER after both of its parts are in. */

/* Header and question. Inline markdown first — as textContent an inline `code`
   span keeps its backticks and its neutral characters reorder against the
   Persian around them — then the block measures its own direction, because
   these open with a Latin technical term often enough that first-strong alone
   flips them. */
export function questionProse(el, markdown) {
  return autoDir(fillInline(el, markdown));
}

/* One option, into a container the caller made. The label is a <bdi>, not a
   span: "Sparkling water" would otherwise decide dir="auto" for the whole row
   and drag its Persian description left with it. dir="auto" skips descendants
   carrying their own direction, so isolating the label hands the decision to
   the prose (spec rule 2) — which is why the container is measured AFTER both
   parts are in, never before. A label with no description inherits the shell. */
export function questionOption(stack, option, labelCls, descCls) {
  const name = document.createElement("bdi");
  name.className = labelCls;
  fillInline(name, option.label);
  stack.append(name);
  if (option.description) {
    stack.append(fillInline(label("", descCls), option.description));
  }
  return autoDir(stack);
}

export function renderQuestionBody(questions) {
  const frag = document.createDocumentFragment();
  for (const q of questions ?? []) {
    const wrap = document.createElement("div");
    wrap.className = "q-block";
    if (q.header) wrap.append(questionProse(label("", "q-header"), q.header));
    const text = document.createElement("p");
    text.className = "q-text";
    wrap.append(questionProse(text, q.question));
    const ul = document.createElement("ul");
    ul.className = "q-options";
    for (const option of q.options ?? []) {
      ul.append(questionOption(document.createElement("li"), option,
                               "q-label", "q-desc"));
    }
    if (ul.children.length) wrap.append(ul);
    frag.append(wrap);
  }
  return frag;
}

/* The answer, keyed by question text exactly as the CLI stores it. An empty
   `answers` is the skip case and says so rather than rendering nothing — a
   blank card would read as a bug. */
function renderAnswers(questions, answers) {
  const frag = document.createDocumentFragment();
  const asked = (questions ?? []).length ? questions : Object.keys(answers).map(
    (question) => ({ question }));
  for (const q of asked) {
    const value = answers[q.question];
    const row = document.createElement("div");
    row.className = "q-answer";
    row.setAttribute("dir", "auto");
    row.append(label((q.header || q.question || "") + ":", "q-header"));
    row.append(label(
      Array.isArray(value) ? value.join("، ") : (value || FA.askNoAnswer),
      "q-picked"));
    frag.append(row);
  }
  if (!frag.childNodes.length) frag.append(label(FA.askSkipped, "meta"));
  return frag;
}

/* --- a background agent reporting back ------------------------------------- */

/* The block is XML-escaped by the CLI, so unescape after extracting — and `&`
   LAST, or a literal "&amp;lt;" in the agent's own output turns into "<". */
function xmlText(source, tag) {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(source);
  return match
    ? match[1].trim()
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    : "";
}

/* What the user actually wants to know: that the helper finished, which one,
   and what it came back with. The task-id, tool-use-id, output-file and note
   are plumbing — the CLI writes them for itself. */
function renderTaskNote(text) {
  const summary = xmlText(text, "summary");
  const result = xmlText(text, "result");
  const nodes = [icon("task"),
                 label(xmlText(text, "status") === "completed"
                       ? FA.agentDone : FA.agentEnded, "tool-verb")];
  if (summary) {
    // The CLI writes the summary in English: isolate it rather than letting it
    // flip the Persian row around it (spec rule 2).
    const el = document.createElement("bdi");
    el.className = "tool-target";
    el.setAttribute("dir", "auto");
    el.textContent = summary;
    nodes.push(el);
  }
  if (!result) {
    // A backgrounded shell command notifies the same way and has no transcript
    // and no result — the line IS the event, and a card that opens onto
    // nothing is worse than no card.
    const row = document.createElement("div");
    row.className = "msg assistant meta agent-note";
    row.append(...nodes);
    append(row);
    return;
  }
  // Not a `.tool` card: it is a report, not a step, so it never joins a run of
  // tool calls. The body is the agent's final text, written as markdown for a
  // human — through renderMarkdown like every other message (spec rules 1-2).
  const { body } = card("agent-note", nodes);
  const wrap = document.createElement("div");
  wrap.className = "msg assistant";
  wrap.append(renderMarkdown(result));
  body.append(wrap);
}

function renderTodos(items) {
  const { body } = card("todos", [label(FA.todos, "tool-name")], { open: true });
  const ul = document.createElement("ul");
  for (const item of items ?? []) {
    const li = document.createElement("li");
    li.dataset.status = item.status ?? "pending";
    li.setAttribute("dir", "auto");
    const mark = item.status === "completed" ? "✓"
               : item.status === "in_progress" ? "▸" : "○";
    li.append(label(mark, "meta"), document.createTextNode(item.content ?? ""));
    ul.append(li);
  }
  body.append(ul);
}

function renderRaw(event) {
  const { body } = card("raw", [label(FA.rawEvent, "tool-name"),
                                label(event.type ?? "?", "meta")]);
  body.append(block("tool-output", JSON.stringify(event, null, 2)));
}

/* --- statusline ----------------------------------------------------------- */

/* A percentage the user has to act on (context left, quota burned) reads far
   faster as a bar than as digits. <progress> is the native element for it:
   it carries the value accessibly and needs no JS to stay in sync. */
function meter(pct) {
  const wrap = document.createElement("span");
  wrap.className = "sl-meter";
  const bar = document.createElement("progress");
  bar.max = 100;
  bar.value = Math.max(0, Math.min(100, pct));
  bar.dataset.level = pct >= 90 ? "high" : pct >= 70 ? "warn" : "ok";
  wrap.append(bar, label(Math.round(pct) + "%", "mono"));
  return wrap;
}

/* Everything in the statusline except the folder belongs to ONE conversation:
   the session id, what it cost, how full its context is, and the machine's own
   statusLine output. Carrying them into the next session is a lie that looks
   like data — a fresh chat showing the previous one's cost. Called from the
   `reset` event, which is the single place a session is swapped (project
   switch, new chat and resume all restart the CLI through it). */
export function resetStatus() {
  state.status = { cwd: state.status.cwd };
  setStatus({});
  // The «context is filling up» notice is the same number in another shape. A
  // new session starts empty, so it has to go with the meter that raised it.
  toChrome("context", 0, noteContext);
}

export function setStatus(patch) {
  Object.assign(state.status, patch);
  // One number, two readers: the meter below and the notice above the composer.
  // Driving the notice from here means every source of a context figure (the
  // CLI's own get_context_usage, and the `result` fallback) feeds it for free.
  if (typeof patch.context === "number") toChrome("context", patch.context, noteContext);
  // state.status IS the tab's own statusline data (the scope carries it), so a
  // background tab has already recorded everything above; only the paint is
  // shared, and app.js repaints from the scope at switch time.
  if (state.background) return;
  statusline.replaceChildren();
  const s = state.status;

  const items = [
    [FA.slModel, s.model && label(s.model, "mono")],
    [FA.slFolder, s.cwd && pathEl(s.cwd)],
    [FA.slMode, s.mode && label(s.mode, "mono")],
    [FA.slContext, s.context !== undefined && meter(s.context)],
    [FA.slCost, s.cost !== undefined && label("$" + s.cost.toFixed(4), "mono")],
    [FA.slQuota, s.quota !== undefined && meter(s.quota)],
    [FA.slSession, s.sessionId && label(s.sessionId.slice(0, 8), "mono")],
  ];

  for (const [name, valueEl] of items) {
    if (!valueEl) continue;
    const wrap = document.createElement("span");
    wrap.className = "sl-item";
    wrap.append(label(name + ":", "sl-label"), valueEl);
    statusline.append(wrap);
  }

  // The machine's own statusLine command output, inherited rather than
  // reimplemented (plan §B-7). It is terminal text: keep it LTR-isolated, and
  // keep its colours — the script uses them to mean something (which mode is
  // on, how full the context is). server.py parsed the SGR codes into runs;
  // building spans from data is also why none of this can inject markup.
  if (s.custom?.length) {
    const bdi = pathEl("");
    bdi.classList.add("sl-custom");
    for (const seg of s.custom) {
      const span = document.createElement("span");
      span.textContent = seg.text;
      if (seg.fg) span.style.color = seg.fg;
      if (seg.bg) span.style.background = seg.bg;
      if (seg.bold) span.style.fontWeight = "600";
      if (seg.dim) span.style.opacity = ".65";
      if (seg.italic) span.style.fontStyle = "italic";
      bdi.append(span);
    }
    statusline.append(bdi);
  }
}

/* --- the renderer --------------------------------------------------------- */

const HANDLED = new Set([
  "system", "assistant", "user", "result", "stream_event",
  "rate_limit_event", "wrapper", "raw",
]);

export function renderEvent(ev) {
  switch (ev.type) {
    case "system":
      if (ev.subtype === "init") {
        setStatus({
          model: ev.model,
          cwd: ev.cwd,
          mode: ev.permissionMode,
          sessionId: ev.session_id,
        });
        // The sidebar highlight and the topbar name follow the VISIBLE
        // conversation. A background tab's own cwd and session id are in its
        // scope's status above, which is what app.js repaints from at switch.
        if (!state.background) {
          setCurrentSession(ev.session_id);
          setChrome(ev.cwd);
          refreshProjects();
          // session_id is genuinely known only from here — agents.js's own
          // reset (below, wrapper/reset) fires this too early: it runs right
          // after resetStatus() clears state.status.sessionId, and the server
          // hard-requires `id` on /api/agents, so that refresh was provably
          // always a 400. A resumed session may already have helpers out; this
          // is what picks them up.
          refreshAgents();
        }
        // The CLI is authoritative about what commands exist on this machine
        // (custom skills, plugins) — never scan skill directories ourselves.
        if (Array.isArray(ev.slash_commands)) {
          toChrome("slash", ev.slash_commands, setSlashCommands);
        }
        // The model this turn actually ran on: the only real confirmation that
        // a set_model took effect (its own ack is empty).
        toChrome("model", ev.model, setModelResolved);
        // Same class of evidence for the output style: this is the CLI naming
        // what the turn ran under, not us reading back our own write.
        toChrome("outputStyle", ev.output_style, setOutputStyle);
      } else if (ev.subtype === "status" && ev.permissionMode) {
        // The CLI's echo of a permission-mode change. The statusline shows the
        // raw mode; the pill has its own wrapper-level event.
        setStatus({ mode: ev.permissionMode });
      }
      // hook_started / hook_response are noise for the user.
      return;

    case "stream_event": {
      const inner = ev.event;
      // The API's own running total for the message being written — the only
      // LIVE token source there is. The `assistant` event below carries the
      // settled figure, and neither alone is right: this one resets to zero at
      // every message boundary, that one arrives only after the message ends.
      if (inner?.type === "message_delta") {
        if (state.pulse && typeof inner.usage?.output_tokens === "number") {
          state.pulse.live = inner.usage.output_tokens;
        }
        return;
      }
      if (inner?.type !== "content_block_delta") return;
      const delta = inner.delta ?? {};
      if (typeof delta.text === "string") {
        // Stream as plain text; markdown is rendered once the message closes,
        // so half-written fences never reach marked.
        if (!state.streamBubble) {
          state.streamBubble = bubble("assistant", "");
          // Plain text under `.msg`'s unicode-bidi:plaintext ignores `dir`;
          // the class is what lets the measured direction apply while the
          // bubble is still text. endStreamPaint() takes it off again.
          state.streamBubble.classList.add("streaming");
        }
        state.streamText += delta.text;
        // The paint, the direction and the stick all happen once on the next
        // frame — see queueStreamText().
        queueStreamText(state.streamBubble, log, state.streamText);
      } else if (typeof delta.thinking === "string") {
        if (!state.thinkingBody) {
          state.thinkingPeek = label("", "tool-target");
          // The thought is the model's own prose — usually English, sometimes
          // not. Never pathEl(): forcing LTR on prose is the spec's first trap.
          state.thinkingPeek.setAttribute("dir", "auto");
          state.thinkingBody = card("thinking",
            [icon("think"), label(FA.thinking, "tool-verb"),
             state.thinkingPeek]).body;
          state.thinkingBody.setAttribute("dir", "auto");
        }
        state.thinkingBody.textContent += delta.thinking;
        // Shut, the row used to carry nothing but the word «فکر» — the same
        // label on every one of them. Its opening clause says what THIS thought
        // is about, which is the only thing that tells two of them apart.
        state.thinkingPeek.textContent =
          state.thinkingBody.textContent.replace(/\s+/g, " ").trim().slice(0, 100);
      }
      return;
    }

    case "assistant": {
      for (const part of ev.message?.content ?? []) {
        if (part.type === "text") {
          const rendered = renderMarkdown(part.text ?? "");
          let settled;
          if (state.streamBubble) {
            // Read BEFORE the swap, like append() does: plain text becoming
            // rendered markdown (headings, code blocks, a table) can change
            // this bubble's height by hundreds of pixels, and a stick decided
            // after that measures the wrong box.
            const wasAtBottom = atBottom();
            // Before replaceChildren, always: a queued plain-text paint landing
            // after it would wipe the finished answer back to its source.
            settled = state.streamBubble;
            endStreamPaint(settled);
            settled.replaceChildren(...rendered.childNodes);
            state.streamBubble = null;
            state.streamText = "";
            if (wasAtBottom) log.scrollTop = log.scrollHeight;
          } else {
            settled = bubble("assistant");
            settled.append(...rendered.childNodes);
          }
          // Both paths converge here on purpose: a sentence opens a cycle
          // whether it streamed in or arrived whole out of a replay, and it is
          // the SOURCE markdown — never the bubble's rendered text — that a
          // repeat is compared on.
          openCycle(settled, part.text ?? "");
        } else if (part.type === "tool_use") {
          if (part.name === "TodoWrite") {
            renderTodos(part.input?.todos);
          } else if (part.name === "AskUserQuestion"
                     && Array.isArray(part.input?.questions)) {
            // Open: a question the user is being asked must not start collapsed.
            const { body } = card("tool ask", toolSummary(part.name, part.input),
                                  { open: true });
            body.append(renderQuestionBody(part.input.questions));
            state.toolCards.set(part.id, body);
          } else {
            const { details, body } = card("tool", toolSummary(part.name, part.input),
                                           { tool: part.name });
            body.append(renderToolDetail(part.name, part.input));
            state.toolCards.set(part.id, body);
            // The call half of a [sentence][call] pair. Read off the summary
            // AFTER the body is filled and before any tool_progress elapsed
            // counter can land on it, so two cycles of one loop compare equal.
            // The id travels too: a folded cycle's card is detached, and its
            // state.toolCards entry has to go with it.
            closeCycle(details,
                       details.querySelector(":scope > summary")?.textContent ?? "",
                       part.id);
          }
        }
      }
      state.thinkingBody = null;
      state.thinkingPeek = null;
      // This message is closed, so its count is final: bank it and let the next
      // message's message_delta start from zero again. Falling back to the live
      // figure keeps the total honest on a build that sends no usage here.
      if (state.pulse) {
        state.pulse.base += ev.message?.usage?.output_tokens ?? state.pulse.live;
        state.pulse.live = 0;
      }
      return;
    }

    case "user": {
      // The CLI addresses itself through `user` messages too — an injected
      // skill body, a hook's output — and flags every one of them. Its own UI
      // never shows them, and neither does this one.
      //
      // TWO NAMES FOR ONE FLAG, and only the transcript uses `isMeta`. Read out
      // of the 2.1.223 bundle, every stream-json `user` event is built as
      // `isSynthetic: isMeta || isVisibleInTranscriptOnly || isCompactSummary`
      // and carries no isMeta key at all — so the live stream sailed straight
      // past this guard and a `/skill` invocation rendered the whole SKILL.md
      // as a user bubble the length of a document. Replay was fixed server-side
      // (read_session, bead pcg-e5q); this is the live half of the same defect.
      // `<task-notification>`, the one injected message that MUST render, sets
      // none of the three (measured across real transcripts).
      if (ev.isMeta || ev.isSynthetic) return;
      // Replay is always block-shaped: a transcript's bare-string prompt is
      // normalised (and envelope-filtered) by read_session before it gets
      // here — but that guarantee is replay-only. Whether a live
      // <task-notification> can ever arrive on stdout as a bare string is
      // unmeasured (wiki/background-agents.md); if it ever does, wrap it the
      // same way server.py's _normalize_transcript_event does so the loop
      // below iterates block parts, never the string's own characters.
      const content = typeof ev.message?.content === "string"
        ? [{ type: "text", text: ev.message.content }]
        : (ev.message?.content ?? []);
      for (const part of content) {
        // Replayed history carries the user's own turns here. Live it does not
        // (we do not pass --replay-user-messages), so the composer echoes them
        // via wrapper/user_echo instead — hence both paths exist.
        if (part.type === "text") {
          // A background agent's completion report, auto-submitted by the CLI
          // as if the user had typed it. It is news about the conversation,
          // not a turn in it.
          if (TASK_NOTE.test(part.text ?? "")) {
            renderTaskNote(part.text);
            if (!state.background) refreshAgents();
            continue;
          }
          // The CLI narrates an interrupt as a `user` turn whose text is
          // "[Request interrupted by user]" (or "...for tool use"). Rendered as
          // written it looks like the user typed an English sentence — and the
          // stop is already reported in Persian by result/aborted_streaming
          // below. Both sources carry it, so it is dropped here, at the one
          // renderer they share.
          if (INTERRUPT_NOTE.test(part.text ?? "")) continue;
          // A user turn materializing mid-batch (the CLI injecting a queued
          // message) is a boundary INSIDE the batch: the status line survives.
          resetTurn(state.inflight > 0);
          const el = bubble("user");
          el.append(...renderMarkdown(part.text ?? "").childNodes);
          continue;
        }
        if (part.type !== "tool_result") continue;
        const body = state.toolCards.get(part.tool_use_id);
        // AskUserQuestion's structured result rides on the EVENT, not the part:
        // {questions, answers}. Rendering `content` instead would show the
        // model-facing English sentence ("The user answered: …").
        const structured = ev.tool_use_result;
        if (structured && Array.isArray(structured.questions)
            && structured.answers && typeof structured.answers === "object") {
          intoCard(body, renderAnswers(structured.questions,
                                      structured.answers));
          continue;
        }
        // The launch ack for a background agent. Its text is the CLI talking to
        // itself — an agentId, a temp-file path, and a line telling the model
        // never to quote it — so the card says the one thing it means. Tested
        // against the extracted plain text, not the raw `content`: a real ack
        // is usually a block ARRAY (see toolResultText above), and matching
        // JSON.stringify(content) against an anchored ^-regex never fires.
        if (ASYNC_LAUNCH.test(toolResultText(part.content))) {
          intoCard(body, label(FA.agentLaunched, "meta"));
          if (!state.background) refreshAgents();
          continue;
        }
        const text = typeof part.content === "string"
          ? part.content
          : JSON.stringify(part.content, null, 2);
        // Tool output is often Persian (a file the model just read back, an
        // error message in Persian). The box stays LTR; the lines decide for
        // themselves — spec rule 8.
        const out = block("tool-output", "");
        out.append(linesAuto(text));
        if (part.is_error) out.style.color = "var(--danger)";
        // intoCard(), exactly like the two branches above — see its own note
        // for why the orphan case may not simply `log.append()`. An earlier
        // fallback here was `bubble("assistant").parentElement`, a way of
        // writing `log` that leaves an empty .msg.assistant in the transcript
        // first (bubble() APPENDS) and then hangs the output off its parent.
        intoCard(body, out);
      }
      return;
    }

    case "result": {
      const window_ = ev.modelUsage
        ? Object.values(ev.modelUsage)[0]?.contextWindow
        : undefined;
      const used = (ev.usage?.input_tokens ?? 0)
                 + (ev.usage?.cache_read_input_tokens ?? 0)
                 + (ev.usage?.cache_creation_input_tokens ?? 0);
      setStatus({
        cost: ev.total_cost_usd ?? 0,
        context: window_ ? Math.round((used / window_) * 100) : undefined,
      });
      // A user-pressed stop lands here as error_during_execution /
      // aborted_streaming (B-9.10). That is not a failure — do not alarm.
      if (ev.terminal_reason === "aborted_streaming") {
        bubble("assistant", FA.stopped).classList.add("meta");
      } else if (ev.is_error) {
        bubble("error", ev.result ?? String(ev.subtype ?? "error"));
        // The hard limit. The CLI's own wording for it, in English, in a turn
        // that produced nothing: "Context exceeds the N-token limit by M tokens
        // — run /compact or /clear to continue." No percentage arrives with it,
        // so the meter-driven warning above cannot catch this case.
        if (CONTEXT_EXHAUSTED.test(String(ev.result ?? ""))) {
          toChrome("contextFull", true, contextFull);
        }
      }
      // One result PER QUEUED MESSAGE, so this is a turn boundary, not
      // necessarily the batch's end. A stop cancels the queued turns too
      // (interrupt_cancel_queued_v1) and they never emit results of their own,
      // so an aborted result IS the end regardless of the count.
      // Per RESULT, not per settle: a queued batch produces several and the
      // pulse spans all of them, exactly as `base` accumulates their tokens.
      if (state.pulse && typeof ev.duration_ms === "number") {
        state.pulse.cliMs += ev.duration_ms;
      }
      state.inflight = ev.terminal_reason === "aborted_streaming"
        ? 0 : Math.max(0, state.inflight - 1);
      if (state.inflight === 0) {
        // Before resetTurn(), which clears the pulse rather than settling it: a
        // stopped turn earns the same closing line as a finished one.
        settlePulse();
        resetTurn();
        toChrome("busy", false, setBusy);
        // The CLI writes its own «※ recap: ...» when you come back to a turn
        // you were not there to watch. It cannot write it here -- that path is
        // remote-only (measured) -- so the window asks for it, on the same
        // condition and for the same reason: the line costs an API call, and
        // it is worth one only when nobody was reading. Failure is silence; a
        // recap that does not arrive is a missing nicety, not an error.
        // `token` is the guard that keeps the free gate free: spec-test.html
        // drives this renderer with no token at all, and a recap is the one
        // thing here that would reach a real CLI and spend a real turn.
        if (token && !state.background && !ev.is_error
            && ev.terminal_reason !== "aborted_streaming" && isAway()) {
          api("/api/recap", {}).catch(() => {});
        }
      } else {
        // Queued turns still to run: the status line and the stop button both
        // stay, exactly as the CLI keeps its one spinner over the whole queue.
        resetTurn(true);
      }
      if (!state.background) {
        refreshProjects();   // the turn changed this session's preview/mtime
        // The turn is over but the helpers it dispatched are not: this is where
        // «در انتظار N عامل پس‌زمینه…» appears. Debounced, so a replayed
        // transcript's hundred result events cost one request.
        refreshAgents();
      }
      return;
    }

    case "rate_limit_event":
      return;   // statusline-only; nothing user-facing yet

    case "tool_progress": {
      // A heartbeat the CLI sends while a tool runs long. As an unknown type it
      // fell through to renderRaw, so a slow Bash buried the transcript under
      // grey «رویداد ناشناخته» panels — one every 90 s, saying nothing.
      // The one useful field is the elapsed time, and it belongs on the card of
      // the tool actually running: the heartbeat's own id is synthetic
      // (`…-heartbeat-2`), so look up parent_tool_use_id.
      const seconds = ev.elapsed_time_seconds;
      const body = state.toolCards.get(ev.parent_tool_use_id ?? ev.tool_use_id);
      const summary = body?.parentElement?.querySelector("summary");
      if (!summary || typeof seconds !== "number") return;
      let el = summary.querySelector(".tool-elapsed");
      if (!el) {
        el = label("", "tool-elapsed");
        summary.append(el);
      }
      el.textContent = seconds < 60
        ? FA.elapsedSeconds.replace("{n}", Math.round(seconds))
        : FA.elapsedMinutes.replace("{n}", Math.round(seconds / 60));
      return;
    }

    case "wrapper":
      if (ev.subtype === "user_echo") {
        // Derive busy from the stream, not from our own submit handler: a turn
        // can also start from another window on the same server.
        toChrome("busy", true, setBusy);
        // A send while a turn runs is QUEUED by the CLI, which keeps its one
        // spinner running over the whole queue — so the pulse it started keeps
        // its verb, its clock and its token count instead of restarting. The
        // pulse check is the self-heal: a count that outlived its pulse must
        // start a fresh one, not leave the batch running with no status line.
        const queued = state.inflight > 0 && !!state.pulse;
        state.inflight += 1;
        resetTurn(queued);
        const el = bubble("user");
        el.append(...renderMarkdown(ev.text ?? "").childNodes);
        if (ev.images) el.append(label(`[${ev.images} image]`, "meta"));
        // After the bubble, so the line reads as an answer to what was just
        // asked. resetTurn() above has already cleared any stale one.
        if (!queued) startPulse(ev.text ?? "");
      } else if (ev.subtype === "stderr") {
        bubble("error", ev.line);
      } else if (ev.subtype === "permission_request") {
        // NEVER gated: one modal queue serves every open tab, and a background
        // conversation waiting on an answer is exactly the case the dialog has
        // to name (chrome.js reads ev.tab). Deferring it would leave that CLI
        // blocked until its timeout with nothing on screen.
        showPermission(ev);
      } else if (ev.subtype === "permission_resolved") {
        dismissPermission(ev.request_id);
        const card = state.toolCards.get(ev.tool_use_id);
        // A question was answered, not "allowed" — same event, different act.
        const note = label(
          ev.tool_name === "AskUserQuestion" ? FA.askAnswered
            : ev.decision === "allow" ? FA.permAllowed : FA.permDenied,
          "meta");
        if (card) card.append(note);
        // Approved by the wrapper rather than by the user — either the
        // «خودکار» posture or an earlier «دوباره نپرس». The count, and the
        // list behind it, are the audit trail that keeps both honest.
        if (ev.auto) {
          // The one thing here that accumulates rather than overwrites: the
          // audit list is the whole defence of «خودکار», so a background tab
          // keeps every entry instead of the last one.
          if (state.background) {
            (state.chrome.autoActions ??= []).push({ tool: ev.tool_name, why: ev.why });
            state.chrome.autoCount = ev.auto_count;
          } else {
            noteAutoAction(ev.tool_name, ev.why);
            setAutoCount(ev.auto_count);
          }
        }
      } else if (ev.subtype === "init_info") {
        // Everything the CLI can do, answered at spawn and free
        // (wiki/control-protocol.md §1). Richer than system/init.
        toChrome("initInfo", ev.info, applyInitInfo);
        if (Array.isArray(ev.info?.commands)) {
          toChrome("slash", ev.info.commands, setSlashCommands);
        }
        // ponytail: the subagent label map is module-global, so a background
        // tab's set waits its turn too — its Task rows fall back to the raw
        // agent name until the user looks at them. A per-tab map would be a
        // second registry for a tooltip.
        toChrome("agents", ev.info?.agents, setAgents);
      } else if (ev.subtype === "output_style") {
        // Published after a change only; the spawn value rode in on init_info.
        toChrome("outputStyle", ev.style, setOutputStyle);
      } else if (ev.subtype === "posture") {
        if (state.background) {
          state.chrome.posture = ev.posture;
          state.chrome.autoCount = ev.auto_count;
        } else {
          setPostureState(ev.posture, ev.auto_count);
        }
      } else if (ev.subtype === "effort") {
        // Read back out of get_settings, never taken from an ack.
        toChrome("effort", ev.effort, setEffortState);
      } else if (ev.subtype === "usage") {
        // Measured by the CLI itself (get_context_usage / get_usage) — it
        // replaces the estimate the `result` branch computes below. Only the
        // keys that actually arrived: a missing one must not erase a good value.
        const patch = {};
        for (const key of ["context", "cost", "quota"]) {
          if (typeof ev[key] === "number") patch[key] = ev[key];
        }
        setStatus(patch);
      } else if (ev.subtype === "statusline") {
        setStatus({ custom: ev.segments || (ev.text ? [{ text: ev.text }] : null) });
      } else if (ev.subtype === "resumed") {
        // A resumed session knows who it is before the CLI says a word: the id
        // and the folder come from the process we just spawned, not from state
        // the reset above deliberately cleared. The model is NOT here — only
        // system/init knows which one this session runs on.
        setStatus({ sessionId: ev.session_id, cwd: ev.cwd });
        // A fresh process: any queued turns died with the old one, and a
        // deliberate restart suppresses the stale reader's cli_exited (the
        // generation guard), so the count is zeroed here too.
        state.inflight = 0;
        // agentsUrl() sends the session id only when it is truthy, so the
        // refresh at reset time was always a 400 — this is the first moment a
        // resumed session's helpers can be listed.
        if (!state.background) refreshAgents();
      } else if (ev.subtype === "reset") {
        // Clearing is STRUCTURAL now — each tab owns its own node, and a new
        // chat is a new tab, so the server has no production publisher for
        // this any more (T4a). The path stays because the event is still part
        // of the protocol and the spec harness drives it: scoped to the tab it
        // names, it clears that conversation and nothing else.
        log.replaceChildren();
        resetTurn();
        resetStatus();
        state.inflight = 0;
        state.toolCards.clear();
        if (state.background) {
          // Everything parked for this tab described the session it just
          // dropped. `reset` tells app.js to restore the chips to their
          // defaults rather than to what it snapshotted.
          state.chrome = { reset: true };
        } else {
          resetControls();
          resetAgents();  // list, strip, both poll timers and any open drawer
          setBusy(false); // a reset means no turn is running, by definition
          refreshProjects();
        }
      } else if (ev.subtype === "recap") {
        // The CLI's own «※ recap: …», asked for by the window (POST /api/recap)
        // once the turn is over and the person is not watching. It is a
        // sentence, not chrome: it belongs in the transcript, after the closing
        // line of the turn it summarises, and it stays there.
        const el = document.createElement("div");
        el.className = "recap";
        const glyph = label("※", "recap-glyph");
        glyph.setAttribute("aria-hidden", "true");
        const body = label("", "recap-body");
        body.append(...renderMarkdown(ev.text ?? "").childNodes);
        el.append(glyph, body);
        append(el);
      } else if (ev.subtype === "idle_sync") {
        // The wrapper says this conversation has nothing in flight. It counts
        // turns on its own side (server.py _inflight) and is the only thing
        // that can see a turn which produced no `result` — an interrupt the CLI
        // answered with silence, a reader thread that died mid-batch. Without
        // it the count below never reaches 0 and the window works forever.
        //
        // Silent and idempotent: the pulse SETTLES rather than being cleared
        // (the turn did happen; its closing line is the record of it), and a
        // window that already settled hits three no-ops. Nothing is printed —
        // an aborted `result` arriving late still writes its own «متوقف شد».
        state.inflight = 0;
        settlePulse();
        resetTurn();
        toChrome("busy", false, setBusy);
      } else if (ev.subtype === "cli_exited") {
        bubble("error", FA.cliExited);
        // Every queued turn died with the process. The pulse is cleared, not
        // settled: nothing finished, and the error bubble above says why —
        // without this it keeps breathing forever next to «کلاد بسته شد».
        state.inflight = 0;
        clearPulse();
        toChrome("busy", false, setBusy);
      }
      return;

    case "raw":
      bubble("error", ev.line);
      return;

    default:
      // The stream format grows across CLI versions. Never crash on a type we
      // do not know — show it and move on.
      if (!HANDLED.has(ev.type)) renderRaw(ev);
  }
}
