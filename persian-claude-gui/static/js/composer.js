/* ============================================================================
   The composer: text input, ZWNJ, send/stop, attachments, slash autocomplete.
   ========================================================================= */
"use strict";

import { pathEl } from "./bidi.js";
import { api, token } from "./api.js";
import { bubble, label, paintQueued, toggleThinking } from "./render.js";
/* One-way, and no new cycle: controls.js imports api.js and nothing else. */
import {
  cyclePosture, openModelPicker, openEffortPicker, openStylePicker,
  openPosturePicker,
} from "./controls.js";

const FA = window.STRINGS;

const input = document.getElementById("input");
const composer = document.getElementById("composer");
const sendBtn = document.getElementById("send");
const stopBtn = document.getElementById("stop");
/* The invitation to type, as index.html writes it — restored when a
   conversation comes back (setComposerBlank below borrows the line). */
const askPlaceholder = input?.placeholder ?? "";
const attachRow = document.getElementById("attachments");
const slashPopup = document.getElementById("slash-popup");

const base64Of = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

/* A running turn ADDS a stop button; it no longer hides send. Hiding it was a
   lie: Enter has always sent mid-turn and the CLI queues the message fine, so
   the only thing the swap achieved was Enter and the button doing different
   things depending on invisible state — the exact trap the submit handler
   below already had to be fixed for once. Stop stays prominent because a
   non-technical user needs an obvious way out; the interrupt leaves the
   process (and the session) alive. */
/* Whether the VISIBLE conversation has a turn in flight. A background tab's
   busy flag lives in its own scope (render.js) until the user switches to it —
   there is one stop button and it must always mean "stop what you are
   reading". */
let busy = false;

export function setBusy(running) {
  // A turn starting or ending is the conversation being USED — that is what
  // re-arms the idle hint. Boot's own setBusy(false) is a no-op transition
  // (busy is already false), so an untouched window never earns the hint.
  if (running || busy) lastActivity = Date.now();
  busy = !!running;
  if (stopBtn) stopBtn.hidden = !busy;
  document.body.classList.toggle("busy", busy);
}

/* --- away -------------------------------------------------------------------

   The CLI writes its own «※ recap: ...» only when the person has been away
   for five minutes, because generating one costs an API call. Same rule here,
   and the same definition of away: the window is not on screen, or nothing has
   been typed or clicked in it for five minutes. Turn traffic deliberately does
   NOT count -- `lastActivity` above is the conversation being used, and a long
   answer arriving is exactly the case where the person walked off. */
const AWAY_AT = 5 * 60 * 1000;
let lastInput = Date.now();

for (const name of ["pointerdown", "keydown", "wheel"]) {
  addEventListener(name, () => { lastInput = Date.now(); },
                   { capture: true, passive: true });
}
// Coming back to the window is input; leaving it is not (a hidden window is
// already away by the first clause).
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) lastInput = Date.now();
});

/* `now` is a parameter for the same reason checkIdle()'s is: so the five
   minutes are testable without waiting them out. */
export function isAway(now = Date.now()) {
  return document.hidden || now - lastInput >= AWAY_AT;
}

/* The box grows with what is in it, up to 40% of the window. Shared, because
   text also arrives here without a keystroke (restoreDraft below) and a box
   that does not grow for it hides the message it was just handed. */
function autoGrow() {
  if (!input) return;
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, window.innerHeight * 0.4) + "px";
}

/* A message the CLI queued and then never ran comes back to the person who
   typed it. Two rules, and each one is a way of losing text:

   - APPENDED, never assigned: whatever is half-typed in the box right now
     outranks a message from a minute ago.
   - on its own line, so two returned messages are two messages.

   There is deliberately no "already in the box" check. It used to be
   `input.value.includes(text)`, to stop a reload from re-delivering an
   hour-old cancellation off the SSE backlog — but that is the transport's
   problem and it is solved there now (the server marks a fresh window's replay,
   render.js suppresses the give-back for it). As a dedupe it was also wrong in
   the direction that loses text: a returned message that happens to be a
   SUBSTRING of what is being typed was swallowed silently. */
export function restoreDraft(text) {
  if (!input || !text) return;
  input.value = input.value ? input.value + "\n" + text : text;
  autoGrow();
}

/* No conversation is open at all (app.js blankView): every tab-less endpoint
   routes by the server's active tab, so a send lands on a 404 and the user gets
   the generic «ارسال ناموفق بود» — which reads as "your message failed" when
   the truth is that there is nowhere to send it yet. The box is closed and says
   so instead; applySwitch() opens it again the moment a tab is on screen. */
export function setComposerBlank(blank) {
  if (!input) return;
  input.disabled = !!blank;
  input.placeholder = blank ? FA.composerBlank : askPlaceholder;
  if (sendBtn) sendBtn.disabled = !!blank;
}

/* --- the context notice ----------------------------------------------------

   The conversation fills up and the CLI starts telling the user — in English,
   in a TUI they never see — to run /compact or /clear. This surfaces the same
   decision in Persian, as the two buttons that actually do it.

   The trigger is the context percentage the CLI itself measures
   (get_context_usage, published as wrapper/usage every turn), not a string
   scraped out of an event: that number already drives the statusline meter, so
   there is nothing new to keep in sync and nothing to re-measure per CLI
   version. `contextFull()` is the second door, for the hard limit, where the
   turn fails outright and a percentage never arrives.

   Both buttons press something that already exists — /compact reaches the CLI
   as ordinary message text (it is NOT a control subtype, measured), and /clear
   is the "new chat" button. No third implementation to keep in sync. */

const WARN_AT = 85;      // % of the window used
const NAG_STEP = 5;      // how much worse it must get before asking again
const IDLE_AT = 60 * 60 * 1000;   // an hour of silence → suggest a fresh chat

const notice = document.getElementById("context-notice");
let dismissedAt = null;
let lastContext = 0;
/* What the notice is currently saying, or null when it is away. The warning is
   derivable from lastContext, the exhausted one is not (no percentage ever
   arrives with it) — so the shape is kept rather than recomputed when a tab is
   switched back to. */
