r"""Composer bar gate, BOTH editions.

The user's request, 2026-09-29, with five claude.ai/code screenshots: its
composer bar in both editions. What can go wrong is quiet — a menu that opens
and writes nothing, a slider that posts the wrong level, a panel that draws a
figure the CLI never said, a switch that toggles the wrong server — so every
check here follows a click to the request it sends:

  - js/bar.js is byte-identical in both editions (one file, two copies);
  - the ◔ ring paints the context figure; the panel draws the context by
    category, the headroom to auto-compact, «فشرده کردن» sends `/compact`, and
    each plan limit (5h, weekly, the per-model «Fable» row) with a reset time;
    a login with no limits says so;
  - the model menu numbers its rows, marks the current one, and a digit picks
    (set_model with that row's value); the mode menu likewise (/api/posture);
  - the effort track sits at the foot of the model AND mode menus (the VS Code
    extension's shape, 2026-10-08), starts at the current level and a change
    posts it; the level is drawn beside the model's name, and there is no
    effort chip; the mode rows carry icons;
  - «+» offers files (/api/attach/pick), `@` for a project file, and this
    machine's MCP servers behind one row, whose switch sends mcp_toggle for
    that server;
  - «/» opens every command in groups with a filter, and a picked command with
    no argument goes as that command;
  - the prompt-cache clock reads the minutes a reply's 1h cache write leaves.

Free: no CLI, no login. Every route is stubbed inside the page.

    python persian-claude-gui\test_bar.py            both editions
"""

from __future__ import annotations

import os
import sys
import threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from test_layout import boot_server, find_edge, hold_sse, measure  # noqa: E402

from server import EDITIONS  # noqa: E402

PROBE_NAME = "_bar_probe.html"

