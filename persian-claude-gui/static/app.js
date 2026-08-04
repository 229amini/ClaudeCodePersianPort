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
   any page that loads app.js alongside its own script (spec-test.html today)
   would otherwise collide on `log`, `input`, `state`. The only exports are the
   two renderer entry points on `window`. */
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
        currentSession = ev.session_id ?? currentSession;
        setChrome(ev.cwd);
        refreshProjects();
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

// Reused by history replay and by spec-test.html, so the acceptance tests
// exercise the shipping code path rather than a copy of it.
window.renderEvent = renderEvent;
window.renderMarkdown = renderMarkdown;

/* --- sidebar: projects, sessions, home state (plan §B-4) ------------------- */

const ui = {
  topbarName: document.getElementById("topbar-name"),
  topbarCwd: document.getElementById("topbar-cwd"),
  projects: document.getElementById("projects"),
  btnNew: document.getElementById("btn-new"),
  projChip: document.getElementById("proj-chip"),
  projChipName: document.getElementById("proj-chip-name"),
  home: document.getElementById("home"),
  greeting: document.getElementById("greeting-text"),
  banner: document.getElementById("replay-banner"),
};

let currentCwd = "";
let currentSession = null;
const expanded = new Set();   // lowercased project paths open in the sidebar

/* Static markup only — never user data — so innerHTML is safe here. */
const SVG = {
  caret: '<svg class="caret" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 6l-6 6 6 6"/></svg>',
  folder: '<svg class="folder" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  eye: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/></svg>',
  archive: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h18v4H3zM5 9v10h14V9M10 13h4"/></svg>',
  unarchive: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h18v4H3zM5 9v10h14V9M12 18v-5M9.5 15.5L12 13l2.5 2.5"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
};

function basename(p) {
  return (p || "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p || "";
}

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

/* Project name and cwd everywhere in chrome: topbar, composer chip, tab-title
   stays the constant «کلود» (an OS titlebar cannot carry <bdi>). */
function setChrome(cwd) {
  if (cwd) currentCwd = cwd;
  const name = basename(currentCwd);
  if (ui.topbarName) ui.topbarName.textContent = name;
  if (ui.topbarCwd) ui.topbarCwd.textContent = currentCwd;
  if (ui.projChipName) {
    ui.projChipName.textContent = name || FA.chooseProject;
    ui.projChip.title = currentCwd;
  }
}

/* --- home / empty state ---------------------------------------------------- */

function greetingText() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return FA.greetMorning;
  if (h >= 12 && h < 17) return FA.greetDay;
  if (h >= 17 && h < 22) return FA.greetEvening;
  return FA.greetNight;
}

function syncHome() {
  if (!ui.home) return;   // spec-test.html has no home section
  const empty = log.childElementCount === 0;
  if (empty) ui.greeting.textContent = greetingText();
  document.body.classList.toggle("home", empty);
}

if (ui.home) new MutationObserver(syncHome).observe(log, { childList: true });

/* --- sidebar data ---------------------------------------------------------- */

let projTimer = 0;
function refreshProjects() {
  if (!ui.projects) return;
  clearTimeout(projTimer);
  projTimer = setTimeout(loadProjects, 400);
}

async function loadProjects() {
  let data;
  try {
    data = await api("/api/projects");
  } catch (err) {
    return;   // sidebar refresh is best-effort; the next event retries
  }
  currentCwd = data.current_cwd || currentCwd;
  currentSession = data.current_session ?? currentSession;
  setChrome();
  renderProjects(data.projects ?? []);
}

let archOpen = false;   // the «بایگانی» section, collapsed by default

function renderProjects(projects) {
  ui.projects.replaceChildren();
  expanded.add(currentCwd.toLowerCase());

  // The open project always renders as active, even if its archived flag is
  // still set (opened via the picker while archived).
  const active = projects.filter((p) =>
    !p.archived || p.path.toLowerCase() === currentCwd.toLowerCase());
  const archived = projects.filter((p) => !active.includes(p));

  for (const proj of active) ui.projects.append(projEl(proj, projects));

  if (archived.length) {
    const head = document.createElement("button");
    head.type = "button";
    head.className = "proj-head arch-head";
    head.setAttribute("aria-expanded", String(archOpen));
    head.innerHTML = SVG.caret;
    head.append(label(`${FA.archiveSection} (${archived.length})`));
    head.addEventListener("click", () => {
      archOpen = !archOpen;
      renderProjects(projects);
    });
    ui.projects.append(head);
    if (archOpen) for (const proj of archived) ui.projects.append(projEl(proj, projects));
  }
}

