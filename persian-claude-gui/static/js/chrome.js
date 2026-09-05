/* ============================================================================
   Chrome around the conversation: sidebar (projects -> sessions), home/empty
   state, replay banner, and the permission dialog.

   Windows PATHS in chrome — statusline cwd, folder picker, session previews,
   tool-card params — must all use pathEl() (LTR + isolate + <bdi>). Plan §B-10
   item 2; the spec's message-shaped test cases cannot catch a regression here.
   A project's display NAME is not a path (it is renameable, and Persian as
   often as not): projectChip() below is what those sites use instead.
   ========================================================================= */
"use strict";

import { api, token } from "./api.js";
/* Cyclic with render.js on purpose (see the note there): the sidebar replays
   old transcripts through the shipping renderer — plan §B-4's "one renderer,
   two sources". Nothing below runs at module-evaluation time; initChrome() is
   called from app.js once every module is live. */
import {
  bubble, bulkAppend, label, renderEvent, renderToolDetail, resetTurn, state,
  setStatus, questionProse, questionOption,
} from "./render.js";
/* The numbered list every v2.4 dialog is made of. A leaf: it imports nothing,
   so sharing it with controls.js — which sits outside this cycle — costs no
   new edge (frontend-modules.md). */
import { optionList, digitIndex } from "./choice.js";
/* Adds chrome.js -> composer.js to the existing render/chrome/composer cycle.
   Safe by the same invariant the cycle already rests on: nothing here runs at
   evaluation time, and restoreDraft is a hoisted function declaration. It is
   imported rather than reimplemented because "append, never assign, on its own
   line" is a rule about not losing text that already has exactly one home. */
import { restoreDraft } from "./composer.js";

const FA = window.STRINGS;

const log = document.getElementById("log");

const ui = {
  topbarName: document.getElementById("topbar-name"),
  topbarCwd: document.getElementById("topbar-cwd"),
  projects: document.getElementById("projects"),
  openTabs: document.getElementById("open-tabs"),
  tabsTitle: document.getElementById("tabs-title"),
  btnNew: document.getElementById("btn-new"),
  projChip: document.getElementById("proj-chip"),
  projChipName: document.getElementById("proj-chip-name"),
  home: document.getElementById("home"),
  welTitle: document.getElementById("wel-title"),
  welCwdLabel: document.getElementById("wel-cwd-label"),
  welCwd: document.getElementById("wel-cwd"),
  welTips: document.getElementById("wel-tips"),
  banner: document.getElementById("replay-banner"),
};

let currentCwd = "";
let currentSession = null;
const expanded = new Set();   // lowercased project paths open in the sidebar
let autoExpanded = null;      // the project `expanded` was last auto-opened for
let lastProjects = [];        // what /api/projects last answered, for a repaint

/* The renderer owns the session id as of every system/init, but the sidebar
   owns the highlight, so the value lives here. `undefined` keeps the old value
   (the `ev.session_id ?? currentSession` semantics this replaces); an explicit
   `null` CLEARS it, which is what switching to a tab whose CLI has not spoken
   yet has to do — its session id genuinely is not known. */
export function setCurrentSession(sessionId) {
  if (sessionId !== undefined) currentSession = sessionId;
  syncWindowTitle();
}

/* --- open conversations (tabs) ---------------------------------------------

   app.js owns the tab registry; this module only draws it and asks to switch.
   The arrow is one-way on purpose: chrome.js is already in an import cycle with
   render.js, and importing the ENTRY module (whose body runs last) is the one
   shape that guarantees a temporal-dead-zone crash — see the load-order note in
   app.js. So app.js hands its two verbs in at init instead. */
let openTabs = [];        // [{tab, session_id, cwd, busy}] — app.js's view
let openActive = "";
let tabBridge = null;     // {switchTo(tab), close(tab)}
let lastTabsKey = "";     // identity of the last painted set, see setOpenTabs

const sessionTitles = new Map();   // session_id -> the title the sidebar shows

export function setTabBridge(bridge) {
  tabBridge = bridge;
}

export function setOpenTabs(list, active) {
  openTabs = Array.isArray(list) ? list : [];
  openActive = active || "";
  paintOpenTabs();
  // A session row's live dot and its click behaviour both depend on the tab
  // list, so the project tree repaints too — from what /api/projects already
  // answered, not by asking again. Only when the SET changed, though: this runs
  // a few times per turn, and a redraw cancels an open ⋯ menu or a rename
  // in progress by construction (startRename).
  const key = openTabs.map((t) => t.tab + ":" + (t.session_id || "")).join(",")
            + "|" + openActive;
  if (key === lastTabsKey) return;
  lastTabsKey = key;
  if (ui.projects) renderProjects(lastProjects);
}

