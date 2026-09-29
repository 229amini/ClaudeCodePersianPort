/* ============================================================================
   Message marks, after claude.ai/code (pcg-8ip).

   ONE FILE, BOTH EDITIONS: static/js/marks.js and static-terminal/js/marks.js
   are byte-identical (test_marks.py says so). A LEAF: it imports nothing; the
   renderer hands in what it knows and gets elements back.

     decorate()    under a message, on hover: ⧉ copy, the pin, and when it was
                   said («۹ دقیقهٔ پیش», the exact moment on hover)
     paintRail()   the pinned messages as dashes at the top of the transcript;
                   hovering lists «شروع گفتگو» and each pin, a click goes there
     changeCard()  at the end of a turn, «N فایل ویرایش شد  +A −D» with one row
                   per file that opens its own edit

   Every word the strip and the rail draw is CSS `content: attr(data-…)`, not
   a text node (the fold toggle's rule, render.js): a message's textContent is
   what /export, the loop fold and the spec cases read, and a «⧉» or a
   «۹ دقیقهٔ پیش» inside it would be read as something the model said.

   Nothing here invents a fact a reload could not reproduce (wiki/frontend-
   modules.md §"A reload RE-RENDERS every finished turn"): the time is the
   message's own timestamp, the pin is keyed by the message's own uuid, and
   the card is summed from the tool calls both the stream and the transcript
   carry.
   ========================================================================= */
"use strict";

const FA = window.STRINGS;

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function faNum(n) {
  return Number(n).toLocaleString("fa-IR");
}

function toMs(ts) {
  if (ts === null || ts === undefined || ts === "") return NaN;
  if (typeof ts === "number") return ts < 1e12 ? ts * 1000 : ts;
  return Date.parse(ts);
}

/* «همین حالا» / «۹ دقیقهٔ پیش» / «۳ ساعت پیش» / «دیروز» / a date. */
export function fmtAgo(ts, now = Date.now()) {
  const at = toMs(ts);
  if (!isFinite(at)) return "";
  const mins = Math.floor((now - at) / 60000);
  if (mins < 1) return FA.markJustNow;
  if (mins < 60) return FA.markMinutesAgo.replace("{n}", faNum(mins));
  const hours = Math.floor(mins / 60);
  if (hours < 24) return FA.markHoursAgo.replace("{n}", faNum(hours));
  if (hours < 48) return FA.markYesterday;
  return new Intl.DateTimeFormat("fa-IR", { day: "numeric", month: "long" }).format(new Date(at));
}

export function fmtExact(ts) {
  const at = toMs(ts);
  if (!isFinite(at)) return "";
  return new Intl.DateTimeFormat("fa-IR", { dateStyle: "full", timeStyle: "short" })
    .format(new Date(at));
}

/* The one-line label a pin is listed under: the start of what was said. */
export function pinLabel(text) {
  const line = String(text ?? "").replace(/\s+/g, " ").trim();
  return line.length > 60 ? line.slice(0, 60) + "…" : line;
}

/* --- 1. under a message ----------------------------------------------------- */

/* `msg` is the message element; `meta` = {uuid, ts, text, pinned}. `onPin`
   (on: boolean) → Promise; the strip repaints from `setPinned()`. The strip is
   absolutely placed, so it costs the transcript no height (test_split measures
   what the log gets), and it is invisible until the message is hovered or
   focused. */
export function decorate(msg, { uuid, ts, text, pinned = false, onPin }) {
  if (!msg || msg.querySelector(":scope > .msg-acts")) return;
  if (uuid) msg.dataset.uuid = uuid;
  if (ts) msg.dataset.ts = String(ts);
  msg.classList.toggle("is-pinned", !!pinned);
  const acts = el("div", "msg-acts");
  const copy = el("button", "msg-act msg-copy");
  copy.dataset.glyph = "⧉";
  copy.type = "button";
  copy.title = FA.markCopy;
  copy.setAttribute("aria-label", FA.markCopy);
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text ?? "");
      copy.title = FA.markCopied;
      setTimeout(() => { copy.title = FA.markCopy; }, 1500);
    } catch (err) {
      // No clipboard (blocked, or no focus): the text is still on screen.
    }
  });
  acts.append(copy);
  if (uuid && onPin) {
    const pin = el("button", "msg-act msg-pin");
    pin.type = "button";
    pin.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" '
      + 'stroke-width="1.8" stroke-linejoin="round" aria-hidden="true">'
      + '<path d="M9 4h6l-1 6 3 3H7l3-3z"/><path d="M12 13v7"/></svg>';
    pin.addEventListener("click", () => onPin(!msg.classList.contains("is-pinned")));
    acts.append(pin);
  }
  const when = el("span", "msg-when");
  acts.append(when);
  // The relative time is read when it is shown, so «۹ دقیقهٔ پیش» is never a
  // figure frozen at render time (and a replayed message is never «همین حالا»).
  const refresh = () => {
    when.dataset.text = fmtAgo(ts);
    when.title = fmtExact(ts);
  };
  msg.addEventListener("mouseenter", refresh);
  msg.addEventListener("focusin", refresh);
  refresh();
  msg.append(acts);
  setPinned(msg, pinned);
}

