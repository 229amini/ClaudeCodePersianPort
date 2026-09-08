"""Reload gate (R1 / bead pcg-1ug): a reloaded window still shows its transcript.

BOTH EDITIONS, one file, the same `PCG_UI` convention every other static-reading
gate uses - unset is the web edition, `PCG_UI=terminal` is the other one.

WHAT IT PROVES. A conversation's rows have two sources and only one of them
survives a reload: live events go through the hub, whose per-tab backlog is
replayed to every fresh window, while a RESUMED session's transcript is fetched
by the client and published nowhere (the resumed CLI does not re-emit it
either). So the window that reloaded onto a resumed conversation drew the status
line, the usage and the sidebar row - and zero message rows, with the home
greeting over the top of them. This boots a real server, resumes a real session
off disk, and loads the real index.html against it TWICE: the transcript has to
be there both times.

Free: no CLI turn is spent. An idle `--resume` emits no inference-shaped events
and costs no tokens (wiki/cli-stream-json-findings.md), and the session it
resumes is a two-line transcript this file writes into a throwaway project
folder and deletes again - the author's own history is never touched.

THE ONE THING STUBBED, and why it changes nothing here: `window.EventSource`.
A page with a live SSE request never settles under `--headless --dump-dom`
(measured; it is the reason every other probe in this repo carries
`data-render-only`), and this one may not carry that attribute because the whole
point is to let the page boot itself - loadTabs -> applyTabs -> placeIn -> the
backfill. What the stub removes is the hub replay, which for a resumed session
is exactly the nothing this bead is about.

    python persian-claude-gui\\test_reload.py                          (web)
    set PCG_UI=terminal && python persian-claude-gui\\test_reload.py   (terminal)
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import urllib.error
import urllib.request

from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from server import EDITIONS, PROJECTS_DIR                # noqa: E402
from test_layout import find_edge, hold_sse, measure     # noqa: E402

EDITION = os.environ.get("PCG_UI", "web")
STATIC = HERE / EDITIONS[EDITION][0]
PROBE = STATIC / "_reload_probe.html"

# A session id of the shape the CLI writes, so transcript_path() resolves it
# exactly as it resolves a real one.
SESSION_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
# Persian, because the assertion is that a REAL row was drawn from the file -
# a row count alone would pass on a spinner.
SAID = "پیامی که روی دیسک نوشته شده"
ANSWERED = "پاسخی که باید پس از بارگذاری دوباره دیده شود"

CHECKS = 2 + 2 * 3      # the setup pair, then three per page load


def transcript_lines(cwd: Path) -> str:
    """Two turns in the record format read_session() parses."""
    common = {"sessionId": SESSION_ID, "cwd": str(cwd), "version": "2.1.261"}
    rows = [
        {"type": "user", "uuid": "u1", "timestamp": "2026-09-08T10:00:00.000Z",
         "message": {"role": "user", "content": SAID}, **common},
        {"type": "assistant", "uuid": "a1", "timestamp": "2026-09-08T10:00:05.000Z",
         "message": {"role": "assistant",
                     "content": [{"type": "text", "text": ANSWERED}]}, **common},
    ]
    return "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)


PROBE_JS = """
<pre id="probe-out" hidden></pre>
<script type="module">
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cell = () => document.querySelector(".cell") || document.body;
const log = () => cell().querySelector(".log");

/* The page boots itself: nothing here drives it. All this waits for is the two
   round trips a real reload makes - /api/tabs, then the backfill's
   /api/session - and then reports what the column is showing. */
