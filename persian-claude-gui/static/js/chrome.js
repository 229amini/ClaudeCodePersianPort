/* ============================================================================
   Chrome around the conversation: sidebar (projects -> sessions), home/empty
   state, replay banner, and the permission dialog.

   Windows paths in chrome — statusline cwd, tab titles, folder picker, session
   previews, tool-card params — must all use pathEl() (LTR + isolate + <bdi>).
   Plan §B-10 item 2; the spec's message-shaped test cases cannot catch a
   regression here.
   ========================================================================= */
"use strict";

import { pathEl } from "./bidi.js";
import { api, token } from "./api.js";
/* Cyclic with render.js on purpose (see the note there): the sidebar replays
   old transcripts through the shipping renderer — plan §B-4's "one renderer,
   two sources". Nothing below runs at module-evaluation time; initChrome() is
   called from app.js once every module is live. */
import {
  bubble, label, renderEvent, renderParamRows, resetTurn, state, setStatus,
} from "./render.js";

const FA = window.STRINGS;

const log = document.getElementById("log");

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
  cardResume: document.getElementById("home-resume"),
};

let currentCwd = "";
let currentSession = null;
let lastSession = null;   // newest OTHER session here: {id, path, label}
const expanded = new Set();   // lowercased project paths open in the sidebar

/* The renderer owns the session id as of every system/init, but the sidebar
   owns the highlight, so the value lives here. Nullish input keeps the old
   value — the exact semantics of the `ev.session_id ?? currentSession` this
   replaces. */
export function setCurrentSession(sessionId) {
  if (sessionId != null) currentSession = sessionId;
}

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

/* Jalali calendar and Persian digits, from the platform: `fa-IR` implies the
   Persian calendar, so «۱۴ مرداد ۱۴:۰۵» comes out of one formatter with no
   conversion table to get wrong. This is prose chrome, not a technical value,
   which is what spec rule 5 draws the line at — the statusline's cost, context
   and session id stay Latin. Built once: constructing an Intl formatter per
   row is the expensive part. */
const WHEN_FORMAT = new Intl.DateTimeFormat("fa-IR", {
  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
});

function whenLabel(epochSeconds) {
  return WHEN_FORMAT.format(new Date(epochSeconds * 1000));
}

/* Project name and cwd everywhere in chrome: topbar, composer chip, tab-title
   stays the constant «کلاد فارسی» (an OS titlebar cannot carry <bdi>). */
