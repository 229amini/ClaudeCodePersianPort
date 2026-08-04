/* ============================================================================
   Renderer + transport for the Persian RTL front-end.

   ONE RENDERER, TWO SOURCES (plan §B-4): renderEvent() below is fed by the live
   SSE stream today and by replayed ~/.claude/projects/<cwd>/*.jsonl history at
   M5. Do not fork a second history path.

   BiDi discipline (claude-persian-rtl-spec.md) lives in two places only:
     - applyDirection() sets dir="auto" on every block-level element
     - isolateTechnicalTokens() wraps bare paths/URLs/versions/flags in <bdi>
   Everything else must go through renderMarkdown() so both run.
   ========================================================================= */

/* Wrapped in an IIFE: these are classic scripts sharing one global scope, and
   any page that loads app.js alongside its own script (spec-test.html today,
   the history view at M5) would otherwise collide on `log`, `input`, `state`.
   The only exports are the two renderer entry points on `window`. */
(function () {
"use strict";

const FA = window.FA;
const token = new URLSearchParams(location.search).get("t");

const log = document.getElementById("log");
const input = document.getElementById("input");
const composer = document.getElementById("composer");
const sendBtn = document.getElementById("send");
const stopBtn = document.getElementById("stop");
const statusline = document.getElementById("statusline");
const attachRow = document.getElementById("attachments");
const slashPopup = document.getElementById("slash-popup");

/* --- BiDi helpers --------------------------------------------------------- */

/* Neutral characters (\ / . : - _ @ #) take their direction from the
   surrounding text, so a bare path inside a Persian sentence gets its
   separators reordered. <bdi> isolates the run. Spec rule 2. */
const TECHNICAL = new RegExp(
  [
    "[A-Za-z]:\\\\[^\\s\u060C\u061B\u061F\"'`]+",  // C:\Users\...
    "\\\\\\\\[^\\s\"'`]+",                          // \\server\share
    "https?://[^\\s\"'`]+",                         // URLs
    "\\B--[A-Za-z][\\w-]*",                         // --flags
    "\\bv?\\d+\\.\\d+(?:\\.\\d+)+\\b",              // 2.1.221
  ].join("|"),
  "g"
);

/* Direction is never decided by these tags — they are forced LTR in CSS, and
   <a>/<bdi> already isolate. Walking into them would double-wrap. */
const SKIP_TAGS = new Set(["PRE", "CODE", "BDI", "A", "SCRIPT", "STYLE"]);

function isolateTechnicalTokens(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      for (let p = node.parentElement; p && p !== root; p = p.parentElement) {
        if (SKIP_TAGS.has(p.tagName)) return NodeFilter.FILTER_REJECT;
      }
      return TECHNICAL.test(node.nodeValue)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });

  const targets = [];
  while (walker.nextNode()) targets.push(walker.currentNode);

  for (const node of targets) {
    const frag = document.createDocumentFragment();
    let last = 0;
    TECHNICAL.lastIndex = 0;
    let match;
    while ((match = TECHNICAL.exec(node.nodeValue)) !== null) {
      if (match.index > last) {
        frag.append(node.nodeValue.slice(last, match.index));
      }
      const bdi = document.createElement("bdi");
      bdi.className = "path";
      bdi.textContent = match[0];
      frag.append(bdi);
      last = match.index + match[0].length;
    }
    if (last < node.nodeValue.length) frag.append(node.nodeValue.slice(last));
    node.replaceWith(frag);
  }
}

/* Paragraph-level direction: a Persian paragraph and an English paragraph in
   one message each align correctly. Let the browser detect from the first
   strong character — never compute it in JS. Spec rule 1. */
const BLOCK_TAGS = "p,li,h1,h2,h3,h4,h5,h6,blockquote,td,th,dd,dt,figcaption";

function applyDirection(root) {
  for (const el of root.querySelectorAll(BLOCK_TAGS)) {
    el.setAttribute("dir", "auto");
  }
}

function renderMarkdown(text) {
  const host = document.createElement("div");
  const parse = window.marked?.parse ?? window.marked;
  host.innerHTML = typeof parse === "function" ? parse(text) : "";
  isolateTechnicalTokens(host);
  applyDirection(host);
  return host;
}

