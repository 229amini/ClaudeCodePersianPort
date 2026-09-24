"""Render the terminal edition's fixed scene set to PNGs, for a look by eye.

    python persian-claude-gui/shots.py <label> [scene ...]

Writes shots/<label>/<scene>-<W>x<H>.png (git-ignored). This is the visual half of
every BridgeMind-port phase exit (BRIDGEMIND-PORT.md §D14): the numeric gates
passed through a whole redesign while the screen stayed cluttered, so a phase is
not done until these have been looked at next to the reference screenshots in
ref/ (also git-ignored - the reference is a commercial product and this repo is
public).

Nothing here asserts anything. The scenes are driven the way test_split.py
drives the grid: synthetic events through APP.routeEvent on the shipping
index.html, with EventSource stubbed (a live SSE request stops the page from
ever settling - wiki/dev-environment.md) and /api/projects answered from a
canned list so the sidebar looks like a machine with real projects on it.
Every other route goes to the real server, booted through
test_layout.boot_server() so its stdout is drained.

Two headless facts it works around, both measured 2026-09-24:
- `--headless=new` (Edge, and Chromium's own binary) lays the page out in a
  viewport shorter than the window it was asked for (1280x800 -> 713 tall) and
  screenshots the whole window, leaving a dead band at the bottom. The delta is
  measured once per browser, the window is asked for that much taller, and the
  PNG's trailing rows are cut off again (a PNG scanline only ever refers to the
  one ABOVE it, so dropping rows at the bottom needs no pixel decoding).
- Chromium 141 on Linux leaves `form.composer` with a stale 0x0 layout once a
  cell leaves the home state; a same-value `style.contain` write lays it out.
  Harmless on a browser without the bug, so it is always applied.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import threading
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from server import EDITIONS  # noqa: E402
from test_layout import boot_server, find_edge, hold_sse  # noqa: E402

EDITION = os.environ.get("PCG_UI", "terminal")
STATIC = HERE / EDITIONS[EDITION][0]
PROBE = STATIC / "_shot_probe.html"
OUT_ROOT = HERE / "shots"

SIZES = ((1852, 1044), (1280, 800), (1052, 711))
SCENES = ("home", "conversation", "panes3", "panes4", "permission", "newsession",
          "newsession-pair", "bell", "changes")

NO_SSE = '<script>window.EventSource = function () { return { close() {} }; };</script>'

# What /api/projects answers in every shot: a sidebar that looks lived in, with
# a Persian project name, a pinned one and a git repo, instead of whatever this
# machine happens to have (the cloud container has one project, the author PC
# seventeen).
HOUR = 3600.0


def _projects(now: float) -> dict:
    def sess(sid: str, preview: str, ago: float, title: str | None = None) -> dict:
        return {"session_id": sid, "preview": preview, "modified": now - ago, "title": title}

    return {"current_cwd": "", "current_session": None, "projects": [
        {"path": "D:\\projects\\ClaudeCodePersianPort", "modified": now - 300, "git": True,
         "pinned": True, "archived": False, "sessions": [
             sess("sess-1", "نوار وضعیت را یک خطی کن", 300, "یک‌خطی کردن نوار وضعیت"),
             sess("sess-2", "fix the reload test on Linux", 2 * HOUR),
             sess("sess-3", "بررسی تغییرات قاب‌ها", 26 * HOUR)]},
        {"path": "D:\\projects\\وب‌سایت فروشگاه", "modified": now - 5 * HOUR, "git": True,
         "pinned": False, "archived": False, "sessions": [
             sess("sess-4", "صفحهٔ سبد خرید کند است", 5 * HOUR)]},
        {"path": "D:\\projects\\api-server", "modified": now - 50 * HOUR, "git": True,
         "pinned": False, "archived": False, "sessions": [
             sess("sess-5", "add rate limiting to /orders", 50 * HOUR)]},
        {"path": "C:\\Users\\Lion\\Documents\\گزارش‌ها", "modified": now - 200 * HOUR,
         "git": False, "pinned": False, "archived": False, "name": "گزارش‌های ماهانه",
         "sessions": [sess("sess-6", "جدول هزینه‌های شهریور", 200 * HOUR)]},
    ]}


def stub_script(now: float) -> str:
    """A classic script, so it runs before app.js captures `fetch`."""
    canned = json.dumps(_projects(now), ensure_ascii=False)
    return ("<script>(function () {"
            "const real = window.fetch.bind(window);"
            f"const PROJECTS = {canned};"
            "window.fetch = function (url, opts) {"
            "  const path = String(url).split('?')[0];"
            "  if (path === '/api/projects') return Promise.resolve(new Response("
            "    JSON.stringify(PROJECTS), {headers: {'Content-Type': 'application/json'}}));"
            # The scene's own tabs: the real server has none, and its empty answer
            # would take them back out of the sidebar and the pane headers.
            "  if (path === '/api/tabs') return Promise.resolve(new Response("
            "    JSON.stringify(window.__shotTabs || {tabs: [], active: ''}),"
            "    {headers: {'Content-Type': 'application/json'}}));"
            "  return real(url, opts);"
            "};"
            "})();</script>")


# The scenes. Each is a function of the synthetic events only, so two runs draw
# the same picture. Strings are Persian on purpose - the shots are read for
# BiDi as much as for layout.
SCENE_JS = r"""
<script type="module">
import * as APP from "/static/js/app.js";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SCENE = new URLSearchParams(location.search).get("scene");
const TABS = [
  {tab: "t1", title: "یک‌خطی کردن نوار وضعیت", cwd: "D:\\projects\\ClaudeCodePersianPort",
   session_id: "sess-1", busy: false},
  {tab: "t2", title: "صفحهٔ سبد خرید کند است", cwd: "D:\\projects\\وب‌سایت فروشگاه",
   session_id: "sess-4", busy: false},
  {tab: "t3", title: "add rate limiting to /orders", cwd: "D:\\projects\\api-server",
   session_id: "sess-5", busy: false},
  {tab: "t4", title: "جدول هزینه‌های شهریور", cwd: "C:\\Users\\Lion\\Documents\\گزارش‌ها",
   session_id: "sess-6", busy: false},
];
const ev = (tab, e) => APP.routeEvent({tab, ...e});
const useTabs = (list, active) => { window.__shotTabs = {tabs: list, active}; };
const say = (tab, blocks) => ev(tab, {type: "assistant", message: {content: blocks}});
const toolResult = (tab, id, content) =>
  ev(tab, {type: "user", message: {content: [{type: "tool_result", tool_use_id: id, content}]}});

