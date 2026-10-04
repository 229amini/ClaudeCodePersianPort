r"""VS Code extension parity gate (pcg-ahh, terminal edition).

The user's ask, 2026-10-04, after the app was compared with the Claude Code
VS Code extension: build the five gaps that matter most, in order.

  1. session search and rename (the sidebar);
  2. «۲ از ۵» on stacked permission requests (the Questions row is a spec case);

Each later feature adds its section here. Free: no CLI, no login. Every route
is stubbed inside the real index.html.

    python persian-claude-gui\test_parity.py
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
PROBE = STATIC / "_parity_probe.html"

PROBE_JS = r"""
<pre id="probe-out" hidden></pre>
<script type="module">
import { refreshProjects } from "/static/js/chrome.js";
import { routeEvent, applyTabs } from "/static/js/app.js";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FA = window.STRINGS;
const calls = [];
const json = (o, status = 200) => new Response(JSON.stringify(o), { status,
  headers: { "Content-Type": "application/json" } });
const NOW = Date.now() / 1000;
const PROJECTS = { current_cwd: "C:/kar/alef", current_session: null, projects: [
  { path: "C:/kar/alef", modified: NOW, sessions: [
    { session_id: "a1", preview: "fix the login page", title: "رفع صفحهٔ ورود", modified: NOW - 60 },
    { session_id: "a2", preview: "گزارش دیروز را بخوان", title: null, modified: NOW - 7200 },
  ] },
  { path: "C:/kar/be", modified: NOW - 100, archived: true, sessions: [
    { session_id: "b1", preview: "x", title: "درست کردن نیم‌فاصله", modified: NOW - 30 },
  ] },
] };
window.fetch = async (url, init) => {
  const u = String(url);
  calls.push({ url: u, body: init?.body ? JSON.parse(init.body) : null });
  if (u.startsWith("/api/projects")) return json(PROJECTS);
  if (u.startsWith("/api/tabs")) return json({ tabs: [], active: "" });
  if (u.startsWith("/api/session/rename")) return json({ ok: true, title: "x" });
  if (u.startsWith("/api/session")) return json({ events: [] });
  if (u.startsWith("/api/agents")) return json({ agents: [] });
  return json({ ok: true });
};
const field = document.getElementById("side-search");
const nav = document.getElementById("projects");
const type = async (text) => {
  field.value = text;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  await sleep(20);
};
const hits = () => [...nav.querySelectorAll(".search-hits li[data-session]")]
  .map((li) => li.dataset.session).join();

