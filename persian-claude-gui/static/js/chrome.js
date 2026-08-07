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
  bubble, label, renderEvent, renderToolDetail, resetTurn, state, setStatus,
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
let autoExpanded = null;      // the project `expanded` was last auto-opened for

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
  dots: '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>',
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
  // Open the active project when you ARRIVE at it, not on every refresh. Any
  // event redraws the sidebar, so the unconditional add used to undo the user's
  // collapse a moment after they clicked — the active project could never be
  // shut. Re-arming on change keeps the original "switching opens it" feel.
  const activeKey = currentCwd.toLowerCase();
  if (autoExpanded !== activeKey) {
    expanded.add(activeKey);
    autoExpanded = activeKey;
  }

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
  // so browsing the list can never kill the live session by accident. It stays
  // outside the menu because it is the one thing you come to a project row to
  // do; everything rarer moved into the ⋯.
  const open = actionButton(SVG.plus, FA.newChat);
  open.addEventListener("click", () => switchProject(proj.path));

  top.append(head, open);

  // Archive keeps the transcripts; remove deletes them. Neither ever touches
  // the folder on disk. The open project gets neither — same live-state rule
  // as the current session's missing delete action.
  if (!isCurrent) {
    top.append(...kebabMenu([
      {
        icon: proj.archived ? SVG.unarchive : SVG.archive,
        text: proj.archived ? FA.unarchiveProject : FA.archiveProject,
        run: async () => {
          await api("/api/project/archive",
            { path: proj.path, archived: !proj.archived });
          loadProjects();
        },
      },
      null,
      {
        icon: SVG.trash,
        text: FA.removeProject,
        danger: true,
        run: async () => {
          await api("/api/project/remove", { path: proj.path });
          loadProjects();
        },
      },
    ]));
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

  // The live process keeps writing its own transcript, so the current session
  // cannot be deleted; the server refuses it too.
  li.append(btn, ...kebabMenu([
    {
      icon: SVG.eye,
      text: FA.viewSession,
      run: () => replaySession(sess.session_id, projPath),
    },
    ...(isCurrent ? [] : [null, {
      icon: SVG.trash,
      text: FA.deleteSession,
      danger: true,
      run: async () => {
        await api("/api/session/delete",
          { session_id: sess.session_id, path: projPath });
        loadProjects();
      },
    }]),
  ]));
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

/* The row's overflow menu. One `⋯` replaces the three-to-four hover buttons a
   row used to carry — the same actions, the same endpoints, just not all
   shouting at once.

   `popover` does the hard parts natively: top layer (so the sidebar's
   overflow cannot clip it), light dismiss on an outside click, and Escape.
   Position is assigned on open rather than with CSS anchor positioning, which
   is newer than the Edge we are guaranteed on the target machine.

   `items` is `[{icon, text, danger?, run}]`; a `null` entry is a separator. */
function kebabMenu(items) {
  const btn = actionButton(SVG.dots, FA.moreActions);
  const menu = document.createElement("div");
  menu.className = "kebab-menu";
  menu.popover = "auto";

  for (const item of items) {
    if (!item) {
      menu.append(document.createElement("hr"));
      continue;
    }
    const row = document.createElement("button");
    row.type = "button";
    row.className = "kebab-item" + (item.danger ? " danger" : "");
    row.innerHTML = item.icon;
    row.append(label(item.text));
    row.addEventListener("click", async () => {
      // Destructive actions arm on the first click and fire on the second.
      // A confirm() would be an LTR browser modal, outside this app's RTL
      // discipline, and it would put the question away from the eye.
      if (item.danger && row.dataset.armed !== "true") {
        row.dataset.armed = "true";
        row.replaceChildren(label(FA.confirmDelete));
        return;
      }
      menu.hidePopover();
      try {
        await item.run();
      } catch (err) {
        return;   // the list reloads on the next event either way
      }
    });
    menu.append(row);
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();   // the row underneath must not also activate
    const rect = btn.getBoundingClientRect();
    menu.showPopover();
    // Measured only once it is in the top layer, so a menu near the bottom
    // of a long sidebar flips above its button instead of off-screen.
    const height = menu.offsetHeight;
    const below = rect.bottom + 4;
    menu.style.top = (below + height > innerHeight ? rect.top - height - 4 : below) + "px";
    menu.style.insetInlineStart = "";
    menu.style.left = Math.max(6, Math.min(rect.left, innerWidth - menu.offsetWidth - 6)) + "px";
  });

  return [btn, menu];
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
  ask: document.getElementById("perm-ask"),
  remember: document.getElementById("perm-remember"),
  title: document.getElementById("perm-title"),
  text: document.getElementById("perm-body"),
  allow: document.getElementById("perm-allow"),
  deny: document.getElementById("perm-deny"),
  queue: [],
  current: null,
};