function status(tab, cwd) {
  ev(tab, {type: "system", subtype: "init", model: "claude-opus-5-5", cwd,
           permissionMode: "acceptEdits", output_style: "default",
           session_id: "0f9c2a71-4b3d-4e51-9a77-2c1e5d80ab3f",
           slash_commands: ["clear", "compact", "model", "status", "help"]});
  ev(tab, {type: "wrapper", subtype: "posture", posture: "acceptEdits", auto_count: 0});
  ev(tab, {type: "wrapper", subtype: "effort", effort: "high"});
  ev(tab, {type: "wrapper", subtype: "usage", context: 42, cost: 0.4213, quota: 31});
}

function turn(tab, n) {
  ev(tab, {type: "wrapper", subtype: "user_echo", uuid: "u-" + tab + n,
           text: "نوار وضعیت هر قاب را یک‌خطی کن و میان‌برها را به صفحهٔ کلیدها ببر."});
  say(tab, [{type: "text", text:
    "باشد. اول `render.js` را می‌خوانم تا ببینم `setStatus()` چند ردیف می‌سازد، بعد:\n\n" +
    "- ردیف وضعیت را **یک خط** می‌کنم\n- میان‌برها به صفحهٔ `?` می‌روند\n" +
    "- فایل `D:\\projects\\ClaudeCodePersianPort\\static-terminal\\style.css` هم تغییر می‌کند"}]);
  for (const [i, cmd] of ["git status --short", "grep -n setStatus js/render.js",
                          "python test_shell.py"].entries()) {
    say(tab, [{type: "tool_use", id: "b" + tab + n + i, name: "Bash", input: {command: cmd}}]);
    toolResult(tab, "b" + tab + n + i, i === 2 ? "PASS — 39/39" : " M static-terminal/js/render.js");
  }
  say(tab, [{type: "tool_use", id: "e" + tab + n, name: "Edit", input: {
    file_path: "D:\\projects\\ClaudeCodePersianPort\\static-terminal\\strings.fa.js",
    old_string: '  hintZwnj: "نیم‌فاصله: Shift+Space",\n  hintKeys: "کلیدها: ?",',
    new_string: '  phIdle: "پیام خود را بنویسید — نیم‌فاصله: Shift+Space",'}}]);
  toolResult(tab, "e" + tab + n, "The file has been updated.");
  say(tab, [{type: "text", text:
    "انجام شد. حالا هر قاب فقط **یک خط وضعیت** دارد: سطح اجازه، مدل و کارهای در پس‌زمینه. " +
    "بقیهٔ جزئیات در `/status` است."}]);
}

