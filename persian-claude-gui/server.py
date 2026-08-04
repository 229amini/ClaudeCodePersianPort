"""
server.py - local host for a Persian/RTL front-end over the real Claude Code CLI.

Stdlib only: no npm, no build step, no CDN (see CLAUDE.md). Responsibilities:

  1. serve static/ to a chrome-less Edge app-mode window
  2. own one long-lived `claude -p` subprocess per project, pumping NDJSON both ways
  3. fan CLI events out to the window over SSE

The CLI contract below is verified against claude 2.1.221 and recorded in
wiki/cli-stream-json-findings.md. Re-verify after a CLI upgrade; the flags and the
event shapes are version-pinned.

Milestone: M2 (skeleton + English round-trip). The permission broker is M4.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import queue
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

COOKIE_NAME = "pcg_token"

HERE = Path(__file__).resolve().parent
STATIC_DIR = HERE / "static"
HOOK_PATH = HERE / "permission_hook.py"

# Tools approved without a dialog. Deliberately tiny and read-only: a
# non-technical user cannot judge a prompt they get for every file read, and
# prompt fatigue is how people learn to click "allow" without looking.
# Everything else asks. See wiki/permission-broker.md for why the wrapper
# brokers all tools instead of deferring to the CLI's own rules.
AUTO_ALLOW = frozenset({"Read", "Glob", "Grep", "NotebookRead", "TodoWrite"})

# How long the GUI has to answer before the broker gives up. Must stay under
# the hook's own TIMEOUT_SECONDS so the server decides, not the hook.
PERMISSION_TIMEOUT = 110.0

# --verbose is mandatory: without it the CLI exits with
# "When using --print, --output-format=stream-json requires --verbose".
CLAUDE_ARGS = [
    "-p",
    "--verbose",
    "--output-format", "stream-json",
    "--input-format", "stream-json",
    "--include-partial-messages",
]

EDGE_CANDIDATES = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]

# Seconds with zero SSE clients before the server tears itself down.
IDLE_SHUTDOWN_SECONDS = 10.0
SSE_HEARTBEAT_SECONDS = 15.0

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".woff2": "font/woff2",
    ".svg": "image/svg+xml",
}


def find_claude() -> str:
    """Locate the real CLI. Never assume PATH resolves it under pythonw."""
    found = shutil.which("claude")
    if found:
        return found
    fallback = Path.home() / ".local" / "bin" / "claude.exe"
    if fallback.exists():
        return str(fallback)
    raise SystemExit("claude CLI not found. Install it, then re-run.")


def space_safe(path: Path) -> str:
    """Return a form of `path` that survives the CLI's hook-command parsing.

    The CLI splits a PreToolUse `command` on whitespace and does NOT honour
    quotes: `"C:\\Program Files\\py.exe" hook.py` silently never runs, with no
    error anywhere — the tool call is simply denied. Wrapping in `cmd /c` does
    not help either. Measured on 2.1.221; see wiki/permission-broker.md.

    8.3 short names remove the spaces and work. Volumes with 8dot3 name
    creation disabled will not produce one, hence the caller's warning.
    """
    text = str(path)
    if " " not in text:
        return text
    try:
        import ctypes
        from ctypes import wintypes

        get_short = ctypes.windll.kernel32.GetShortPathNameW  # type: ignore[attr-defined]
        get_short.argtypes = [wintypes.LPCWSTR, wintypes.LPWSTR, wintypes.DWORD]
        get_short.restype = wintypes.DWORD
        buffer = ctypes.create_unicode_buffer(1024)
        if get_short(text, buffer, len(buffer)) and buffer.value:
            return buffer.value
    except (OSError, AttributeError):
        pass
    return text


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Hub:
    """Fan-out of CLI events to every connected SSE client."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._clients: set[queue.Queue] = set()
        self._history: list[dict] = []
        self.last_empty_at: float | None = time.monotonic()

    def subscribe(self) -> queue.Queue:
        q: queue.Queue = queue.Queue()
        with self._lock:
            # Replay what already happened so a reconnecting window is not blank.
            for event in self._history:
                q.put(event)
            self._clients.add(q)
            self.last_empty_at = None
        return q

    def unsubscribe(self, q: queue.Queue) -> None:
        with self._lock:
            self._clients.discard(q)
            if not self._clients:
                self.last_empty_at = time.monotonic()

    def publish(self, event: dict) -> None:
        with self._lock:
            self._history.append(event)
            targets = list(self._clients)
        for q in targets:
            q.put(event)

    def idle_seconds(self) -> float:
        with self._lock:
            if self._clients or self.last_empty_at is None:
                return 0.0
            return time.monotonic() - self.last_empty_at

    def reset(self) -> None:
        """Drop replay history and tell every window to clear.

        Called when the project or session changes: without this, a window that
        reconnects would replay the previous project's conversation.
        """
        with self._lock:
            self._history = []
        self.publish({"type": "wrapper", "subtype": "reset"})


