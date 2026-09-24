r"""New-session page gate (BRIDGEMIND-PORT.md §D8, phase P4).

The page is the terminal edition's one way to put more than one conversation on
screen in a single action, and every step of it is a request the window
already makes elsewhere -- so what can go wrong is ORDER and ROLLBACK, not
rendering, and no other gate sees either:

  - «+ گفتگوی تازه» and Alt+N open the page over the grid, which is hidden,
    never destroyed; Esc closes it again. `/clear` does NOT open it: that is
    one fresh conversation in this folder, as in the TUI;
  - the presets set count and isolation, «جفت» locks the folder shared, and a
    folder that is not a git repository cannot choose worktrees;
  - a count that cannot launch is drawn disabled with its reason: over the
    six-conversation limit, or more panes than the window has room for;
  - launch opens the conversations one after another (worktree: "auto" when
    asked), then places them pane ۱ onwards; the reviewer's posture goes to
    plan BEFORE its first message, and its message opens with the brief;
  - a refusal part way through closes every conversation this launch opened,
    says why on the page, and sends nothing.

Free: no CLI, no login. Every route is stubbed inside the page.

    python persian-claude-gui\test_newsession.py
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
PROBE = STATIC / "_newsession_probe.html"

PROBE_JS = r"""
<pre id="probe-out" hidden></pre>
<script type="module">
import { routeEvent } from "/static/js/app.js";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FA = window.STRINGS;
const page = document.getElementById("new-session");
const stage = document.getElementById("stage");
const grid = document.getElementById("grid");

const calls = [];
const json = (o, status = 200) => new Response(JSON.stringify(o), { status,
  headers: { "Content-Type": "application/json" } });
const PROJECTS = {
  projects: [
    { path: "C:/kar/mokhzan", name: "", git: true, archived: false, sessions: [] },
    { path: "C:/kar/sade", name: "", git: false, archived: false, sessions: [] },
  ],
};
let openTabs = [];        // what /api/tabs answers
let nextTab = 1;
let failOpenAt = 0;       // the Nth open of a launch answers 409
let opensThisLaunch = 0;
window.fetch = async (url, init) => {
  const u = String(url);
  const body = init?.body ? JSON.parse(init.body) : null;
  calls.push({ url: u, body });
  if (u.startsWith("/api/projects")) return json(PROJECTS);
  if (u.startsWith("/api/tabs")) return json({ tabs: openTabs, active: openTabs[0]?.tab ?? "" });
  if (u.startsWith("/api/project/open")) {
    opensThisLaunch += 1;
    if (failOpenAt && opensThisLaunch === failOpenAt)
      return new Response("max", { status: 409 });
    const tab = "tab-" + nextTab++;
    openTabs.push({ tab, cwd: body.path });
    return json({ tab, cwd: body.path });
  }
  if (u.startsWith("/api/tab/close")) {
    openTabs = openTabs.filter((t) => t.tab !== body.tab);
    return json({ ok: true, active: "" });
  }
  if (u.startsWith("/api/agents")) return json({ agents: [] });
  return json({ ok: true });
};
const since = (mark) => calls.slice(mark);
const optOf = (seg, key) => [...page.querySelectorAll(".ns-seg")][seg]
  .querySelector(`[data-key="${key}"]`);
const preset = (key) => optOf(0, key);
const count = (n) => optOf(1, String(n));
const pressed = (seg) => [...[...page.querySelectorAll(".ns-seg")][seg].children]
  .filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.dataset.key);
const folder = () => page.querySelector(".ns-folder");
const tree = () => page.querySelectorAll(".ns-radio input")[1];
const setFolder = async (path) => {
  folder().value = path;
  folder().dispatchEvent(new Event("change"));
  await sleep(20);
};
const task = () => page.querySelector(".ns-task");
const go = () => page.querySelector(".ns-go");
const esc = () => page.dispatchEvent(new KeyboardEvent("keydown",
  { key: "Escape", bubbles: true, cancelable: true }));
const open = async () => {
  document.getElementById("btn-new").click();
  await sleep(80);
};
const cellCount = () => document.querySelectorAll("#grid .cell").length;

