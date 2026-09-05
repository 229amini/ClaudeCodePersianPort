r"""Column gate (v2.2): does the transcript render the TUI's own column?

V2-PLAN.md §6 gives v2.2 the §3.1 rows, ctrl+o and the paste chip, and §7 asks
for every phase's acceptance to be machine-checked. The two gates that already
exist cannot see any of it: `run_spec_test.py` asserts BiDi rules on message
content and never looks at a glyph or presses a key, and `test_layout.py`
measures boxes at three window sizes. So this one drives the shipping
`index.html` headlessly — the same trick, the same Edge, the same probe page
built from the real file — and asks the questions v2.2 is answerable for:

  - the ⏺ marks an assistant row and stands in the SAME gutter as a tool icon,
    which is the whole "one rail" claim;
  - a tool result puts the ⎿ branch and its line count on the row, and the row
    is still one line (the spec gate measures that for the repeat badge; this
    measures it for the branch);
  - ctrl+o opens every result in the column at once, and again shuts them;
  - the checklist marks are the binary's ☐ ☑ ▸, and the directional glyphs
    really do flip under `data-mirror-glyphs` (V2-PLAN §8.9's open question —
    the point of a class is that both answers are one attribute apart);
  - a compact_boundary draws the divider, from the event's own metadata;
  - a subagent's steps render INSIDE the Task row, not beside it;
  - a long paste is parked as a chip, a short one is not, and what is SENT is
    the pasted text rather than the placeholder;
  - `!` output replayed out of a transcript is the same shell card the live
    wrapper/shell event draws, not `<bash-input>` markup in the user's bubble
    (E4/F6).

Free: no CLI turn, no login. The probe page is deleted again on the way out.

    C:\Python314\python.exe persian-claude-gui\test_column.py
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

# The Edge lookup, the SSE hold and the PROBE/ENDPROBE read are the same job
# test_layout.py already does; a second copy would drift from it.
from test_layout import find_edge, hold_sse, measure  # noqa: E402

from server import EDITIONS  # noqa: E402

# The edition decides which UI folder this gate reads. PCG_UI picks it;
# the table itself lives in server.py and is never duplicated.
EDITION = os.environ.get("PCG_UI", "terminal")
STATIC = HERE / EDITIONS[EDITION][0]
PROBE = STATIC / "_column_probe.html"

PROBE_JS = r"""
<pre id="probe-out" hidden></pre>
<script type="module">
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = document.getElementById("log");
const input = document.getElementById("input");
const before = (el, prop) => el && getComputedStyle(el, "::before")[prop];
const centre = (el) => { const r = el.getBoundingClientRect();
                         return Math.round(r.left + r.width / 2); };
const flipped = (el) => {
  // scaleX(-1) is reported as a matrix; the first component is the x scale.
  const t = el ? getComputedStyle(el).transform : "none";
  return /^matrix\(\s*-1/.test(t);
};
const key = (k, init = {}) => document.dispatchEvent(
  new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));

const tool = (id, name, input_) => window.renderEvent({ type: "assistant",
  message: { content: [{ type: "tool_use", id, name, input: input_ }] } });
const result = (id, content, extra = {}) => window.renderEvent({ type: "user",
  ...extra, message: { content: [{ type: "tool_result", tool_use_id: id, content }] } });

