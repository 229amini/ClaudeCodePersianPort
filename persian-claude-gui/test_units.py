"""The pure server-side helpers behind the statusline and clipboard paste.

No server, no CLI, no cost. Run: C:\\Python314\\python.exe test_units.py

Both of these guard failure modes that produce no error message at all —
`run_statusline` swallowed a non-zero exit for months, and `save_pasted_image`
takes bytes straight off a POST body.
"""
import base64
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import server  # noqa: E402

fails = []


def check(name, cond):
    print(("  OK   " if cond else "  FAIL ") + name)
    if not cond:
        fails.append(name)


print("ansi_segments")
segs = server.ansi_segments("\x1b[1;34mD:/p\x1b[0m \x1b[2m|\x1b[0m \x1b[38;5;172mX\x1b[0m")
check("bold+basic fg on one run", segs[0] == {"text": "D:/p", "bold": True, "fg": "#3b8eea"})
check("reset clears style", segs[1] == {"text": " "})
check("dim without colour", segs[2] == {"text": "|", "dim": True})
check("256-colour fg resolves", segs[4]["fg"] == "#d78700")
check("plain text is one run", server.ansi_segments("plain") == [{"text": "plain"}])
check("empty in, empty out", server.ansi_segments("") == [])
check("truecolour fg", server.ansi_segments("\x1b[38;2;255;0;16mz")[0]["fg"] == "#ff0010")
check("background fg pair", server.ansi_segments("\x1b[41;97mz")[0]
      == {"text": "z", "bg": "#cd3131", "fg": "#ffffff"})
check("bare ESC[m resets", server.ansi_segments("\x1b[1ma\x1b[mb")[1] == {"text": "b"})
check("cursor moves are dropped", server.ansi_segments("a\x1b[2Kb") == [{"text": "ab"}])
check("greyscale ramp end", server.xterm_color(255) == "#eeeeee")
check("cube corner", server.xterm_color(231) == "#ffffff")

print("run_statusline: cmd.exe quote stripping")
# The regression this was written for: a command whose exe path is quoted,
# which is every statusLine running node/python out of "C:\Program Files\...".
# shell=True fed that to `cmd /c` and cmd ate the outer quotes.
quoted = f'"{sys.executable}" -c "import sys; sys.stdout.write(sys.stdin.read())"'
check("quoted exe path survives",
      server.run_statusline(quoted, {"cwd": "D:/x"}) == [{"text": '{"cwd": "D:/x"}'}])
check("a failing command is None", server.run_statusline("exit 1", {}) is None)

print("save_pasted_image")
png = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 32).decode()
path = server.save_pasted_image("image/png", png)
check("writes a .png and returns its path", path is not None and path.endswith(".png")
      and Path(path).read_bytes().startswith(b"\x89PNG"))
check("rejects a non-image media type", server.save_pasted_image("text/html", png) is None)
check("rejects bad base64", server.save_pasted_image("image/png", "not!base64") is None)
check("rejects empty payload", server.save_pasted_image("image/png", "") is None)
oversize = base64.b64encode(b"0" * (server.MAX_IMAGE_BYTES + 1)).decode()
check("rejects oversize", server.save_pasted_image("image/png", oversize) is None)
if path:
    os.remove(path)

print("PermissionBroker: AskUserQuestion is a question, not an approval")
# Every one of these fails SILENTLY in production: the question simply never
# reaches the user, or reaches the CLI with an empty answer, and the model says
# "the user did not answer" as though they had walked away.


class _Hub:
    def __init__(self):
        self.events = []

    def publish(self, event):
        self.events.append(event)


def _answer(broker, request_id, **kw):
    """Answer from another thread, the way the window does."""
    threading.Thread(target=lambda: (time.sleep(0.05),
                                     broker.respond(request_id, **kw)),
                     daemon=True).start()


hub = _Hub()
broker = server.PermissionBroker(hub)
broker.set_posture("autoApprove", True)
broker.session_allow.add(server.ASK_TOOL)

# Under «خودکار» AND remembered — both silent paths — a question must still ask.
holder = {}


def _run():
    holder["result"] = broker.request(server.ASK_TOOL, {"questions": []}, "t1")


thread = threading.Thread(target=_run, daemon=True)
thread.start()
time.sleep(0.3)
asked = [e for e in hub.events if e.get("subtype") == "permission_request"]
check("auto-approve posture cannot swallow a question", len(asked) == 1)
if asked:
    _answer(broker, asked[0]["request_id"], decision="allow", remember=False,
            tool_name=server.ASK_TOOL, answers={"Tea or coffee?": "Coffee"})
thread.join(timeout=5)
check("the answer reaches the caller verbatim",
      holder.get("result", {}).get("answers") == {"Tea or coffee?": "Coffee"})

# An ordinary tool under the same posture must still be approved silently —
# the guard above must not have disarmed the posture itself.
check("an ordinary tool is still auto-approved",
      broker.request("Bash", {"command": "x"}, "t2").get("decision") == "allow")

# respond() ignores a non-dict; a garbage `answers` must not become updatedInput.
broker2 = server.PermissionBroker(_Hub())
holder2 = {}
thread2 = threading.Thread(
    target=lambda: holder2.update(
        r=broker2.request("Write", {"file_path": "x"}, "t3")), daemon=True)
thread2.start()
time.sleep(0.3)
pending = list(broker2._pending)
if pending:
    broker2.respond(pending[0], "allow", False, "Write", answers="not-a-dict")
thread2.join(timeout=5)
check("a non-dict answers payload is dropped", holder2.get("r", {}).get("answers") is None)

print(("FAIL — " + ", ".join(fails)) if fails else "PASS — all unit checks")
sys.exit(1 if fails else 0)
