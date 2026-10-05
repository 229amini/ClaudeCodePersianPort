/* ============================================================================
   Focus view, after the Claude Code VS Code extension's.

   What you said and what Claude answered, and nothing of how it got there:
   every turn's process rows — the tool runs, a helper's card, the earlier
   to-do lists — fold behind ONE row, «۷ مرحله», at the place the first of them
   stood. A click on that row opens that turn's steps where they are. What
   stays in the open: the messages, a question and its Questions row, the
   change card, the LATEST to-do list (the extension keeps it too), and the
   permission dialog, which is not in the transcript at all.

   Nothing is moved or wrapped. The renderer appends into the log and reads
   its siblings (the polling fold compares `nextElementSibling`), so this only
   writes classes and one data attribute on the rows that are already there,
   and repaints the whole log from scratch on the next frame after any append.
   On or off is the window's own preference, kept in sessionStorage the way
   prefs.js keeps zoom (the port, and so the origin, changes every run), and
   toggled by Ctrl+Alt+F — the extension's chord — or `/focus`.

   ONE FILE, BOTH EDITIONS: static/js/focus.js and static-terminal/js/focus.js
   are byte-identical (test_parity.py says so). A LEAF: it imports nothing;
   the renderer and the command table call in.
   ========================================================================= */
"use strict";

const FA = window.STRINGS;
const PREF = "focusView";
const PROCESS = "details.run, details.card.group, details.card.todos";
const opened = new WeakSet();   // turn starts (or the log, before any) whose steps were opened
const pending = new Set();

function readPref() {
  try {
    return JSON.parse(window.sessionStorage.getItem(PREF) ?? "null") === true;
  } catch (err) {
    return false;          // site data blocked: the view starts off
  }
}

function writePref(on) {
  try {
    window.sessionStorage.setItem(PREF, JSON.stringify(on));
  } catch (err) {
    // A full or blocked store costs the preference, never the window.
  }
}

export function focusOn() {
  return document.body.classList.contains("focus-view");
}

export function setFocus(on) {
  document.body.classList.toggle("focus-view", !!on);
  writePref(!!on);
  for (const log of document.querySelectorAll(".log")) paintFocus(log);
  return !!on;
}

export function toggleFocus() {
  return setFocus(!focusOn());
}

/* The renderer calls this on every append. One repaint per log per frame,
   however many rows a replay lands at once; nothing at all while off. */
export function scheduleFocus(log) {
  if (!log || !focusOn() || pending.has(log)) return;
  pending.add(log);
  requestAnimationFrame(() => {
    pending.delete(log);
    paintFocus(log);
  });
}

function steps(el) {
  if (!el.matches("details.run")) return 1;
  return el.querySelectorAll(":scope > .card-body > *").length || 1;
}

function turnOf(el) {
  for (let p = el.previousElementSibling; p; p = p.previousElementSibling) {
    if (p.matches(".msg.user")) return p;
  }
  return el.parentElement;
}

export function paintFocus(log) {
  const kids = [...log.children];
  for (const el of kids) {
    if (!el.classList.contains("focus-proc")) continue;
    el.classList.remove("focus-proc", "focus-head", "focus-open");
    el.querySelector(":scope > summary")?.removeAttribute("data-focus-label");
  }
  if (!focusOn()) return;
  const latestTodos = kids.filter((el) => el.matches("details.card.todos")).at(-1);
  let turn = log;
  let group = [];
  const flush = () => {
    if (!group.length) return;
    const open = opened.has(turn);
    const n = group.reduce((sum, el) => sum + steps(el), 0);
    for (const el of group) {
      el.classList.add("focus-proc");
      el.classList.toggle("focus-open", open);
    }
    group[0].classList.add("focus-head");
    group[0].querySelector(":scope > summary")?.setAttribute(
      "data-focus-label", FA.focusSteps.replace("{n}", n.toLocaleString("fa-IR")));
    group = [];
  };
  for (const el of kids) {
    if (el.matches(".msg.user")) {
      flush();
      turn = el;
      continue;
    }
    if (el !== latestTodos && el.matches(PROCESS)) group.push(el);
  }
  flush();
}

/* The folded row opens its turn's steps, in place. Captured so the <details>
   under it does not also toggle: opening the turn is the whole act. */
function onClick(e) {
  if (!focusOn()) return;
  const summary = e.target?.closest?.(".focus-head:not(.focus-open) > summary");
  if (!summary) return;
  e.preventDefault();
  e.stopPropagation();
  const head = summary.parentElement;
  opened.add(turnOf(head));
  paintFocus(head.parentElement);
}

/* Ctrl+Alt+F, the extension's chord. Not when AltGr is held: on a Windows
   keyboard AltGr IS Ctrl+Alt, and a layout that types a character there must
   keep typing it. */
function onKey(e) {
  if (e.code !== "KeyF" || !e.ctrlKey || !e.altKey || e.shiftKey || e.metaKey) return;
  if (e.getModifierState?.("AltGraph")) return;
  e.preventDefault();
  toggleFocus();
}

export function initFocus() {
  document.body.classList.toggle("focus-view", readPref());
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey);
}
