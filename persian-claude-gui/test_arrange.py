r"""Layout control gate (pcg-7bi, terminal edition).

The user's ask, 2026-09-29: arrange the conversations that are ALREADY open,
side by side, and resize them. Since the new-session page replaced «۱ | ۲ | ۴»
(P4) only `/split` and Alt keys did that, and the page opens NEW ones. The
button beside the bell opens a panel that:

  - says how many conversations are open, and marks how many panes show now;
  - puts more panes on screen FILLED with the open conversations not yet shown
    (a blank pane is what `/split` alone gives, and was the whole complaint);
  - takes panes away without closing anything: the conversations keep running
    in the sidebar;
  - disables a count this window has no room for, with the room as reason;
  - makes the panes the same size again (the dividers stay draggable).

Free: no CLI, no login. Every route is stubbed inside the page.

    python persian-claude-gui\test_arrange.py
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

EDITION = os.environ.get("PCG_UI", "terminal")
STATIC = HERE / EDITIONS[EDITION][0]
PROBE = STATIC / "_arrange_probe.html"

PROBE_JS = r"""
<pre id="probe-out" hidden></pre>
<script type="module">
import { applyTabs } from "/static/js/app.js";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FA = window.STRINGS;
const calls = [];
const json = (o, status = 200) => new Response(JSON.stringify(o), { status,
  headers: { "Content-Type": "application/json" } });
const TABS = ["t-1", "t-2", "t-3"].map((tab) => ({ tab, cwd: "C:/kar/mokhzan" }));
window.fetch = async (url, init) => {
  const u = String(url);
  calls.push({ url: u, body: init?.body ? JSON.parse(init.body) : null });
  if (u.startsWith("/api/projects")) return json({ projects: [] });
  if (u.startsWith("/api/tabs")) return json({ tabs: TABS, active: "t-3" });
  if (u.startsWith("/api/session")) return json({ events: [] });
  if (u.startsWith("/api/agents")) return json({ agents: [] });
  return json({ ok: true });
};
const btn = document.getElementById("btn-layout");
const panel = () => document.getElementById("layout-panel");
const count = (n) => panel().querySelector(`.ns-opt[data-key="${n}"]`);
const panes = () => document.querySelectorAll("#grid .cell").length;
const blanks = () => document.querySelectorAll("#grid .cell.blank").length;
const closes = () => calls.filter((c) => c.url.startsWith("/api/tab/close")).length;

(async () => {
 const out = {};
 try {
  await sleep(200);
  applyTabs({ tabs: TABS, active: "t-3" });
  await sleep(50);
  out.named = btn.getAttribute("aria-label") === FA.layoutButton;
  btn.click(); await sleep(30);
  out.open = panel().matches(":popover-open") && btn.getAttribute("aria-expanded") === "true";
  out.openText = panel().querySelector(".layout-open")?.textContent ?? "";
  out.wantOpenText = FA.layoutOpen.replace("{n}", (3).toLocaleString("fa-IR"));
  out.pressed1 = count(1)?.getAttribute("aria-pressed");
  out.equalOff = panel().querySelector(".layout-equal")?.disabled;

  count(3).click(); await sleep(80);
  out.panes3 = panes();
  out.blanks3 = blanks();
  out.pressed3 = count(3)?.getAttribute("aria-pressed");
  out.stillOpen = panel().matches(":popover-open");
  out.equalOn = !panel().querySelector(".layout-equal")?.disabled;
  panel().querySelector(".layout-equal").click(); await sleep(30);

  count(1).click(); await sleep(80);
  out.panes1 = panes();
  out.closes = closes();

  panel().hidePopover();
  const stage = document.getElementById("stage");
  stage.style.cssText = "width: 380px; height: 400px; flex: none";
  await sleep(50);
  btn.click(); await sleep(30);
  out.roomOff = [1, 2, 3, 4, 5, 6].filter((n) => count(n).disabled).join();
  out.roomTitle = count(2).title;
  out.faNoRoom = FA.nsNoRoom;
  document.getElementById("probe-out").textContent = "PROBE" + JSON.stringify(out) + "ENDPROBE";
 } catch (err) {
  document.getElementById("probe-out").textContent =
    "PROBE" + JSON.stringify({ error: String(err && err.stack || err), partial: out }) + "ENDPROBE";
 }
})();
</script>
"""


def write_probe() -> None:
    """The probe page IS index.html — anything else would drift away from it."""
    page = (STATIC / "index.html").read_text(encoding="utf-8")
    page = page.replace("{{VERSION}}", "9.9.9")
    marker = '<body class="app">'
    if marker not in page:
        sys.exit("index.html no longer opens with " + marker)
    page = page.replace(marker, '<body class="app" data-render-only>', 1)
    PROBE.write_text(page.replace("</body>", PROBE_JS + "\n</body>", 1), encoding="utf-8")


def checks(m: dict) -> list[tuple[str, bool, str]]:
    out: list[tuple[str, bool, str]] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        out.append((name, bool(ok), detail))

    check("the button beside the bell is named and opens the panel",
          m.get("named") and m.get("open"), f"named {m.get('named')}, open {m.get('open')}")
    check("the panel says how many conversations are open",
          m.get("openText") == m.get("wantOpenText"), f"«{m.get('openText')}»")
    check("it marks the panes shown now, and «هم‌اندازه» is off with one",
          m.get("pressed1") == "true" and m.get("equalOff") is True,
          f"pressed {m.get('pressed1')}, equalize disabled {m.get('equalOff')}")
    check("three panes show the three OPEN conversations, none blank",
          m.get("panes3") == 3 and m.get("blanks3") == 0,
          f"{m.get('panes3')} panes, {m.get('blanks3')} blank")
    check("...the panel stays open on the new count, «هم‌اندازه» now on",
          m.get("pressed3") == "true" and m.get("stillOpen") and m.get("equalOn"),
          f"pressed {m.get('pressed3')}, open {m.get('stillOpen')}, equalize {m.get('equalOn')}")
    check("back to one pane closes no conversation",
          m.get("panes1") == 1 and m.get("closes") == 0,
          f"{m.get('panes1')} pane, {m.get('closes')} closes")
    check("a count with no room is disabled, the room as its reason",
          m.get("roomOff") == "2,3,4,5,6" and m.get("roomTitle") == m.get("faNoRoom"),
          f"disabled {m.get('roomOff')} / «{m.get('roomTitle')}»")
    return out


def main() -> int:
    if EDITION != "terminal":
        print("SKIP - the layout control is the terminal edition's")
        return 0
    edge = find_edge()
    write_probe()
    try:
        proc, base, token = boot_server(edition=EDITION)
    except Exception as err:                          # noqa: BLE001
        print(f"FAIL - {err}")
        return 1
    try:
        stop = threading.Event()
        threading.Thread(target=hold_sse, args=(base, token, stop), daemon=True).start()
        url = f"{base}/static/_arrange_probe.html?t={token}"
        try:
            report = measure(edge, url, 1280, 900)
        except Exception as err:                      # noqa: BLE001
            print(f"FAIL - {err}")
            return 1
    finally:
        proc.terminate()
        PROBE.unlink(missing_ok=True)

    if report.get("error"):
        print("FAIL - the probe threw: " + str(report["error"]))
        print("  partial: " + str(report.get("partial")))
        return 1

    results = checks(report)
    for name, ok, detail in results:
        print(f"  {'OK  ' if ok else 'FAIL'} {name}" + (f"  -- {detail}" if detail else ""))
    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print(f"{'PASS' if passed == total else 'FAIL'} \u2014 {passed}/{total}")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
