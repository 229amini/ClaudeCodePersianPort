/* ============================================================================
   The renderer: stream events -> DOM.

   ONE RENDERER, TWO SOURCES (plan §B-4). renderEvent() is fed by the live SSE
   stream (app.js) and by replayed ~/.claude/projects/<cwd>/*.jsonl history
   (chrome.js). Do not fork a second history path.

   Anything that renders model or user text goes through renderMarkdown() so the
   two BiDi passes in bidi.js run on it.
   ========================================================================= */
"use strict";

import { renderMarkdown, pathEl, linesAuto } from "./bidi.js";
/* Cyclic on purpose: the renderer drives the sidebar, and the sidebar replays
   through the renderer. Only hoisted function declarations cross this edge, and
   only at event time — never while the modules are still evaluating. */
import {
  setChrome, refreshProjects, setCurrentSession,
  showPermission, dismissPermission,
} from "./chrome.js";
import { setBusy, setSlashCommands, noteContext, contextFull } from "./composer.js";
import {
  applyInitInfo, setModelResolved, setPostureState, setAutoCount, noteAutoAction,
  setEffortState,
} from "./controls.js";

const FA = window.STRINGS;

const log = document.getElementById("log");
const statusline = document.getElementById("statusline");

/* The CLI's own wording for a turn the user stopped, seen in both live events
   and replayed transcripts: "[Request interrupted by user]" and
   "[Request interrupted by user for tool use]". */
