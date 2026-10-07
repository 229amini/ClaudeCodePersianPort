"""probe_ratelimit.py - what `claude -p` does at a five-hour usage wall (pcg-k02).

The TUI waits at the wall and continues on its own at reset
(autoContinueAtUsageLimit, quota_auto_resume). This asks the same of the
headless CLI the window drives: a stub Messages API answers the FIRST turn with
a 429 carrying the unified rate-limit headers (status rejected, claim
five_hour, reset RESET_IN seconds out) and every later request with a normal
answer. It prints every non-stream line the CLI writes and every request the
stub sees, for WATCH seconds - so "does -p retry by itself after the reset?"
is answered by whether a second request arrives without a second user message.

Free: nothing leaves this machine. Two auth modes:
    python persian-claude-gui\\probe_ratelimit.py          fake API key
    python persian-claude-gui\\probe_ratelimit.py oauth    the machine's own
        login, sent only to the 127.0.0.1 stub (the unified headers are a
        subscription feature and may be ignored for an API key)
"""
import http.server, json, os, shutil, subprocess, sys, tempfile, threading, time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from server import transcript_dir  # noqa: E402

RESET_IN = 20
WATCH = RESET_IN + 40
T0 = time.time()
seen = []          # (t, path, had_tools)
walled = {"done": False}
RESET_AT = int(T0 + RESET_IN)


def stamp():
    return f"{time.time() - T0:6.1f}s"


class Fake(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        print(stamp(), "STUB GET", self.path[:100])
        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)) or b"{}")
        if "count_tokens" in self.path:     # the window's context figure, not a turn
            out = json.dumps({"input_tokens": 100}).encode()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(out)))
            self.end_headers()
            self.wfile.write(out)
            return
        main = bool(body.get("tools"))
        seen.append((time.time() - T0, self.path, main))
        print(stamp(), "STUB POST", self.path[:60], "main" if main else "side")
        if main and not walled["done"]:
            walled["done"] = True
            self.send_response(429)
            for k, v in {
                "content-type": "application/json",
                "anthropic-ratelimit-unified-status": "rejected",
                "anthropic-ratelimit-unified-representative-claim": "five_hour",
                "anthropic-ratelimit-unified-reset": str(RESET_AT),
                "anthropic-ratelimit-unified-5h-utilization": "1.0",
                "anthropic-ratelimit-unified-5h-reset": str(RESET_AT),
                "anthropic-ratelimit-unified-7d-utilization": "0.4",
                "anthropic-ratelimit-unified-7d-reset": str(RESET_AT + 86400),
                "anthropic-ratelimit-unified-fallback": "unavailable",
                "anthropic-ratelimit-unified-overage-status": "rejected",
                "retry-after": str(RESET_IN),
            }.items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(json.dumps({"type": "error", "error": {
                "type": "rate_limit_error", "message": "usage limit reached"}}).encode())
            return
        msg = {"id": "m", "type": "message", "role": "assistant", "model": "fake", "content": [],
               "stop_reason": None, "stop_sequence": None, "usage": {"input_tokens": 1, "output_tokens": 1}}
        ev = [{"type": "message_start", "message": msg},
              {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
              {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "continued"}},
              {"type": "content_block_stop", "index": 0},
              {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None},
               "usage": {"output_tokens": 1}},
              {"type": "message_stop"}]
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.end_headers()
        self.wfile.write("".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in ev).encode())


