/* ============================================================================
   The composer bar's popovers, after claude.ai/code.

   ONE FILE, BOTH EDITIONS: static/js/bar.js and static-terminal/js/bar.js are
   byte-identical, and test_bar.py says so. A LEAF: it imports nothing. What it
   needs from its edition — the request helper, how to turn a screen rect into
   CSS px, the controls' own state — comes in as arguments, so each edition
   keeps the state it already had and this only draws.

   Four popovers, all `[popover=auto]` (so a second one, Esc or a click
   outside closes the first, for free):

     openMenu     rows (an icon, a title, a note), a ✓ on the current one, a
                  digit picks; footer rows, the effort row and a confirm step
                  (the VS Code extension's mode and model menus)
     openUsage    the context window by category, then each plan limit
     openPlus     attach a file, mention a project file, and the MCP servers
                  folded behind one row
     openPalette  every slash command, grouped, with a filter box (the
                  extension's «/» button)

   Plus the prompt-cache clock (cacheState / noteCache / paintCache): how long
   the conversation's cached prefix is still warm, worked out the way the
   extension's webview does it from each reply's `usage.cache_creation`.

   Placement: above the anchor, lined up with it, clamped into the window.
   Rects are SCREEN px and style lengths CSS px under app zoom (terminal
   edition, wiki/grid.md §"CSS zoom is shipped now"), so every rect goes
   through the host's `toCss` on the way in and every size is offset*.
   ========================================================================= */
"use strict";

const FA = window.STRINGS;
const GAP = 6;      // between the anchor and the popover
const EDGE = 8;     // kept free at the window's edge

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function faNum(n, digits = 0) {
  return Number(n).toLocaleString("fa-IR", { maximumFractionDigits: digits });
}

/* «۵۱۶٫۴ هزار» / «۱ میلیون»: the TUI's «516.4k / 1M», in Persian words. */
export function fmtTokens(n) {
  if (typeof n !== "number" || !isFinite(n)) return "—";
  if (n >= 1e6) return FA.barMillion.replace("{n}", faNum(n / 1e6, 1));
  if (n >= 1e3) return FA.barThousand.replace("{n}", faNum(n / 1e3, 1));
  return faNum(n);
}

/* Stroke icons for menu rows, 16px on a 24 grid, one weight (DESIGN.md:
   icons are drawn, never glyphs). Keyed by what they stand for. */
const ICONS = {
  plan: '<path d="M8 4h9a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8"/><path d="M8 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2"/><path d="M10 9h6M10 13h6M10 17h3"/>',
  ask: '<path d="M7 11V6.5a1.5 1.5 0 0 1 3 0V11"/><path d="M10 10V5a1.5 1.5 0 0 1 3 0v5"/><path d="M13 10V6a1.5 1.5 0 0 1 3 0v6"/><path d="M16 9.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L4.5 13.6a1.5 1.5 0 0 1 2.4-1.8L7 12"/>',
  acceptEdits: '<path d="m9 8-4 4 4 4M15 8l4 4-4 4"/>',
  autoApprove: '<path d="M13 3 5 14h6l-1 7 8-11h-6z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 18v-6M9 15l3-3 3 3"/>',
  mention: '<circle cx="12" cy="12" r="3.5"/><path d="M15.5 12v1.5a2.5 2.5 0 0 0 5 0V12a8.5 8.5 0 1 0-3.4 6.8"/>',
  plug: '<path d="M9 3v4M15 3v4M7 7h10v4a5 5 0 0 1-10 0zM12 16v5"/>',
  effort: '<path d="M4 15a8 8 0 0 1 16 0"/><path d="m12 15 3.5-4.5"/><circle cx="12" cy="15" r="1"/>',
  style: '<path d="M20 14a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 12h5"/>',
};

function icon(name) {
  const span = el("span", "bar-row-icon");
  if (ICONS[name]) {
    span.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" '
      + 'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + ICONS[name] + "</svg>";
  }
  return span;
}

let open = null;   // the one popover this module has on screen

/* A chip is a TOGGLE: the press that finds its popover open closes it. Light
   dismiss already does the closing — a press on the chip is a press outside
   the popover — and then the chip's own click handler opened a fresh one, so
   the button could never shut what it opened. The press itself is the only
   moment that still knows the popover was open; a click with no press before
   it (a key, a script) finds it open and closes it here. */