PROBE_JS = r"""
<pre id="probe-out" hidden></pre>
<script type="module">
import { routeEvent, applyTabs } from "/static/js/app.js";
import { fmtReset, limitRows } from "/static/js/bar.js";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FA = window.STRINGS;
const calls = [];
const json = (o, status = 200) => new Response(JSON.stringify(o), { status,
  headers: { "Content-Type": "application/json" } });
let servers = [{ name: "github", status: "connected" }, { name: "playwright", status: "connected" }];
window.fetch = async (url, init) => {
  const u = String(url);
  const body = init?.body ? JSON.parse(init.body) : null;
  calls.push({ url: u.split("?")[0], body });
  if (u.startsWith("/api/tabs")) return json({ tabs: [{ tab: "t1", cwd: "C:/kar" }], active: "t1" });
  if (u.startsWith("/api/projects")) return json({ projects: [] });
  if (u.startsWith("/api/agents")) return json({ agents: [] });
  if (u.startsWith("/api/session")) return json({ events: [] });
  if (u.startsWith("/api/effort")) return json({ ok: true, effort: body.level });
  if (u.startsWith("/api/attach/pick")) return json({ paths: [] });
  if (u.startsWith("/api/control")) {
    if (body.subtype === "mcp_status") return json({ ok: true, response: { mcpServers: servers } });
    if (body.subtype === "mcp_toggle") {
      servers = servers.map((s) => s.name === body.params.serverName
        ? { ...s, status: body.params.enabled ? "connected" : "disabled" } : s);
      return json({ ok: true, response: {} });
    }
    return json({ ok: false, error: "stubbed" });   // the panel keeps what it has
  }
  return json({ ok: true });
};
const cell = () => document.querySelector("#grid .cell, .cell");
const q = (sel) => cell()?.querySelector(sel);
const pop = () => document.querySelector(".bar-pop");
const since = (mark) => calls.slice(mark);
const key = (target, code) => target.dispatchEvent(new KeyboardEvent("keydown",
  { code, key: code.replace("Digit", ""), bubbles: true, cancelable: true }));
const ev = (e) => routeEvent({ tab: "t1", ...e });
const NOW = Date.now();

(async () => {
 const out = {};
 try {
  await sleep(200);
  applyTabs({ tabs: [{ tab: "t1", cwd: "C:/kar" }], active: "t1" });
  await sleep(60);
  ev({ type: "system", subtype: "init", model: "claude-opus-5-5", cwd: "C:/kar",
       permissionMode: "default", session_id: "s1", slash_commands: ["compact", "model"] });
  ev({ type: "wrapper", subtype: "init_info", info: { output_style: "default",
       available_output_styles: ["default"], models: [
    { value: "opus", resolvedModel: "claude-opus-5-5", displayName: "Opus",
      description: "Opus 5.5", supportsEffort: true, supportedEffortLevels: ["low", "medium", "high", "xhigh"] },
    { value: "sonnet", resolvedModel: "claude-sonnet-5-5", displayName: "Sonnet",
      description: "Sonnet 5.5", supportsEffort: true, supportedEffortLevels: ["low", "medium", "high", "xhigh"] }] } });
  ev({ type: "wrapper", subtype: "posture", posture: "ask", auto_count: 0 });
  ev({ type: "wrapper", subtype: "effort", effort: "medium" });
  // Before anything was said, the panel calls its figure a baseline.
  const hasBaseline = () => [...(pop()?.querySelectorAll("p.bar-muted") ?? [])]
    .some((p) => p.textContent === FA.barBaseline);
  q(".bar-ring")?.click(); await sleep(60);
  out.baselineFresh = hasBaseline();
  pop()?.hidePopover(); await sleep(20);
  ev({ type: "wrapper", subtype: "usage", context: 42,
       limits: { five_hour: { utilization: 31, resets_at: new Date(NOW + 16380e3).toISOString() },
                 seven_day: { utilization: 21, resets_at: new Date(NOW + 4 * 864e5).toISOString() },
                 model_scoped: [{ display_name: "Fable", utilization: 7, resets_at: null }] },
       context_detail: { total: 420000, max: 1000000, threshold: 967000, categories: [
         { name: "Memory files", tokens: 31900, color: "claude", kind: "used" },
         { name: "Messages", tokens: 388100, color: "purple", kind: "used" },
         { name: "Free space", tokens: 580000, color: "promptBorder", kind: "free" }] } });
  await sleep(60);

  // The ring and the panel.
  const ring = q(".bar-ring");
  out.ringDash = (ring?.querySelector(".bar-ring-fill")?.style.strokeDasharray ?? "").replace(/,/g, "");
  ring?.click(); await sleep(60);
  out.figure = pop()?.querySelector(".bar-figure")?.textContent ?? "";
  out.segments = pop()?.querySelectorAll(".bar-context .bar-seg").length ?? -1;
  out.headroom = pop()?.querySelector(".bar-context-act .bar-muted")?.textContent ?? "";
  out.limitNames = [...(pop()?.querySelectorAll(".bar-limit-name") ?? [])].map((n) => n.textContent);
  out.catName = pop()?.querySelector(".bar-cats li span:nth-child(2)")?.textContent ?? "";
  out.baselineAfter = hasBaseline();
  let mark = calls.length;
  pop()?.querySelector(".bar-btn")?.click(); await sleep(30);
  out.compact = since(mark).filter((c) => c.url === "/api/message").map((c) => c.body.text).join();
  out.panelClosed = !pop();
  ev({ type: "wrapper", subtype: "usage", limits: null });
  ring?.click(); await sleep(60);
  out.noLimits = [...(pop()?.querySelectorAll("p.bar-muted") ?? [])].some((p) => p.textContent === FA.barNoLimits);
  pop()?.hidePopover(); await sleep(20);
  // A chip is a toggle: the second click shuts what the first opened.
  ring?.click(); await sleep(40);
  const ringOpen = !!pop();
  ring?.click(); await sleep(40);
  out.toggleShut = ringOpen && !pop();
  ring?.click(); await sleep(40);
  out.toggleAgain = !!pop();
  pop()?.hidePopover(); await sleep(20);

  // The model menu: numbered, the current one checked, a digit picks.
  q(".model-chip")?.click(); await sleep(40);
  const menu = pop() ?? q(".menu-popup:not([hidden])");
  const rowSel = pop() ? ".bar-row" : ".menu-row";
  const rows = [...(menu?.querySelectorAll(rowSel) ?? [])];
  out.modelRows = rows.length;
  // The extension's model menu (2026-10-09 reference): the check on the current
  // row, its place on every other one.
  out.modelDigits = rows.filter((r) => r.querySelector(".bar-row-check.is-digit")?.textContent).length;
  out.modelCheck = rows.map((r) => {
    const c = r.querySelector(".bar-row-check, .menu-check");
    return c?.textContent === "✓" ? "v" : c?.classList.contains("is-digit") ? c.textContent : "-";
  }).join("");
  mark = calls.length;
  // A click on the chip takes focus off the prompt; a digit typed INTO the
  // prompt is text, and the web menu rightly leaves it alone.
  key(pop() ?? document.body, "Digit2"); await sleep(40);
  out.setModel = since(mark).filter((c) => c.url === "/api/control" && c.body.subtype === "set_model")
    .map((c) => c.body.params.model).join();

  // The mode menu.
  q(".posture-chip")?.click(); await sleep(40);
  const mode = pop() ?? q(".menu-popup:not([hidden])");
  out.modeRows = mode?.querySelectorAll(pop() ? ".bar-row" : ".menu-row").length ?? -1;
  mark = calls.length;
  key(pop() ?? document.body, "Digit1"); await sleep(40);
  out.posture = since(mark).filter((c) => c.url === "/api/posture").map((c) => c.body.posture).join();

  // The effort track: at the foot of the mode menu and of the model menu,
  // the level beside the model's name, no chip of its own.
  out.effortChip = !!q(".effort-chip");
  out.chipEffort = q(".model-chip-effort")?.textContent ?? "";
  out.wantChipEffort = FA.effortLevels?.medium ?? "medium";
  q(".posture-chip")?.click(); await sleep(40);
  out.modeEffort = !!pop()?.querySelector(".bar-effort .bar-slider-range");
  out.modeIcons = pop()?.querySelectorAll(":scope > .bar-row .bar-row-icon svg").length ?? -1;
  pop()?.hidePopover(); await sleep(20);
  q(".model-chip")?.click(); await sleep(40);
  const range = pop()?.querySelector(".bar-effort .bar-slider-range");
  out.rangeStart = range ? range.value + "/" + range.max : "none";
  mark = calls.length;
  if (range) { range.value = "3"; range.dispatchEvent(new Event("change")); }
  await sleep(40);
  out.effortPost = since(mark).filter((c) => c.url === "/api/effort").map((c) => c.body.level).join();
  out.menuStays = !!pop();   // a level is not a pick: the menu stays open
  pop()?.hidePopover(); await sleep(20);

  // The extension's model menu: every model in one list, the CLI's order; and
  // the mode menu's footer is what «خودکار» approved, opening its list.
  ev({ type: "wrapper", subtype: "init_info", info: { output_style: "default",
       available_output_styles: ["default"], models: [
    { value: "default", resolvedModel: "claude-sonnet-5-5", displayName: "Default (recommended)" },
    { value: "opus", resolvedModel: "claude-opus-5-5", displayName: "Opus 5.5", description: "complex work" },
    { value: "sonnet", resolvedModel: "claude-sonnet-5-5", displayName: "Sonnet 5.5" },
    { value: "claude-opus-5", resolvedModel: "claude-opus-5", displayName: "Opus 5" }] } });
  await sleep(30);
  q(".model-chip")?.click(); await sleep(40);
  out.barMenus = !!pop()?.classList.contains("bar-menu");
  if (out.barMenus) {
    out.primary = [...pop().querySelectorAll(":scope > .bar-row:not(.bar-foot):not(.bar-more) .bar-row-title")]
      .map((t) => t.textContent).join("|");
    out.tip = pop().querySelector(":scope > .bar-row")?.title ?? "";
    // The alias is not a row: the chip and the check name the model it means.
    out.chipName = q(".model-chip-name")?.textContent ?? "";
    out.checked = pop().querySelector(':scope > .bar-row[aria-current="true"] .bar-row-title')?.textContent ?? "";
    // Geometry, never text: a Latin title sits at the START of its RTL row,
    // and no row draws a digit (the keys still pick).
    const row0 = pop().querySelector(":scope > .bar-row");
    const t0 = row0.querySelector(".bar-row-title").getBoundingClientRect();
    const r0 = row0.getBoundingClientRect();
    out.titleGap = Math.round(r0.right - t0.right);
    const cur = pop().querySelector(':scope > .bar-row[aria-current="true"]');
    out.curDigitShown = !!cur?.querySelector(".bar-row-digit");
    // The menu opens over its own bar: it shares an edge with its chip.
    const chipR = q(".model-chip").getBoundingClientRect(), menuR = pop().getBoundingClientRect();
    out.menuOnChip = Math.min(Math.abs(menuR.left - chipR.left), Math.abs(menuR.right - chipR.right)) <= 1
      || menuR.left <= 9 || menuR.right >= innerWidth - 9;
    out.notes = pop().querySelectorAll(":scope > .bar-row .bar-row-note").length;
    out.noteLine = pop().querySelector(":scope > .bar-row .bar-row-note")?.textContent ?? "";
    // A pinned id (claude-...) is under the «more» row, in a list beside the menu.
    const moreBtn = pop().querySelector(":scope > .bar-more");
    out.moreTitle = moreBtn?.querySelector(".bar-row-title")?.textContent ?? "";
    moreBtn?.click(); await sleep(60);
    const sub = pop()?.querySelector(".bar-sub");
    out.subTitles = [...(sub?.querySelectorAll(".bar-row-title") ?? [])].map((t) => t.textContent).join("|");
    out.subOpen = !!sub?.matches(":popover-open") && !!pop()?.matches(":popover-open");
    if (sub) {
      const s = sub.getBoundingClientRect(), m = pop().getBoundingClientRect();
      out.subBeside = s.right <= m.left + 1 || s.left >= m.right - 1;
      out.subInside = s.left >= 0 && s.right <= innerWidth && s.top >= 0 && s.bottom <= innerHeight;
    }
    mark = calls.length;
    sub?.querySelector(".bar-row")?.click(); await sleep(40);
    out.subPick = since(mark).filter((c) => c.url === "/api/control" && c.body.subtype === "set_model")
      .map((c) => c.body.params.model).join();
    pop()?.hidePopover(); await sleep(20);
   }
   if (out.barMenus && FA.barAutoCount) {
    ev({ type: "wrapper", subtype: "posture", posture: "autoApprove", auto_count: 3 });
    ev({ type: "wrapper", subtype: "permission_resolved", request_id: "ra", tool_use_id: "ua",
         decision: "allow", auto: true, auto_count: 3, tool_name: "Write", why: "posture",
         target: "C:\kar\app.py", at: 1760000000 });
    await sleep(30);
    q(".posture-chip")?.click(); await sleep(40);
    out.foot = pop()?.querySelector(".bar-foot .bar-row-title")?.textContent ?? "";
    out.wantFoot = FA.barAutoCount.replace("{n}", "۳");
    pop()?.querySelector(".bar-foot")?.click(); await sleep(40);
    // A list to read beside the transcript, not a menu or a picker.
    const list = document.querySelector('.diff-side[data-kind="audit"]');
    const row = list?.querySelector(".audit-row");
    out.auditOpen = !!list && (list.textContent ?? "").includes(FA.autoActionsTitle)
      && row?.querySelector(".audit-tool")?.textContent === "Write"
      && row?.querySelector(".audit-target.path")?.textContent === "C:\kar\app.py"
      && !!row?.querySelector("time.audit-time")
      && !list.querySelector(".diff-side-body button, .diff-side-body [tabindex]")
      && !document.querySelector("dialog.picker[open]") && (q(".menu-popup")?.hidden ?? true);
    list?.querySelector(".diff-side-close")?.click(); await sleep(20);
    out.noChip = !document.querySelector(".auto-chip");
  }

  // The response style (2026-10-08): titled from the user's labels file, only
  // the styles it names, chosen before the first message and fixed after it;
  // and another model mid-conversation asks before it switches.
  ev({ type: "wrapper", subtype: "posture", posture: "ask", auto_count: 0 });
  ev({ type: "wrapper", subtype: "init_info", info: { output_style: "frugal-concise",
       available_output_styles: ["default", "frugal-concise", "explain-fa", "Explanatory"],
       output_style_labels: [
         { id: "frugal-concise", title: "کار روزمره", description: "برای بیشتر کارها" },
         { id: "explain-fa", title: "توضیح فارسی", description: "وقتی می‌خواهی بفهمی، نه فقط کار انجام شود. ".repeat(8) },
         { id: "default", title: "پیش‌فرض Claude", description: "رفتار استاندارد" }],
       models: [
    { value: "opus", resolvedModel: "claude-opus-5-5", displayName: "Opus",
      description: "Opus 5.5", supportsEffort: true, supportedEffortLevels: ["low", "medium", "high", "xhigh"] },
    { value: "sonnet", resolvedModel: "claude-sonnet-5-5", displayName: "Sonnet",
      description: "Sonnet 5.5", supportsEffort: true, supportedEffortLevels: ["low", "medium", "high", "xhigh"] }] } });
  await sleep(30);
  const styleFoot = () => [...(pop()?.querySelectorAll(".bar-foot") ?? [])]
    .find((b) => b.textContent.includes(FA.styleTitle));
  q(".posture-chip")?.click(); await sleep(40);
  out.styleValue = styleFoot()?.querySelector(".bar-row-value")?.textContent ?? "";
  out.styleOpenable = !!styleFoot() && !styleFoot().disabled;
  styleFoot()?.click(); await sleep(40);
  out.styleTitles = [...(pop()?.querySelectorAll(":scope > .bar-row .bar-row-title") ?? [])]
    .map((t) => t.textContent).join("|");
  out.styleNote = pop()?.querySelector(":scope > .bar-row .bar-row-note")?.textContent ?? "";
  // A style's description is drawn whole, not clamped at the model rows' two
  // lines (dotclaude v3's explain-fa runs to five).
  const longNote = pop()?.querySelectorAll(":scope > .bar-row .bar-row-note")[1];
  out.styleNoteLines = longNote ? Math.round(longNote.getBoundingClientRect().height
    / parseFloat(getComputedStyle(longNote).lineHeight)) : 0;
  out.styleNoteWhole = !!longNote && longNote.scrollHeight <= longNote.clientHeight + 1;
  mark = calls.length;
  pop()?.querySelectorAll(":scope > .bar-row")[1]?.click(); await sleep(40);
  out.stylePost = since(mark).filter((c) => c.url === "/api/output-style").map((c) => c.body.style).join();
  ev({ type: "wrapper", subtype: "user_echo", uuid: "u-first", text: "سلام" });
  await sleep(40);
  q(".posture-chip")?.click(); await sleep(40);
  out.styleLocked = !!styleFoot()?.disabled && (styleFoot()?.textContent ?? "").includes(FA.styleLocked);
  pop()?.hidePopover(); await sleep(20);
  q(".model-chip")?.click(); await sleep(40);
  mark = calls.length;
  pop()?.querySelector(':scope > .bar-row:not([aria-current="true"])')?.click(); await sleep(40);
  out.asked = !!pop()?.classList.contains("bar-confirm")
    && !since(mark).some((c) => c.url === "/api/control");
  pop()?.querySelector(".bar-confirm .is-primary")?.click(); await sleep(40);
  out.switched = since(mark).filter((c) => c.url === "/api/control" && c.body.subtype === "set_model")
    .map((c) => c.body.params.model).join();
  pop()?.hidePopover(); await sleep(20);
  // Ultracode: a sixth stop only where the CLI says it can run.
  const track = async () => {
    q(".model-chip")?.click(); await sleep(40);
    return pop()?.querySelector(".bar-effort .bar-slider-range");
  };
  ev({ type: "wrapper", subtype: "effort", effort: "medium", ultracode_available: false });
  await sleep(20);
  let r = await track();
  out.ultraOff = r ? r.max : "none";
  pop()?.hidePopover(); await sleep(20);
  ev({ type: "wrapper", subtype: "effort", effort: "medium", ultracode_available: true });
  await sleep(20);
  r = await track();
  out.ultraOn = r ? r.max : "none";
  // An effort change mid-conversation that KEEPS the cache (the CLI's
  // per_turn_effort_active true, 2.1.294) asks nothing and posts at once.
  ev({ type: "system", subtype: "init", model: "claude-opus-5-5", cwd: "C:/kar",
       permissionMode: "default", session_id: "s1", per_turn_effort_active: true });
  await sleep(20);
  mark = calls.length;
  if (r) { r.value = r.max; r.dispatchEvent(new Event("input")); r.dispatchEvent(new Event("change")); }
  await sleep(40);
  out.ultraPost = since(mark).filter((c) => c.url === "/api/effort").map((c) => c.body.level).join();
  out.cheapAsked = !!pop()?.classList.contains("bar-confirm");
  out.ultraLabel = pop()?.querySelector(".bar-slider-now")?.textContent ?? "";
  pop()?.hidePopover(); await sleep(20);
  // One that REWRITES the cache (false) asks first, and posts only on yes.
  ev({ type: "wrapper", subtype: "effort", effort: "medium", ultracode_available: true });
  ev({ type: "system", subtype: "init", model: "claude-opus-5-5", cwd: "C:/kar",
       permissionMode: "default", session_id: "s1", per_turn_effort_active: false });
  await sleep(20);
  r = await track();
  mark = calls.length;
  if (r) { r.value = "3"; r.dispatchEvent(new Event("change")); }
  await sleep(40);
  out.costAsked = !!pop()?.classList.contains("bar-confirm") && !since(mark).some((c) => c.url === "/api/effort");
  pop()?.querySelector(".bar-confirm .is-primary")?.click(); await sleep(40);
  out.costPost = since(mark).filter((c) => c.url === "/api/effort").map((c) => c.body.level).join();
  pop()?.hidePopover(); await sleep(20);
  // That message's turn ends, so what follows starts idle.
  ev({ type: "result", subtype: "success", is_error: false, duration_ms: 10 });
  ev({ type: "command_lifecycle", command_uuid: "u-first", state: "completed" });
  await sleep(40);

  // «+»: files, a project file, and the MCP switches behind one row.
  q(".bar-plus-btn")?.click(); await sleep(80);
  out.plusRows = pop()?.querySelectorAll(".bar-row").length ?? -1;
  out.plusIcons = pop()?.querySelectorAll(".bar-row-icon svg").length ?? -1;
  out.serversHidden = !!pop()?.querySelector(".bar-servers")?.hidden;
  pop()?.querySelector(".bar-fold")?.click(); await sleep(80);
  out.servers = [...(pop()?.querySelectorAll(".bar-server-name") ?? [])].map((n) => n.textContent).join();
  mark = calls.length;
  const sw = pop()?.querySelectorAll(".bar-switch")[1];
  if (sw) { sw.checked = false; sw.dispatchEvent(new Event("change")); }
  await sleep(80);
  const t = since(mark).find((c) => c.url === "/api/control" && c.body.subtype === "mcp_toggle");
  out.toggle = t ? t.body.params.serverName + ":" + t.body.params.enabled : "none";
  out.afterToggle = [...(pop()?.querySelectorAll(".bar-switch") ?? [])].map((s) => (s.checked ? "on" : "off")).join();
  mark = calls.length;
  pop()?.querySelectorAll(".bar-row")[0]?.click(); await sleep(40);
  out.pick = since(mark).some((c) => c.url === "/api/attach/pick");
  q(".bar-plus-btn")?.click(); await sleep(60);
  pop()?.querySelectorAll(".bar-row")[1]?.click(); await sleep(40);
  out.slash = q(".input")?.value ?? "";
  if (q(".input")) { q(".input").value = ""; q(".input").dispatchEvent(new Event("input", { bubbles: true })); }

  // «/»: every command, grouped; the filter folds ي/ی; a pick with no
  // argument goes as that command.
  q(".bar-slash-btn")?.click(); await sleep(60);
  out.groups = [...(pop()?.querySelectorAll(".bar-group") ?? [])].map((g) => g.textContent).join("|");
  out.wantGroups = [FA.paletteGroups.chat, FA.paletteGroups.model].join("|");
  const filter = pop()?.querySelector(".bar-filter");
  out.filterFocused = !!filter && document.activeElement === filter;
  if (filter) {
    filter.value = "فشرده";
    filter.dispatchEvent(new Event("input"));
  }
  out.filtered = [...(pop()?.querySelectorAll(".bar-row .bar-row-title") ?? [])].map((t) => t.textContent).join("|");
  mark = calls.length;
  filter?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await sleep(60);
  out.ran = since(mark).filter((c) => c.url === "/api/message").map((c) => c.body.text).join();
  out.paletteClosed = !pop();
  ev({ type: "result", subtype: "success", usage: {}, result: "ok" });
  await sleep(30);

  // The prompt-cache clock: a reply that wrote the 1h cache now leaves 60
  // minutes; before any reply the chip is not drawn.
  const cache = q(".bar-cache");
  out.cacheBefore = cache ? cache.hidden : "none";
  ev({ type: "assistant", timestamp: new Date().toISOString(), message: { id: "m-cache", role: "assistant",
       content: [{ type: "text", text: "باشه" }],
       usage: { input_tokens: 4, cache_read_input_tokens: 0, cache_creation_input_tokens: 9000,
                cache_creation: { ephemeral_1h_input_tokens: 9000, ephemeral_5m_input_tokens: 0 } } } });
  await sleep(40);
  out.cacheLabel = cache && !cache.hidden ? cache.querySelector(".bar-cache-label")?.textContent : "hidden";
  out.wantCache = FA.barCacheMinutes.replace("{n}", "۶۰");

  // The button at the end of the box, terminal edition: send, or
  // stop while a turn runs with nothing to send; mid-turn «بعداً بفرست».
  out.actBox = !!q(".comp-act.send");
  if (out.actBox) {
    const send = q(".comp-act.send"), stop = q(".comp-act.stop"), box = q(".input");
    const vis = (el) => !!el && !el.hidden;
    const type = (t) => { box.value = t; box.dispatchEvent(new Event("input", { bubbles: true })); };
    type("");
    out.idleEmpty = `${vis(send)}/${send.disabled}/${vis(stop)}`;
    ev({ type: "wrapper", subtype: "user_echo", uuid: "u-busy", text: "کار کن" });
    await sleep(30);
    out.busyEmpty = `${vis(send)}/${vis(stop)}`;
    type("بعد از این هم بپرس");
    out.busyText = `${vis(send)}/${send.disabled}/${vis(stop)}`;
    send.dispatchEvent(new MouseEvent("mouseenter"));
    out.menu = [...(q(".send-menu")?.querySelectorAll(".send-menu-row span") ?? [])]
      .map((x) => x.textContent).join("|");
    out.wantMenu = FA.sendNow + "|" + FA.sendLater;
    let mk = calls.length;
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true,
                                                     bubbles: true, cancelable: true }));
    await sleep(30);
    out.heldPosts = since(mk).filter((c) => c.url === "/api/message").length;
    out.heldRows = q(".later-strip .later-text")?.textContent ?? "";
    out.boxAfterHold = box.value;
    mk = calls.length;
    ev({ type: "result", subtype: "success", usage: {}, result: "ok" });
    ev({ type: "command_lifecycle", command_uuid: "u-busy", state: "completed" });
    await sleep(80);
    out.sentLater = since(mk).filter((c) => c.url === "/api/message").map((c) => c.body.text).join();
    out.stripAfter = q(".later-strip")?.hidden ?? true;
  }

  // The two formatters the panel is made of.
  out.reset = fmtReset(new Date(NOW + 16380e3).toISOString(), NOW);
  out.wantReset = FA.barResetsIn.replace("{t}",
    FA.barInHoursMinutes.replace("{h}", "۴").replace("{m}", "۳۳"));
  out.rowNames = limitRows({ five_hour: { utilization: 1 },
    model_scoped: [{ display_name: "Fable", utilization: 2 }] }).map((r) => r.title).join("|");
  document.getElementById("probe-out").textContent = "PROBE" + JSON.stringify(out) + "ENDPROBE";
 } catch (err) {
  document.getElementById("probe-out").textContent =
    "PROBE" + JSON.stringify({ error: String(err && err.stack || err), partial: out }) + "ENDPROBE";
 }
})();
</script>
"""