def window() -> None:
    """The wrapper's own wait (server.py AUTO_RESUME_*), end to end: the real
    server spawns the real CLI against the stub with the machine's login, one
    message goes in over /api/message, and the reset has to bring a second
    request to the stub with no second message from anyone."""
    import urllib.request
    from test_layout import boot_server
    project = Path(tempfile.mkdtemp(prefix="pcg-ratelimit-"))
    api = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Fake)
    threading.Thread(target=api.serve_forever, daemon=True).start()
    os.environ["ANTHROPIC_BASE_URL"] = f"http://127.0.0.1:{api.server_port}"
    os.environ.pop("ANTHROPIC_API_KEY", None)
    proc, base, token = boot_server(cwd=project, edition="terminal")
    phases = []

    def sse():
        with urllib.request.urlopen(f"{base}/api/events?t={token}", timeout=WATCH + 30) as r:
            for raw in r:
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data:"):
                    continue
                ev = json.loads(line[5:])
                if ev.get("subtype") == "auto_resume":
                    phases.append(ev.get("state"))
                    print(stamp(), "SSE auto_resume", ev.get("state"), ev.get("at", ""))
                elif ev.get("type") == "result":
                    print(stamp(), "SSE result", ev.get("terminal_reason"), ev.get("api_error_status"))
    threading.Thread(target=sse, daemon=True).start()

    def call(path, body=None):
        req = urllib.request.Request(f"{base}{path}?t={token}",
                                     data=None if body is None else json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json"},
                                     method="GET" if body is None else "POST")
        with urllib.request.urlopen(req, timeout=60) as res:
            return json.loads(res.read().decode("utf-8"))
    try:
        time.sleep(2)
        tab = call("/api/project/open", {"path": str(project)})["tab"]
        call("/api/message", {"tab": tab, "text": "go"})
        time.sleep(WATCH)
        mains = [s for s in seen if s[2]]
        ok = phases[:2] == ["armed", "fired"] and len(mains) == 2 and mains[1][0] >= RESET_IN
        print(f"--- window: phases {phases}, main requests at {[round(s[0], 1) for s in mains]} "
              f"(reset at {RESET_IN}s) -> {'PASS' if ok else 'FAIL'}")
    finally:
        if os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
        else:
            proc.kill()
        api.shutdown()
        td = transcript_dir(project)
        for _ in range(20):
            shutil.rmtree(project, ignore_errors=True)
            if not project.exists():
                break
            time.sleep(0.25)
        if td:
            shutil.rmtree(td, ignore_errors=True)


def main() -> None:
    if "window" in sys.argv[1:]:
        window()
        return
    oauth = "oauth" in sys.argv[1:]
    project = Path(tempfile.mkdtemp(prefix="pcg-ratelimit-"))
    api = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Fake)
    threading.Thread(target=api.serve_forever, daemon=True).start()
    env = {**os.environ, "ANTHROPIC_BASE_URL": f"http://127.0.0.1:{api.server_port}"}
    if not oauth:
        env["ANTHROPIC_API_KEY"] = "sk-ant-fake-not-a-key"
    else:
        env.pop("ANTHROPIC_API_KEY", None)
    proc = subprocess.Popen([shutil.which("claude"), "-p", "--verbose", "--output-format", "stream-json",
                             "--input-format", "stream-json", "--permission-prompt-tool", "stdio",
                             "--permission-mode", "default"],
                            cwd=project, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")

    def reader():
        for line in proc.stdout:
            try:
                ev = json.loads(line)
            except ValueError:
                print(stamp(), "RAW", line.rstrip()[:200])
                continue
            if ev.get("type") == "stream_event":
                continue
            if ev.get("type") == "system" and ev.get("subtype") == "init":
                print(stamp(), "init apiKeySource=", ev.get("apiKeySource"))
                continue
            if ev.get("type") == "assistant":
                ev = {"assistant": ev["message"].get("content"), "model": ev["message"].get("model"),
                      "error": ev.get("error")}
            elif ev.get("type") == "result":
                ev = {k: ev.get(k) for k in ("subtype", "is_error", "result", "terminal_reason",
                                             "stop_reason", "api_error_status")}
            print(stamp(), json.dumps(ev, ensure_ascii=False)[:700])
    threading.Thread(target=reader, daemon=True).start()
    try:
        proc.stdin.write(json.dumps({"type": "user", "message": {"role": "user", "content": [
            {"type": "text", "text": "go"}]}}) + "\n")
        proc.stdin.flush()
        time.sleep(WATCH)
        mains = [s for s in seen if s[2]]
        print(f"--- {'oauth' if oauth else 'api key'}: {len(mains)} main requests at "
              f"{[round(s[0], 1) for s in mains]} (reset at {RESET_IN}s); "
              f"auto-continued: {len(mains) > 1}")
    finally:
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
        try:
            proc.wait(timeout=10)
        except Exception:
            pass
        api.shutdown()
        td = transcript_dir(project)
        for _ in range(20):
            shutil.rmtree(project, ignore_errors=True)
            if not project.exists():
                break
            time.sleep(0.25)
        if td:
            shutil.rmtree(td, ignore_errors=True)


main()
