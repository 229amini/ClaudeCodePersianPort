/* ============================================================================
   Message marks, after claude.ai/code.

   ONE FILE, BOTH EDITIONS: static/js/marks.js and static-terminal/js/marks.js
   are byte-identical (test_marks.py says so). A LEAF: it imports nothing; the
   renderer hands in what it knows and gets elements back.

     decorate()    under a message, on hover: ⧉ copy, the pin, a fork from
                   here when the edition offers one, and when it
                   was said («۹ دقیقهٔ پیش», the exact moment on hover)
     paintRail()   the pinned messages as dashes at the top of the transcript;
                   hovering lists «شروع گفتگو» and each pin, a click goes there
     changeCard()  at the end of a turn, «N فایل ویرایش شد  +A −D» with one row
                   per file that opens its own edit
     markTurnEnd() the strip ALWAYS drawn under the last message of a turn
                   (pcg-lw0; the site's action row, not hover-only)
     thumbs()      a user turn's images, a row above its bubble
     foldLong()    a user message over ~15 lines clipped, «بیشتر»
     openDiff()    a change-card row's edits in a panel BESIDE the transcript
                  the transcript reflows narrower, ✕ / Esc close
     openAudit()   the same panel: what was approved without asking, a list
                   to read, not to pick from

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
export function decorate(msg, { uuid, ts, text, pinned = false, onPin, onFork, forkTitle }) {
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
    pin.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" '
      + 'stroke-width="1.8" stroke-linejoin="round" aria-hidden="true">'
      + '<path d="M9 4h6l-1 6 3 3H7l3-3z"/><path d="M12 13v7"/></svg>';
    pin.addEventListener("click", () => onPin(!msg.classList.contains("is-pinned")));
    acts.append(pin);
  }
  // A new conversation from this point. Only where the edition
  // hands in a handler, and only for a message with its own uuid — that is
  // what the CLI cuts the copy at.
  if (uuid && onFork) {
    const fork = el("button", "msg-act msg-fork");
    fork.type = "button";
    fork.title = forkTitle || FA.markFork;
    fork.setAttribute("aria-label", fork.title);
    fork.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" '
      + 'stroke-width="1.8" stroke-linecap="round" aria-hidden="true">'
      + '<circle cx="7" cy="5" r="2"/><circle cx="7" cy="19" r="2"/><circle cx="17" cy="7" r="2"/>'
      + '<path d="M7 7v10M17 9c0 4-10 3-10 8"/></svg>';
    fork.addEventListener("click", () => onFork());
    acts.append(fork);
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

/* --- 4. the always-on row under a turn's last message --------------

   The site draws copy · pin · time under the LAST message of every finished
   turn, muted and in flow, where everything else gets it on hover only. Called
   at the one boundary both sources share (render.js flushEdits): the next user
   turn, the settle, the end of a replay. The turn's last message is the last
   decorated answer AFTER the last user message — a turn that only ran tools
   has none, and must not mark the previous turn's answer a second time. */
export function markTurnEnd(log) {
  if (!log) return;
  const said = [...log.querySelectorAll(":scope > .msg.user")].pop();
  const last = [...log.querySelectorAll(":scope > .msg.assistant")]
    .filter((m) => m.querySelector(":scope > .msg-acts")).pop();
  if (!last || (said && !(said.compareDocumentPosition(last) & Node.DOCUMENT_POSITION_FOLLOWING))) return;
  last.classList.add("turn-last");
}

/* --- 5. a user turn's images ---------------------------------------

   `srcs` are data: URLs (a replayed transcript carries the image itself) or the
   wrapper's /api/image route (a live send names a file the server read). The
   site's row: 160 px tall, the width from the image, above the bubble. */
export function thumbs(srcs) {
  const row = el("div", "msg-images");
  for (const src of srcs) {
    const img = el("img", "msg-image");
    img.alt = FA.markImage;
    img.loading = "lazy";
    img.decoding = "async";
    img.src = src;
    row.append(img);
  }
  return row;
}

/* --- 6. a long message of yours (pcg-lw0, after §D11.1) ----------------------

   Over 15 lines or 1200 characters, COUNTED on the text rather than measured —
   a background pane has no layout, and a reload must fold exactly what the
   live window folded. The whole text stays in the DOM (copy, /export, find);
   the toggle's words are `data-label`, so textContent never reads them. */
export const FOLD_LINES = 15;
export const FOLD_CHARS = 1200;

