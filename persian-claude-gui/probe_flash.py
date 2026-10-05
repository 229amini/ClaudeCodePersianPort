"""probe_flash.py - a live permission request flashes the taskbar, end to end, for free.

The terminal edition flashes its taskbar button on a live `permission_request`
(wiki/grid.md, "The turn-end signal is a taskbar flash"). Driving that needs the
model to ask for a tool, i.e. a paid turn - unless the model is fake. The CLI
honours ANTHROPIC_BASE_URL, so this probe points it at a stub Messages API on
127.0.0.1 that answers "Write a file" and then "done". Measured 2026-10-04 on
CLI 2.1.289: every request goes to the stub, the result reports a cost of about
$0.0002 that nobody is billed for, and nothing reaches Anthropic.

Then: the real server, the real Edge app window (terminal edition), posture
«ask» (the user's own defaultMode may be `auto`, which bypasses the wrapper),
the window minimised, one message. Asserts the stub was asked, the window
POSTed /api/attention, and the Write had NOT run (so the post came from the
permission request, not from a settled turn). Saves a screen grab of the
taskbar for a human look - FlashWindowEx has no read-back.

Windows only, needs a desktop session. Leaves no project behind.
"""
from __future__ import annotations

import ctypes
import http.server
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from ctypes import wintypes
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from server import transcript_dir  # noqa: E402

asked: list[str] = []


class FakeApi(http.server.BaseHTTPRequestHandler):
    """First request with tools: a Write. Anything after a tool_result: text."""
    target = ""

    def log_message(self, *_args):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)) or b"{}")
        asked.append(self.path)
        last = (body.get("messages") or [{}])[-1].get("content")
        answered = isinstance(last, list) and any(
            isinstance(p, dict) and p.get("type") == "tool_result" for p in last)
        if not answered and any(t.get("name") == "Write" for t in body.get("tools") or []):
            block = {"type": "tool_use", "id": "toolu_probe", "name": "Write", "input": {}}
            delta = {"type": "input_json_delta",
                     "partial_json": json.dumps({"file_path": self.target, "content": "x\n"})}
            stop = "tool_use"
        else:
            block = {"type": "text", "text": ""}
            delta = {"type": "text_delta", "text": "done"}
            stop = "end_turn"
        msg = {"id": "msg_probe", "type": "message", "role": "assistant", "model": body.get("model"),
               "content": [], "stop_reason": None, "stop_sequence": None,
               "usage": {"input_tokens": 1, "output_tokens": 1}}
        events = [{"type": "message_start", "message": msg},
                  {"type": "content_block_start", "index": 0, "content_block": block},
                  {"type": "content_block_delta", "index": 0, "delta": delta},
                  {"type": "content_block_stop", "index": 0},
                  {"type": "message_delta", "delta": {"stop_reason": stop, "stop_sequence": None},
                   "usage": {"output_tokens": 1}},
                  {"type": "message_stop"}]
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.end_headers()
        self.wfile.write("".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n"
                                 for e in events).encode())


user32 = ctypes.WinDLL("user32") if os.name == "nt" else None


def app_windows() -> set[int]:
    found: set[int] = set()

    def visit(hwnd, _):
        cls = ctypes.create_unicode_buffer(64)
        user32.GetClassNameW(hwnd, cls, 64)
        size = user32.GetWindowTextLengthW(hwnd)
        if cls.value == "Chrome_WidgetWin_1" and size and user32.IsWindowVisible(hwnd):
            text = ctypes.create_unicode_buffer(size + 1)
            user32.GetWindowTextW(hwnd, text, size + 1)
            if "کلاد فارسی" in text.value:
                found.add(hwnd)
        return True
    user32.EnumWindows(ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)(visit), 0)
    return found


