"""Drive every everyday flow end to end, for free: real server, real CLI, fake model, real Edge.

    python persian-claude-gui/audit_flows.py [web|terminal]      (default terminal)

The CLI honours ANTHROPIC_BASE_URL (wiki/dev-environment.md, "A fake model"), so a stub
Messages API here answers by keyword: a plain answer, a Write (allowed, then one refused
with Esc), a Bash call, two AskUserQuestion questions, and an 8-second turn to stop
mid-way with a message queued behind it. Then a reload and a narrow window. Asserts the
dialogs open and answer, every turn settles, the transcript survives the reload, and the
page logs no error and gets no 4xx. Shots land in %TEMP%/pcg-audit/<edition>/.

Playwright is on the author PC only (like audit_ui.py), so this is not a gate. The user's
own allow list may approve Bash outright; that step then says so and moves on.
Built for pcg-b8y (2026-10-07); it found the denied-edit change card, the 400 from
/api/agents, the transcript hidden under the queue strip and the dialog, and the
letterless option description.
"""
import http.server, json, os, shutil, subprocess, sys, tempfile, threading, time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
EDITION = sys.argv[1] if len(sys.argv) > 1 else "terminal"
os.environ["PCG_UI"] = EDITION
OUT = Path(tempfile.gettempdir()) / "pcg-audit" / EDITION
OUT.mkdir(parents=True, exist_ok=True)

PROJECT = Path(tempfile.mkdtemp(prefix="pcg-flows-"))
asked = []
bodies = []   # (last prompt text, every message as JSON) per tool-bearing request


def sse(block, delta, stop):
    msg = {"id": "msg_f", "type": "message", "role": "assistant", "model": "fake",
           "content": [], "stop_reason": None, "stop_sequence": None,
           "usage": {"input_tokens": 1, "output_tokens": 1}}
    ev = [{"type": "message_start", "message": msg},
          {"type": "content_block_start", "index": 0, "content_block": block},
          {"type": "content_block_delta", "index": 0, "delta": delta},
          {"type": "content_block_stop", "index": 0},
          {"type": "message_delta", "delta": {"stop_reason": stop, "stop_sequence": None},
           "usage": {"output_tokens": 1}},
          {"type": "message_stop"}]
    return "".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in ev).encode()


PENDING = set()
SEQ = [0]


def tool(name, inp, tid):
    SEQ[0] += 1
    tid = f"{tid}_{SEQ[0]}"
    PENDING.add(tid)
    return sse({"type": "tool_use", "id": tid, "name": name, "input": {}},
               {"type": "input_json_delta", "partial_json": json.dumps(inp)}, "tool_use")


def text(t):
    return sse({"type": "text", "text": ""}, {"type": "text_delta", "text": t}, "end_turn")


def last_user_text(body):
    for m in reversed(body.get("messages") or []):
        if m.get("role") != "user":
            continue
        c = m.get("content")
        if isinstance(c, str):
            return c, False
        done = {p.get("tool_use_id") for p in c if p.get("type") == "tool_result"} & PENDING
        if done:
            PENDING.difference_update(done)
            return "", True
        texts = [p.get("text", "") for p in c if p.get("type") == "text"]
        return (texts[-1] if texts else ""), False
    return "", False


class Fake(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)) or b"{}")
        txt, answered = last_user_text(body)
        has_tools = bool(body.get("tools"))
        asked.append((self.path, txt[-60:], answered))
        if body.get("tools"):
            bodies.append((txt, json.dumps(body.get("messages"), ensure_ascii=False)))
        if not has_tools:
            out = text("عنوان")
        elif answered:
            out = text("انجام شد. پاسخ `ok` با **پررنگ**.")
        elif "WRITEA" in txt:
            out = tool("Write", {"file_path": str(PROJECT / "a.txt"), "content": "الف\n"}, "toolu_a")
        elif "WRITEB" in txt:
            out = tool("Write", {"file_path": str(PROJECT / "b.txt"), "content": "ب\n"}, "toolu_b")
        elif "BASHC" in txt:
            out = tool("Bash", {"command": "mkdir zz", "description": "ساخت پوشه"}, "toolu_c")
        elif "ASKQ" in txt:
            out = tool("AskUserQuestion", {"questions": [
                {"question": "کدام رنگ؟", "header": "رنگ", "multiSelect": False,
                 "options": [{"label": "سرخ", "description": "گرم"}, {"label": "آبی", "description": "سرد"}]},
                {"question": "کدام اندازه؟", "header": "اندازه", "multiSelect": False,
                 "options": [{"label": "کوچک", "description": "-"}, {"label": "بزرگ", "description": "+"}]},
            ]}, "toolu_q")
        elif "SLOW" in txt:
            time.sleep(8)
            out = text("کند تمام شد")
        else:
            out = text("سلام! این یک پاسخ آزمایشی است با `code` و **پررنگ**.")
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

