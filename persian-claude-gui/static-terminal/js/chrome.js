/* ============================================================================
   Chrome around the conversation: sidebar (projects -> sessions), home/empty
   state and the replay banner. The permission dialog left for js/perm.js in
   MA3-T1 — it is per CELL, this file is per WINDOW.

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
  bubble, bulkAppend, label, renderEvent, resetTurn, state, setStatus,
} from "./render.js";
/* The dots on the open-conversations rows are painted from what the permission
   dialogs are asking. One arrow each way (perm.js reads the tab list back), and
   nothing crosses either at module-evaluation time. */
import { permAsking, permSeenTab } from "./perm.js";

const FA = window.STRINGS;

// Window-level chrome: one of each, whatever the split is.
const ui = {
  projects: document.getElementById("projects"),
  openTabs: document.getElementById("open-tabs"),
  tabsTitle: document.getElementById("tabs-title"),
  btnNew: document.getElementById("btn-new"),
};

/* THE CELL-LOCAL HALF (MA3-T2). The topbar, the welcome box, the folder chip
   and the replay banner belong to ONE column, and there are up to four of them
   — so they are looked up inside the cell that owns them rather than once at
   load, where every lookup would have found cell 1. Cached on the cell itself,
   which is the only object whose lifetime they share.
   spec-test.html has none of this markup: every field comes back null and every
   caller below is written to degrade rather than throw. */
function cui(cell) {
  if (!cell) return {};
  if (!cell.chromeUI) {
    const q = (cls) => cell.root.querySelector("." + cls);
    cell.chromeUI = {
      topbarName: q("topbar-name"), topbarTitle: q("topbar-title"),
      cellDot: q("cell-dot"),
      projChip: q("proj-chip"), projChipName: q("proj-chip-name"),
      home: q("home"), welTitle: q("wel-title"), welCwdLabel: q("wel-cwd-label"),
      welCwd: q("wel-cwd"), welTips: q("wel-tips"), banner: q("replay-banner"),
    };
  }
  return cell.chromeUI;
}

/* Which column a piece of chrome belongs to when the caller did not say: the
   one being rendered into (render.js `state.cell`), and failing that the one
   the keyboard is in. */
function chromeCell(cell) {
  return cell ?? state.cell ?? tabBridge?.focused?.() ?? null;
}

function focusedRef() {
  return tabBridge?.focused?.() ?? null;
}

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
let openTabs = [];        // [{tab, session_id, cwd, busy, pending_permission}]
let openActive = "";
let tabBridge = null;     // {switchTo(tab), close(tab)}
let lastTabsKey = "";     // identity of the last painted set, see setOpenTabs
/* tab -> {running, error, unread}: what app.js reads off each conversation's
   own render scope, which is the only place those three facts exist. Kept
   between paints, because setOpenTabs is also called by callers that have no
   opinion about them (the spec harness, a title arriving late). */
let liveFacts = {};

const sessionTitles = new Map();   // session_id -> the title the sidebar shows

export function setTabBridge(bridge) {
  tabBridge = bridge;
}

export function setOpenTabs(list, active, facts) {
  openTabs = Array.isArray(list) ? list : [];
  openActive = active || "";
  // Omitted means "no news", not "none": the harness and the title-arrived
  // repaint below both call this with two arguments.
  if (facts) liveFacts = facts;
  repaintTabs();
}

/* Every paint of the open-conversations group, and of the session rows whose
   dot mirrors it. Separate from setOpenTabs() because the permission queue
   changes a tab's status without the tab LIST changing at all. */