function tabTitle(entry) {
  return (entry.session_id && sessionTitles.get(entry.session_id)) || FA.tabFresh;
}

function paintOpenTabs() {
  if (!ui.openTabs) return;   // spec-test.html has no sidebar
  ui.openTabs.replaceChildren();
  const any = openTabs.length > 0;
  ui.openTabs.hidden = !any;
  if (ui.tabsTitle) {
    ui.tabsTitle.hidden = !any;
    ui.tabsTitle.textContent = FA.openSessions;
  }
  if (!any) return;

  for (const entry of openTabs) {
    const row = document.createElement("div");
    row.className = "tab-row";
    row.dataset.current = String(entry.tab === openActive);
    row.dataset.busy = String(!!entry.busy);

    const open = document.createElement("button");
    open.type = "button";
    open.className = "tab-open";
    const dot = label("", "tab-dot");
    dot.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.className = "tab-name";
    name.setAttribute("dir", "auto");   // the user's own words, either script
    name.textContent = tabTitle(entry);
    open.append(dot, name);
    // Which project it is running in. A display NAME, not a path: it is
    // whatever the user renamed the project to and is Persian as often as not,
    // so pathEl's forced LTR would misorder it and seat it on the wrong side of
    // an RTL row. The full path stays in the tooltip, which is the thing that
    // actually disambiguates two folders (plan §B-10 item 2 is about paths, and
    // this stopped being one).
    if (entry.cwd) {
      open.append(projectChip(entry.cwd));
    }
    open.title = entry.cwd || tabTitle(entry);
    open.addEventListener("click", () => tabBridge?.switchTo(entry.tab));

    const close = actionButton("×", FA.closeSession);
    close.classList.add("tab-close");
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      tabBridge?.close(entry.tab);
    });

    row.append(open, close);
    ui.openTabs.append(row);
  }
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
  pin: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3z"/></svg>',
  unpin: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3z"/><path d="M4 4l16 16"/></svg>',
  explorer: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><path d="M14 11h4v4"/><path d="M18 11l-5 5"/></svg>',
  rename: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h16"/><path d="M14.5 4.5l3 3L8 17l-4 1 1-4z"/></svg>',
};