PROJECTS_DIR = Path.home() / ".claude" / "projects"
RECENTS_FILE = HERE / "recents.json"
MAX_RECENTS = 10


def transcript_dir(cwd: Path) -> Path | None:
    """Locate ~/.claude/projects/<sanitized-cwd>/ for a working directory.

    The CLI builds the folder name by replacing path separators and the drive
    colon with "-", so C:\\Users\\x\\proj becomes C--Users-x-proj. That is an
    observed rule, not a documented one, so if the derived name is missing we
    fall back to reading the `cwd` recorded inside each transcript. The fallback
    is what keeps history working if the naming scheme ever changes.
    """
    if not PROJECTS_DIR.is_dir():
        return None

    guess = PROJECTS_DIR / str(cwd).replace(":", "-").replace("\\", "-").replace("/", "-")
    if guess.is_dir():
        return guess

    target = str(cwd).lower()
    for candidate in PROJECTS_DIR.iterdir():
        if not candidate.is_dir():
            continue
        for transcript in candidate.glob("*.jsonl"):
            recorded = _first_field(transcript, "cwd")
            if recorded and recorded.lower() == target:
                return candidate
            break   # one line is enough to identify the folder
    return None


def _first_field(path: Path, field: str) -> str | None:
    try:
        with path.open("r", encoding="utf-8", errors="replace") as handle:
            for line in handle:
                try:
                    value = json.loads(line).get(field)
                except json.JSONDecodeError:
                    continue
                if value:
                    return value
    except OSError:
        pass
    return None


def list_sessions(cwd: Path) -> list[dict]:
    """Session list for the history browser: newest first, with a preview."""
    folder = transcript_dir(cwd)
    if folder is None:
        return []

    sessions = []
    for transcript in folder.glob("*.jsonl"):
        try:
            mtime = transcript.stat().st_mtime
        except OSError:
            continue
        sessions.append({
            "session_id": transcript.stem,
            "modified": mtime,
            "preview": (first_user_text(transcript) or "")[:160],
        })
    sessions.sort(key=lambda item: item["modified"], reverse=True)
    return sessions


def first_user_text(path: Path) -> str | None:
    try:
        with path.open("r", encoding="utf-8", errors="replace") as handle:
            for line in handle:
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if event.get("type") != "user" or event.get("isSidechain"):
                    continue
                for part in event.get("message", {}).get("content", []) or []:
                    if isinstance(part, dict) and part.get("type") == "text":
                        return (part.get("text") or "").strip()
    except OSError:
        pass
    return None