export function repaintTabs() {
  paintOpenTabs();
  paintCells();
  // A session row's live dot and its click behaviour both depend on the tab
  // list, so the project tree repaints too — from what /api/projects already
  // answered, not by asking again. Only when the SET changed, though: this runs
  // a few times per turn, and a redraw cancels an open ⋯ menu or a rename
  // in progress by construction (startRename). The status is part of the key
  // because it is painted on those rows too — a dot that goes red in the
  // sidebar with the tree untouched would otherwise never repaint.
  const key = openTabs.map((t) => t.tab + ":" + (t.session_id || "")
                                 + ":" + tabStatus(t.tab)).join(",")
            + "|" + openActive;
  if (key === lastTabsKey) return;
  lastTabsKey = key;
  if (ui.projects) renderProjects(lastProjects);
}

/* THE ONE PLACE A CONVERSATION'S STATE IS DECIDED. Four values, painted as
   `data-status` on the tab's dot and on the matching session row's:

     waiting  a `can_use_tool` / AskUserQuestion is sitting on a human. First,
              because it is the only one that will not resolve itself.
     running  the uuid ledger for that tab is not empty (render.js state).
     error    its last turn failed — a real failure, never a stop, and never
              the aborted `result` a stop produces (render.js state.error).
     idle     nothing to say.

   Everything it reads is already kept somewhere else: the dialogs (js/perm.js),
   and the facts app.js hands in. No second bookkeeping path, and no polling. */
function tabStatus(tab) {
  if (isWaiting(tab)) return "waiting";
  const facts = liveFacts[tab];
  if (facts?.running) return "running";
  if (facts?.error) return "error";
  return "idle";
}

function isWaiting(tab) {
  if (!tab) return false;
  if (permAsking(tab)) return true;
  return !permSeenTab(tab)
    && !!openTabs.find((t) => t.tab === tab)?.pending_permission;
}

/* «۲ منتظر تأیید» / «۳ در حال کار» over the whole list: what is happening in
   the conversations that are NOT on screen is the only thing this header can
   usefully add. Waiting wins and there is only ever ONE chip — a header
   carrying two numbers is read as neither, and the one that needs a person is
   the one worth reading. */
function tabsBadge() {
  let running = 0;
  let waiting = 0;
  for (const entry of openTabs) {
    const status = tabStatus(entry.tab);
    if (status === "waiting") waiting += 1;
    else if (status === "running") running += 1;
  }
  const count = waiting || running;
  if (!count) return null;
  const digits = count.toLocaleString("fa-IR");
  const text = FA[waiting ? "tabsWaiting" : "tabsRunning"].replace("{n}", digits);
  const chip = label(text, "tabs-badge");
  chip.dataset.status = waiting ? "waiting" : "running";
  // The rail has 48px and this is a sentence. `data-count` lets the rail draw
  // the number alone as a ring (style.css) while the sentence stays in the DOM
  // — clipped, not removed, so a screen reader still reads the whole of it and
  // the tooltip says it to the pointer. No second computation and no second
  // string: one chip, two widths.
  chip.dataset.count = digits;
  chip.title = text;
  return chip;
}

export function tabTitle(entry) {
  return (entry.session_id && sessionTitles.get(entry.session_id)) || FA.tabFresh;
}

/* What the permission dialog needs to say WHICH conversation is asking: the tab
   on screen, and the list entry behind an id. Two accessors rather than the
   module's own `let`s, so perm.js reads the answer at ask time instead of
   holding a copy that goes stale between requests. */
export function activeTabId() {
  return openActive;
}

export function openTabEntry(tab) {
  return openTabs.find((t) => t.tab === tab) ?? null;
}

