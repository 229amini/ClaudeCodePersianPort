"""
PreToolUse hook — brokers a permission decision through the Persian GUI.

Wired in by server.py through a generated `--settings` file, so the user's real
~/.claude/settings.json is never touched. Contract verified against claude
2.1.221 (wiki/cli-stream-json-findings.md):

  stdin  : {"hook_event_name":"PreToolUse","tool_name":...,"tool_input":{...},
            "tool_use_id":"toolu_...","session_id":...,"cwd":...}
  stdout : {"hookSpecificOutput":{"hookEventName":"PreToolUse",
            "permissionDecision":"allow"|"deny","permissionDecisionReason":...}}

This runs once per tool call and BLOCKS the CLI while the dialog is open, so
every failure path must terminate rather than hang. Default is deny: a closed
window must never leave the subprocess wedged, and must never silently approve.
"""

import json
import os
import sys
import urllib.error
import urllib.request

# Long enough for a non-technical user to read Persian and decide; short enough
# that an abandoned window releases the CLI on its own.
TIMEOUT_SECONDS = 120


def trace(message: str) -> None:
    """Append to PCG_HOOK_LOG when set.

    A hook that never fires is invisible: the CLI just denies and the GUI shows
    nothing. This is the only way to tell "hook did not run" from "hook ran and
    denied" — keep it for troubleshooting on the target PC.
    """
    path = os.environ.get("PCG_HOOK_LOG")
    if not path:
        return
    try:
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(message + "\n")
    except OSError:
        pass


def emit(decision: str, reason: str) -> None:
    sys.stdout.write(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": decision,
            "permissionDecisionReason": reason,
        }
    }, ensure_ascii=False))


def main() -> int:
    raw = sys.stdin.read()
    trace(f"--- fired, {len(raw)} bytes: {raw[:400]}")

    endpoint = os.environ.get("PCG_ENDPOINT")
    token = os.environ.get("PCG_TOKEN")
    if not endpoint or not token:
        # Not launched by the wrapper (someone ran claude directly with this
        # settings file). Emit nothing and let the CLI's own rules apply.
        return 0

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        emit("deny", "hook received unparseable input")
        return 0

    body = json.dumps({
        "tool_name": payload.get("tool_name"),
        "tool_input": payload.get("tool_input"),
        "tool_use_id": payload.get("tool_use_id"),
        "session_id": payload.get("session_id"),
        "cwd": payload.get("cwd"),
    }, ensure_ascii=False).encode("utf-8")

    request = urllib.request.Request(
        endpoint.rstrip("/") + "/api/permission/request",
        data=body,
        headers={"Content-Type": "application/json", "X-Auth-Token": token},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as resp:
            answer = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:  # noqa: BLE001 - any failure must deny, not raise
        emit("deny", f"wrapper unreachable: {exc}")
        return 0

    decision = answer.get("decision")
    if decision not in ("allow", "deny"):
        decision = "deny"
    trace(f"    -> {decision} ({answer.get('reason', '')})")
    emit(decision, answer.get("reason", ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
