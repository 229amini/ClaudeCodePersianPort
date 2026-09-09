r"""Shell gate (v2.5): the status line under the prompt, and the commands the
window answers itself.

V2-PLAN.md §6 gives v2.5 §3.4 (the status line) and §3.5 (the window-local
commands), and §7 asks for every phase's acceptance to be machine-checked
without a real `claude` process. None of the four gates that already exist can
see any of it: `run_spec_test.py` asserts BiDi rules on message content,
`test_layout.py` measures boxes, `test_column.py` reads the transcript column
and `test_keys.py` presses keys at the composer. So this one drives the
shipping `index.html` headlessly — same Edge, same probe-page trick — and asks
what v2.5 is answerable for:

  - the status line is a STACK, in the plan's order: the machine's own
    statusLine output, then the `⏵⏵` posture row in the TUI's words, then the
    muted facts row that replaced the four chips;
  - the posture row follows the WRAPPER's posture rather than the CLI's raw
    `permissionMode`, because «محتاط» and «خودکار» are both `default` down the
    pipe and only the wrapper knows which one the user picked;
  - a turn that settles while the window is hidden raises one notification, and
    a REPLAYED settle raises none — a refresh must not announce history;
  - every window-local command of §3.5 is answered here, at the right route,
    with the right body: /copy /export /status /resume /cd /add-dir /branch
    /btw /bash /config /hooks /keybindings /memory /tasks;
  - /btw says it costs a turn before it sends (measured, §5.4) and renders its
    answer as a side row rather than as a turn in the conversation;
  - /help opens the window's own command list (v2.6 wrote it; test_strings.py
    gates its contents against the command tables) and sends nothing;
  - and the one that is still NOT built — /theme (V2-PLAN §8.12, taste) —
    falls through to the CLI as text, along with any verb carrying an argument
    the window does not own.

Free: no CLI turn, no login. Every route is stubbed inside the page; the probe
page is deleted again on the way out.

    C:\Python314\python.exe persian-claude-gui\test_shell.py
"""

from __future__ import annotations

import os
import sys
import threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

# The Edge lookup, the SSE hold and the PROBE/ENDPROBE read are the same job
# test_layout.py already does; a second copy would drift from it.
from test_layout import boot_server, find_edge, hold_sse, measure  # noqa: E402

from server import EDITIONS  # noqa: E402

# The edition decides which UI folder this gate reads. PCG_UI picks it;
# the table itself lives in server.py and is never duplicated.
EDITION = os.environ.get("PCG_UI", "terminal")
STATIC = HERE / EDITIONS[EDITION][0]
PROBE = STATIC / "_shell_probe.html"