const watched = new WeakSet();
let pressedOpen = null;   // the anchor whose popover was open when a press began

function showing(anchor) {
  return !!open?.isConnected && open.anchor === anchor && open.matches(":popover-open");
}

function toggledShut(anchor) {
  if (!watched.has(anchor)) {
    watched.add(anchor);
    anchor.addEventListener("pointerdown", () => {
      pressedOpen = showing(anchor) ? anchor : null;
      // A press dragged off the chip never clicks; forget it once the click
      // that would have read it has had its turn.
      document.addEventListener("pointerup", () => setTimeout(() => { pressedOpen = null; }),
                                { once: true });
    });
  }
  const was = pressedOpen === anchor;
  pressedOpen = null;
  if (showing(anchor)) { close(); return true; }
  return was;
}

function place(pop, anchor, toCss) {
  const r = anchor.getBoundingClientRect();
  const a = { top: toCss(r.top), bottom: toCss(r.bottom),
              left: toCss(r.left), right: toCss(r.right) };
  const vw = toCss(innerWidth), vh = toCss(innerHeight);
  const w = pop.offsetWidth, h = pop.offsetHeight;
  // Lined up with the anchor's OUTER edge, so the popover opens over the bar
  // it belongs to: a chip in the end half of its row (the model, at the left
  // of this RTL bar) shares its left edge, one in the start half its right.
  // Always the right edge hung a left-hand chip's menu off the far side of it,
  // against the window's edge or over the next pane.
  const host = anchor.parentElement?.getBoundingClientRect() ?? r;
  const atEnd = r.left + r.right < host.left + host.right;
  const left = Math.max(EDGE, Math.min(atEnd ? a.left : a.right - w, vw - w - EDGE));
  const above = a.top - GAP - h;
  const top = above >= EDGE ? above : Math.min(a.bottom + GAP, vh - h - EDGE);
  pop.style.left = left + "px";
  pop.style.top = Math.max(EDGE, top) + "px";
}

/* A fresh popover per open, removed on close: nothing about a menu survives
   into the next one (the project's oldest defect family). */
function popover(anchor, cls, label, build, toCss = (v) => v) {
  close();
  const pop = el("div", "bar-pop " + cls);
  pop.popover = "auto";
  pop.anchor = anchor;
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", label);
  document.body.append(pop);
  build(pop);
  pop.addEventListener("toggle", (e) => {
    anchor.setAttribute("aria-expanded", String(e.newState === "open"));
    if (e.newState === "closed") {
      pop.remove();
      if (open === pop) open = null;
    }
  });
  pop.showPopover();
  place(pop, anchor, toCss);
  open = pop;
  const relayout = () => { if (pop.isConnected) place(pop, anchor, toCss); };
  return { pop, relayout };
}

export function close() {
  if (open?.isConnected && open.matches(":popover-open")) open.hidePopover();
  open = null;
}

export function isOpen() {
  return !!open?.isConnected;
}

/* --- 1. a menu ------------------------------------------------------------ */

/* One row, the VS Code extension's: an icon, the name over a note (two lines
   at most), and the ✓ on the current one at the row's end. `value` is a quiet
   word before the end (the mode menu's «لحن پاسخ  کار روزمره»), `chevron`
   says the row opens another list. `tip` is a hover title. No digit is drawn:
   the extension shows none and a column of numerals beside Persian names was
   the clutter; the digit KEYS still pick while the menu is open. */
function menuRow(row) {
  const b = el("button", "bar-row");
  b.type = "button";
  b.disabled = !!row.disabled;
  if (row.key !== undefined) b.dataset.key = row.key;
  if (row.selected) b.setAttribute("aria-current", "true");
  if (row.tip) b.title = row.tip;
  if (row.icon) b.append(icon(row.icon));
  const text = el("span", "bar-row-text");
  const name = el("span", "bar-row-title", row.title);
  name.dir = "auto";
  text.append(name);
  if (row.note) {
    const note = el("span", "bar-row-note", row.note);
    note.dir = "auto";
    text.append(note);
  }
  b.append(text);
  if (row.value) {
    const value = el("span", "bar-row-value", row.value);
    value.dir = "auto";
    b.append(value);
  }
  b.append(el("span", "bar-row-check", row.selected ? "✓" : ""));
  if (row.chevron) b.append(el("span", "bar-row-chevron", "‹"));
  return b;
}

