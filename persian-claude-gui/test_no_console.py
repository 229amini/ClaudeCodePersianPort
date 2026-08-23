"""The server must answer HTTP when launched the way the shortcut launches it.

    python test_no_console.py

The desktop shortcut runs **pythonw.exe**, a GUI-subsystem binary with no
console, where `sys.stderr` is None. Every test in this repo ran the server
under python.exe, so nothing here could see that `log_message`'s
`sys.stderr.write` raises inside `send_response` — before a single byte reaches
the socket. The window showed ERR_EMPTY_RESPONSE and no log said why
(2026-08-07). Same family as the run.vbs failure: a shipped launcher no test
ever used.

Free — no CLI turn. A 403 on an unauthenticated GET is proof enough: it means
the response path completed without a console.
"""
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
PYTHONW = Path(sys.executable).with_name("pythonw.exe")


def listening_port(pid: int) -> int | None:
    out = subprocess.run(["netstat", "-ano", "-p", "TCP"], capture_output=True,
                         text=True, errors="replace").stdout
    for line in out.splitlines():
        f = line.split()
        if len(f) >= 5 and f[3] == "LISTENING" and f[4] == str(pid):
            return int(f[1].rsplit(":", 1)[1])
    return None


if not PYTHONW.exists():
    print(f"SKIP: no pythonw.exe next to {sys.executable}")
    sys.exit(0)

WORKDIR = tempfile.mkdtemp(prefix="pcg-noconsole-")
proc = subprocess.Popen([str(PYTHONW), str(HERE / "server.py"),
                         "--cwd", WORKDIR, "--no-window"])


def _cleanup() -> None:
    """Leave no project behind.

    server.py lists every ~/.claude/projects entry whose recorded cwd still
    exists, plus everything in recents.json — so a temp workdir that outlives
    the test shows up in the window's sidebar as a "pcg-noconsole-…" project, on
    the colleague's PC, right after setup.ps1 ran this. taskkill /T because a
    plain kill orphans the claude child, and Windows will not delete a folder
    that is some process's cwd.
    """
    subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
    try:
        proc.wait(timeout=10)           # taskkill only signals; the cwd is held until it exits
    except Exception:
        pass
    import server                      # same folder; only for the two helpers
    transcripts = server.transcript_dir(Path(WORKDIR))
    for _ in range(20):
        shutil.rmtree(WORKDIR, ignore_errors=True)
        if not Path(WORKDIR).exists():
            break
        time.sleep(0.25)
    if transcripts:
        shutil.rmtree(transcripts, ignore_errors=True)
    server.drop_project_from_lists(str(WORKDIR))


try:
    port = None
    deadline = time.time() + 20
    while time.time() < deadline and port is None:
        time.sleep(0.5)
        port = listening_port(proc.pid)

    if port is None:
        print("FAIL: server under pythonw.exe never listened")
        sys.exit(1)

    try:
        urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=10)
        print("FAIL: unauthenticated GET was served")
        sys.exit(1)
    except urllib.error.HTTPError as exc:
        if exc.code != 403:
            print(f"FAIL: expected 403, got {exc.code}")
            sys.exit(1)
    except Exception as exc:                      # the bug: socket closed, no bytes
        print(f"FAIL: no HTTP response without a console — {exc!r}")
        sys.exit(1)

    print(f"PASS: pythonw.exe server answered on port {port}")
finally:
    _cleanup()          # kills the tree and deletes the temp project
