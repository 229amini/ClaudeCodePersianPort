"""probe_cancel.py - what the CLI says on the pipe when a turn is stopped with a permission pending.

Free: a stub Messages API asks for a Write; nothing answers the can_use_tool
request; then an `interrupt` control_request goes in. Prints every line the CLI
writes after that, so the question "does it withdraw its own request
(control_cancel_request), and with which request_id?" is answered off the wire.
"""
import http.server, json, os, shutil, subprocess, sys, tempfile, threading, time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from server import transcript_dir  # noqa: E402

PROJECT = Path(tempfile.mkdtemp(prefix="pcg-cancel-"))


class Fake(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)) or b"{}")
        last = (body.get("messages") or [{}])[-1].get("content")
        answered = isinstance(last, list) and any(p.get("type") == "tool_result" for p in last)
        if body.get("tools") and not answered:
            block = {"type": "tool_use", "id": "toolu_cancel", "name": "Write", "input": {}}
            delta = {"type": "input_json_delta", "partial_json": json.dumps(
                {"file_path": str(PROJECT / "x.txt"), "content": "x\n"})}
            stop = "tool_use"
        else:
            block, delta, stop = {"type": "text", "text": ""}, {"type": "text_delta", "text": "ok"}, "end_turn"
        msg = {"id": "m", "type": "message", "role": "assistant", "model": "fake", "content": [],
               "stop_reason": None, "stop_sequence": None, "usage": {"input_tokens": 1, "output_tokens": 1}}
        ev = [{"type": "message_start", "message": msg},
              {"type": "content_block_start", "index": 0, "content_block": block},
              {"type": "content_block_delta", "index": 0, "delta": delta},
              {"type": "content_block_stop", "index": 0},
              {"type": "message_delta", "delta": {"stop_reason": stop, "stop_sequence": None},
               "usage": {"output_tokens": 1}},
              {"type": "message_stop"}]
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.end_headers()
        self.wfile.write("".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in ev).encode())


api = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Fake)
threading.Thread(target=api.serve_forever, daemon=True).start()
env = {**os.environ, "ANTHROPIC_BASE_URL": f"http://127.0.0.1:{api.server_port}",
       "ANTHROPIC_API_KEY": "sk-ant-fake-not-a-key"}
proc = subprocess.Popen([shutil.which("claude"), "-p", "--verbose", "--output-format", "stream-json",
                         "--input-format", "stream-json", "--permission-prompt-tool", "stdio",
                         "--permission-mode", "default"],
                        cwd=PROJECT, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                        stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
lines = []
threading.Thread(target=lambda: [lines.append((time.time(), l)) for l in proc.stdout], daemon=True).start()


def send(obj):
    proc.stdin.write(json.dumps(obj) + "\n")
    proc.stdin.flush()


try:
    send({"type": "user", "message": {"role": "user", "content": [{"type": "text", "text": "write x"}]}})
    asked = None
    end = time.time() + 60
    while time.time() < end and not asked:
        for _t, l in list(lines):
            try:
                ev = json.loads(l)
            except ValueError:
                continue
            if ev.get("type") == "control_request" and ev["request"].get("subtype") == "can_use_tool":
                asked = ev
        time.sleep(0.2)
    print("can_use_tool request_id:", asked and asked["request_id"])
    mark = len(lines)
    send({"type": "control_request", "request_id": "pcg-int-1",
          "request": {"subtype": "interrupt", "cancel_queued": False}})
    time.sleep(6)
    for _t, l in lines[mark:]:
        try:
            ev = json.loads(l)
        except ValueError:
            print("RAW", l.rstrip()[:200])
            continue
        if ev.get("type") == "stream_event":
            continue
        print(json.dumps(ev, ensure_ascii=False)[:400])
finally:
    subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
    try:
        proc.wait(timeout=10)
    except Exception:
        pass
    api.shutdown()
    td = transcript_dir(PROJECT)
    for _ in range(20):
        shutil.rmtree(PROJECT, ignore_errors=True)
        if not PROJECT.exists():
            break
        time.sleep(0.25)
    if td:
        shutil.rmtree(td, ignore_errors=True)