def read_session(cwd: Path, session_id: str) -> list[dict]:
    """Replayable events for one session.

    Transcript `user`/`assistant` lines carry the same `message` shape as live
    stream events, so the window renders them with the identical code path
    (plan §B-4: one renderer, two sources). Everything else in the file —
    queue-operation, attachment, last-prompt, and sidechain (subagent) turns —
    is bookkeeping and would only add noise.
    """
    folder = transcript_dir(cwd)
    if folder is None:
        return []
    # Guard against a crafted id escaping the transcript folder.
    transcript = (folder / f"{session_id}.jsonl").resolve()
    if folder.resolve() not in transcript.parents or not transcript.is_file():
        return []

    events: list[dict] = []
    with transcript.open("r", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if event.get("type") not in ("user", "assistant"):
                continue
            if event.get("isSidechain"):
                continue
            events.append({"type": event["type"], "message": event.get("message", {})})
    return events


USER_SETTINGS = Path.home() / ".claude" / "settings.json"
ANSI_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


def statusline_command() -> str | None:
    """The target machine's own statusLine command, if it configured one.

    Plan §B-7: inherit the user's statusline rather than reinventing it. We run
    their command with the same JSON-on-stdin contract the CLI uses and show
    the output, instead of guessing what they wanted on screen.
    """
    try:
        settings = json.loads(USER_SETTINGS.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    entry = settings.get("statusLine")
    if isinstance(entry, dict) and entry.get("type") == "command":
        return entry.get("command") or None
    return None


def run_statusline(command: str, payload: dict) -> str | None:
    try:
        done = subprocess.run(
            command, shell=True, input=json.dumps(payload, ensure_ascii=False),
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=10, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    # Statuslines are written for a terminal and emit ANSI colour codes; strip
    # them rather than trying to reproduce terminal colouring in the window.
    return ANSI_RE.sub("", (done.stdout or "")).strip() or None


IMAGE_SUFFIXES = frozenset({".png", ".jpg", ".jpeg", ".gif", ".webp"})
IMAGE_MEDIA_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                     ".gif": "image/gif", ".webp": "image/webp"}
MAX_IMAGE_BYTES = 5 * 1024 * 1024


def build_message_blocks(text: str, attachments: list[str]) -> list[dict]:
    """Turn composer text plus attachments into stream-json content blocks.

    Images become base64 `image` blocks (verified accepted, B-9.5). Everything
    else becomes an `@path` mention appended to the text, which is what the CLI
    natively understands — the wrapper does not read the file itself.
    """
    blocks: list[dict] = []
    mentions: list[str] = []

    for raw in attachments:
        path = Path(raw)
        if not path.is_file():
            continue
        suffix = path.suffix.lower()
        if suffix in IMAGE_SUFFIXES and path.stat().st_size <= MAX_IMAGE_BYTES:
            blocks.append({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": IMAGE_MEDIA_TYPES[suffix],
                    "data": base64.b64encode(path.read_bytes()).decode("ascii"),
                },
            })
        else:
            mentions.append(f"@{path}")

    combined = " ".join([text, *mentions]).strip()
    if combined:
        blocks.append({"type": "text", "text": combined})
    return blocks


def pick_files(interpreter: Path) -> list[str]:
    """Native file dialog, in a child process (same reasoning as pick_folder)."""
    code = (
        "import tkinter, tkinter.filedialog as fd;"
        "r = tkinter.Tk(); r.withdraw(); r.attributes('-topmost', True);"
        "print('\\n'.join(fd.askopenfilenames() or ()))"
    )
    try:
        done = subprocess.run(
            [str(interpreter), "-c", code],
            capture_output=True, text=True, encoding="utf-8", timeout=300,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except (OSError, subprocess.TimeoutExpired):
        return []
    return [str(Path(line)) for line in (done.stdout or "").splitlines() if line.strip()]


def pick_folder(interpreter: Path) -> str | None:
    """Native folder dialog, in a child process.

    tkinter must own its own thread's event loop, and this server is threaded,
    so running the dialog in-process is a reliable way to deadlock. A throwaway
    child keeps it simple and cannot take the server down with it.
    """
    code = (
        "import tkinter, tkinter.filedialog as fd;"
        "r = tkinter.Tk(); r.withdraw(); r.attributes('-topmost', True);"
        "print(fd.askdirectory() or '')"
    )
    try:
        done = subprocess.run(
            [str(interpreter), "-c", code],
            capture_output=True, text=True, encoding="utf-8", timeout=300,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    chosen = (done.stdout or "").strip()
    # askdirectory returns forward slashes even on Windows.
    return str(Path(chosen)) if chosen else None


def load_recents() -> list[str]:
    try:
        data = json.loads(RECENTS_FILE.read_text(encoding="utf-8"))
        return [str(item) for item in data if isinstance(item, str)]
    except (OSError, ValueError):
        return []


def remember_recent(cwd: Path) -> list[str]:
    recents = [item for item in load_recents() if item.lower() != str(cwd).lower()]
    recents.insert(0, str(cwd))
    recents = recents[:MAX_RECENTS]
    try:
        RECENTS_FILE.write_text(json.dumps(recents, indent=2), encoding="utf-8")
    except OSError:
        pass
    return recents


class PermissionBroker:
    """Blocks a hook call until the GUI answers (plan §B-5).

    One instance per server. The hook POSTs here and waits; the request is
    pushed to the window over SSE; the user's answer releases the waiter.
    """

    def __init__(self, hub: Hub) -> None:
        self.hub = hub
        self._lock = threading.Lock()
        self._pending: dict[str, dict] = {}
        # "always allow this tool for this session" — cleared when the server
        # exits, never written to the user's real settings.
        self.session_allow: set[str] = set()

    def request(self, tool_name: str, tool_input: dict, tool_use_id: str | None) -> dict:
        if tool_name in AUTO_ALLOW:
            return {"decision": "allow", "reason": "auto-allow (read-only)"}
        with self._lock:
            if tool_name in self.session_allow:
                return {"decision": "allow", "reason": "session allow-rule"}

        request_id = uuid.uuid4().hex
        waiter = threading.Event()
        with self._lock:
            self._pending[request_id] = {"event": waiter, "decision": None}

        self.hub.publish({
            "type": "wrapper",
            "subtype": "permission_request",
            "request_id": request_id,
            "tool_name": tool_name,
            "tool_input": tool_input,
            "tool_use_id": tool_use_id,
        })

        answered = waiter.wait(timeout=PERMISSION_TIMEOUT)
        with self._lock:
            entry = self._pending.pop(request_id, None)
        decision = (entry or {}).get("decision")

        if not answered or decision not in ("allow", "deny"):
            # Timed out or the window went away. Deny: an unattended wrapper
            # must not approve a tool call on the user's behalf.
            self._publish_resolved(request_id, tool_use_id, "deny")
            return {"decision": "deny", "reason": "timed out waiting for the user"}

        self._publish_resolved(request_id, tool_use_id, decision)
        return {"decision": decision, "reason": "user decision"}

    def _publish_resolved(self, request_id: str, tool_use_id: str | None,
                          decision: str) -> None:
        self.hub.publish({
            "type": "wrapper",
            "subtype": "permission_resolved",
            "request_id": request_id,
            "tool_use_id": tool_use_id,
            "decision": decision,
        })

    def respond(self, request_id: str, decision: str, remember: bool,
                tool_name: str | None) -> bool:
        with self._lock:
            entry = self._pending.get(request_id)
            if entry is None:
                return False
            entry["decision"] = decision
            if remember and decision == "allow" and tool_name:
                self.session_allow.add(tool_name)
            entry["event"].set()
        return True


class ClaudeSession:
    """One long-lived `claude -p` process. A turn is one NDJSON line on stdin."""

    def __init__(self, cwd: Path, hub: Hub, claude_bin: str,
                 endpoint: str, token: str, hook_log: Path | None = None) -> None:
        self.hook_log = hook_log
        self.cwd = cwd
        self.hub = hub
        self.claude_bin = claude_bin
        self.endpoint = endpoint
        self.token = token
        self.proc: subprocess.Popen | None = None
        self.session_id: str | None = None
        self.model: str | None = None
        self._write_lock = threading.Lock()
        self._settings_dir = Path(tempfile.mkdtemp(prefix="pcg-settings-"))
        self._generation = 0   # stale reader threads check this before publishing
        self._interrupt_seq = 0

    def _write_settings(self) -> Path:
        """Generate the --settings file that wires in the permission hook.

        Never edit the user's real ~/.claude/settings.json: their own hooks,
        permissions and statusLine must keep working untouched (CLAUDE.md).
        --settings layers on top of it.
        """
        # sys.executable is pythonw.exe under run.vbs; the hook writes to a pipe
        # the CLI owns, but python.exe is the safer interpreter for stdio.
        interpreter = Path(sys.executable)
        if interpreter.name.lower() == "pythonw.exe":
            console = interpreter.with_name("python.exe")
            if console.exists():
                interpreter = console

        # matcher is a regex, not a glob: "*" is an invalid pattern and matches
        # nothing, which looks identical to the hook not being wired up at all.
        # The command must be UNQUOTED and space-free - see space_safe().
        interpreter_arg = space_safe(interpreter)
        hook_arg = space_safe(HOOK_PATH)
        if " " in interpreter_arg or " " in hook_arg:
            self.hub.publish({
                "type": "wrapper",
                "subtype": "stderr",
                "line": ("permission hook disabled: its path contains a space and "
                         "no 8.3 short name is available - tool approvals will be "
                         f"denied. interpreter={interpreter_arg} hook={hook_arg}"),
            })

        settings = {
            "hooks": {
                "PreToolUse": [{
                    "matcher": ".*",
                    "hooks": [{
                        "type": "command",
                        "command": f"{interpreter_arg} {hook_arg}",
                    }],
                }]
            }
        }
        path = self._settings_dir / "settings.json"
        path.write_text(json.dumps(settings, indent=2), encoding="utf-8")
        return path

    def start(self, resume_id: str | None = None) -> None:
        settings_path = self._write_settings()
        self._generation += 1
        generation = self._generation

        # --resume reuses the same session_id rather than forking (verified,
        # B-9.8), so recovery after a crash is idempotent.
        resume_args = ["--resume", resume_id] if resume_id else []
        self.session_id = resume_id

        # The hook is a grandchild process (server -> claude -> hook) and reads
        # these from the inherited environment, so the token never lands on disk.
        env = os.environ.copy()
        env["PCG_ENDPOINT"] = self.endpoint
        env["PCG_TOKEN"] = self.token
        if self.hook_log:
            env["PCG_HOOK_LOG"] = str(self.hook_log)

        # CREATE_NO_WINDOW keeps a console from flashing when launched via pythonw.
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        self.proc = subprocess.Popen(
            [self.claude_bin, *CLAUDE_ARGS, *resume_args,
             "--settings", str(settings_path)],
            cwd=str(self.cwd),
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",   # never inherit the OEM codepage - it corrupts Persian
            errors="replace",
            bufsize=1,
            creationflags=creationflags,
        )
        proc = self.proc
        threading.Thread(target=self._read_stdout, args=(proc, generation),
                         daemon=True).start()
        threading.Thread(target=self._read_stderr, args=(proc, generation),
                         daemon=True).start()

    def restart(self, cwd: Path | None = None, resume_id: str | None = None) -> None:
        """Swap the underlying process: switch project, or resume a session."""
        self.stop()
        if cwd is not None:
            self.cwd = cwd
        self.hub.reset()
        self.start(resume_id=resume_id)

    def _read_stdout(self, proc: subprocess.Popen, generation: int) -> None:
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            # A restarted session leaves the old reader draining a dead pipe;
            # its events must not leak into the new conversation.
            if generation != self._generation:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                # Never crash on unparseable output; surface it as a raw card.
                self.hub.publish({"type": "raw", "line": line})
                continue
            if event.get("type") == "system" and event.get("subtype") == "init":
                self.session_id = event.get("session_id")
                self.model = event.get("model")
            if event.get("type") == "result":
                # Off-thread: the statusline is someone else's script and must
                # never stall the event pump.
                threading.Thread(target=self._publish_statusline,
                                 args=(event, generation), daemon=True).start()
            self.hub.publish(event)
        if generation == self._generation:
            self.hub.publish({"type": "wrapper", "subtype": "cli_exited",
                              "returncode": proc.poll()})

    def _publish_statusline(self, result: dict, generation: int) -> None:
        command = statusline_command()
        if not command:
            return
        text = run_statusline(command, {
            "session_id": self.session_id,
            "cwd": str(self.cwd),
            "model": {"id": self.model, "display_name": self.model},
            "workspace": {"current_dir": str(self.cwd), "project_dir": str(self.cwd)},
            "version": result.get("claude_code_version"),
            "output_style": {"name": "default"},
            "cost": {
                "total_cost_usd": result.get("total_cost_usd"),
                "total_duration_ms": result.get("duration_ms"),
            },
        })
        if text and generation == self._generation:
            self.hub.publish({"type": "wrapper", "subtype": "statusline", "text": text})

    def _read_stderr(self, proc: subprocess.Popen, generation: int) -> None:
        for line in proc.stderr:
            line = line.rstrip("\n")
            if line and generation == self._generation:
                self.hub.publish({"type": "wrapper", "subtype": "stderr", "line": line})

    def _write_line(self, obj: dict) -> None:
        if not self.proc or not self.proc.stdin or self.proc.poll() is not None:
            raise RuntimeError("claude process is not running")
        # ensure_ascii=False keeps Persian and ZWNJ (U+200C) intact on the wire.
        payload = json.dumps(obj, ensure_ascii=False) + "\n"
        with self._write_lock:
            self.proc.stdin.write(payload)
            self.proc.stdin.flush()

    def send_blocks(self, blocks: list[dict]) -> None:
        self._write_line({"type": "user",
                          "message": {"role": "user", "content": blocks}})

    def send_text(self, text: str) -> None:
        self.send_blocks([{"type": "text", "text": text}])

    def interrupt(self) -> None:
        """Stop the current turn without killing the process (B-9.10).

        Verified: the CLI answers with control_response subtype "success" and
        ends the turn as result/error_during_execution with terminal_reason
        "aborted_streaming". The process stays alive, so the session — and
        therefore the conversation — survives. Do not kill instead.
        """
        self._interrupt_seq += 1
        self._write_line({
            "type": "control_request",
            "request_id": f"pcg-int-{self._interrupt_seq}",
            "request": {"subtype": "interrupt"},
        })

    def stop(self) -> None:
        if not self.proc or self.proc.poll() is not None:
            return
        try:
            if self.proc.stdin:
                self.proc.stdin.close()
        except OSError:
            pass
        try:
            self.proc.terminate()
            self.proc.wait(timeout=5)
        except (subprocess.TimeoutExpired, OSError):
            self.proc.kill()


class Handler(BaseHTTPRequestHandler):
    server_version = "PersianClaudeGUI/0.1"
    protocol_version = "HTTP/1.1"

    # Injected by serve().
    token: str = ""
    hub: Hub
    session: ClaudeSession
    broker: PermissionBroker

    def log_message(self, fmt: str, *args) -> None:
        if self.server.verbose:  # type: ignore[attr-defined]
            sys.stderr.write("[http] " + (fmt % args) + "\n")

    # --- helpers -------------------------------------------------------

    def _authorized(self, params: dict) -> bool:
        """Token may arrive three ways.

        The window is opened at /?t=<token>, but subresources (style.css,
        app.js, the fonts) and the SSE reconnect cannot carry that query
        string. Serving them unauthenticated would leave the whole UI readable
        by any local process, so the root response sets the token as a
        host-only cookie and every later request is checked against it.
        """
        supplied = params.get("t", [None])[0] or self.headers.get("X-Auth-Token")
        if not supplied:
            jar = SimpleCookie(self.headers.get("Cookie", ""))
            morsel = jar.get(COOKIE_NAME)
            supplied = morsel.value if morsel else None
        return bool(supplied) and secrets.compare_digest(supplied, self.token)

    def _send(self, status: int, body: bytes, content_type: str,
              extra_headers: tuple[tuple[str, str], ...] = ()) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for name, value in extra_headers:
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, status: int, obj: dict) -> None:
        self._send(status, json.dumps(obj, ensure_ascii=False).encode("utf-8"),
                   "application/json; charset=utf-8")

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    # --- routes --------------------------------------------------------

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        if not self._authorized(params):
            self._send(HTTPStatus.FORBIDDEN, b"forbidden", "text/plain; charset=utf-8")
            return

        # Hand the cookie out whenever the token arrived in the URL, so that a
        # page opened directly (index.html, or spec-test.html during QA) can
        # authenticate its own subresources.
        set_cookie = "t" in params

        if parsed.path in ("/", "/index.html"):
            self._serve_file(STATIC_DIR / "index.html", set_cookie=set_cookie)
        elif parsed.path == "/api/events":
            self._serve_sse()
        elif parsed.path == "/api/sessions":
            self._send_json(HTTPStatus.OK, {
                "cwd": str(self.session.cwd),
                "current": self.session.session_id,
                "recents": load_recents(),
                "sessions": list_sessions(self.session.cwd),
            })
        elif parsed.path == "/api/session":
            session_id = params.get("id", [""])[0]
            if not session_id:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "missing id"})
                return
            self._send_json(HTTPStatus.OK, {
                "session_id": session_id,
                "events": read_session(self.session.cwd, session_id),
            })
        elif parsed.path.startswith("/static/"):
            rel = parsed.path[len("/static/"):]
            target = (STATIC_DIR / rel).resolve()
            if STATIC_DIR.resolve() not in target.parents:
                self._send(HTTPStatus.FORBIDDEN, b"forbidden", "text/plain; charset=utf-8")
                return
            self._serve_file(target, set_cookie=set_cookie)
        else:
            self._send(HTTPStatus.NOT_FOUND, b"not found", "text/plain; charset=utf-8")

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        if not self._authorized(params):
            self._send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
            return

        try:
            body = self._read_body()
        except (ValueError, json.JSONDecodeError):
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "bad json"})
            return

        if parsed.path == "/api/message":
            text = (body.get("text") or "").strip()
            attachments = [str(a) for a in (body.get("attachments") or [])]
            if not text and not attachments:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "empty message"})
                return
            blocks = build_message_blocks(text, attachments)
            if not blocks:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "nothing to send"})
                return
            try:
                self.session.send_blocks(blocks)
            except RuntimeError as exc:
                self._send_json(HTTPStatus.CONFLICT, {"error": str(exc)})
                return
            # Echo locally so the window can render the user turn immediately:
            # the CLI does not replay user messages back to us.
            self.hub.publish({
                "type": "wrapper", "subtype": "user_echo",
                "text": next((b["text"] for b in blocks if b["type"] == "text"), ""),
                "images": sum(1 for b in blocks if b["type"] == "image"),
            })
            self._send_json(HTTPStatus.OK, {"ok": True})
        elif parsed.path == "/api/interrupt":
            try:
                self.session.interrupt()
            except RuntimeError as exc:
                self._send_json(HTTPStatus.CONFLICT, {"error": str(exc)})
                return
            self._send_json(HTTPStatus.OK, {"ok": True})
        elif parsed.path == "/api/attach/pick":
            self._send_json(HTTPStatus.OK, {"paths": pick_files(Path(sys.executable))})
        elif parsed.path == "/api/permission/request":
            # Called by permission_hook.py. Blocks this worker thread until the
            # user answers — ThreadingHTTPServer gives each request its own
            # thread, so the SSE stream and the rest of the API stay live.
            answer = self.broker.request(
                body.get("tool_name") or "",
                body.get("tool_input") or {},
                body.get("tool_use_id"),
            )
            self._send_json(HTTPStatus.OK, answer)
        elif parsed.path == "/api/permission/respond":
            ok = self.broker.respond(
                body.get("request_id") or "",
                body.get("decision") or "deny",
                bool(body.get("remember")),
                body.get("tool_name"),
            )
            self._send_json(HTTPStatus.OK if ok else HTTPStatus.NOT_FOUND,
                            {"ok": ok})
        elif parsed.path == "/api/project/pick":
            chosen = pick_folder(Path(sys.executable))
            self._send_json(HTTPStatus.OK, {"path": chosen})
        elif parsed.path == "/api/project/open":
            raw = (body.get("path") or "").strip()
            target = Path(raw).expanduser() if raw else None
            if not target or not target.is_dir():
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "not a folder"})
                return
            target = target.resolve()
            self.session.restart(cwd=target)
            self._send_json(HTTPStatus.OK, {
                "cwd": str(target), "recents": remember_recent(target),
            })
        elif parsed.path == "/api/session/resume":
            session_id = (body.get("session_id") or "").strip()
            if not session_id:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "missing session_id"})
                return
            self.session.restart(resume_id=session_id)
            self._send_json(HTTPStatus.OK, {"session_id": session_id})
        elif parsed.path == "/api/status":
            self._send_json(HTTPStatus.OK, {
                "session_id": self.session.session_id,
                "cwd": str(self.session.cwd),
                "running": bool(self.session.proc and self.session.proc.poll() is None),
            })
        else:
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})

    # --- transports ----------------------------------------------------

    def _serve_file(self, path: Path, set_cookie: bool = False) -> None:
        if not path.is_file():
            self._send(HTTPStatus.NOT_FOUND, b"not found", "text/plain; charset=utf-8")
            return
        body = path.read_bytes()
        ctype = MIME_TYPES.get(path.suffix.lower(), "application/octet-stream")
        extra: tuple[tuple[str, str], ...] = ()
        if set_cookie:
            # Host-only, session-scoped, not readable from JS. The server is
            # bound to 127.0.0.1 so there is no transport to secure beyond that.
            extra = ((
                "Set-Cookie",
                f"{COOKIE_NAME}={self.token}; Path=/; HttpOnly; SameSite=Strict",
            ),)
        self._send(HTTPStatus.OK, body, ctype, extra)

    def _serve_sse(self) -> None:
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

        q = self.hub.subscribe()
        try:
            while True:
                try:
                    event = q.get(timeout=SSE_HEARTBEAT_SECONDS)
                except queue.Empty:
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
                    continue
                data = json.dumps(event, ensure_ascii=False)
                self.wfile.write(f"data: {data}\n\n".encode("utf-8"))
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            self.hub.unsubscribe(q)