let noticeState = null;
/* When this conversation last did anything (a turn started or ended). null
   until the first turn, so a window left open on the home screen stays quiet. */
let lastActivity = null;

/* The CLI's own idle nudge, surfaced here: come back after an hour away and
   the same notice suggests a fresh chat — /clear as a button, like everything
   else. Fires once per quiet stretch; the next turn re-arms it via setBusy.
   `now` is a parameter purely so the hour is testable (spec-test.html). */
export function checkIdle(now = Date.now()) {
  if (!notice || busy || noticeState) return;   // never talk over the context warning
  // Background agents are still out (agents.js paint()). The turn that
  // dispatched them ended, so `busy` is false and the conversation LOOKS
  // abandoned — but suggesting a fresh chat over work that is still running is
  // how the hint got read as an error in the first place.
  if (document.body.classList.contains("agents-running")) return;
  if (lastActivity === null || now - lastActivity < IDLE_AT) return;
  lastActivity = null;
  paintNotice(FA.idleTitle, FA.idleBody, false, false);
}

export function noteContext(pct) {
  if (!notice || typeof pct !== "number") return;
  lastContext = pct;
  if (pct < WARN_AT) {
    // A compact or a clear landed — re-arm so the next approach warns again.
    dismissedAt = null;
    noticeState = null;
    notice.hidden = true;
    return;
  }
  if (dismissedAt !== null && pct < dismissedAt + NAG_STEP) return;
  paintNotice(FA.ctxTitle, FA.ctxBody.replace("{n}", Math.round(pct).toLocaleString("fa-IR")));
}

/* The context window is actually exhausted: the turn came back as an error and
   there is nothing to do but compact or clear. Not dismissible-into-silence the
   way the warning is — it re-shows on every failed turn, because it is the only
   thing standing between the user and a conversation that answers nothing. */
export function contextFull() {
  if (!notice) return;
  dismissedAt = null;
  paintNotice(FA.ctxTitleFull, FA.ctxBodyFull, true);
}

/* `compact` is false only for the idle hint: an hour-old conversation is not
   over the limit, so «فشرده کردن» would be answering a question nobody asked —
   the fresh chat IS the suggestion, and it takes the primary style. */
function paintNotice(title, body, urgent = false, compact = true) {
  noticeState = { title, body, urgent, compact };
  notice.replaceChildren();
  notice.classList.toggle("urgent", urgent);

  const head = document.createElement("div");
  head.className = "ctx-head";
  head.setAttribute("dir", "auto");
  head.append(label(title, "ctx-title"), label(body, "ctx-body"));
  notice.append(head);

  const row = document.createElement("div");
  row.className = "ctx-actions";
  if (compact) {
    row.append(ctxButton(FA.ctxCompact, FA.ctxCompactNote, "primary", () => {
      // Through the composer's own submit path, so the user sees the command
      // echoed like anything else they send. interceptLifecycle deliberately
      // does not claim /compact.
      input.value = "/compact";
      composer.requestSubmit();
      notice.hidden = true;
    }));
  }
  row.append(ctxButton(FA.ctxClear, FA.ctxClearNote, compact ? "" : "primary", () =>
    document.getElementById("btn-new")?.click()));
  if (!urgent) {
    row.append(ctxButton(FA.ctxDismiss, "", "ghost", () => {
      dismissedAt = lastContext;
      noticeState = null;
      notice.hidden = true;
    }));
  }
  notice.append(row);
  notice.hidden = false;
}

/* --- one composer, N conversations -----------------------------------------

   The draft text and the attachments stay GLOBAL on purpose: there is one box,
   and a message half-typed is about the person, not about the session. What is
   per-session is everything the box says ABOUT the conversation — whether it is
   working, which slash commands that CLI has, and how full its context is. */
export function snapshotComposer() {
  return { busy, slashCommands, dismissedAt, lastContext, lastActivity, notice: noticeState };
}

export function restoreComposer(saved) {
  const s = saved ?? {};
  // History is per PROJECT and the menus describe the conversation that was on
  // screen a moment ago. Dropped rather than snapshotted: the list is one GET
  // away, and a stale one would offer another project's prompts under Up.
  historyList = null;
  historyIndex = null;
  historyDraft = "";
  searchOn = false;
  paintSearch();
  closeFiles();
  slashCommands = s.slashCommands ?? [];
  dismissedAt = s.dismissedAt ?? null;
  lastContext = s.lastContext ?? 0;
  noticeState = s.notice ?? null;
  if (notice) {
    if (noticeState) {
      paintNotice(noticeState.title, noticeState.body, noticeState.urgent,
                  noticeState.compact ?? true);
    } else notice.hidden = true;
  }
  setBusy(!!s.busy);
  // After setBusy, which stamps «now» on a busy→idle edge — the restored
  // conversation's own clock wins, or a tab switch would reset its idle hour.
  lastActivity = s.lastActivity ?? null;
  // The queued-message strip is this conversation's too, but its model lives in
  // the RENDER scope (render.js state.queued) rather than in the snapshot
  // above: it is built from stream events, which are routed per tab by the
  // renderer. app.js swaps that scope in before calling this, so by now `state`
  // is already the right conversation's — all that is left is to paint it.
  paintQueued();
}

function ctxButton(text, note, cls, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ctx-btn " + cls;
  button.setAttribute("dir", "auto");
  button.append(label(text, "ctx-btn-text"));
  // v2.5: the notice is a one-line warning row now (V2-PLAN §3.4), so the
  // per-action explanation moves to the hover. The node stays — it is what
  // the spec harness reads — and the title is where a line-long row can still
  // say «خلاصه می‌شود و همین گفتگو ادامه پیدا می‌کند» without becoming a card.
  if (note) {
    button.append(label(note, "ctx-btn-note"));
    button.title = note;
  }
  button.addEventListener("click", onClick);
  return button;
}

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

