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
import { setBusy, setSlashCommands } from "./composer.js";
import {
  applyInitInfo, setModelResolved, setPostureState, setAutoCount, noteAutoAction,
} from "./controls.js";

const FA = window.STRINGS;

const log = document.getElementById("log");
const statusline = document.getElementById("statusline");

/* The CLI's own wording for a turn the user stopped, seen in both live events
   and replayed transcripts: "[Request interrupted by user]" and
   "[Request interrupted by user for tool use]". */
const INTERRUPT_NOTE = /^\s*\[Request interrupted by user/;

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

function toolSummary(name, toolInput) {
  const nodes = [label(name, "tool-name")];
  // Show the one parameter that identifies the call, LTR-isolated.
  const hint = toolInput?.file_path ?? toolInput?.path ?? toolInput?.command
            ?? toolInput?.pattern ?? toolInput?.url;
  if (hint) nodes.push(pathEl(String(hint)));
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

export function setStatus(patch) {
  Object.assign(state.status, patch);
  statusline.replaceChildren();
  const s = state.status;

  const items = [
    [FA.slModel, s.model && label(s.model, "mono")],
    [FA.slFolder, s.cwd && pathEl(s.cwd)],
    [FA.slMode, s.mode && label(s.mode, "mono")],
    [FA.slContext, s.context !== undefined && label(s.context + "%", "mono")],
    [FA.slCost, s.cost !== undefined && label("$" + s.cost.toFixed(4), "mono")],
    [FA.slQuota, s.quota !== undefined && label(s.quota + "%", "mono")],
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
  // reimplemented (plan §B-7). It is terminal text: keep it LTR-isolated.
  if (s.custom) {
    const wrap = document.createElement("span");
    wrap.className = "sl-item";
    wrap.append(pathEl(s.custom));
    statusline.append(wrap);
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
      }
      resetTurn();
      setBusy(false);
      refreshProjects();   // the turn changed this session's preview/mtime
      return;
    }

    case "rate_limit_event":
      return;   // statusline-only; nothing user-facing yet

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
        const note = label(ev.decision === "allow" ? FA.permAllowed : FA.permDenied,
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
        setStatus({ custom: ev.text });
      } else if (ev.subtype === "reset") {
        // Project switched or session resumed: clear the view so the previous
        // conversation cannot bleed into the new one.
        log.replaceChildren();
        resetTurn();
        state.toolCards.clear();
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