/* AskUserQuestion travels over the permission pipe but is NOT a permission: the
   model is asking the user something and the answer rides back in the allow
   reply's `updatedInput.answers` (server.py ASK_TOOL). So the dialog has two
   modes, and the difference is not cosmetic — in ask mode there is nothing to
   "allow", the remember checkbox is meaningless, and dismissing must skip the
   question rather than refuse a tool call. */
const ASK_TOOL = "AskUserQuestion";

function askQuestions(req) {
  const list = req?.tool_name === ASK_TOOL && req.tool_input?.questions;
  return Array.isArray(list) && list.length ? list : null;
}

export function showPermission(req) {
  perm.queue.push(req);
  if (!perm.current) nextPermission();
}

function nextPermission() {
  perm.current = perm.queue.shift() ?? null;
  if (!perm.current) return;

  /* Optional chaining throughout: spec-test.html carries this markup as a copy,
     and a missing element must degrade, not take the whole renderer down with
     it — which is exactly what an unguarded replaceChildren() did once. */
  const questions = askQuestions(perm.current);
  perm.dialog.classList.toggle("asking", !!questions);
  if (perm.title) perm.title.textContent = questions ? FA.askTitle : FA.permTitle;
  if (perm.text) perm.text.textContent = questions ? FA.askBody : FA.permBody;
  if (perm.allow) perm.allow.textContent = questions ? FA.askSubmit : FA.permAllow;
  if (perm.deny) perm.deny.textContent = questions ? FA.askSkip : FA.permDeny;

  if (questions) {
    perm.tool?.replaceChildren();
    perm.params?.replaceChildren();
    perm.ask?.replaceChildren(renderQuestions(questions));
  } else {
    perm.ask?.replaceChildren();
    perm.tool?.replaceChildren(label(perm.current.tool_name ?? "?", "mono"));
    renderParams(perm.current.tool_name, perm.current.tool_input ?? {});
  }
  if (perm.remember) perm.remember.checked = false;
  if (!perm.dialog.open) perm.dialog.showModal();
  // A permission defaults to the safe answer (deny). A question has no unsafe
  // answer, so focus goes to the first option instead of to Skip.
  (questions ? perm.ask?.querySelector("input") : perm.deny)?.focus();
}

/* Built from the tool's own payload, so a question the model invents at runtime
   renders without any list here to keep in sync. Radio for a single choice,
   checkbox for multiSelect — the native controls carry keyboard support, group
   semantics and the checked state for free. */