notes = []


def note(ok, what, extra=""):
    notes.append((ok, what, extra))
    print(("  ok   " if ok else "  FAIL ") + what + (f"  -- {extra}" if extra else ""), flush=True)


# /api/project/open puts the throwaway folder in the dev recents.json (gitignored,
# capped at 10): put the file back as it was, or every run pushes a real project out.
RECENTS = HERE / "recents.json"
RECENTS_WAS = RECENTS.read_bytes() if RECENTS.exists() else None
proc, base, token = boot_server(PROJECT, EDITION)
try:
    with sync_playwright() as pw:
        br = pw.chromium.launch(channel="msedge", headless=True)
        page = br.new_page(viewport={"width": 1280, "height": 800})
        errors = []
        page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
        page.on("console", lambda m: m.type == "error" and errors.append("console: " + m.text))
        page.on("response", lambda r: r.status >= 400 and errors.append(f"http {r.status} {r.request.method} {r.url.split('?')[0]} {(r.request.post_data or '')[:200]}"))
        page.goto(f"{base}/?t={token}")
        page.wait_for_timeout(1500)
        import urllib.request
        # Opened in the THROWAWAY folder (the new-session page defaults to a
        # recent project and would write into the user's real one), then a
        # reload places it.
        r = urllib.request.Request(f"{base}/api/project/open?t={token}",
                                   json.dumps({"path": str(PROJECT)}).encode(),
                                   {"Content-Type": "application/json"}, method="POST")
        urllib.request.urlopen(r, timeout=30).read()
        page.wait_for_timeout(2500)
        page.reload()
        page.wait_for_timeout(3000)
        print("tabs:", urllib.request.urlopen(f"{base}/api/tabs?t={token}").read()[:200])
        req = urllib.request.Request(f"{base}/api/posture?t={token}", json.dumps({"posture": "ask"}).encode(),
                                     {"Content-Type": "application/json"}, method="POST")
        print("posture:", urllib.request.urlopen(req, timeout=30).read()[:120])
        page.wait_for_timeout(800)

        def send(t):
            box = page.locator(".input:visible").first
            box.click()
            box.fill(t)
            box.press("Enter")

        def idle(timeout=30):
            end = time.time() + timeout
            while time.time() < end:
                busy = page.evaluate("() => !!document.querySelector('.pulse') || "
                                     "!![...document.querySelectorAll('.stop')].find(b => !b.hidden && b.offsetParent)")
                if not busy:
                    return True
                page.wait_for_timeout(300)
            return False

        def perm_open(timeout=20):
            try:
                page.wait_for_selector("dialog.perm[open], .perm[open]", timeout=timeout * 1000)
                return True
            except Exception:
                return False

        def shot(name):
            page.screenshot(path=str(OUT / f"{name}.png"))

        # B. plain turn
        send("hello there")
        page.wait_for_timeout(1500)
        note(idle(), "plain turn settles")
        n = page.locator(".msg.assistant").count()
        note(n >= 1 and "آزمایشی" in page.locator(".msg.assistant").last.inner_text(), "answer rendered", str(n))
        users = page.locator(".msg.user").count()
        note(users == 1, "one user row", str(users))
        shot("b-plain")

        # C. Write allowed
        send("please WRITEA")
        note(perm_open(), "permission dialog opens for Write")
        shot("c-perm-write")
        head = page.locator(".perm-tool").first.inner_text()
        note("a.txt" in head, "edit path in the dialog header", head.replace("\n", " | "))
        page.keyboard.press("Digit1") if EDITION == "terminal" else page.locator(".perm-allow:visible").first.click()
        page.wait_for_timeout(2500)
        note((PROJECT / "a.txt").exists(), "allow wrote the file")
        note(idle(), "turn after allow settles")
        shot("c-after-allow")

        # D. Write denied with Esc
        send("please WRITEB")
        note(perm_open(), "permission dialog opens again")
        page.wait_for_timeout(300)
        page.keyboard.press("Escape")
        page.wait_for_timeout(2500)
        note(not (PROJECT / "b.txt").exists(), "Esc denied the write")
        note(idle(), "turn after deny settles")
        shot("d-after-deny")

        # E. Bash with description
        send("run BASHC")
        if perm_open(8):   # the user's own allow list may approve Bash outright
            head = page.locator(".perm-tool").first.inner_text()
            note("ساخت پوشه" in head, "shell description in header", head.replace("\n", " | "))
            shot("e-perm-bash")
            page.keyboard.press("Escape") if EDITION == "terminal" else page.locator(".perm-deny:visible").first.click()
            page.wait_for_timeout(2000)
        else:
            print("  info Bash auto-approved by the user's settings")
        note(idle(), "bash deny settles")

        # F. two questions
        send("ASKQ now")
        note(perm_open(), "question dialog opens")
        tabs = page.locator(".ask-tab").count()
        note(tabs == 2, "two question tabs", str(tabs))
        shot("f-ask-1")
        page.keyboard.press("Digit1")
        page.wait_for_timeout(400)
        vis = page.evaluate("() => [...document.querySelectorAll('.ask-q')].findIndex(s => !s.hidden)")
        note(vis == 1, "picking answer 1 advances to question 2", str(vis))
        page.keyboard.press("Enter")
        page.wait_for_timeout(500)
        still = page.locator("dialog.perm[open], .perm[open]").count()
        note(still >= 1, "Enter on the blank second question does not submit", str(still))
        page.keyboard.press("Digit2")
        page.wait_for_timeout(400)
        shot("f-ask-2")
        page.keyboard.press("Enter")
        page.wait_for_timeout(3000)
        note(page.locator("dialog.perm[open], .perm[open]").count() == 0, "Enter submits once both answered")
        note(idle(), "question turn settles")
        q_sent = [a for a in asked if a[2]]
        shot("f-after-ask")

        # G. slow turn + mid-turn message + stop
        send("SLOW please")
        page.wait_for_timeout(1500)
        busy = page.evaluate("() => !!document.querySelector('.pulse')")
        note(busy, "working line during a slow turn")
        shot("g-working")
        send("second message")
        page.wait_for_timeout(800)
        shot("g-queued")
        stop = page.locator(".stop:visible").first
        if stop.count():
            stop.click()
        else:
            page.keyboard.press("Escape")
        page.wait_for_timeout(1000)
        shot("g-stopped")
        note(idle(40), "after stop + queued message, everything settles")
        shot("g-settled")
        txt = page.locator(".log:visible, #log").first.inner_text()
        note("second message" in txt, "the queued message is in the transcript")

        # H. reload
        rows_before = page.locator(".msg").count()
        before_txt = page.evaluate("() => [...document.querySelectorAll('.msg')].map(m => m.className + ': ' + m.innerText.slice(0, 40))")
        page.reload()
        page.wait_for_timeout(4000)
        rows_after = page.locator(".msg").count()
        after_txt = page.evaluate("() => [...document.querySelectorAll('.msg')].map(m => m.className + ': ' + m.innerText.slice(0, 40))")
        if rows_after != rows_before:
            import difflib
            print("\n".join(difflib.unified_diff(before_txt, after_txt, lineterm="")))
        note(rows_after >= rows_before - 1 and rows_after > 0, "reload keeps the transcript", f"{rows_before} -> {rows_after}")
        note(idle(10), "reload is not busy")
        shot("h-reload")

        # I. narrow window with a dialog
        page.set_viewport_size({"width": 700, "height": 560})
        send("please WRITEA again")
        note(perm_open(), "dialog in a narrow window")
        shot("i-narrow-perm")
        box = page.evaluate("""() => { const d = document.querySelector('dialog.perm[open], .perm[open]');
            const r = d.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom, d.scrollHeight, d.clientHeight,
            innerWidth, innerHeight]; }""")
        note(box[0] >= 0 and box[2] <= box[6] + 1 and box[3] <= box[7] + 1, "narrow dialog on screen", str(box))
        note(box[4] <= box[5] + 2, "narrow dialog needs no scroll", str(box))
        page.keyboard.press("Escape")
        page.wait_for_timeout(2000)
        idle()

        # J. a new conversation from the first answer: the copy's next request
        #    carries the history up to that answer and nothing after it.
        page.set_viewport_size({"width": 1280, "height": 800})
        page.wait_for_timeout(500)
        first = page.locator(".msg.assistant").first
        first.hover()
        page.wait_for_timeout(300)
        btn = first.locator(".msg-fork")
        note(btn.count() == 1, "the first answer offers a fork")
        if btn.count():
            btn.click(force=True)
            page.wait_for_timeout(5000)
            shot("j-forked")
            box = page.locator(".cell.focused .input:visible, .input:visible").first
            box.click()
            box.fill("AFTERFORK")
            box.press("Enter")
            page.wait_for_timeout(1500)
            idle()
            sent = [m for t, m in bodies if t.strip() == "AFTERFORK"]
            note(bool(sent), "the copy reached the model")
            if sent:
                note("hello there" in sent[-1] and "WRITEA" not in sent[-1] and "ASKQ" not in sent[-1],
                     "the copy carries the kept history only",
                     f"hello={'hello there' in sent[-1]} later={'WRITEA' in sent[-1]}")
            shot("j-after-fork")

        note(not errors, "no page/console errors", "; ".join(errors[:6]))
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

bad = [n for n in notes if not n[0]]
print(f"{'FAIL' if bad else 'PASS'} {len(notes) - len(bad)}/{len(notes)}  shots: {OUT}")