PROBE_JS = r"""
<pre id="probe-out" hidden></pre>
<script type="module">
/* The tab registry and the synchronous half of a switch. Importing the ENTRY
   module is safe from here and only from here (see the load-order note in
   app.js): this block runs after every module has evaluated, and the page is
   `data-render-only`, so nothing has opened a stream of its own. */
import { routeEvent, applySwitch, applyTabs } from "/static/js/app.js";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FA = window.STRINGS;
const log = document.querySelector(".log");
const input = document.querySelector(".input");
const composer = document.querySelector(".composer");
const statusline = document.querySelector(".statusline");
const picker = document.querySelector(".picker");
const sidebar = document.getElementById("projects");

/* --- every route the window can reach, answered here ----------------------- */
const calls = [];
const json = (o) => new Response(JSON.stringify(o), { status: 200,
  headers: { "Content-Type": "application/json" } });
const SESSIONS = [
  { session_id: "aaaaaaaa-1111-2222-3333-444444444444", title: "goftegoo yek",
    preview: "yek", modified: Date.now() / 1000 },
  { session_id: "bbbbbbbb-1111-2222-3333-444444444444", title: "goftegoo do",
    preview: "do", modified: Date.now() / 1000 },
];
const PROJECTS = {
  current_cwd: "C:/kar/proje",
  current_session: SESSIONS[0].session_id,
  projects: [{ path: "C:/kar/proje", name: "", archived: false, pinned: false,
               sessions: SESSIONS }],
};
/* A1: the attach route is the one stub with a settable status — a 400 there is
   not an edge case, it is the ONLY way a refused attachment can ever be seen
   (the CLI's own side of an `@path` read fails silently). */
let attachStatus = 200;
window.fetch = async (url, init) => {
  const u = String(url);
  calls.push({ url: u, body: init?.body ? JSON.parse(init.body) : null });
  if (u.startsWith("/api/attach/paste"))
    return attachStatus === 200
      ? json({ path: "C:/Users/ali reza/AppData/Local/Temp/paste-ab12cd34-note.txt" })
      : new Response("no", { status: attachStatus });
  if (u.startsWith("/api/projects")) return json(PROJECTS);
  if (u.startsWith("/api/agents")) return json({ agents: [] });
  if (u.startsWith("/api/open-file")) return json({ ok: true, path: "C:/khane/.claude/settings.json" });
  if (u.startsWith("/api/export")) return json({ ok: true, path: "C:/khane/goftegoo.txt" });
  if (u.startsWith("/api/session/fork")) return json({ ok: true, tab: "tab-2" });
  if (u.startsWith("/api/project/open")) return json({ cwd: "C:/kar/digar", tab: "tab-3" });
  if (u.startsWith("/api/project/pick")) return json({ path: "C:/kar/entekhab" });
  if (u.startsWith("/api/control"))
    return json({ ok: true, response: { response: "PASOKHE JANEBI", synthetic: true } });
  return json({ ok: true });
};
const bodyOf = (path) => [...calls].reverse().find((c) => c.url.startsWith(path))?.body ?? null;
const called = (path) => calls.some((c) => c.url.startsWith(path));
const since = (path, mark) => calls.slice(mark).some((c) => c.url.startsWith(path));

/* The clipboard needs a user gesture and a focused document, neither of which
   a headless probe has -- so what is measured is what /copy HANDS it. */
const copied = [];
Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: { writeText: (text) => { copied.push(text); return Promise.resolve(); } },
});

/* A hidden window, and a notification that records instead of showing. */
const notes = [];
Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
window.Notification = class {
  static permission = "granted";
  static requestPermission() { return Promise.resolve("granted"); }
  constructor(title, opts) { notes.push({ title, opts }); }
  addEventListener() {}
};

const send = async (text, wait = 90) => {
  input.value = text;
  composer.requestSubmit();
  await sleep(wait);
};
const keyAt = (el, k) => el.dispatchEvent(new KeyboardEvent("keydown",
  { key: k, bubbles: true, cancelable: true }));
const metaSaid = (text) => [...log.querySelectorAll(".msg")]
  .some((el) => text && el.textContent.includes(text));

(async () => {
 try {
  const out = {};

  /* --- §3.4 the status line ---------------------------------------------- */
  window.renderEvent({ type: "system", subtype: "init",
    model: "claude-opus-5", cwd: "C:/kar/proje", permissionMode: "acceptEdits",
    session_id: SESSIONS[0].session_id, output_style: "Explanatory",
    slash_commands: ["compact"] });
  window.renderEvent({ type: "wrapper", subtype: "effort", effort: "high" });
  window.renderEvent({ type: "wrapper", subtype: "statusline",
    segments: [{ text: "KHATE KHODAM" }] });
  await sleep(80);

  out.slOrder = [...statusline.children].map((el) => el.className);
  out.slCustom = statusline.querySelector(".sl-custom")?.textContent ?? "";
  out.slPostureMode = statusline.querySelector(".sl-posture")?.dataset.posture ?? "";
  out.slArrows = statusline.querySelectorAll(".sl-posture .sl-arrow").length;
  out.slPostureText = statusline.querySelector(".sl-posture-text")?.textContent ?? "";
  out.slHint = statusline.querySelector(".sl-posture .sl-hint")?.textContent ?? "";
  out.slFacts = statusline.querySelector(".sl-facts")?.textContent ?? "";
  out.faAcceptEdits = FA.slPostureAcceptEdits;
  out.faAsk = FA.slPostureAsk;
  out.faHint = FA.slPostureHint;
  out.faModel = FA.slModel;
  out.faEffortLabel = FA.slEffort;
  out.faStyleLabel = FA.slStyle;

  // The wrapper's own posture WINS over the CLI's raw mode: `ask` and
  // `autoApprove` are both `default` down the pipe (server.py POSTURES).
  window.renderEvent({ type: "wrapper", subtype: "posture", posture: "ask", auto_count: 0 });
  await sleep(60);
  out.slPostureAfterWrapper = statusline.querySelector(".sl-posture-text")?.textContent ?? "";
  out.slArrowsAfterWrapper = statusline.querySelectorAll(".sl-posture .sl-arrow").length;

  /* --- the turn-end notification ------------------------------------------ */
  window.renderEvent({ type: "assistant", message: { content: [
    { type: "text", text: "\u067e\u0627\u0633\u062e \u0622\u0645\u0627\u062f\u0647 \u0627\u0633\u062a." }] } });
  window.renderEvent({ type: "result", subtype: "success", total_cost_usd: 0.0102 });
  await sleep(80);
  out.notifiedLive = notes.length;
  window.renderEvent({ type: "result", subtype: "success", total_cost_usd: 0.02,
                       replayed: true });
  await sleep(80);
  out.notifiedAfterReplay = notes.length;
  out.notifyTitle = notes[0]?.title ?? "";
  out.faNotify = FA.notifyDone;

  /* --- §3.5 /copy and /export --------------------------------------------- */
  await send("/copy");
  out.copied = copied[0] ?? "";
  out.copyNote = metaSaid(FA.cmdCopied) || metaSaid(FA.cmdCopyFailed);

  await send("/export");
  out.exportText = bodyOf("/api/export")?.text ?? "";
  out.exportNote = metaSaid("goftegoo.txt");

  /* --- /status ------------------------------------------------------------- */
  await send("/status");
  out.statusOpen = !!picker?.open;
  out.statusTitle = document.querySelector(".picker-title")?.textContent ?? "";
  out.statusBody = document.querySelector(".picker-body")?.textContent ?? "";
  out.faStatusTitle = FA.statusTitle;
  out.faVersion = FA.statusVersion;
  keyAt(picker.querySelector(".opts"), "Escape");
  await sleep(40);
  out.statusClosed = !picker.open;

  /* --- /resume: the keyboard in the sidebar ------------------------------- */
  await sleep(450);            // the sidebar's own debounce, then the stub
  out.sidebarRows = sidebar.querySelectorAll(".sess").length;
  await send("/resume");
  const first = document.activeElement;
  out.resumeFocused = !!first?.classList?.contains("sess");
  out.resumeStartsOnCurrent =
    first?.closest("li")?.dataset.session === SESSIONS[0].session_id;
  out.resumeRoving = [...sidebar.querySelectorAll(".sess")]
    .filter((el) => el.tabIndex === 0).length;
  keyAt(first, "ArrowDown");
  await sleep(40);
  out.resumeMoved =
    document.activeElement?.closest("li")?.dataset.session === SESSIONS[1].session_id;
  keyAt(document.activeElement, "Escape");
  await sleep(40);
  out.resumeEscHome = document.activeElement === input;
  out.resumeHint = metaSaid(FA.cmdResumeHint);

  /* --- /cd, /add-dir, /branch --------------------------------------------- */
  await send("/cd C:/kar/digar");
  out.cdPath = bodyOf("/api/project/open")?.path ?? "";
  let mark = calls.length;
  await send("/add-dir C:/kar/sevvom");
  out.addDirPath = bodyOf("/api/project/open")?.path ?? "";
  out.addDirRoute = since("/api/project/open", mark);

  await send("/branch");
  out.branched = called("/api/session/fork");
  out.branchNote = metaSaid(FA.cmdBranchDone);

  /* --- /btw: a side question, and it costs a turn ------------------------- */
  mark = calls.length;
  await send("/btw \u0627\u06cc\u0646 \u0641\u0627\u06cc\u0644 \u0686\u06cc\u0633\u062a\u061f", 140);
  const control = bodyOf("/api/control");
  out.btwSubtype = control?.subtype ?? "";
  out.btwQuestion = control?.params?.question ?? "";
  out.btwCostSaid = metaSaid(FA.cmdBtwCost);
  const sides = [...log.querySelectorAll(".msg.side")];
  out.sideRows = sides.length;
  out.sideMarks = sides.map((el) => el.querySelector(".side-mark")?.textContent ?? "");
  out.sideAnswer = sides[sides.length - 1]?.textContent ?? "";
  // A side answer is not a turn: it must not carry the transcript's own ⏺.
  out.sideNoTurnMark = sides.every(
    (el) => getComputedStyle(el, "::before").content === "none");
  // ...and it never reached the CLI as a message.
  out.btwNotSent = !since("/api/message", mark);

  /* --- /bash, and the four files ------------------------------------------ */
  mark = calls.length;
  await send("/bash dir");
  out.bashCommand = bodyOf("/api/shell")?.command ?? "";
  out.bashNotSent = !since("/api/message", mark);

  await send("/config");
  out.configWhat = bodyOf("/api/open-file")?.what ?? "";
  await send("/hooks");
  out.hooksWhat = bodyOf("/api/open-file")?.what ?? "";
  await send("/keybindings");
  out.keysWhat = bodyOf("/api/open-file")?.what ?? "";
  out.openedNote = metaSaid("settings.json");

  await send("/memory");
  out.memoryOpen = !!picker?.open;
  out.memoryRows = picker.querySelectorAll(".opt").length;
  out.memoryBody = document.querySelector(".picker-body")?.textContent ?? "";
  out.faMemoryTitle = FA.memoryTitle;
  out.faMemoryUser = FA.memoryUser;
  out.memoryTitle = document.querySelector(".picker-title")?.textContent ?? "";
  keyAt(picker.querySelector(".opts"), "Escape");
  await sleep(40);

  /* --- /tasks -------------------------------------------------------------- */
  await send("/tasks");
  out.tasksNote = metaSaid(FA.cmdTasksEmpty);

  /* --- /help, whose text v2.6 owns ----------------------------------------- */
  mark = calls.length;
  await send("/help");
  out.helpOpen = !!picker?.open;
  out.helpTitle = document.querySelector(".picker-title")?.textContent ?? "";
  out.faHelpTitle = FA.helpTitle;
  out.helpRows = [...picker.querySelectorAll(".opt-title")].map((el) => el.textContent);
  out.helpNotSent = !since("/api/message", mark);
  keyAt(picker.querySelector(".opts"), "Escape");
  await sleep(40);

  /* --- what still goes to the CLI ------------------------------------------ */
  for (const [name, text] of [["theme", "/theme"],
                              ["modelArg", "/model sonnet"], ["unknown", "/naparsi"]]) {
    mark = calls.length;
    await send(text);
    out["sent_" + name] = calls.slice(mark)
      .some((c) => c.url.startsWith("/api/message") && c.body?.text === text);
  }

  /* --- A1: dropping a NON-image file on the prompt -------------------------
     The terminal prompt has no paperclip (TP1 took it off to match the TUI), and
     `@` only sees files inside the project tree — so drop and Ctrl+V are the
     only way in for a text file on the desktop. Before A1 the drop handler
     filtered `image/*` and a dropped `.txt` did nothing whatsoever: no call, no
     chip, no error. That silence is what the first check below is for. */
  const dropTarget = document.querySelector(".composer");
  const attachRow = document.querySelector(".attachments");
  const chipCount = () => attachRow?.querySelectorAll(".chip").length ?? -1;
  const errorsSaying = (text) => [...log.querySelectorAll(".msg.error")]
    .filter((el) => el.textContent === text).length;
  /* Waiting on the OUTCOME, not on a stopwatch: every drop ends as exactly one
     chip or one error bubble, and a fixed sleep measured a FileReader that had
     not come back yet — which read as "the server said yes" and then landed a
     chip in the middle of the next case. (Why: --virtual-time-budget skips a
     timer forward instantly but does NOT wait on a FileReader, so a sleep here
     buys real time only by accident.)

     The loop is bounded tightly on purpose. A drop that never resolves burns
     its whole budget, and four of those would run the page past the 9 s virtual
     budget — so the gate would die as «the probe never ran» instead of naming
     the check that broke. */
  const settled = () => chipCount() + errorsSaying(FA.pasteFailed);
  const drop = async (file, expect) => {
    const dt = new DataTransfer();
    dt.items.add(file);
    dropTarget.dispatchEvent(new DragEvent("drop",
      { dataTransfer: dt, bubbles: true, cancelable: true }));
    for (let i = 0; i < 25 && settled() < expect; i++) await sleep(10);
  };

  let attachMark = calls.length;
  await drop(new File(["salam"], "note.txt", { type: "text/plain" }), 1);
  const attachBody = bodyOf("/api/attach/paste");
  out.a1Called = since("/api/attach/paste", attachMark);
  out.a1Name = attachBody?.name ?? "";
  out.a1Data = attachBody?.data ?? "";
  out.a1Chips = chipCount();
  out.a1Errors = errorsSaying(FA.pasteFailed);

  // 300 KiB of text is past the CLI's own 256 KiB at-mention cap, so it must be
  // refused BEFORE it is base64-encoded inside the tab.
  attachMark = calls.length;
  await drop(new File(["a".repeat(300 * 1024)], "big.log", { type: "text/plain" }), 2);
  out.a1BigCalled = since("/api/attach/paste", attachMark);
  out.a1BigChips = chipCount();
  out.a1BigErrors = errorsSaying(FA.pasteFailed);

  // The server's own refusal reads as the same sentence, because every reason it
  // can refuse looks identical from here.
  attachStatus = 400;
  await drop(new File(["salam"], "deny.txt", { type: "text/plain" }), 3);
  out.a1DeniedErrors = errorsSaying(FA.pasteFailed);
  out.a1DeniedChips = chipCount();
  attachStatus = 200;

  // And an image is still an image: same route, same body it always sent.
  attachMark = calls.length;
  await drop(new File([new Uint8Array([137, 80, 78, 71])], "x.png",
                      { type: "image/png" }), 4);
  out.a1ImageCalled = since("/api/attach/paste", attachMark);
  out.a1ImageType = bodyOf("/api/attach/paste")?.media_type ?? "";
  out.a1ImageChips = chipCount();
  out.faPasteFailed = FA.pasteFailed;

  /* --- MA1: the per-conversation status dot, unread count, running badge ---
     Six conversations, one window: what is happening in the five you are NOT
     looking at is only legible from the sidebar. Everything below is derived in
     ONE place (chrome.js tabStatus) out of state this window already keeps, so
     each case drives the real event and reads the real row. */
  const stTab = "shell-tab-status";
  const otherTab = "shell-tab-other";
  applyTabs({ active: otherTab, tabs: [
    { tab: otherTab, session_id: null, cwd: "C:/kar/proje", busy: false },
    { tab: stTab, session_id: null, cwd: "C:/kar/digar", busy: false },
  ] });
  await sleep(60);
  const stRow = () =>
    document.querySelector('#open-tabs .tab-row[data-tab="' + stTab + '"]');
  const stDot = () => stRow()?.querySelector(".tab-dot");
  const stBadge = () =>
    document.getElementById("tabs-title")?.querySelector(".tabs-badge");
  const stUnread = () => stRow()?.querySelector(".tab-unread")?.textContent ?? "";

  routeEvent({ tab: stTab, type: "wrapper", subtype: "user_echo",
               uuid: "shell-status-uuid", text: "kar" });
  out.stRunning = stDot()?.dataset.status ?? "";
  out.stGlyph = stDot()?.textContent ?? "";
  out.stRunningLabel = stDot()?.getAttribute("aria-label") ?? "";
  out.stRunningBadge = stBadge()?.textContent ?? "";

  // Waiting on a human beats a turn in flight: it is the only one of the four
  // that will never resolve itself.
  routeEvent({ tab: stTab, type: "wrapper", subtype: "permission_request",
               request_id: "shell-status-perm", tool_name: "Bash",
               tool_use_id: "shell-status-tool",
               tool_input: { command: "echo status" } });
  out.stWaiting = stDot()?.dataset.status ?? "";
  out.stWaitingBadge = stBadge()?.textContent ?? "";
  routeEvent({ tab: stTab, type: "wrapper", subtype: "permission_resolved",
               request_id: "shell-status-perm", tool_use_id: "shell-status-tool",
               decision: "deny" });

  // A user-pressed stop arrives as is_error + aborted_streaming (B-9.10): not a
  // failure, and not news either — it would be reporting the reader's own stop
  // back to them as an unread answer.
  routeEvent({ tab: stTab, type: "result", subtype: "error_during_execution",
               is_error: true, terminal_reason: "aborted_streaming",
               total_cost_usd: 0, duration_ms: 5 });
  out.stAborted = stDot()?.dataset.status ?? "";
  out.stAbortedUnread = stUnread();
  out.stAbortedBadge = stBadge()?.textContent ?? "";

  routeEvent({ tab: stTab, type: "result", subtype: "success", is_error: true,
               result: "nashod", total_cost_usd: 0, duration_ms: 5 });
  out.stError = stDot()?.dataset.status ?? "";
  out.stUnread = stUnread();
  applySwitch(stTab);
  await sleep(60);
  out.stUnreadAfterSwitch = stUnread();
  out.faRunning = FA.tabStatus.running;
  out.faRunningBadge = FA.tabsRunning.replace("{n}", "\u06f1");
  out.faWaitingBadge = FA.tabsWaiting.replace("{n}", "\u06f1");

  document.getElementById("probe-out").textContent = "PROBE" + JSON.stringify(out) + "ENDPROBE";
 } catch (err) {
  document.getElementById("probe-out").textContent =
    "PROBE" + JSON.stringify({ error: String(err && err.stack || err) }) + "ENDPROBE";
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
    """Every v2.5 acceptance item, as one assertion each."""
    out: list[tuple[str, bool, str]] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        out.append((name, bool(ok), detail))

    order = m.get("slOrder") or []
    check("the status line is a stack: custom line, posture row, facts row",
          len(order) == 3 and "sl-posture" in order[1] and "sl-facts" in order[2],
          " | ".join(order) or "empty")

    check("the machine's own statusLine output is the FIRST line",
          m.get("slCustom") == "KHATE KHODAM" and order[:1] == ["sl-line"],
          m.get("slCustom", "") or "no custom line")

    check("the posture row is the TUI's sentence, with its own key",
          m.get("slPostureText") == m.get("faAcceptEdits")
          and m.get("slHint") == m.get("faHint"),
          f"{m.get('slPostureText')} / {m.get('slHint')}")

    check("acceptEdits draws \u23f5\u23f5, two arrows",
          m.get("slArrows") == 2 and m.get("slPostureMode") == "acceptEdits",
          f"{m.get('slArrows')} arrows, mode {m.get('slPostureMode')}")

    check("the WRAPPER's posture wins over the CLI's raw permissionMode",
          m.get("slPostureAfterWrapper") == m.get("faAsk")
          and m.get("slArrowsAfterWrapper") == 1,
          f"{m.get('slPostureAfterWrapper')} / {m.get('slArrowsAfterWrapper')} arrow")

    facts = m.get("slFacts", "")
    check("the facts row carries what the four chips used to say",
          all(x and x in facts for x in (m.get("faModel"), m.get("faEffortLabel"),
                                         m.get("faStyleLabel")))
          and "claude-opus-5" in facts,
          facts[:80] or "no facts row")

    check("a settle while the window is hidden raises ONE notification",
          m.get("notifiedLive") == 1 and m.get("notifyTitle") == m.get("faNotify"),
          f"{m.get('notifiedLive')} \u00d7 \u00ab{m.get('notifyTitle')}\u00bb")

    check("a REPLAYED settle raises none",
          m.get("notifiedAfterReplay") == 1, str(m.get("notifiedAfterReplay")))

    check("/copy hands the last answer to the clipboard",
          "\u0622\u0645\u0627\u062f\u0647" in m.get("copied", "")
          and m.get("copyNote") is True,
          m.get("copied", "")[:40] or "nothing copied")

    check("/export posts the conversation as text, and names the file",
          "\u0622\u0645\u0627\u062f\u0647" in m.get("exportText", "")
          and m.get("exportNote") is True,
          m.get("exportText", "")[:50] or "no text")

    check("/status opens the TUI's status block, off this tab's own state",
          m.get("statusOpen") is True
          and m.get("statusTitle") == m.get("faStatusTitle")
          and all(x in m.get("statusBody", "")
                  for x in ("9.9.9", "claude-opus-5", "aaaaaaaa")),
          m.get("statusBody", "")[:70] or "not open")

    check("...and Esc shuts it", m.get("statusClosed") is True, str(m.get("statusClosed")))

    check("/resume moves the keyboard into the sidebar's session list",
          m.get("sidebarRows") == 2 and m.get("resumeFocused") is True
          and m.get("resumeStartsOnCurrent") is True and m.get("resumeHint") is True,
          f"{m.get('sidebarRows')} rows, focused={m.get('resumeFocused')}, "
          f"current={m.get('resumeStartsOnCurrent')}")

    check("one row at a time is in the tab order (roving tabindex)",
          m.get("resumeRoving") == 1, str(m.get("resumeRoving")))

    check("Down walks the list, Esc goes back to the prompt",
          m.get("resumeMoved") is True and m.get("resumeEscHome") is True,
          f"moved={m.get('resumeMoved')}, home={m.get('resumeEscHome')}")

    check("/cd opens the folder it was given",
          m.get("cdPath") == "C:/kar/digar", m.get("cdPath", "") or "no call")

    check("/add-dir is the same command (one cwd per conversation)",
          m.get("addDirPath") == "C:/kar/sevvom" and m.get("addDirRoute") is True,
          m.get("addDirPath", "") or "no call")

    check("/branch forks this session into its own tab",
          m.get("branched") is True and m.get("branchNote") is True,
          f"forked={m.get('branched')}, said={m.get('branchNote')}")

    check("/btw sends side_question, with the question as its param",
          m.get("btwSubtype") == "side_question"
          and "\u0686\u06cc\u0633\u062a" in m.get("btwQuestion", ""),
          f"{m.get('btwSubtype')} / {m.get('btwQuestion', '')[:30]}")

    check("...and the window says it costs a turn BEFORE it sends",
          m.get("btwCostSaid") is True, str(m.get("btwCostSaid")))

    check("...and the answer is a side row, not a turn",
          m.get("sideRows") == 2 and m.get("sideMarks") == ["\u203b", "\u203b"]
          and "PASOKHE JANEBI" in m.get("sideAnswer", "")
          and m.get("sideNoTurnMark") is True and m.get("btwNotSent") is True,
          f"{m.get('sideRows')} rows {m.get('sideMarks')}, "
          f"no \u23fa={m.get('sideNoTurnMark')}")

    check("/bash is the `!` path, not a message to the model",
          m.get("bashCommand") == "dir" and m.get("bashNotSent") is True,
          m.get("bashCommand", "") or "no call")

    check("/config and /hooks open settings.json; /keybindings its own file",
          m.get("configWhat") == "settings" and m.get("hooksWhat") == "settings"
          and m.get("keysWhat") == "keybindings" and m.get("openedNote") is True,
          f"{m.get('configWhat')} / {m.get('hooksWhat')} / {m.get('keysWhat')}")

    check("/memory asks which memory, the way the CLI does",
          m.get("memoryOpen") is True and m.get("memoryRows") == 2
          and m.get("memoryTitle") == m.get("faMemoryTitle")
          and str(m.get("faMemoryUser")) in m.get("memoryBody", ""),
          f"{m.get('memoryRows')} rows / {m.get('memoryTitle')}")

    check("/tasks says so when nothing is running",
          m.get("tasksNote") is True, str(m.get("tasksNote")))

    # v2.6 took /help off the fall-through list: the phase that owns the words
    # is the one that could write them (V2-PLAN \u00a78.11A). The list's CONTENT is
    # gated in test_strings.py, which can compare it against the command tables
    # without a browser; what needs a page is that the verb opens it at all and
    # that nothing is sent to the CLI when it does.
    rows = m.get("helpRows") or []
    check("/help opens the window's own command list, and sends nothing",
          m.get("helpOpen") is True and m.get("helpNotSent") is True
          and m.get("helpTitle") == m.get("faHelpTitle") and len(rows) > 10,
          f"{len(rows)} rows / open={m.get('helpOpen')} / sent={not m.get('helpNotSent')}")

    check("/theme too \u2014 V2-PLAN \u00a78.12, and the owner owns it",
          m.get("sent_theme") is True, str(m.get("sent_theme")))

    check("a verb WITH an argument the window does not own falls through",
          m.get("sent_modelArg") is True, str(m.get("sent_modelArg")))

    check("and so does a command nobody here has heard of",
          m.get("sent_unknown") is True, str(m.get("sent_unknown")))

    # --- A1: a non-image file on the prompt ----------------------------------
    # The first of these is the whole defect: before A1 a dropped .txt made no
    # call at all, and the colleague was told nothing.
    check("a dropped text file posts to /api/attach/paste, with its own name",
          m.get("a1Called") is True and m.get("a1Name") == "note.txt",
          f"called={m.get('a1Called')} / name «{m.get('a1Name')}»")

    check("...carrying the file's bytes as base64, and one chip appears",
          m.get("a1Data") == "c2FsYW0=" and m.get("a1Chips") == 1
          and m.get("a1Errors") == 0,
          f"data «{m.get('a1Data')}» / chips {m.get('a1Chips')} / "
          f"errors {m.get('a1Errors')}")

    check("300 KiB is refused before it is ever encoded: no call, one sentence",
          m.get("a1BigCalled") is False and m.get("a1BigErrors") == 1
          and m.get("a1BigChips") == 1,
          f"called={m.get('a1BigCalled')} / errors {m.get('a1BigErrors')} / "
          f"chips {m.get('a1BigChips')}")

    check("a 400 from the server reads as the same sentence, and adds no chip",
          m.get("a1DeniedErrors") == 2 and m.get("a1DeniedChips") == 1,
          f"errors {m.get('a1DeniedErrors')} / chips {m.get('a1DeniedChips')}")

    check("the refusal names the rule, so it is actionable",
          "۲۵۶" in (m.get("faPasteFailed") or ""),
          m.get("faPasteFailed") or "")

    check("an image still posts exactly as it did, media_type and all",
          m.get("a1ImageCalled") is True and m.get("a1ImageType") == "image/png"
          and m.get("a1ImageChips") == 2,
          f"called={m.get('a1ImageCalled')} / type «{m.get('a1ImageType')}» / "
          f"chips {m.get('a1ImageChips')}")

    # --- MA1: per-tab status, unread, running badge --------------------------
    check("an outstanding message in a background conversation paints «در حال کار»",
          m.get("stRunning") == "running" and m.get("stGlyph") == "●"
          and m.get("stRunningLabel") == m.get("faRunning")
          and m.get("stRunningBadge") == m.get("faRunningBadge"),
          f"{m.get('stRunning')} / glyph «{m.get('stGlyph')}» / "
          f"badge «{m.get('stRunningBadge')}»")

    check("a tool waiting on a person outranks the turn it is inside, badge and all",
          m.get("stWaiting") == "waiting"
          and m.get("stWaitingBadge") == m.get("faWaitingBadge"),
          f"{m.get('stWaiting')} / badge «{m.get('stWaitingBadge')}»")

    check("a STOPPED turn is neither an error nor an unread answer",
          m.get("stAborted") == "idle" and m.get("stAbortedUnread") == ""
          and m.get("stAbortedBadge") == "",
          f"{m.get('stAborted')} / unread «{m.get('stAbortedUnread')}»")

    check("a failed turn paints «error» and counts one unread, cleared by looking at it",
          m.get("stError") == "error" and m.get("stUnread") == "۱"
          and m.get("stUnreadAfterSwitch") == "",
          f"{m.get('stError')} / unread «{m.get('stUnread')}» -> "
          f"«{m.get('stUnreadAfterSwitch')}»")

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
        url = f"{base}/static/_shell_probe.html?t={token}"
        try:
            report = measure(edge, url, 1280, 900)
        except Exception as err:                      # noqa: BLE001 - reported, not raised
            print(f"FAIL - {err}")
            return 1
    finally:
        proc.terminate()
        PROBE.unlink(missing_ok=True)

    if report.get("error"):
        print("FAIL - the probe threw: " + str(report["error"]))
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