function renderQuestions(questions) {
  const frag = document.createDocumentFragment();
  questions.forEach((q, index) => {
    const set = document.createElement("fieldset");
    set.className = "ask-q";
    set.dataset.question = q.question ?? "";

    if (q.header) {
      const legend = document.createElement("legend");
      legend.setAttribute("dir", "auto");
      legend.textContent = q.header;
      set.append(legend);
    }
    const text = document.createElement("p");
    text.className = "ask-text";
    text.setAttribute("dir", "auto");
    text.textContent = q.question ?? "";
    set.append(text);
    if (q.multiSelect) set.append(label(FA.askMulti, "ask-hint"));

    for (const option of q.options ?? []) {
      const row = document.createElement("label");
      row.className = "ask-opt";
      const box = document.createElement("input");
      box.type = q.multiSelect ? "checkbox" : "radio";
      box.name = "ask-" + index;
      box.value = option.label ?? "";
      row.append(box);
      const stack = document.createElement("span");
      stack.className = "ask-opt-text";
      stack.setAttribute("dir", "auto");
      // <bdi> so a Latin label ("Sparkling water") isolates instead of deciding
      // the direction of the Persian description under it — spec rule 2.
      const name = document.createElement("bdi");
      name.className = "ask-label";
      name.textContent = option.label ?? "";
      stack.append(name);
      if (option.description) stack.append(label(option.description, "ask-desc"));
      row.append(stack);
      set.append(row);
    }

    /* The tool always offers a free-text answer, so the dialog must too —
       otherwise a question whose real answer is none of the options can only be
       skipped. Typing here does not clear the boxes: the CLI accepts both. */
    const other = document.createElement("label");
    other.className = "ask-other";
    other.append(label(FA.askOther, "ask-label"));
    const field = document.createElement("input");
    field.type = "text";
    field.className = "ask-free";
    field.setAttribute("dir", "auto");
    field.placeholder = FA.askOtherPlaceholder;
    other.append(field);
    set.append(other);

    frag.append(set);
  });
  return frag;
}

/* Keyed by the question TEXT and valued with option labels — the CLI's own
   validator reads it that way (measured; wiki/permission-transport.md). A
   multiSelect answer may be an array, a single choice must be a string. */
function collectAnswers() {
  const answers = {};
  for (const set of perm.ask.querySelectorAll(".ask-q")) {
    const key = set.dataset.question;
    if (!key) continue;
    const picked = [...set.querySelectorAll("input:checked")].map((i) => i.value);
    const free = set.querySelector(".ask-free")?.value.trim();
    if (free) picked.push(free);
    if (!picked.length) continue;
    const multi = set.querySelector('input[type="checkbox"]');
    answers[key] = multi ? picked : picked[0];
  }
  return answers;
}

/* The dialog and the tool card render parameters with the SAME function
   (render.js). They used to differ, and the dialog's version forced every
   string LTR through pathEl — so a Persian Write.content or Edit.new_string
   was unreadable exactly at the moment of consent. Spec rule 8. */
function renderParams(toolName, toolInput) {
  if (!Object.keys(toolInput ?? {}).length) {
    perm.params?.replaceChildren("—");
    return;
  }
  // renderToolDetail, not renderParamRows: an Edit shows as a real diff here
  // too. This is the moment of consent — making the reader diff old_string
  // against new_string by eye is the worst possible place to do it.
  perm.params?.replaceChildren(renderToolDetail(toolName, toolInput));
}

async function resolvePermission(decision) {
  const req = perm.current;
  const asking = !!askQuestions(req);
  // Read the form before anything closes or the queue moves on.
  const answers = asking && decision === "allow" && perm.ask ? collectAnswers() : {};
  perm.current = null;
  if (perm.dialog.open) perm.dialog.close();
  if (!req) return;

  try {
    await fetch("/api/permission/respond?t=" + encodeURIComponent(token), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // Skipping a question is still an "allow" with an empty answer set —
        // the CLI reads that as "the user did not answer", where a deny would
        // reach the model as a tool failure.
        request_id: req.request_id,
        decision: asking ? "allow" : decision,
        remember: !asking && perm.remember.checked,
        tool_name: req.tool_name,
        ...(asking ? { answers } : {}),
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
    // Title, body and both button labels are set per request instead: they
    // differ between an approval and a question (nextPermission).
    document.getElementById("perm-remember-label").textContent = FA.permRemember;

    // Escape / backdrop dismissal must resolve as deny. Closing a window is not
    // consent, and leaving it unanswered would block the CLI until the timeout.
    // In ask mode resolvePermission turns that same deny into a skip.
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