/* rows: [{key, title, note?, icon?, tip?, selected?, disabled?}]. A digit key
   picks the row at that place while the menu is open.

   `hint`: a quiet word at the head's far end (the mode menu's Shift+Tab).
   `footer`: [{title, icon?, value?, note?, chevron?, disabled?, onClick}] — rows
   under a rule that are not choices of THIS list (the mode menu's response
   style, and its count of what «خودکار» approved).
   `effort`: {title, levels, current, label, onPick} — the effort row at the
   foot, «تلاش (زیاد)» and a small track, so the level is set where the model
   and the mode are. Picking a level does not close the menu; a row does.
   `note`: a muted line at the very foot.
   `confirm(row)`: null to pick at once, or {text, ok, cancel} to ask first,
   inside the same popover (the model menu mid-conversation: a new model
   re-reads the whole conversation without the cache). */
export function openMenu(anchor, { title, hint, rows, onPick, toCss, footer, effort, note, confirm }) {
  if (toggledShut(anchor)) return null;
  const pick = (row) => {
    close();
    anchor.focus();
    onPick?.(row);
  };
  let relayout = () => {};
  let asking = false;
  const ask = (row) => {
    const q = confirm?.(row);
    if (!q) { pick(row); return; }
    const pop = open;
    asking = true;
    pop.replaceChildren();
    pop.classList.add("bar-confirm");
    const text = el("p", "bar-confirm-text", q.text);
    text.dir = "auto";
    const acts = el("div", "bar-confirm-acts");
    const ok = el("button", "bar-btn is-primary", q.ok);
    ok.type = "button";
    ok.addEventListener("click", () => pick(row));
    const no = el("button", "bar-btn", q.cancel);
    no.type = "button";
    no.addEventListener("click", () => { close(); anchor.focus(); });
    acts.append(ok, no);
    pop.append(text, acts);
    relayout();
    ok.focus();
  };
  const made = popover(anchor, "bar-menu", title, (box) => {
    if (title) {
      const head = el("div", "bar-head");
      head.append(el("span", "", title));
      if (hint) {
        const key = el("span", "bar-head-hint", hint);
        key.dir = "auto";
        head.append(key);
      }
      box.append(head);
    }
    for (const row of rows) {
      const b = menuRow(row);
      b.addEventListener("click", () => ask(row));
      box.append(b);
    }
    const foot = (footer ?? []).filter(Boolean);
    if (foot.length) {
      box.append(el("hr", "bar-rule"));
      for (const f of foot) {
        const b = menuRow(f);
        b.classList.add("bar-foot");
        b.addEventListener("click", () => {
          close();
          f.onClick?.();
        });
        box.append(b);
      }
    }
    if (effort?.levels?.length) {
      if (!foot.length) box.append(el("hr", "bar-rule"));
      box.append(effortControl(effort));
    }
    if (note) {
      const p = el("p", "bar-note", note);
      p.dir = "auto";
      box.append(p);
    }
  }, toCss);
  relayout = made.relayout;
  const { pop } = made;
  pop.addEventListener("keydown", (e) => {
    if (asking) return;
    if (e.target.matches?.(".bar-slider-range")) return;   // its own arrows and digits
    const rowsEl = [...pop.querySelectorAll(":scope > .bar-row:not(:disabled)")];
    const digit = /^Digit([1-9])$/.exec(e.code) || /^Numpad([1-9])$/.exec(e.code);
    if (digit && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const row = rows[Number(digit[1]) - 1];
      if (row && !row.disabled) { e.preventDefault(); ask(row); }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const at = rowsEl.indexOf(document.activeElement);
      const next = e.key === "ArrowDown" ? at + 1 : at - 1;
      rowsEl[(next + rowsEl.length) % rowsEl.length]?.focus();
    }
  });
  (pop.querySelector('.bar-row[aria-current="true"]:not(:disabled)')
    ?? pop.querySelector(".bar-row:not(:disabled)"))?.focus();
  return pop;
}

/* --- 2. the effort control ------------------------------------------------- */

/* One row, the extension's «Effort (High)» with a small track at its end: one
   stop per level the current model advertises, in its own order (lowest
   first). A native range input: the arrows, Home/End and the screen reader's
   value all come with it. `change`, not `input`: dragging across three stops
   is one decision, not three writes. */
