/* ============================================================================
   The composer: text input, ZWNJ, send/stop, attachments, slash autocomplete.
   ========================================================================= */
"use strict";

import { pathEl } from "./bidi.js";
import { api, token } from "./api.js";
import { bubble, label, paintQueued, state } from "./render.js";
/* An edge INTO the render↔chrome cycle, not a new cycle of its own: chrome.js
   imports render.js and api.js, neither of which imports this module back at
   evaluation time. `/branch` needs the one tab-switch path the sidebar already
   uses — a second one would send into a conversation the server thinks is
   parked (app.js switchTab). */
import { switchToTab, splitView } from "./chrome.js";

const FA = window.STRINGS;

/* --- away -------------------------------------------------------------------

   The CLI writes its own «※ recap: ...» only when the person has been away
   for five minutes, because generating one costs an API call. Same rule here,
   and the same definition of away: the window is not on screen, or nothing has
   been typed or clicked in it for five minutes. Turn traffic deliberately does
   NOT count -- `lastActivity` inside the factory is the conversation being used,
   and a long answer arriving is exactly the case where the person walked off.

   MODULE level: there is one person, and they are either at the window or not —
   four columns do not make four of them. */
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

/* --- one composer per cell -------------------------------------------------

   Everything below used to be module state, which is exactly the shape that
   cannot survive a second conversation on screen: one `busy`, one draft, one
   slash list, one context notice. The factory gives each cell its own, looked
   up inside its own `root` (MA4-T1). `cell` is read at CALL time, never
   cached — `cell.tab` changes under this closure every time the view is
   switched, and every session-scoped request below has to carry the CURRENT
   one.

   spec-test.html passes `root = document.body`: the harness IS the cell. */
