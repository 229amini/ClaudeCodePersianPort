"""probe_perm_panes.py - does a permission request show when several panes are open?

User report 2026-10-07 (terminal edition, several panes): a conversation's Edit
and its background agents' Edits timed out after 110 s with no dialog on screen,
while the server had published every request. This drives the real server, the
real CLI against a fake Messages API, and the real Edge (Playwright), two panes,
and asks for a Write in the pane the keyboard is NOT in. Then the same with the
keyboard in the asking pane. Reports where each dialog opened and whether a
person could see it: on screen, non-zero, and the topmost element at its centre.

Author PC only (Playwright), like audit_flows.py. Free: no paid turn.
"""
import http.server, json, os, shutil, sys, tempfile, threading, time, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
EDITION = sys.argv[1] if len(sys.argv) > 1 else "terminal"
os.environ["PCG_UI"] = EDITION
OUT = Path(tempfile.gettempdir()) / "pcg-perm-panes" / EDITION
OUT.mkdir(parents=True, exist_ok=True)
PROJECT = Path(tempfile.mkdtemp(prefix="pcg-permpanes-"))
PENDING = set()
ROUTED = set()
SEQ = [0]


def sse(block, delta, stop):
    msg = {"id": "msg_p", "type": "message", "role": "assistant", "model": "fake", "content": [],
           "stop_reason": None, "stop_sequence": None, "usage": {"input_tokens": 1, "output_tokens": 1}}
    ev = [{"type": "message_start", "message": msg},
          {"type": "content_block_start", "index": 0, "content_block": block},
          {"type": "content_block_delta", "index": 0, "delta": delta},
          {"type": "content_block_stop", "index": 0},
          {"type": "message_delta", "delta": {"stop_reason": stop, "stop_sequence": None},
           "usage": {"output_tokens": 1}},
          {"type": "message_stop"}]
    return "".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in ev).encode()


def last_user(body):
    for m in reversed(body.get("messages") or []):
        if m.get("role") != "user":
            continue
        c = m.get("content")
        if isinstance(c, str):
            return c, False
        done = {p.get("tool_use_id") for p in c if p.get("type") == "tool_result"} & PENDING
        PENDING.difference_update(done)
        # The CLI merges a refused call's result into the NEXT prompt
        # ([tool_result, text]): a text part means a new prompt to route on.
        t = [p.get("text", "") for p in c if p.get("type") == "text"
             and not p.get("text", "").startswith("[Request interrupted")]
        if t and t[-1] not in ROUTED:
            ROUTED.add(t[-1])     # each prompt is routed once; a repeat is history
            return t[-1], False
        return "", True
    return "", False


class Fake(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)) or b"{}")
        txt, answered = last_user(body)
        if not body.get("tools"):
            out = sse({"type": "text", "text": ""}, {"type": "text_delta", "text": "t"}, "end_turn")
        elif "AGENT" in txt and not answered:
            # A background subagent whose own first request asks for a Write
            # (the reported shape: the parent's turn is over by then).
            SEQ[0] += 1
            tid = f"toolu_ag_{SEQ[0]}"
            PENDING.add(tid)
            out = sse({"type": "tool_use", "id": tid, "name": "Agent", "input": {}},
                      {"type": "input_json_delta", "partial_json": json.dumps(
                          {"description": "write a file", "prompt": f"please WRITEz{SEQ[0]}",
                           "subagent_type": "general-purpose", "run_in_background": True})},
                      "tool_use")
        elif answered or "WRITE" not in txt:
            out = sse({"type": "text", "text": ""}, {"type": "text_delta", "text": "done"}, "end_turn")
        else:
            time.sleep(4)          # time to move the keyboard elsewhere first
            SEQ[0] += 1
            tid = f"toolu_w_{SEQ[0]}"
            PENDING.add(tid)
            name = txt.split("WRITE", 1)[1][:1] or "x"
            out = sse({"type": "tool_use", "id": tid, "name": "Write", "input": {}},
                      {"type": "input_json_delta", "partial_json": json.dumps(
                          {"file_path": str(PROJECT / f"{name}.txt"), "content": "x\n"})}, "tool_use")
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.end_headers()
        try:
            self.wfile.write(out)
        except OSError:
            pass


api = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Fake)
threading.Thread(target=api.serve_forever, daemon=True).start()
os.environ.update(ANTHROPIC_BASE_URL=f"http://127.0.0.1:{api.server_port}",
                  ANTHROPIC_API_KEY="sk-ant-fake-not-a-key", PYTHONIOENCODING="utf-8")

from test_layout import boot_server  # noqa: E402
from server import transcript_dir  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

RECENTS = HERE / "recents.json"
RECENTS_WAS = RECENTS.read_bytes() if RECENTS.exists() else None
proc, base, token = boot_server(PROJECT, EDITION)
results = []


def post(path, body):
    r = urllib.request.Request(f"{base}{path}?t={token}", json.dumps(body).encode(),
                               {"Content-Type": "application/json"}, method="POST")
    return json.loads(urllib.request.urlopen(r, timeout=30).read() or b"{}")