def write_probe(static: Path) -> Path:
    """The probe page IS index.html — anything else would drift away from it."""
    page = (static / "index.html").read_text(encoding="utf-8").replace("{{VERSION}}", "9.9.9")
    marker = '<body class="app">'
    if marker not in page:
        sys.exit("index.html no longer opens with " + marker)
    page = page.replace(marker, '<body class="app" data-render-only>', 1)
    probe = static / PROBE_NAME
    probe.write_text(page.replace("</body>", PROBE_JS + "\n</body>", 1), encoding="utf-8")
    return probe


def checks(m: dict, fa_limits: tuple[str, ...]) -> list[tuple[str, bool, str]]:
    out: list[tuple[str, bool, str]] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        out.append((name, bool(ok), detail))

    check("the ring paints the context figure", m.get("ringDash") == "42 100", str(m.get("ringDash")))
    check("the panel names the context in Persian units",
          "۴۲۰" in (m.get("figure") or "") and "۴۲٪" in (m.get("figure") or ""), m.get("figure") or "")
    check("one segment per USED category, free space left as track",
          m.get("segments") == 2, str(m.get("segments")))
    check("the headroom to auto-compact is the threshold minus the total",
          "۵۴۷" in (m.get("headroom") or ""), m.get("headroom") or "")
    check("a category reads in Persian", m.get("catName") == "فایل‌های حافظه", m.get("catName") or "")
    check("a chip is a toggle: a second click shuts its popover, a third opens it again",
          m.get("toggleShut") is True and m.get("toggleAgain") is True,
          f"shut {m.get('toggleShut')}, again {m.get('toggleAgain')}")
    check("each plan limit is a row, the per-model window included",
          tuple(m.get("limitNames") or ()) == fa_limits, str(m.get("limitNames")))
    check("«فشرده کردن» sends /compact as text and closes the panel",
          m.get("compact") == "/compact" and m.get("panelClosed"), f"{m.get('compact')} / {m.get('panelClosed')}")
    check("a login with no plan limits says so", m.get("noLimits"))
    check("before the first message the panel says its figure is a baseline, after it not",
          m.get("baselineFresh") is True and m.get("baselineAfter") is False,
          f"fresh {m.get('baselineFresh')}, after {m.get('baselineAfter')}")
    check("the model menu checks the current one and numbers the others",
          m.get("modelRows") == 2 and m.get("modelDigits") == 1 and m.get("modelCheck") == "v۲",
          f"{m.get('modelRows')} rows / {m.get('modelDigits')} / {m.get('modelCheck')}")
    check("a digit picks from the model menu", m.get("setModel") == "sonnet", str(m.get("setModel")))
    if m.get("actBox"):
        check("idle and empty: send shows, dimmed; no stop",
              m.get("idleEmpty") == "true/true/false", str(m.get("idleEmpty")))
        check("a turn running with nothing typed: stop takes send's place",
              m.get("busyEmpty") == "false/true", str(m.get("busyEmpty")))
        check("typing mid-turn brings send back, live",
              m.get("busyText") == "true/false/false", str(m.get("busyText")))
        check("hovering send mid-turn offers «بفرست» and «بعداً بفرست»",
              m.get("menu") == m.get("wantMenu"), str(m.get("menu")))
        check("Ctrl+Enter mid-turn holds the message: nothing posted, a row above the box",
              m.get("heldPosts") == 0 and m.get("heldRows") == "بعد از این هم بپرس"
              and m.get("boxAfterHold") == "",
              f"{m.get('heldPosts')} posts / «{m.get('heldRows')}» / box «{m.get('boxAfterHold')}»")
        check("the held message goes when the turn ends, and its row with it",
              m.get("sentLater") == "بعد از این هم بپرس" and m.get("stripAfter"),
              f"«{m.get('sentLater')}» / strip hidden {m.get('stripAfter')}")
    check("bar-menu shape in both editions", m.get("barMenus") is True, str(m.get("barMenus")))
    if m.get("barMenus"):
        check("the model menu lists the CLI's aliases, names only, the description as a hover title",
              m.get("primary") == "Opus 5.5|Sonnet 5.5" and m.get("notes") == 0
              and m.get("tip") == "complex work",
              f"{m.get('primary')} / {m.get('notes')} notes / tip «{m.get('tip')}»")
        check("...a pinned model is under «مدل‌های بیشتر», in a list beside the menu, both open",
              m.get("moreTitle") == "مدل‌های بیشتر" and m.get("subTitles") == "Opus 5"
              and m.get("subOpen") is True and m.get("subBeside") is True and m.get("subInside") is True,
              f"«{m.get('moreTitle')}» / {m.get('subTitles')} / open {m.get('subOpen')} / "
              f"beside {m.get('subBeside')} / on screen {m.get('subInside')}")
        check("...and a row there picks that model", m.get("subPick") == "claude-opus-5",
              str(m.get("subPick")))
        check("the «Default» alias is the model it resolves to: no row of its own, the check on that model",
              m.get("checked") == "Opus 5.5" and m.get("chipName") == "Opus 5.5",
              f"checked «{m.get('checked')}», chip «{m.get('chipName')}»")
        check("a Latin title sits at the start of its RTL row, and no row draws a digit",
              isinstance(m.get("titleGap"), int) and m.get("titleGap") <= 16 and m.get("curDigitShown") is False,
              f"gap {m.get('titleGap')}px, digit shown {m.get('curDigitShown')}")
        check("the menu shares an edge with its chip", m.get("menuOnChip") is True, str(m.get("menuOnChip")))
    if "foot" in m:
        check("the audit count is the mode menu's footer, and it opens a read-only list "
              "beside the transcript (tool, path, time; nothing to click); no bar chip",
              m.get("foot") == m.get("wantFoot") and m.get("auditOpen") and m.get("noChip"),
              f"«{m.get('foot')}» / list {m.get('auditOpen')} / no chip {m.get('noChip')}")
    check("the style row names the style in force and opens the list before the first message",
          m.get("styleOpenable") is True and m.get("styleValue") == "کار روزمره",
          f"open {m.get('styleOpenable')} / «{m.get('styleValue')}»")
    check("...exactly the labels file's styles, in its order, each with its description",
          m.get("styleTitles") == "کار روزمره|توضیح فارسی|پیش‌فرض Claude"
          and m.get("styleNote") == "برای بیشتر کارها",
          f"{m.get('styleTitles')} / «{m.get('styleNote')}»")
    check("...and a long description is drawn whole, past the model rows' two lines",
          m.get("styleNoteWhole") is True and (m.get("styleNoteLines") or 0) > 2,
          f"{m.get('styleNoteLines')} lines / whole {m.get('styleNoteWhole')}")
    check("...and a row posts that style", m.get("stylePost") == "explain-fa", str(m.get("stylePost")))
    check("after the first message the style row only says which one is in force",
          m.get("styleLocked") is True, str(m.get("styleLocked")))
    check("another model mid-conversation asks first, and switches only on yes",
          m.get("asked") is True and m.get("switched") == "sonnet",
          f"asked {m.get('asked')} / switched «{m.get('switched')}»")
    check("«اولترا» is a sixth effort stop only where the CLI offers ultracode",
          m.get("ultraOff") == "3" and m.get("ultraOn") == "4", f"{m.get('ultraOff')} / {m.get('ultraOn')}")
    check("...picking it posts «ultracode», labelled «اولترا»",
          m.get("ultraPost") == "ultracode" and m.get("ultraLabel") == "(اولترا)",
          f"{m.get('ultraPost')} / {m.get('ultraLabel')}")
    check("an effort change that keeps the cache asks nothing mid-conversation",
          m.get("cheapAsked") is False, str(m.get("cheapAsked")))
    check("one that rewrites the cache (per_turn_effort_active false) asks, and posts only on yes",
          m.get("costAsked") is True and m.get("costPost") == "xhigh",
          f"asked {m.get('costAsked')} / posted «{m.get('costPost')}»")
    check("the mode menu lists the four postures and a digit picks",
          m.get("modeRows") == 4 and m.get("posture") == "plan", f"{m.get('modeRows')} / {m.get('posture')}")
    check("the mode menu carries an icon per row and the effort track",
          m.get("modeIcons") == 4 and m.get("modeEffort") is True,
          f"{m.get('modeIcons')} icons / track {m.get('modeEffort')}")
    check("no effort chip; the level is drawn beside the model's name",
          m.get("effortChip") is False and m.get("chipEffort") == m.get("wantChipEffort"),
          f"chip {m.get('effortChip')} / «{m.get('chipEffort')}»")
    check("the model menu's effort track starts at the current level, posts a change, stays open",
          m.get("rangeStart") == "1/3" and m.get("effortPost") == "xhigh" and m.get("menuStays") is True,
          f"{m.get('rangeStart')} / {m.get('effortPost')} / open {m.get('menuStays')}")
    check("«+» offers files, a project file and one servers row, each with an icon",
          m.get("plusRows") == 3 and m.get("plusIcons") == 3 and m.get("serversHidden") is True,
          f"{m.get('plusRows')} rows / {m.get('plusIcons')} icons / folded {m.get('serversHidden')}")
    check("...the servers row opens this machine's MCP servers",
          m.get("servers") == "github,playwright", str(m.get("servers")))
    check("a switch toggles THAT server, and the list repaints from the CLI",
          m.get("toggle") == "playwright:false" and m.get("afterToggle") == "on,off",
          f"{m.get('toggle')} / {m.get('afterToggle')}")
    check("«پیوست فایل» opens the native dialog; the mention row starts an `@`",
          m.get("pick") is True and m.get("slash") == "@", f"{m.get('pick')} / {m.get('slash')!r}")
    check("«/» opens the commands in groups, the filter focused",
          (m.get("groups") or "").startswith(m.get("wantGroups") or "?") and m.get("filterFocused") is True,
          f"{m.get('groups')} / focused {m.get('filterFocused')}")
    check("the filter narrows to the Persian name; Enter runs it as its command",
          m.get("filtered") == "فشرده کردن گفتگو" and m.get("ran") == "/compact" and m.get("paletteClosed"),
          f"«{m.get('filtered')}» / sent {m.get('ran')!r} / closed {m.get('paletteClosed')}")
    check("the cache clock is hidden until a reply, then reads the 1h write's minutes",
          m.get("cacheBefore") is True and m.get("cacheLabel") == m.get("wantCache"),
          f"before hidden {m.get('cacheBefore')} / «{m.get('cacheLabel')}»")
    check("a reset inside a day reads as hours and minutes to go",
          m.get("reset") == m.get("wantReset"), f"{m.get('reset')} vs {m.get('wantReset')}")
    check("the per-model window is named by the CLI's own label",
          (m.get("rowNames") or "").endswith("Fable"), m.get("rowNames") or "")
    return out