function effortControl({ title, levels, current, label, onPick }) {
  const wrap = el("div", "bar-effort");
  wrap.append(icon("effort"));
  const name = el("span", "bar-effort-name");
  const now = el("span", "bar-slider-now", "(" + label(current) + ")");
  name.append(title + " ", now);
  const range = el("input", "bar-slider-range");
  range.type = "range";
  range.min = "0";
  range.max = String(levels.length - 1);
  range.step = "1";
  range.value = String(Math.max(0, levels.indexOf(current)));
  range.setAttribute("aria-label", title);
  range.setAttribute("aria-valuetext", label(current));
  const ticks = el("div", "bar-slider-ticks");
  for (let i = 0; i < levels.length; i++) ticks.append(el("span", "bar-tick"));
  range.addEventListener("input", () => {
    const level = levels[Number(range.value)];
    now.textContent = "(" + label(level) + ")";
    range.setAttribute("aria-valuetext", label(level));
  });
  range.addEventListener("change", () => onPick?.(levels[Number(range.value)]));
  const track = el("div", "bar-slider-track");
  track.append(ticks, range);
  wrap.append(name, track);
  return wrap;
}

/* --- 3. the context + usage panel ------------------------------------------ */

/* The CLI's own colour names (get_context_usage `categories[].color`) mapped
   onto this palette. An unknown name falls back to the muted tone rather than
   inventing a colour for it. */
const CATEGORY_COLOR = {
  claude: "var(--accent)",
  warning: "var(--warn)",
  purple_FOR_SUBAGENTS_ONLY: "#9b87f5",
  purple: "#9b87f5",
  promptBorder: "var(--fg-muted)",
  inactive: "color-mix(in srgb, var(--fg-muted) 55%, transparent)",
  success: "#4caf7a",
  error: "var(--danger)",
};

function catName(name) {
  return FA.contextCategories?.[name] ?? name;
}

/* «۴ ساعت و ۳۳ دقیقهٔ دیگر» inside a day, «یکشنبه ۱۱:۳۰» past it. The CLI
   sends an ISO string here; an epoch in seconds is read too. */
