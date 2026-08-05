"""
M2 smoke test — boots server.py, drives one real turn through the CLI, asserts the basics.

    python smoke_test.py

Passes when a `result` event comes back and a wrong token is rejected with 403.
Costs one real CLI turn against the logged-in subscription.

The same turn also verifies the Phase-4 capability mirror, because these are
exactly the claims whose acks lie (wiki/control-protocol.md): `set_model`
answers "success" with an empty body, so only the NEXT turn's system/init proves
it took; `rename_session` writes nothing on a session with no messages, so only
a transcript read proves it; and a permission mode the engine refuses still
comes back cheerful. Nothing here is asserted from an ack alone.
"""
import json
import re
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
SERVER = HERE / "server.py"
WORKDIR = Path(tempfile.mkdtemp(prefix="pcg-smoke-"))

proc = subprocess.Popen(
    [sys.executable, str(SERVER), "--cwd", str(WORKDIR), "--no-window"],
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    text=True, encoding="utf-8", errors="replace", bufsize=1,
)

url = None
deadline = time.time() + 30
while time.time() < deadline:
    line = proc.stdout.readline()
    if not line:
        break
    print("[srv]", line.rstrip())
    match = re.search(r"(http://127\.0\.0\.1:\d+/\?t=[\w\-]+)", line)
    if match:
        url = match.group(1)
        break

if not url:
    print("FAIL: server never printed its URL")
    proc.kill()
    sys.exit(1)

base, token = url.split("/?t=")

# Keep draining server logs so it never blocks on a full stdout pipe.
threading.Thread(target=lambda: [print("[srv]", ln.rstrip()) for ln in proc.stdout],
                 daemon=True).start()

seen: list[str] = []
last: dict[str, dict] = {}     # "type/subtype" -> the most recent such event
done = threading.Event()
usage_done = threading.Event()
init_ready = threading.Event()

PROMPT = "Reply with exactly: PONG"


def read_sse() -> None:
    with urllib.request.urlopen(f"{base}/api/events?t={token}") as resp:
        for raw in resp:
            line = raw.decode("utf-8").rstrip("\n")
            if not line.startswith("data: "):
                continue
            event = json.loads(line[6:])
            key = f"{event.get('type')}/{event.get('subtype', '')}".rstrip("/")
            seen.append(key)
            last[key] = event
            if key == "system/init":
                print("  init:", event.get("session_id"), "|", event.get("model"))
            elif key == "wrapper/init_info":
                init_ready.set()
            elif key == "wrapper/usage":
                print("  usage:", {k: v for k, v in event.items()
                                   if k not in ("type", "subtype")})
                usage_done.set()
            elif event.get("type") == "result":
                print("  result:", repr(event.get("result")))
                done.set()


def post(path: str, payload: dict) -> dict:
    request = urllib.request.Request(
        f"{base}{path}?t={token}", data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(request) as resp:
        return json.loads(resp.read().decode("utf-8"))


def get(path: str) -> dict:
    with urllib.request.urlopen(f"{base}{path}?t={token}") as resp:
        return json.loads(resp.read().decode("utf-8"))


def wait_for(key: str, match=None, timeout: float = 10.0) -> dict:
    """Latest event of that type, once it satisfies `match`. Every one of these
    arrives over SSE, so reading straight after the POST that caused it is a
    race — one that would look exactly like the feature not working."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        event = last.get(key)
        if event and (match is None or match(event)):
            return event
        time.sleep(0.2)
    return last.get(key) or {}


threading.Thread(target=read_sse, daemon=True).start()

# `initialize` answers at spawn, before any user message and for free — that is
# what fills the model picker and the slash popup on a fresh window.
init_ready.wait(timeout=30)
info = (last.get("wrapper/init_info") or {}).get("info") or {}
models = info.get("models") or []
commands = info.get("commands") or []
print(f"init_info: {len(models)} models, {len(commands)} commands")
init_ok = bool(models) and bool(commands)

spawn_posture = wait_for("wrapper/posture").get("posture")
print("posture at spawn:", spawn_posture)

# The pill's contract: the wrapper only moves after the CLI acknowledged, and
# the CLI echoes the new mode back as system/status.
last.pop("system/status", None)
print("POST /api/posture acceptEdits ->", post("/api/posture", {"posture": "acceptEdits"}))
posture_ok = spawn_posture == "ask" and wait_for(
    "wrapper/posture", lambda e: e.get("posture") == "acceptEdits").get("posture") == "acceptEdits"
echo = wait_for("system/status",
                lambda e: e.get("permissionMode") == "acceptEdits").get("permissionMode")
echo_ok = echo == "acceptEdits"
print("system/status echo:", echo)
print("POST /api/posture ask ->", post("/api/posture", {"posture": "ask"}))
back_ok = wait_for("wrapper/posture",
                   lambda e: e.get("posture") == "ask").get("posture") == "ask"

# Switch the model BEFORE the turn, so the turn itself is the proof.
print("POST /api/control set_model haiku ->",
      post("/api/control", {"subtype": "set_model", "params": {"model": "haiku"}}))

body = json.dumps({"text": PROMPT}).encode("utf-8")
request = urllib.request.Request(f"{base}/api/message?t={token}", data=body,
                                 headers={"Content-Type": "application/json"},
                                 method="POST")
print("POST /api/message ->", urllib.request.urlopen(request).status)

ok = done.wait(timeout=120)
# get_context_usage / get_usage / rename_session all run once the turn ends.
usage_done.wait(timeout=30)

model_ok = "haiku" in str((last.get("system/init") or {}).get("model", ""))
print("model this turn ran on:", (last.get("system/init") or {}).get("model"))

usage = last.get("wrapper/usage") or {}
usage_ok = isinstance(usage.get("context"), (int, float))

# The title lands in the transcript, not in the ack — read it back the way the
# sidebar does.
title = None
for _ in range(10):
    for project in get("/api/projects").get("projects", []):
        for session in project.get("sessions", []):
            title = title or session.get("title")
    if title:
        break
    time.sleep(1.0)
print("session title from the transcript:", repr(title))
title_ok = title == PROMPT

print("\nevent types seen:")
for key in dict.fromkeys(seen):
    print(f"  - {key} (x{seen.count(key)})")

auth_ok = False
try:
    urllib.request.urlopen(f"{base}/api/events?t=wrong")
    print("AUTH: FAIL — bad token accepted")
except urllib.error.HTTPError as exc:
    auth_ok = exc.code == 403
    print(f"AUTH: {'ok' if auth_ok else 'FAIL'} — bad token got {exc.code}")

proc.kill()

checks = {
    "turn completed": ok,
    "bad token rejected": auth_ok,
    "initialize served models + commands": init_ok,
    "posture follows the CLI, not the click": posture_ok,
    "posture returns to the cautious one": back_ok,
    "system/status echoes the mode": echo_ok,
    "set_model applied to the next turn": model_ok,
    "usage reported by the CLI": usage_ok,
    "session titled from its first prompt": title_ok,
}
print()
for name, passed in checks.items():
    print(f"  {'ok  ' if passed else 'FAIL'} {name}")
print("\nRESULT:", "PASS" if all(checks.values()) else "FAIL")
sys.exit(0 if all(checks.values()) else 1)