/* --- long pastes, parked as chips (V2-PLAN §3.1) ----------------------------

   Forty lines of log pasted into the box buries the sentence around them and
   pushes the composer over half the window. The TUI's answer is to keep the
   text and put a placeholder in the input — «[Pasted text #1 +39 lines]» — and
   to expand it again on send. This is that, with the numbers lifted from the
   binary rather than chosen (V2-PLAN §3.6). Read out of 2.1.261 at the
   construction site, chunk `.../input`:

     var o9 = 800;                                   // the character threshold
     function BY(e){ return (e.match(/\r\n|\r|\n/g) || []).length }
     function cue(e,t){ if (t===0) return `[Pasted text #${e}]`;
                        return `[Pasted text #${e} +${t} lines]` }
     ... if (w && (S.length > o9 || T > 2)) { ...mintTextPaste... }

   So: more than 800 characters OR more than two newlines, and the count in the
   placeholder is the NEWLINE count, not the line count — which is why a paste
   with none of them gets the short form instead of «+0 سطر».

   The map is keyed by the placeholder's number and holds the real text. It is
   global for the same reason `attachments` above is: there is one box, and a
   half-composed message belongs to the person, not to the session. */
const PASTE_MAX_CHARS = 800;
const PASTE_MAX_NEWLINES = 2;
/* What the hover tooltip is allowed to carry. A `title` is the native
   expand-on-hover and costs no code; the cap is because a browser tooltip
   silently truncates somewhere around here anyway, and a megabyte of text in
   an attribute is a megabyte re-serialised on every repaint.
   ponytail: upgrade to a real hover panel if anyone asks to SEE the paste
   rather than to check which one it is. */
const PASTE_PEEK = 2000;

const pasteRow = document.getElementById("pastes");
let pastes = new Map();   // number -> { text, placeholder }
let pasteSeq = 0;

function pasteChipEl(id, entry) {
  const chip = document.createElement("span");
  chip.className = "chip paste-chip";
  // The placeholder is the TUI's, in Persian, and it is bracketed Latin-digit
  // chrome inside an RTL row: isolate it or the «#1» and the «+39» reorder
  // against the Persian around them (spec rule 2).
  const text = document.createElement("bdi");
  text.textContent = entry.placeholder;
  chip.append(text);
  chip.title = entry.text.slice(0, PASTE_PEEK);
  const remove = document.createElement("button");
  remove.type = "button";
  remove.setAttribute("aria-label", FA.pasteDrop);
  remove.textContent = "×";
  remove.addEventListener("click", () => {
    // The chip and the placeholder are one thing: dropping either without the
    // other leaves the box saying there is a paste that is not there, or
    // sending forty lines the user thought they had removed.
    input.value = input.value.split(entry.placeholder).join("");
    pastes.delete(id);
    paintPastes();
    autoGrow();
    input.focus();
  });
  chip.append(remove);
  return chip;
}

function paintPastes() {
  if (!pasteRow) return;   // spec-test.html carries no composer chrome
  pasteRow.replaceChildren();
  for (const [id, entry] of pastes) pasteRow.append(pasteChipEl(id, entry));
  pasteRow.hidden = !pastes.size;
}

/* Whatever the user did to the box, the chips describe what is actually in it.
   The TUI has the same rule and a changelog entry for the release where it did
   not: ctrl+w through half a placeholder used to leave a broken one behind. */
function prunePastes() {
  let changed = false;
  for (const [id, entry] of pastes) {
    if (!input.value.includes(entry.placeholder)) {
      pastes.delete(id);
      changed = true;
    }
  }
  if (changed) paintPastes();
}

/* Send what was pasted, not the placeholder standing in for it. Substitution
   is on the exact bracketed string, which the user cannot type by accident in
   any way that matters: a hand-typed «[متن چسبانده‌شده #1 +39 سطر]» with no
   paste behind it has no entry here and is sent as itself. */
function expandPastes(text) {
  let out = text;
  for (const entry of pastes.values()) {
    if (out.includes(entry.placeholder)) out = out.split(entry.placeholder).join(entry.text);
  }
  return out;
}

/* The box is empty, so nothing is standing in for anything. Numbering is NOT
   reset: two pastes in one session should never share a number, or a stale
   chip and a fresh one describe the same placeholder. */
function dropPastes() {
  if (!pastes.size) return;
  pastes.clear();
  paintPastes();
}

/* Returns false when the paste is short enough to belong in the box as it is,
   which is the common case and must stay untouched — the caller has not
   called preventDefault() yet when it asks. */
function parkPaste(text) {
  const newlines = (text.match(/\r\n|\r|\n/g) || []).length;
  if (text.length <= PASTE_MAX_CHARS && newlines <= PASTE_MAX_NEWLINES) return false;
  const id = ++pasteSeq;
  const placeholder = (newlines === 0 ? FA.pastePlaceholderShort : FA.pastePlaceholder)
    .replace("{n}", String(id)).replace("{lines}", String(newlines));
  pastes.set(id, { text, placeholder });
  // setRangeText, not `value +=`: it honours the caret and the selection the
  // paste was replacing, and it keeps native undo — the same reason the ZWNJ
  // handler uses it (spec rule 6).
  input.setRangeText(placeholder, input.selectionStart, input.selectionEnd, "end");
  paintPastes();
  autoGrow();
  return true;
}

/* --- slash-command autocomplete (plan §B-6) -------------------------------- */

let slashCommands = [];   // [{name, description, argumentHint}] — from the CLI
let slashMatches = [];
let slashIndex = 0;

/* The CLI is authoritative about what commands exist on this machine (custom
   skills, plugins). TWO sources feed this, and they are not equal: the
   `initialize` reply arrives at spawn with {name, description, argumentHint},
   while system/init only arrives after turn one and carries bare names. Taking
   the later, poorer list would silently strip every description off the popup —
   hence the downgrade guard. */
export function setSlashCommands(list) {
  const next = (list ?? [])
    .map((item) => (typeof item === "string" ? { name: item } : item))
    .filter((item) => item && item.name);
  if (!next.length) return;
  const rich = next.some((item) => item.description);
  if (!rich && slashCommands.some((item) => item.description)) return;
  slashCommands = next;
}

function slashOpen() {
  return !!slashPopup && !slashPopup.hidden;
}

/* The composer is multi-line, so "the text before the cursor on the current
   line" — not the whole box — decides whether a slash command is being typed.
   Matching the whole value made the popup vanish the moment a second line
   existed, and reappear over unrelated text. */