def launch_window(url: str) -> None:
    for candidate in EDGE_CANDIDATES:
        if Path(candidate).exists():
            subprocess.Popen([candidate, f"--app={url}"],
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            return
    # Degraded but working: a normal browser tab (plan Phase 0 decision matrix).
    import webbrowser
    webbrowser.open(url)


def idle_watchdog(hub: Hub, session: ClaudeSession, httpd: ThreadingHTTPServer,
                  grace: float) -> None:
    """Server lifetime is tied to the window: last client gone -> shut down."""
    # Give the window time to make its first connection before arming.
    time.sleep(grace)
    while True:
        if hub.idle_seconds() > IDLE_SHUTDOWN_SECONDS:
            session.stop()
            threading.Thread(target=httpd.shutdown, daemon=True).start()
            return
        time.sleep(1.0)


def serve(cwd: Path, open_window: bool, verbose: bool,
          hook_log: Path | None = None) -> None:
    token = secrets.token_urlsafe(32)
    port = free_port()
    endpoint = f"http://127.0.0.1:{port}"
    hub = Hub()
    broker = PermissionBroker(hub)
    session = ClaudeSession(cwd=cwd, hub=hub, claude_bin=find_claude(),
                            endpoint=endpoint, token=token, hook_log=hook_log)
    session.start()

    Handler.token = token
    Handler.hub = hub
    Handler.session = session
    Handler.broker = broker

    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    httpd.daemon_threads = True
    httpd.verbose = verbose  # type: ignore[attr-defined]

    url = f"{endpoint}/?t={token}"
    if verbose:
        print(f"[server] cwd     : {cwd}")
        print(f"[server] listening: {url}", flush=True)

    remember_recent(cwd)
    threading.Thread(target=idle_watchdog, args=(hub, session, httpd, 30.0),
                     daemon=True).start()
    if open_window:
        launch_window(url)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        session.stop()


def main() -> None:
    parser = argparse.ArgumentParser(description="Persian RTL front-end for Claude Code")
    parser.add_argument("--cwd", default=os.getcwd(),
                        help="project directory the CLI runs in")
    parser.add_argument("--no-window", action="store_true",
                        help="do not launch Edge (dev mode)")
    parser.add_argument("--quiet", action="store_true", help="suppress console logging")
    parser.add_argument("--hook-log", default=None,
                        help="append PreToolUse hook activity to this file (debug)")
    args = parser.parse_args()

    serve(cwd=Path(args.cwd).resolve(),
          open_window=not args.no_window,
          verbose=not args.quiet,
          hook_log=Path(args.hook_log).resolve() if args.hook_log else None)


if __name__ == "__main__":
    main()