async function run() {
  if (SCENE === "home") return;
  if (SCENE.startsWith("newsession")) {
    document.getElementById("btn-new").click();
    await sleep(150);
    const page = document.getElementById("new-session");
    const pick = (key) => page.querySelector(`.ns-seg [data-key="${key}"]`).click();
    pick(SCENE === "newsession" ? "group" : "pair");
    const task = page.querySelector(".ns-task");
    task.value = SCENE === "newsession"
      ? "آزمون‌های لینوکس را درست کن و نتیجه را گزارش بده."
      : "صفحهٔ تازه‌ٔ گفتگو را پیاده کن.";
    task.dispatchEvent(new Event("input"));
    return;
  }
  if (SCENE === "conversation" || SCENE === "permission") {
    useTabs([TABS[0]], "t1");
    APP.applyTabs({tabs: [TABS[0]], active: "t1"});
    await sleep(60);
    status("t1", TABS[0].cwd);
    turn("t1", 1);
    ev("t1", {type: "result", subtype: "success", is_error: false, duration_ms: 42000,
              total_cost_usd: 0.42});
    ev("t1", {type: "command_lifecycle", command_uuid: "u-t11", state: "completed"});
    if (SCENE === "permission") {
      ev("t1", {type: "wrapper", subtype: "user_echo", uuid: "u-p",
                text: "همین را برای نسخهٔ وب هم انجام بده."});
      say("t1", [{type: "tool_use", id: "w1", name: "Write", input: {
        file_path: "D:\\projects\\ClaudeCodePersianPort\\static\\strings.fa.js",
        content: "window.FA = {\n  phIdle: \"پیام خود را بنویسید\",\n};\n"}}]);
      ev("t1", {type: "wrapper", subtype: "permission_request", request_id: "r1",
                tool_name: "Write", tool_use_id: "w1", tool_input: {
                  file_path: "D:\\projects\\ClaudeCodePersianPort\\static\\strings.fa.js",
                  content: "window.FA = {\n  phIdle: \"پیام خود را بنویسید\",\n};\n"}});
    }
    return;
  }
  if (SCENE === "panes3") {
    const three = TABS.slice(0, 3);
    useTabs(three, "t1");
    APP.setSplit(3);
    APP.applyTabs({tabs: three, active: "t1"});
    for (let i = 1; i < 3; i++) { APP.focusCell(i); APP.applySwitch(three[i].tab); }
    APP.focusCell(0);
    await sleep(60);
    for (const t of three) status(t.tab, t.cwd);
    turn("t1", 1);
    turn("t2", 1);
    ev("t2", {type: "result", subtype: "success", is_error: false, duration_ms: 8000});
    ev("t2", {type: "command_lifecycle", command_uuid: "u-t21", state: "completed"});
    turn("t3", 1);
    ev("t3", {type: "result", subtype: "success", is_error: false, duration_ms: 8000});
    ev("t3", {type: "command_lifecycle", command_uuid: "u-t31", state: "completed"});
    return;
  }
  if (SCENE === "changes") {
    useTabs([TABS[0]], "t1");
    APP.applyTabs({tabs: [TABS[0]], active: "t1"});
    await sleep(60);
    status("t1", TABS[0].cwd);
    turn("t1", 1);
    const real = window.fetch;
    window.fetch = (url, opts) => {
      const u = String(url);
      if (!u.startsWith("/api/changes")) return real(url, opts);
      const file = new URL(u, location.href).searchParams.get("file");
      const body = file
        ? {state: "ok", path: file, diff: "--- a/x\n+++ b/x\n@@ -12,3 +12,4 @@\n" +
           "   phBusy: \"در حال کار\",\n-  hintZwnj: \"نیم‌فاصله: Shift+Space\",\n" +
           "+  phIdle: \"پیام خود را بنویسید — نیم‌فاصله: Shift+Space\",\n" +
           "+  sendFailedRestored: \"ارسال نشد — متن به جعبهٔ پیام برگشت\",\n" +
           "   sendFailed: \"ارسال ناموفق بود\",\n"}
        : {state: "ok", root: "D:/projects/ClaudeCodePersianPort", files: [
            {path: "static-terminal/strings.fa.js", status: "M", add: 2, del: 1},
            {path: "static-terminal/js/render.js", status: "M", add: 48, del: 12},
            {path: "wiki/یادداشت‌های طراحی.md", status: "?", add: 31, del: 0},
            {path: "static-terminal/style.css", status: "M", add: 120, del: 4}]};
      return Promise.resolve(new Response(JSON.stringify(body),
        {headers: {"Content-Type": "application/json"}}));
    };
    APP.cells[0].changes.open();
    await sleep(120);
    document.querySelector(".ch-file").open = true;
    return;
  }
  if (SCENE === "bell") {
    useTabs(TABS, "t1");
    APP.applyTabs({tabs: TABS, active: "t1"});
    await sleep(60);
    for (const t of TABS) status(t.tab, t.cwd);
    turn("t1", 1);
    ev("t2", {type: "result", subtype: "success", is_error: false, duration_ms: 8000});
    ev("t3", {type: "result", subtype: "success", is_error: true,
              result: "API Error: overloaded", duration_ms: 9000});
    ev("t4", {type: "wrapper", subtype: "permission_request", request_id: "r4",
              tool_name: "Bash", tool_use_id: "b4", tool_input: {command: "npm run build"}});
    await sleep(400);     // the session titles arrive with /api/projects
    document.getElementById("btn-bell").click();
    return;
  }
  if (SCENE === "panes4") {
    useTabs(TABS, "t1");
    APP.setSplit(4);
    APP.applyTabs({tabs: TABS, active: "t1"});
    for (let i = 1; i < 4; i++) { APP.focusCell(i); APP.applySwitch(TABS[i].tab); }
    APP.focusCell(0);
    await sleep(60);
    for (const t of TABS) status(t.tab, t.cwd);
    turn("t1", 1);                                  // t1: running (ledger open)
    turn("t2", 1);                                  // t2: waiting on a person
    ev("t2", {type: "wrapper", subtype: "permission_request", request_id: "r2",
              tool_name: "Bash", tool_use_id: "b2x",
              tool_input: {command: "npm run build"}});
    turn("t3", 1);                                  // t3: failed
    ev("t3", {type: "result", subtype: "success", is_error: true,
              result: "API Error: overloaded", duration_ms: 9000});
    ev("t3", {type: "command_lifecycle", command_uuid: "u-t31", state: "completed"});
    ev("t4", {type: "wrapper", subtype: "user_echo", uuid: "u-t4",
              text: "جمع ستون هزینه را حساب کن."});   // t4: idle, settled
    say("t4", [{type: "text", text: "جمع ستون «هزینه» **۴۸٬۲۰۰٬۰۰۰ ریال** است."}]);
    ev("t4", {type: "result", subtype: "success", is_error: false, duration_ms: 3000});
    ev("t4", {type: "command_lifecycle", command_uuid: "u-t4", state: "completed"});
  }
}