export function fmtReset(value, now = Date.now()) {
  if (value === null || value === undefined || value === "") return "";
  const at = typeof value === "number" ? value * (value < 1e12 ? 1000 : 1) : Date.parse(value);
  if (!isFinite(at)) return "";
  const mins = Math.max(0, Math.round((at - now) / 60000));
  if (mins < 24 * 60) {
    const h = Math.floor(mins / 60), m = mins % 60;
    const text = h ? FA.barInHoursMinutes.replace("{h}", faNum(h)).replace("{m}", faNum(m))
                   : FA.barInMinutes.replace("{m}", faNum(m));
    return FA.barResetsIn.replace("{t}", text);
  }
  const when = new Intl.DateTimeFormat("fa-IR",
    { weekday: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(at));
  return FA.barResetsAt.replace("{t}", when);
}

function meterRow(title, pct, reset) {
  const row = el("div", "bar-limit");
  const top = el("div", "bar-limit-top");
  const name = el("span", "bar-limit-name", title);
  name.dir = "auto";
  top.append(name, el("span", "bar-limit-reset", reset),
             el("span", "bar-limit-pct", typeof pct === "number" ? faNum(pct) + "٪" : "—"));
  const bar = el("div", "bar-meter");
  const fill = el("span", "bar-meter-fill");
  fill.style.inlineSize = Math.max(0, Math.min(100, pct ?? 0)) + "%";
  if ((pct ?? 0) >= 90) fill.dataset.level = "high";
  bar.append(fill);
  row.append(top, bar);
  return row;
}

/* `limits` is get_usage's `rate_limits`: undefined (not asked yet), null (this
   login has no plan limits), or the object. Each window is drawn only when the
   CLI reported it; `model_scoped` is the «Weekly · Fable» kind. */
export function limitRows(limits, now = Date.now()) {
  const rows = [];
  const add = (title, w) => {
    if (w && typeof w.utilization === "number") {
      rows.push({ title, pct: w.utilization, reset: fmtReset(w.resets_at, now) });
    }
  };
  if (!limits) return rows;
  add(FA.barLimit5h, limits.five_hour);
  add(FA.barLimitWeek, limits.seven_day);
  add(FA.barLimitWeekModel.replace("{name}", "Opus"), limits.seven_day_opus);
  add(FA.barLimitWeekModel.replace("{name}", "Sonnet"), limits.seven_day_sonnet);
  for (const m of limits.model_scoped ?? []) {
    add(FA.barLimitWeekModel.replace("{name}", m.display_name ?? "?"), m);
  }
  return rows;
}

function paintUsage(box, { detail, context, limits, onCompact, fresh }) {
  box.replaceChildren();
  // The context window.
  const head = el("div", "bar-head");
  head.append(el("span", "", FA.barContext));
  const total = detail?.total, max = detail?.max;
  const pct = typeof context === "number" ? context
    : total && max ? Math.round(total / max * 100) : null;
  const figure = el("span", "bar-figure",
    total && max ? FA.barOf.replace("{used}", fmtTokens(total)).replace("{max}", fmtTokens(max))
                   + (pct !== null ? " (" + faNum(pct) + "٪)" : "")
      : pct !== null ? faNum(pct) + "٪" : FA.barLoading);
  head.append(figure);
  box.append(head);
  // Nothing sent yet: the CLI's figure is the floor every first message starts
  // from (system prompt, tools, memory), and no turn has been paid for.
  if (fresh) box.append(el("p", "bar-muted", FA.barBaseline));

  const bar = el("div", "bar-context");
  const cats = (detail?.categories ?? []).filter((c) => c.kind === "used" && c.tokens > 0);
  if (max) {
    for (const c of cats) {
      const seg = el("span", "bar-seg");
      seg.style.inlineSize = (c.tokens / max * 100) + "%";
      seg.style.background = CATEGORY_COLOR[c.color] ?? "var(--fg-muted)";
      seg.title = catName(c.name) + " — " + fmtTokens(c.tokens);
      bar.append(seg);
    }
  } else if (pct !== null) {
    const seg = el("span", "bar-seg");
    seg.style.inlineSize = pct + "%";
    seg.style.background = "var(--accent)";
    bar.append(seg);
  }
  box.append(bar);

  const act = el("div", "bar-context-act");
  if (detail?.threshold && total !== null && total !== undefined) {
    act.append(el("span", "bar-muted",
      FA.barUntilCompact.replace("{n}", fmtTokens(Math.max(0, detail.threshold - total)))));
  } else {
    act.append(el("span", ""));
  }
  const compact = el("button", "bar-btn", FA.barCompact);
  compact.type = "button";
  compact.addEventListener("click", () => { close(); onCompact?.(); });
  act.append(compact);
  box.append(act);

  if (cats.length) {
    const more = el("details", "bar-detail");
    more.append(el("summary", "", FA.barDetails));
    const list = el("ul", "bar-cats");
    for (const c of cats) {
      const li = el("li");
      const dot = el("span", "bar-dot");
      dot.style.background = CATEGORY_COLOR[c.color] ?? "var(--fg-muted)";
      const name = el("span", "", catName(c.name));
      name.dir = "auto";
      li.append(dot, name, el("span", "bar-muted", fmtTokens(c.tokens)));
      list.append(li);
    }
    more.append(list);
    box.append(more);
  }

  // The plan's usage limits.
  box.append(el("hr", "bar-rule"));
  box.append(el("div", "bar-head", FA.barLimits));
  if (limits === undefined) {
    box.append(el("p", "bar-muted", FA.barLoading));
  } else if (limits === null) {
    box.append(el("p", "bar-muted", FA.barNoLimits));
  } else {
    const rows = limitRows(limits);
    if (!rows.length) box.append(el("p", "bar-muted", FA.barNoLimits));
    for (const r of rows) box.append(meterRow(r.title, r.pct, r.reset));
  }
}

/* `data` is what the host already knows; `refresh()` (optional) asks the CLI
   again and resolves with the same shape — the panel paints at once and then
   repaints with fresher numbers, never waits on the slow context call. */
export function openUsage(anchor, { data, refresh, onCompact, toCss }) {
  if (toggledShut(anchor)) return null;
  const state = { ...data, onCompact };
  const { pop, relayout } = popover(anchor, "bar-usage", FA.barUsage, (box) => {
    paintUsage(box, state);
  }, toCss);
  refresh?.((fresh) => {
    if (!pop.isConnected) return;
    Object.assign(state, fresh);
    paintUsage(pop, state);
    relayout();
  });
  pop.querySelector(".bar-btn")?.focus();
  return pop;
}

/* The ring on the bar: how full the context is, at a glance (claude.ai's ◔). */
export function paintRing(button, pct) {
  const ring = button.querySelector(".bar-ring-fill");
  const value = typeof pct === "number" ? Math.max(0, Math.min(100, pct)) : 0;
  if (ring) ring.style.strokeDasharray = `${value} 100`;
  button.dataset.level = value >= 90 ? "high" : value >= 70 ? "warn" : "ok";
  const text = typeof pct === "number" ? FA.barUsageTitle.replace("{n}", faNum(value)) : FA.barUsage;
  button.title = text;
  button.setAttribute("aria-label", text);
}

/* --- 4. the «+» menu -------------------------------------------------------- */

/* Two actions on top, the way the extension's «+» reads: attach a file from
   this computer (the native dialog, Ctrl+U) and point at a file in the project
   (`@`). The MCP servers fold behind one row underneath: they are a setting,
   not something done to this message.

   servers: the CLI's own mcp_status list, fetched the first time the row is
   opened (the host's `loadServers`). A switch writes through `onToggle`, which
   is PERSISTENT for this folder — the CLI writes disabledMcpServers, as its own
   /mcp does — and the note under the list says so. */
export function openPlus(anchor, { onFiles, onMention, loadServers, onToggle, toCss }) {
  if (toggledShut(anchor)) return null;
  let relayout = () => {};
  const made = popover(anchor, "bar-menu bar-plus", FA.barPlus, (box) => {
    const row = (name, title, hint, run) => {
      const b = el("button", "bar-row");
      b.type = "button";
      b.append(icon(name));
      const text = el("span", "bar-row-text");
      text.append(el("span", "bar-row-title", title));
      const key = el("kbd", "bar-row-digit", hint);
      key.dir = "ltr";
      b.append(text, el("span", "bar-row-check", ""), key);
      b.addEventListener("click", () => { close(); run?.(); });
      box.append(b);
      return b;
    };
    row("file", FA.barFiles, "Ctrl+U", onFiles);
    if (onMention) row("mention", FA.barMention, "@", onMention);
    if (!loadServers) return;
    box.append(el("hr", "bar-rule"));
    const fold = el("button", "bar-row bar-fold");
    fold.type = "button";
    fold.setAttribute("aria-expanded", "false");
    fold.append(icon("plug"));
    const text = el("span", "bar-row-text");
    text.append(el("span", "bar-row-title", FA.barConnectors));
    fold.append(text, el("span", "bar-row-check", ""), el("span", "bar-row-digit bar-chevron", "‹"));
    const list = el("div", "bar-servers");
    list.hidden = true;
    box.append(fold, list);
    let loaded = false;
    const paint = (servers) => {
      list.replaceChildren();
      if (!servers?.length) {
        list.append(el("p", "bar-muted", FA.barNoServers));
        relayout();
        return;
      }
      for (const s of servers) {
        const label = el("label", "bar-server");
        const name = el("span", "bar-server-name", s.name);
        name.dir = "ltr";
        const status = el("span", "bar-muted", FA.barServerStatus?.[s.status] ?? s.status);
        const sw = el("input", "bar-switch");
        sw.type = "checkbox";
        sw.setAttribute("role", "switch");
        sw.checked = s.status !== "disabled";
        sw.addEventListener("change", async () => {
          sw.disabled = true;
          try {
            const next = await onToggle?.(s.name, sw.checked);
            if (Array.isArray(next)) paint(next);
          } finally {
            sw.disabled = false;
          }
        });
        label.append(name, status, sw);
        list.append(label);
      }
      list.append(el("p", "bar-note", FA.barConnectorsNote));
      relayout();
    };
    fold.addEventListener("click", () => {
      const opening = list.hidden;
      list.hidden = !opening;
      fold.setAttribute("aria-expanded", String(opening));
      if (opening && !loaded) {
        loaded = true;
        list.append(el("p", "bar-muted", FA.barLoading));
        Promise.resolve(loadServers()).then(paint, () => paint([]));
      }
      relayout();
    });
  }, toCss);
  relayout = made.relayout;
  const { pop } = made;
  pop.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    if (e.target.matches?.(".bar-switch")) return;
    e.preventDefault();
    const rows = [...pop.querySelectorAll(".bar-row")];
    const at = rows.indexOf(document.activeElement);
    rows[(at + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length]?.focus();
  });
  pop.querySelector(".bar-row")?.focus();
  return pop;
}

