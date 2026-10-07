"""probe_stop_records.py - what a stopped turn leaves in the TRANSCRIPT (pcg-mkd).

Live, a stopped turn draws «متوقف شد» off its `result` (terminal_reason
aborted_streaming). A reload repaints from the transcript, which has no result
record, so the row can only come back if the transcript says "stopped" in a way
no other path also says it. This prints the records three cases write:

  stop-text   interrupt while the answer is streaming
  stop-perm   interrupt while a Write waits for approval
  deny        the wrapper's own deny (interrupt: False), the turn goes on

Free: a stub Messages API (ANTHROPIC_BASE_URL) answers every request; no
subscription turn is spent. Throwaway project folder, deleted afterwards.

    python persian-claude-gui\\probe_stop_records.py
"""
import http.server, json, os, shutil, subprocess, sys, tempfile, threading, time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from server import transcript_dir  # noqa: E402

MODE = {"slow": False}


class Fake(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)) or b"{}")
        last = (body.get("messages") or [{}])[-1].get("content")
        answered = isinstance(last, list) and any(p.get("type") == "tool_result" for p in last)
        msg = {"id": "m", "type": "message", "role": "assistant", "model": "fake", "content": [],
               "stop_reason": None, "stop_sequence": None, "usage": {"input_tokens": 1, "output_tokens": 1}}
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.end_headers()

        def out(e):
            self.wfile.write(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n".encode())
            self.wfile.flush()

        if not body.get("tools"):         # side requests (titles etc.)
            block, deltas, stop = {"type": "text", "text": ""}, [{"type": "text_delta", "text": "t"}], "end_turn"
        elif MODE["slow"]:
            block, stop = {"type": "text", "text": ""}, "end_turn"
            deltas = [{"type": "text_delta", "text": f"word{i} "} for i in range(40)]
        elif not answered:
            block = {"type": "tool_use", "id": "toolu_x", "name": "Write", "input": {}}
            deltas = [{"type": "input_json_delta", "partial_json": json.dumps(
                {"file_path": str(Path(os.getcwd()) / "x.txt"), "content": "x\n"})}]
            stop = "tool_use"
        else:
            block, deltas, stop = {"type": "text", "text": ""}, [{"type": "text_delta", "text": "ok"}], "end_turn"
        try:
            out({"type": "message_start", "message": msg})
            out({"type": "content_block_start", "index": 0, "content_block": block})
            for d in deltas:
                out({"type": "content_block_delta", "index": 0, "delta": d})
                if MODE["slow"] and body.get("tools"):
                    time.sleep(0.4)
            out({"type": "content_block_stop", "index": 0})
            out({"type": "message_delta", "delta": {"stop_reason": stop, "stop_sequence": None},
                 "usage": {"output_tokens": 1}})
            out({"type": "message_stop"})
        except OSError:
            pass                           # the CLI hung up: that is the interrupt


def run(case: str) -> None:
    project = Path(tempfile.mkdtemp(prefix="pcg-stop-"))
    MODE["slow"] = case == "stop-text"
    api = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Fake)
    threading.Thread(target=api.serve_forever, daemon=True).start()
    env = {**os.environ, "ANTHROPIC_BASE_URL": f"http://127.0.0.1:{api.server_port}",
           "ANTHROPIC_API_KEY": "sk-ant-fake-not-a-key"}
    proc = subprocess.Popen([shutil.which("claude"), "-p", "--verbose", "--output-format", "stream-json",
                             "--input-format", "stream-json", "--permission-prompt-tool", "stdio",
                             "--permission-mode", "default"],
                            cwd=project, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
    events = []

    def reader():
        for line in proc.stdout:
            try:
                events.append(json.loads(line))
            except ValueError:
                pass
    threading.Thread(target=reader, daemon=True).start()

    def send(obj):
        proc.stdin.write(json.dumps(obj) + "\n")
        proc.stdin.flush()

    def wait(pred, secs=60):
        end = time.time() + secs
        while time.time() < end:
            for ev in list(events):
                if pred(ev):
                    return ev
            time.sleep(0.1)
        return None

    try:
        send({"type": "user", "message": {"role": "user", "content": [{"type": "text", "text": "go"}]}})
        if case == "stop-text":
            wait(lambda e: e.get("type") == "assistant" or e.get("type") == "stream_event")
            time.sleep(1.5)
            send({"type": "control_request", "request_id": "i1", "request": {"subtype": "interrupt", "cancel_queued": False}})
        else:
            ask = wait(lambda e: e.get("type") == "control_request"
                       and e["request"].get("subtype") == "can_use_tool")
            if case == "stop-perm":
                send({"type": "control_request", "request_id": "i1", "request": {"subtype": "interrupt", "cancel_queued": False}})
            else:
                send({"type": "control_response", "response": {
                    "subtype": "success", "request_id": ask["request_id"],
                    "response": {"behavior": "deny", "message": "denied by the user", "interrupt": False}}})
        res = wait(lambda e: e.get("type") == "result", 30)
        time.sleep(1.5)                    # let the transcript flush
        print(f"--- {case}: result terminal_reason={res and res.get('terminal_reason')} "
              f"subtype={res and res.get('subtype')} is_error={res and res.get('is_error')}")
        for ev in events:
            if ev.get("type") == "user" or ev.get("type") == "result":
                print("    LIVE", ev.get("type"), json.dumps((ev.get("message") or {}).get("content") or ev.get("terminal_reason"), ensure_ascii=False)[:160])
        folder = transcript_dir(project)
        for f in sorted(folder.glob("*.jsonl")) if folder else []:
            for line in f.read_text(encoding="utf-8").splitlines():
                rec = json.loads(line)
                if rec.get("type") not in ("user", "assistant"):
                    print("   ", rec.get("type"), rec.get("subtype", ""))
                    continue
                content = rec["message"]["content"]
                parts = [content] if isinstance(content, str) else [
                    p.get("text") or (p.get("type") + ":" + str(p.get("content") or p.get("name") or "")[:90])
                    for p in content]
                print("   ", rec["type"], json.dumps(parts, ensure_ascii=False)[:200],
                      "toolUseResult" if "toolUseResult" in rec else "")
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


for c in sys.argv[1:] or ("stop-text", "stop-perm", "deny"):
    run(c)