function activeSegment() {
  const caret = input.selectionStart ?? input.value.length;
  const upto = input.value.slice(0, caret);
  return { start: upto.lastIndexOf("\n") + 1, caret, text: upto.slice(upto.lastIndexOf("\n") + 1) };
}

function currentSlashQuery() {
  const match = /^\/(\S*)$/.exec(activeSegment().text);
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
    .filter((cmd) => cmd.name.toLowerCase().startsWith(query.toLowerCase()))
    .slice(0, 50);
  if (!slashMatches.length) {
    slashPopup.hidden = true;
    return;
  }
  slashIndex = 0;
  renderSlash();
  // Same trap as the picker menu (js/controls.js positionMenu): this opens
  // upward out of the composer, so its 40vh is only real when the composer is
  // at the bottom of the window. In the home state it sits mid-screen and the
  // top rows were clipped off the window instead of scrolling.
  const box = slashPopup.offsetParent?.getBoundingClientRect();
  if (box) slashPopup.style.maxHeight = Math.max(140, box.top - 16) + "px";
  slashPopup.hidden = false;
}

function renderSlash() {
  slashPopup.replaceChildren();
  slashMatches.forEach((cmd, index) => {
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(index === slashIndex));

    // The command itself is an ASCII token: LTR and monospace, isolated from
    // the Persian description beside it (spec rule 2).
    const name = document.createElement("span");
    name.className = "slash-name";
    name.setAttribute("dir", "ltr");
    name.textContent = "/" + cmd.name;
    li.append(name);
    if (cmd.argumentHint) {
      const hint = document.createElement("span");
      hint.className = "slash-arg";
      hint.setAttribute("dir", "ltr");
      hint.textContent = cmd.argumentHint;
      li.append(hint);
    }
    if (cmd.description) {
      const desc = document.createElement("span");
      desc.className = "slash-desc";
      desc.setAttribute("dir", "auto");   // English from the CLI, Persian from skills
      desc.textContent = cmd.description;
      li.append(desc);
    }

    li.addEventListener("mousedown", (e) => {
      e.preventDefault();       // keep focus in the textarea
      slashIndex = index;
      acceptSlash();
    });
    slashPopup.append(li);
  });
  slashPopup.children[slashIndex]?.scrollIntoView({ block: "nearest" });
}

/* Completes the active line only, through setRangeText so native undo still
   works — the old version replaced the whole composer. */
function acceptSlash() {
  const cmd = slashMatches[slashIndex];
  if (!cmd) return;
  const { start, caret } = activeSegment();
  input.setRangeText("/" + cmd.name + " ", start, caret, "end");
  slashPopup.hidden = true;
  input.focus();
}

/* --- the prompt's own keys (V2-PLAN §3.2, wiki/tui-keys.md «Chat») ----------

   Everything below is one context of the TUI's binding table, lifted from the
   binary rather than from memory. The table is the spec and `test_keys.py`
   reads it: a row there with no behaviour here is a failing gate, which is the
   only way a key table and a key handler stay in agreement.

   ONE list, two consumers — the dispatcher below and the `?` sheet — so the
   window cannot advertise a chord it does not have. */

/* Does this event match a chord written the way wiki/tui-keys.md writes them?
   `ctrl+x ctrl+e` is a SEQUENCE (press, release, press) and is handled by the
   prefix state below, not here. */
function chordOf(e) {
  const parts = [];
  if (e.ctrlKey) parts.push("ctrl");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  const key = e.key === " " ? "space" : e.key.length === 1 ? e.key.toLowerCase() : e.key;
  parts.push(key);
  return parts.join("+");
}

/* The two-stroke prefix. `ctrl+x` alone is CUT in a browser, and a textarea
   with a selection is exactly where someone means cut — so the prefix only
   arms on an empty selection, where cut would have done nothing anyway. */
let prefixArmed = false;
let prefixTimer = 0;
const PREFIX_WINDOW = 3000;

function armPrefix() {
  prefixArmed = true;
  clearTimeout(prefixTimer);
  // The TUI waits forever for the second stroke; a window that did would eat
  // the next ctrl+e the user meant for the browser.
  prefixTimer = setTimeout(() => { prefixArmed = false; }, PREFIX_WINDOW);
}

function dropPrefix() {
  prefixArmed = false;
  clearTimeout(prefixTimer);
}

/* --- history: the same file the terminal walks ------------------------------

   ~/.claude/history.jsonl, filtered to this project, oldest first. Loaded once
   per conversation and appended to locally on send, so Up after a send walks
   what was just typed without a round-trip. The unsent draft is kept and comes
   back when the walk runs off the newest end — V2-PLAN §3.2 asks for exactly
   that, and it is the difference between a history walk and losing a message. */
let historyList = null;     // null = never loaded for this conversation
let historyIndex = null;    // null = not walking
let historyDraft = "";

async function loadHistory() {
  if (historyList) return historyList;
  try {
    const data = await api("/api/history");
    historyList = Array.isArray(data.prompts) ? data.prompts : [];
  } catch (err) {
    historyList = [];
  }
  return historyList;
}

/* Which line the caret is on decides whether the arrows belong to history or
   to the box: the TUI's rule, and the only one that keeps a multi-line message
   editable. */
function onFirstLine() {
  const caret = input.selectionStart ?? 0;
  return !input.value.slice(0, caret).includes("\n");
}

function onLastLine() {
  const caret = input.selectionEnd ?? 0;
  return !input.value.slice(caret).includes("\n");
}

function putInBox(text) {
  input.value = text;
  input.setSelectionRange(text.length, text.length);
  prunePastes();
  autoGrow();
  refreshBashMode();
}

async function walkHistory(step) {
  const list = await loadHistory();
  if (!list.length) return;
  if (historyIndex === null) {
    if (step > 0) return;             // Down with no walk in progress: nothing
    historyDraft = input.value;
    historyIndex = list.length;
  }
  const next = historyIndex + step;
  if (next >= list.length) {
    // Past the newest entry: back to whatever was being written.
    historyIndex = null;
    putInBox(historyDraft);
    return;
  }
  historyIndex = Math.max(0, next);
  putInBox(list[historyIndex]);
}