/* A Windows path shown in chrome (statusline, tab title, session preview,
   tool params). Always LTR + isolate + <bdi>. */
function pathEl(value) {
  const bdi = document.createElement("bdi");
  bdi.className = "path";
  bdi.textContent = value ?? "";
  return bdi;
}

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

function bubble(kind, text) {
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

function label(text, cls) {
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

const state = {
  streamBubble: null,    // assistant bubble currently receiving text deltas
  streamText: "",        // raw markdown accumulated during streaming
  thinkingBody: null,
  toolCards: new Map(),  // tool_use_id -> body element
  status: {},
};

function resetTurn() {
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

function setStatus(patch) {
  Object.assign(state.status, patch);
  statusline.replaceChildren();
  const s = state.status;

  const items = [
    [FA.slModel, s.model && label(s.model, "mono")],
    [FA.slFolder, s.cwd && pathEl(s.cwd)],
    [FA.slMode, s.mode && label(s.mode, "mono")],
    [FA.slContext, s.context !== undefined && label(s.context + "%", "mono")],
    [FA.slCost, s.cost !== undefined && label("$" + s.cost.toFixed(4), "mono")],
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

function renderEvent(ev) {
  switch (ev.type) {
    case "system":
      if (ev.subtype === "init") {
        setStatus({
          model: ev.model,
          cwd: ev.cwd,
          mode: ev.permissionMode,
          sessionId: ev.session_id,
        });
        if (ui.topbarCwd) ui.topbarCwd.textContent = ev.cwd ?? "";
        // The CLI is authoritative about what commands exist on this machine
        // (custom skills, plugins) — never scan skill directories ourselves.
        if (Array.isArray(ev.slash_commands)) slashCommands = ev.slash_commands;
      }
      // hook_started / hook_response / status are noise for the user.
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
            body.append(block("tool-output",
              JSON.stringify(part.input ?? {}, null, 2)));
            state.toolCards.set(part.id, body);
          }
        }
      }
      state.thinkingBody = null;
      return;
    }

    case "user": {
      for (const part of ev.message?.content ?? []) {
        // Replayed history carries the user's own turns here. Live it does not
        // (we do not pass --replay-user-messages), so the composer echoes them
        // via wrapper/user_echo instead — hence both paths exist.
        if (part.type === "text") {
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
        const out = block("tool-output", text);
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
      } else if (ev.subtype === "statusline") {
        setStatus({ custom: ev.text });
      } else if (ev.subtype === "reset") {
        // Project switched or session resumed: clear the view so the previous
        // conversation cannot bleed into the new one.
        log.replaceChildren();
        resetTurn();
        state.toolCards.clear();
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

// Reused by history replay at M5 and by spec-test.html, so the acceptance
// tests exercise the shipping code path rather than a copy of it.
window.renderEvent = renderEvent;
window.renderMarkdown = renderMarkdown;

/* --- sessions, history replay, folder picker (plan §B-4) ------------------ */

const ui = {
  topbarCwd: document.getElementById("topbar-cwd"),
  btnSessions: document.getElementById("btn-sessions"),
  btnFolder: document.getElementById("btn-folder"),
  dialog: document.getElementById("sessions"),
  list: document.getElementById("sessions-list"),
  recents: document.getElementById("recents-list"),
  banner: document.getElementById("replay-banner"),
};

async function api(path, body) {
  const url = path + (path.includes("?") ? "&" : "?") + "t=" + encodeURIComponent(token);
  const options = body === undefined
    ? {}
    : { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body) };
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(path + " -> " + res.status);
  return res.json();
}

function whenLabel(epochSeconds) {
  const d = new Date(epochSeconds * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  // Latin digits, per spec rule 5 — this abuts technical values.
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function openSessions() {
  let data;
  try {
    data = await api("/api/sessions");
  } catch (err) {
    bubble("error", FA.sendFailed);
    return;
  }

  ui.recents.replaceChildren();
  for (const folder of data.recents ?? []) {
    const li = document.createElement("li");
    const name = pathEl(folder);
    name.classList.add("session-preview");
    const open = document.createElement("button");
    open.type = "button";
    open.textContent = FA.openFolder;
    open.addEventListener("click", () => switchProject(folder));
    li.append(name, open);
    ui.recents.append(li);
  }

  ui.list.replaceChildren();
  if (!(data.sessions ?? []).length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.setAttribute("dir", "auto");
    empty.textContent = FA.sessionsEmpty;
    ui.list.append(empty);
  }
  for (const item of data.sessions ?? []) {
    const li = document.createElement("li");
    li.dataset.current = String(item.session_id === data.current);

    const preview = document.createElement("span");
    preview.className = "session-preview";
    preview.setAttribute("dir", "auto");   // preview is user text: could be either script
    preview.textContent = item.preview || item.session_id;
    li.append(preview, label(whenLabel(item.modified), "session-when"));

    const view = document.createElement("button");
    view.type = "button";
    view.className = "ghost";
    view.textContent = FA.viewSession;
    view.addEventListener("click", () => replaySession(item.session_id));

    const cont = document.createElement("button");
    cont.type = "button";
    cont.textContent = FA.continueSession;
    cont.addEventListener("click", () => resumeSession(item.session_id));

    li.append(view, cont);
    ui.list.append(li);
  }
  ui.dialog.showModal();
}

/* Read-only view of an old conversation. Goes through renderEvent exactly as
   the live stream does — plan §B-4's "one renderer, two sources". */
async function replaySession(sessionId) {
  ui.dialog.close();
  let data;
  try {
    data = await api("/api/session?id=" + encodeURIComponent(sessionId));
  } catch (err) {
    bubble("error", FA.sendFailed);
    return;
  }
  log.replaceChildren();
  resetTurn();
  state.toolCards.clear();
  for (const event of data.events ?? []) renderEvent(event);
  showReplayBanner(sessionId);
}

function showReplayBanner(sessionId) {
  ui.banner.replaceChildren();
  const text = document.createElement("span");
  text.setAttribute("dir", "auto");
  text.textContent = FA.replaying;
  const cont = document.createElement("button");
  cont.type = "button";
  cont.textContent = FA.continueSession;
  cont.addEventListener("click", () => resumeSession(sessionId));
  ui.banner.append(text, cont);
  ui.banner.hidden = false;
}

async function resumeSession(sessionId) {
  ui.dialog.close();
  ui.banner.hidden = true;
  try {
    await api("/api/session/resume", { session_id: sessionId });
  } catch (err) {
    bubble("error", FA.sendFailed);
    return;
  }
  // The server clears history and the reset event wipes the view; replay the
  // transcript so the resumed conversation is not an empty window.
  const data = await api("/api/session?id=" + encodeURIComponent(sessionId));
  log.replaceChildren();
  for (const event of data.events ?? []) renderEvent(event);
  bubble("assistant", FA.resumed).classList.add("meta");
}

async function switchProject(folder) {
  ui.dialog.close();
  ui.banner.hidden = true;
  try {
    const data = await api("/api/project/open", { path: folder });
    setStatus({ cwd: data.cwd, sessionId: null, cost: undefined });
    ui.topbarCwd.textContent = data.cwd;
  } catch (err) {
    bubble("error", FA.sendFailed);
  }
}

if (ui.btnSessions) {
  ui.btnSessions.textContent = FA.sessions;
  ui.btnFolder.textContent = FA.pickFolder;
  const helpLink = document.getElementById("btn-help");
  if (helpLink) {
    helpLink.textContent = FA.help;
    // The help page is served, so it needs the token like every other request.
    helpLink.href = "/static/help.html?t=" + encodeURIComponent(token);
  }
  document.getElementById("sessions-title").textContent = FA.sessions;
  document.getElementById("sessions-subtitle").textContent = FA.sessionsInFolder;
  document.getElementById("recents-title").textContent = FA.recents;
  document.getElementById("sessions-close").textContent = FA.close;
  document.getElementById("sessions-close")
    .addEventListener("click", () => ui.dialog.close());
  ui.btnSessions.addEventListener("click", openSessions);
  ui.btnFolder.addEventListener("click", async () => {
    // Blocks in a child process while the native dialog is up.
    const { path } = await api("/api/project/pick", {});
    if (path) await switchProject(path);
  });
}

/* --- permission dialog (plan §B-5) ---------------------------------------- */

const perm = {
  dialog: document.getElementById("perm"),
  form: document.getElementById("perm-form"),
  tool: document.getElementById("perm-tool"),
  params: document.getElementById("perm-params"),
  remember: document.getElementById("perm-remember"),
  queue: [],
  current: null,
};

if (perm.dialog) {
  document.getElementById("perm-title").textContent = FA.permTitle;
  document.getElementById("perm-body").textContent = FA.permBody;
  document.getElementById("perm-remember-label").textContent = FA.permRemember;
  document.getElementById("perm-allow").textContent = FA.permAllow;
  document.getElementById("perm-deny").textContent = FA.permDeny;

  // Escape / backdrop dismissal must resolve as deny. Closing a window is not
  // consent, and leaving it unanswered would block the CLI until the timeout.
  perm.dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    resolvePermission("deny");
  });

  perm.form.addEventListener("submit", (e) => {
    // <form method="dialog"> closes natively; capture which button was used.
    resolvePermission(e.submitter?.value === "allow" ? "allow" : "deny");
  });
}

function showPermission(req) {
  perm.queue.push(req);
  if (!perm.current) nextPermission();
}

function nextPermission() {
  perm.current = perm.queue.shift() ?? null;
  if (!perm.current) return;

  perm.tool.replaceChildren(label(perm.current.tool_name ?? "?", "mono"));
  renderParams(perm.current.tool_input ?? {});
  perm.remember.checked = false;
  if (!perm.dialog.open) perm.dialog.showModal();
  document.getElementById("perm-deny").focus();   // safe default has focus
}

/* Show tool parameters as plain key/value lines rather than raw JSON.
   JSON.stringify escapes every backslash, so a Windows path arrives as
   C:\\Users\\... — the person approving this is non-technical and should see
   the real path they are being asked to trust. */
function renderParams(toolInput) {
  perm.params.replaceChildren();
  const entries = Object.entries(toolInput);
  if (!entries.length) {
    perm.params.textContent = "—";
    return;
  }
  for (const [key, value] of entries) {
    const row = document.createElement("div");
    row.append(label(key + ": ", "meta"));
    if (typeof value === "string") {
      row.append(pathEl(value));
    } else {
      row.append(pathEl(JSON.stringify(value)));
    }
    perm.params.append(row);
  }
}

async function resolvePermission(decision) {
  const req = perm.current;
  perm.current = null;
  if (perm.dialog.open) perm.dialog.close();
  if (!req) return;

  try {
    await fetch("/api/permission/respond?t=" + encodeURIComponent(token), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request_id: req.request_id,
        decision,
        remember: perm.remember.checked,
        tool_name: req.tool_name,
      }),
    });
  } catch (err) {
    console.error("permission respond failed", err);
  }
  nextPermission();
}

/* The server resolved it without us (timeout, or another window answered). */
function dismissPermission(requestId) {
  perm.queue = perm.queue.filter((r) => r.request_id !== requestId);
  if (perm.current?.request_id === requestId) {
    perm.current = null;
    if (perm.dialog.open) perm.dialog.close();
    nextPermission();
  }
}

/* --- transport ------------------------------------------------------------ */

/* While a turn is running the send button is replaced by a stop button rather
   than merely disabled — a non-technical user needs an obvious way out, and the
   interrupt leaves the process (and the session) alive. */
function setBusy(busy) {
  sendBtn.hidden = busy;
  stopBtn.hidden = !busy;
  sendBtn.textContent = FA.send;
}

// No token means this page is not driving a server (spec-test.html); render
// only, no transport.
const events = token ? new EventSource("/api/events?t=" + encodeURIComponent(token)) : null;
if (events) events.onmessage = (e) => {
  let parsed;
  try {
    parsed = JSON.parse(e.data);
  } catch (err) {
    console.error("bad SSE payload", err, e.data);
    return;
  }
  try {
    renderEvent(parsed);
  } catch (err) {
    console.error("render failed", err, parsed);
  }
};
if (events) events.onerror = () => setStatus({});

/* --- composer ------------------------------------------------------------- */

/* ZWNJ (نیم‌فاصله, U+200C) has no key on a standard layout but Persian needs it
   for correct word forms — می‌رود vs میرود. Spec rule 6 maps it to Shift+Space.
   setRangeText keeps native undo; the spec's execCommand is deprecated. */
input.addEventListener("keydown", (e) => {
  if (e.key === " " && e.shiftKey) {
    e.preventDefault();
    const { selectionStart, selectionEnd } = input;
    input.setRangeText("\u200C", selectionStart, selectionEnd, "end");
    return;
  }
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    composer.requestSubmit();
  }
});

input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, window.innerHeight * 0.4) + "px";
});

