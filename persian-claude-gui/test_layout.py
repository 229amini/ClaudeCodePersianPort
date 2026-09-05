"""Layout gate: does the shipping window survive being made small?

The spec gate (run_spec_test.py) asserts rendering rules on message content and
runs at one window size, so it is structurally blind to the shell: a 500px
window handed #stage 194px for 244px of content and drew the composer and
the welcome box OFF the start edge of the window, with every spec
assertion still green. This measures the real page instead - the same
index.html the app serves, with `data-render-only` (so the SSE stream that
makes --dump-dom hang never opens) and one measuring script appended.

Free: no CLI turn is spent, and the probe page is deleted again on the way out.

    python persian-claude-gui\\test_layout.py
"""

from __future__ import annotations

import html
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
STATIC = HERE / "static"
PROBE = STATIC / "_layout_probe.html"

# 500px is about as narrow as a real window gets: Chromium refuses to make a
# window much smaller, and a --window-size=420 request comes back reporting
# ~490px of viewport.
SIZES = ((1280, 800), (760, 640), (500, 560))

EDGE_CANDIDATES = (
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
)

# Boxes that are supposed to hold more than fits, so scrollWidth > clientWidth
# is their job rather than a defect.
SCROLLERS = ("log", "side-scroll", "table-wrap", "picker", "perm", "slash-popup",
             "tool-output", "diff", "attachments", "ag-log")

# The measuring script. It feeds the capability mirror a plausible `initialize`
# (nothing about the CLI is hardcoded in the app, so no picker has rows until
# something says what the CLI offers), then opens the model picker - the widest
# one, since its rows carry the CLI's own descriptions.
#
# v2.4 moved every picker out of a popup hanging off a chip and into a numbered
# list in the flow (V2-PLAN 3.3). The measurement is the same measurement: full
# width, on screen, rows at their natural height. What it can no longer be is
# the 201px column of the original report, because nothing positions it by hand
# any more - which is the point of keeping the gate pointed at the new shape
# rather than deleting it with the old one.
PROBE_JS = """
<pre id="probe-out" hidden></pre>
<script type="module">
import { applyInitInfo, setPostureState, setEffortState, setOutputStyle }
  from "/static/js/controls.js";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const box = (el) => { const r = el.getBoundingClientRect();
  return {x: Math.round(r.left), y: Math.round(r.top),
          w: Math.round(r.width), h: Math.round(r.height)}; };
const SCROLLERS = new Set(%SCROLLERS%);

(async () => {
 try {
  applyInitInfo({
    models: [
      {value: "default", displayName: "\u067e\u06cc\u0634\u200c\u0641\u0631\u0636 (Opus 5)",
       description: "d", resolvedModel: "claude-opus-5", supportsEffort: true,
       supportedEffortLevels: ["low", "medium", "high"]},
      {value: "sonnet", displayName: "Sonnet 5", description: "d",
       resolvedModel: "claude-sonnet-5", supportsEffort: true,
       supportedEffortLevels: ["low", "medium", "high"]},
    ],
    available_output_styles: ["default", "Explanatory", "Concise"],
    output_style: "default",
  });
  setEffortState("high");
  setOutputStyle("default");
  setPostureState("acceptEdits", 3);
  await sleep(300);

  // Overflow only counts where nothing can scroll to it. A code line inside
  // .tool-output is wider than its box on purpose — an unbreakable npm
  // specifier cannot wrap, and the box around it scrolls. What this is looking
  // for is content that spills with no scrollbar anywhere above it, which is
  // how the whole #stage went off the window.
  const scrolls = (el) => {
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      if (getComputedStyle(node).overflowX !== "visible") return true;
    }
    return false;
  };
  const clipped = () => {
    const out = [];
    for (const el of document.querySelectorAll("body *")) {
      if (el.id === "probe-out" || el.tagName === "PRE" || el.tagName === "CODE") continue;
      if ([...el.classList, el.id].some((c) => SCROLLERS.has(c))) continue;
      if (getComputedStyle(el).display === "none" || scrolls(el)) continue;
      if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1)
        out.push([el.id || el.className, el.scrollWidth, el.clientWidth]);
    }
    return out;
  };

  // The home state, which is what the window opens on.
  const home = {compBox: box(document.querySelector(".comp-box")),
                welcome: box(document.querySelector(".welcome")),
                clipped: clipped()};

  // ...and then the state it spends the rest of its life in. A transcript is
  // the other half of the narrow window: a Windows path, a tool card and its
  // output are all wider than a 280px reading column wants to be.
  const PATH = "C:\\\\Users\\\\Lion\\\\Desktop\\\\\u067e\u0631\u0648\u0698\u0647\\\\note.md";
  renderEvent({type: "assistant", message: {content: [
    {type: "text", text: "\u0641\u0627\u06cc\u0644 `" + PATH + "` \u0631\u0627 \u0628\u0627\u0632 \u06a9\u0631\u062f\u0645."}]}});
  renderEvent({type: "assistant", message: {content: [
    {type: "tool_use", id: "probe1", name: "Write",
     input: {file_path: PATH, content: "\u06cc\u06a9 \u062e\u0637 \u0641\u0627\u0631\u0633\u06cc\\nconst x = 1;"}}]}});
  renderEvent({type: "user", message: {content: [
    {type: "tool_result", tool_use_id: "probe1",
     content: "npm ERR! could not resolve dependency @scope/some-very-long-package-name@1.2.3"}]}});
  await sleep(250);

  // The composer row (pcg-tda): whatever is left on it must sit inside the
  // composer box at one line of height. Before the fix the row could not wrap
  // and the last controls were pushed out of the box. v2.4 took four chips off
  // it (V2-PLAN §2), so the count is smaller and the rule is unchanged.
  const compNow = box(document.querySelector(".comp-box"));
  const chips = [...document.querySelector(".comp-row").children]
    .filter((c) => !c.hidden && getComputedStyle(c).display !== "none" &&
                   c.getBoundingClientRect().width > 0)
    .map((c) => ({id: c.id || c.className, ...box(c)}));

  // Alt+P, which is how the terminal opens this list too - no chip to click.
  document.getElementById("input").dispatchEvent(new KeyboardEvent("keydown",
    {key: "p", altKey: true, bubbles: true, cancelable: true}));
  await sleep(150);
  const menu = document.getElementById("picker");
  const rows = [...menu.querySelectorAll(".opt")];
  let overlap = 0;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1].getBoundingClientRect(), b = rows[i].getBoundingClientRect();
    overlap = Math.max(overlap, Math.round(a.bottom - b.top));
  }
  // A row that gave up its own height is the same defect one step earlier:
  // scrollHeight is what it wanted, clientHeight what the flex box left it.
  const squashed = rows.filter((r) => r.scrollHeight > r.clientHeight + 1).length;

  document.getElementById("probe-out").textContent = "PROBE" + JSON.stringify({
    view: [innerWidth, innerHeight],
    compBox: home.compBox,
    welcome: home.welcome,
    comp: compNow, chips,
    menu: box(menu),
    rows: rows.length,
    overlap, squashed,
    clipped: home.clipped.concat(clipped()),
  }) + "ENDPROBE";
 } catch (err) {
  // A throw in here is indistinguishable from a page that never loaded, and
  // both are failures — but only one of them is the gate's own bug.
  document.getElementById("probe-out").textContent =
    "PROBE" + JSON.stringify({error: String(err && err.stack || err)}) + "ENDPROBE";
 }
})();
</script>
"""