export function makeComposer(root, cell) {

  // Cell-local elements (MA4-T0): `id` -> `class` inside the cell's own root.
  // Window-level ids (the new-chat button) stay `getElementById`.
  const $ = (cls) => root.querySelector("." + cls);

  const log = $("log");
  const input = $("input");
  const composer = $("composer");
  const sendBtn = $("send");
  const stopBtn = $("stop");
  /* The invitation to type, as index.html writes it — restored when a
     conversation comes back (setBlank below borrows the line). */
  const askPlaceholder = input?.placeholder ?? "";
  const attachRow = $("attachments");
  const slashPopup = $("slash-popup");

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

  function setBusy(running) {
    // A turn starting or ending is the conversation being USED — that is what
    // re-arms the idle hint. Boot's own setBusy(false) is a no-op transition
    // (busy is already false), so an untouched window never earns the hint.
    if (running || busy) lastActivity = Date.now();
    busy = !!running;
    if (stopBtn) stopBtn.hidden = !busy;
    // The CELL is busy, not the window (MA4-T2): four columns can be answering
    // at once and each one owns its own stop button. `body.busy` is still
    // written — agents.js and the idle hint read it — but it now mirrors the
    // FOCUSED column only, and app.js is what decides which that is.
    cell.root.classList?.toggle("busy", busy);
    cell.onBusy?.();
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
  function restoreDraft(text) {
    if (!input || !text) return;
    input.value = input.value ? input.value + "\n" + text : text;
    autoGrow();
  }

  /* No conversation is open at all (app.js blankView): every tab-less endpoint
     routes by the server's active tab, so a send lands on a 404 and the user gets
     the generic «ارسال ناموفق بود» — which reads as "your message failed" when
     the truth is that there is nowhere to send it yet. The box is closed and says
     so instead; app.js opens it again the moment a tab is on screen. */
  function setBlank(blank) {
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

  const notice = $("context-notice");
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
  function checkIdle(now = Date.now()) {
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

  function noteContext(pct) {
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
  function contextFull() {
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
  function snapshot() {
    return { busy, slashCommands, dismissedAt, lastContext, lastActivity,
             notice: noticeState,
             // The prompt history is the PROJECT's, read once per conversation:
             // carrying one tab's list into another would offer a folder's
             // prompts inside a different folder.
             historyList };
  }

  function restore(saved) {
    // A Ctrl+R search belongs to the box, and the box is one box: left open
    // across a switch, the new conversation's Enter inserted the OLD project's
    // history entry, and `searchDraft` still held the previous tab's text. Exit
    // first, without accepting — the query is not a message — and close the
    // popup, whose items are this project's prompts either way.
    endSearch(false);
    closePopup();
    const s = saved ?? {};
    slashCommands = s.slashCommands ?? [];
    historyList = s.historyList ?? null;
    historyIndex = null;
    historyDraft = "";
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
    if (note) button.append(label(note, "ctx-btn-note"));
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

  /* --- what the box is holding ------------------------------------------------

     Three of the features below write into the composer without a keystroke (a
     history entry, an editor's answer, a search match), so they all go through
     one setter: the box has to grow for it, and the `!` chip and the history
     walk both have to be told the text is not the person's own any more. */
  function putInBox(text) {
    input.value = text;
    input.setSelectionRange(text.length, text.length);
    autoGrow();
    refreshBashMode();
  }

  /* --- history: the same file the terminal walks ------------------------------

     ~/.claude/history.jsonl, filtered to this project, oldest first. Loaded once
     per conversation (the list is part of the composer snapshot, so a tab keeps
     its own) and appended to locally on send, so Up after a send walks what was
     just typed without a round-trip. The unsent draft is kept and comes back
     when the walk runs off the newest end — that is the difference between a
     history walk and losing a message. */
  let historyList = null;     // null = never loaded for this conversation
  let historyIndex = null;    // null = not walking
  let historyDraft = "";

  async function loadHistory() {
    if (historyList) return historyList;
    try {
      // The cwd is passed explicitly when this conversation knows its own: every
      // tab-less endpoint routes by the SERVER's active tab, and a walk started
      // in the moment between two switches would otherwise read another
      // project's prompts.
      const cwd = state.status?.cwd;
      const data = await api("/api/history?tab=" + encodeURIComponent(cell.tab)
        + (cwd ? "&cwd=" + encodeURIComponent(cwd) : ""));
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

  /* --- slash-command autocomplete (plan §B-6) -------------------------------- */

  let slashCommands = [];   // [{name, description, argumentHint}] — from the CLI

  /* The CLI is authoritative about what commands exist on this machine (custom
     skills, plugins). TWO sources feed this, and they are not equal: the
     `initialize` reply arrives at spawn with {name, description, argumentHint},
     while system/init only arrives after turn one and carries bare names. Taking
     the later, poorer list would silently strip every description off the popup —
     hence the downgrade guard. */
  function setSlashCommands(list) {
    const next = (list ?? [])
      .map((item) => (typeof item === "string" ? { name: item } : item))
      .filter((item) => item && item.name);
    if (!next.length) return;
    const rich = next.some((item) => item.description);
    if (!rich && slashCommands.some((item) => item.description)) return;
    slashCommands = next;
  }

  /* The verbs THIS window answers rather than the CLI (see LOCAL_VERBS below).
     They are merged into the popup here instead of into `slashCommands`, so a
     later `initialize` list can never drop them and the downgrade guard above
     stays a statement about the CLI's own answer. A verb the CLI also has keeps
     ours: the window's implementation is the one that will run. */
  const LOCAL_COMMANDS = [
    { name: "export", description: FA.cmdExportDesc },
    { name: "branch", description: FA.cmdBranchDesc },
    { name: "split", description: FA.cmdSplitDesc },
  ];

  function allCommands() {
    const local = new Set(LOCAL_COMMANDS.map((cmd) => cmd.name));
    return [...LOCAL_COMMANDS, ...slashCommands.filter((cmd) => !local.has(cmd.name))];
  }

  /* --- one popup, three lists ------------------------------------------------

     `#slash-popup` is the component; what fills it is decided here. The slash
     list, the `@` file list and the Ctrl+R history search are the same widget
     with the same arrows, the same Tab/Enter, the same Esc and the same mouse —
     so there is one renderer, one accept and one close, and `popMode` is the
     only thing that differs between them. */
  let popMode = "slash";    // "slash" | "file" | "search"
  let popItems = [];        // shape depends on popMode; popRow() knows each one
  let popIndex = 0;

  function popOpen() {
    return !!slashPopup && !slashPopup.hidden;
  }

  /* The popup's own geometry, the same three numbers `js/controls.js`
     positionMenu() reads: the gap it hangs above the prompt with, the breathing
     room it keeps at the column's edge, and the shortest list still worth
     opening. Local rather than imported - composer.js has no edge on
     controls.js in this edition (wiki/frontend-modules.md) and one popup is not
     worth making one. */
  const POP_GAP = 8;
  const POP_EDGE = 8;
  const POP_MIN = 140;

  /* Same trap as the picker menu, and now the same TWO answers to it (pcg-6nf.10).
     This opens upward out of the composer, so its 40cqh is only real when the
     composer is at the bottom of its column: in the home state it sits mid-column
     and the top rows were clipped instead of scrolling. Measured against the
     CELL, not the window (MA4-T1) - with one cell the two are the same rectangle.

     The 140px FLOOR under that cap is that defect one size down, and a 4-way
     split is where it shows: a quarter of a ~1050x710 window leaves ~90px above
     the prompt, the floor asks for 140, and the list drew 64px through the top of
     its own column onto the one above it (measured). A floor is still right - a
     40px list is not a list - so what gives instead is the ANCHOR: whatever the
     cap cannot buy above the prompt, the popup takes back by sliding down OVER
     the prompt, which keeps every row of it inside the column it belongs to.
     That is positionMenu()'s own fix; this is the same arithmetic on the one
     property the CSS anchors this popup with. */
  function showPopup() {
    /* UNHIDDEN FIRST, and this is the whole reason the cap that used to be
       written here never did anything: `[hidden]` is `display: none`, and a box
       that is not drawn has NO offsetParent - so `offsetParent?.getBounding...`
       was `undefined`, the `if (box)` guard skipped the write every single time,
       and the only cap this popup has ever had is the 40cqh in style.css.
       Measure at the CSS anchor too: whatever the last open left behind is part
       of what is read below. */
    slashPopup.style.insetBlockEnd = "";
    slashPopup.hidden = false;
    const box = slashPopup.offsetParent?.getBoundingClientRect();
    if (!box) return;
    const bounds = (root instanceof Element ? root : document.body)
      .getBoundingClientRect();
    const roomAbove = box.top - bounds.top - POP_GAP - POP_EDGE;
    slashPopup.style.maxHeight = Math.max(0, Math.min(
      bounds.height - 2 * POP_EDGE, Math.max(POP_MIN, roomAbove))) + "px";
    const over = Math.round(slashPopup.offsetHeight - roomAbove);
    if (over > 0) {
      slashPopup.style.insetBlockEnd = `calc(100% + ${POP_GAP - over}px)`;
    }
  }

  function popRow(item) {
    if (popMode === "file") {
      // A path is a technical token wherever it appears (spec rule 2 / plan
      // §B-10 item 2): pathEl gives it `.path`, dir=ltr and the isolate.
      return [pathEl(item)];
    }
    if (popMode === "search") {
      // A remembered prompt is the person's own prose, either script — so it is
      // the row's primary text and decides its own direction.
      const line = label(item, "hist-line");
      line.setAttribute("dir", "auto");
      return [line];
    }
    const nodes = [];
    // The command itself is an ASCII token: LTR and monospace, isolated from
    // the Persian description beside it (spec rule 2).
    const name = document.createElement("span");
    name.className = "slash-name";
    name.setAttribute("dir", "ltr");
    name.textContent = "/" + item.name;
    nodes.push(name);
    if (item.argumentHint) {
      const hint = document.createElement("span");
      hint.className = "slash-arg";
      hint.setAttribute("dir", "ltr");
      hint.textContent = item.argumentHint;
      nodes.push(hint);
    }
    if (item.description) {
      const desc = document.createElement("span");
      desc.className = "slash-desc";
      desc.setAttribute("dir", "auto");   // English from the CLI, Persian from skills
      desc.textContent = item.description;
      nodes.push(desc);
    }
    return nodes;
  }

  function renderPopup() {
    slashPopup.replaceChildren();
    popItems.forEach((item, index) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(index === popIndex));
      li.append(...popRow(item));
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();       // keep focus in the textarea
        popIndex = index;
        acceptPopup();
      });
      slashPopup.append(li);
    });
    slashPopup.children[popIndex]?.scrollIntoView({ block: "nearest" });
  }

  function stepPopup(step) {
    if (!popItems.length) return;
    popIndex = (popIndex + step + popItems.length) % popItems.length;
    renderPopup();
  }

  /* Closing is never an accept — the search puts the draft back rather than the
     match, exactly as Esc on a menu leaves the state alone. */
  function closePopup() {
    clearTimeout(fileTimer);
    fileQuery = null;
    if (popMode === "search") endSearch(false);
    popMode = "slash";
    if (slashPopup) slashPopup.hidden = true;
  }

  function acceptPopup() {
    if (popMode === "file") return acceptFile();
    if (popMode === "search") return endSearch(true);
    return acceptSlash();
  }

  /* The one entry point every keystroke reaches: which of the three lists (if
     any) the caret is currently asking for. */
  function refreshPopup() {
    if (!slashPopup) return;
    if (popMode === "search") { refreshSearch(); return; }
    if (currentSlashQuery() !== null) { refreshSlash(); return; }
    if (currentFileQuery() !== null) { refreshFiles(); return; }
    closePopup();
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
    const query = currentSlashQuery();
    if (query === null) {
      closePopup();
      return;
    }
    popMode = "slash";
    popItems = allCommands()
      .filter((cmd) => cmd.name.toLowerCase().startsWith(query.toLowerCase()))
      .slice(0, 50);
    if (!popItems.length) {
      slashPopup.hidden = true;
      return;
    }
    popIndex = 0;
    renderPopup();
    showPopup();
  }

  /* Completes the active line only, through setRangeText so native undo still
     works — the old version replaced the whole composer. */
  function acceptSlash() {
    const cmd = popItems[popIndex];
    if (!cmd) return;
    const { start, caret } = activeSegment();
    input.setRangeText("/" + cmd.name + " ", start, caret, "end");
    slashPopup.hidden = true;
    input.focus();
  }

  /* --- Ctrl+R, the reverse search over the history ----------------------------

     The BOX holds the query while it is open and the popup shows the matches,
     which is how the TUI does it with one line of input. Enter (or Tab, or a
     click) puts the match in the box and does NOT send it; Esc puts back
     whatever was being written. */
  let searchDraft = "";

  function refreshSearch() {
    const query = input.value.trim().toLowerCase();
    const list = historyList ?? [];
    // Newest first: the answer to "what did I type last week" is almost always
    // the most recent one, and Ctrl+R walks back from there.
    // Capped like refreshSlash(): history.jsonl runs to thousands of lines and an
    // empty query matches all of them, so every keystroke of Ctrl+R was building
    // and laying out the whole file. Newest first, so the 50 are the useful ones.
    popItems = (query
      ? list.filter((line) => line.toLowerCase().includes(query)).reverse()
      : [...list].reverse()).slice(0, 50);
    popIndex = 0;
    if (!popItems.length) {
      // Say so rather than vanishing: a list that disappears on the second
      // keystroke reads as a broken window, not as an empty answer.
      slashPopup.replaceChildren();
      const empty = document.createElement("li");
      empty.className = "is-empty";
      empty.append(label(FA.searchNone, "slash-desc"));
      slashPopup.append(empty);
    } else {
      renderPopup();
    }
    showPopup();
  }

  async function openSearch() {
    if (!slashPopup || popMode === "search") return;
    await loadHistory();
    popMode = "search";
    searchDraft = input.value;
    endHistoryWalk();
    input.value = "";
    autoGrow();
    refreshSearch();
    input.focus();
  }

  /* `accept` false is the way out that changes nothing. The two exits are
     different acts and collapsing them would make Esc destructive: the query
     the search was typed with is not a message. */
  function endSearch(accept) {
    if (popMode !== "search") return;
    const chosen = accept && popItems.length ? popItems[popIndex] : searchDraft;
    popMode = "slash";
    slashPopup.hidden = true;
    putInBox(chosen);
    input.focus();
  }

  /* --- `@` file completion ----------------------------------------------------

     The list is the CLI's own index (server: /api/files → `file_suggestions`),
     so the window offers the files the terminal offers. Two measured quirks live
     here: the first query after a spawn comes back empty because the index warms
     on demand, so the menu asks again; and what is inserted is `@path` as TEXT —
     the CLI expands it itself. */
  let fileTimer = 0;
  let fileQuery = null;
  let fileRetried = false;
  const FILE_DEBOUNCE = 120;
  const FILE_RETRY = 400;

  /* The `@…` run the caret is sitting in, or null. Mirrors currentSlashQuery():
     the active LINE, not the whole box, and the mention must start a word — an
     e-mail address in the middle of a sentence is not a file mention. */
  function currentFileQuery() {
    const match = /(?:^|\s)@([^\s@]*)$/.exec(activeSegment().text);
    return match ? match[1] : null;
  }

  async function askFiles(query, retry) {
    let files = [];
    try {
      const data = await api("/api/files?q=" + encodeURIComponent(query)
                             + "&tab=" + encodeURIComponent(cell.tab));
      files = Array.isArray(data.files) ? data.files : [];
    } catch (err) {
      files = [];
    }
    // The query moved on while the answer was out.
    if (fileQuery !== query || !slashPopup) return;
    if (!files.length) {
      // Measured: the CLI's index answers the FIRST query after a spawn with
      // nothing at all, so one empty answer is not evidence of no files.
      if (!retry && !fileRetried) {
        fileRetried = true;
        fileTimer = setTimeout(() => askFiles(query, true), FILE_RETRY);
        return;
      }
      popMode = "file";
      popItems = [];
      slashPopup.replaceChildren();
      const empty = document.createElement("li");
      empty.className = "is-empty";
      empty.append(label(FA.fileNone, "slash-desc"));
      slashPopup.append(empty);
      showPopup();
      return;
    }
    fileRetried = false;
    popMode = "file";
    popItems = files;
    popIndex = 0;
    renderPopup();
    showPopup();
  }

  function refreshFiles() {
    const query = currentFileQuery();
    if (query === null) {
      closePopup();
      return;
    }
    fileQuery = query;
    clearTimeout(fileTimer);
    // An empty `@` is a legitimate query for the index; it is also the moment
    // the user has typed one character, so the debounce covers both.
    fileTimer = setTimeout(() => askFiles(query, false), FILE_DEBOUNCE);
  }

  function acceptFile() {
    const path = popItems[popIndex];
    if (!path) return;
    const { start, caret, text } = activeSegment();
    const at = text.lastIndexOf("@");
    if (at < 0) return;
    input.setRangeText("@" + path + " ", start + at, caret, "end");
    closePopup();
    autoGrow();
    input.focus();
  }

  /* --- `!` shell mode ---------------------------------------------------------

     The TUI turns the prompt bar a different colour while the line starts with
     `!` and runs the line itself. So does this: the CLI cannot run it and would
     read it as a sentence, so the wrapper runs it in the session's folder and
     parks the tagged output for the next message — which is where the terminal
     puts it too. The row in the transcript is painted from the server's own
     `wrapper/shell` event (render.js renderShell), never from this answer, so a
     reload replays it identically. */
  const bashChip = $("bash-chip");

  /* ONE predicate for the chip and for the send, because two of them disagreed:
     the chip tested the raw value and the send tested the trimmed one, so
     `" !dir"` ran a shell command with nothing on the box to say so, and a bare
     `"!"` wore the chip and was sent to the CLI as a message. null means "not a
     shell line"; "" means `!` with nothing after it, which is a mode the person
     is halfway into typing and is swallowed rather than sent. */
  function bashCommand(text) {
    const line = text.trim();
    return line.startsWith("!") ? line.slice(1).trim() : null;
  }

  function refreshBashMode() {
    const box = input?.closest(".comp-box");
    const on = !!input && bashCommand(input.value) !== null;
    if (box) box.classList.toggle("bash", on);
    if (bashChip) bashChip.hidden = !on;
  }

  async function runBash(command) {
    try {
      await api("/api/shell", { command, tab: cell.tab });
    } catch (err) {
      bubble("error", FA.shellFailed);
    }
  }

  /* --- Ctrl+G, the external editor -------------------------------------------

     The box is disabled while the editor is open, because the answer replaces
     what is in it — and a placeholder is the only thing that can say why the
     window stopped taking keystrokes. Focus comes back either way. */
  let editing = false;

  async function editExternally() {
    if (editing || !input || input.disabled) return;
    editing = true;
    const wasPlaceholder = input.placeholder;
    input.disabled = true;
    input.placeholder = FA.editorWaiting;
    // WHICH conversation asked. The editor blocks for as long as the person
    // leaves it open, and applySwitch() re-enables the box on the way past — so
    // by the time this resolves the visible tab may be a different one, and
    // writing the answer into it would overwrite an unrelated draft. The
    // conversation is identified by its give-back list rather than by a tab id:
    // that array IS the render scope's (app.js swaps the scope in and out by
    // reference), so this needs nothing from the tab registry.
    const origin = state.returned;
    try {
      const data = await api("/api/editor", { text: input.value });
      if (data.changed && typeof data.text === "string") {
        // Still the same conversation: the answer replaces what it was made from.
        if (state.returned === origin) putInBox(data.text);
        // Otherwise it waits for that tab's next paint, the way a returned queued
        // message does — appended to whatever is in the box then, never assigned.
        else origin.push(data.text);
      }
    } catch (err) {
      bubble("error", FA.editorFailed);
    } finally {
      editing = false;
      // Only the conversation that shut the box may open it again. Somewhere
      // else, the box already belongs to that tab — applySwitch() re-enabled it
      // and setBlank() may have shut it for its own reason.
      if (state.returned === origin) {
        input.disabled = false;
        input.placeholder = wasPlaceholder;
        input.focus();
      }
    }
  }

  /* --- /export and /branch, the two window-local verbs -------------------------

     Both read or fork what THIS window is showing, so neither can be a message
     to the CLI. They hang off interceptLifecycle() below — the seam that already
     exists for verbs the window answers itself — rather than a second dispatcher
     beside it. */

  /* A local answer is a muted row, the same shape «متوقف شد» uses. It is not an
     assistant message and must never look like one: nothing here reached the
     model. */
  function note(text) {
    const el = bubble("assistant", text);
    el.classList.add("meta");
    return el;
  }

  /* Plain text, in the order it was said. Tool cards go in whole — a card is
     what the window showed, and an export that silently dropped the work is not
     a record of the session. */
  /* innerText is deliberately what is read — it is the text as the reader saw it,
     line breaks and all — but it omits the body of a CLOSED <details>, and every
     tool, diff and shell card is closed by default. So an export of a real
     session was the sentences with all the work missing. Opened and put straight
     back: no frame is painted between the two, because nothing here awaits. */
  function textOf(node) {
    const shut = [...node.querySelectorAll("details:not([open])")];
    if (node.tagName === "DETAILS" && !node.open) shut.push(node);
    for (const card of shut) card.open = true;
    try {
      return (node.innerText || node.textContent || "").trim();
    } finally {
      for (const card of shut) card.open = false;
    }
  }

  function transcriptText() {
    const out = [];
    for (const node of log?.children ?? []) {
      if (node.hidden) continue;
      const text = textOf(node);
      if (!text) continue;
      if (node.classList.contains("msg") && node.classList.contains("user")) {
        out.push(FA.exportYou + "\n" + text);
      } else if (node.classList.contains("msg")
                 && node.classList.contains("assistant")
                 && !node.classList.contains("meta")) {
        out.push(FA.exportClaude + "\n" + text);
      } else {
        out.push(text);
      }
    }
    return out.join("\n\n");
  }

  function exportTranscript() {
    const text = transcriptText();
    if (!text) { note(FA.cmdExportEmpty); return true; }
    // Started, never awaited: a command that waited for its own answer would
    // hold the composer shut.
    api("/api/export", { text })
      .then((data) => {
        const el = bubble("assistant", "");
        el.classList.add("meta");
        el.append(label(FA.cmdExported + " "), pathEl(String(data.path ?? "")));
      })
      .catch(() => bubble("error", FA.cmdExportFailed));
    return true;
  }

  function forkSession() {
    api("/api/session/fork", { tab: cell.tab })
      .then(async (data) => {
        // The note goes in AFTER the switch, so it lands in the branch's own
        // transcript: switching tabs swaps the render target, and a line written
        // before it would be left behind in the conversation that was forked.
        await switchToTab(data.tab);
        note(FA.cmdBranchDone);
      })
      .catch(() => bubble("error", FA.cmdBranchFailed));
    return true;
  }

  /* --- /split ------------------------------------------------------------------

     How many conversations are on screen at once (MA4). The window bar's
     segmented control is the same verb with a button in front of it; both go
     through chrome.js's one-way bridge into app.js, which owns the cells — the
     same arrow `/branch` already uses for switchToTab.

     A bad argument does NOT fall through to the CLI: `/split 3` is unmistakably
     aimed at this window, and a refusal from the model is a worse answer than
     the one line saying which numbers exist. */
  const SPLITS = new Set([1, 2, 4]);

  /* Persian and Arabic-Indic digits both reach the box — the composer is where
     a Persian keyboard types. */
  function latinDigits(text) {
    return text.replace(/[۰-۹٠-٩]/g,
                        (d) => String(d.charCodeAt(0) & 0xF));
  }

  function splitGrid(arg) {
    const n = Number(latinDigits(String(arg ?? "").trim()));
    if (!SPLITS.has(n)) {
      note(FA.cmdSplitUsage);
      return true;
    }
    if (!splitView(n)) return false;   // no grid here (the spec harness)
    // `/split 4` is a 2×2, not four columns — one of the two layouts this verb
    // draws is not a row of columns at all, so it gets its own sentence.
    note(n === 4 ? FA.cmdSplitDoneGrid
                 : FA.cmdSplitDone.replace("{n}", n.toLocaleString("fa-IR")));
    return true;
  }

  /* --- lifecycle verbs ------------------------------------------------------- */

  /* Commands that change the WRAPPER's state, not the conversation's. Sent to the
     CLI as text they would move the CLI and leave this window's model chip, pill
     and log describing something that is no longer true. Each one presses the
     button the user could have pressed themselves — no second implementation of
     what the chip already does, and nothing to keep in sync.

     `/compact` is deliberately NOT here: it is not a control subtype on this
     build (measured — wiki/control-protocol.md), so it passes through to the CLI
     as text like every other slash command. */
  const LIFECYCLE_BUTTONS = {
    model: () => $("model-chip"),
    permissions: () => $("posture-chip"),
    // The one WINDOW-level button of the three: there is a single new-chat
    // button in the sidebar however many columns are on screen.
    clear: () => document.getElementById("btn-new"),
  };

  /* The other half of the same seam: verbs the window ANSWERS rather than
     presses a button for. Same contract — true means "handled, do not send". */
  const LOCAL_VERBS = {
    export: exportTranscript,
    branch: forkSession,
    split: splitGrid,
  };

  /* Returns true when the text was a lifecycle verb and must not be sent.
     The argument half is deliberately narrow — digits only, and only for a verb
     this window answers: anything else is a message for the CLI, and swallowing
     `/model sonnet` here would silently drop it. */
  function interceptLifecycle(text) {
    const found = /^\/([a-z-]+)(?:\s+(\S+))?\s*$/.exec(text);
    const verb = found?.[1];
    const arg = found?.[2];
    if (verb && LOCAL_VERBS[verb]) return LOCAL_VERBS[verb](arg) !== false;
    if (arg) return false;   // `/model sonnet` is the CLI's, not ours
    const find = verb && LIFECYCLE_BUTTONS[verb];
    const button = find && find();
    if (!button || button.hidden) return false;   // unavailable: let it through
    button.click();
    return true;
  }

  /* --- init ------------------------------------------------------------------ */

  /* Every side effect this module used to run at load time. app.js calls it once,
     in the same order the single-file version ran in. */
  function initComposer() {
    /* ZWNJ (نیم‌فاصله, U+200C) has no key on a standard layout but Persian needs
       it for correct word forms — می‌رود vs میرود. Spec rule 6 maps it to
       Shift+Space. setRangeText keeps native undo; the spec's execCommand is
       deprecated. */
    input.addEventListener("keydown", (e) => {
      if (e.key === " " && e.shiftKey) {
        e.preventDefault();
        const { selectionStart, selectionEnd } = input;
        input.setRangeText("\u200C", selectionStart, selectionEnd, "end");
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        // In the Ctrl+R search the box holds the QUERY, not a message: Enter
        // takes the match and leaves it there to be read, edited or sent.
        if (popMode === "search") {
          endSearch(true);
          return;
        }
        composer.requestSubmit();
      }
    });

    input.addEventListener("input", autoGrow);
    input.addEventListener("input", endHistoryWalk);
    input.addEventListener("input", refreshBashMode);

    composer.addEventListener("submit", async (e) => {
      e.preventDefault();
      // While the reverse search is open the box holds the QUERY, not a message:
      // submitting accepts the highlighted match into the box and sends nothing.
      // The Enter key already did this; #send did not, so clicking it POSTed the
      // search query as a chat message and threw the stashed draft away.
      if (popMode === "search") { endSearch(true); return; }
      // Enter ALWAYS sends. The popup used to swallow it to accept a completion,
      // which meant Enter did different things depending on invisible state —
      // Tab, click and the arrow keys accept instead.
      slashPopup && (slashPopup.hidden = true);
      const text = input.value.trim();
      if (!text && !attachments.length) return;
      // A line starting with `!` is a shell command, not a message — the one
      // case where Enter does not reach the CLI at all. The chip on the box is
      // what says so before the key is pressed.
      const command = bashCommand(text);
      if (command !== null) {
        input.value = "";
        input.style.height = "auto";
        refreshBashMode();
        endHistoryWalk();
        // A bare `!` is the mode, not a command: nothing to run, and nothing the
        // CLI should ever see. Same rule as the terminal edition.
        if (command) runBash(command);
        return;
      }
      if (interceptLifecycle(text)) {
        input.value = "";
        input.style.height = "auto";
        return;
      }
      // `tab` explicit, like every other session-scoped request here (MA4 §2):
      // a tab-less body routes by the SERVER's active tab, and click-then-Enter
      // beats the /api/tab/activate POST that keeps the two agreeing.
      const payload = { tab: cell.tab, text, attachments: attachments.slice() };
      // Up walks what was just typed without a round-trip: the CLI appends the
      // same line to history.jsonl, so the local copy stays the file's copy.
      if (historyList && text && historyList[historyList.length - 1] !== text) {
        historyList.push(text);
      }
      endHistoryWalk();
      historyDraft = "";
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
          body: JSON.stringify({ tab: cell.tab }),
        });
      } catch (err) {
        console.error("interrupt failed", err);
      } finally {
        stopBtn.disabled = false;
      }
    });

    /* The two chords the WINDOW owns — Esc (stop) and Shift+Tab (posture) —
       used to be registered here. They are app.js's now: bound inside this
       factory they would be registered once per column, and one Esc would stop
       four turns (MA4-T1). The verbs they reach are on the returned object. */

    // Ctrl+V with an image on the clipboard. The clipboard hands over bytes with
    // no path, so the server spills them to a temp file and we attach that —
    // from here on it is an ordinary attachment. A text paste falls through
    // untouched, which is why the guard runs before preventDefault().
    input.addEventListener("paste", async (e) => {
      const images = [...(e.clipboardData?.files ?? [])]
        .filter((f) => f.type.startsWith("image/"));
      if (!images.length) return;
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

    $("btn-attach")?.addEventListener("click", async () => {
      try {
        const { paths } = await api("/api/attach/pick", {});
        if (paths?.length) setAttachments([...attachments, ...paths]);
      } catch (err) {
        bubble("error", FA.sendFailed);
      }
    });

    input.addEventListener("input", refreshPopup);

    input.addEventListener("keydown", (e) => {
      // The two chords, first: both are browser keys (reload, "find again"), so
      // they have to be claimed before anything else looks at them. Bound on the
      // textarea rather than the document — Ctrl+R anywhere else in the window
      // is still the reload the user meant.
      if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        if (e.key === "r" || e.key === "R") {
          e.preventDefault();
          openSearch();
          return;
        }
        if (e.key === "g" || e.key === "G") {
          e.preventDefault();
          editExternally();
          return;
        }
      }
      if (!popOpen()) {
        // Up at the top of the box walks the history, the way the TUI does it;
        // anywhere else the arrow is the caret's. Down only ever ends a walk
        // that is already running, so a stray press cannot overwrite the box.
        if (e.key === "ArrowUp" && onFirstLine()) {
          e.preventDefault();
          walkHistory(-1);
        } else if (e.key === "ArrowDown" && historyIndex !== null && onLastLine()) {
          e.preventDefault();
          walkHistory(1);
        }
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        stepPopup(e.key === "ArrowDown" ? 1 : -1);
      } else if (e.key === "Tab" && !e.shiftKey) {
        // Bare Tab accepts the completion; Shift+Tab is the posture cycle above
        // and must not also pick a command out of an open popup.
        e.preventDefault();
        acceptPopup();
      } else if (e.key === "Escape") {
        e.preventDefault();
        closePopup();
      }
    }, true);   // capture: must beat the Enter-submits handler above

    /* The idle tick (a minute-long interval plus a visibilitychange listener)
       is app.js's now, for the same reason the two chords above are: it is one
       clock per window, not one per column, and an interval bound here would
       outlive a cell a later `/split 1` removes and go on poking a detached
       column. */

    setAttachments([]);
    setBusy(false);
    refreshBashMode();
    const bashLabel = $("bash-chip-label");
    if (bashLabel) bashLabel.textContent = FA.bashChip;
    const hint = $("composer-hint");
    if (hint) {
      hint.textContent = [FA.hintZwnj, FA.hintPosture, FA.hintEditor,
                          FA.slashHint].join(" · ");
    }
    input.focus();
  }

  initComposer();

  /* What the rest of the window is allowed to reach. `input` is the element the
     key gates elsewhere test focus against; everything else is a verb app.js
     and render.js used to import by name. */
  return {
    input,
    setBusy, snapshot, restore, setSlashCommands, noteContext, contextFull,
    restoreDraft, setBlank, checkIdle,
    focus: () => input?.focus(),
    // Read by the two window-level chords app.js binds for every column.
    isBusy: () => busy,
    stop: () => stopBtn?.click(),
  };
}