/* --- 5. the «/» palette ----------------------------------------------------- */

/* The same letter in its two Unicode shapes, and no case: «ي»/«ی» and «ك»/«ک»
   are what a Persian keyboard and an Arabic one disagree on. */
function fold(s) {
  return String(s ?? "").toLowerCase().replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/\u200c/g, " ");
}

/* groups: [{title, items: [{key, title, note?, hint?}]}] — the host decides the
   groups and the words; this draws them, filters as you type (title, note and
   hint all count), and hands the picked item to `onPick`. ↑/↓ move, Enter picks,
   Esc closes (the popover's own light dismiss). */
export function openPalette(anchor, { title, placeholder, groups, onPick, toCss }) {
  if (toggledShut(anchor)) return null;
  let active = 0;
  let shown = [];
  const { pop, relayout } = popover(anchor, "bar-menu bar-palette", title, (box) => {
    const search = el("input", "bar-filter");
    search.type = "search";
    search.placeholder = placeholder ?? "";
    search.setAttribute("aria-label", placeholder ?? title);
    search.dir = "auto";
    const list = el("div", "bar-palette-list");
    list.setAttribute("role", "listbox");
    box.append(search, list);
  }, toCss);
  const search = pop.querySelector(".bar-filter");
  const list = pop.querySelector(".bar-palette-list");
  const pick = (item) => {
    close();
    anchor.focus();
    onPick?.(item);
  };
  const mark = () => {
    shown.forEach((b, i) => b.setAttribute("aria-selected", String(i === active)));
    shown[active]?.scrollIntoView({ block: "nearest" });
  };
  const paint = () => {
    const q = fold(search.value.trim());
    list.replaceChildren();
    shown = [];
    for (const g of groups) {
      const items = g.items.filter((it) => !q
        || [it.title, it.note, it.hint].some((s) => fold(s).includes(q)));
      if (!items.length) continue;
      list.append(el("div", "bar-head bar-group", g.title));
      for (const it of items) {
        const b = el("button", "bar-row");
        b.type = "button";
        b.setAttribute("role", "option");
        b.tabIndex = -1;
        const text = el("span", "bar-row-text");
        const name = el("span", "bar-row-title", it.title);
        name.dir = "auto";
        text.append(name);
        if (it.note) {
          const note = el("span", "bar-row-note", it.note);
          note.dir = "auto";
          text.append(note);
        }
        const hint = el("kbd", "bar-row-digit", it.hint ?? "");
        hint.dir = "ltr";
        b.append(text, el("span", "bar-row-check", ""), hint);
        const at = shown.length;
        b.addEventListener("mousemove", () => { if (active !== at) { active = at; mark(); } });
        b.addEventListener("click", () => pick(it));
        list.append(b);
        shown.push(b);
      }
    }
    if (!shown.length) list.append(el("p", "bar-muted", FA.barPaletteEmpty));
    active = Math.min(active, Math.max(0, shown.length - 1));
    mark();
    relayout();
  };
  search.addEventListener("input", () => { active = 0; paint(); });
  search.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!shown.length) return;
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length;
      mark();
    } else if (e.key === "Enter") {
      e.preventDefault();
      shown[active]?.click();
    }
  });
  paint();
  search.focus();
  return pop;
}