function paintOpenTabs() {
  if (!ui.openTabs) return;   // spec-test.html has no sidebar
  ui.openTabs.replaceChildren();
  const any = openTabs.length > 0;
  ui.openTabs.hidden = !any;
  if (ui.tabsTitle) {
    ui.tabsTitle.hidden = !any;
    ui.tabsTitle.replaceChildren(document.createTextNode(FA.openSessions));
    const badge = tabsBadge();
    if (badge) ui.tabsTitle.append(badge);
  }
  if (!any) return;

  for (const entry of openTabs) {
    const status = tabStatus(entry.tab);
    const row = document.createElement("div");
    row.className = "tab-row";
    row.dataset.tab = entry.tab;
    row.dataset.current = String(entry.tab === openActive);
    row.dataset.busy = String(!!entry.busy);
    row.dataset.status = status;

    const open = document.createElement("button");
    open.type = "button";
    open.className = "tab-open";
    // Not aria-hidden: the colour IS the message, so the word behind it has to
    // reach anyone who cannot see the colour. `role=img` + a label is what
    // gives a bare <span> an accessible name; `title` is the same word again,
    // for the pointer.
    const dot = label("●", "tab-dot");
    dot.dataset.status = status;
    dot.setAttribute("role", "img");
    dot.setAttribute("aria-label", FA.tabStatus[status]);
    dot.title = FA.tabStatus[status];
    const name = document.createElement("span");
    name.className = "tab-name";
    name.setAttribute("dir", "auto");   // the user's own words, either script
    name.textContent = tabTitle(entry);
    open.append(dot);
    // Turns that finished while this conversation was parked. Next to the dot,
    // because the pair is one sentence: what it is doing, and what it did while
    // you were elsewhere. fa-IR digits like every other count in this window.
    const unread = liveFacts[entry.tab]?.unread ?? 0;
    if (unread) {
      const digits = unread.toLocaleString("fa-IR");
      const count = label(digits, "tab-unread");
      count.title = FA.tabUnread.replace("{n}", digits);
      open.append(count);
    }
    open.append(name);
    // Which project it is running in. A display NAME, not a path: it is
    // whatever the user renamed the project to and is Persian as often as not,
    // so pathEl's forced LTR would misorder it and seat it on the wrong side of
    // an RTL row. The full path stays in the tooltip, which is the thing that
    // actually disambiguates two folders (plan §B-10 item 2 is about paths, and
    // this stopped being one).
    if (entry.cwd) {
      open.append(projectChip(entry.cwd));
    }
    if (entry.worktree) open.append(worktreeChip(entry.worktree));
    // «title · project», not the raw path: in the rail (TERMINAL-REDESIGN.md
    // §1) the name, the chip and the ✕ are all off the row and the dot is the
    // whole of it, so this tooltip is the only thing that says WHICH
    // conversation a dot belongs to. The full path did not answer that — two
    // conversations in one folder share it — and it is still the chip's own
    // tooltip one width up. The dot gives up its hit-testing in the rail
    // (style.css) so this is what the pointer lands on.
    open.title = entry.cwd
      ? `${tabTitle(entry)} · ${displayName(entry.cwd)}`
      : tabTitle(entry);
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

/* THE FOURTH PAINT SITE (TERMINAL-REDESIGN.md §2.1/§4). The same tabStatus()
   the sidebar row and the history row are drawn from, written onto the identity
   row of every COLUMN — so a cell's dot can never disagree with the sidebar's.
   Nothing new is computed and no server event is added: this runs from
   repaintTabs(), which app.js already calls on every result, command_lifecycle,
   permission change and /api/tabs answer.

   The title is the one the sidebar shows for that session (tabTitle), so the
   four columns of a 4-up are told apart by their own names rather than by four
   copies of the same project path.

   spec-test.html has no cell markup: `topbarTitle` comes back null there and
   the loop skips, the way every other cui() caller degrades. */
function paintCells() {
  for (const cell of tabBridge?.cells?.() ?? []) {
    const u = cui(cell);
    if (!u.topbarTitle) continue;
    const entry = cell.tab ? openTabEntry(cell.tab) : null;
    u.topbarTitle.textContent = entry ? tabTitle(entry) : "";
    if (!u.cellDot) continue;
    // A column holding no conversation has no state to report; the digit badge
    // is what stays, so the empty column still says which Alt+N reaches it.
    u.cellDot.hidden = !entry;
    const status = entry ? tabStatus(cell.tab) : "idle";
    u.cellDot.dataset.status = status;
    u.cellDot.setAttribute("aria-label", FA.tabStatus[status]);
    u.cellDot.title = FA.tabStatus[status];
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
  // Two commits and a branch leaving the trunk — the ⎇ chip in icon form.
  branch: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4v16"/><circle cx="7" cy="5" r="1.8"/><circle cx="17" cy="9" r="1.8"/><path d="M17 11v1a4 4 0 01-4 4H7"/></svg>',
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
export function projectChip(cwd) {
  const chip = document.createElement("bdi");
  chip.className = "tab-proj";
  chip.setAttribute("dir", "auto");
  chip.textContent = displayName(cwd);
  chip.title = cwd;
  return chip;
}

/* A folded session's row knows the REPO path and the worktree name; its
   transcript is under the worktree. The server joins the two (server.py
   _cwd_for) rather than the window building a path out of a separator it
   cannot know. */
function worktreeQuery(name) {
  return name ? "&worktree=" + encodeURIComponent(name) : "";
}

/* The git worktree a conversation is editing in, as `⎇ agent-2` — the TUI's own
   branch glyph. UNLIKE the project chip this IS a technical value: the name is
   ASCII by construction (server.py WORKTREE_NAME_RE) and it names a folder, so
   it takes .path's LTR + isolate like every other path site in this window
   (plan §B-10 item 2). The Persian sentence explaining it is the tooltip. */
function worktreeChip(name) {
  const chip = document.createElement("bdi");
  chip.className = "wt-chip path";
  chip.textContent = "⎇ " + name;
  chip.title = FA.worktreeOf.replace("{name}", name);
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

/* Project name and cwd in ONE column's chrome: its topbar and its folder chip.
   `cell` is explicit only where the caller knows better than `state.cell` does
   (app.js, on a focus change); everything else lets chromeCell() decide. */
export function setChrome(cwd, cell = null) {
  const target = chromeCell(cell);
  if (cwd) {
    if (target) target.cwd = cwd;
    else currentCwd = cwd;     // spec harness: no cells, one folder
  }
  const path = target ? target.cwd || "" : currentCwd;
  // `currentCwd` is what the WINDOW is working in — the folder «گفتگوی جدید»
  // opens and the one a replay falls back to — so it follows the focused
  // column, never whichever conversation happened to speak last.
  if (!target || target === focusedRef()) currentCwd = path;
  // render.js calls this on system/init with a bare cwd, before any projects
  // fetch, so the folder name is what shows for a moment; the debounced
  // refreshProjects() that follows corrects it to the override.
  const u = cui(target);
  const name = displayName(path);
  // The project chip. The full path is its TOOLTIP and no longer a second mono
  // line beside it (§2.1): the path already has a home in the status line, and
  // four columns cannot each spend a row on it.
  if (u.topbarName) {
    u.topbarName.textContent = name;
    u.topbarName.title = path;
  }
  if (u.projChipName) {
    u.projChipName.textContent = name || FA.chooseProject;
    u.projChip.title = path;
  }
  syncHome(target);
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

function paintWelcome(cell) {
  const u = cui(cell);
  if (!u.welTitle) return;
  // The column's OWN folder, not the window's: two cells can be open on two
  // projects, and the welcome box is the one place an empty column says which.
  const cwd = cell?.cwd || "";
  u.welTitle.textContent = FA.welcomeTitle;
  u.welCwdLabel.textContent = FA.welcomeCwd;
  // A Windows path in chrome: .path + <bdi>, the sweep plan §B-10 item 2 is
  // about. Empty until a project is open, which is what the placeholder says.
  u.welCwd.textContent = cwd || FA.welcomeNoProject;
  u.welCwd.classList.toggle("is-empty", !cwd);
  u.welTips.replaceChildren();
  for (const [key, stringKey] of WELCOME_TIPS) {
    const li = document.createElement("li");
    li.append(label(key, "wel-tip-key"), label(FA[stringKey], "wel-tip-text"));
    u.welTips.append(li);
  }
}

/* Keyed on the CELL, never on <body> (MA3-T2): one column can be empty while
   the one beside it is mid-answer, and `body.home .log {display:none}` would
   have hidden both transcripts. */
function syncHome(cell) {
  const u = cui(cell);
  if (!cell || !u.home) return;   // spec-test.html has no home section
  const empty = cell.log.childElementCount === 0;
  if (empty) paintWelcome(cell);
  cell.root.classList.toggle("home", empty);
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
  paintCells();      // ...and a cell's identity row draws from the same map

  syncHome();          // the welcome box names the folder, which may have changed
  syncWindowTitle();   // and this is where a session's title finally arrives
}

let archOpen = false;   // the «بایگانی» section, collapsed by default

function renderProjects(projects) {
  // The sidebar repaints on every event, and `/resume` puts the KEYBOARD in it
  // (V2-PLAN §3.5): a rebuild mid-browse threw focus to <body> the way the
  // agents strip used to. Same fix as agents.js paint() — remember which
  // session owned focus, hand it back to that session's new row.
  const focusedSession = ui.projects.contains(document.activeElement)
    ? document.activeElement.closest("li")?.dataset.session : null;
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

  if (focusedSession) {
    sessionButton(focusedSession)?.focus();
  }
}

/* --- /resume: the keyboard in the session list (V2-PLAN §3.5, §8.11B) -------

   §3.3 asks for «moves focus into the sidebar's session list; Up/Down, Enter,
   Esc back to the prompt». The list already exists and already opens what you
   click — what it had no way to do was take the keyboard, so that is all this
   adds. Roving tabindex, the pattern a listbox uses: exactly one row is in the
   tab order at a time, so Tab still leaves the list in one press.

   Enter is not handled anywhere below on purpose — these are <button>s, and a
   button already activates on Enter. Binding it again would run the row twice
   on any browser that fires both. */
function sessionButtons() {
  return ui.projects ? [...ui.projects.querySelectorAll(".sess")] : [];
}

function sessionButton(sessionId) {
  return ui.projects?.querySelector(
    `li[data-session="${CSS.escape(sessionId)}"] .sess`) ?? null;
}

function roveTo(target) {
  if (!target) return false;
  for (const row of sessionButtons()) row.tabIndex = row === target ? 0 : -1;
  target.focus();
  return true;
}

export function focusSessions() {
  if (!ui.projects) return false;
  // A collapsed project has no rows to focus. `/resume` means "which of my
  // conversations", so the one you are in is the one that opens.
  const key = currentCwd.toLowerCase();
  if (key && !expanded.has(key)) {
    expanded.add(key);
    renderProjects(lastProjects);
  }
  const rows = sessionButtons();
  if (!rows.length) return false;
  return roveTo((currentSession && sessionButton(currentSession)) || rows[0]);
}

function sessionKeys(e) {
  if (e.defaultPrevented) return;
  const row = e.target instanceof Element ? e.target.closest(".sess") : null;
  if (!row) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    const rows = sessionButtons();
    const next = rows[(rows.indexOf(row) + (e.key === "ArrowDown" ? 1 : -1)
                       + rows.length) % rows.length];
    e.preventDefault();
    roveTo(next);
  } else if (e.key === "Escape") {
    // Back to the prompt, which is where every Esc in this window ends up —
    // the prompt of the column the keyboard came from (MA3-T2).
    e.preventDefault();
    focusedRef()?.composer.focus();
  }
}

/* `/branch` and `/cd` are window commands (js/commands.js) that end in exactly
   what the sidebar's own buttons do. Exported rather than duplicated: the tab
   bridge and the folder picker each have one owner. */
export function switchToTab(tab) {
  return tabBridge?.switchTo(tab);
}

export async function chooseProject(path) {
  let folder = (path ?? "").trim();
  if (!folder) {
    try {
      folder = (await api("/api/project/pick", {})).path;
    } catch (err) {
      bubble("error", FA.sendFailed);
      return;
    }
  }
  if (folder) await switchProject(folder);
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
    // The «گفتگوی جدید» beside it, but in a git worktree of its own, so two
    // conversations can edit this repo at the same time without overwriting
    // each other. Offered only where git can actually do it — the server
    // refuses it anyway (400), but a menu item that always fails is worse than
    // no menu item. The name is the server's to pick ("auto"): a worktree is
    // not a thing this audience should have to name.
    ...(proj.git ? [{
      icon: SVG.branch,
      text: FA.newChatWorktree,
      run: () => switchProject(proj.path, "auto"),
    }] : []),
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
  // Read back by renderProjects (focus survives a repaint) and by
  // focusSessions() below, which starts on the conversation you are in.
  li.dataset.session = sess.session_id;
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
    // The same four states the tab strip paints, on the history row for the
    // same conversation — this list is where a project with six open sessions
    // is actually read.
    const status = tabStatus(liveTab);
    const dot = label("●", "sess-dot");
    dot.dataset.status = status;
    dot.setAttribute("role", "img");
    dot.setAttribute("aria-label", FA.tabStatus[status]);
    dot.title = status === "idle" ? FA.sessionLive : FA.tabStatus[status];
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
  btn.append(preview);
  // Folded in from a worktree of this project (server.py list_projects): the
  // row lives under the repo, so the chip is the only thing that says the
  // conversation was not editing the repo's own checkout.
  if (sess.worktree) btn.append(worktreeChip(sess.worktree));
  btn.append(label(whenLabel(sess.modified), "sess-when"));
  btn.addEventListener("click", () => {
    if (liveTab) tabBridge?.switchTo(liveTab);
    else resumeSession(sess.session_id, projPath, sess.worktree);
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
      run: () => replaySession(sess.session_id, projPath, sess.worktree),
    },
    ...(isCurrent ? [] : [null, {
      icon: SVG.trash,
      text: FA.deleteSession,
      danger: true,
      run: async () => {
        await api("/api/session/delete",
          { session_id: sess.session_id, path: projPath,
            worktree: sess.worktree });
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
                               + "&cwd=" + encodeURIComponent(projPath || currentCwd)
                               + worktreeQuery(sess.worktree));
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
  // a measured rect, and the sidebar sits on the RIGHT edge of the window
  // (TERMINAL-REDESIGN.md §1), so the card opens inward — leftward — clamped so
  // a row near the bottom or the start edge never opens offscreen.
  const anchor = row.getBoundingClientRect();
  const top = Math.min(Math.max(anchor.top - 6, 8),
                       window.innerHeight - card.offsetHeight - 8);
  card.style.top = Math.max(top, 8) + "px";
  // Horizontally the anchor is the whole SIDEBAR, not the row: a session row
  // stops short of the pane edge (the view/delete actions sit beside it), so
  // anchoring on the row leaves the card half-overlapping the list it explains.
  const pane = document.getElementById("sidebar")?.getBoundingClientRect();
  const edge = Math.min(anchor.left, pane ? pane.left : anchor.left);
  card.style.left =
    Math.max(Math.min(edge - card.offsetWidth - 10,
                      window.innerWidth - card.offsetWidth - 8), 8) + "px";
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
export function kebabMenu(items) {
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
    // The UA [popover] sheet sets inset:0, so left+right+width are all
    // definite — over-constrained — and under dir="rtl" the browser drops
    // `left`, pinning every menu to the window's right edge no matter what
    // we write here. `right: auto` frees `left` to actually apply.
    menu.style.insetInlineStart = "";
    menu.style.right = "auto";
    // Anchored by its RIGHT edge to the button's right edge, not by its left
    // to the button's left: a `⋯` is ~28px and a menu ~200, so left-anchoring
    // threw the whole panel across the row and, near a window edge, the clamp
    // below then pinned it to the window instead of to the control that
    // opened it. Still clamped, so a menu wider than the room to its start
    // side lands 8px in rather than off-screen.
    menu.style.left = Math.max(8, Math.min(rect.right - menu.offsetWidth,
                                           innerWidth - menu.offsetWidth - 8)) + "px";
  });

  return [btn, menu];
}

/* Read-only view of an old conversation. Goes through renderEvent exactly as
   the live stream does — plan §B-4's "one renderer, two sources". */
async function replaySession(sessionId, projPath, worktree) {
  // WHOSE view this replaces, pinned before the fetch and resolved again after
  // it: the user can switch conversations while a transcript is in the air, and
  // rendering it into whatever is on screen then would hand one conversation
  // another one's history — permanently, at the next park (app.js).
  const tab = tabBridge?.active?.();
  let data;
  try {
    data = await api("/api/session?id=" + encodeURIComponent(sessionId)
                     + "&cwd=" + encodeURIComponent(projPath || currentCwd)
                     + worktreeQuery(worktree));
  } catch (err) {
    bubble("error", FA.sendFailed);
    return;
  }
  renderInto(tab, data.events);
  showReplayBanner(sessionId, projPath, worktree);
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

/* A RELOADED WINDOW REPAINTS ITS TRANSCRIPT (pcg-1ug).

   A conversation's rows have two sources and only one of them survives a
   reload. Live events are published to the hub, which replays its whole
   per-tab backlog to a fresh window; a resumed session's history is fetched
   HERE (renderInto above) and published nowhere, and the resumed CLI never
   re-emits it either — that fetch is why this function exists at all. So a
   window reloaded onto a resumed conversation subscribed, got the status line
   and the usage and nothing that draws a message row, and showed the greeting
   over a transcript sitting on disk.

   Fetching it again is the whole fix, and it belongs at the one moment a tab
   is put on screen (app.js placeIn) rather than in any caller: boot, `/split`,
   a switch and the sidebar all route through that point, and the already-open
   short-circuit in resumeSession() below is correct as it stands.

   Best-effort chrome the user did not ask for: a fetch that fails, or a
   conversation with nothing said in it yet, leaves the column showing exactly
   what it shows today. */
const backfilled = new Set();

/* ONCE per tab per page load. Parking and replacing a tab calls placeIn()
   again and again, and re-fetching a transcript this window already has would
   clear the live rows that arrived since. */
export function backfillTab(tab) {
  const entry = openTabEntry(tab);
  if (!entry?.session_id || backfilled.has(tab)) return;
  backfilled.add(tab);
  (async () => {
    let history;
    try {
      history = await api("/api/session?id=" + encodeURIComponent(entry.session_id)
                          + "&cwd=" + encodeURIComponent(entry.cwd || "")
                          + worktreeQuery(entry.worktree));
    } catch (err) {
      return;
    }
    if (!history.events?.length) return;
    // resumedNote false: the reader was already looking at this conversation,
    // so «گفتگو از سر گرفته شد» on every reload would be a lie about what just
    // happened. renderInTab (through renderInto) resolves the destination
    // AFTER the await, so a tab parked or closed while this was in the air
    // paints into its own buffer, or into nothing.
    renderInto(tab, history.events);
  })();
}

function showReplayBanner(sessionId, projPath, worktree) {
  // The banner belongs to the column the replay was rendered into, which is
  // the one the keyboard is in (tabBridge.active() is the focused cell's tab).
  const banner = cui(focusedRef()).banner;
  if (!banner) return;
  banner.replaceChildren();
  const text = document.createElement("span");
  text.setAttribute("dir", "auto");
  text.textContent = FA.replaying;
  const cont = document.createElement("button");
  cont.type = "button";
  cont.textContent = FA.continueSession;
  cont.addEventListener("click", () => resumeSession(sessionId, projPath, worktree));
  banner.append(text, cont);
  banner.hidden = false;
}

/* Every banner in the window. Both callers below are "this column is not
   replaying any more", and with a grid the honest answer is to clear them all:
   a resume or a new chat moves the keyboard, so the banner left standing would
   belong to a column nobody asked about. */
function hideBanners() {
  for (const cell of tabBridge?.cells?.() ?? []) {
    const banner = cui(cell).banner;
    if (banner) banner.hidden = true;
  }
}

/* Resuming is a SPAWN now: the conversation opens in a tab of its own and
   everything already running keeps running. The server answers `adopted: true`
   when that session was live all along, and then there is nothing to resume —
   only a tab to switch to. */
async function resumeSession(sessionId, projPath, worktree) {
  const live = openTabs.find((t) => t.session_id === sessionId)?.tab;
  if (live) {
    await tabBridge?.switchTo(live);
    return;
  }
  hideBanners();
  let data;
  try {
    // `worktree` carries the session back into the tree it was started in:
    // --resume + --worktree reuses it rather than making a second one.
    data = await api("/api/session/resume",
                     { session_id: sessionId, path: projPath, worktree });
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
                        + "&cwd=" + encodeURIComponent(projPath || currentCwd)
                        + worktreeQuery(worktree));
  } catch (err) {
    return;   // the session IS resumed; only its backfill failed to arrive
  }
  renderInto(data.tab, history.events, true);
  refreshProjects();
}

/* «گفتگوی جدید» and the folder picker both land here, and both now OPEN one
   more conversation instead of killing the one that was running. */
async function switchProject(folder, worktree) {
  if (!folder) return;
  hideBanners();
  try {
    // `worktree: "auto"` asks the server to open this one in a git worktree of
    // its own and to name it; anything else here is the ordinary new chat.
    const data = await api("/api/project/open", { path: folder, worktree });
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
  const message = err?.message ?? "";
  // 400 reaches here from one place only: a worktree was asked for in a folder
  // that is not a git repository (server.py resolve_worktree).
  if (/-> 400$/.test(message)) return void bubble("error", FA.notGitRepo);
  bubble("error", /-> 409$/.test(message) ? FA.maxTabs : FA.sendFailed);
}

/* --- init ------------------------------------------------------------------ */

/* Every side effect this module used to run at load time. app.js calls it once,
   in the same order the single-file version ran in. */
export function initChrome() {
  if (ui.projects) {
    document.getElementById("brand").textContent = FA.appName;
    document.getElementById("btn-new-label").textContent = FA.newChat;
    document.getElementById("split-label").textContent = FA.splitLabel;
    document.getElementById("projects-title").textContent = FA.projects;
    document.getElementById("btn-help-label").textContent = FA.help;
    // The help page is served, so it needs the token like every other request.
    document.getElementById("btn-help").href =
      "/static/help.html?t=" + encodeURIComponent(token);

    ui.btnNew.addEventListener("click", () => switchProject(currentCwd));

    // `/resume` moves the keyboard here; these are the keys it then has.
    ui.projects.addEventListener("keydown", sessionKeys);

    loadProjects();
  }
}

/* The per-column half of the init above, run once per cell as app.js stamps it
   (and again for a cell `/split 4` adds). Everything here is cell-local, which
   is why it cannot live in initChrome(): there are N of each. */
export function initCellChrome(cell) {
  const u = cui(cell);
  if (!u.home) return;      // spec-test.html carries no shell markup
  new MutationObserver(() => syncHome(cell)).observe(cell.log, { childList: true });
  u.home.hidden = false;    // visibility is class-driven from here on
  // Blocks in a child process while the native dialog is up. Same call
  // `/cd` with no argument makes, through the same function.
  u.projChip?.addEventListener("click", () => chooseProject(""));
  syncHome(cell);
}

/* `/split 1|2|4`, from js/commands.js. The grid itself is app.js's (it owns the
   cells); this is the one-way arrow commands.js already uses for switchToTab —
   it cannot import the entry module. */
export function splitView(n) {
  return tabBridge?.split?.(n) ?? false;
}
