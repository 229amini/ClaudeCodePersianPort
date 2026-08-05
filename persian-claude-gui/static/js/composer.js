/* ============================================================================
   The composer: text input, ZWNJ, send/stop, attachments, slash autocomplete.
   ========================================================================= */
"use strict";

import { pathEl } from "./bidi.js";
import { api, token } from "./api.js";
import { bubble } from "./render.js";

const FA = window.FA;

const input = document.getElementById("input");
const composer = document.getElementById("composer");
const sendBtn = document.getElementById("send");
const stopBtn = document.getElementById("stop");
const attachRow = document.getElementById("attachments");
const slashPopup = document.getElementById("slash-popup");

/* While a turn is running the send button is replaced by a stop button rather
   than merely disabled — a non-technical user needs an obvious way out, and the
   interrupt leaves the process (and the session) alive. */
export function setBusy(busy) {
  if (sendBtn) sendBtn.hidden = busy;
  if (stopBtn) stopBtn.hidden = !busy;
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

let slashCommands = [];   // filled from system/init - authoritative per machine
let slashMatches = [];
let slashIndex = 0;

/* The CLI is authoritative about what commands exist on this machine (custom
   skills, plugins), so the renderer hands the list over from system/init. */
export function setSlashCommands(names) {
  slashCommands = names;
}

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