(async () => {
  try { await run(); } catch (err) {
    document.title = "SCENE ERROR " + err;
    console.error(err);
  }
  await sleep(400);
  // Chromium 141 stale-layout workaround (see the module docstring): take the
  // composer out of the box tree and put it back, forcing a layout in between.
  // Every child of every cell, not just the composer: nudging one only moved
  // the stale box onto its next sibling (the status line) - measured.
  const kids = [...document.querySelectorAll(".cell > *")];
  const was = kids.map((k) => k.style.display);
  for (const k of kids) k.style.display = "none";
  void document.body.offsetHeight;
  kids.forEach((k, i) => { k.style.display = was[i]; });
  void document.body.offsetHeight;
})();
</script>
"""


def write_probe(now: float) -> None:
    page = (STATIC / "index.html").read_text(encoding="utf-8")
    page = page.replace("{{VERSION}}", "0.0.0").replace("{{TITLE}}", "shot")
    marker = '<body class="app">'
    if marker not in page:
        sys.exit("index.html no longer opens with " + marker)
    # SHOT_ZOOM=1.25 renders the set in prefs.js's CSS zoom mode at that level
    # (BRIDGEMIND-PORT.md §D13 / M4): what the window would look like if the
    # Windows measurement picks CSS zoom over Edge's own.
    zoom = os.environ.get("SHOT_ZOOM", "")
    zoom_js = (f'<script>document.documentElement.dataset.zoomMode = "css";'
               f'try {{ sessionStorage.setItem("pcg.zoom", {float(zoom)!r}); }} catch (e) {{}}'
               f'</script>') if zoom else ""
    page = page.replace(marker, marker + NO_SSE + zoom_js + stub_script(now), 1)
    PROBE.write_text(page.replace("</body>", SCENE_JS + "\n</body>", 1), encoding="utf-8")


def viewport_delta(browser: str) -> int:
    """How much shorter than the window this browser's viewport is."""
    with tempfile.TemporaryDirectory() as tmp:
        page = Path(tmp) / "vp.html"
        page.write_text('<body><script>document.body.textContent='
                        '"VP" + innerHeight + "VP"</script></body>', encoding="utf-8")
        dom = subprocess.run(
            [browser, "--headless=new", "--disable-gpu", "--no-first-run",
             f"--user-data-dir={Path(tmp) / 'p'}", "--window-size=800,600",
             "--dump-dom", page.as_uri()],
            capture_output=True, text=True, timeout=60).stdout
    try:
        return max(0, 600 - int(dom.split("VP")[1]))
    except (IndexError, ValueError):
        return 0


