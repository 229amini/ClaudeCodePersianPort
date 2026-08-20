"""
M2 smoke test — boots server.py, drives one real turn through the CLI, asserts the basics.

    python smoke_test.py

Passes when the CLI answers the prompt (the `result` body must contain PONG —
an event alone is not proof, see the not-logged-in note below) and a wrong token
is rejected with 403. Costs one real CLI turn against the logged-in subscription.

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
seen_events: list[dict] = []   # the full events, for the ones that arrive twice
last: dict[str, dict] = {}     # "type/subtype" -> the most recent such event
done = threading.Event()
usage_done = threading.Event()
init_ready = threading.Event()
result_event: dict = {}

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
            seen_events.append(event)
            last[key] = event
            if key == "system/init":
                print("  init:", event.get("session_id"), "|", event.get("model"))
            elif key == "wrapper/init_info":
                init_ready.set()
            elif key == "wrapper/usage":
                print("  usage:", {k: v for k, v in event.items()
                                   if k not in ("type", "subtype")})
                # The two requests publish separately now (server.py
                # _publish_usage), and `context` is the slow one -- waking on
                # the first event would read the cost patch and call the
                # context missing.
                if "context" in event:
                    usage_done.set()
            elif event.get("type") == "result":
                print("  result:", repr(event.get("result")))
                result_event.update(event)
                done.set()


def post(path: str, payload: dict) -> dict:
    request = urllib.request.Request(
        f"{base}{path}?t={token}", data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST")
    # Every wait below is bounded; these were not. setup.ps1 pipes this test
    # and a blocked request froze the whole bootstrap with no Persian message
    # (observed 2026-08-07 after the SSE thread died). Fail, never hang.
    with urllib.request.urlopen(request, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def get(path: str) -> dict:
    with urllib.request.urlopen(f"{base}{path}?t={token}", timeout=30) as resp:
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

# Plan mode is the CLI's own `plan`, so the only question worth asking is
# whether the engine takes it -- set_permission_mode is documented to ack modes
# nobody asked for (`manual` -> `default`), so the echo is the assertion, not
# the ack. The exit half (approving ExitPlanMode drops the CLI back out of plan
# by itself, and sync_cli_mode has to follow it) needs a real planning turn and
# is not in this one-turn budget.
last.pop("system/status", None)
print("POST /api/posture plan ->", post("/api/posture", {"posture": "plan"}))
plan_ok = wait_for("wrapper/posture",
                   lambda e: e.get("posture") == "plan").get("posture") == "plan"
plan_echo = wait_for("system/status",
                     lambda e: e.get("permissionMode") == "plan").get("permissionMode")
print("system/status echo:", plan_echo)
plan_ok = plan_ok and plan_echo == "plan"

print("POST /api/posture ask ->", post("/api/posture", {"posture": "ask"}))
back_ok = wait_for("wrapper/posture",
                   lambda e: e.get("posture") == "ask").get("posture") == "ask"

# Reasoning effort. The point of this check is that apply_flag_settings acks an
# EMPTY object for a level it then ignores, so only the get_settings read-back
# means anything -- /api/effort reports that, never the ack. "max" is the live
# proof: every model advertises it in supportedEffortLevels and the settings
# schema (low/medium/high/xhigh) drops it. If this check ever starts failing on
# "max", the CLI grew a fifth level and the chip will pick it up on its own.
#
# It must also never write the user's REAL settings file. The CLI's own /effort
# persists to userSettings; apply_flag_settings only creates a session overlay,
# and that difference is the whole reason this route is acceptable at all.
user_settings = Path.home() / ".claude" / "settings.json"
settings_before = user_settings.read_bytes() if user_settings.exists() else b""

effort_low = post("/api/effort", {"level": "low"})
effort_bad = post("/api/effort", {"level": "max"})
print("POST /api/effort low ->", effort_low, " max ->", effort_bad)
effort_ok = (effort_low.get("ok") and effort_low.get("effort") == "low"
             and not effort_bad.get("ok") and effort_bad.get("effort") != "max")
# Output style, the same apply_flag_settings route with the opposite problem:
# `outputStyle` has NO schema behind it (measured 2026-08-08), so a nonsense
# name is accepted and echoed back by both read-backs. Nothing downstream can
# catch a typo, which is why /api/output-style refuses a name the CLI never
# advertised -- that 400 is the check below. Applied BEFORE the turn, because
# system/init.output_style is the only proof the CLI itself agreed; reading
# get_settings would just be reading back our own write.
styles = info.get("available_output_styles") or []
style_pick = next((name for name in styles if name != "default"), None)
style_res = post("/api/output-style", {"style": style_pick}) if style_pick else {}
print("POST /api/output-style", style_pick, "->", style_res)
try:
    post("/api/output-style", {"style": "nonsense-style"})
    style_guard_ok = False
except urllib.error.HTTPError as exc:
    style_guard_ok = exc.code == 400
print("unadvertised style rejected:", style_guard_ok)

# Covers BOTH apply_flag_settings writes above: neither may touch the real file.
settings_kept = (user_settings.read_bytes() if user_settings.exists() else b"") == settings_before

# Switch the model BEFORE the turn, so the turn itself is the proof.
print("POST /api/control set_model haiku ->",
      post("/api/control", {"subtype": "set_model", "params": {"model": "haiku"}}))

body = json.dumps({"text": PROMPT}).encode("utf-8")
request = urllib.request.Request(f"{base}/api/message?t={token}", data=body,
                                 headers={"Content-Type": "application/json"},
                                 method="POST")
print("POST /api/message ->", urllib.request.urlopen(request, timeout=30).status)

ok = done.wait(timeout=120)
# get_context_usage / get_usage / rename_session all run once the turn ends.
# Generous on purpose: get_context_usage is the slow one (server.py
# CONTEXT_USAGE_TIMEOUT), and a wait shorter than its budget turns "the CLI was
# still thinking" into "the wrapper never published usage".
usage_done.wait(timeout=90)

# A `result` event arriving proves nothing. A CLI that is not logged in answers
# `result` with subtype **success**, is_error unset, cost 0 and the body
# "Not logged in · Please run /login" — so "a result came back" passed on a
# machine where the wrapper cannot work at all, and setup.ps1 then printed
# «آزمایش موفق بود» instead of the Persian login instructions. Measured in the
# §0.5 clean sandbox, 2026-08-07. Assert the answer, not the envelope.
result_text = str(result_event.get("result") or "")
answered = "PONG" in result_text.upper() and not result_event.get("is_error")

model_ok = "haiku" in str((last.get("system/init") or {}).get("model", ""))
print("model this turn ran on:", (last.get("system/init") or {}).get("model"))

turn_style = (last.get("system/init") or {}).get("output_style")
print("output style this turn ran under:", turn_style)
style_ok = bool(style_pick) and style_res.get("ok") and turn_style == style_pick

# Merged the way the renderer merges them: two events, each carrying only the
# keys that answered.
usage = {}
for event in (e for e in seen_events if e.get("subtype") == "usage"):
    usage.update({k: v for k, v in event.items() if k in ("context", "cost", "quota")})
usage_ok = isinstance(usage.get("context"), (int, float))

# The title lands in the transcript, not in the ack — read it back the way the
# sidebar does. Matched on OUR session_id, not "the first title anywhere in the
# payload": /api/projects lists every project on the machine, so the loose read
# passed only as long as no other project had a titled session, and started
# reporting a stranger's title the moment one did.
our_session = (last.get("system/init") or {}).get("session_id")
title = None
for _ in range(10):
    for project in get("/api/projects").get("projects", []):
        for session in project.get("sessions", []):
            if session.get("session_id") == our_session:
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
    "the CLI actually answered (logged in)": answered,
    "bad token rejected": auth_ok,
    "initialize served models + commands": init_ok,
    "posture follows the CLI, not the click": posture_ok,
    "posture returns to the cautious one": back_ok,
    "system/status echoes the mode": echo_ok,
    "the CLI accepts plan mode": plan_ok,
    "set_model applied to the next turn": model_ok,
    "effort reports what is in force, not what was asked": effort_ok,
    "effort never writes the user's own settings.json": settings_kept,
    "output style applied to the next turn": style_ok,
    "a style the CLI never offered is rejected": style_guard_ok,
    "usage reported by the CLI": usage_ok,
    "session titled from its first prompt": title_ok,
}
print()
for name, passed in checks.items():
    print(f"  {'ok  ' if passed else 'FAIL'} {name}")
print("\nRESULT:", "PASS" if all(checks.values()) else "FAIL")
sys.exit(0 if all(checks.values()) else 1)
