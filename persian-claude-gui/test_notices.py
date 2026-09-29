r"""Notification-centre gate (BRIDGEMIND-PORT.md §D9, phase P5).

What the bell may and may not say, driven through the real `routeEvent` in
the shipping `index.html`:

  - a turn that ends in a conversation you are not looking at makes one
    notice; the conversation in the focused pane of a visible window makes
    none; a REPLAYED result makes none (a reload must not announce history);
  - a permission request makes a "needs" notice and turns the count to the
    waiting colour; a second request from the same conversation is the same
    news; a failed turn is "failed"; a stop is nothing;
  - the focused pane of a HIDDEN window still makes one (you were not there);
  - Alt+B opens the panel, newest first; a row jumps to its conversation,
    focuses that pane, flashes it once and marks the notice read;
  - a notice whose conversation was closed is drawn disabled with the reason;
  - «همه خوانده شد» empties the count; the OS notification's click jumps.

Free: no CLI, no login.

    python persian-claude-gui\test_notices.py
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
PROBE = STATIC / "_notices_probe.html"

PROBE_JS = r"""
<pre id="probe-out" hidden></pre>
<script type="module">
import { routeEvent, applyTabs } from "/static/js/app.js";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FA = window.STRINGS;
const json = (o) => new Response(JSON.stringify(o), { status: 200,
  headers: { "Content-Type": "application/json" } });
window.fetch = async (url) => {
  const u = String(url);
  if (u.startsWith("/api/projects")) return json({ projects: [] });
  if (u.startsWith("/api/agents")) return json({ agents: [] });
  return json({ ok: true });
};
let hidden = false;
Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });

const bell = document.getElementById("btn-bell");
const count = () => bell.querySelector(".bell-count");
const shown = () => (count().hidden ? "" : count().textContent);
const panel = () => document.getElementById("bell-panel");
const rows = () => [...panel().querySelectorAll(".bell-row")];
const T = (tab) => ({ tab, cwd: "C:/kar/" + tab, session_id: "" });
const done = (tab, extra = {}) => routeEvent({ tab, type: "result", subtype: "success",
  is_error: false, total_cost_usd: 0, duration_ms: 5, ...extra });
const ask = (tab, id) => routeEvent({ tab, type: "wrapper", subtype: "permission_request",
  request_id: id, tool_name: "Bash", tool_use_id: "u" + id, tool_input: { command: "ls" } });
const altB = () => document.dispatchEvent(new KeyboardEvent("keydown",
  { code: "KeyB", key: "b", altKey: true, bubbles: true, cancelable: true }));
const cellOfTab = (tab) => [...document.querySelectorAll("#grid .cell")]
  .findIndex((c) => c.querySelector(".log") && c.dataset.tab === tab);