/* --- 6. the prompt-cache clock ---------------------------------------------- */

/* Read off the extension's webview (2.1.292): every reply's usage says which
   cache it wrote — `cache_creation.ephemeral_1h_input_tokens` or `_5m_` — and
   the prefix stays warm for that long after the reply. A reply that only READ
   the cache keeps the lifetime the last write set. `at` is when the reply came
   (now, live; the transcript's timestamp, replayed). */
const CACHE_TTL = { "5m": 300000, "1h": 3600000 };

export function noteCache(prev, usage, at) {
  if (!usage || !isFinite(at)) return prev;
  const cached = (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) > 0;
  const made = usage.cache_creation ?? {};
  const ttl = (made.ephemeral_1h_input_tokens ?? 0) > 0 ? "1h"
    : (made.ephemeral_5m_input_tokens ?? 0) > 0 ? "5m" : prev?.ttl;
  const size = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0)
    + (usage.cache_creation_input_tokens ?? 0);
  return { at, ttl: cached ? ttl : undefined, size: size || undefined };
}

/* {kind: "unknown"} | {kind: "warm", minutes} | {kind: "cold", idle, size?, compacted?} */
export function cacheState(c, now = Date.now()) {
  if (c?.compacted) return { kind: "cold", compacted: true };
  if (!c?.at || !CACHE_TTL[c.ttl]) return { kind: "unknown" };
  const span = CACHE_TTL[c.ttl];
  const left = Math.min(span, c.at + span - now);
  if (left > 0) return { kind: "warm", minutes: Math.ceil(left / 60000) };
  return { kind: "cold", idle: now - c.at, size: c.size };
}