/* Typing ends the walk: from here the box is the person's again, and a stray
   Down should not overwrite it with a five-day-old prompt. */
function endHistoryWalk() {
  historyIndex = null;
}

/* --- Ctrl+R, the reverse search --------------------------------------------

   The box holds the QUERY while it is open and the row above shows the match,
   which is how the TUI does it with one line of input. Esc and Tab put the
   match in the box, Enter puts it there and sends — the actions the binary
   binds to `historySearch:accept` and `historySearch:execute`. */
const hsRow = document.getElementById("history-search");
const hsMatch = document.getElementById("hs-match");
let searchOn = false;
let searchDraft = "";
let searchMatches = [];
let searchIndex = 0;

function paintSearch() {
  if (!hsRow) return;
  hsRow.hidden = !searchOn;
  if (!searchOn || !hsMatch) return;
  hsMatch.textContent = searchMatches.length
    ? searchMatches[searchIndex] : FA.searchNone;
  hsMatch.classList.toggle("empty", !searchMatches.length);
}

function refreshSearch() {
  const query = input.value.trim().toLowerCase();
  const list = historyList ?? [];
  // Newest first: the answer to "what did I type last week" is almost always
  // the most recent one, and ctrl+r walks back from there.
  searchMatches = query
    ? list.filter((line) => line.toLowerCase().includes(query)).reverse()
    : [...list].reverse();
  searchIndex = 0;
  paintSearch();
}

async function openSearch() {
  await loadHistory();
  searchOn = true;
  searchDraft = input.value;
  endHistoryWalk();
  input.value = "";
  autoGrow();
  refreshSearch();
  input.focus();
}

/* `accept` false is the way out that changes nothing — nothing binds it today
   (the TUI's own cancel is ctrl+c, which belongs to the browser), but the two
   exits are different acts and collapsing them would make Esc destructive. */
function closeSearch(accept) {
  if (!searchOn) return;
  searchOn = false;
  const chosen = accept && searchMatches.length ? searchMatches[searchIndex]
                                                : searchDraft;
  paintSearch();
  putInBox(chosen);
  input.focus();
}

/* --- `@` file completion ----------------------------------------------------

   The list is the CLI's own index (server: /api/files → `file_suggestions`),
   so the window offers the files the terminal offers. Two measured quirks live
   here: the first query after a spawn comes back empty because the index warms
   on demand, so the menu asks again; and what is inserted is `@path` as TEXT —
   the CLI expands it itself (wiki/cli-stream-json-findings.md §5.2). */
const filePopup = document.getElementById("file-popup");
let fileMatches = [];
let fileIndex = 0;
let fileTimer = 0;
let fileQuery = null;
let fileRetried = false;
const FILE_DEBOUNCE = 120;
const FILE_RETRY = 400;

function fileOpen() {
  return !!filePopup && !filePopup.hidden;
}

function closeFiles() {
  if (filePopup) filePopup.hidden = true;
  fileQuery = null;
  clearTimeout(fileTimer);
}

/* The `@…` run the caret is sitting in, or null. Mirrors currentSlashQuery():
   the active LINE, not the whole box, and the mention must start a word — an
   e-mail address in the middle of a sentence is not a file mention. */
function currentFileQuery() {
  const { text } = activeSegment();
  const match = /(?:^|\s)@([^\s@]*)$/.exec(text);
  return match ? match[1] : null;
}

function renderFiles() {
  filePopup.replaceChildren();
  fileMatches.forEach((path, index) => {
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(index === fileIndex));
    // A path is a technical token: LTR and monospace, whatever the row's
    // direction (spec rule 2, the same treatment .slash-name gets).
    const name = document.createElement("span");
    name.className = "slash-name";
    name.setAttribute("dir", "ltr");
    name.textContent = path;
    li.append(name);
    li.addEventListener("mousedown", (e) => {
      e.preventDefault();
      fileIndex = index;
      acceptFile();
    });
    filePopup.append(li);
  });
  filePopup.children[fileIndex]?.scrollIntoView({ block: "nearest" });
}

async function askFiles(query, retry) {
  let files = [];
  try {
    const data = await api("/api/files?q=" + encodeURIComponent(query));
    files = Array.isArray(data.files) ? data.files : [];
  } catch (err) {
    files = [];
  }
  // The query moved on while the answer was out.
  if (fileQuery !== query || !filePopup) return;
  if (!files.length) {
    // Measured: the CLI's index answers the FIRST query after a spawn with
    // nothing at all, so one empty answer is not evidence of no files.
    if (!retry && !fileRetried) {
      fileRetried = true;
      fileTimer = setTimeout(() => askFiles(query, true), FILE_RETRY);
      return;
    }
    // Say so rather than vanishing: a menu that disappears on the second
    // keystroke reads as a broken window, not as an empty answer.
    fileMatches = [];
    filePopup.replaceChildren();
    const empty = document.createElement("li");
    empty.className = "is-empty";
    empty.append(label(FA.fileNone, "slash-desc"));
    filePopup.append(empty);
    filePopup.hidden = false;
    return;
  }
  fileRetried = false;
  fileMatches = files;
  fileIndex = 0;
  renderFiles();
  const box = filePopup.offsetParent?.getBoundingClientRect();
  if (box) filePopup.style.maxHeight = Math.max(140, box.top - 16) + "px";
  filePopup.hidden = false;
}

function refreshFiles() {
  if (!filePopup) return;
  const query = currentFileQuery();
  if (query === null) {
    closeFiles();
    return;
  }
  fileQuery = query;
  clearTimeout(fileTimer);
  // An empty `@` is a legitimate query for the index; it is also the moment
  // the user has typed one character, so the debounce covers both.
  fileTimer = setTimeout(() => askFiles(query, false), FILE_DEBOUNCE);
}

function acceptFile() {
  const path = fileMatches[fileIndex];
  if (!path) return;
  const { start, caret, text } = activeSegment();
  const at = text.lastIndexOf("@");
  if (at < 0) return;
  input.setRangeText("@" + path + " ", start + at, caret, "end");
  closeFiles();
  autoGrow();
  input.focus();
}