def find_edge() -> str:
    for path in EDGE_CANDIDATES:
        if os.path.isfile(path):
            return path
    sys.exit("msedge.exe not found - this gate needs a Chromium engine.")


def hold_sse(base: str, token: str, stop: threading.Event) -> None:
    """Keep one SSE client attached so the idle watchdog stays disarmed."""
    try:
        with urllib.request.urlopen(f"{base}/api/events?t={token}", timeout=600) as r:
            while not stop.is_set() and r.readline():
                pass
    except Exception:
        pass


def write_probe() -> None:
    """The probe page IS index.html - anything else would drift away from it."""
    page = (STATIC / "index.html").read_text(encoding="utf-8")
    # server.py fills this in when it serves the page; the probe reads the
    # file straight off disk, so it measures a stand-in of the same shape.
    page = page.replace("{{VERSION}}", "0.0.0")
    marker = '<body class="app">'
    if marker not in page:
        sys.exit("index.html no longer opens with " + marker)
    page = page.replace(marker, '<body class="app" data-render-only>', 1)
    script = PROBE_JS.replace("%SCROLLERS%", json.dumps(SCROLLERS))
    PROBE.write_text(page.replace("</body>", script + "\n</body>", 1), encoding="utf-8")


def measure(edge: str, url: str, width: int, height: int) -> dict:
    with tempfile.TemporaryDirectory() as profile:
        dom = subprocess.run(
            [edge, "--headless=new", "--disable-gpu", "--no-first-run",
             f"--user-data-dir={profile}", f"--window-size={width},{height}",
             "--virtual-time-budget=9000", "--dump-dom", url],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=180).stdout
    # Read the <pre>, not the document: the script that fills it carries the
    # same two markers in its own source, so a probe that never ran matches its
    # own template and reports nonsense instead of failing.
    body = dom.split('id="probe-out"', 1)[-1].split("</pre>", 1)[0]
    found = re.search(r"PROBE(.*?)ENDPROBE", body, re.S)
    if not found:
        # A page that never ran and a page with nothing to report look identical
        # from out here, and both are failures.
        raise RuntimeError("the probe never ran (module load error, or a throw)")
    report = json.loads(html.unescape(found.group(1)))
    if report.get("error"):
        raise RuntimeError("the probe threw: " + report["error"].splitlines()[0])
    return report


