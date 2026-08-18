/* ============================================================================
   The composer: text input, ZWNJ, send/stop, attachments, slash autocomplete.
   ========================================================================= */
"use strict";

import { pathEl } from "./bidi.js";
import { api, token } from "./api.js";
import { bubble, label } from "./render.js";
/* One-way, and no new cycle: controls.js imports api.js and nothing else. */
import { cyclePosture } from "./controls.js";

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
  model: "#model-chip",
  permissions: "#posture-chip",
  clear: "#btn-new",
};

/* Returns true when the text was a lifecycle verb and must not be sent. */
function interceptLifecycle(text) {
  const verb = /^\/([a-z-]+)\s*$/.exec(text)?.[1];
  const selector = verb && LIFECYCLE_BUTTONS[verb];
  const button = selector && document.querySelector(selector);
  if (!button || button.hidden) return false;   // unavailable: let it through
  button.click();
  return true;
}

/* --- init ------------------------------------------------------------------ */

/* Every side effect this module used to run at load time. app.js calls it once,
   in the same order the single-file version ran in. */
export function initComposer() {
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
    /* Shift+Tab cycles the approval posture, as it does in the TUI. Through
       controls.js's own cycler, which is the pill's code path — one choke
       point, so the chip still waits for the server's echo. */
    if (e.key === "Tab" && e.shiftKey) {
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
      e.preventDefault();   // or focus leaves the box on the way past
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
    // Enter ALWAYS sends. The popup used to swallow it to accept a completion,
    // which meant Enter did different things depending on invisible state —
    // Tab, click and the arrow keys accept instead.
    slashPopup && (slashPopup.hidden = true);
    const text = input.value.trim();
    if (!text && !attachments.length) return;
    if (interceptLifecycle(text)) {
      input.value = "";
      input.style.height = "auto";
      return;
    }
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
  const hint = document.getElementById("composer-hint");
  if (hint) {
    hint.textContent = [FA.hintZwnj, FA.hintPosture, FA.slashHint].join(" · ");
  }
  input.focus();
}
