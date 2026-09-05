r"""Probe the CLI's message-queue contract. Free -- spends no tokens.

Answers `pcg-52w`, and re-answers it after every CLI upgrade. What it pins:

1. Does `initialize` advertise `msg_lifecycle_v1`, `interrupt_receipt_v1` and
   `interrupt_cancel_queued_v1` on THIS build?
2. Does a `user` frame carrying a top-level lowercase-uuid `uuid` produce
   `command_lifecycle` events on stdout, and in what order relative to `result`?
   The field PLACEMENT is the one thing still assumed rather than measured --
   the schema says "the client-supplied uuid on the inbound message" and this is
   what checks that a top-level `uuid` is what it means.
3. The control: the same frame with NO uuid must emit no lifecycle events at all
   ("Commands enqueued without a uuid ... emit no lifecycle events").
4. `cancel_async_message` against a uuid that was never enqueued -> cancelled=false.

Free because the payload is `/recap`, which is a LOCAL command that refuses on a
session with nothing in it (wiki/parity-chrome.md). The proof that it stayed free
is printed at the end: `result.total_cost_usd` must be 0.

    C:\Python314\python.exe persian-claude-gui\probe_queue.py
"""
import json
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from server import CLAUDE_ARGS, find_claude, transcript_dir  # noqa: E402  (same spawn, or the probe lies)

QUIET_FOR = 12.0      # seconds of CLI silence that end a phase
DEADLINE = 90.0       # hard cap per phase, so a hung CLI cannot hang the probe


