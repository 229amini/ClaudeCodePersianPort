/* ============================================================================
   The notification centre (BRIDGEMIND-PORT.md §D9).

   With up to six conversations running, "which one needs me?" is the question
   the window has to answer without being asked. A notice is made when a turn
   ends, fails, or stops to ask permission in a conversation the reader is NOT
   looking at; the bell counts the unread ones and its panel jumps to the pane.

   Window memory only (cap 50): a notice is about something that happened
   while this window was open. A reload does not bring them back, and a
   replayed event never makes one (wiki/frontend-modules.md, "A reload
   RE-RENDERS every finished turn").

   Everything it needs from the grid comes through the bridge app.js hands in:
   app.js is the entry module and nothing may import it.
   ========================================================================= */

import { relWhen } from "./chrome.js";

const FA = window.STRINGS;
const CAP = 50;
const GLYPH = { needs: "◉", failed: "⊘", done: "●" };

let bridge = null;
let bell = null;
let count = null;
let panel = null;
let list = null;
let notices = [];            // newest first
let seq = 0;

export function initNotices(b) {
  bridge = b;
  bell = document.getElementById("btn-bell");
  if (!bell) return;          // spec-test.html has no sidebar
  count = bell.querySelector(".bell-count");
  bell.title = FA.bellTitle;
  bell.setAttribute("aria-label", FA.bellTitle);

  panel = document.createElement("div");
  panel.id = "bell-panel";
  panel.className = "bell-panel";
  panel.popover = "auto";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", FA.bellTitle);
  const head = document.createElement("div");
  head.className = "bell-head";
  const title = document.createElement("h2");
  title.textContent = FA.bellTitle;
  const allRead = document.createElement("button");
  allRead.type = "button";
  allRead.className = "bell-allread";
  allRead.textContent = FA.noticesAllRead;
  allRead.addEventListener("click", () => {
    for (const n of notices) n.read = true;
    paint();
  });
  head.append(title, allRead);
  list = document.createElement("ul");
  list.className = "bell-list";
  panel.append(head, list);
  document.body.append(panel);

  bell.setAttribute("aria-controls", panel.id);
  bell.addEventListener("click", togglePanel);
  panel.addEventListener("toggle", (e) => {
    bell.setAttribute("aria-expanded", String(e.newState === "open"));
  });
  paint();
}

export function togglePanel() {
  if (!panel) return;
  if (panel.matches(":popover-open")) {
    panel.hidePopover();
    return;
  }
  paint();
  panel.showPopover();
  place();
  (list.querySelector("button:not(:disabled)") ?? panel.querySelector(".bell-allread")).focus();
}

/* Opens toward the stage: the sidebar is the RIGHT column (dir="rtl"), so the
   panel hangs off the bell's row with its right edge on the sidebar's left
   edge. In the rail the same rule puts it just past the 48px strip. Physical
   insets on purpose, with the opposite one `auto` - the UA [popover] sheet's
   `inset: 0` over-constrains the box otherwise (wiki/editions.md). */
function place() {
  const side = document.getElementById("sidebar")?.getBoundingClientRect();
  const at = bell.getBoundingClientRect();
  const gap = 8;
  panel.style.left = "auto";
  panel.style.bottom = "auto";
  panel.style.right = Math.max(gap, innerWidth - (side ? side.left : at.left) + gap) + "px";
  const h = panel.offsetHeight;
  panel.style.top = Math.max(gap, Math.min(at.top, innerHeight - h - gap)) + "px";
}

/* `kind`: "done" | "needs" | "failed". Called by app.js, which has already
   decided the reader is not looking at this conversation. */
export function pushNotice(tab, kind, title) {
  // One live "needs" per conversation: a second permission request while the
  // first notice is unread is the same news.
  if (kind === "needs" && notices.some((n) => n.tab === tab && n.kind === "needs" && !n.read)) {
    return;
  }
  notices.unshift({ id: ++seq, tab, kind, title, at: Date.now() / 1000, read: false });
  notices.length = Math.min(notices.length, CAP);
  paint();
}

/* The reader is looking at this conversation now. */
export function markRead(tab) {
  let changed = false;
  for (const n of notices) {
    if (n.tab === tab && !n.read) {
      n.read = true;
      changed = true;
    }
  }
  if (changed) paint();
}

export function unreadNotices() {
  return notices.filter((n) => !n.read).length;
}

function paint() {
  if (!bell) return;
  const unread = notices.filter((n) => !n.read);
  count.hidden = !unread.length;
  count.textContent = unread.length.toLocaleString("fa-IR");
  bell.classList.toggle("needs", unread.some((n) => n.kind === "needs"));
  bell.title = unread.length
    ? FA.bellUnread.replace("{n}", unread.length.toLocaleString("fa-IR")) : FA.bellTitle;
  if (!list) return;
  list.replaceChildren();
  if (!notices.length) {
    const empty = document.createElement("li");
    empty.className = "bell-empty";
    empty.textContent = FA.noticesEmpty;
    list.append(empty);
    return;
  }
  for (const n of notices) {
    const li = document.createElement("li");
    const row = document.createElement("button");
    row.type = "button";
    row.className = "bell-row" + (n.read ? "" : " unread");
    row.dataset.kind = n.kind;
    const glyph = document.createElement("span");
    glyph.className = "bell-glyph";
    glyph.textContent = GLYPH[n.kind];
    glyph.setAttribute("aria-hidden", "true");
    const alive = bridge.alive(n.tab);
    const title = document.createElement("bdi");
    title.className = "bell-title";
    title.setAttribute("dir", "auto");
    // Asked at paint time: a session's title arrives with the project list,
    // often after the notice. The one kept on the notice is for a closed tab.
    title.textContent = (alive && bridge.title(n.tab)) || n.title;
    const what = document.createElement("span");
    what.className = "bell-what";
    what.textContent = alive ? FA.noticeKind[n.kind] : FA.noticeClosed;
    const when = document.createElement("span");
    when.className = "bell-when";
    when.textContent = relWhen(n.at);
    row.append(glyph, title, what, when);
    // A conversation that was closed is still news, but there is nowhere to
    // go: drawn, and disabled, with the reason in place of what happened.
    row.disabled = !alive;
    row.addEventListener("click", () => {
      n.read = true;
      panel.hidePopover();
      bridge.jump(n.tab);
      paint();
    });
    li.append(row);
    list.append(li);
  }
}