/* --- `!` bash mode ----------------------------------------------------------

   The TUI turns the prompt bar a different colour while the line starts with
   `!` and runs the line itself. So does this: the CLI cannot run it (§5.1) and
   would read it as a sentence, so the wrapper runs it and parks the tagged
   output for the next message — which is where the terminal puts it too. */
function bashCommand(text) {
  return text.startsWith("!") ? text.slice(1).trim() : null;
}

function refreshBashMode() {
  const box = document.querySelector(".comp-box");
  if (box) box.classList.toggle("bash", input.value.startsWith("!"));
}

async function runBash(command) {
  try {
    await api("/api/shell", { command });
  } catch (err) {
    bubble("error", FA.shellFailed);
  }
}

/* --- Ctrl+G, the external editor ------------------------------------------- */

let editing = false;

async function editExternally() {
  if (editing) return;
  editing = true;
  const wasPlaceholder = input.placeholder;
  input.disabled = true;
  input.placeholder = FA.editorWaiting;
  try {
    const data = await api("/api/editor", { text: input.value });
    if (data.changed && typeof data.text === "string") putInBox(data.text);
  } catch (err) {
    bubble("error", FA.editorFailed);
  } finally {
    editing = false;
    input.disabled = false;
    input.placeholder = wasPlaceholder;
    input.focus();
  }
}

/* --- the `?` sheet ---------------------------------------------------------

   The TUI's shortcuts table, translated, built from the same list the
   dispatcher reads. `?` opens it only on an EMPTY prompt: in a sentence it is
   a question mark and nothing else. */
const KEY_SHEET = [
  ["Enter", "keySend"],
  ["Shift+Enter · Ctrl+J · \\+Enter", "keyNewline"],
  ["Esc", "keyStop"],
  ["↑ / ↓", "keyHistory"],
  ["Ctrl+R", "keySearch"],
  ["/", "keySlash"],
  ["@", "keyFiles"],
  ["!", "keyBash"],
  ["Ctrl+G", "keyEditor"],
  ["Ctrl+L", "keyClear"],
  ["Ctrl+O", "keyExpand"],
  ["Ctrl+T", "keyTodos"],
  ["Alt+T", "keyThinking"],
  ["Alt+P", "keyModel"],
  ["Shift+Tab", "keyPosture"],
  ["Shift+Space", "keyZwnj"],
  ["Ctrl+V", "keyPaste"],
  ["Ctrl+X Enter", "keyQueue"],
  // The confirmation's own keys. They belong on this sheet because the dialog
  // is where a non-technical user meets a keyboard-only decision for the first
  // time (V2-PLAN §3.3, wiki/tui-keys.md «Confirmation»).
  ["۱ ۲ ۳", "keyDialogPick"],
  ["?", "keySheet"],
];

const keysDialog = document.getElementById("keys");

function paintKeySheet() {
  const body = document.getElementById("keys-body");
  if (!body || body.childElementCount) return;
  for (const [chord, key] of KEY_SHEET) {
    const row = document.createElement("div");
    row.className = "key-row";
    // The chord is Latin chrome in an RTL row: isolated, or `Shift+Enter`
    // reorders against the Persian beside it (spec rule 2).
    const kbd = document.createElement("kbd");
    kbd.setAttribute("dir", "ltr");
    kbd.textContent = chord;
    row.append(kbd, label(FA[key] ?? key, "key-what"));
    body.append(row);
  }
}

export function showKeySheet() {
  if (!keysDialog) return false;
  paintKeySheet();
  if (!keysDialog.open) keysDialog.showModal();
  return true;
}

/* --- lifecycle verbs ------------------------------------------------------- */

/* Commands that change the WRAPPER's state, not the conversation's. Sent to the
   CLI as text they would move the CLI and leave this window's own picture of
   the model, the posture and the log describing something that is no longer
   true.

   v2.4 is where these stopped being "click the chip that already does it": the
   chips are gone (V2-PLAN §2) and the pickers ARE the commands now (§3.3,
   "pickers behind commands"). Each entry answers with false when there is
   nothing to offer — no model list yet, a model with no effort levels — and a
   verb that answers false falls through to the CLI as ordinary text, exactly
   as a hidden chip used to.

   `/compact` is deliberately NOT here: it is not a control subtype on this
   build (measured — wiki/control-protocol.md), so it passes through to the CLI
   as text like every other slash command. */
const LIFECYCLE_VERBS = {
  model: openModelPicker,
  effort: openEffortPicker,
  "output-style": openStylePicker,
  permissions: openPosturePicker,
  clear: () => {
    const button = document.getElementById("btn-new");
    if (!button || button.hidden) return false;
    button.click();
    return true;
  },
};

/* --- the dispatcher ---------------------------------------------------------

   Capture phase on the textarea, and registered FIRST, so it sees Enter before
   the submit handler and Tab before the slash popup — the two keys whose
   meaning depends on what else is open. Anything it does not claim falls
   through to the browser, which is the rule the whole table is built on: a key
   the window does not bind is a key the textarea still has. */
function clearComposer() {
  input.value = "";
  dropPastes();
  endHistoryWalk();
  input.style.height = "auto";
  refreshBashMode();
  input.focus();
}

function insertNewline() {
  input.setRangeText("\n", input.selectionStart, input.selectionEnd, "end");
  autoGrow();
}