function fmtIdle(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 60) return FA.barIdleMinutes.replace("{m}", faNum(m));
  const h = Math.floor(m / 60);
  if (h < 24) return FA.barIdleHours.replace("{h}", faNum(h)).replace("{m}", faNum(m % 60));
  return FA.barIdleDays.replace("{d}", faNum(Math.floor(h / 24)));
}

/* The chip: «۵۸ دقیقه» while warm, the clock alone once cold, nothing until a
   reply has said anything about the cache. The sentence is the title. `c` is
   what noteCache kept; the chip keeps it too, so one clock per window can count
   every chip down without asking the conversation again. */
let cacheClock = 0;

export function paintCache(button, c) {
  if (!button) return;
  button._cache = c;
  if (!cacheClock) {
    cacheClock = setInterval(() => {
      for (const b of document.querySelectorAll(".bar-cache")) paintCache(b, b._cache);
    }, 30000);
  }
  const state = cacheState(c);
  button.hidden = state.kind === "unknown";
  button.dataset.state = state.kind;
  const label = button.querySelector(".bar-cache-label");
  if (label) label.textContent = state.kind === "warm" ? FA.barCacheMinutes.replace("{n}", faNum(state.minutes)) : "";
  const text = state.kind === "warm" ? FA.barCacheWarm.replace("{n}", faNum(state.minutes))
    : state.compacted ? FA.barCacheCompacted
    : state.kind === "cold"
      ? FA.barCacheCold.replace("{t}", fmtIdle(state.idle))
        + (state.size ? " " + FA.barCacheRecache.replace("{n}", fmtTokens(state.size)) : "")
      : "";
  button.title = text;
  button.setAttribute("aria-label", text || FA.barCache);
}
/* --- 7. what the «/» palette lists ------------------------------------------

   Every command the window knows (the CLI's own list plus the verbs the window
   answers itself), sorted into the extension's groups. A command with a Persian
   name in FA.paletteNames shows that name and its own `/name` as the hint; any
   other (a skill, a plugin's command) keeps its name and the CLI's description,
   in the last group. */
const PALETTE_GROUP = {
  chat: ["clear", "compact", "rewind", "branch", "rename", "resume", "export"],
  model: ["model", "effort", "output-style", "permissions", "fast", "context", "usage", "cost"],
  project: ["init", "memory", "add-dir", "agents", "hooks", "mcp", "review", "security-review",
            "status", "help"],
};

export function paletteGroups(commands) {
  const names = FA.paletteNames ?? {};
  const byName = new Map();
  for (const c of commands ?? []) if (c?.name && !byName.has(c.name)) byName.set(c.name, c);
  const groups = [];
  const used = new Set();
  for (const [key, list] of Object.entries(PALETTE_GROUP)) {
    const items = [];
    for (const name of list) {
      const c = byName.get(name);
      if (!c) continue;
      used.add(name);
      items.push({ key: name, title: names[name] ?? name, note: names[name] ? "" : c.description,
                   hint: "/" + name, arg: !!c.argumentHint });
    }
    if (items.length) groups.push({ title: FA.paletteGroups[key], items });
  }
  const rest = [...byName.values()].filter((c) => !used.has(c.name))
    .map((c) => ({ key: c.name, title: "/" + c.name, note: c.description, hint: "",
                   arg: !!c.argumentHint }));
  if (rest.length) groups.push({ title: FA.paletteGroups.other, items: rest });
  return groups;
}
