/* ============================================================================
   The numbered inline list — the one shape every v2.4 dialog is made of.

   V2-PLAN §3.3: *"Dialogs, all inline in the column, all numbered."* The TUI
   draws its confirmations where the prompt is, as a list you answer with a
   digit; this is that list. The three surfaces that need one — the permission
   and plan dialog (chrome.js), the `/model` `/effort` `/output-style`
   `/permissions` pickers and the audit list (controls.js) — build it here
   rather than three times, so «۱.» means the same thing everywhere and one
   keyboard serves all of them.

   V2-PLAN §8.2 is the rule this module exists to keep: THE DIGIT IS CHROME,
   NOT TEXT. In an RTL row a digit glued to the front of a Persian run is
   reordered by the bidi algorithm and lands where nobody put it, and the number
   is a property of the row's POSITION — option 2 exists only when a remember
   scope applies. So the renderer places it, LTR-isolated, and `strings.fa.js`
   never carries one.

   A LEAF: it imports nothing. chrome.js and controls.js sit on opposite sides
   of the module cycle (frontend-modules.md), so a shared component that
   imported either one would close a new one. Same argument that produced
   `api.js`.
   ========================================================================= */
"use strict";

/* Both digit families pick a row. The window is Persian and draws «۱.», but
   the key the colleague presses is whatever their layout sends — a Persian
   keyboard sends `۱`, every other layout sends `1`, and both mean the first
   option. */
const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/* 0-based row the key names, or -1. `9` is the ceiling because that is where
   one keystroke stops being one keystroke. */
export function digitIndex(e) {
  if (e.ctrlKey || e.altKey || e.metaKey) return -1;
  const key = String(e.key ?? "");
  if (key.length !== 1) return -1;
  const latin = "123456789".indexOf(key);
  if (latin >= 0) return latin;
  const fa = FA_DIGITS.indexOf(key);
  return fa >= 1 ? fa - 1 : -1;
}

function span(cls, text, dir) {
  const el = document.createElement("span");
  if (cls) el.className = cls;
  if (dir) el.setAttribute("dir", dir);
  if (text !== undefined) el.textContent = text;
  return el;
}

/* An inline numbered list that owns its own keyboard.

   `options`  [{ key, title, note, esc, selected }] — `esc` marks the row the
              TUI appends a bold `(esc)` to, which is always the way out.
   `onPick`   (key, index) — a digit, Enter on the highlighted row, or a click.
   `onCancel` Escape, and the `esc` row is routed through it too so there is
              one refusal path rather than two.
   `onKey`    everything this list does not claim, so the owner can bind Tab
              («next field») and shift+Tab without a second listener fighting
              this one for the same element.

   Returns the element plus `focus()`; the caller decides where it goes and
   when. Nothing here touches the document. */
export function optionList(options, { onPick, onCancel, onKey } = {}) {
  const list = document.createElement("ul");
  list.className = "opts";
  list.setAttribute("role", "listbox");
  // Focusable as ONE thing, the way the TUI's list is: the arrows move a
  // highlight inside it rather than moving focus between N tab stops, which is
  // what makes «۲» and «↓ Enter» the same act.
  list.tabIndex = 0;

  let index = options.findIndex((o) => o.selected);
  if (index < 0) index = 0;

  options.forEach((option, at) => {
    const row = document.createElement("li");
    row.className = "opt";
    row.setAttribute("role", "option");
    row.id = "opt-" + at + "-" + Math.random().toString(36).slice(2, 8);
    row.append(span("opt-num", (at + 1).toLocaleString("fa-IR") + ".", "ltr"));
    const text = span("opt-text");
    const title = span("opt-title", option.title ?? "", "auto");
    if (option.esc) {
      // The TUI appends a bold `(esc)` as its own node rather than writing it
      // into the label (wiki/tui-strings.md §2). So does this: it is a key
      // name, and a key name inside an RTL sentence has to be isolated.
      title.append(" ", span("opt-esc", "(Esc)", "ltr"));
    }
    text.append(title);
    if (option.note) text.append(span("opt-note", option.note, "auto"));
    row.append(text);
    row.addEventListener("mousedown", (e) => {
      e.preventDefault();          // the list keeps focus, so Enter still works
      paint(at);
      pick(at);
    });
    list.append(row);
  });

  function paint(at) {
    index = Math.max(0, Math.min(options.length - 1, at));
    [...list.children].forEach((row, i) => {
      row.setAttribute("aria-selected", String(i === index));
    });
    list.setAttribute("aria-activedescendant", list.children[index]?.id ?? "");
    list.children[index]?.scrollIntoView({ block: "nearest" });
  }

  function pick(at) {
    const option = options[at];
    if (!option) return;
    if (option.esc) onCancel?.();
    else onPick?.(option.key, at);
  }

  list.addEventListener("keydown", (e) => {
    if (e.defaultPrevented) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      paint((index + step + options.length) % options.length);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      pick(index);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel?.();
      return;
    }
    const digit = digitIndex(e);
    if (digit >= 0 && digit < options.length) {
      e.preventDefault();
      paint(digit);
      pick(digit);
      return;
    }
    onKey?.(e);
  });

  paint(index);
  return { el: list, focus: () => list.focus(), paint };
}

/* The one-line footer under a list. Kept here so every dialog's hint sits in
   the same place and reads the same way. */
export function dialogHint(text) {
  const el = span("dlg-hint meta", text, "auto");
  return el;
}