def main() -> int:
    edge = find_edge()
    write_probe()
    proc = subprocess.Popen(
        [sys.executable, str(HERE / "server.py"), "--cwd", str(HERE.parent), "--no-window"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, encoding="utf-8", errors="replace",
        env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    failures: list[str] = []
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
        url = f"{base}/static/_layout_probe.html?t={token}"

        for width, height in SIZES:
            where = f"{width}x{height}"
            try:
                m = measure(edge, url, width, height)
            except Exception as err:                  # noqa: BLE001 - reported, not raised
                failures.append(f"{where}: {err}")
                continue
            view = m["view"][0]
            for name, rect in (("composer", m["compBox"]), ("welcome", m["welcome"]),
                               ("picker menu", m["menu"])):
                if rect["x"] < 0 or rect["x"] + rect["w"] > view + 1:
                    failures.append(f"{where}: {name} is off the window "
                                    f"(x={rect['x']} w={rect['w']} of {view})")
                if rect["y"] < 0:
                    failures.append(f"{where}: {name} is above the window (y={rect['y']})")
            if m["clipped"]:
                failures.append(f"{where}: content wider than its box - {m['clipped'][:4]}")
            # The composer row (pcg-tda). 3 = attach + folder + send; the four
            # capability chips left in v2.4 (V2-PLAN §2) and the audit counter
            # only appears once a session has audited something. Asserted at
            # all so a row that rendered nothing cannot pass every geometry
            # check below by having no geometry.
            comp = m["comp"]
            if len(m["chips"]) < 3:
                failures.append(f"{where}: only {len(m['chips'])} composer chips rendered")
            for chip in m["chips"]:
                if chip["h"] > 40:
                    failures.append(f"{where}: chip {chip['id']} is {chip['h']}px tall - "
                                    "more than one line")
                if (chip["x"] < comp["x"] - 1 or chip["x"] + chip["w"] > comp["x"] + comp["w"] + 1
                        or chip["y"] < comp["y"] - 1
                        or chip["y"] + chip["h"] > comp["y"] + comp["h"] + 1):
                    failures.append(f"{where}: chip {chip['id']} sits outside the composer box "
                                    f"({chip} vs {comp})")
            # Two, because the initialize above advertises two models. The
            # count is asserted at all so a picker that renders nothing cannot
            # pass every geometry check below by having no geometry.
            if m["rows"] != 2:
                failures.append(f"{where}: the model picker drew {m['rows']} rows, not 2")
            if m["squashed"]:
                failures.append(f"{where}: {m['squashed']} menu rows were shrunk below "
                                "their own content (flex-shrink - they overlap)")
            if m["overlap"] > 1:
                failures.append(f"{where}: menu rows overlap by {m['overlap']}px")
            # A picker squeezed into a column is unreadable long before it is
            # clipped: the reported one came back 201px wide in a 760px window.
            # Since v2.4 it is a row in the flow rather than a box positioned
            # by hand, so what it must not do is come back narrower than the
            # column it was given - measured against the window, because the
            # stage is what is left of the window after the sidebar and the
            # sidebar is not what the report was about.
            if m["menu"]["w"] < min(240, view - 40):
                failures.append(f"{where}: the picker is only {m['menu']['w']}px wide")
            print(f"  {where}: viewport {view}px, menu {m['menu']['w']}x{m['menu']['h']} "
                  f"at ({m['menu']['x']},{m['menu']['y']}), prompt {m['comp']['w']}px")
    finally:
        proc.terminate()
        PROBE.unlink(missing_ok=True)

    if failures:
        print(f"FAIL - {len(failures)} layout problems")
        for item in failures:
            print("  x " + item)
        return 1
    print(f"PASS - {len(SIZES)} window sizes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