SEE = """() => [...document.querySelectorAll('dialog.perm[open], .perm[open]')].map(d => {
  const r = d.getBoundingClientRect();
  const cell = d.closest('.cell');
  const cells = [...document.querySelectorAll('.cell')];
  const top = r.width && r.height
    ? document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(20, r.height / 2)) : null;
  return { pane: cells.indexOf(cell), focusedPane: cells.findIndex(c => c.classList.contains('focused')),
           rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
           onTop: !!top && d.contains(top), topIs: top ? (top.className || top.tagName) : null,
           display: getComputedStyle(d).display, visibility: getComputedStyle(d).visibility,
           cellTab: cell?.dataset?.tab ?? null };
})"""

try:
    with sync_playwright() as pw:
        br = pw.chromium.launch(channel="msedge", headless=True)
        page = br.new_page(viewport={"width": 1400, "height": 860})
        errors = []
        page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
        page.on("console", lambda m: m.type == "error" and errors.append("console: " + m.text))
        page.goto(f"{base}/?t={token}")
        page.wait_for_timeout(1500)
        a = post("/api/project/open", {"path": str(PROJECT)})["tab"]
        b = post("/api/project/open", {"path": str(PROJECT)})["tab"]
        page.wait_for_timeout(2500)
        page.reload()
        page.wait_for_timeout(3000)
        for tab in (a, b):
            print("posture", tab, post("/api/posture", {"posture": "ask", "tab": tab}))
        box = page.locator(".input:visible").first
        box.click()
        box.fill("/split 2")
        box.press("Enter")
        page.wait_for_timeout(1500)
        inputs = page.locator(".cell .input:visible")
        print("panes with a prompt:", inputs.count())
        page.screenshot(path=str(OUT / "0-two-panes.png"))

        def case(name, ask_pane, focus_pane):
            inputs.nth(ask_pane).click()
            inputs.nth(ask_pane).fill(f"please WRITE{name}")
            inputs.nth(ask_pane).press("Enter")
            page.wait_for_timeout(500)
            inputs.nth(focus_pane).click()
            inputs.nth(focus_pane).type("typing here")
            try:
                page.wait_for_selector("dialog.perm[open], .perm[open]", timeout=20000)
                page.wait_for_timeout(400)
            except Exception:
                pass
            seen = page.evaluate(SEE)
            page.screenshot(path=str(OUT / f"{name}.png"))
            print(f"case {name}: asked in pane {ask_pane}, keyboard in pane {focus_pane}: {seen}")
            ok = len(seen) == 1 and seen[0]["onTop"] and seen[0]["rect"][2] > 0
            results.append((name, ok, seen))
            # answer it so the next case starts clean
            # A refused subagent may simply ask again: answer until none is left.
            for _ in range(6):
                if not page.evaluate(SEE):
                    break
                page.evaluate("() => document.querySelector('dialog.perm[open], .perm[open]')"
                              ".dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}))")
                page.wait_for_timeout(2500)
            page.screenshot(path=str(OUT / f"{name}-after.png"))
            print("   visible prompts after:", inputs.count(), "dialogs:", len(page.evaluate(SEE)))
            inputs.nth(focus_pane).fill("", timeout=5000)

        case("A", 0, 1)     # the reported shape: the asking pane is not the focused one
        case("B", 1, 0)
        case("C", 0, 0)
        case("AGENT0", 0, 1)  # background subagent in pane 0, keyboard in pane 1
        print("  tabs:", [(t["tab"][:6], t.get("pending_permission"), t.get("busy"))
                          for t in json.loads(urllib.request.urlopen(
                              f"{base}/api/tabs?t={token}").read())["tabs"]])
        case("AGENT1", 1, 1)  # background subagent, keyboard in its own pane
        # A stop with the dialog up: the CLI withdraws its request
        # (control_cancel_request) and the dialog must close by itself - with no
        # broker timeout any more, nothing else would close it.
        inputs.nth(0).click()
        inputs.nth(0).fill("please WRITES")
        inputs.nth(0).press("Enter")
        try:
            page.wait_for_selector("dialog.perm[open], .perm[open]", timeout=20000)
        except Exception:
            pass
        before = len(page.evaluate(SEE))
        for tab in (a, b):      # which pane holds which tab is the grid's business
            post("/api/interrupt", {"tab": tab})
        page.wait_for_timeout(5000)
        after = page.evaluate(SEE)
        page.screenshot(path=str(OUT / "stop.png"))
        print(f"case STOP: dialogs before stop {before}, after {len(after)}")
        results.append(("STOP", before == 1 and not after, after))
        print("errors:", errors[:6])
        br.close()
finally:
    import subprocess as sp
    sp.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
    try:
        proc.wait(timeout=10)
    except Exception:
        pass
    api.shutdown()
    if RECENTS_WAS is None:
        RECENTS.unlink(missing_ok=True)
    else:
        RECENTS.write_bytes(RECENTS_WAS)
    td = transcript_dir(PROJECT)
    for _ in range(20):
        shutil.rmtree(PROJECT, ignore_errors=True)
        if not PROJECT.exists():
            break
        time.sleep(0.25)
    if td:
        shutil.rmtree(td, ignore_errors=True)

bad = [r for r in results if not r[1]]
print(f"{'FAIL' if bad else 'PASS'} {len(results) - len(bad)}/{len(results)}  shots: {OUT}")
