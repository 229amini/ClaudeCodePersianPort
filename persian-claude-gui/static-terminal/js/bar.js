/* ============================================================================
   The composer bar's popovers, after claude.ai/code.

   ONE FILE, BOTH EDITIONS: static/js/bar.js and static-terminal/js/bar.js are
   byte-identical, and test_bar.py says so. A LEAF: it imports nothing. What it
   needs from its edition — the request helper, how to turn a screen rect into
   CSS px, the controls' own state — comes in as arguments, so each edition
   keeps the state it already had and this only draws.

   Four popovers, all `[popover=auto]` (so a second one, Esc or a click
   outside closes the first, for free):

     openMenu    numbered rows, a ✓ on the current one, a digit picks
     openSlider  the effort levels as one track, «سریع‌تر ↔ باهوش‌تر»
     openUsage   the context window by category, then each plan limit
     openPlus    files, slash commands, and the MCP servers with switches

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

/* --- 1. a numbered menu ---------------------------------------------------- */

/* One row: the name (and a one-line note) at the start, then ✓ and the digit
   at the end — claude.ai's order, mirrored by the RTL row. `tip` is a hover
   title for what does not fit a one-line row (a model's description). */
function menuRow(row, digit) {
  const b = el("button", "bar-row");
  b.type = "button";
  b.disabled = !!row.disabled;
  if (row.key !== undefined) b.dataset.key = row.key;
  if (row.selected) b.setAttribute("aria-current", "true");
  if (row.tip) b.title = row.tip;
  const text = el("span", "bar-row-text");
  const name = el("span", "bar-row-title", row.title);
  name.dir = "auto";
  text.append(name);
  if (row.note) {
    const note = el("span", "bar-row-note", row.note);
    note.dir = "auto";
    text.append(note);
  }
  b.append(text, el("span", "bar-row-check", row.selected ? "✓" : ""),
           el("span", "bar-row-digit", digit));
  return b;
}

/* rows: [{key, title, note?, tip?, selected?, disabled?}]. The digit is the
   row's place in the list, never part of its text (the choice.js rule), and it
   is a key while the menu is open.

   `hint`: a quiet word at the head's far end (the mode menu's Shift+Tab).
   `more`: {title, rows} — the rest of a long list behind one row that opens a
   flyout beside the menu (claude.ai's «More models ›»). Its rows take no digit.
   `footer`: {title, onClick} — one row under a rule that is not a choice (the
   mode menu's count of what «خودکار» approved, which opens that list). */
