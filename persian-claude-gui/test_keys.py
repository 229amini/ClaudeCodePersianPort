r"""Key gate (v2.3): does the prompt box answer to the keys the binary binds?

V2-PLAN.md §7 asks for this by name: *"`test_keys.py` should read its cases
from `wiki/tui-keys.md`'s «کلید v2» column rather than repeat them, so the
binding table has exactly one copy and the two gates cannot disagree."* So it
does — the table is parsed, and every chord v2 commits to in the four contexts
the prompt owns (Global, Chat, Autocomplete, Transcript, HistorySearch) must
have a scenario here AND fire in the shipping `index.html`. A row that gains a
key with nothing behind it fails; a scenario for a key the table does not bind
fails too, which is what stops this file from drifting into its own opinion.

`test_tui_vocab.py` already proves the table agrees with `claude.exe`. This one
proves the window agrees with the table, so the chain is: binary → wiki → page.

Also checked, from V2-PLAN §3.2 rather than from the binding table (they are
characters, not chords): `!` bash mode, `@` completion, `\`+Enter, and the `?`
sheet — plus the two keys that must NOT be swallowed, because the browser's own
behaviour is the feature (ctrl+z, ctrl+x with a selection).

Free: no CLI turn, no login, and every route the composer calls is stubbed in
the page. The probe page is deleted again on the way out.

    C:\Python314\python.exe persian-claude-gui\test_keys.py
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
import threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

# Same headless rig test_layout.py and test_column.py use; a second copy would
# drift away from the one that is maintained.
from test_layout import find_edge, hold_sse, measure  # noqa: E402

STATIC = HERE / "static"
PROBE = STATIC / "_keys_probe.html"
KEYS_DOC = HERE.parent / "wiki" / "tui-keys.md"

# The contexts the PROMPT owns. `Confirmation` is v2.4's, `Task` has no v2 key,
# and the rest of the file is reference material about screens v2 does not
# build (the doc's own "Contexts v2 does not build" table).
CONTEXTS = ("Global", "Chat", "Autocomplete", "Transcript", "HistorySearch")

# (context, chord as the wiki writes it) -> the probe result that proves it.
# The chord strings are NOT authored here: the parser below reads them out of
# the doc and every one of them must appear as a key of this map.
SCENARIOS = {
    ("Global", "ctrl+t"): ("todosToggled", "ctrl+t opens and shuts the checklist"),
    ("Global", "ctrl+o"): ("transcriptToggled", "ctrl+o opens every tool result"),
    ("Global", "ctrl+r"): ("searchOpened", "ctrl+r opens the history search"),
    ("Transcript", "ctrl+o"): ("transcriptToggled",
                               "and it is the same key the transcript screen used"),
    ("Chat", "Esc"): ("escInterrupted", "Esc interrupts the running turn"),
    ("Chat", "ctrl+l"): ("inputCleared", "ctrl+l empties the box (not the screen)"),
    ("Chat", "shift+tab"): ("postureCycled", "shift+tab cycles the approval posture"),
    ("Chat", "alt+p"): ("modelPicked", "alt+p opens the model picker"),
    ("Chat", "alt+t"): ("thinkingToggled", "alt+t shows and hides the thinking card"),
    ("Chat", "Enter"): ("submitted", "Enter sends"),
    ("Chat", "ctrl+x Enter"): ("queueSubmitted", "ctrl+x Enter sends to the queue"),
    ("Chat", "shift+Enter"): ("shiftEnterFree",
                              "shift+Enter is left to the textarea's own newline"),
    ("Chat", "ctrl+j"): ("ctrlJNewline", "ctrl+j inserts a newline"),
    ("Chat", "↑"): ("historyUp", "Up on the first line walks back through history"),
    ("Chat", "↓"): ("historyDown", "Down walks forward and gives the draft back"),
    ("Chat", "ctrl+z"): ("undoFree", "ctrl+z stays the browser's undo"),
    ("Chat", "ctrl+g"): ("editorOpened", "ctrl+g hands the draft to an editor"),
    ("Chat", "ctrl+v"): ("pasteFree",
                         "ctrl+v is left to the paste event, which owns images"),
    ("Autocomplete", "Tab"): ("menuAccepted", "Tab accepts the `@` completion"),
    ("Autocomplete", "Esc"): ("menuDismissed", "Esc dismisses the `@` menu"),
    ("Autocomplete", "↑"): ("menuPrevious", "Up moves the `@` selection back"),
    ("Autocomplete", "↓"): ("menuNext", "Down moves the `@` selection on"),
    ("HistorySearch", "ctrl+r"): ("searchNext", "ctrl+r again picks the next match"),
    ("HistorySearch", "Esc"): ("searchEsc", "Esc puts the match in the box"),
    ("HistorySearch", "Tab"): ("searchTab", "so does Tab"),
    ("HistorySearch", "Enter"): ("searchEnter", "Enter puts it there and sends"),
}

PROBE_JS = r"""
<pre id="probe-out" hidden></pre>
<script type="module">
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = document.getElementById("log");
const input = document.getElementById("input");
const box = document.querySelector(".comp-box");
const filePopup = document.getElementById("file-popup");