def run(edition: str, edge: str) -> list[tuple[str, bool, str]]:
    static = HERE / EDITIONS[edition][0]
    probe = write_probe(static)
    proc, base, token = boot_server(edition=edition)
    try:
        stop = threading.Event()
        threading.Thread(target=hold_sse, args=(base, token, stop), daemon=True).start()
        report = measure(edge, f"{base}/static/{PROBE_NAME}?t={token}", 1280, 900)
    finally:
        proc.terminate()
        probe.unlink(missing_ok=True)
    if report.get("error"):
        return [("the probe ran", False, str(report["error"]) + " / " + str(report.get("partial")))]
    fa = {}
    for line in (static / "strings.fa.js").read_text(encoding="utf-8").splitlines():
        for k in ("barLimit5h", "barLimitWeek", "barLimitWeekModel"):
            if line.strip().startswith(k + ":"):
                fa[k] = line.split(":", 1)[1].strip().strip(",").strip('"')
    names = (fa["barLimit5h"], fa["barLimitWeek"], fa["barLimitWeekModel"].replace("{name}", "Fable"))
    return checks(report, names)


def main() -> int:
    edge = find_edge()
    a = (HERE / "static" / "js" / "bar.js").read_bytes()
    b = (HERE / "static-terminal" / "js" / "bar.js").read_bytes()
    results = [("js/bar.js is the same file in both editions", a == b, "")]
    wanted = os.environ.get("PCG_UI")
    for edition in ([wanted] if wanted else ["terminal", "web"]):
        results += [(f"[{edition}] {n}", ok, d) for n, ok, d in run(edition, edge)]
    for name, ok, detail in results:
        print(f"  {'OK  ' if ok else 'FAIL'} {name}" + (f"  -- {detail}" if detail else ""))
    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print(f"{'PASS' if passed == total else 'FAIL'} \u2014 {passed}/{total}")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