(async () => {
 const out = {};
 try {
  await sleep(200);
  applyTabs({ tabs: [T("t1"), T("t2"), T("t3")], active: "t1" });
  await sleep(50);
  out.start = shown();

  done("t1");
  out.focusedVisible = shown();
  done("t2");
  out.hiddenPane = shown();
  done("t3", { replayed: true });
  out.replayed = shown();
  done("t3", { subtype: "error_during_execution", is_error: true,
               terminal_reason: "aborted_streaming" });
  out.stopped = shown();
  ask("t3", "r1");
  out.needs = shown() + "/" + bell.classList.contains("needs");
  ask("t3", "r2");
  out.needsAgain = shown();
  done("t3", { is_error: true, result: "nashod" });
  out.failed = shown();
  hidden = true;
  done("t1");
  out.hiddenWindow = shown();
  hidden = false;

  altB();
  await sleep(50);
  out.panelOpen = panel().matches(":popover-open");
  out.kinds = rows().map((r) => r.dataset.kind).join(",");
  out.unreadRows = rows().filter((r) => r.classList.contains("unread")).length;
  const pr = panel().getBoundingClientRect();
  const side = document.getElementById("sidebar").getBoundingClientRect();
  out.panelBeside = pr.right <= side.left + 1 && pr.width > 0 && pr.left >= 0;
  out.panelOnScreen = pr.top >= 0 && pr.bottom <= innerHeight;

  // Jump to t2's notice.
  const t2row = rows().find((r) => r.dataset.kind === "done"
    && r.querySelector(".bell-title").textContent && r !== rows()[0]);
  t2row.click();
  await sleep(80);
  out.panelClosed = !panel().matches(":popover-open");
  const focusedCell = document.querySelector("#grid .cell.focused");
  out.flash = !!focusedCell?.classList.contains("flash");
  out.afterJump = shown();
  await sleep(800);
  out.flashGone = !focusedCell?.classList.contains("flash");

  // Close t3: its rows are drawn disabled with the reason.
  routeEvent({ tab: "t3", type: "wrapper", subtype: "closed" });
  applyTabs({ tabs: [T("t1"), T("t2")], active: "t2" });
  await sleep(30);
  altB();
  await sleep(50);
  const dead = rows().filter((r) => r.disabled);
  out.deadRows = dead.length;
  out.deadText = dead[0]?.querySelector(".bell-what")?.textContent ?? "";
  out.faClosed = FA.noticeClosed;
  panel().querySelector(".bell-allread").click();
  await sleep(20);
  out.allRead = shown();
  out.allReadRows = rows().filter((r) => r.classList.contains("unread")).length;
  altB();
  await sleep(30);
  out.altBCloses = !panel().matches(":popover-open");

  // The OS notification's click: an event naming the tab.
  hidden = true;
  done("t1");
  hidden = false;
  window.dispatchEvent(new CustomEvent("pcg:jump", { detail: { tab: "t1" } }));
  await sleep(80);
  out.osJump = document.querySelector("#grid .cell.focused")?.classList.contains("flash");
  out.osJumpRead = shown();

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

    check("the bell starts with no count", m.get("start") == "", repr(m.get("start")))
    check("a turn ending in the focused pane of a visible window is no news",
          m.get("focusedVisible") == "", repr(m.get("focusedVisible")))
    check("a turn ending in a conversation you are not looking at is one notice",
          m.get("hiddenPane") == "۱", repr(m.get("hiddenPane")))
    check("a replayed result makes none", m.get("replayed") == "۱", repr(m.get("replayed")))
    check("a stopped turn makes none", m.get("stopped") == "۱", repr(m.get("stopped")))
    check("a permission request is a «needs» notice, in the waiting colour",
          m.get("needs") == "۲/true", repr(m.get("needs")))
    check("a second request from the same conversation is the same news",
          m.get("needsAgain") == "۲", repr(m.get("needsAgain")))
    check("a failed turn is a notice", m.get("failed") == "۳", repr(m.get("failed")))
    check("the focused pane of a HIDDEN window is news",
          m.get("hiddenWindow") == "۴", repr(m.get("hiddenWindow")))
    check("Alt+B opens the panel, newest first",
          m.get("panelOpen") and m.get("kinds") == "done,failed,needs,done"
          and m.get("unreadRows") == 4,
          f"open {m.get('panelOpen')}, kinds {m.get('kinds')}, unread {m.get('unreadRows')}")
    check("the panel hangs beside the sidebar, on screen",
          m.get("panelBeside") and m.get("panelOnScreen"),
          f"beside {m.get('panelBeside')}, on screen {m.get('panelOnScreen')}")
    check("a row jumps: panel closed, that pane focused and flashed, notice read",
          m.get("panelClosed") and m.get("flash") and m.get("afterJump") == "۳",
          f"closed {m.get('panelClosed')}, flash {m.get('flash')}, count {m.get('afterJump')!r}")
    check("the flash is gone after 700 ms", m.get("flashGone"))
    check("a closed conversation's notices are disabled, with the reason",
          m.get("deadRows") == 2 and m.get("deadText") == m.get("faClosed"),
          f"{m.get('deadRows')} rows / «{m.get('deadText')}»")
    check("«همه خوانده شد» empties the count",
          m.get("allRead") == "" and m.get("allReadRows") == 0,
          f"{m.get('allRead')!r} / {m.get('allReadRows')} unread rows")
    check("Alt+B closes it again", m.get("altBCloses"))
    check("the OS notification's click jumps to its conversation and reads it",
          m.get("osJump") and m.get("osJumpRead") == "",
          f"flash {m.get('osJump')}, count {m.get('osJumpRead')!r}")
    return out


def main() -> int:
    if EDITION != "terminal":
        print("SKIP - the bell is the terminal edition's (BRIDGEMIND-PORT.md §D0)")
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
        url = f"{base}/static/_notices_probe.html?t={token}"
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