function promptKeys(e) {
  if (e.defaultPrevented || editing) return;
  // A modifier on its own is not a chord; it is the first half of one.
  if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;
  const chord = chordOf(e);

  // The search owns every key while it is open: the box is its query field.
  if (searchOn) {
    if (chord === "ctrl+r") {
      e.preventDefault();
      if (searchMatches.length) {
        searchIndex = (searchIndex + 1) % searchMatches.length;
        paintSearch();
      }
      return;
    }
    if (chord === "Escape" || chord === "Tab") {
      e.preventDefault();
      closeSearch(true);
      return;
    }
    if (chord === "Enter") {
      e.preventDefault();
      closeSearch(true);
      composer.requestSubmit();
      return;
    }
    return;
  }

  if (prefixArmed) {
    dropPrefix();
    if (chord === "ctrl+e") {           // ctrl+x ctrl+e, the TUI's editor chord
      e.preventDefault();
      editExternally();
      return;
    }
    if (chord === "Enter") {            // ctrl+x Enter: send it to the queue
      e.preventDefault();
      composer.requestSubmit();
      return;
    }
    // Any other second stroke: the prefix is spent and the key means itself.
  }
  // Cut is what ctrl+x means with a selection, and that has to keep working;
  // with none it does nothing, which is where the prefix fits.
  if (chord === "ctrl+x" && input.selectionStart === input.selectionEnd) {
    e.preventDefault();
    armPrefix();
    return;
  }

  // The `?` sheet, on an empty prompt only — inside a sentence it is
  // punctuation, and Persian uses «؟» for its own.
  if ((e.key === "?" || e.key === "؟") && !e.ctrlKey && !e.altKey
      && !input.value.trim()) {
    e.preventDefault();
    showKeySheet();
    return;
  }

  switch (chord) {
    case "ctrl+l":                      // chat:clearInput — NOT clear screen
      e.preventDefault();
      clearComposer();
      return;
    case "ctrl+j":                      // chat:newline, beside shift+Enter
      e.preventDefault();
      insertNewline();
      return;
    case "ctrl+g":
      e.preventDefault();
      editExternally();
      return;
    case "ctrl+r":
      e.preventDefault();
      openSearch();
      return;
    case "alt+t":
      e.preventDefault();
      toggleThinking();
      return;
    case "alt+p":
      // Nothing to pick from yet — `initialize` has not answered — so the key
      // is not ours, the way shift+Tab is not ours before a posture is
      // confirmed. openModelPicker() says so with a boolean.
      if (!openModelPicker()) return;
      e.preventDefault();
      return;
    default:
      break;
  }

  // A line ending in `\` continues on the next one — the shell habit the TUI
  // keeps, and the only newline chord that needs no modifier at all.
  if (chord === "Enter" && input.selectionStart === input.selectionEnd) {
    const caret = input.selectionStart ?? 0;
    if (input.value.slice(0, caret).endsWith("\\")) {
      e.preventDefault();
      input.setRangeText("\n", caret - 1, caret, "end");
      autoGrow();
      return;
    }
  }

  if (fileOpen()) {
    if (chord === "ArrowDown" || chord === "ArrowUp") {
      e.preventDefault();
      const step = chord === "ArrowDown" ? 1 : -1;
      fileIndex = (fileIndex + step + fileMatches.length) % fileMatches.length;
      renderFiles();
      return;
    }
    if (chord === "Tab") {
      e.preventDefault();
      acceptFile();
      return;
    }
    if (chord === "Escape") {
      e.preventDefault();
      closeFiles();
      return;
    }
    return;
  }

  // History, but only where the arrows are not already doing something: an
  // open menu owns them, and so does a multi-line message the caret is inside.
  if (slashOpen()) return;
  if (chord === "ArrowUp" && onFirstLine()) {
    e.preventDefault();
    walkHistory(-1);
  } else if (chord === "ArrowDown" && onLastLine() && historyIndex !== null) {
    e.preventDefault();
    walkHistory(1);
  }
}

/* Returns true when the text was a lifecycle verb and must not be sent. */
function interceptLifecycle(text) {
  const verb = /^\/([a-z-]+)\s*$/.exec(text)?.[1];
  const open = verb && LIFECYCLE_VERBS[verb];
  return open ? open() !== false : false;
}

/* --- init ------------------------------------------------------------------ */

/* Every side effect this module used to run at load time. app.js calls it once,
   in the same order the single-file version ran in. */
