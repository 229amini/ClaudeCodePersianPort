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
  - the effort slider starts at the current level and a change posts it;
  - «+» offers files (/api/attach/pick), slash commands (the popup opens), and
    this machine's MCP servers, whose switch sends mcp_toggle for that server.

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
  out.modelDigits = rows.map((r) => r.querySelector(".bar-row-digit, .menu-digit")?.textContent).join();
  out.modelCheck = rows.map((r) => (r.querySelector(".bar-row-check, .menu-check")?.textContent ? "v" : "-")).join("");
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

  // The effort slider.
  q(".effort-chip")?.click(); await sleep(40);
  const range = pop()?.querySelector(".bar-slider-range");
  out.rangeStart = range ? range.value + "/" + range.max : "none";
  mark = calls.length;
  if (range) { range.value = "3"; range.dispatchEvent(new Event("change")); }
  await sleep(40);
  out.effortPost = since(mark).filter((c) => c.url === "/api/effort").map((c) => c.body.level).join();
  pop()?.hidePopover(); await sleep(20);

  // claude.ai's model shape: the newest of each
  // family, then «More models ›» with the rest; and the mode menu's footer is
  // what «خودکار» approved, opening its list. bar.js menus only — the web
  // edition's in-cell menu is its own (P4).
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
    out.primary = [...pop().querySelectorAll(":scope > .bar-row:not(.bar-more):not(.bar-foot) .bar-row-title")]
      .map((t) => t.textContent).join("|");
    out.tip = pop().querySelector(":scope > .bar-row")?.title ?? "";
    // The alias is not a row: the chip and the check name the model it means.
    out.chipName = q(".model-chip-name")?.textContent ?? "";
    out.checked = pop().querySelector(':scope > .bar-row[aria-current="true"] .bar-row-title')?.textContent ?? "";
    // Geometry, never text: a Latin title sits at the START of its RTL row,
    // and the current row shows the check where the others show a digit.
    const row0 = pop().querySelector(":scope > .bar-row");
    const t0 = row0.querySelector(".bar-row-title").getBoundingClientRect();
    const r0 = row0.getBoundingClientRect();
    out.titleGap = Math.round(r0.right - t0.right);
    const cur = pop().querySelector(':scope > .bar-row[aria-current="true"]');
    out.curDigitShown = !!cur && cur.querySelector(".bar-row-digit").getClientRects().length > 0;
    // The menu opens over its own bar: it shares an edge with its chip.
    const chipR = q(".model-chip").getBoundingClientRect(), menuR = pop().getBoundingClientRect();
    out.menuOnChip = Math.min(Math.abs(menuR.left - chipR.left), Math.abs(menuR.right - chipR.right)) <= 1
      || menuR.left <= 9 || menuR.right >= innerWidth - 9;
    out.notes = pop().querySelectorAll(":scope > .bar-row .bar-row-note").length;
    pop().querySelector(".bar-more")?.click(); await sleep(30);
    out.flyout = [...pop().querySelectorAll(".bar-flyout .bar-row-title")].map((t) => t.textContent).join("|");
    const fr = pop().querySelector(".bar-flyout")?.getBoundingClientRect();
    const mr = pop().getBoundingClientRect();
    out.flyoutBeside = !!fr && (fr.right <= mr.left + 1 || fr.left >= mr.right - 1);
    out.flyoutBottom = !!fr && (Math.abs(fr.bottom - mr.bottom) <= 1 || fr.top <= 9);
    mark = calls.length;
    [...pop().querySelectorAll(".bar-flyout .bar-row")].at(-1)?.click(); await sleep(40);
    out.setFromFlyout = since(mark).filter((c) => c.url === "/api/control" && c.body.subtype === "set_model")
      .map((c) => c.body.params.model).join();
    ev({ type: "wrapper", subtype: "posture", posture: "autoApprove", auto_count: 3 });
    await sleep(30);
    q(".posture-chip")?.click(); await sleep(40);
    out.foot = pop()?.querySelector(".bar-foot .bar-row-title")?.textContent ?? "";
    out.wantFoot = FA.barAutoCount.replace("{n}", "۳");
    pop()?.querySelector(".bar-foot")?.click(); await sleep(40);
    out.auditOpen = !!document.querySelector("dialog.picker[open]")
      && (document.querySelector("dialog.picker")?.textContent ?? "").includes(FA.autoActionsTitle);
    document.querySelector("dialog.picker")?.close?.();
    out.noChip = !document.querySelector(".auto-chip");
  }

  // «+»: files, slash, and the MCP switches.
  q(".bar-plus-btn")?.click(); await sleep(80);
  out.plusRows = pop()?.querySelectorAll(".bar-row").length ?? -1;
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
    check("the model menu numbers its rows and checks the current one",
          m.get("modelRows") == 2 and m.get("modelDigits") == "۱,۲" and m.get("modelCheck") == "v-",
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
    if m.get("barMenus"):
        check("the model menu lists the newest of each family, no notes, the description as a tip",
              m.get("primary") == "Opus 5.5|Sonnet 5.5" and m.get("notes") == 0
              and m.get("tip") == "complex work", f"{m.get('primary')} / {m.get('notes')} / {m.get('tip')}")
        check("«مدل‌های دیگر» opens the rest in a flyout beside the menu",
              m.get("flyout") == "Opus 5" and m.get("flyoutBeside"),
              f"{m.get('flyout')} / beside {m.get('flyoutBeside')}")
        check("...its bottom edge on the menu's, so it grows up and not over the bar",
              m.get("flyoutBottom") is True, str(m.get("flyoutBottom")))
        check("the «Default» alias is the model it resolves to: no row of its own, the check on that model",
              m.get("checked") == "Opus 5.5" and m.get("chipName") == "Opus 5.5",
              f"checked «{m.get('checked')}», chip «{m.get('chipName')}»")
        check("a Latin title sits at the start of its RTL row, and the current row shows only the check",
              isinstance(m.get("titleGap"), int) and m.get("titleGap") <= 16 and m.get("curDigitShown") is False,
              f"gap {m.get('titleGap')}px, digit shown {m.get('curDigitShown')}")
        check("the menu shares an edge with its chip", m.get("menuOnChip") is True, str(m.get("menuOnChip")))
        check("a flyout row picks its model", m.get("setFromFlyout") == "claude-opus-5",
              str(m.get("setFromFlyout")))
        check("the audit count is the mode menu's footer, and it opens the list; no bar chip",
              m.get("foot") == m.get("wantFoot") and m.get("auditOpen") and m.get("noChip"),
              f"«{m.get('foot')}» / list {m.get('auditOpen')} / no chip {m.get('noChip')}")
    check("the mode menu lists the four postures and a digit picks",
          m.get("modeRows") == 4 and m.get("posture") == "plan", f"{m.get('modeRows')} / {m.get('posture')}")
    check("the effort slider starts at the current level and posts a change",
          m.get("rangeStart") == "1/3" and m.get("effortPost") == "xhigh",
          f"{m.get('rangeStart')} / {m.get('effortPost')}")
    check("«+» offers files and slash commands, and lists the MCP servers",
          m.get("plusRows") == 2 and m.get("servers") == "github,playwright",
          f"{m.get('plusRows')} rows / {m.get('servers')}")
    check("a switch toggles THAT server, and the list repaints from the CLI",
          m.get("toggle") == "playwright:false" and m.get("afterToggle") == "on,off",
          f"{m.get('toggle')} / {m.get('afterToggle')}")
    check("«پیوست فایل» opens the native dialog; «فرمان‌ها» starts a slash command",
          m.get("pick") is True and m.get("slash") == "/", f"{m.get('pick')} / {m.get('slash')!r}")
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