(async () => {
 const out = {};
 try {
  await sleep(200);
  // Seed the folder the keyboard is in, as a live system/init would.
  routeEvent({ type: "system", subtype: "init", cwd: "C:/kar/mokhzan",
               session_id: "s-0", model: "claude-opus-5-5", permissionMode: "default" });
  await sleep(30);

  // 1. The button opens it over the grid.
  await open();
  out.openShown = !page.hidden;
  out.openStage = stage.classList.contains("ns-open");
  out.gridHidden = getComputedStyle(grid).display === "none";
  out.focusInPage = page.contains(document.activeElement);
  out.folderPicked = folder().value;
  out.soloDefault = pressed(0).join() + "/" + pressed(1).join();
  out.slots0 = page.querySelectorAll(".ns-slot:not(.ns-slot-task)").length;

  // 2. Presets.
  preset("group").click(); await sleep(20);
  out.group = pressed(1).join() + "/" + (tree().checked ? "tree" : "shared");
  out.groupSlots = page.querySelectorAll(".ns-slot:not(.ns-slot-task)").length;
  preset("pair").click(); await sleep(20);
  out.pair = pressed(1).join() + "/" + (tree().checked ? "tree" : "shared")
    + "/" + (tree().disabled ? "locked" : "free");
  out.pairReviewer = page.querySelectorAll(".ns-slot-role.is-reviewer").length;
  count(3).click(); await sleep(20);
  out.touchedCustom = pressed(0).join();
  await setFolder("C:/kar/sade");
  preset("group").click(); await sleep(20);
  out.groupNoGit = (tree().checked ? "tree" : "shared") + "/" + (tree().disabled ? "off" : "on");
  out.noGitNote = page.querySelector(".ns-note")?.textContent ?? "";
  out.faNotGit = FA.nsNotGit;

  // 3. Esc closes; Alt+N opens.
  esc(); await sleep(30);
  out.escClosed = page.hidden && !stage.classList.contains("ns-open")
    && getComputedStyle(grid).display !== "none";
  document.querySelector(".input").focus();
  document.dispatchEvent(new KeyboardEvent("keydown",
    { code: "KeyN", key: "n", altKey: true, bubbles: true, cancelable: true }));
  await sleep(80);
  out.altN = !page.hidden;
  esc(); await sleep(30);

  // 4. Disabled counts: four conversations already open leaves room for two.
  openTabs = [1, 2, 3, 4].map((i) => ({ tab: "old-" + i, cwd: "C:/kar/mokhzan" }));
  const { applyTabs } = await import("/static/js/app.js");
  applyTabs({ tabs: openTabs, active: "" });
  await open();
  out.limitDisabled = [1, 2, 3, 4, 5, 6].filter((n) => count(n).disabled).join();
  out.limitTitle = count(3).title;
  out.faTooMany = FA.nsTooMany;
  esc(); await sleep(30);
  openTabs = [];
  applyTabs({ tabs: [], active: "" });
  // ...and a window too small for two panes says so, not "too many".
  stage.style.cssText = "width: 380px; height: 400px; flex: none";
  await open();
  out.roomDisabled = [1, 2, 3, 4, 5, 6].filter((n) => count(n).disabled).join();
  out.roomTitle = count(2).title;
  out.faNoRoom = FA.nsNoRoom;
  esc(); await sleep(30);
  stage.style.cssText = "";
  await sleep(30);

  // 5. A refusal part way through: all or nothing.
  await open();
  preset("group").click(); await sleep(20);
  task().value = "yek kar"; task().dispatchEvent(new Event("input"));
  failOpenAt = 3; opensThisLaunch = 0;
  let mark = calls.length;
  go().click(); await sleep(250);
  const rb = since(mark);
  out.rbOpens = rb.filter((c) => c.url.startsWith("/api/project/open")).length;
  out.rbClosed = rb.filter((c) => c.url.startsWith("/api/tab/close")).map((c) => c.body.tab).join();
  out.rbMessages = rb.filter((c) => c.url.startsWith("/api/message")).length;
  out.rbError = page.querySelector(".ns-error")?.textContent ?? "";
  out.rbStillOpen = !page.hidden;
  out.faMaxTabs = FA.maxTabs;
  out.rbLeft = openTabs.length;

  // 6. «گروه» in a git folder: four opens in worktrees, four panes, the task to each.
  failOpenAt = 0; opensThisLaunch = 0;
  mark = calls.length;
  go().click(); await sleep(400);
  const gr = since(mark);
  const opens = gr.filter((c) => c.url.startsWith("/api/project/open"));
  out.grOpens = opens.length;
  out.grWorktree = opens.every((c) => c.body.worktree === "auto" && c.body.path === "C:/kar/mokhzan");
  out.grPanes = cellCount();
  out.grClosed = page.hidden && getComputedStyle(grid).display !== "none";
  const msgs = gr.filter((c) => c.url.startsWith("/api/message"));
  out.grMsgTabs = msgs.map((c) => c.body.tab).join();
  out.grOpenTabs = openTabs.map((t) => t.tab).join();
  out.grMsgText = [...new Set(msgs.map((c) => c.body.text))].join("|");
  out.grPosture = gr.filter((c) => c.url.startsWith("/api/posture")).length;
  out.grFirstPaneFocused = document.querySelector("#grid .cell")?.classList.contains("focused");

  // 7. «جفت»: shared folder, the reviewer's posture before its message.
  await open();
  out.pairCountAfter = [1, 2, 3, 4, 5, 6].filter((n) => count(n).disabled).join();
  esc(); await sleep(30);
  openTabs = [];
  applyTabs({ tabs: [], active: "" });
  await open();
  preset("pair").click(); await sleep(20);
  task().value = "baresi kon"; task().dispatchEvent(new Event("input"));
  mark = calls.length;
  go().click(); await sleep(400);
  const pr = since(mark);
  const popens = pr.filter((c) => c.url.startsWith("/api/project/open"));
  out.prShared = popens.length === 2 && popens.every((c) => !c.body.worktree);
  const second = popens.length === 2 ? openTabs.at(-1).tab : "";
  const seq = pr.filter((c) => (c.url.startsWith("/api/posture") || c.url.startsWith("/api/message"))
    && c.body.tab === second).map((c) => c.url.split("?")[0] + ":" + (c.body.posture ?? ""));
  out.prSeq = seq.join(",");
  const rv = pr.find((c) => c.url.startsWith("/api/message") && c.body.tab === second);
  out.prBrief = !!rv && rv.body.text.startsWith(FA.presetReviewerBrief) && rv.body.text.endsWith("baresi kon");
  const first = pr.find((c) => c.url.startsWith("/api/message") && c.body.tab !== second);
  out.prBuilderText = first?.body.text ?? "";
  out.prPanes = cellCount();

  // 8. /clear is one fresh conversation here, no page.
  const input = document.querySelector("#grid .cell.focused .input");
  mark = calls.length;
  input.value = "/clear";
  document.querySelector("#grid .cell.focused .composer").requestSubmit();
  await sleep(120);
  out.clearNoPage = page.hidden;
  out.clearOpened = since(mark).filter((c) => c.url.startsWith("/api/project/open"))
    .map((c) => c.body.path).join();

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

    check("«+ گفتگوی تازه» opens the page over a hidden (not removed) grid",
          m.get("openShown") and m.get("openStage") and m.get("gridHidden")
          and m.get("focusInPage"),
          f"shown {m.get('openShown')}, stage {m.get('openStage')}, "
          f"grid hidden {m.get('gridHidden')}, focus in page {m.get('focusInPage')}")
    check("the folder starts as the one the keyboard is in",
          m.get("folderPicked") == "C:/kar/mokhzan", str(m.get("folderPicked")))
    check("the page opens on «تنها»: one conversation, one slot",
          m.get("soloDefault") == "solo/1" and m.get("slots0") == 1,
          f"{m.get('soloDefault')} / {m.get('slots0')} slots")
    check("«گروه» in a git folder is four worktrees",
          m.get("group") == "4/tree" and m.get("groupSlots") == 4,
          f"{m.get('group')} / {m.get('groupSlots')} slots")
    check("«جفت» is two, shared and locked, with one reviewer",
          m.get("pair") == "2/shared/locked" and m.get("pairReviewer") == 1,
          f"{m.get('pair')} / {m.get('pairReviewer')} reviewer")
    check("touching a field by hand makes the preset «دلخواه»",
          m.get("touchedCustom") == "custom", str(m.get("touchedCustom")))
    check("a folder that is not a git repo cannot choose worktrees, and says so",
          m.get("groupNoGit") == "shared/off" and m.get("noGitNote") == m.get("faNotGit"),
          f"{m.get('groupNoGit')} / «{m.get('noGitNote')}»")
    check("Esc closes the page and gives the grid back", m.get("escClosed"))
    check("Alt+N opens it from the prompt", m.get("altN"))
    check("with four open, counts over six are disabled with the limit as reason",
          m.get("limitDisabled") == "3,4,5,6" and m.get("limitTitle") == m.get("faTooMany"),
          f"disabled {m.get('limitDisabled')} / «{m.get('limitTitle')}»")
    check("a window with no room for two panes disables 2+ with the room as reason",
          m.get("roomDisabled") == "2,3,4,5,6" and m.get("roomTitle") == m.get("faNoRoom"),
          f"disabled {m.get('roomDisabled')} / «{m.get('roomTitle')}»")
    check("a 409 on the third open closes the two it opened and sends nothing",
          m.get("rbOpens") == 3 and m.get("rbClosed") == "tab-1,tab-2"
          and m.get("rbMessages") == 0 and m.get("rbLeft") == 0,
          f"opens {m.get('rbOpens')}, closed «{m.get('rbClosed')}», "
          f"messages {m.get('rbMessages')}, left {m.get('rbLeft')}")
    check("...and says why on the page, which stays open",
          m.get("rbStillOpen") and m.get("rbError") == m.get("faMaxTabs"),
          f"«{m.get('rbError')}»")
    check("«گروه» opens four, each with worktree: auto in the chosen folder",
          m.get("grOpens") == 4 and m.get("grWorktree"),
          f"opens {m.get('grOpens')}, worktree {m.get('grWorktree')}")
    check("...into four panes, the page closed and pane ۱ focused",
          m.get("grPanes") == 4 and m.get("grClosed") and m.get("grFirstPaneFocused"),
          f"panes {m.get('grPanes')}, closed {m.get('grClosed')}, "
          f"focused {m.get('grFirstPaneFocused')}")
    check("...the task goes to each of them in slot order, unchanged, no posture",
          m.get("grMsgTabs") == m.get("grOpenTabs") and m.get("grMsgText") == "yek kar"
          and m.get("grPosture") == 0,
          f"{m.get('grMsgTabs')} vs {m.get('grOpenTabs')} / «{m.get('grMsgText')}» / "
          f"posture {m.get('grPosture')}")
    check("the four it opened count against the limit at once",
          m.get("pairCountAfter") == "3,4,5,6", str(m.get("pairCountAfter")))
    check("«جفت» opens both in the same folder, no worktree", m.get("prShared"))
    check("the reviewer is put in plan posture BEFORE its first message",
          m.get("prSeq") == "/api/posture:plan,/api/message:", str(m.get("prSeq")))
    check("the reviewer's message opens with the brief; the builder's is the task",
          m.get("prBrief") and m.get("prBuilderText") == "baresi kon",
          f"brief {m.get('prBrief')} / builder «{m.get('prBuilderText')}»")
    check("/clear is one fresh conversation in this folder, not the page",
          m.get("clearNoPage") and m.get("clearOpened") == "C:/kar/mokhzan",
          f"page hidden {m.get('clearNoPage')}, opened «{m.get('clearOpened')}»")
    return out


def main() -> int:
    if EDITION != "terminal":
        print("SKIP - the new-session page is the terminal edition's (BRIDGEMIND-PORT.md §D0)")
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
        url = f"{base}/static/_newsession_probe.html?t={token}"
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
