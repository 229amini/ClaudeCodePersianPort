"""Run the spec-test harness headlessly and print its verdict.

The rendering gate (claude-persian-rtl-spec.md test cases) lives in
static/spec-test.html and only means anything inside a real browser engine —
it asserts *computed* styles, so there is no DOM-library substitute. Until now
it was a manual step: start the server, copy the token, open the page, read the
bar. Three things made that a trap:

  - the idle watchdog (server.py:1349) kills the server 10 s after the last SSE
    client leaves, so a headless run that only fetches the page loses the race;
  - a page that never ran at all also shows an empty verdict, which reads like
    a pass to a hurried eye;
  - there is no node on this machine, so Playwright is not an option.

So: boot the server, hold one SSE connection open for the whole run, drive Edge
in headless mode with --dump-dom, and parse #verdict out of the DOM. Free — no
CLI turn is spent. Exit code is the gate: 0 = PASS, 1 = anything else.

    python persian-claude-gui\\run_spec_test.py
"""

from __future__ import annotations

import html
import os
import re
import subprocess
import sys
import tempfile
import threading
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
SERVER = HERE / "server.py"

EDGE_CANDIDATES = (
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
)


def find_edge() -> str:
    for path in EDGE_CANDIDATES:
        if os.path.isfile(path):
            return path
    sys.exit("msedge.exe not found — the spec gate needs a Chromium engine.")


def hold_sse(base: str, token: str, stop: threading.Event) -> None:
    """Keep one SSE client attached so the idle watchdog stays disarmed."""
    try:
        with urllib.request.urlopen(f"{base}/api/events?t={token}", timeout=90) as r:
            while not stop.is_set():
                if not r.readline():
                    return
    except Exception:
        pass   # the run is already over, or the server went away


def main() -> int:
    proc = subprocess.Popen(
        [sys.executable, str(SERVER), "--cwd", str(HERE.parent), "--no-window"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, encoding="utf-8", errors="replace",
        env={**os.environ, "PYTHONIOENCODING": "utf-8"},
    )
    url = None
    try:
        for line in proc.stdout:                     # type: ignore[union-attr]
            match = re.search(r"(http://127\.0\.0\.1:\d+)/\?t=(\S+)", line)
            if match:
                base, token = match.group(1), match.group(2)
                url = f"{base}/static/spec-test.html?t={token}"
                break
        if not url:
            return fail("server never printed a listening URL")

        stop = threading.Event()
        threading.Thread(target=hold_sse, args=(base, token, stop), daemon=True).start()

        with tempfile.TemporaryDirectory() as profile:
            dom = subprocess.run(
                [find_edge(), "--headless=new", "--disable-gpu", "--no-first-run",
                 f"--user-data-dir={profile}", "--virtual-time-budget=8000",
                 "--dump-dom", url],
                capture_output=True, text=True, encoding="utf-8", errors="replace",
                timeout=120,
            ).stdout
        stop.set()
    finally:
        proc.terminate()

    marker = dom.find('id="verdict"')
    # #verdict is the last element before the harness's own <script>; stop
    # there or the script source itself lands in the report.
    tail = dom[marker:].split("<script", 1)[0] if marker >= 0 else ""
    text = html.unescape(re.sub(r"<[^>]+>", " ", tail))
    text = re.sub(r"\s+", " ", text).strip()
    checks = re.search(r"(PASS|FAIL)\s+—\s+(\d+)/(\d+)", text)
    if not checks:
        # An empty #verdict and a page that never loaded look identical from
        # out here, and both are failures. A module that throws lands here.
        return fail("harness never ran — #verdict is empty (module load error, "
                    "a throw before the checks, or the page did not load)")

    verdict, passed, total = checks.group(1), int(checks.group(2)), int(checks.group(3))
    print(f"{verdict} — {passed}/{total}")
    for item in re.findall(r"[✓✗][^✓✗]+", text):
        print("  " + item.strip())
    return 0 if verdict == "PASS" and passed == total else 1


def fail(message: str) -> int:
    print("FAIL — " + message)
    return 1


if __name__ == "__main__":
    sys.exit(main())