export function openMenu(anchor, { title, hint, rows, onPick, toCss, more, footer }) {
  if (toggledShut(anchor)) return null;
  const pick = (row) => {
    close();
    anchor.focus();
    onPick?.(row);
  };
  let flyout = null;
  const shut = () => { flyout?.remove(); flyout = null; };
  const { pop } = popover(anchor, "bar-menu", title, (box) => {
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
    rows.forEach((row, i) => {
      const b = menuRow(row, i < 9 ? faNum(i + 1) : "");
      b.addEventListener("click", () => pick(row));
      b.addEventListener("mouseenter", shut);
      box.append(b);
    });
    if (more?.rows?.length) {
      box.append(el("hr", "bar-rule"));
      const b = menuRow({ title: more.title }, "");
      b.classList.add("bar-more");
      b.setAttribute("aria-haspopup", "menu");
      b.setAttribute("aria-expanded", "false");
      const chevron = b.querySelector(".bar-row-digit");
      chevron.textContent = "‹";
      const openFlyout = () => {
        if (flyout) return;
        flyout = el("div", "bar-pop bar-flyout");
        flyout.setAttribute("role", "menu");
        for (const row of more.rows) {
          const r = menuRow(row, "");
          r.addEventListener("click", () => pick(row));
          flyout.append(r);
        }
        b.after(flyout);
        b.setAttribute("aria-expanded", "true");
        // Beside the menu, on the side the chevron points to (the start of an
        // RTL row is its right, so «‹» opens leftward; no room there, the other
        // side and the chevron says so). BOTTOM edges together, as claude.ai:
        // the menu sits above its chip, so a list hung from the row's top grew
        // down over the bar and the prompt.
        const pr = pop.getBoundingClientRect();
        const w = flyout.offsetWidth, h = flyout.offsetHeight;
        const vw = toCss ? toCss(innerWidth) : innerWidth;
        const vh = toCss ? toCss(innerHeight) : innerHeight;
        const cv = toCss ?? ((v) => v);
        let left = cv(pr.left) - GAP / 2 - w;
        if (left < EDGE) {
          left = Math.min(cv(pr.right) + GAP / 2, vw - w - EDGE);
          chevron.textContent = "›";
        }
        const top = Math.max(EDGE, Math.min(cv(pr.bottom) - h, vh - h - EDGE));
        flyout.style.left = left + "px";
        flyout.style.top = top + "px";
        flyout.addEventListener("keydown", (e) => {
          const items = [...flyout.querySelectorAll(".bar-row")];
          if (e.key === "ArrowRight" || e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            shut();
            b.setAttribute("aria-expanded", "false");
            b.focus();
          } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            e.stopPropagation();
            const at = items.indexOf(document.activeElement);
            const next = e.key === "ArrowDown" ? at + 1 : at - 1;
            items[(next + items.length) % items.length]?.focus();
          }
        });
      };
      b.addEventListener("mouseenter", openFlyout);
      b.addEventListener("click", () => {
        openFlyout();
        (flyout.querySelector('.bar-row[aria-current="true"]')
          ?? flyout.querySelector(".bar-row"))?.focus();
      });
      b.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowLeft") return;
        e.preventDefault();
        b.click();
      });
      box.append(b);
    }
    if (footer) {
      box.append(el("hr", "bar-rule"));
      const f = menuRow({ title: footer.title }, "");
      f.classList.add("bar-foot");
      f.addEventListener("mouseenter", shut);
      f.addEventListener("click", () => {
        close();
        footer.onClick?.();
      });
      box.append(f);
    }
  }, toCss);
  pop.addEventListener("keydown", (e) => {
    if (e.target.closest?.(".bar-flyout")) return;
    const rowsEl = [...pop.querySelectorAll(":scope > .bar-row:not(:disabled)")];
    const digit = /^Digit([1-9])$/.exec(e.code) || /^Numpad([1-9])$/.exec(e.code);
    if (digit && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const row = rows[Number(digit[1]) - 1];
      if (row && !row.disabled) { e.preventDefault(); pick(row); }
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

/* --- 2. the effort slider -------------------------------------------------- */

/* One stop per level the current model advertises, in its own order (lowest
   first). A native range input: the arrows, Home/End and the screen reader's
   value all come with it. `change`, not `input`: dragging across three stops
   is one decision, not three writes. */
export function openSlider(anchor, { title, levels, current, label, onPick, toCss }) {
  if (toggledShut(anchor)) return null;
  const { pop } = popover(anchor, "bar-slider", title, (box) => {
    const head = el("div", "bar-head");
    const now = el("span", "bar-slider-now", label(current));
    head.append(el("span", "", title), now);
    const ends = el("div", "bar-slider-ends");
    ends.append(el("span", "", FA.barFaster), el("span", "", FA.barSmarter));
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
      now.textContent = label(level);
      range.setAttribute("aria-valuetext", label(level));
    });
    range.addEventListener("change", () => onPick?.(levels[Number(range.value)]));
    const track = el("div", "bar-slider-track");
    track.append(ticks, range);
    box.append(head, ends, track);
  }, toCss);
  pop.querySelector(".bar-slider-range")?.focus();
  return pop;
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

function paintUsage(box, { detail, context, limits, onCompact }) {
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

/* servers: the CLI's own mcp_status list, fetched when the menu opens (the
   host's `loadServers` resolves it). A switch writes through `onToggle`, which
   is PERSISTENT for this folder — the CLI writes disabledMcpServers, as its
   own /mcp does — and the note under the list says so. */
export function openPlus(anchor, { onFiles, onSlash, loadServers, onToggle, toCss }) {
  if (toggledShut(anchor)) return null;
  const { pop, relayout } = popover(anchor, "bar-menu bar-plus", FA.barPlus, (box) => {
    const row = (title, hint, run) => {
      const b = el("button", "bar-row");
      b.type = "button";
      const text = el("span", "bar-row-text");
      text.append(el("span", "bar-row-title", title));
      b.append(text, el("span", "bar-row-check", ""), el("kbd", "bar-row-digit", hint));
      b.lastChild.dir = "ltr";
      b.addEventListener("click", () => { close(); run?.(); });
      box.append(b);
    };
    row(FA.barFiles, "Ctrl+U", onFiles);
    row(FA.barSlash, "/", onSlash);
    box.append(el("hr", "bar-rule"));
    box.append(el("div", "bar-head", FA.barConnectors));
    const list = el("div", "bar-servers");
    list.append(el("p", "bar-muted", FA.barLoading));
    box.append(list);
  }, toCss);
  const list = pop.querySelector(".bar-servers");
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
  Promise.resolve(loadServers?.()).then(paint, () => paint([]));
  pop.querySelector(".bar-row")?.focus();
  return pop;
}