function projEl(proj, projects) {
  const key = proj.path.toLowerCase();
  const isCurrent = key === currentCwd.toLowerCase();

  const wrap = document.createElement("div");
  wrap.className = "proj";
  wrap.dataset.current = String(isCurrent);

  const top = document.createElement("div");
  top.className = "proj-top";

  const head = document.createElement("button");
  head.type = "button";
  head.className = "proj-head";
  head.setAttribute("aria-expanded", String(expanded.has(key)));
  head.innerHTML = SVG.caret + SVG.folder;
  const name = document.createElement("bdi");
  name.className = "proj-name";
  name.textContent = basename(proj.path);
  name.title = proj.path;
  head.append(name);
  head.addEventListener("click", () => {
    if (expanded.has(key)) expanded.delete(key); else expanded.add(key);
    renderProjects(projects);
  });

  // New chat in THIS project (restarts the CLI there) — an explicit action,
  // so browsing the list can never kill the live session by accident.
  const open = actionButton(SVG.plus, FA.newChat);
  open.addEventListener("click", () => switchProject(proj.path));

  top.append(head, open);

  // Archive keeps the transcripts; remove deletes them. Neither ever touches
  // the folder on disk. The open project gets neither — same live-state rule
  // as the current session's missing delete button.
  if (!isCurrent) {
    const arch = actionButton(proj.archived ? SVG.unarchive : SVG.archive,
      proj.archived ? FA.unarchiveProject : FA.archiveProject);
    arch.addEventListener("click", async () => {
      try {
        await api("/api/project/archive",
          { path: proj.path, archived: !proj.archived });
      } catch (err) {
        return;
      }
      loadProjects();
    });
    const remove = armedDelete(FA.removeProject,
      () => api("/api/project/remove", { path: proj.path }));
    top.append(arch, remove);
  }
  wrap.append(top);

  if (expanded.has(key)) {
    const ul = document.createElement("ul");
    ul.className = "proj-sessions";
    if (!(proj.sessions ?? []).length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.setAttribute("dir", "auto");
      li.textContent = FA.sessionsEmpty;
      ul.append(li);
    }
    for (const sess of proj.sessions ?? []) {
      ul.append(sessionRow(sess, proj.path,
        isCurrent && sess.session_id === currentSession));
    }
    wrap.append(ul);
  }
  return wrap;
}

function sessionRow(sess, projPath, isCurrent) {
  const li = document.createElement("li");
  li.dataset.current = String(isCurrent);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "sess";
  const preview = document.createElement("span");
  preview.className = "sess-preview";
  preview.setAttribute("dir", "auto");   // user text: could be either script
  preview.textContent = sess.preview || sess.session_id.slice(0, 8);
  btn.append(preview, label(whenLabel(sess.modified), "sess-when"));
  btn.addEventListener("click", () => resumeSession(sess.session_id, projPath));

  const view = actionButton(SVG.eye, FA.viewSession);
  view.addEventListener("click", () => replaySession(sess.session_id, projPath));

  li.append(btn, view);
  // The live process keeps writing its own transcript, so it cannot be
  // deleted; the server refuses it too.
  if (!isCurrent) {
    li.append(armedDelete(FA.deleteSession, () =>
      api("/api/session/delete", { session_id: sess.session_id, path: projPath })));
  }
  return li;
}

function actionButton(svg, title) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "sess-act";
  btn.innerHTML = svg;
  btn.title = title;
  btn.setAttribute("aria-label", title);
  return btn;
}

/* Two-click confirm instead of confirm(): a browser modal would be LTR and
   outside our RTL discipline, and this keeps the answer where the eye is. */