function basename(p) {
  return (p || "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p || "";
}

/* Display-name overrides, lowercased path -> name (server: names.json). Filled
   from the /api/projects payload the sidebar already fetches; the folder's own
   name is the fallback, so a project with no override needs no entry. */
const projNames = new Map();
const NAME_MAX = 64;   // server.py NAME_MAX — the field stops where it stops

function displayName(path) {
  return projNames.get((path || "").toLowerCase()) || basename(path);
}

/* The project a conversation belongs to, as a chrome chip. Built the same way
   the sidebar builds its own project label: a <bdi dir="auto">, so a Persian
   name reads right-to-left, a Latin one still resolves LTR, and either is
   isolated from the Persian around it (spec rule 2). The tooltip keeps the real
   path — that, not the label, is what tells two same-named folders apart. */
function projectChip(cwd) {
  const chip = document.createElement("bdi");
  chip.className = "tab-proj";
  chip.setAttribute("dir", "auto");
  chip.textContent = displayName(cwd);
  chip.title = cwd;
  return chip;
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

/* The window title is the session's own title (V2-PLAN §3.4, last-but-two
   row). It used to be the constant «کلاد فارسی — vX», on the grounds that an
   OS titlebar cannot carry <bdi> — true, and it is why the title is ONE run
   plus the product name rather than a title glued to a path or a version:
   a titlebar has no isolation, so anything mixed into it is at the mercy of
   the platform's own bidi pass. A conversation title and a Persian product
   name resolve together; a Windows path next to either would not, which is
   why the cwd stays out of here and lives in the status line.

   `document.title` is set from the same map the sidebar draws from, so the
   window and the session row can never disagree about what a conversation is
   called. */
const BASE_TITLE = document.title;

function syncWindowTitle() {
  const title = currentSession && sessionTitles.get(currentSession);
  document.title = title ? `${title} — ${FA.appName}` : BASE_TITLE;
}

/* Project name and cwd everywhere in chrome: topbar, composer chip. */
export function setChrome(cwd) {
  if (cwd) currentCwd = cwd;
  // render.js calls this on system/init with a bare cwd, before any projects
  // fetch, so the folder name is what shows for a moment; the debounced
  // refreshProjects() that follows corrects it to the override.
  const name = displayName(currentCwd);
  if (ui.topbarName) ui.topbarName.textContent = name;
  if (ui.topbarCwd) ui.topbarCwd.textContent = currentCwd;
  if (ui.projChipName) {
    ui.projChipName.textContent = name || FA.chooseProject;
    ui.projChip.title = currentCwd;
  }
}

/* --- home / empty state: the TUI's welcome box ------------------------------

   V2-PLAN §2 deletes the greeting and the four action cards; what a terminal
   shows on an empty session is a box saying which program this is, which
   folder it is in, and how to start typing. Everything the cards did is still
   reachable: «باز کردن پوشه» is the folder chip and the sidebar, «راهنما» is
   the sidebar's own button, and «ادامه آخرین گفتگو» is the session list one
   line below the project — which is also the surface `/resume` now moves
   focus into (§3.3).

   The three hints are the TUI's composer footer (wiki/tui-strings.md §5), and
   they name keys this page really binds: `/` opens the slash popup, `@` the
   file menu, `?` the key sheet (js/composer.js). */
const WELCOME_TIPS = [
  ["/", "welTipCommands"],
  ["@", "welTipMention"],
  ["?", "welTipKeys"],
];

function paintWelcome() {
  if (!ui.welTitle) return;
  ui.welTitle.textContent = FA.welcomeTitle;
  ui.welCwdLabel.textContent = FA.welcomeCwd;
  // A Windows path in chrome: .path + <bdi>, the sweep plan §B-10 item 2 is
  // about. Empty until a project is open, which is what the placeholder says.
  ui.welCwd.textContent = currentCwd || FA.welcomeNoProject;
  ui.welCwd.classList.toggle("is-empty", !currentCwd);
  ui.welTips.replaceChildren();
  for (const [key, stringKey] of WELCOME_TIPS) {
    const li = document.createElement("li");
    li.append(label(key, "wel-tip-key"), label(FA[stringKey], "wel-tip-text"));
    ui.welTips.append(li);
  }
}

function syncHome() {
  if (!ui.home) return;   // spec-test.html has no home section
  const empty = log.childElementCount === 0;
  if (empty) paintWelcome();
  document.body.classList.toggle("home", empty);
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
  // Rebuilt, not merged: a name deleted on the server must disappear here too.
  projNames.clear();
  sessionTitles.clear();
  for (const proj of data.projects ?? []) {
    if (proj.name) projNames.set(proj.path.toLowerCase(), proj.name);
    for (const sess of proj.sessions ?? []) {
      // The open-conversations group names a tab by what the sidebar already
      // calls that session — one source of truth for a title, and a tab whose
      // CLI has not answered yet has no session id and says «گفتگوی تازه».
      sessionTitles.set(sess.session_id,
        sess.title || sess.preview || sess.session_id.slice(0, 8));
    }
  }
  setChrome();
  lastProjects = data.projects ?? [];
  renderProjects(lastProjects);
  paintOpenTabs();   // titles may have only just arrived

  syncHome();          // the welcome box names the folder, which may have changed
  syncWindowTitle();   // and this is where a session's title finally arrives
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
  name.textContent = displayName(proj.path);
  // The tooltip stays the real path even when the label does not: it is the
  // only thing that tells two folders with the same name apart.
  name.title = proj.path;
  head.append(name);
  // Why this project is at the top. Without it the sort looks like a bug the
  // first time a pinned project outranks one used five minutes ago.
  if (proj.pinned) {
    const mark = label("", "proj-pin");
    mark.innerHTML = SVG.pin;
    mark.title = FA.pinnedProject;
    head.append(mark);
  }
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
  // the folder on disk. The OPEN project keeps its menu — hiding the ⋯ entirely
  // made a working action (archive) look missing — but not the delete: the CLI
  // is writing into that folder's transcript right now and the server refuses
  // it with a 409. The menu says which one it is instead of going quiet.
  top.append(...kebabMenu([
    {
      // Renames the label only — see startRename().
      icon: SVG.rename,
      text: FA.renameProject,
      run: () => startRename(top, head, proj),
    },
    {
      icon: proj.pinned ? SVG.unpin : SVG.pin,
      text: proj.pinned ? FA.unpinProject : FA.pinProject,
      run: async () => {
        await api("/api/project/pin", { path: proj.path, pinned: !proj.pinned });
        loadProjects();
      },
    },
    {
      // The one action here that is about the FOLDER rather than about the
      // conversation. The server opens it through the shell, so whatever the
      // user has set as their file manager is what appears.
      icon: SVG.explorer,
      text: FA.openInExplorer,
      run: () => api("/api/project/reveal", { path: proj.path }),
    },
    null,
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
    isCurrent ? { note: FA.projectOpenNote } : {
      icon: SVG.trash,
      text: FA.removeProject,
      danger: true,
      run: async () => {
        await api("/api/project/remove", { path: proj.path });
        loadProjects();
      },
    },
  ]));
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

/* Rename in place: the row itself becomes the field, so the thing being named
   is the thing being looked at. Only the LABEL changes — no folder on disk is
   touched and the CLI is never told, which is why the tooltip and the
   statusline keep showing the real path.

   The field REPLACES the head button rather than living inside it: an <input>
   nested in a <button> is invalid content, and every click in it would also
   activate the button and collapse the row underneath.

   All of the edit state is this one element. Nothing is stashed at module
   level, so a sidebar redraw (which replaces every row) ends the edit by
   construction — the "armed delete survived the menu reopen" defect cannot
   have a rename-shaped sibling. */
function startRename(top, head, proj) {
  if (top.querySelector(".proj-rename")) return;
  const field = document.createElement("input");
  field.type = "text";
  field.className = "proj-rename";
  field.setAttribute("dir", "auto");   // the name can be either script
  field.maxLength = NAME_MAX;
  field.value = displayName(proj.path);
  field.title = proj.path;
  head.hidden = true;
  top.prepend(field);
  field.focus();
  field.select();

  let closed = false;
  const close = () => {
    if (closed) return;   // remove() below fires blur, which calls this again
    closed = true;
    field.remove();
    head.hidden = false;
  };
  // Walking away cancels: blur is a decision not to answer, not an answer.
  field.addEventListener("blur", close);
  field.addEventListener("keydown", async (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== "Enter") return;
    e.preventDefault();
    const value = field.value.trim();   // empty resets to the folder's name
    close();
    try {
      await api("/api/project/rename", { path: proj.path, name: value });
    } catch (err) {
      return;   // the label is unchanged, which is the truth
    }
    loadProjects();
  });
}

function sessionRow(sess, projPath, isCurrent) {
  const li = document.createElement("li");
  li.dataset.current = String(isCurrent);
  // Open in a tab right now — in ANY project, not just this one. Clicking it
  // must switch to that conversation rather than resume it a second time: two
  // CLI processes appending to one transcript is corruption, and the server
  // refuses it anyway (it adopts the tab instead).
  const liveTab = openTabs.find((t) => t.session_id === sess.session_id)?.tab;
  li.dataset.live = String(!!liveTab);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "sess";
  if (liveTab) {
    const dot = label("", "sess-dot");
    dot.setAttribute("aria-hidden", "true");
    dot.title = FA.sessionLive;
    btn.append(dot);
  }
  const preview = document.createElement("span");
  preview.className = "sess-preview";
  preview.setAttribute("dir", "auto");   // user text: could be either script
  // A real title if the session has one (the wrapper names each new session
  // after its first prompt via rename_session, and the CLI stores it in the
  // transcript). The 160-char first-prompt preview is the fallback.
  preview.textContent = sess.title || sess.preview || sess.session_id.slice(0, 8);
  preview.title = sess.preview || "";
  btn.append(preview, label(whenLabel(sess.modified), "sess-when"));
  btn.addEventListener("click", () => {
    if (liveTab) tabBridge?.switchTo(liveTab);
    else resumeSession(sess.session_id, projPath);
  });

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
  const disarmers = [];

  for (const item of items) {
    if (!item) {
      menu.append(document.createElement("hr"));
      continue;
    }
    // A line of explanation where an action cannot be offered. Not a disabled
    // button: a control you can press and nothing happens is worse than a
    // sentence saying why it is not there.
    if (item.note) {
      const note = label(item.note, "kebab-note");
      note.setAttribute("dir", "auto");
      menu.append(note);
      continue;
    }
    const row = document.createElement("button");
    row.type = "button";
    row.className = "kebab-item" + (item.danger ? " danger" : "");
    row.innerHTML = item.icon;
    const text = label(item.text);
    row.append(text);

    // Arming swaps the LABEL and keeps the row: a rebuilt row loses its icon,
    // and — the actual defect — nothing ever put it back, so a menu reopened
    // an hour later still showed a red «مطمئنید؟» waiting to be answered by
    // the first click that landed on it. Disarmed on every open, below.
    disarmers.push(() => {
      delete row.dataset.armed;
      text.textContent = item.text;
    });

    row.addEventListener("click", async () => {
      // Destructive actions arm on the first click and fire on the second.
      // A confirm() would be an LTR browser modal, outside this app's RTL
      // discipline, and it would put the question away from the eye.
      if (item.danger && row.dataset.armed !== "true") {
        row.dataset.armed = "true";
        text.textContent = FA.confirmDelete;
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
    for (const disarm of disarmers) disarm();
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
  // WHOSE view this replaces, pinned before the fetch and resolved again after
  // it: the user can switch conversations while a transcript is in the air, and
  // rendering it into whatever is on screen then would hand one conversation
  // another one's history — permanently, at the next park (app.js).
  const tab = tabBridge?.active?.();
  let data;
  try {
    data = await api("/api/session?id=" + encodeURIComponent(sessionId)
                     + "&cwd=" + encodeURIComponent(projPath || currentCwd));
  } catch (err) {
    bubble("error", FA.sendFailed);
    return;
  }
  renderInto(tab, data.events);
  showReplayBanner(sessionId, projPath);
}

/* An old transcript, into the tab it was asked for. Nothing here paints window
   chrome: for a parked tab the renderer is pointed at its buffer and `state` IS
   that tab's scope for the length of the call, so the cards, the tool-card map
   and the cleared view all belong to the conversation being filled. A tab that
   was closed while the fetch was out gets nothing at all (app.js renderInTab).
   Shared by replay and by a resumed session's backfill — the two differ only in
   whether the closing «گفتگو از سر گرفته شد» line is added. */
function renderInto(tab, events, resumedNote = false) {
  tabBridge?.renderIn(tab, (node) => {
    node.replaceChildren();
    resetTurn();
    state.toolCards.clear();
    // A finished transcript in one synchronous loop: every append() would ask
    // "is the reader at the bottom?" and force a layout to answer, hundreds of
    // times, about a view that is not on screen yet. The answer is only needed
    // once, below.
    bulkAppend(() => {
      for (const event of events ?? []) renderEvent(event);
      if (resumedNote) bubble("assistant", FA.resumed).classList.add("meta");
    });
    node.scrollTop = node.scrollHeight;   // a replay opens at its newest message
  });
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

/* Resuming is a SPAWN now: the conversation opens in a tab of its own and
   everything already running keeps running. The server answers `adopted: true`
   when that session was live all along, and then there is nothing to resume —
   only a tab to switch to. */
async function resumeSession(sessionId, projPath) {
  const live = openTabs.find((t) => t.session_id === sessionId)?.tab;
  if (live) {
    await tabBridge?.switchTo(live);
    return;
  }
  ui.banner.hidden = true;
  let data;
  try {
    data = await api("/api/session/resume", { session_id: sessionId, path: projPath });
  } catch (err) {
    reportOpenFailure(err);
    return;
  }
  await tabBridge?.switchTo(data.tab);
  if (data.adopted) return;   // it was already on screen in that tab
  // The switch can be refused (that tab is gone) or overtaken by the user, and
  // it swallows the failure — so the window-level facts are only true if the
  // resumed conversation is the one actually being looked at.
  if (tabBridge?.active?.() === data.tab) {
    currentSession = sessionId;
    if (projPath) setChrome(projPath);
  }
  // A resumed CLI does not re-emit the conversation, so the new tab's view
  // would be empty: replay the transcript into it, through the one renderer.
  let history;
  try {
    history = await api("/api/session?id=" + encodeURIComponent(sessionId)
                        + "&cwd=" + encodeURIComponent(projPath || currentCwd));
  } catch (err) {
    return;   // the session IS resumed; only its backfill failed to arrive
  }
  renderInto(data.tab, history.events, true);
  refreshProjects();
}

/* «گفتگوی جدید» and the folder picker both land here, and both now OPEN one
   more conversation instead of killing the one that was running. */
async function switchProject(folder) {
  if (!folder) return;
  if (ui.banner) ui.banner.hidden = true;
  try {
    const data = await api("/api/project/open", { path: folder });
    await tabBridge?.switchTo(data.tab);
    // The new tab's CLI has not said anything yet, so its own scope is empty:
    // seed the folder it was opened in rather than leaving the previous
    // conversation's name in the topbar for a second.
    setStatus({ cwd: data.cwd });
    setCurrentSession(null);
    setChrome(data.cwd);
    refreshProjects();
  } catch (err) {
    reportOpenFailure(err);
  }
}

/* The one failure a user can actually cause here: six conversations already
   open. The server answers 409 with `max_tabs`; api() throws with the status in
   its message, which is the same shape agents.js reads a 404 out of. */
function reportOpenFailure(err) {
  bubble("error", /-> 409$/.test(err?.message ?? "") ? FA.maxTabs : FA.sendFailed);
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
  source: document.getElementById("perm-source"),
  allow: document.getElementById("perm-allow"),
  deny: document.getElementById("perm-deny"),
  proceed: document.getElementById("perm-proceed"),
  opts: document.getElementById("perm-opts"),
  feedback: document.getElementById("perm-feedback"),
  hint: document.getElementById("perm-hint"),
  queue: [],
  current: null,
  list: null,          // the live optionList controller, or null in ask mode
};

/* AskUserQuestion travels over the permission pipe but is NOT a permission: the
   model is asking the user something and the answer rides back in the allow
   reply's `updatedInput.answers` (server.py ASK_TOOL). So the dialog has two
   modes, and the difference is not cosmetic — in ask mode there is nothing to
   "allow", the remember checkbox is meaningless, and dismissing must skip the
   question rather than refuse a tool call. */
const ASK_TOOL = "AskUserQuestion";
/* The plan approval of V2-PLAN §3.3. It travels the same pipe and renders with
   the same numbered options; what it does not get is «don't ask again». */
const PLAN_TOOL = "ExitPlanMode";

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
  paintPermSource(perm.current.tab);
  perm.dialog.classList.toggle("asking", !!questions);
  const planning = perm.current.tool_name === PLAN_TOOL;
  if (perm.title) {
    perm.title.textContent = questions ? FA.askTitle
                           : planning ? FA.planTitle : FA.permTitle;
  }
  if (perm.text) {
    perm.text.textContent = questions ? FA.askBody
                          : planning ? FA.planBody : FA.permBody;
  }
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
  paintOptions(questions);
  /* show(), not showModal(): v2.4 puts the dialog IN THE FLOW above the prompt,
     where the Ink TUI draws it (V2-PLAN §3.3). `open` still reads true, the CSS
     is unchanged, and what is given up — the backdrop and the focus trap — is
     exactly what made it a modal rather than a row. */
  if (!perm.dialog.open) perm.dialog.show();
  // A question has no unsafe answer, so focus goes to its first option. A
  // permission focuses the LIST, whose highlight starts on «۱. بله» — the
  // digit, not the highlight, is what actually answers it, and Esc is still
  // one key away from the safe reply.
  (questions ? perm.ask?.querySelector("input") : perm.list?.el)?.focus();
}

/* The three options, in the TUI's own order (wiki/tui-strings.md §2). Option 2
   exists ONLY when a remember scope applies, which is why the digit cannot be
   part of the label — «۳.» is the refusal whether or not «۲.» was drawn
   (V2-PLAN §8.2). */
function permOptions(req) {
  const tool = req?.tool_name ?? "?";
  const rows = [{ key: "allow", title: FA.permYes }];
  if (rememberable(req)) {
    // No directory in the wording: v1's remember scope is THIS PROJECT, THIS
    // SESSION, and naming a path would describe a scope the window does not
    // implement (V2-PLAN §8.1).
    rows.push({ key: "remember", title: FA.permYesRemember.replace("{tool}", tool) });
  }
  rows.push({ key: "deny", title: FA.permNoFeedback, esc: true });
  return rows;
}

/* «دیگر نپرس» is a standing grant for a TOOL. A plan is approved once —
   ExitPlanMode has no next call to skip — and a question is not an approval at
   all, so neither offers the row. */
function rememberable(req) {
  return !!req?.tool_name && req.tool_name !== ASK_TOOL
      && req.tool_name !== PLAN_TOOL;
}

function paintOptions(questions) {
  if (!perm.opts) return;          // spec-test.html carries a copy of this markup
  perm.list = null;
  perm.opts.replaceChildren();
  if (perm.feedback) {
    perm.feedback.value = "";
    perm.feedback.placeholder = FA.permFeedbackPlaceholder;
  }
  if (perm.proceed) perm.proceed.textContent = FA.permProceed;
  if (perm.hint) perm.hint.textContent = questions ? FA.askHint : FA.permHint;
  if (questions) return;           // ask mode answers with its own inputs
  perm.list = optionList(permOptions(perm.current), {
    onPick: (key) => resolvePermission("allow", { remember: key === "remember" }),
    onCancel: () => resolvePermission("deny"),
    onKey: permListKey,
  });
  perm.opts.append(perm.list.el);
}

/* The two Confirmation-context keys the list itself does not own
   (wiki/tui-keys.md). Tab is `confirm:nextField` — here there are exactly two
   fields, the options and the note — and shift+tab is the TUI's «approve with
   this feedback». */
function permListKey(e) {
  if (e.key === "Tab" && !e.shiftKey) {
    e.preventDefault();
    perm.feedback?.focus();
    return;
  }
  if (e.key === "Tab" && e.shiftKey) {
    e.preventDefault();
    approveWithFeedback();
  }
}

/* «shift+tab to approve with this feedback», as far as this pipe allows it.
   `can_use_tool`'s ALLOW reply carries `updatedInput` and nothing else
   (wiki/permission-transport.md), so there is no field a note can ride in
   alongside an approval — inventing one would be a sentence the model never
   sees. The tool is approved and the note is handed to the composer instead,
   where the person can read it, edit it and send it as the next message. */
function approveWithFeedback() {
  const note = feedbackText();
  resolvePermission("allow");
  if (note) {
    restoreDraft(note);
    bubble("meta", FA.permFeedbackMoved);
  }
}

function feedbackText() {
  return perm.feedback?.value.trim() ?? "";
}

/* ONE dialog serves every open conversation, so when the asking one is not the
   one on screen it has to say WHICH — «اجازه بده» to a tool you cannot see
   running, in a project you are not looking at, is exactly the consent this
   window exists to make legible. Silent for the visible tab: naming the
   conversation you are already reading is noise. */
function paintPermSource(tab) {
  if (!perm.source) return;
  // `openActive` is empty until /api/tabs has answered — before that this
  // window does not know which conversation it is showing, and guessing
  // "another one" would be a false alarm on the very first request.
  const other = !!tab && !!openActive && tab !== openActive;
  perm.source.hidden = !other;
  if (!other) return;
  // A tab that spawned a moment ago may not be in the list yet. It is still not
  // the one on screen, and saying so unnamed beats saying nothing at all.
  const entry = openTabs.find((t) => t.tab === tab);
  const name = document.createElement("bdi");
  name.setAttribute("dir", "auto");   // the user's own words, either script
  name.textContent = entry ? tabTitle(entry) : FA.tabFresh;
  perm.source.replaceChildren(document.createTextNode(FA.permOtherSession + " "), name);
  if (entry?.cwd) perm.source.append(projectChip(entry.cwd));
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

    /* The prose — header, question, and each option below — goes through
       render.js's builders, which are the ONE implementation of the BiDi
       contract for this tool. This is the place the user has to READ the
       question to answer it, and as textContent an inline `code` span kept its
       backticks and its neutral characters («/price-photo/») reordered against
       the Persian around them: the scrambled question that was reported. This
       file keeps the chrome — the fieldset, the inputs, the free-text box. */
    if (q.header) {
      set.append(questionProse(document.createElement("legend"), q.header));
    }
    const text = document.createElement("p");
    text.className = "ask-text";
    set.append(questionProse(text, q.question));
    if (q.multiSelect) set.append(label(FA.askMulti, "ask-hint"));

    (q.options ?? []).forEach((option, at) => {
      const row = document.createElement("label");
      row.className = "ask-opt";
      const box = document.createElement("input");
      box.type = q.multiSelect ? "checkbox" : "radio";
      box.name = "ask-" + index;
      // The RAW label, never the rendered one: this value is the wire format
      // the CLI matches the answer against (wiki/permission-transport.md).
      box.value = option.label ?? "";
      row.append(box);
      /* Numbered like every other v2.4 dialog (V2-PLAN §3.3, «options
         numbered»), and for the same reason the permission list is: the digit
         is chrome the renderer places, never text inside the Persian label
         (§8.2). It is aria-hidden because the input beside it already carries
         the row's name and position for a screen reader. */
      const num = document.createElement("span");
      num.className = "opt-num";
      num.setAttribute("dir", "ltr");
      num.setAttribute("aria-hidden", "true");
      num.textContent = (at + 1).toLocaleString("fa-IR") + ".";
      row.append(num);
      const stack = document.createElement("span");
      stack.className = "ask-opt-text";
      row.append(questionOption(stack, option, "ask-label", "ask-desc"));
      set.append(row);
    });

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

/* AskUserQuestion's own Confirmation keys (wiki/tui-keys.md). The native
   radio/checkbox behaviour would cover the arrows and Space on a real key
   press, but it is a DEFAULT ACTION — it does not run for a synthetic event,
   so a gate could never see it, and «the browser probably does this» is not a
   promise this project keeps anywhere else. Bound explicitly, and
   preventDefault stops the native move from happening twice. */
function askOptionRows(from) {
  const set = from?.closest?.(".ask-q") ?? perm.ask?.querySelector(".ask-q");
  return [set, [...(set?.querySelectorAll(".ask-opt input") ?? [])]];
}

function askKeys(e) {
  const [, inputs] = askOptionRows(e.target);
  if (!inputs.length) return;
  const at = Math.max(0, inputs.indexOf(e.target));

  const digit = digitIndex(e);
  if (digit >= 0 && digit < inputs.length) {
    e.preventDefault();
    askChoose(inputs[digit]);
    return;
  }
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const step = e.key === "ArrowDown" ? 1 : -1;
    inputs[(at + step + inputs.length) % inputs.length].focus();
    return;
  }
  if (e.key === " " || e.key === "Spacebar") {
    // `confirm:toggle`. A checkbox flips; a radio is a choice and cannot be
    // un-chosen, so the same key simply picks the row it is on.
    e.preventDefault();
    askChoose(inputs[at], true);
  }
}

function askChoose(box, toggle = false) {
  if (!box) return;
  box.checked = box.type === "checkbox" ? (toggle ? !box.checked : true) : true;
  box.focus();
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

async function resolvePermission(decision, { remember = false } = {}) {
  const req = perm.current;
  const asking = !!askQuestions(req);
  // Read the form before anything closes or the queue moves on.
  const answers = asking && decision === "allow" && perm.ask ? collectAnswers() : {};
  // Option 3's «tell Claude what to do differently»: the note only means
  // anything on a refusal, which is the one reply that carries a message back
  // to the model (server.py PermissionBroker.respond).
  const feedback = !asking && decision === "deny" ? feedbackText() : "";
  perm.current = null;
  perm.list = null;
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
        // The checkbox is the harness's copy of this markup; the numbered list
        // is the window's «۲. بله، و دیگر برای … نپرس». Either one is consent
        // given once, and neither exists in ask mode.
        remember: !asking && (remember || !!perm.remember?.checked),
        tool_name: req.tool_name,
        ...(asking ? { answers } : {}),
        ...(feedback ? { feedback } : {}),
      }),
    });
  } catch (err) {
    console.error("permission respond failed", err);
  }
  nextPermission();
}

/* Requests that can no longer be answered: they leave the queue, and the dialog
   goes with them if it was the one asking. */
function dropPermissions(match) {
  perm.queue = perm.queue.filter((req) => !match(req));
  if (perm.current && match(perm.current)) {
    perm.current = null;
    if (perm.dialog?.open) perm.dialog.close();
    nextPermission();
  }
}

/* The server resolved it without us (timeout, or another window answered). */
export function dismissPermission(requestId) {
  dropPermissions((req) => req.request_id === requestId);
}

/* That conversation is gone (app.js dropTab, off a tagged `wrapper/closed`).
   The server denies whatever was pending before it drops the tab, so the
   resolved event normally clears these first — this is the belt for the race
   where it does not, because a dialog still asking on behalf of a dead CLI can
   only be answered into nothing. */
export function dismissTabPermissions(tab) {
  if (tab) dropPermissions((req) => req.tab === tab);
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

    document.getElementById("perm-hint");   // labels are set per request

    /* Escape must resolve as deny wherever focus is inside the dialog. A
       non-modal <dialog> fires no `cancel` event, so this replaces the handler
       that used to rely on one — and it is bound on the dialog rather than the
       list so that Escape out of the feedback box means the same thing. In ask
       mode resolvePermission turns the same deny into a skip. */
    perm.dialog.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      resolvePermission("deny");
    });

    /* Two buttons, no submit: the dialog's form has no submit button at all
       any more, which retires by construction the 2026-08-31 defect where
       implicit submission clicked the tree-first one (#perm-deny) and turned a
       typed answer into a skip. The keydown handler below still claims Enter
       inside the question area for the same reason it always did. */
    perm.allow?.addEventListener("click", () => resolvePermission("allow"));
    perm.deny?.addEventListener("click", () => resolvePermission("deny"));

    /* The feedback box is the second of the confirmation's two fields
       (`confirm:nextField`). Tab goes back to the options; shift+tab is the
       TUI's «approve with this feedback». Enter is left alone — a note is
       prose and may need more than one line. */
    perm.feedback?.addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return;
      e.preventDefault();
      if (e.shiftKey) approveWithFeedback();
      else perm.list?.focus();
    });

    // Enter inside the question area ANSWERS, never skips. Implicit form
    // submission "clicks" the form's default button — the tree-first submit
    // button, which is #perm-deny — so typing a free-text answer (or picking a
    // radio, where focus starts) and pressing Enter submitted the skip: the
    // CLI reported "the user did not answer" with the form fully filled in
    // (reported 2026-08-31). Only ask mode populates #perm-ask, so a plain
    // permission never reaches this handler.
    perm.ask?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        resolvePermission("allow");
        return;
      }
      // Inside the free-text box every other key is a character the person is
      // typing — a digit is a digit and a space is a space. Only Enter, above,
      // is claimed there, which is what the 2026-08-31 fix is.
      if (e.target?.classList?.contains("ask-free")) return;
      askKeys(e);
    });
  }
}