export function setChrome(cwd) {
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

/* The «ادامه آخرین گفتگو» card is the only one whose availability is data-
   dependent: a brand-new folder has nothing to resume, and offering a dead
   button is worse than offering three. */
function syncResumeCard() {
  if (!ui.cardResume) return;
  ui.cardResume.hidden = !lastSession;
  if (lastSession) {
    ui.cardResume.querySelector(".hc-note").textContent = lastSession.label;
  }
}

function cardText(id, title, note) {
  const el = document.getElementById(id);
  if (!el) return null;
  el.querySelector(".hc-title").textContent = title;
  if (note !== undefined) el.querySelector(".hc-note").textContent = note;
  return el;
}

/* --- sidebar data ---------------------------------------------------------- */

let projTimer = 0;
export function refreshProjects() {
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

  const here = (data.projects ?? []).find(
    (p) => p.path.toLowerCase() === currentCwd.toLowerCase());
  const prev = (here?.sessions ?? []).find((s) => s.session_id !== currentSession);
  lastSession = prev && {
    id: prev.session_id,
    path: here.path,
    label: prev.title || prev.preview || prev.session_id.slice(0, 8),
  };
  syncResumeCard();
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
  // A real title if the session has one (the wrapper names each new session
  // after its first prompt via rename_session, and the CLI stores it in the
  // transcript). The 160-char first-prompt preview is the fallback.
  preview.textContent = sess.title || sess.preview || sess.session_id.slice(0, 8);
  preview.title = sess.preview || "";
  btn.append(preview, label(whenLabel(sess.modified), "sess-when"));
  btn.addEventListener("click", () => resumeSession(sess.session_id, projPath));

  // One truncated line cannot tell two sessions apart; the card can.
  btn.addEventListener("mouseenter", () => schedulePreview(btn, sess, projPath));
  btn.addEventListener("focus", () => schedulePreview(btn, sess, projPath));
  btn.addEventListener("mouseleave", hidePreview);
  btn.addEventListener("blur", hidePreview);

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

/* --- session hover preview -------------------------------------------------- */

/* Lazy: nothing is fetched until the pointer rests on a row for 300 ms, and the
   answer is cached, so browsing the sidebar does not read a transcript per
   pixel. `/api/session` already exists — no server code was added for this. */
const previewCache = new Map();   // session_id -> [{role, text}]
let hoverTimer = 0;
let previewCard = null;

/* Built here rather than in index.html: it is pure chrome, and spec-test.html
   would otherwise need a copy of markup it never exercises. */
function previewEl() {
  if (!previewCard) {
    previewCard = document.createElement("div");
    previewCard.id = "sess-card";
    previewCard.hidden = true;
    document.body.append(previewCard);
  }
  return previewCard;
}

function hidePreview() {
  clearTimeout(hoverTimer);
  if (previewCard) previewCard.hidden = true;
}

/* The first few things said, as plain text. Tool calls and their output are
   skipped on purpose — this answers "which conversation was that?", and a
   Bash invocation answers it worse than the sentence around it. */
function exchanges(events) {
  const out = [];
  for (const ev of events) {
    const text = (ev.message?.content ?? [])
      .filter((part) => part?.type === "text")
      .map((part) => part.text ?? "")
      .join("\n")
      .trim();
    if (!text) continue;
    out.push({ role: ev.type, text: text.slice(0, 200) });
    if (out.length === 3) break;
  }
  return out;
}

function schedulePreview(row, sess, projPath) {
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(async () => {
    let items = previewCache.get(sess.session_id);
    if (!items) {
      try {
        const data = await api("/api/session?id=" + encodeURIComponent(sess.session_id)
                               + "&cwd=" + encodeURIComponent(projPath || currentCwd));
        items = exchanges(data.events ?? []);
      } catch (err) {
        return;   // best-effort chrome; never interrupts the conversation
      }
      // The live session keeps growing, so caching it would freeze the preview
      // at whatever the transcript held the first time it was hovered.
      if (sess.session_id !== currentSession) previewCache.set(sess.session_id, items);
    }
    // The sidebar re-renders on every result event, so the row we were asked
    // about may already be detached — or the pointer simply moved on.
    if (!row.isConnected || !row.matches(":hover, :focus")) return;
    showPreview(row, sess, items);
  }, 300);
}

function showPreview(row, sess, items) {
  const card = previewEl();
  card.replaceChildren();

  const head = document.createElement("div");
  head.className = "sc-head";
  head.append(label(whenLabel(sess.modified)), label(sess.session_id.slice(0, 8), "mono"));
  card.append(head);

  if (!items.length) {
    card.append(block("sc-line meta", FA.previewEmpty));
  }
  for (const item of items) {
    card.append(block("sc-line " + item.role, item.text));
  }

  card.hidden = false;
  // Fixed positioning in px, deliberately not logical properties: the anchor is
  // a measured rect, and the sidebar sits on the RTL start edge (right), so the
  // card opens inward — clamped so a row near the bottom never opens offscreen.
  const anchor = row.getBoundingClientRect();
  const top = Math.min(Math.max(anchor.top - 6, 8),
                       window.innerHeight - card.offsetHeight - 8);
  card.style.top = Math.max(top, 8) + "px";
  // Horizontally the anchor is the whole SIDEBAR, not the row: a session row
  // stops short of the pane edge (the view/delete actions sit beside it), so
  // anchoring on the row leaves the card half-overlapping the list it explains.
  const pane = document.getElementById("sidebar")?.getBoundingClientRect();
  const edge = Math.min(anchor.left, pane ? pane.left : anchor.left);
  card.style.left = Math.max(edge - card.offsetWidth - 10, 8) + "px";
}

function block(cls, text) {
  const el = document.createElement("div");
  el.className = cls;
  el.setAttribute("dir", "auto");   // either script, one line box per turn
  el.textContent = text;
  return el;
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

export function showPermission(req) {
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

/* The dialog and the tool card render parameters with the SAME function
   (render.js). They used to differ, and the dialog's version forced every
   string LTR through pathEl — so a Persian Write.content or Edit.new_string
   was unreadable exactly at the moment of consent. Spec rule 8. */
function renderParams(toolInput) {
  if (!Object.keys(toolInput ?? {}).length) {
    perm.params.replaceChildren("—");
    return;
  }
  perm.params.replaceChildren(renderParamRows(toolInput));
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
export function dismissPermission(requestId) {
  perm.queue = perm.queue.filter((r) => r.request_id !== requestId);
  if (perm.current?.request_id === requestId) {
    perm.current = null;
    if (perm.dialog.open) perm.dialog.close();
    nextPermission();
  }
}

/* --- init ------------------------------------------------------------------ */

/* Every side effect this module used to run at load time. app.js calls it once,
   in the same order the single-file version ran in. */
export function initChrome() {
  if (ui.home) new MutationObserver(syncHome).observe(log, { childList: true });

  if (ui.projects) {
    document.getElementById("brand").textContent = FA.appName;
    document.getElementById("btn-new-label").textContent = FA.newChat;
    document.getElementById("projects-title").textContent = FA.projects;
    document.getElementById("btn-help-label").textContent = FA.help;
    // The help page is served, so it needs the token like every other request.
    document.getElementById("btn-help").href =
      "/static/help.html?t=" + encodeURIComponent(token);

    ui.home.hidden = false;   // visibility is class-driven from here on
    ui.btnNew.addEventListener("click", () => switchProject(currentCwd));

    /* Home action cards. Every one of them presses a control that already
       exists — no second implementation to keep in sync, and a card whose
       control is missing simply never fires. Same idiom as the composer's
       lifecycle verbs. */
    cardText("home-resume", FA.homeResume)
      ?.addEventListener("click", () => {
        if (lastSession) resumeSession(lastSession.id, lastSession.path);
      });
    cardText("home-open", FA.homeOpen, FA.homeOpenNote)
      ?.addEventListener("click", () => ui.projChip.click());
    cardText("home-explain", FA.homeExplain, FA.homeExplainNote)
      ?.addEventListener("click", () => {
        // The card's own label goes into the composer verbatim, so the user
        // sees exactly what is about to be sent — no hidden prompt.
        const input = document.getElementById("input");
        input.value = FA.homeExplain;
        document.getElementById("composer").requestSubmit();
      });
    cardText("home-help", FA.homeHelp, FA.homeHelpNote)
      ?.addEventListener("click", () => document.getElementById("btn-help").click());
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
}