composer.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (slashOpen()) { acceptSlash(); return; }
  const text = input.value.trim();
  if (!text && !attachments.length) return;
  const payload = { text, attachments: attachments.slice() };
  input.value = "";
  input.style.height = "auto";
  setAttachments([]);
  setBusy(true);
  try {
    const res = await fetch("/api/message?t=" + encodeURIComponent(token), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(await res.text());
  } catch (err) {
    bubble("error", FA.sendFailed);
    setBusy(false);
  }
});

stopBtn.addEventListener("click", async () => {
  stopBtn.disabled = true;
  try {
    await fetch("/api/interrupt?t=" + encodeURIComponent(token), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  } catch (err) {
    console.error("interrupt failed", err);
  } finally {
    stopBtn.disabled = false;
  }
});

/* --- attachments ---------------------------------------------------------- */

let attachments = [];

function setAttachments(list) {
  attachments = list;
  attachRow.replaceChildren();
  attachRow.hidden = !list.length;
  list.forEach((filePath, index) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.append(pathEl(filePath.split(/[\\/]/).pop() || filePath));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.setAttribute("aria-label", FA.removeAttachment);
    remove.textContent = "×";
    remove.addEventListener("click", () =>
      setAttachments(attachments.filter((_, i) => i !== index)));
    chip.append(remove);
    attachRow.append(chip);
  });
}

