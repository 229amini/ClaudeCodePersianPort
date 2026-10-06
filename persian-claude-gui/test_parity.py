r"""VS Code extension parity gate (pcg-ahh; both editions since pcg-cpn).

The user's ask, 2026-10-04, after the app was compared with the Claude Code
VS Code extension: build the five gaps that matter most, in order.

  1. session search and rename (the sidebar);
  2. «۲ از ۵» on stacked permission requests (the Questions row is a spec case);
  3. the window's approve-all posture is no longer named «خودکار», the name of
     the CLI's own Auto mode, which it is not;
  4. a new conversation from a message: through an answer, or from before
     something the person said with its words back in the prompt;
  5. Focus view: each turn's steps behind one row (Ctrl+Alt+F, /focus).

Every section runs on both editions (PCG_UI=web|terminal, terminal by default),
and focus.js is one file in two places. Free: no CLI, no login. Every route is
stubbed inside the real index.html.

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
import { routeEvent, applyTabs, cellOf, switchTab } from "/static/js/app.js";
// `/focus` goes through each edition's own command path: the terminal's
// command table, the web composer's local verbs (typed and sent).
const commands = await import("/static/js/commands.js").catch(() => null);
const runFocus = async (cell) => {
  if (commands) return commands.runWindowCommand("focus", "", cell);
  const box = cell.root.querySelector("textarea.input");
  box.value = "/focus";
  box.dispatchEvent(new Event("input", { bubbles: true }));
  box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
};
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
  if (u.startsWith("/api/tabs")) return json({ tabs: TABS_NOW, active: TABS_NOW.at(-1)?.tab ?? "" });
  if (u.startsWith("/api/session/fork")) {
    const b = JSON.parse(init.body);
    const tab = "fork-" + (++forks);
    TABS_NOW.push({ tab, cwd: "C:/kar/alef", session_id: "" });
    return json({ ok: true, tab, forked_from: "s-src",
                  at: b.before ? (b.at === "u2" ? "a1" : null) : b.at });
  }
  if (u.startsWith("/api/session?")) return json({ events: HISTORY });
  if (u.startsWith("/api/session/rename")) return json({ ok: true, title: "x" });
  if (u.startsWith("/api/session")) return json({ events: [] });
  if (u.startsWith("/api/agents")) return json({ agents: [] });
  return json({ ok: true });
};
const TABS_NOW = [];
let forks = 0;
const say = (uuid, text) => ({ type: "user", uuid, timestamp: "2026-10-04T10:00:00Z",
  message: { content: [{ type: "text", text }] } });
const answer = (uuid, text) => ({ type: "assistant", uuid, timestamp: "2026-10-04T10:00:05Z",
  message: { content: [{ type: "text", text }] } });
const HISTORY = [say("u1", "پرسش یکم"), answer("a1", "پاسخ یکم"),
                 say("u2", "پرسش دوم"), answer("a2", "پاسخ دوم")];
const field = document.getElementById("side-search");
const nav = document.getElementById("projects");
const type = async (text) => {
  field.value = text;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  await sleep(20);
};
// The row's ⋯: `.kebab-btn` in the terminal edition, its accessible name in the web one.
const kebabOf = (row) => row.querySelector(".kebab-btn")
  ?? [...row.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === FA.moreActions);
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
  kebabOf(row).click();
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
  kebabOf(row2).click(); await sleep(30);
  [...row2.querySelectorAll(".kebab-item")].find((b) => b.textContent === FA.renameSession)?.click();
  await sleep(30);
  const edit2 = row2.querySelector(".sess-rename");
  edit2.value = "نه";
  edit2.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await sleep(30);
  // --- 4. a new conversation from a message ---
  TABS_NOW.splice(0, TABS_NOW.length, { tab: "t9", cwd: "C:/kar/alef", session_id: "s-src" });
  applyTabs({ tabs: TABS_NOW, active: "t9" });
  await sleep(80);
  for (const ev of HISTORY) {
    if (ev.type === "user") routeEvent({ tab: "t9", type: "wrapper", subtype: "user_echo",
      uuid: ev.uuid, text: ev.message.content[0].text, timestamp: ev.timestamp });
    else {
      routeEvent({ tab: "t9", ...ev });
      routeEvent({ tab: "t9", type: "result", subtype: "success", is_error: false,
                   total_cost_usd: 0, duration_ms: 5 });
      routeEvent({ tab: "t9", type: "command_lifecycle", state: "completed",
                   command_uuid: HISTORY[HISTORY.indexOf(ev) - 1].uuid });
    }
  }
  await sleep(60);
  const logOf = (tab) => cellOf(tab)?.root.querySelector(".log");
  const src = () => logOf("t9");
  const forkBtn = (uuid) => src()?.querySelector(`[data-uuid="${uuid}"] > .msg-acts .msg-fork`);
  out.forkTitles = [forkBtn("a1")?.title, forkBtn("u2")?.title];
  out.forkLabelled = forkBtn("a1")?.getAttribute("aria-label") === FA.markFork;
  out.forkText = forkBtn("a1")?.textContent ?? null;
  forkBtn("a1")?.click();
  await sleep(250);
  const posts = () => calls.filter((c) => c.url.startsWith("/api/session/fork"));
  out.forkBody1 = posts()[0]?.body;
  const newLog = () => logOf("fork-1");
  const said = (log) => [...(log?.querySelectorAll(".msg.user, .msg.assistant") ?? [])]
    .filter((m) => !m.classList.contains("meta")).map((m) => m.dataset.uuid ?? "").join();
  out.fork1Rows = said(newLog());
  out.fork1Note = !!newLog()?.querySelector(".msg.meta") &&
    newLog().textContent.includes(FA.forkDone);
  await switchTab("t9");
  await sleep(80);
  out.srcKept = said(src());
  // From before something the person said: the turns before it, its words in the prompt.
  forkBtn("u2")?.click();
  await sleep(250);
  out.forkBody2 = posts()[1]?.body;
  out.fork2Rows = said(logOf("fork-2"));
  out.fork2Draft = cellOf("fork-2")?.root.querySelector("textarea.input")?.value;
  // --- 5. Focus view ---
  await switchTab("t9");
  await sleep(60);
  const T = "t9";
  const turn = async (uuid, text, parts) => {
    routeEvent({ tab: T, type: "wrapper", subtype: "user_echo", uuid, text });
    for (const part of parts) {
      if (part.result) routeEvent({ tab: T, type: "user", message: { content: [
        { type: "tool_result", tool_use_id: part.result, content: "ok" }] } });
      else routeEvent({ tab: T, type: "assistant", uuid: uuid + "-" + Math.random(),
                        message: { content: [part] } });
    }
    routeEvent({ tab: T, type: "result", subtype: "success", is_error: false,
                 total_cost_usd: 0, duration_ms: 5 });
    routeEvent({ tab: T, type: "command_lifecycle", state: "completed", command_uuid: uuid });
  };
  const todo = (id, content) => ({ type: "tool_use", id, name: "TodoWrite",
    input: { todos: [{ content, status: "pending", activeForm: content }] } });
  const bash = (id) => ({ type: "tool_use", id, name: "Bash", input: { command: "ls " + id } });
  await turn("f1", "نوبت یک", [todo("td1", "کار کهنه"), bash("b1"), { result: "b1" },
                                { type: "text", text: "میانهٔ پاسخ" },
                                bash("b2"), { result: "b2" }, bash("b3"), { result: "b3" },
                                { type: "text", text: "پایان پاسخ یک" }]);
  await turn("f2", "نوبت دو", [bash("b4"), { result: "b4" }, todo("td2", "کار تازه"),
                                { type: "text", text: "پایان پاسخ دو" }]);
  await sleep(60);
  const log = logOf(T);
  const shown = (el) => !!el && getComputedStyle(el).display !== "none";
  const rows = () => [...log.children];
  const runs = () => rows().filter((el) => el.matches("details.run"));
  const todos = () => rows().filter((el) => el.matches("details.card.todos"));
  out.offAll = rows().filter((el) => el.matches("details.run, details.card.todos")).every(shown);
  document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyF", key: "f",
    ctrlKey: true, altKey: true, bubbles: true, cancelable: true }));
  await sleep(60);
  out.on = document.body.classList.contains("focus-view");
  const heads = () => rows().filter((el) => el.classList.contains("focus-head"));
  out.headLabels = heads().map((h) => h.querySelector(":scope > summary")?.dataset.focusLabel);
  out.headTextHidden = heads().every((h) => !shown(h.querySelector(".run-text, .tool-name")));
  out.runsShown = runs().map(shown).join();
  out.todosShown = todos().map(shown).join();
  out.todoHead = todos()[0].classList.contains("focus-head")
    && !todos()[1].classList.contains("focus-proc");
  out.msgsShown = [...log.querySelectorAll(":scope > .msg")].every(shown);
  // Open turn one only. Its first folded row is the OLD to-do list, which was
  // drawn open; the click must open the turn and leave that <details> as it was.
  const wasOpen = heads()[0].open;
  heads()[0].querySelector(":scope > summary").click();
  await sleep(40);
  out.afterOpen = runs().map(shown).join();
  out.headStillClosed = heads()[1]?.classList.contains("focus-open") === false;
  out.openNotToggled = rows().find((el) => el.matches("details.card.todos"))?.open === wasOpen;
  // AltGr types a character on some layouts; it must not switch the view.
  document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyF", key: "f", ctrlKey: true,
    altKey: true, modifierAltGraph: true, bubbles: true, cancelable: true }));
  await sleep(30);
  out.altGrKept = document.body.classList.contains("focus-view");
  // /focus switches it off, and says so.
  await runFocus(cellOf(T));
  await sleep(60);
  out.offAgain = !document.body.classList.contains("focus-view")
    && rows().every((el) => !el.classList.contains("focus-proc"))
    && runs().every(shown);
  out.offNote = log.textContent.includes(FA.focusOff);
  // --- 3. the approve-all posture's names ---
  out.postureNames = [FA.postureAutoApprove, FA.slPostureAutoApprove, FA.autoWhyPosture];
  out.cliAuto = FA.slPostureAuto;
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
  // --- 3. pcg-rf8: the compact box ---
  const comp = () => getComputedStyle(document.querySelector("#grid .cell .composer")).display;
  routeEvent({ tab: "t1", type: "wrapper", subtype: "permission_request", request_id: "d1",
    tool_name: "Bash", tool_use_id: "ud1",
    tool_input: { command: "npm test", description: "Run the tests" } });
  await sleep(40);
  out.descInHead = dlg().querySelector(".perm-tool .perm-desc")?.textContent ?? "";
  out.descInBox = !!dlg().querySelector(".perm-params")?.textContent.includes("Run the tests");
  out.compWhileOpen = comp();
  await esc();
  out.compAfter = comp();
  // One question at a time, header tabs, a pick moves on, Enter fills the
  // unanswered one before it sends.
  const sets = () => [...dlg().querySelectorAll(".ask-q")];
  const shownAt = () => sets().findIndex((s) => !s.hidden);
  const key = (k) => document.activeElement.dispatchEvent(new KeyboardEvent("keydown",
    { key: k, code: /\d/.test(k) ? "Digit" + k : k, bubbles: true, cancelable: true }));
  const responds = () => calls.filter((c) => c.url.startsWith("/api/permission/respond"));
  routeEvent({ tab: "t1", type: "wrapper", subtype: "permission_request", request_id: "q1",
    tool_name: "AskUserQuestion", tool_use_id: "uq1", tool_input: { questions: [
      { question: "کدام رنگ؟", header: "رنگ", multiSelect: false,
        options: [{ label: "سرخ" }, { label: "سبز" }] },
      { question: "کدام اندازه؟", header: "اندازه", multiSelect: false,
        options: [{ label: "کوچک" }, { label: "بزرگ" }] }] } });
  await sleep(40);
  out.tabs = [...dlg().querySelectorAll(".ask-tab")].map((t) => t.textContent);
  out.shown0 = shownAt();
  key("1"); await sleep(200);
  out.shownAfterPick = shownAt();
  out.tab0Answered = dlg().querySelectorAll(".ask-tab")[0]?.dataset.answered;
  dlg().querySelectorAll(".ask-tab")[0].click(); await sleep(30);
  const before = responds().length;
  key("Enter"); await sleep(40);
  out.enterMovedOn = shownAt() === 1 && responds().length === before;
  key("2"); await sleep(200);
  key("Enter"); await sleep(60);
  out.answers = responds().length === before + 1 ? responds().at(-1).body.answers : null;
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

    a = (HERE / "static" / "js" / "focus.js").read_bytes()
    b = (HERE / "static-terminal" / "js" / "focus.js").read_bytes()
    check("js/focus.js is the same file in both editions", a == b)

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

    # 3. the approve-all posture
    names = m.get("postureNames") or []
    # The web edition has no terminal state line, so no state-line string.
    if EDITION == "web":
        names = [n for n in names if n is not None]
    check("the approve-all posture, its state line and its audit note never say «خودکار»",
          len(names) == (2 if EDITION == "web" else 3)
          and all(n and "خودکار" not in n for n in names)
          and m.get("cliAuto") not in names, f"{names}")
    web = (HERE / "static" / "strings.fa.js").read_text(encoding="utf-8")
    check("...in the web edition too", 'postureAutoApprove: "تأیید همه"' in web)
    helps = [(HERE / d / "help.html").read_text(encoding="utf-8") for d in ("static", "static-terminal")]
    check("both guides name it «تأیید همه» and say it is not the CLI's own Auto",
          all("<b>تأیید همه</b>" in h and "<li><b>خودکار</b>" not in h
              and "این حالت «خودکار» خود کلاد نیست" in h for h in helps))

    # 4. fork from a message
    check("an answer offers «گفتگوی تازه از اینجا», a user message the before-it version",
          m.get("forkTitles") == ["گفتگوی تازه از اینجا",
                                  "گفتگوی تازه از پیش از این پیام، با همین متن در جای نوشتن"]
          and m.get("forkLabelled") and m.get("forkText") == "",
          f"{m.get('forkTitles')}, text {m.get('forkText')!r}")
    check("a fork from an answer asks for THIS tab cut AT that message",
          m.get("forkBody1") == {"tab": "t9", "at": "a1", "before": False}, f"{m.get('forkBody1')}")
    check("...and the new column shows the conversation through it, nothing after",
          m.get("fork1Rows") == "u1,a1" and m.get("fork1Note"),
          f"rows {m.get('fork1Rows')!r}, note {m.get('fork1Note')}")
    check("...while the conversation it came from keeps every message",
          m.get("srcKept") == "u1,a1,u2,a2", f"{m.get('srcKept')!r}")
    check("a fork from a user message is cut BEFORE it, its words back in the new prompt",
          m.get("forkBody2") == {"tab": "t9", "at": "u2", "before": True}
          and m.get("fork2Rows") == "u1,a1" and m.get("fork2Draft") == "پرسش دوم",
          f"{m.get('forkBody2')}, rows {m.get('fork2Rows')!r}, draft {m.get('fork2Draft')!r}")

    # 5. Focus view
    check("Focus view is off by default: every step row is on screen", m.get("offAll"))
    check("Ctrl+Alt+F folds each turn's steps behind ONE row that counts them",
          m.get("on") and m.get("headLabels") == ["۴ مرحله", "۱ مرحله"] and m.get("headTextHidden"),
          f"on {m.get('on')}, labels {m.get('headLabels')}, text hidden {m.get('headTextHidden')}")
    check("...the later runs of a turn are hidden, the messages are not",
          m.get("runsShown") == "false,false,true" and m.get("msgsShown"),
          f"runs {m.get('runsShown')}, messages {m.get('msgsShown')}")
    check("...and the LATEST to-do list stays in the open; an older one is the fold row",
          m.get("todosShown") == "true,true" and m.get("todoHead"), f"{m.get('todosShown')}")
    check("a click opens that turn's steps where they are, and only that turn's",
          m.get("afterOpen") == "true,true,true" and m.get("headStillClosed")
          and m.get("openNotToggled"),
          f"{m.get('afterOpen')}, other turn closed {m.get('headStillClosed')}, "
          f"details untouched {m.get('openNotToggled')}")
    check("AltGr (Ctrl+Alt on a Windows keyboard) does not switch the view", m.get("altGrKept"))
    check("/focus switches it back, says so, and leaves no fold behind",
          m.get("offAgain") and m.get("offNote"), f"{m.get('offAgain')} / note {m.get('offNote')}")

    # 2. N of M
    check("a lone permission request shows no count", m.get("lone") == "", f"«{m.get('lone')}»")
    check("stacked requests count «۱ از ۳», then «۲ از ۳», «۳ از ۳» as each is answered",
          (m.get("count1"), m.get("count2"), m.get("count3")) == ("۱ از ۳", "۲ از ۳", "۳ از ۳"),
          f"{m.get('count1')!r} {m.get('count2')!r} {m.get('count3')!r}")
    check("...the run ends with the last one, and the next request starts alone",
          m.get("closed") and m.get("fresh") == "", f"closed {m.get('closed')}, «{m.get('fresh')}»")
    # 3. pcg-rf8: the compact box, after the VS Code extension
    check("a shell call's description sits in the header, not in the command box",
          m.get("descInHead") == "Run the tests" and m.get("descInBox") is False,
          f"head {m.get('descInHead')!r}, in box {m.get('descInBox')}")
    check("the prompt is hidden while a request is open and back after it",
          m.get("compWhileOpen") == "none" and m.get("compAfter") not in (None, "none"),
          f"{m.get('compWhileOpen')!r} -> {m.get('compAfter')!r}")
    check("two questions are two header tabs, one question on screen",
          m.get("tabs") == ["رنگ", "اندازه"] and m.get("shown0") == 0, f"{m.get('tabs')} {m.get('shown0')}")
    check("picking an answer moves to the next question and marks its tab",
          m.get("shownAfterPick") == 1 and m.get("tab0Answered") == "true",
          f"shown {m.get('shownAfterPick')}, answered {m.get('tab0Answered')!r}")
    check("Enter with a question still open goes to it instead of sending",
          m.get("enterMovedOn") is True)
    check("...and sends both answers once both are given",
          m.get("answers") == {"کدام رنگ؟": "سرخ", "کدام اندازه؟": "بزرگ"}, str(m.get("answers")))
    return out


def main() -> int:
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