(async () => {
 try {
  const out = {};

  /* --- ⏺ on the assistant's own rows, in the tool icons' gutter ----------- */
  window.renderEvent({ type: "assistant", message: { content: [
    { type: "text", text: "\u0641\u0627\u06cc\u0644 \u0631\u0627 \u062e\u0648\u0627\u0646\u062f\u0645." }] } });
  // An ENGLISH answer too: `.msg` is unicode-bidi:plaintext and resolves its
  // own direction, so a logical padding would put these two marks on opposite
  // sides of the same column. That is the defect this pair exists to catch.
  window.renderEvent({ type: "assistant", message: { content: [
    { type: "text", text: "Read the file." }] } });
  tool("t1", "Read", { file_path: "C:\\Temp\\note.md" });
  result("t1", "line one\nline two\nline three");
  await sleep(60);

  const bubbles = [...log.querySelectorAll(":scope > .msg.assistant")];
  const card = log.querySelector("details.card.tool");
  const summary = card?.querySelector(":scope > summary");
  out.marks = bubbles.map((b) => before(b, "content"));
  out.markX = bubbles.map(centre);
  out.iconX = centre(summary.querySelector(".tool-icon"));
  out.markCentres = bubbles.map((b) => {
    // The pseudo-element has no box of its own to read, so measure the gutter
    // it was given: the padding edge the ⏺ is pinned to.
    const cs = getComputedStyle(b);
    const r = b.getBoundingClientRect();
    return Math.round(r.right - parseFloat(cs.paddingRight) / 2);
  });

  /* --- the ⎿ branch ------------------------------------------------------- */
  const branch = summary.querySelector(".tool-branch");
  out.branchText = branch?.textContent ?? "";
  out.branchTitle = branch?.title ?? "";
  out.branchGlyph = branch?.querySelector(".glyph")?.textContent ?? "";
  out.branchMirrored = flipped(branch?.querySelector(".glyph"));
  out.rowHeight = Math.round(summary.getBoundingClientRect().height);
  out.rowOverflow = summary.scrollWidth - summary.clientWidth;
  out.resultInBody = !!card.querySelector(".card-body > .tool-output");

  /* --- ctrl+o, the TUI's transcript mode ---------------------------------- */
  out.openBefore = [...log.querySelectorAll("details.card")].filter((c) => c.open).length;
  out.ctrlOHandled = !key("o", { ctrlKey: true });   // handled => preventDefault
  out.openAfter = [...log.querySelectorAll("details.card")].filter((c) => c.open).length;
  key("o", { ctrlKey: true });
  out.openAgain = [...log.querySelectorAll("details.card")].filter((c) => c.open).length;
  out.cards = log.querySelectorAll("details.card").length;
  // A bare `o` is a character, not a command: it must reach the box.
  out.bareOHandled = !key("o");

  /* --- the checklist ------------------------------------------------------ */
  window.renderEvent({ type: "assistant", message: { content: [{
    type: "tool_use", id: "todo1", name: "TodoWrite", input: { todos: [
      { content: "a", status: "completed" },
      { content: "b", status: "in_progress" },
      { content: "c", status: "pending" }] } }] } });
  await sleep(30);
  const marks = [...log.querySelectorAll(".todos li .todo-mark")];
  out.todoMarks = marks.map((m) => m.textContent);
  out.todoMirrored = marks.map(flipped);

  /* --- the compaction divider --------------------------------------------- */
  window.renderEvent({ type: "system", subtype: "compact_boundary",
    compact_metadata: { trigger: "auto", pre_tokens: 150000, post_tokens: 20000 } });
  const divider = log.querySelector(".divider.compacted");
  out.dividerText = divider?.textContent ?? "";

  /* --- a subagent's steps sit INSIDE the Task row -------------------------- */
  tool("task1", "Task", { subagent_type: "scout", description: "look" });
  await sleep(20);
  const taskCard = [...log.querySelectorAll("details.card.tool")]
    .find((c) => c.dataset.tool === "Task");
  const looseBefore = log.querySelectorAll(":scope > details.card").length;
  window.renderEvent({ type: "assistant", parent_tool_use_id: "task1",
    message: { content: [{ type: "tool_use", id: "child1", name: "Grep",
                           input: { pattern: "needle" } }] } });
  result("child1", "one hit", { parent_tool_use_id: "task1" });
  // The phantom half of the same event family: a sidechain TEXT echo still
  // renders nothing at all, in the column or in the card.
  window.renderEvent({ type: "user", parent_tool_use_id: "task1",
    message: { content: [{ type: "text", text: "PHANTOM PROMPT ECHO" }] } });
  await sleep(30);
  out.childInTask = !!taskCard?.querySelector(".card-body details.card.tool");
  out.childResult = !!taskCard?.querySelector(".card-body .card-body > .tool-output");
  out.looseGrew = log.querySelectorAll(":scope > details.card").length - looseBefore;
  out.phantom = log.textContent.includes("PHANTOM PROMPT ECHO");

  /* --- the paste chip ------------------------------------------------------ */
  // Returns true when the composer TOOK the paste. A synthetic ClipboardEvent
  // has no default action, so nothing is ever inserted by the browser here \u2014
  // "left untouched" has to be read off preventDefault, which is the actual
  // contract: not prevented means the real browser does its own insert, with
  // its own undo entry.
  const paste = (text) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    return !input.dispatchEvent(new ClipboardEvent("paste", {
      clipboardData: dt, bubbles: true, cancelable: true }));
  };
  input.value = "";
  input.focus();
  out.shortTaken = paste("one line, short");
  await sleep(20);
  out.shortParked = document.querySelectorAll("#pastes .paste-chip").length;

  input.value = "";
  const long = "\u067e\u06cc\u0627\u0645\n" + Array.from(
    { length: 39 }, (_, i) => "line " + i).join("\n");
  out.longTaken = paste(long);
  await sleep(20);
  const chip = document.querySelector("#pastes .paste-chip");
  out.chipText = chip?.textContent ?? "";
  out.chipHolds = (chip?.title ?? "").startsWith("\u067e\u06cc\u0627\u0645");
  out.boxAfterPaste = input.value;

  // What actually goes on the wire. The composer POSTs through fetch; stub it
  // and read the body, exactly as spec-test.html proves the permission wire.
  let sent = null;
  const realFetch = window.fetch;
  window.fetch = async (url, init) => {
    sent = { url: String(url), body: init?.body };
    return new Response("{}", { status: 200 });
  };
  document.getElementById("composer").requestSubmit();
  await sleep(80);
  window.fetch = realFetch;
  const body = sent?.body ? JSON.parse(sent.body) : {};
  out.sentText = body.text ?? "";
  out.sentLines = (out.sentText.match(/\n/g) || []).length;
  out.chipsAfterSend = document.querySelectorAll("#pastes .paste-chip").length;

  /* --- the mirror switch is one attribute --------------------------------- */
  document.documentElement.dataset.mirrorGlyphs = "off";
  await sleep(20);
  out.mirroredOff = [...log.querySelectorAll(".glyph.mirror")].some(flipped);
  document.documentElement.dataset.mirrorGlyphs = "on";
  await sleep(20);
  out.mirroredOn = [...log.querySelectorAll(".glyph.mirror")].every(flipped);
  out.mirrorCount = log.querySelectorAll(".glyph.mirror").length;

  /* --- `!` output replayed out of a transcript ----------------------------
     A `!` line is not in the event stream: the wrapper parks its tagged output
     and it rides in front of the next message as its own text block, which is
     the TUI's own tagging (measured in ~/.claude/projects). Left alone the
     user's bubble opens with the raw markup. Last, because it appends to the
     column every measurement above reads. */
  window.renderEvent({ type: "user", message: { content: [
    { type: "text", text: "<bash-input>dir C:\\Users</bash-input>\n"
      + "<bash-stdout>\u06cc\u06a9 \u062e\u0637 \u0641\u0627\u0631\u0633\u06cc"
      + "\nSecond line in English</bash-stdout>" },
    { type: "text", text: "\u0627\u06cc\u0646 \u0631\u0627 \u0628\u0628\u06cc\u0646" },
  ] } });
  await sleep(40);
  const shellCard = [...log.querySelectorAll("details.card.shell")].at(-1);
  const userRow = [...log.querySelectorAll(".msg.user")].at(-1);
  out.replayShellCmd = shellCard?.querySelector(".shell-cmd")?.textContent ?? "";
  out.replayShellOut = (shellCard?.textContent ?? "").includes("Second line in English");
  out.replayBubble = (userRow?.textContent ?? "").trim();
  out.replayRawTags = log.textContent.includes("<bash-");

  document.getElementById("probe-out").textContent =
    "PROBE" + JSON.stringify(out) + "ENDPROBE";
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
    page = page.replace("{{VERSION}}", "0.0.0")
    marker = '<body class="app">'
    if marker not in page:
        sys.exit("index.html no longer opens with " + marker)
    page = page.replace(marker, '<body class="app" data-render-only>', 1)
    PROBE.write_text(page.replace("</body>", PROBE_JS + "\n</body>", 1), encoding="utf-8")


def checks(m: dict) -> list[tuple[str, bool, str]]:
    """Every v2.2 acceptance item, as one assertion each."""
    out: list[tuple[str, bool, str]] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        out.append((name, bool(ok), detail))

    marks = m.get("marks") or []
    check("every assistant row carries the TUI's \u23fa",
          len(marks) == 2 and all("\u23fa" in str(x) for x in marks),
          " / ".join(map(str, marks)) or "no rows")

    # The gutter claim: the mark's own column and the tool icon's column are the
    # same one, whichever direction the paragraph resolved to.
    gutters = m.get("markCentres") or []
    icon = m.get("iconX")
    check("the \u23fa stands in the tool icons' gutter, RTL and LTR alike",
          len(gutters) == 2 and icon is not None
          and all(abs(g - icon) <= 3 for g in gutters),
          f"marks at {gutters}, icon at {icon}")

    check("a tool result puts the \u23bf branch and its count on the row",
          m.get("branchGlyph") == "\u23bf"
          and "\u06f3" in m.get("branchText", "")      # ۳ lines, Persian digits
          and "\u0633\u0637\u0631" in m.get("branchText", ""),
          m.get("branchText", "") or "no branch")

    check("the branch names the key that opens it",
          "ctrl+o" in m.get("branchTitle", ""), m.get("branchTitle", "") or "no title")

    check("the row is still one line, branch included",
          m.get("rowHeight", 99) < 40 and m.get("rowOverflow", 99) <= 1,
          f"{m.get('rowHeight')}px, overflow {m.get('rowOverflow')}")

    check("the output itself is still a direct child of the card body",
          m.get("resultInBody") is True, str(m.get("resultInBody")))

    check("ctrl+o opens every card in the column at once",
          m.get("ctrlOHandled") is True and m.get("openBefore") == 0
          and m.get("openAfter") == m.get("cards") and m.get("cards", 0) >= 1,
          f"{m.get('openBefore')} -> {m.get('openAfter')} of {m.get('cards')}")

    check("ctrl+o again shuts them", m.get("openAgain") == 0, str(m.get("openAgain")))

    check("a bare `o` still reaches the composer",
          m.get("bareOHandled") is False, str(m.get("bareOHandled")))

    check("the checklist uses the binary's \u2610 \u2611 \u25b8",
          m.get("todoMarks") == ["\u2611", "\u25b8", "\u2610"],
          "".join(m.get("todoMarks") or []) or "none")

    check("only the directional checklist mark mirrors",
          m.get("todoMirrored") == [False, True, False],
          str(m.get("todoMirrored")))

    text = m.get("dividerText", "")
    check("a compact_boundary draws the divider, with its own numbers",
          "\u0641\u0634\u0631\u062f\u0647" in text and "\u06f1\u06f5\u06f0" in text,
          text or "no divider")

    check("a subagent's step renders inside the Task row",
          m.get("childInTask") is True and m.get("looseGrew") == 0,
          f"nested={m.get('childInTask')}, loose grew by {m.get('looseGrew')}")

    check("and so does its result",
          m.get("childResult") is True, str(m.get("childResult")))

    check("a sidechain prompt echo still renders nothing",
          m.get("phantom") is False, "leaked" if m.get("phantom") else "dropped")

    check("a short paste is left to the browser, undo and all",
          m.get("shortTaken") is False and m.get("shortParked") == 0
          and m.get("longTaken") is True,
          f"short taken={m.get('shortTaken')}, {m.get('shortParked')} chips, "
          f"long taken={m.get('longTaken')}")

    chip = m.get("chipText", "")
    check("a long paste is parked as one chip counting its newlines",
          "#1" in chip and "+39" in chip and "\u0633\u0637\u0631" in chip,
          chip or "no chip")

    check("the chip carries the real text for the hover",
          m.get("chipHolds") is True, str(m.get("chipHolds")))

    check("the box holds the placeholder, not the paste",
          m.get("boxAfterPaste", "") == chip.replace("\u00d7", ""),
          m.get("boxAfterPaste", "") or "empty")

    check("what is SENT is the pasted text, expanded",
          m.get("sentLines") == 39 and m.get("sentText", "").startswith("\u067e\u06cc\u0627\u0645"),
          f"{m.get('sentLines')} newlines sent")

    check("sending clears the chips", m.get("chipsAfterSend") == 0,
          str(m.get("chipsAfterSend")))

    check("the mirror switch is one attribute, and it works both ways",
          m.get("mirrorCount", 0) >= 2 and m.get("mirroredOff") is False
          and m.get("mirroredOn") is True,
          f"{m.get('mirrorCount')} glyphs, off={m.get('mirroredOff')}, "
          f"on={m.get('mirroredOn')}")

    check("replayed `!` output is a shell card, not tags in the user's bubble",
          m.get("replayShellCmd") == "dir C:\\Users"
          and m.get("replayShellOut") is True
          and m.get("replayRawTags") is False
          and "\u0627\u06cc\u0646 \u0631\u0627 \u0628\u0628\u06cc\u0646"
              in m.get("replayBubble", "")
          and "bash-" not in m.get("replayBubble", ""),
          f"card \u00ab{m.get('replayShellCmd')}\u00bb / "
          f"bubble \u00ab{m.get('replayBubble')}\u00bb"
          + (" / RAW TAGS IN THE COLUMN" if m.get("replayRawTags") else ""))

    return out


def main() -> int:
    edge = find_edge()
    write_probe()
    proc = subprocess.Popen(
        [sys.executable, str(HERE / "server.py"), "--cwd", str(HERE.parent), "--no-window",
         "--ui", EDITION],
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
        url = f"{base}/static/_column_probe.html?t={token}"
        try:
            report = measure(edge, url, 1280, 900)
        except Exception as err:                      # noqa: BLE001 - reported, not raised
            print(f"FAIL - {err}")
            return 1
    finally:
        proc.terminate()
        PROBE.unlink(missing_ok=True)

    results = checks(report)
    for name, ok, detail in results:
        print(f"  {'OK  ' if ok else 'FAIL'} {name}" + (f"  -- {detail}" if detail else ""))
    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print(f"{'PASS' if passed == total else 'FAIL'} \u2014 {passed}/{total}")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