def grab_taskbar(out: Path) -> None:
    ps = ("Add-Type -A System.Windows.Forms,System.Drawing;"
          "$b=[Windows.Forms.Screen]::PrimaryScreen.Bounds;"
          "$i=New-Object Drawing.Bitmap $b.Width,64;$g=[Drawing.Graphics]::FromImage($i);"
          "$g.CopyFromScreen($b.X,$b.Bottom-64,0,0,(New-Object Drawing.Size $b.Width,64));"
          f"$i.Save('{out}')")
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True)


def main() -> int:
    if os.name != "nt":
        print("SKIP - Windows only")
        return 0
    project = Path(tempfile.mkdtemp(prefix="pcg-flash-"))
    FakeApi.target = str(project / "written.txt")
    api = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FakeApi)
    threading.Thread(target=api.serve_forever, daemon=True).start()
    env = {**os.environ, "PYTHONIOENCODING": "utf-8",
           "ANTHROPIC_BASE_URL": f"http://127.0.0.1:{api.server_port}",
           "ANTHROPIC_API_KEY": "sk-ant-probe-not-a-key"}
    before = app_windows()
    lines: list[str] = []
    proc = subprocess.Popen([sys.executable, str(HERE / "server.py"), "--cwd", str(project),
                             "--ui", "terminal"], env=env, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
    # Drained for the whole run (pcg-4hg: an unread pipe wedges the server).
    threading.Thread(target=lambda: [lines.append(l) for l in proc.stdout], daemon=True).start()
    windows: set[int] = set()
    checks: dict[str, bool] = {}
    try:
        def wait_for(pattern: str, start: int = 0, seconds: float = 30):
            end = time.time() + seconds
            while time.time() < end:
                hit = re.search(pattern, "".join(lines[start:]))
                if hit:
                    return hit
                time.sleep(0.3)
            return None

        url = wait_for(r"(http://127\.0\.0\.1:\d+)/\?t=(\S+)")
        if not url:
            raise RuntimeError("server never printed a listening URL")
        base, token = url.group(1), url.group(2)

        def post(path: str, body: dict) -> dict:
            req = urllib.request.Request(f"{base}{path}?t={token}", json.dumps(body).encode(),
                                         {"Content-Type": "application/json"}, method="POST")
            return json.loads(urllib.request.urlopen(req, timeout=30).read() or b"{}")

        if not wait_for(r"/api/events"):
            raise RuntimeError("the app window never connected")
        time.sleep(2)
        post("/api/project/open", {"path": str(project)})
        time.sleep(3)
        post("/api/posture", {"posture": "ask"})
        windows = app_windows() - before
        checks["the app window opened"] = bool(windows)
        for hwnd in windows:
            user32.ShowWindow(hwnd, 6)                  # SW_MINIMIZE: not being looked at
        time.sleep(1.5)
        mark = len(lines)
        post("/api/message", {"text": "write the file"})
        checks["the window POSTed /api/attention"] = bool(wait_for(r"/api/attention", mark))
        checks["the CLI asked the fake API, not Anthropic"] = bool(asked)
        checks["the Write was still waiting on the person"] = not Path(FakeApi.target).exists()
        shot = Path(tempfile.gettempdir()) / "pcg-flash-taskbar.png"
        time.sleep(2)
        grab_taskbar(shot)
        print(f"  taskbar grab (look for the lit app button): {shot}")
    finally:
        for hwnd in windows:
            user32.PostMessageW(hwnd, 0x0010, 0, 0)     # WM_CLOSE
        # taskkill /T: a plain kill orphans the claude child, and Windows will
        # not delete a folder that is a live process's cwd.
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            pass
        api.shutdown()
        transcripts = transcript_dir(project)
        for _ in range(20):
            shutil.rmtree(project, ignore_errors=True)
            if not project.exists():
                break
            time.sleep(0.25)
        if transcripts:
            shutil.rmtree(transcripts, ignore_errors=True)

    for name, ok in checks.items():
        print(f"  {'ok ' if ok else 'FAIL'} {name}")
    failed = [n for n, ok in checks.items() if not ok]
    print(f"{'FAIL' if failed else 'PASS'} - {len(checks) - len(failed)}/{len(checks)}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