const INTERRUPT_NOTE = /^\s*\[Request interrupted by user/;

/* The CLI's own phrasings for "this conversation will not fit any more", read
   out of the 2.1.223 bundle. Matched loosely on purpose: the numbers in the
   real message are interpolated, and the wording drifts across versions —
   missing it costs a notice, over-matching costs a dismissible one. */
const CONTEXT_EXHAUSTED =
  /context (exceeds|limit reached|low)|\/compact or \/clear|prompt is too long/i;

/* --- DOM builders --------------------------------------------------------- */

function atBottom() {
  return log.scrollHeight - log.scrollTop - log.clientHeight < 80;
}

function append(el, { stick = true } = {}) {
  const wasAtBottom = atBottom();
  log.append(el);
  if (stick && wasAtBottom) log.scrollTop = log.scrollHeight;
  return el;
}

export function bubble(kind, text) {
  const el = document.createElement("div");
  el.className = "msg " + kind;
  el.setAttribute("dir", "auto");
  if (text !== undefined) el.textContent = text;
  return append(el);
}

function card(kind, summaryNodes, { open = false } = {}) {
  const details = document.createElement("details");
  details.className = "card " + kind;
  details.open = open;

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
  toolCards: new Map(),  // tool_use_id -> body element
  status: {},
};

export function resetTurn() {
  state.streamBubble = null;
  state.streamText = "";
  state.thinkingBody = null;
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
};

const TOOL_ICONS = {
  Read: "read", Write: "edit", Edit: "edit", MultiEdit: "edit", NotebookEdit: "edit",
  Bash: "run", BashOutput: "run", KillShell: "run",
  Glob: "find", Grep: "find",
  WebFetch: "web", WebSearch: "web",
  Task: "task", Skill: "task", AskUserQuestion: "task",
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

function toolSummary(name, toolInput) {
  const verb = FA.toolVerbs?.[name];
  const nodes = [icon(TOOL_ICONS[name]),
                 label(verb ?? name, verb ? "tool-verb" : "tool-name")];
  // The one parameter that identifies the call, LTR-isolated.
  const hint = toolInput?.file_path ?? toolInput?.path ?? toolInput?.command
            ?? toolInput?.pattern ?? toolInput?.url;
  if (hint) {
    const target = pathEl(targetText(hint));
    target.classList.add("tool-target");
    target.title = String(hint);
    nodes.push(target);
  } else if (Array.isArray(toolInput?.questions)) {
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

/* AskUserQuestion, in the transcript. The dialog (chrome.js) is what the user
   ANSWERS; this is the record of it, and in history replay it is the only thing
   there is — so it has to read as a question rather than as a JSON dump.
   Both halves live here because both are fed by the one renderer. */
export function renderQuestionBody(questions) {
  const frag = document.createDocumentFragment();
  for (const q of questions ?? []) {
    const wrap = document.createElement("div");
    wrap.className = "q-block";
    if (q.header) wrap.append(label(q.header, "q-header"));
    const text = document.createElement("p");
    text.className = "q-text";
    text.setAttribute("dir", "auto");
    text.textContent = q.question ?? "";
    wrap.append(text);
    const ul = document.createElement("ul");
    ul.className = "q-options";
    for (const option of q.options ?? []) {
      const li = document.createElement("li");
      li.setAttribute("dir", "auto");
      // <bdi>, not a span: an option labelled "Sparkling water" would otherwise
      // decide dir="auto" for the whole row and drag its Persian description
      // left with it. dir="auto" skips descendants that carry their own
      // direction, so isolating the label hands the decision to the prose —
      // spec rule 2. A label with no description inherits the RTL shell.
      const name = document.createElement("bdi");
      name.className = "q-label";
      name.textContent = option.label ?? "";
      li.append(name);
      if (option.description) li.append(label(option.description, "q-desc"));
      ul.append(li);
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

export function setStatus(patch) {
  Object.assign(state.status, patch);
  // One number, two readers: the meter below and the notice above the composer.
  // Driving the notice from here means every source of a context figure (the
  // CLI's own get_context_usage, and the `result` fallback) feeds it for free.
  if (typeof patch.context === "number") noteContext(patch.context);
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
        setCurrentSession(ev.session_id);
        setChrome(ev.cwd);
        refreshProjects();
        // The CLI is authoritative about what commands exist on this machine
        // (custom skills, plugins) — never scan skill directories ourselves.
        if (Array.isArray(ev.slash_commands)) setSlashCommands(ev.slash_commands);
        // The model this turn actually ran on: the only real confirmation that
        // a set_model took effect (its own ack is empty).
        setModelResolved(ev.model);
      } else if (ev.subtype === "status" && ev.permissionMode) {
        // The CLI's echo of a permission-mode change. The statusline shows the
        // raw mode; the pill has its own wrapper-level event.
        setStatus({ mode: ev.permissionMode });
      }
      // hook_started / hook_response are noise for the user.
      return;

    case "stream_event": {
      const inner = ev.event;
      if (inner?.type !== "content_block_delta") return;
      const delta = inner.delta ?? {};
      if (typeof delta.text === "string") {
        // Stream as plain text; markdown is rendered once the message closes,
        // so half-written fences never reach marked.
        if (!state.streamBubble) state.streamBubble = bubble("assistant", "");
        state.streamText += delta.text;
        state.streamBubble.textContent = state.streamText;
        if (atBottom()) log.scrollTop = log.scrollHeight;
      } else if (typeof delta.thinking === "string") {
        if (!state.thinkingBody) {
          state.thinkingBody = card("thinking",
            [label(FA.thinking, "tool-name")]).body;
          state.thinkingBody.setAttribute("dir", "auto");
        }
        state.thinkingBody.textContent += delta.thinking;
      }
      return;
    }

    case "assistant": {
      for (const part of ev.message?.content ?? []) {
        if (part.type === "text") {
          const rendered = renderMarkdown(part.text ?? "");
          if (state.streamBubble) {
            state.streamBubble.replaceChildren(...rendered.childNodes);
            state.streamBubble = null;
            state.streamText = "";
          } else {
            const el = bubble("assistant");
            el.append(...rendered.childNodes);
          }
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
            const { body } = card("tool", toolSummary(part.name, part.input));
            body.append(renderParamRows(part.input));
            state.toolCards.set(part.id, body);
          }
        }
      }
      state.thinkingBody = null;
      return;
    }

    case "user": {
      // Always block-shaped: a transcript's bare-string prompt is normalised
      // (and envelope-filtered) by read_session before it gets here.
      for (const part of ev.message?.content ?? []) {
        // Replayed history carries the user's own turns here. Live it does not
        // (we do not pass --replay-user-messages), so the composer echoes them
        // via wrapper/user_echo instead — hence both paths exist.
        if (part.type === "text") {
          // The CLI narrates an interrupt as a `user` turn whose text is
          // "[Request interrupted by user]" (or "...for tool use"). Rendered as
          // written it looks like the user typed an English sentence — and the
          // stop is already reported in Persian by result/aborted_streaming
          // below. Both sources carry it, so it is dropped here, at the one
          // renderer they share.
          if (INTERRUPT_NOTE.test(part.text ?? "")) continue;
          resetTurn();
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
          (body ?? log).append(renderAnswers(structured.questions,
                                             structured.answers));
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
        (body ?? bubble("assistant").parentElement ?? log).append(out);
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
        if (CONTEXT_EXHAUSTED.test(String(ev.result ?? ""))) contextFull();
      }
      resetTurn();
      setBusy(false);
      refreshProjects();   // the turn changed this session's preview/mtime
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
        setBusy(true);
        resetTurn();
        const el = bubble("user");
        el.append(...renderMarkdown(ev.text ?? "").childNodes);
        if (ev.images) el.append(label(`[${ev.images} image]`, "meta"));
      } else if (ev.subtype === "stderr") {
        bubble("error", ev.line);
      } else if (ev.subtype === "permission_request") {
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
          noteAutoAction(ev.tool_name, ev.why);
          setAutoCount(ev.auto_count);
        }
      } else if (ev.subtype === "init_info") {
        // Everything the CLI can do, answered at spawn and free
        // (wiki/control-protocol.md §1). Richer than system/init.
        applyInitInfo(ev.info);
        if (Array.isArray(ev.info?.commands)) setSlashCommands(ev.info.commands);
      } else if (ev.subtype === "posture") {
        setPostureState(ev.posture, ev.auto_count);
      } else if (ev.subtype === "effort") {
        // Read back out of get_settings, never taken from an ack.
        setEffortState(ev.effort);
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
      } else if (ev.subtype === "reset") {
        // Project switched or session resumed: clear the view so the previous
        // conversation cannot bleed into the new one.
        log.replaceChildren();
        resetTurn();
        state.toolCards.clear();
        setBusy(false);   // a reset means no turn is running, by definition
        refreshProjects();
      } else if (ev.subtype === "cli_exited") {
        bubble("error", FA.cliExited);
        setBusy(false);
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