export function foldLong(msg, text) {
  const t = String(text ?? "");
  if (t.length <= FOLD_CHARS && t.split("\n").length <= FOLD_LINES) return;
  const body = el("div", "fold-body");
  body.append(...msg.childNodes);
  const toggle = el("button", "fold-toggle");
  toggle.type = "button";
  const paint = (open) => {
    msg.classList.toggle("unfolded", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.dataset.label = open ? FA.foldLess : FA.foldMore;
    toggle.setAttribute("aria-label", toggle.dataset.label);
  };
  toggle.addEventListener("click", () => paint(!msg.classList.contains("unfolded")));
  msg.classList.add("fold");
  msg.append(body, toggle);
  paint(false);
}

/* --- 7. a file's edits, beside the transcript ----------------------

   The site opens a change-card row as a panel at the side of the transcript,
   which reflows narrower. Here it is the turn's OWN edits of that file — the
   same tool calls the card summed, so it agrees with the card's «+A −D», needs
   no git, and a replay draws it the same. `nodes()` builds them (render.js
   renderDiff, the tool card's own diff), one block per edit.

   The panel is a sibling AFTER the transcript, absolutely placed over the
   transcript's inline-end half while the transcript gives that half up as a
   margin — no new wrapper around .log, whose flex box is load-bearing (the
   prompt vanished the last time a pane's display changed). Its block edges are
   copied from the transcript's own box and kept there by a ResizeObserver. */
const panels = new WeakMap();     // log -> {panel, head, close, body, sync, ro}

/* The one side panel per transcript. Its head is filled by whoever opens it
   (a file's name and stat, or the audit list's title and count); the ✕ stays. */
function sidePanel(log) {
  let p = panels.get(log);
  if (p) return p;
  const panel = el("section", "diff-side");
  panel.setAttribute("role", "region");
  panel.tabIndex = -1;
  const head = el("div", "diff-side-head");
  const close = el("button", "diff-side-close", "✕");
  close.type = "button";
  close.title = FA.diffClose;
  close.setAttribute("aria-label", FA.diffClose);
  close.addEventListener("click", () => closeDiff(log));
  const body = el("div", "diff-side-body");
  panel.append(head, body);
  panel.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    closeDiff(log);
  });
  const sync = () => {
    panel.style.top = log.offsetTop + "px";
    panel.style.height = log.offsetHeight + "px";
  };
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(sync) : null;
  p = { panel, head, close, body, sync, ro };
  panels.set(log, p);
  return p;
}

function showSide(log, p, focus = true) {
  if (p.panel.previousElementSibling !== log) log.after(p.panel);
  const atEnd = isAtEnd(log);
  log.parentElement.classList.add("diff-open");
  // Half the width is twice the height: a transcript that was following its
  // bottom keeps following it (render.js atBottom's 80 px window).
  if (atEnd) log.scrollTop = log.scrollHeight;
  p.sync();
  p.ro?.observe(log);
  if (focus) p.panel.focus({ preventScroll: true });
  return p.panel;
}

export function openDiff(log, { path, added = 0, removed = 0, nodes }) {
  if (!log?.parentElement) return null;
  const p = sidePanel(log);
  const name = el("bdi", "diff-side-file path", String(path).split(/[\\/]/).pop() || String(path));
  name.dir = "ltr";
  name.title = path;
  const stat = el("span", "change-stat");
  stat.dir = "ltr";
  stat.append(el("span", "d-add", "+" + added), el("span", "d-del", "−" + removed));
  p.head.replaceChildren(name, stat, p.close);
  p.panel.dataset.kind = "diff";
  p.panel.setAttribute("aria-label", path);
  p.body.replaceChildren(...nodes().map((n) => {
    const block = el("div", "diff-side-edit");
    block.append(n);
    return block;
  }));
  return showSide(log, p);
}

/* --- 8. what was approved without asking, beside the transcript -------------

   A record, not a menu: nothing in it is picked, so no row is a button, none
   is highlighted and no key walks it (the user, 2026-10-09: «صرفا لیست نشون
   بده»). Newest first. Each row: the tool, what it touched (a path or a
   command, `.path` LTR), the time it ran, and «دوباره نپرس» when an earlier
   answer approved it rather than the posture.

   items: [{tool, why, target, at}]. `focus: false` repaints an open list in
   place when a new entry arrives, without taking the keyboard. */
export function openAudit(log, items, { focus = true } = {}) {
  if (!log?.parentElement) return null;
  const p = sidePanel(log);
  const title = el("span", "audit-title", FA.autoActionsTitle);
  const count = el("span", "audit-count", faNum(items.length));
  p.head.replaceChildren(title, count, p.close);
  p.panel.dataset.kind = "audit";
  p.panel.setAttribute("aria-label", FA.autoActionsTitle);
  if (!items.length) {
    p.body.replaceChildren(el("p", "audit-empty", FA.autoActionsEmpty));
  } else {
    const list = el("ol", "audit-list");
    for (const a of [...items].reverse()) {
      const row = el("li", "audit-row");
      const top = el("div", "audit-top");
      const tool = el("bdi", "audit-tool", a.tool || "?");
      tool.dir = "ltr";
      top.append(tool);
      if (a.why === "remembered") top.append(el("span", "audit-why", FA.autoWhyRemembered));
      const at = toMs(a.at);
      if (isFinite(at)) {
        const time = el("time", "audit-time",
                        new Intl.DateTimeFormat("fa-IR", { timeStyle: "short" }).format(new Date(at)));
        time.dateTime = new Date(at).toISOString();
        time.title = fmtExact(at);
        top.append(time);
      }
      row.append(top);
      if (a.target) {
        const target = el("bdi", "audit-target path", a.target);
        target.dir = "ltr";
        target.title = a.target;
        row.append(target);
      }
      list.append(row);
    }
    p.body.replaceChildren(list);
  }
  return showSide(log, p, focus);
}

export function auditOpen(log) {
  const p = log && panels.get(log);
  return !!p?.panel.isConnected && p.panel.dataset.kind === "audit";
}

export function closeDiff(log) {
  const p = log && panels.get(log);
  if (!p?.panel.isConnected) return;
  p.ro?.disconnect();
  p.panel.remove();
  const atEnd = isAtEnd(log);
  log.parentElement?.classList.remove("diff-open");
  if (atEnd) log.scrollTop = log.scrollHeight;
}

function isAtEnd(log) {
  return log.scrollHeight - log.scrollTop - log.clientHeight < 80;
}