class Probe:
    def __init__(self, cwd: Path, extra_args: list[str] | None = None) -> None:
        """`extra_args` is appended to the wrapper's own spawn flags, never replaces
        them -- probe_v21.py needs `--resume <id> --fork-session` on top of the exact
        flags server.py uses, because a probe on different flags measures a different
        program."""
        self.events: list[dict] = []
        self.raw: list[str] = []
        self.last_line = time.monotonic()
        self.lock = threading.Lock()
        self.proc = subprocess.Popen(
            [find_claude(), *CLAUDE_ARGS, *(extra_args or [])],
            cwd=str(cwd), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, encoding="utf-8",
            errors="replace", bufsize=1,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        threading.Thread(target=self._read, daemon=True).start()
        threading.Thread(target=self._read_err, daemon=True).start()

    def _read(self) -> None:
        for line in self.proc.stdout:
            line = line.strip()
            if not line:
                continue
            with self.lock:
                self.last_line = time.monotonic()
                self.raw.append(line)
                try:
                    self.events.append(json.loads(line))
                except json.JSONDecodeError:
                    pass

    def _read_err(self) -> None:
        for line in self.proc.stderr:
            if line.strip():
                print("  [stderr]", line.rstrip())

    def send(self, obj: dict) -> None:
        self.proc.stdin.write(json.dumps(obj, ensure_ascii=False) + "\n")
        self.proc.stdin.flush()

    def settle(self, quiet: float = QUIET_FOR) -> None:
        """Wait until the CLI has said nothing for `quiet` seconds."""
        started = time.monotonic()
        while time.monotonic() - started < DEADLINE:
            with self.lock:
                idle = time.monotonic() - self.last_line
            if idle >= quiet:
                return
            time.sleep(0.25)

    def since(self, mark: int) -> list[dict]:
        with self.lock:
            return self.events[mark:]

    def mark(self) -> int:
        with self.lock:
            return len(self.events)


def control(p: Probe, subtype: str, **params) -> dict:
    request_id = f"probe-{subtype}-{uuid.uuid4().hex[:6]}"
    p.send({"type": "control_request", "request_id": request_id,
            "request": {"subtype": subtype, **params}})
    started = time.monotonic()
    while time.monotonic() - started < 30:
        for event in p.events[:]:
            if (event.get("type") == "control_response"
                    and (event.get("response") or {}).get("request_id") == request_id):
                return event["response"]
        time.sleep(0.1)
    return {"subtype": "error", "error": "timed out"}


def user_frame(text: str, msg_uuid: str | None) -> dict:
    frame = {"type": "user",
             "message": {"role": "user", "content": [{"type": "text", "text": text}]}}
    if msg_uuid:
        frame["uuid"] = msg_uuid
    return frame


def summarize(events: list[dict]) -> None:
    for event in events:
        etype = event.get("type")
        if etype == "command_lifecycle":
            print(f"    command_lifecycle  state={event.get('state'):<10} "
                  f"command_uuid={event.get('command_uuid')}")
        elif etype == "result":
            print(f"    result             subtype={event.get('subtype')} "
                  f"cost=${event.get('total_cost_usd')} "
                  f"text={(event.get('result') or '')[:60]!r}")
        elif etype == "system":
            print(f"    system/{event.get('subtype')}")
        elif etype == "assistant":
            print("    assistant")


def main() -> int:
    if not shutil.which("claude") and not (Path.home() / ".local/bin/claude.exe").exists():
        print("claude not found")
        return 1
    tmp = Path(tempfile.mkdtemp(prefix="pcg-probe-"))
    print(f"cwd: {tmp}\nspawn: {' '.join(CLAUDE_ARGS)}\n")
    p = Probe(tmp)
    verdicts: list[tuple[str, bool, str]] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        verdicts.append((name, ok, detail))
        print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f"  -- {detail}" if detail else ""))

    try:
        # --- 1. capabilities ------------------------------------------------
        print("1. initialize")
        init = control(p, "initialize")
        body = init.get("response") or init
        print(f"   initialize keys: {sorted(body)}")
        print("   initialize.capabilities: "
              f"{json.dumps(body.get('capabilities'), ensure_ascii=False)}")

        # --- 2. a uuid-stamped send ----------------------------------------
        print("\n2. user frame WITH a top-level uuid (payload: /recap, free)")
        mine = str(uuid.uuid4())
        print(f"   uuid: {mine}")
        mark = p.mark()
        p.send(user_frame("/recap", mine))
        p.settle()
        seen = p.since(mark)
        summarize(seen)
        lifecycle = [e for e in seen if e.get("type") == "command_lifecycle"]
        mine_states = [e.get("state") for e in lifecycle if e.get("command_uuid") == mine]
        check("a top-level `uuid` is what command_uuid echoes",
              bool(mine_states), f"states={mine_states}")
        check("it reaches a terminal state",
              any(s in ("completed", "cancelled", "discarded", "refused")
                  for s in mine_states), f"states={mine_states}")
        order = [e.get("type") for e in seen
                 if e.get("type") in ("command_lifecycle", "result")]
        print(f"   order: {order}")
        results = [e for e in seen if e.get("type") == "result"]
        cost = sum(e.get("total_cost_usd") or 0 for e in results)
        check("the probe stayed free (a real answer would cost)", cost == 0,
              f"total_cost_usd={cost}")

        # system/init only arrives once a turn starts, so the capability list
        # cannot be read at spawn -- which is itself the finding.
        init_event = next((e for e in p.events
                           if e.get("type") == "system" and e.get("subtype") == "init"), None)
        print(f"\n   system/init keys: {sorted(init_event or {})}")
        flat = json.dumps(init_event or {})
        for cap in ("msg_lifecycle_v1", "interrupt_receipt_v1",
                    "interrupt_cancel_queued_v1"):
            check(f"system/init advertises {cap}", cap in flat)

        # --- 3. the control: no uuid, no lifecycle --------------------------
        print("\n3. the same frame with NO uuid")
        mark = p.mark()
        p.send(user_frame("/recap", None))
        p.settle()
        seen = p.since(mark)
        summarize(seen)
        check("no uuid -> no lifecycle events",
              not [e for e in seen if e.get("type") == "command_lifecycle"])

        # --- 4. cancel_async_message on a stranger --------------------------
        print("\n4. cancel_async_message for a uuid that was never enqueued")
        reply = control(p, "cancel_async_message", message_uuid=str(uuid.uuid4()))
        print(f"   {json.dumps(reply, ensure_ascii=False)[:200]}")
        check("answered, and reports cancelled=false",
              (reply.get("response") or {}).get("cancelled") is False
              or reply.get("cancelled") is False,
              json.dumps(reply.get("response") or reply)[:120])
    finally:
        try:
            p.proc.stdin.close()
        except Exception:
            pass
        p.proc.terminate()
        try:
            p.proc.wait(timeout=10)  # Windows won't delete a folder that is a process's cwd
        except Exception:
            pass
        # Leave no project behind: the CLI wrote a transcript under
        # ~/.claude/projects/<sanitized-tmp>, and the sidebar lists every such
        # entry whose cwd still exists — a stray probe run shows up as a
        # "pcg-probe-…" project in the window forever.
        transcripts = transcript_dir(tmp)
        for _ in range(20):
            shutil.rmtree(tmp, ignore_errors=True)
            if not tmp.exists():
                break
            time.sleep(0.25)
        if transcripts:
            shutil.rmtree(transcripts, ignore_errors=True)

    failed = [name for name, ok, _ in verdicts if not ok]
    print(f"\n{'FAIL' if failed else 'PASS'} -- "
          f"{len(verdicts) - len(failed)}/{len(verdicts)}")
    for name in failed:
        print(f"  failed: {name}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