document.getElementById("btn-attach").addEventListener("click", async () => {
  try {
    const { paths } = await api("/api/attach/pick", {});
    if (paths?.length) setAttachments([...attachments, ...paths]);
  } catch (err) {
    bubble("error", FA.sendFailed);
  }
});

/* --- slash-command autocomplete (plan §B-6) -------------------------------- */

let slashCommands = [];   // filled from system/init - authoritative per machine
let slashMatches = [];
let slashIndex = 0;

function slashOpen() {
  return !slashPopup.hidden;
}

function currentSlashQuery() {
  const value = input.value;
  // Only while the whole composer is a single /token — never mid-sentence.
  const match = /^\/(\S*)$/.exec(value);
  return match ? match[1] : null;
}

function refreshSlash() {
  const query = currentSlashQuery();
  if (query === null || !slashCommands.length) {
    slashPopup.hidden = true;
    return;
  }
  slashMatches = slashCommands
    .filter((name) => name.toLowerCase().startsWith(query.toLowerCase()))
    .slice(0, 50);
  if (!slashMatches.length) {
    slashPopup.hidden = true;
    return;
  }
  slashIndex = 0;
  renderSlash();
  slashPopup.hidden = false;
}

function renderSlash() {
  slashPopup.replaceChildren();
  slashMatches.forEach((name, index) => {
    const li = document.createElement("li");
    li.textContent = "/" + name;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(index === slashIndex));
    li.addEventListener("mousedown", (e) => {
      e.preventDefault();       // keep focus in the textarea
      slashIndex = index;
      acceptSlash();
    });
    slashPopup.append(li);
  });
  slashPopup.children[slashIndex]?.scrollIntoView({ block: "nearest" });
}

function acceptSlash() {
  const name = slashMatches[slashIndex];
  if (!name) return;
  input.value = "/" + name + " ";
  slashPopup.hidden = true;
  input.focus();
}

input.addEventListener("input", refreshSlash);

input.addEventListener("keydown", (e) => {
  if (!slashOpen()) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const step = e.key === "ArrowDown" ? 1 : -1;
    slashIndex = (slashIndex + step + slashMatches.length) % slashMatches.length;
    renderSlash();
  } else if (e.key === "Tab") {
    e.preventDefault();
    acceptSlash();
  } else if (e.key === "Escape") {
    e.preventDefault();
    slashPopup.hidden = true;
  }
}, true);   // capture: must beat the Enter-submits handler below

setAttachments([]);
setBusy(false);
stopBtn.textContent = FA.stop;
document.getElementById("composer-hint").textContent =
  FA.hintZwnj + " · " + FA.slashHint;
input.focus();

})();