def _chunk(kind: bytes, body: bytes) -> bytes:
    return (len(body).to_bytes(4, "big") + kind + body
            + zlib.crc32(kind + body).to_bytes(4, "big"))


def crop_png(path: Path, height: int) -> None:
    """Keep the first `height` rows of an 8-bit, non-interlaced PNG."""
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return
    chunks, pos = [], 8
    while pos < len(data):
        size = int.from_bytes(data[pos:pos + 4], "big")
        chunks.append((data[pos + 4:pos + 8], data[pos + 8:pos + 8 + size]))
        pos += 12 + size
    ihdr = chunks[0][1]
    width, old_h = int.from_bytes(ihdr[:4], "big"), int.from_bytes(ihdr[4:8], "big")
    depth, colour, interlace = ihdr[8], ihdr[9], ihdr[12]
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}.get(colour)
    if height >= old_h or interlace or depth != 8 or channels is None:
        return
    stride = 1 + width * channels
    raw = zlib.decompress(b"".join(body for kind, body in chunks if kind == b"IDAT"))
    out = [b"\x89PNG\r\n\x1a\n",
           _chunk(b"IHDR", ihdr[:4] + height.to_bytes(4, "big") + ihdr[8:])]
    out += [_chunk(kind, body) for kind, body in chunks[1:]
            if kind not in (b"IDAT", b"IEND")]
    out += [_chunk(b"IDAT", zlib.compress(raw[:stride * height], 9)), _chunk(b"IEND", b"")]
    path.write_bytes(b"".join(out))


def main() -> int:
    if len(sys.argv) < 2:
        sys.exit(__doc__.split("\n\n")[1])
    label, scenes = sys.argv[1], sys.argv[2:] or list(SCENES)
    unknown = [s for s in scenes if s not in SCENES]
    if unknown:
        sys.exit(f"unknown scene(s) {unknown}; known: {', '.join(SCENES)}")
    browser = find_edge()
    delta = viewport_delta(browser)
    out_dir = OUT_ROOT / label
    out_dir.mkdir(parents=True, exist_ok=True)
    import time
    write_probe(time.time())
    proc, base, token = boot_server(edition=EDITION)
    stop = threading.Event()
    threading.Thread(target=hold_sse, args=(base, token, stop), daemon=True).start()
    written = []
    try:
        for scene in scenes:
            for width, height in SIZES:
                png = out_dir / f"{scene}-{width}x{height}.png"
                with tempfile.TemporaryDirectory() as profile:
                    subprocess.run(
                        [browser, "--headless=new", "--disable-gpu", "--no-first-run",
                         "--hide-scrollbars", f"--user-data-dir={profile}",
                         f"--window-size={width},{height + delta}",
                         "--virtual-time-budget=6000", f"--screenshot={png}",
                         f"{base}/static/{PROBE.name}?t={token}&scene={scene}"],
                        capture_output=True, timeout=180)
                if png.exists():
                    crop_png(png, height)
                    written.append(png)
                else:
                    print(f"  x {png.name}: no file written")
    finally:
        stop.set()
        proc.terminate()
        PROBE.unlink(missing_ok=True)
    for png in written:
        print(f"  {png.relative_to(HERE)}")
    print(f"{len(written)} shots, viewport delta {delta}px")
    return 0 if written else 1


if __name__ == "__main__":
    sys.exit(main())