function armedDelete(titleText, onDelete) {
  const btn = actionButton(SVG.trash, titleText);
  btn.addEventListener("click", async () => {
    if (btn.dataset.armed !== "true") {
      btn.dataset.armed = "true";
      btn.classList.add("armed");
      btn.textContent = FA.confirmDelete;
      return;
    }
    btn.disabled = true;
    try {
      await onDelete();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = FA.deleteFailed;
      return;
    }
    loadProjects();
  });
  return btn;
}

/* Read-only view of an old conversation. Goes through renderEvent exactly as
   the live stream does — plan §B-4's "one renderer, two sources". */
async function replaySession(sessionId, projPath) {
  let data;
  try {
    data = await api("/api/session?id=" + encodeURIComponent(sessionId)
                     + "&cwd=" + encodeURIComponent(projPath || currentCwd));
  } catch (err) {
    bubble("error", FA.sendFailed);
    return;
  }
  log.replaceChildren();
  resetTurn();
  state.toolCards.clear();
  for (const event of data.events ?? []) renderEvent(event);
  showReplayBanner(sessionId, projPath);
}

function showReplayBanner(sessionId, projPath) {
  ui.banner.replaceChildren();
  const text = document.createElement("span");
  text.setAttribute("dir", "auto");
  text.textContent = FA.replaying;
  const cont = document.createElement("button");
  cont.type = "button";
  cont.textContent = FA.continueSession;
  cont.addEventListener("click", () => resumeSession(sessionId, projPath));
  ui.banner.append(text, cont);
  ui.banner.hidden = false;
}

async function resumeSession(sessionId, projPath) {
  if (sessionId === currentSession) return;   // already the live session
  ui.banner.hidden = true;
  try {
    await api("/api/session/resume", { session_id: sessionId, path: projPath });
  } catch (err) {
    bubble("error", FA.sendFailed);
    return;
  }
  currentSession = sessionId;
  if (projPath) setChrome(projPath);
  // The server clears history and the reset event wipes the view; replay the
  // transcript so the resumed conversation is not an empty window.
  const data = await api("/api/session?id=" + encodeURIComponent(sessionId)
                         + "&cwd=" + encodeURIComponent(projPath || currentCwd));
  log.replaceChildren();
  for (const event of data.events ?? []) renderEvent(event);
  bubble("assistant", FA.resumed).classList.add("meta");
  refreshProjects();
}

async function switchProject(folder) {
  if (!folder) return;
  if (ui.banner) ui.banner.hidden = true;
  try {
    const data = await api("/api/project/open", { path: folder });
    setStatus({ cwd: data.cwd, sessionId: null, cost: undefined });
    currentSession = null;
    setChrome(data.cwd);
    refreshProjects();
  } catch (err) {
    bubble("error", FA.sendFailed);
  }
}

if (ui.projects) {
  document.getElementById("btn-new-label").textContent = FA.newChat;
  document.getElementById("projects-title").textContent = FA.projects;
  document.getElementById("btn-help-label").textContent = FA.help;
  // The help page is served, so it needs the token like every other request.
  document.getElementById("btn-help").href =
    "/static/help.html?t=" + encodeURIComponent(token);

  ui.home.hidden = false;   // visibility is class-driven from here on
  ui.btnNew.addEventListener("click", () => switchProject(currentCwd));
  ui.projChip.addEventListener("click", async () => {
    // Blocks in a child process while the native dialog is up.
    try {
      const { path } = await api("/api/project/pick", {});
      if (path) await switchProject(path);
    } catch (err) {
      bubble("error", FA.sendFailed);
    }
  });

  loadProjects();
  syncHome();
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
  if (sendBtn) sendBtn.hidden = busy;
  if (stopBtn) stopBtn.hidden = !busy;
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

if (stopBtn) stopBtn.addEventListener("click", async () => {
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
  if (!attachRow) return;   // spec-test.html has no attachment row
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

document.getElementById("btn-attach")?.addEventListener("click", async () => {
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
  return !!slashPopup && !slashPopup.hidden;
}

function currentSlashQuery() {
  const value = input.value;
  // Only while the whole composer is a single /token — never mid-sentence.
  const match = /^\/(\S*)$/.exec(value);
  return match ? match[1] : null;
}

function refreshSlash() {
  if (!slashPopup) return;
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
const hint = document.getElementById("composer-hint");
if (hint) hint.textContent = FA.hintZwnj + " · " + FA.slashHint;
input.focus();

})();
