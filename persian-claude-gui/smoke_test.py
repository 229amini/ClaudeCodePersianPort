"""
M2 smoke test — boots server.py, drives one real turn through the CLI, asserts the basics.

    python smoke_test.py

Passes when a `result` event comes back and a wrong token is rejected with 403.
Costs one real CLI turn against the logged-in subscription.
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
done = threading.Event()


def read_sse() -> None:
    with urllib.request.urlopen(f"{base}/api/events?t={token}") as resp:
        for raw in resp:
            line = raw.decode("utf-8").rstrip("\n")
            if not line.startswith("data: "):
                continue
            event = json.loads(line[6:])
            seen.append(f"{event.get('type')}/{event.get('subtype', '')}".rstrip("/"))
            if event.get("type") == "system" and event.get("subtype") == "init":
                print("  init:", event.get("session_id"), "|", event.get("model"))
            if event.get("type") == "result":
                print("  result:", repr(event.get("result")))
                done.set()
                return


threading.Thread(target=read_sse, daemon=True).start()
time.sleep(2.0)

body = json.dumps({"text": "Reply with exactly: PONG"}).encode("utf-8")
request = urllib.request.Request(f"{base}/api/message?t={token}", data=body,
                                 headers={"Content-Type": "application/json"},
                                 method="POST")
print("POST /api/message ->", urllib.request.urlopen(request).status)

ok = done.wait(timeout=120)

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
print("\nRESULT:", "PASS" if (ok and auth_ok) else "FAIL")
sys.exit(0 if (ok and auth_ok) else 1)
