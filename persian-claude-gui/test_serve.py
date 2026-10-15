"""`server.py --serve`: the Linux/SSH mode (wiki/linux-ssh.md), end to end.

Boots the real server the way the systemd unit does, with no window and no SSE
client, and asserts what an SSH user depends on:

  - it listens on the port it was given, and the token is the one in its file;
  - it is still answering after the idle watchdog would have killed a windowed
    server (no client for 45 s) -- an SSH drop must not take Claude with it;
  - the page is told it is remote (`data-host="remote"`), and the two native
    dialogs refuse with 409 instead of opening on a screen nobody looks at;
  - the in-page folder browser's route lists a folder;
  - a restart keeps the token, so a reopened window still gets in.

No CLI turn, no cost: nothing here opens a conversation. ~1 min (the wait).
Run: <python> test_serve.py
"""
import http.client
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
WAIT = 45.0   # > the 30 s grace + 10 s idle a windowed server dies after

fails = []
total = 0


def check(name, cond):
    global total
    total += 1
    print(("  OK   " if cond else "  FAIL ") + name)
    if not cond:
        fails.append(name)


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def request(port, method, path, body=None, host=None):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    headers = {"Content-Type": "application/json"}
    if host:
        headers["Host"] = host
    conn.request(method, path, json.dumps(body) if body is not None else None, headers)
    res = conn.getresponse()
    data = res.read()
    conn.close()
    return res.status, data, res


def boot(port, env):
    proc = subprocess.Popen(
        [sys.executable, str(HERE / "server.py"), "--serve", "--port", str(port),
         "--ui", "terminal", "--quiet", "--cwd", str(HERE)],
        env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise SystemExit("server exited: " + proc.stderr.read().decode("utf-8", "replace"))
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                return proc
        except OSError:
            time.sleep(0.2)
    proc.kill()
    raise SystemExit("server never listened on %d" % port)


def stop(proc):
    proc.kill()
    proc.wait(timeout=10)


cfg = Path(tempfile.mkdtemp(prefix="pcg-serve-cfg-"))
env = dict(os.environ, XDG_CONFIG_HOME=str(cfg), PYTHONIOENCODING="utf-8")
port = free_port()
proc = boot(port, env)
try:
    token_file = cfg / "persian-claude" / "token"
    token = token_file.read_text(encoding="ascii").strip() if token_file.exists() else ""
    check("the token is written to $XDG_CONFIG_HOME/persian-claude/token", len(token) >= 32)

    status, _, _ = request(port, "GET", "/")
    check("no token, no page (403)", status == 403)
    status, page, res = request(port, "GET", "/?t=" + token, host="127.0.0.1:8701")
    check("the token from the file opens the page", status == 200)
    check("the page is told it is remote", b'data-host="remote"' in page)
    check("and its cookie is named for the tunnel's local port",
          "pcg_token_8701=" in (res.getheader("Set-Cookie") or ""))

    q = "?t=" + token
    status, _, _ = request(port, "POST", "/api/project/pick" + q, {})
    check("the native folder dialog refuses (409), it does not open on the server", status == 409)
    status, _, _ = request(port, "POST", "/api/attach/pick" + q, {})
    check("and so does the file dialog", status == 409)
    status, _, _ = request(port, "POST", "/api/editor" + q, {"text": "x"})
    check("and the external editor", status == 409)
    status, data, _ = request(port, "POST", "/api/fs/dirs" + q, {"path": str(HERE)})
    listing = json.loads(data) if status == 200 else {}
    check("the in-page browser lists a folder", "static-terminal" in listing.get("dirs", []))

    print(f"  ...  {WAIT:.0f} s with no window connected")
    time.sleep(WAIT)
    check("still running after the idle watchdog's limit", proc.poll() is None)
    status, _, _ = request(port, "GET", "/api/status" + q)
    check("and still answering", status in (200, 404, 409))
finally:
    stop(proc)

proc = boot(port, env)
try:
    status, _, _ = request(port, "GET", "/?t=" + token)
    check("a restart keeps the token: the old window's link still opens", status == 200)
finally:
    stop(proc)
    shutil.rmtree(cfg, ignore_errors=True)

print(f"\n{'PASS' if not fails else 'FAIL'} - {total - len(fails)}/{total}")
sys.exit(1 if fails else 0)
