r"""Changes panel gate (BRIDGEMIND-PORT.md §D12, phase P8).

The panel reads git through one route and renders what comes back; this gate
stubs the route and drives the shipping `index.html`:

  - the pane menu opens it in place of the transcript (hidden, not removed),
    and Esc gives the transcript back;
  - the files this conversation's own edit tools touched are listed first,
    matched against git's repo-relative paths from the absolute Windows paths
    the tools were given; everything else is folded below;
  - a row's path is the LTR-isolated `.path`, its `+N −M` LTR-isolated too;
  - opening a row asks for THAT file by the name the listing returned and
    renders git's diff as the same `.diff` rows a tool card uses;
  - «not a repository», «no git» and «too large» each say so in Persian;
  - the state line's «N فایل تغییر کرد» opens the panel.

Free: no CLI, no git, no login.

    python persian-claude-gui\test_changes.py
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
PROBE = STATIC / "_changes_probe.html"

PROBE_JS = r"""
<pre id="probe-out" hidden></pre>
<script type="module">
import { routeEvent, applyTabs, cells } from "/static/js/app.js";
import { setStatus } from "/static/js/render.js";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FA = window.STRINGS;
const calls = [];
const json = (o, status = 200) => new Response(JSON.stringify(o), { status,
  headers: { "Content-Type": "application/json" } });
let listing = { state: "ok", root: "C:/kar/proje", files: [
  { path: "src/a.txt", status: "M", add: 2, del: 1 },
  { path: "یادداشت.txt", status: "?", add: 1, del: 0 },
  { path: "big.txt", status: "M", add: 9000, del: 0 },
] };
window.fetch = async (url) => {
  const u = String(url);
  calls.push(u);
  if (u.startsWith("/api/changes")) {
    const q = new URL(u, location.href).searchParams;
    const file = q.get("file");
    if (!file) return json(listing);
    if (file === "big.txt") return json({ state: "too-large", lines: 9001 });
    return json({ state: "ok", path: file, diff:
      "--- a/src/a.txt\n+++ b/src/a.txt\n@@ -3,2 +3,3 @@\n const x = 1;\n-old\n+این خط فارسی است\n+const y = 2;\n" });
  }
  if (u.startsWith("/api/projects")) return json({ projects: [] });
  return json({ ok: true });
};