export function setPinned(msg, pinned) {
  msg.classList.toggle("is-pinned", !!pinned);
  const pin = msg.querySelector(":scope > .msg-acts .msg-pin");
  if (!pin) return;
  const text = pinned ? FA.markUnpin : FA.markPin;
  pin.title = text;
  pin.setAttribute("aria-label", text);
  pin.setAttribute("aria-pressed", String(!!pinned));
}

/* --- 2. the pin rail --------------------------------------------------------- */

/* A zero-height, sticky first child of the transcript, so it rides at the top
   of the view without taking a row from it. Absent while nothing is pinned. */
export function paintRail(log, pins, { onJump } = {}) {
  if (!log) return;
  let rail = log.querySelector(":scope > .pin-rail");
  if (!pins?.length) {
    rail?.remove();
    return;
  }
  if (!rail) {
    rail = el("div", "pin-rail");
    log.prepend(rail);
  } else if (log.firstElementChild !== rail) {
    log.prepend(rail);
  }
  rail.replaceChildren();
  const hit = el("div", "pin-hit");
  hit.tabIndex = 0;
  hit.setAttribute("role", "navigation");
  hit.setAttribute("aria-label", FA.markPinsTitle);
  const dashes = el("div", "pin-dashes");
  const list = el("div", "pin-list");
  const row = (text, target, cls) => {
    dashes.append(el("span", "pin-dash" + (cls ? " " + cls : "")));
    const b = el("button", "pin-item");
    b.type = "button";
    b.dir = "auto";
    b.dataset.label = text;
    b.setAttribute("aria-label", text);
    b.addEventListener("click", () => onJump?.(target));
    list.append(b);
  };
  row(FA.markSessionStart, null, "is-start");
  for (const p of pins) row(p.label || FA.markPinned, p.uuid);
  hit.append(dashes, list);
  rail.append(hit);
}

/* Scroll the transcript to a message (or to its top, for «شروع گفتگو») and
   flash it, so the eye lands where the jump went. */
export function jumpTo(log, uuid) {
  if (!log) return false;
  if (!uuid) {
    log.scrollTop = 0;
    return true;
  }
  const msg = log.querySelector(`[data-uuid="${CSS.escape(uuid)}"]`);
  if (!msg) return false;
  for (let p = msg.parentElement; p && p !== log; p = p.parentElement) {
    if (p.tagName === "DETAILS") p.open = true;
  }
  msg.scrollIntoView({ block: "start" });
  msg.classList.remove("is-flash");
  void msg.offsetWidth;          // restart the animation on a second jump
  msg.classList.add("is-flash");
  return true;
}

/* --- 3. the per-turn change card --------------------------------------------- */

/* files: [{path, added, removed, open}] in the order they were first edited.
   `open()` is the row's own click: it opens that file's last edit. */
export function changeCard(files) {
  const added = files.reduce((n, f) => n + (f.added || 0), 0);
  const removed = files.reduce((n, f) => n + (f.removed || 0), 0);
  const card = el("div", "change-card");
  const head = el("div", "change-head");
  head.append(el("span", "change-title",
                 FA.markEdited.replace("{n}", faNum(files.length))));
  const total = el("span", "change-stat");
  total.dir = "ltr";
  total.append(el("span", "d-add", "+" + added), el("span", "d-del", "−" + removed));
  head.append(total);
  card.append(head);
  for (const f of files) {
    const b = el("button", "change-row");
    b.type = "button";
    const name = el("bdi", "change-file path", f.path.split(/[\\/]/).pop() || f.path);
    name.dir = "ltr";
    name.title = f.path;
    const stat = el("span", "change-stat");
    stat.dir = "ltr";
    stat.append(el("span", "d-add", "+" + (f.added || 0)), el("span", "d-del", "−" + (f.removed || 0)));
    b.append(name, stat, el("span", "change-go", "‹"));
    b.addEventListener("click", () => f.open?.());
    card.append(b);
  }
  return card;
}