/* Every route the composer calls, answered here. The window never talks to a
   CLI in this gate -- what is being tested is which key reaches which call. */
const calls = [];
const json = (o) => new Response(JSON.stringify(o), { status: 200,
  headers: { "Content-Type": "application/json" } });
window.fetch = async (url, init) => {
  const u = String(url);
  calls.push({ url: u, body: init?.body ? JSON.parse(init.body) : null });
  if (u.startsWith("/api/history")) return json({ prompts: ["porseshe yek", "porseshe do"] });
  if (u.startsWith("/api/files")) return json({ files: ["src/nested.py", "src/other.py"] });
  if (u.startsWith("/api/editor")) return json({ text: "AZ VIRAYESHGAR", changed: true });
  return json({ ok: true });
};
const called = (path) => calls.some((c) => c.url.startsWith(path));
const lastCall = (path) => [...calls].reverse().find((c) => c.url.startsWith(path));

/* true when the page HANDLED the key (preventDefault). false means it fell
   through to the browser, which for two of the rows below is the whole point. */
const key = (k, init = {}) => !input.dispatchEvent(new KeyboardEvent("keydown",
  { key: k, bubbles: true, cancelable: true, ...init }));
const type = (text) => {
  input.value = text;
  input.setSelectionRange(text.length, text.length);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
const cards = (sel) => [...log.querySelectorAll(sel)];
const openCount = (sel) => cards(sel).filter((c) => c.open).length;

(async () => {
 try {
  const out = {};

  /* --- something to act on ------------------------------------------------ */
  window.renderEvent({ type: "assistant", message: { content: [
    { type: "tool_use", id: "t1", name: "Read", input: { file_path: "C:\\a\\b.md" } }] } });
  window.renderEvent({ type: "user", message: { content: [
    { type: "tool_result", tool_use_id: "t1", content: "one\ntwo" }] } });
  window.renderEvent({ type: "assistant", message: { content: [{
    type: "tool_use", id: "todo1", name: "TodoWrite", input: { todos: [
      { content: "a", status: "pending" }] } }] } });
  window.renderEvent({ type: "stream_event", event: { type: "content_block_delta",
    delta: { thinking: "\u062f\u0627\u0631\u0645 \u0641\u06a9\u0631 \u0645\u06cc\u200c\u06a9\u0646\u0645" } } });
  window.renderEvent({ type: "wrapper", subtype: "init_info", info: {
    models: [{ key: "sonnet", displayName: "Sonnet", resolvedModel: "claude-sonnet" },
             { key: "opus", displayName: "Opus", resolvedModel: "claude-opus" }] } });
  window.renderEvent({ type: "wrapper", subtype: "posture", posture: "ask", auto_count: 0 });
  await sleep(60);

  /* --- Global ------------------------------------------------------------- */
  const shutAll = () => { for (const c of cards("details.card")) c.open = false; };
  shutAll();
  const toolCards = cards("details.card.tool").length;
  const openedO = key("o", { ctrlKey: true }) && openCount("details.card") > 0;
  out.transcriptToggled = openedO && key("o", { ctrlKey: true })
    && openCount("details.card") === 0 && toolCards > 0;

  const todoWas = openCount("details.card.todos");
  const todoHandled = key("t", { ctrlKey: true });
  const todoNow = openCount("details.card.todos");
  out.todosToggled = todoHandled && cards("details.card.todos").length === 1
    && todoNow !== todoWas;
  shutAll();

  const thinkWas = openCount("details.card.thinking");
  const thinkHandled = key("t", { altKey: true });
  out.thinkingToggled = thinkHandled && cards("details.card.thinking").length === 1
    && openCount("details.card.thinking") !== thinkWas;
  shutAll();

  /* --- the two keys the browser keeps ------------------------------------- */
  type("chizi");
  out.undoFree = !key("z", { ctrlKey: true });
  out.pasteFree = !key("v", { ctrlKey: true });
  // ctrl+x with a SELECTION is cut, and must stay cut; with none it is the
  // TUI's two-stroke prefix (see ctrl+x Enter below).
  input.setSelectionRange(0, input.value.length);
  out.cutFree = !key("x", { ctrlKey: true });
  input.setSelectionRange(input.value.length, input.value.length);

  /* --- clearing, newlines ------------------------------------------------- */
  type("neveshte");
  out.inputCleared = key("l", { ctrlKey: true }) && input.value === "";

  type("alef");
  out.ctrlJNewline = key("j", { ctrlKey: true }) && input.value.includes("\n");

  type("alef");
  out.shiftEnterFree = !key("Enter", { shiftKey: true });

  type("alef\\");
  out.backslashEnter = key("Enter") && input.value === "alef\n";

  /* --- sending ------------------------------------------------------------ */
  type("salam");
  const sentHandled = key("Enter");
  await sleep(60);
  out.submitted = sentHandled && lastCall("/api/message")?.body?.text === "salam";

  type("dovom");
  const prefix = key("x", { ctrlKey: true });     // arm, with nothing selected
  const queued = key("Enter");
  await sleep(60);
  out.queueSubmitted = prefix && queued
    && lastCall("/api/message")?.body?.text === "dovom";

  /* --- the running turn --------------------------------------------------- */
  window.renderEvent({ type: "wrapper", subtype: "user_echo", uuid: "u1", text: "kar" });
  await sleep(30);
  out.escInterrupted = key("Escape") && called("/api/interrupt");
  window.renderEvent({ type: "wrapper", subtype: "idle_sync" });
  window.renderEvent({ type: "wrapper", subtype: "cli_exited", replayed: true });
  await sleep(30);

  /* --- the chips, by keyboard --------------------------------------------- */
  const postureHandled = key("Tab", { shiftKey: true });
  await sleep(40);
  out.postureCycled = postureHandled && called("/api/posture");
  const menu = document.getElementById("menu-popup");
  const modelHandled = key("p", { altKey: true });
  await sleep(20);
  out.modelPicked = modelHandled && !!menu && !menu.hidden;
  document.body.click();
  await sleep(20);

  /* --- the external editor ------------------------------------------------ */
  type("pish-nevis");
  const editorHandled = key("g", { ctrlKey: true });
  await sleep(80);
  out.editorOpened = editorHandled && called("/api/editor")
    && input.value === "AZ VIRAYESHGAR";

  /* --- history ------------------------------------------------------------ */
  type("dast-nevis");
  const upHandled = key("ArrowUp");
  await sleep(60);
  const first = input.value;
  key("ArrowUp");
  await sleep(20);
  const second = input.value;
  out.historyUp = upHandled && first === "porseshe do" && second === "porseshe yek";
  key("ArrowDown");
  await sleep(20);
  const back = input.value;
  key("ArrowDown");
  await sleep(20);
  // Past the newest entry the walk gives the unsent draft back, which is the
  // difference between walking history and losing what you were writing.
  out.historyDown = back === "porseshe do" && input.value === "dast-nevis";
  // A multi-line message keeps its arrows: the caret is not on the first line.
  input.value = "yek\ndo";
  input.setSelectionRange(input.value.length, input.value.length);
  out.arrowsStayInBox = !key("ArrowUp");
  type("");

  /* --- the `@` menu ------------------------------------------------------- */
  type("@nest");
  await sleep(400);
  out.menuOpened = !filePopup.hidden && filePopup.children.length === 2;
  const selected = () => [...filePopup.children]
    .findIndex((li) => li.getAttribute("aria-selected") === "true");
  out.menuNext = key("ArrowDown") && selected() === 1;
  out.menuPrevious = key("ArrowUp") && selected() === 0;
  const tabHandled = key("Tab");
  out.menuAccepted = tabHandled && input.value === "@src/nested.py "
    && filePopup.hidden;
  type("@nest");
  await sleep(400);
  out.menuDismissed = !filePopup.hidden && key("Escape") && filePopup.hidden;
  type("");

  /* --- ctrl+r, the reverse search ----------------------------------------- */
  const hs = document.getElementById("history-search");
  const searchHandled = key("r", { ctrlKey: true });
  await sleep(60);
  out.searchOpened = searchHandled && !hs.hidden && input.value === "";
  type("porseshe");
  await sleep(20);
  const match1 = document.getElementById("hs-match").textContent;
  out.searchNext = key("r", { ctrlKey: true })
    && document.getElementById("hs-match").textContent !== match1;
  // ctrl+r moved the selection on, so what Tab accepts is the SECOND match --
  // the search puts the row you are looking at in the box, not the first hit.
  out.searchTab = key("Tab") && hs.hidden && input.value === "porseshe yek";

  type("");
  key("r", { ctrlKey: true });
  await sleep(60);
  type("yek");
  await sleep(20);
  out.searchEsc = key("Escape") && hs.hidden && input.value === "porseshe yek";

  type("");
  key("r", { ctrlKey: true });
  await sleep(60);
  type("do");
  await sleep(20);
  const enterHandled = key("Enter");
  await sleep(60);
  out.searchEnter = enterHandled && hs.hidden
    && lastCall("/api/message")?.body?.text === "porseshe do";

  /* --- `!` bash mode ------------------------------------------------------ */
  type("!dir");
  out.bashMode = box.classList.contains("bash");
  const bashSent = key("Enter");
  await sleep(60);
  out.bashRan = bashSent && lastCall("/api/shell")?.body?.command === "dir"
    && input.value === "" && !box.classList.contains("bash")
    // A `!` line is NOT a message: it must never reach /api/message.
    && lastCall("/api/message")?.body?.text !== "!dir";
  window.renderEvent({ type: "wrapper", subtype: "shell", command: "dir",
                       stdout: "b.md\nc.md", stderr: "", code: 0 });
  await sleep(30);
  const shellCard = log.querySelector("details.card.shell");
  out.bashRow = !!shellCard
    && shellCard.querySelector(".shell-cmd")?.textContent === "dir"
    && shellCard.querySelector(".shell-cmd")?.getAttribute("dir") === "ltr"
    && !!shellCard.querySelector(".tool-branch")
    && shellCard.querySelector(".card-body .tool-output")?.textContent.includes("b.md");

  /* --- the `?` sheet ------------------------------------------------------ */
  const sheet = document.getElementById("keys");
  type("");
  const sheetHandled = key("?", { shiftKey: true });
  const rows = [...sheet.querySelectorAll(".key-row")];
  out.sheetOpened = sheetHandled && sheet.open && rows.length >= 15;
  // Every row names a key AND says what it does: half a row is worse than none.
  out.sheetRows = rows.every((r) => r.querySelector("kbd")?.textContent
                                    && r.querySelector(".key-what")?.textContent);
  sheet.close();
  type("chetori");
  out.sheetNotInSentence = !key("?", { shiftKey: true });

  document.getElementById("probe-out").textContent =
    "PROBE" + JSON.stringify(out) + "ENDPROBE";
 } catch (err) {
  document.getElementById("probe-out").textContent =
    "PROBE" + JSON.stringify({ error: String(err && err.stack || err) }) + "ENDPROBE";
 }
})();
</script>
"""


def wiki_chords() -> list[tuple[str, str, str]]:
    """(context, chord, action) for every «کلید v2» the prompt's contexts bind.

    The doc is the only source of the chord strings — that is the whole point
    of reading it here. A cell may name more than one key (`shift+Enter` and
    `ctrl+j` both do `chat:newline`); each is its own case.
    """
    rows: list[tuple[str, str, str]] = []
    context = ""
    for line in KEYS_DOC.read_text(encoding="utf-8").splitlines():
        if line.startswith("## "):
            context = re.split(r"[—`]", line[3:], maxsplit=1)[0].strip()
            continue
        if context not in CONTEXTS or not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) != 4 or cells[0].startswith("---") or cells[1] == "Action":
            continue
        for chord in re.findall(r"`([^`]+)`", cells[2]):
            rows.append((context, chord, cells[1].strip("`")))
    return rows


def write_probe() -> None:
    """The probe page IS index.html — anything else would drift away from it."""
    page = (STATIC / "index.html").read_text(encoding="utf-8")
    page = page.replace("{{VERSION}}", "0.0.0")
    marker = '<body class="app">'
    if marker not in page:
        sys.exit("index.html no longer opens with " + marker)
    page = page.replace(marker, '<body class="app" data-render-only>', 1)
    PROBE.write_text(page.replace("</body>", PROBE_JS + "\n</body>", 1), encoding="utf-8")


def checks(m: dict, table: list[tuple[str, str, str]]) -> list[tuple[str, bool, str]]:
    out: list[tuple[str, bool, str]] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        out.append((name, bool(ok), detail))

    check("the binding table still parses out of wiki/tui-keys.md",
          len(table) >= 20, f"{len(table)} bound chords in {len(CONTEXTS)} contexts")

    # The two halves of "one copy". A key in the doc with no scenario is a
    # promise nobody checks; a scenario for a key the doc does not bind is this
    # file inventing bindings of its own.
    missing = sorted({f"{c}/{k}" for c, k, _ in table if (c, k) not in SCENARIOS})
    check("every key the table binds has a case here",
          not missing, ", ".join(missing) or "none unaccounted for")
    bound = {(c, k) for c, k, _ in table}
    extra = sorted({f"{c}/{k}" for c, k in SCENARIOS if (c, k) not in bound})
    check("and no case here binds a key the table does not",
          not extra, ", ".join(extra) or "none invented")

    for context, chord, action in table:
        probe_key, what = SCENARIOS.get((context, chord), (None, ""))
        if probe_key is None:
            continue
        check(f"{context}: {chord} \u2192 {action} \u2014 {what}",
              m.get(probe_key) is True, "" if m.get(probe_key) else "did not fire")

    # V2-PLAN §3.2 rows that are characters rather than chords, plus the
    # promises that are about NOT acting.
    for probe_key, what in [
        ("backslashEnter", "a line ending in `\\` continues on the next one"),
        ("arrowsStayInBox", "the arrows stay in the box when the caret is not on its edge"),
        ("cutFree", "ctrl+x with a selection is still cut"),
        ("menuOpened", "`@` opens the file menu off the CLI's own index"),
        ("bashMode", "`!` recolours the prompt box, as the TUI recolours its bar"),
        ("bashRan", "a `!` line runs through /api/shell and is never sent as a message"),
        ("bashRow", "and its output renders as a `$` row, mono and LTR"),
        ("sheetOpened", "`?` on an empty prompt opens the shortcuts sheet"),
        ("sheetRows", "every row of it names a key and says what the key does"),
        ("sheetNotInSentence", "and `?` inside a sentence is punctuation"),
    ]:
        check(what, m.get(probe_key) is True, "" if m.get(probe_key) else "did not fire")

    return out


def main() -> int:
    edge = find_edge()
    table = wiki_chords()
    write_probe()
    proc = subprocess.Popen(
        [sys.executable, str(HERE / "server.py"), "--cwd", str(HERE.parent), "--no-window"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, encoding="utf-8", errors="replace",
        env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    try:
        base = token = None
        for line in proc.stdout:                     # type: ignore[union-attr]
            found = re.search(r"(http://127\.0\.0\.1:\d+)/\?t=(\S+)", line)
            if found:
                base, token = found.group(1), found.group(2)
                break
        if not base:
            print("FAIL - server never printed a listening URL")
            return 1

        stop = threading.Event()
        threading.Thread(target=hold_sse, args=(base, token, stop), daemon=True).start()
        url = f"{base}/static/_keys_probe.html?t={token}"
        try:
            report = measure(edge, url, 1280, 900)
        except Exception as err:                      # noqa: BLE001 - reported, not raised
            print(f"FAIL - {err}")
            return 1
    finally:
        proc.terminate()
        PROBE.unlink(missing_ok=True)

    results = checks(report, table)
    for name, ok, detail in results:
        print(f"  {'OK  ' if ok else 'FAIL'} {name}" + (f"  -- {detail}" if detail else ""))
    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print(f"{'PASS' if passed == total else 'FAIL'} \u2014 {passed}/{total}")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