(async () => {
 const out = {};
 try {
  await sleep(200);
  applyTabs({ tabs: [{ tab: "t1", cwd: "C:/kar/proje", session_id: "" }], active: "t1" });
  await sleep(40);
  routeEvent({ tab: "t1", type: "assistant", message: { content: [{ type: "tool_use",
    id: "e1", name: "Edit", input: { file_path: "C:\\kar\\proje\\src\\a.txt",
    old_string: "old", new_string: "new" } }] } });
  const cell = document.querySelector("#grid .cell");
  const log = cell.querySelector(".log");
  const panel = cell.querySelector(".changes");

  // Open from the pane menu.
  cell.querySelector(".pane-menu").click();
  await sleep(30);
  const item = [...document.querySelectorAll(".kebab-menu:popover-open .kebab-item")]
    .find((b) => b.textContent.includes(FA.paneChanges));
  out.menuItem = !!item;
  item?.click();
  await sleep(80);
  out.opened = !panel.hidden && getComputedStyle(log).display === "none" && !!log.isConnected;
  out.title = panel.querySelector(".ch-title")?.textContent ?? "";
  out.faTitle = FA.chTitleCount.replace("{n}", "۳");
  const groups = [...panel.querySelectorAll(".ch-group")];
  out.groups = groups.map((g) => g.querySelector(".ch-group-name").textContent + ":" +
    g.querySelectorAll(".ch-file").length + ":" + (g.open ? "open" : "shut")).join("|");
  out.faGroups = FA.chMine + ":1:open|" + FA.chOther + ":2:shut";
  const row = groups[0]?.querySelector(".ch-file");
  const path = row?.querySelector("summary .path");
  out.pathLtr = !!path && getComputedStyle(path).direction === "ltr" &&
    getComputedStyle(path).unicodeBidi === "isolate" && path.textContent === "src/a.txt";
  const stat = row?.querySelector(".diff-stat");
  out.stat = stat ? stat.textContent + "/" + getComputedStyle(stat).direction : "";
  // Geometry, not text: a textContent check passed while a count drew as
  // «1- 2+» once (wiki/rtl-rendering-notes.md). The plus must sit LEFT of the 1.
  const at = (el, i) => { const r = document.createRange(); r.setStart(el, i); r.setEnd(el, i + 1);
                          return r.getBoundingClientRect().left; };
  const addNode = stat?.querySelector(".d-add")?.firstChild;
  const delNode = stat?.querySelector(".d-del")?.firstChild;
  out.statOrder = !!addNode && !!delNode && at(addNode, 0) < at(addNode, 1)
    && at(addNode, 1) < at(delNode, 0) && at(delNode, 0) < at(delNode, 1);

  // Open the row: that file, by its listed name, as .diff rows.
  const mark = calls.length;
  row.open = true;
  await sleep(80);
  out.askedFile = calls.slice(mark).some((u) => u.includes("file=src%2Fa.txt"));
  const lines = [...row.querySelectorAll(".diff .dl")];
  out.rows = lines.map((l) => l.classList[1]).join();
  const fa = lines[2]?.querySelector(".dt");
  out.faLine = fa ? getComputedStyle(fa).direction : "";
  // Too large says how large.
  const bigRow = [...panel.querySelectorAll(".ch-file")].find((r) =>
    r.querySelector(".path")?.textContent === "big.txt");
  bigRow.open = true;
  await sleep(80);
  out.big = bigRow.querySelector(".ch-state")?.textContent ?? "";
  out.faBig = FA.chTooLarge.replace("{n}", (9001).toLocaleString("fa-IR"));

  // Esc gives the transcript back.
  panel.querySelector(".ch-back").focus();
  panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  await sleep(30);
  out.escClosed = panel.hidden && getComputedStyle(log).display !== "none";

  // Not a repository / no git.
  listing = { state: "no-repo" };
  cells[0].changes.open();
  await sleep(60);
  out.noRepo = panel.querySelector(".ch-state")?.textContent ?? "";
  listing = { state: "no-git" };
  panel.querySelector(".ch-refresh").click();
  await sleep(60);
  out.noGit = panel.querySelector(".ch-state")?.textContent ?? "";
  cells[0].changes.close();
  out.faNoRepo = FA.chNoRepo;
  out.faNoGit = FA.chNoGit;

  // The state line's count opens it.
  setStatus({ changes: 2 });
  const count = cell.querySelector(".statusline .sl-changes");
  out.count = count?.textContent ?? "";
  out.faCount = FA.slChanges.replace("{n}", "۲");
  listing = { state: "ok", root: "C:/kar/proje", files: [] };
  count?.click();
  await sleep(60);
  out.countOpens = !panel.hidden;
  out.none = panel.querySelector(".ch-state")?.textContent ?? "";
  out.faNone = FA.chNone;

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

    check("the pane menu offers the panel", m.get("menuItem"))
    check("it opens in place of the transcript, which is hidden, not removed",
          m.get("opened"))
    check("its title counts the files", m.get("title") == m.get("faTitle"),
          f"«{m.get('title')}»")
    check("this conversation's own files first and open, the rest folded below",
          m.get("groups") == m.get("faGroups"), f"{m.get('groups')}")
    check("a row's path is the LTR-isolated .path", m.get("pathLtr"))
    check("its +N −M reads left to right, measured", m.get("stat") == "+2−1/ltr"
          and m.get("statOrder"), f"{m.get('stat')!r} / order {m.get('statOrder')}")
    check("opening a row asks for that file by its listed name", m.get("askedFile"))
    check("...and draws git's diff as the tool card's .diff rows",
          m.get("rows") == "same,del,add,add", repr(m.get("rows")))
    check("rule 8: a Persian line in it resolves RTL", m.get("faLine") == "rtl",
          repr(m.get("faLine")))
    check("a diff too large to show says how large", m.get("big") == m.get("faBig"),
          f"«{m.get('big')}»")
    check("Esc gives the transcript back", m.get("escClosed"))
    check("a folder that is not a repository says so", m.get("noRepo") == m.get("faNoRepo"),
          f"«{m.get('noRepo')}»")
    check("no git on the machine says so", m.get("noGit") == m.get("faNoGit"),
          f"«{m.get('noGit')}»")
    check("the state line counts changed files", m.get("count") == m.get("faCount"),
          f"«{m.get('count')}»")
    check("...and the count opens the panel", m.get("countOpens")
          and m.get("none") == m.get("faNone"), f"«{m.get('none')}»")
    return out


def main() -> int:
    if EDITION != "terminal":
        print("SKIP - the Changes panel is the terminal edition's (BRIDGEMIND-PORT.md §D0)")
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
        url = f"{base}/static/_changes_probe.html?t={token}"
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