(async () => {
  const out = {};
  try {
    for (let i = 0; i < 60 && !log().childElementCount; i++) await sleep(100);
    out.rows = log().childElementCount;
    out.home = cell().classList.contains("home");
    out.text = log().textContent.replace(/\\s+/g, " ").trim().slice(0, 400);
  } catch (err) {
    out.error = String((err && err.stack) || err);
  }
  document.getElementById("probe-out").textContent =
    "PROBE" + JSON.stringify(out) + "ENDPROBE";
})();
</script>
"""

# Classic script, injected at the top of <body>: classic scripts run before any
# deferred module, so app.js sees the stub rather than the real constructor.
NO_SSE = '<script>window.EventSource = function () { return { close() {} }; };</script>'


def write_probe() -> None:
    """The probe page IS index.html - anything else would drift away from it."""
    page = (STATIC / "index.html").read_text(encoding="utf-8")
    page = page.replace("{{VERSION}}", "0.0.0").replace("{{TITLE}}", "probe")
    marker = '<body class="app">'
    if marker not in page:
        sys.exit("index.html no longer opens with " + marker)
    page = page.replace(marker, marker + NO_SSE, 1)
    PROBE.write_text(page.replace("</body>", PROBE_JS + "\n</body>", 1),
                     encoding="utf-8")


def boot(cwd: Path) -> tuple[subprocess.Popen, str, str]:
    proc = subprocess.Popen(
        [sys.executable, str(HERE / "server.py"), "--cwd", str(cwd), "--no-window",
         "--ui", EDITION],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, encoding="utf-8", errors="replace",
        env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    for line in proc.stdout:                          # type: ignore[union-attr]
        found = re.search(r"(http://127\.0\.0\.1:\d+)/\?t=(\S+)", line)
        if found:
            return proc, found.group(1), found.group(2)
    proc.terminate()
    raise RuntimeError("server never printed a listening URL")


def post(base: str, token: str, path: str, body: dict) -> dict:
    req = urllib.request.Request(
        f"{base}{path}?t={token}", data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.loads(res.read().decode("utf-8"))


def get(base: str, token: str, path: str) -> dict:
    with urllib.request.urlopen(f"{base}{path}?t={token}", timeout=60) as res:
        return json.loads(res.read().decode("utf-8"))


def main() -> int:
    edge = find_edge()
    bad: list[str] = []
    project = Path(tempfile.mkdtemp(prefix="pcg-reload-"))
    folder = PROJECTS_DIR / str(project).replace(":", "-").replace("\\", "-")
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{SESSION_ID}.jsonl").write_text(transcript_lines(project),
                                                encoding="utf-8")
    write_probe()
    proc = None
    stop = threading.Event()
    try:
        proc, base, token = boot(project)
        threading.Thread(target=hold_sse, args=(base, token, stop),
                         daemon=True).start()

        # The window's own resume path, over HTTP: one tab, one CLI, a
        # transcript on disk and NOTHING in the hub that draws a row.
        answer = post(base, token, "/api/session/resume",
                      {"session_id": SESSION_ID, "path": str(project)})
        tab = answer.get("tab") or ""
        if not tab:
            bad.append(f"/api/session/resume opened no tab: {answer}")
        listed = [t for t in get(base, token, "/api/tabs").get("tabs", [])
                  if t.get("tab") == tab]
        if not listed or listed[0].get("session_id") != SESSION_ID:
            bad.append("/api/tabs does not carry the resumed session id "
                       f"({listed}) - the backfill has nothing to ask for")

        # TWICE. The first load is the window the resume opened; the second is
        # the reload the bead is about, and it must be no different.
        for at in (1, 2):
            try:
                m = measure(edge, f"{base}/static/{PROBE.name}?t={token}", 1280, 800)
            except Exception as err:                  # noqa: BLE001
                bad.append(f"load {at}: {err}")
                continue
            where = f"load {at}"
            if m.get("error"):
                bad.append(f"{where}: the probe threw: {m['error']}")
                continue
            if not m["rows"]:
                bad.append(f"{where}: the column is empty - the transcript on "
                           "disk was never fetched (pcg-1ug)")
            if m["home"]:
                bad.append(f"{where}: the home greeting is showing over an open "
                           "conversation")
            if SAID not in m["text"] or ANSWERED not in m["text"]:
                bad.append(f"{where}: the rows are not this session's "
                           f"({m['text'][:120]!r})")
            print(f"  {where}: {m['rows']} rows, home={m['home']}")
    finally:
        stop.set()
        if proc is not None:
            proc.terminate()
        PROBE.unlink(missing_ok=True)
        shutil.rmtree(folder, ignore_errors=True)
        shutil.rmtree(project, ignore_errors=True)

    if bad:
        print(f"FAIL - {len(bad)} problems")
        for item in bad:
            print("  x " + item)
        return 1
    print(f"PASS - {CHECKS}/{CHECKS} ({EDITION} edition)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
