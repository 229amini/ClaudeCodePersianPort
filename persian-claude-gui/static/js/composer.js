/* ============================================================================
   The composer: text input, ZWNJ, send/stop, attachments, slash autocomplete.
   ========================================================================= */
"use strict";

import { pathEl } from "./bidi.js";
import { api, token } from "./api.js";
import { bubble } from "./render.js";

const FA = window.STRINGS;

const input = document.getElementById("input");
const composer = document.getElementById("composer");
const stopBtn = document.getElementById("stop");
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
export function setBusy(busy) {
  if (stopBtn) stopBtn.hidden = !busy;
  document.body.classList.toggle("busy", busy);
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
    } else if (e.key === "Tab") {
      e.preventDefault();
      acceptSlash();
    } else if (e.key === "Escape") {
      e.preventDefault();
      slashPopup.hidden = true;
    }
  }, true);   // capture: must beat the Enter-submits handler above

  setAttachments([]);
  setBusy(false);
  const hint = document.getElementById("composer-hint");
  if (hint) hint.textContent = FA.hintZwnj + " · " + FA.slashHint;
  input.focus();
}