(async () => {
 const out = {};
 try {
  await sleep(150);
  refreshProjects();
  await sleep(600);
  // --- 1. search ---
  out.placeholder = field?.placeholder === FA.searchSessions
    && field.getAttribute("aria-label") === FA.searchSessions;
  out.sectionsBefore = nav.querySelectorAll(".proj").length;
  await type("نیمفاصله");
  out.zwnjHit = hits();
  out.where = nav.querySelector('.search-hits li[data-session="b1"] .sess-proj')?.title;
  await type("ديروز");                       // Arabic yeh, as an Arabic keyboard types it
  out.yehHit = hits();
  await type("LOGIN");
  out.caseHit = hits();
  await type("صفحه");
  out.titleHit = hits();
  await type("هیچ‌چیز-نیست");
  out.emptyText = nav.querySelector(".search-hits .empty")?.textContent;
  field.focus();
  field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await sleep(20);
  out.cleared = field.value === "" && !nav.querySelector(".search-hits")
    && nav.querySelectorAll(".proj").length === out.sectionsBefore;
  // --- 1. rename ---
  await type("صفحه");
  const row = nav.querySelector('li[data-session="a1"]');
  row.querySelector(".kebab-btn").click();
  await sleep(30);
  const item = [...row.querySelectorAll(".kebab-item")]
    .find((b) => b.textContent === FA.renameSession);
  out.renameItem = !!item;
  item?.click();
  await sleep(30);
  const edit = row.querySelector(".sess-rename");
  out.editValue = edit?.value;
  out.btnHidden = row.querySelector(".sess")?.hidden;
  edit.value = "  نام  تازه ";
  edit.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await sleep(80);
  const posted = calls.filter((c) => c.url.startsWith("/api/session/rename"));
  out.renameBody = posted.length === 1 ? posted[0].body : posted.length;
  out.reloaded = calls.filter((c) => c.url.startsWith("/api/projects")).length;
  // Esc cancels without a request.
  const row2 = nav.querySelector('li[data-session="a1"]');
  row2.querySelector(".kebab-btn").click(); await sleep(30);
  [...row2.querySelectorAll(".kebab-item")].find((b) => b.textContent === FA.renameSession)?.click();
  await sleep(30);
  const edit2 = row2.querySelector(".sess-rename");
  edit2.value = "نه";
  edit2.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await sleep(30);
  out.escNoPost = calls.filter((c) => c.url.startsWith("/api/session/rename")).length === 1
    && !row2.querySelector(".sess-rename") && row2.querySelector(".sess")?.hidden === false;
  // --- 2. «N از M» on stacked permission requests ---
  applyTabs({ tabs: [{ tab: "t1", cwd: "C:/kar/alef", session_id: "" }], active: "t1" });
  await sleep(60);
  const ask = (id) => routeEvent({ tab: "t1", type: "wrapper", subtype: "permission_request",
    request_id: id, tool_name: "Bash", tool_use_id: "u" + id, tool_input: { command: "ls " + id } });
  const dlg = () => document.querySelector("#grid .cell .perm");
  const countText = () => { const c = dlg()?.querySelector(".perm-count");
    return !c || c.hidden ? "" : c.textContent; };
  const esc = async () => { dlg().dispatchEvent(new KeyboardEvent("keydown",
    { key: "Escape", bubbles: true, cancelable: true })); await sleep(40); };
  ask("p1"); await sleep(30);
  out.lone = countText();
  ask("p2"); ask("p3"); await sleep(30);
  out.count1 = countText();
  await esc();
  out.count2 = countText();
  await esc();
  out.count3 = countText();
  await esc();
  out.closed = dlg()?.open === false;
  ask("p4"); await sleep(30);
  out.fresh = countText();
  await esc();
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

    # 1. search and rename
    check("the sidebar has a search field named in Persian", m.get("placeholder"))
    check("a search ignores the half-space and finds an archived project's conversation",
          m.get("zwnjHit") == "b1" and m.get("where") == "C:/kar/be",
          f"hits {m.get('zwnjHit')!r}, project {m.get('where')!r}")
    check("an Arabic ي finds a Persian ی, in the first prompt when there is no title",
          m.get("yehHit") == "a2", f"hits {m.get('yehHit')!r}")
    check("case does not matter, and the first prompt is searched beside the title",
          m.get("caseHit") == "a1" and m.get("titleHit") == "a1",
          f"{m.get('caseHit')!r} / {m.get('titleHit')!r}")
    check("no match says so", m.get("emptyText") == "گفتگویی پیدا نشد", f"«{m.get('emptyText')}»")
    check("Esc empties the field and the project lists come back", m.get("cleared"))
    check("a conversation's ⋯ menu offers «تغییر نام»", m.get("renameItem"))
    check("...which edits in place, starting from the current name",
          m.get("editValue") == "رفع صفحهٔ ورود" and m.get("btnHidden") is True,
          f"«{m.get('editValue')}», row hidden {m.get('btnHidden')}")
    body = m.get("renameBody")
    check("Enter posts the trimmed name for THIS conversation in THIS project, then reloads",
          isinstance(body, dict) and body.get("session_id") == "a1"
          and body.get("title") == "نام  تازه" and body.get("path") == "C:/kar/alef"
          and (m.get("reloaded") or 0) >= 2,
          f"{body}, /api/projects x{m.get('reloaded')}")
    check("Esc cancels the edit without a request", m.get("escNoPost"))

    # 2. N of M
    check("a lone permission request shows no count", m.get("lone") == "", f"«{m.get('lone')}»")
    check("stacked requests count «۱ از ۳», then «۲ از ۳», «۳ از ۳» as each is answered",
          (m.get("count1"), m.get("count2"), m.get("count3")) == ("۱ از ۳", "۲ از ۳", "۳ از ۳"),
          f"{m.get('count1')!r} {m.get('count2')!r} {m.get('count3')!r}")
    check("...the run ends with the last one, and the next request starts alone",
          m.get("closed") and m.get("fresh") == "", f"closed {m.get('closed')}, «{m.get('fresh')}»")
    return out


def main() -> int:
    if EDITION != "terminal":
        print("SKIP - these parity features are the terminal edition's")
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
        url = f"{base}/static/_parity_probe.html?t={token}"
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