export function initComposer() {
  /* FIRST, and in the capture phase: the chords below decide what Enter, Tab
     and the arrows mean, and every handler after this one assumes that
     decision has already been taken (wiki/tui-keys.md «Chat»). */
  input.addEventListener("keydown", promptKeys, true);

  /* ZWNJ (نیم‌فاصله, U+200C) has no key on a standard layout but Persian needs
     it for correct word forms — می‌رود vs میرود. Spec rule 6 maps it to
     Shift+Space. setRangeText keeps native undo; the spec's execCommand is
     deprecated. */
  input.addEventListener("keydown", (e) => {
    // The dispatcher above ran first and may already have spent this key --
    // `\`+Enter inserts a newline, and without this check Enter went on to
    // submit the line it had just broken.
    if (e.defaultPrevented) return;
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

  input.addEventListener("input", autoGrow);
  // A placeholder the user deleted takes its parked text with it.
  input.addEventListener("input", prunePastes);

  input.addEventListener("input", () => {
    // While the search is open the box is its query field and nothing else.
    if (searchOn) {
      refreshSearch();
      return;
    }
    // Typing ends a history walk: from here the box is the person's again.
    endHistoryWalk();
    refreshBashMode();
    refreshFiles();
  });

  document.getElementById("keys-close")?.addEventListener("click",
    () => keysDialog?.close());

  composer.addEventListener("submit", async (e) => {
    e.preventDefault();
    // Enter ALWAYS sends. The popup used to swallow it to accept a completion,
    // which meant Enter did different things depending on invisible state —
    // Tab, click and the arrow keys accept instead.
    slashPopup && (slashPopup.hidden = true);
    closeFiles();
    const text = input.value.trim();
    if (!text && !attachments.length) return;
    /* `!` is a MODE, not a prefix the CLI understands: measured (§5.1), the
       model would just read the line. The wrapper runs it instead, and its
       output reaches the conversation with the next message. */
    const command = bashCommand(text);
    if (command !== null) {
      input.value = "";
      input.style.height = "auto";
      dropPastes();
      refreshBashMode();
      endHistoryWalk();
      if (command) runBash(command);
      return;
    }
    if (interceptLifecycle(text)) {
      input.value = "";
      input.style.height = "auto";
      dropPastes();
      return;
    }
    // The placeholders go back to being what was pasted. This is the last
    // moment they exist: the CLI, the transcript and history.jsonl all get the
    // real text, exactly as the TUI sends it.
    const payload = { text: expandPastes(text), attachments: attachments.slice() };
    input.value = "";
    input.style.height = "auto";
    dropPastes();
    // Up after a send walks what was just typed, without a round-trip: the
    // server appends the same text to history.jsonl at the same moment.
    if (historyList && payload.text
        && historyList[historyList.length - 1] !== payload.text) {
      historyList.push(payload.text);
    }
    endHistoryWalk();
    historyDraft = "";
    refreshBashMode();
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

  /* Esc stops the running turn, the way it does in the TUI. Routed through the
     stop button's own click, so there is one interrupt path and not two — and
     because that handler disables the button until the POST comes back, a
     held-down Esc is one request rather than thirty.

     Bound on the document: the key means the same thing wherever focus happens
     to be. Anything dismissible that is open owns Esc first — a modal, a
     popover, the slash list, the chip menu — and `defaultPrevented` covers
     whatever claims it after this was written (the sidebar's rename field
     already does). Idle Esc stays unbound on purpose: the TUI clears the box
     with it, and here the box holds the only copy of what was typed. */
  /* Shift+Tab cycles the approval posture, as it does in the TUI — the TUI
     has no "focus is elsewhere" state, so this binds on document rather than
     the textarea. Through controls.js's own cycler, which is the pill's code
     path — one choke point, so the chip still waits for the server's echo.

     Bound on the document, it has to give the key back wherever Tab navigation
     or typing is the actual point. The old back-off named only `dialog[open]`
     and the slash popup, which exempted almost nothing: the sidebar's inline
     rename field, the agents drawer and every menu are ordinary focusable
     elements, and Shift+Tab in one of them silently stepped the approval
     posture instead of moving focus. So the rule is inverted — the composer's
     own textarea cycles, everything editable or focus-trapping does not, and
     the inert parts of the page (body, the transcript) fall through to the
     cycle as before. A closed `[popover]` is display:none, so focus cannot be
     inside one and the bare attribute selector needs no state check.

     Typing in the composer with the slash popup OPEN still cycles — that is
     the pre-rework behaviour and it is deliberate: bare Tab accepts the
     completion (see the popup's own handler), Shift+Tab was never its key. */
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || !e.shiftKey) return;
    if (e.target !== input && e.target?.closest?.(
        "input, select, textarea, [contenteditable], " +
        "dialog[open], [popover], #slash-popup:not([hidden])")) return;
    // Held down, the key auto-repeats around 30 times a second, and every one
    // of those would POST /api/posture and push a set_permission_mode at the
    // CLI. One press, one change.
    if (e.repeat) {
      e.preventDefault();
      return;
    }
    // Nothing to cycle — no posture confirmed for this conversation yet — so
    // the key is not ours: leave it to the browser's reverse focus nav rather
    // than swallowing it into a no-op.
    if (!cyclePosture()) return;
    e.preventDefault();   // or focus moves on the way past
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented || !busy) return;
    if (document.querySelector("dialog[open], :popover-open, " +
                               "#slash-popup:not([hidden]), " +
                               "#file-popup:not([hidden])")) return;
    e.preventDefault();
    stopBtn?.click();
  });

  // Ctrl+V with an image on the clipboard. The clipboard hands over bytes with
  // no path, so the server spills them to a temp file and we attach that —
  // from here on it is an ordinary attachment. A text paste falls through
  // untouched, which is why the guard runs before preventDefault().
  input.addEventListener("paste", async (e) => {
    const images = [...(e.clipboardData?.files ?? [])]
      .filter((f) => f.type.startsWith("image/"));
    if (!images.length) {
      // A long text paste is parked as a chip instead of filling the box.
      // Read BEFORE preventDefault, and only prevented when it is actually
      // parked — a short paste has to reach the box the browser's own way,
      // with the browser's own undo entry.
      if (parkPaste(e.clipboardData?.getData("text/plain") ?? "")) e.preventDefault();
      return;
    }
    e.preventDefault();
    for (const file of images) {
      try {
        const { path } = await api("/api/attach/paste", {
          media_type: file.type,
          data: await base64Of(file),
        });
        if (path) setAttachments([...attachments, path]);
      } catch (err) {
        bubble("error", FA.pasteFailed);
      }
    }
  });

  document.getElementById("btn-attach")?.addEventListener("click", async () => {
    try {
      const { paths } = await api("/api/attach/pick", {});
      if (paths?.length) setAttachments([...attachments, ...paths]);
    } catch (err) {
      bubble("error", FA.sendFailed);
    }
  });

  input.addEventListener("input", refreshSlash);

  input.addEventListener("keydown", (e) => {
    if (!slashOpen()) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      slashIndex = (slashIndex + step + slashMatches.length) % slashMatches.length;
      renderSlash();
    } else if (e.key === "Tab" && !e.shiftKey) {
      // Bare Tab accepts the completion; Shift+Tab is the posture cycle above
      // and must not also pick a command out of an open popup.
      e.preventDefault();
      acceptSlash();
    } else if (e.key === "Escape") {
      e.preventDefault();
      slashPopup.hidden = true;
    }
  }, true);   // capture: must beat the Enter-submits handler above

  // The minute tick catches a window that never lost focus; visibilitychange
  // makes the return itself instant instead of up-to-a-minute late.
  setInterval(checkIdle, 60_000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) checkIdle();
  });

  setAttachments([]);
  setBusy(false);
  // Chrome the modules own rather than index.html: every one of these labels
  // belongs to a surface built here, and index.html keeps only the ids.
  for (const [id, key] of [["hs-label", "searchLabel"], ["hs-hint", "searchHint"],
                           ["keys-title", "keysTitle"], ["keys-close", "keysClose"]]) {
    const el = document.getElementById(id);
    if (el) el.textContent = FA[key];
  }
  const hint = document.getElementById("composer-hint");
  if (hint) {
    // Four hints was already the ceiling for one line; the rest of the table
    // lives behind `?`, which is where the TUI keeps it too.
    hint.textContent = [FA.hintZwnj, FA.hintPosture, FA.hintExpand,
                        FA.hintKeys].join(" · ");
  }
  input.focus();
}
