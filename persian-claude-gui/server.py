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

# Tools approved without a dialog. Deliberately tiny and read-only: a
# non-technical user cannot judge a prompt they get for every file read, and
# prompt fatigue is how people learn to click "allow" without looking.
# Everything else asks. See wiki/permission-broker.md for why the wrapper
# brokers all tools instead of deferring to the CLI's own rules.
AUTO_ALLOW = frozenset({"Read", "Glob", "Grep", "NotebookRead", "TodoWrite"})

# How long the GUI has to answer a can_use_tool request before the broker
# denies on its own. The CLI blocks on that turn until we reply, so this is
# also how long a walked-away-from window stalls the conversation.
PERMISSION_TIMEOUT = 110.0

# --verbose is mandatory: without it the CLI exits with
# "When using --print, --output-format=stream-json requires --verbose".
#
# --permission-prompt-tool stdio is what makes approvals work at all. It is
# hidden from `claude --help` but present in the arg parser, and it routes
# permission prompts to inbound `can_use_tool` control requests on this pipe.
# WITHOUT IT the CLI silently auto-denies in `default` mode and silently
# auto-approves in `auto` mode -- no dialog either way. The old --settings
# PreToolUse hook no longer fires at all on 2.1.221.
# See wiki/permission-transport.md and wiki/permission-hook-broken.md.
CLAUDE_ARGS = [
    "-p",
    "--verbose",
    "--output-format", "stream-json",
    "--input-format", "stream-json",
    "--include-partial-messages",
    "--permission-prompt-tool", "stdio",
    # The wrapper owns the approval posture, so pin the CLI to a mode that
    # actually ASKS us. Without this we inherit the user's
    # permissions.defaultMode: on a machine set to "auto" the CLI approves
    # everything itself and the Persian dialog never appears -- the exact
    # silent failure recorded in wiki/permission-hook-broken.md. The user's
    # own settings are never edited; this only pins OUR child process.
    "--permission-mode", "default",
]

# Control-request subtypes the GUI may invoke through /api/control. A whitelist,
# not a passthrough: the browser must not be able to drive arbitrary control
# traffic into the CLI. Each one answered on a real 2.1.222 process.
#
# `compact` is NOT here: it answers "Unsupported control request subtype"
# (measured 2026-08-05). /compact reaches the CLI as ordinary message text like
# every other slash command -- do not add it back without re-probing.
CONTROL_ALLOWED = frozenset({
    "set_model", "set_permission_mode", "set_max_thinking_tokens",
    "rename_session", "get_context_usage", "get_usage",
})

# How long a control_request may take before the caller gives up. These are
# local round-trips on an open pipe, so anything slow means trouble.
CONTROL_TIMEOUT = 15.0

# The three approval postures the pill offers -> (CLI permission mode, wrapper
# auto-approve). `bypassPermissions` is never sent (the engine refuses it) and
# neither is `auto`: it approves before the wrapper is ever asked, so there is
# nothing left to show the user. The full-auto posture is therefore wrapper-side
# -- the CLI still asks us, we answer instantly, and every answer is logged.
POSTURES = {
    "ask": ("default", False),
    "acceptEdits": ("acceptEdits", False),
    "autoApprove": ("default", True),
}

# Longest session title we ask the CLI to store. Titles render in a narrow
# sidebar; anything longer is truncated by CSS anyway.
TITLE_MAX = 60

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
    ".ico": "image/x-icon",
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
ARCHIVED_FILE = HERE / "archived.json"
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
    return _sessions_in(folder) if folder else []


def _sessions_in(folder: Path) -> list[dict]:
    sessions = []
    for transcript in folder.glob("*.jsonl"):
        try:
            mtime = transcript.stat().st_mtime
        except OSError:
            continue
        preview, title = session_meta(transcript)
        sessions.append({
            "session_id": transcript.stem,
            "modified": mtime,
            "preview": (preview or "")[:160],
            "title": title,
        })
    sessions.sort(key=lambda item: item["modified"], reverse=True)
    return sessions


def list_projects() -> list[dict]:
    """Sidebar data: every project the CLI has transcripts for, plus recent
    folders opened through the wrapper that have no transcripts yet.

    The real cwd is read from inside the transcripts, not un-sanitised from the
    folder name — the name mangling is lossy (both ":" and "\\" become "-").
    Projects whose folder no longer exists on disk are dropped: opening one
    would only produce a "not a folder" error.
    """
    projects: dict[str, dict] = {}   # lowercased real path -> entry

    def entry_for(path_str: str) -> dict:
        key = path_str.lower()
        if key not in projects:
            projects[key] = {"path": path_str, "modified": 0.0, "sessions": []}
        return projects[key]

    if PROJECTS_DIR.is_dir():
        for candidate in PROJECTS_DIR.iterdir():
            if not candidate.is_dir():
                continue
            transcripts = list(candidate.glob("*.jsonl"))
            if not transcripts:
                continue
            cwd = _first_field(transcripts[0], "cwd")
            if not cwd or not Path(cwd).is_dir():
                continue
            entry = entry_for(cwd)
            entry["sessions"] = _sessions_in(candidate)
            if entry["sessions"]:
                entry["modified"] = entry["sessions"][0]["modified"]
    for recent in load_recents():
        if Path(recent).is_dir():
            entry_for(recent)
    archived = {a.lower() for a in load_archived()}
    result = sorted(projects.values(), key=lambda p: p["modified"], reverse=True)
    for entry in result:
        entry["archived"] = entry["path"].lower() in archived
    return result


def session_meta(path: Path) -> tuple[str | None, str | None]:
    """(first user text, session title) from one pass over a transcript.

    `rename_session` persists a title by APPENDING
    {"type":"custom-title","customTitle":…} to the session's own transcript --
    the only place it lands (wiki/control-protocol.md §4). The last such line
    wins, so the file has to be read to the end; json.loads runs only on the
    lines that can possibly matter, because a long transcript is thousands of
    lines and the sidebar re-reads every session on each refresh.
    """
    first = title = None
    try:
        with path.open("r", encoding="utf-8", errors="replace") as handle:
            for line in handle:
                if '"custom-title"' in line:
                    try:
                        event = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if event.get("type") == "custom-title":
                        title = (event.get("customTitle") or "").strip() or title
                elif first is None and '"user"' in line:
                    try:
                        event = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if event.get("type") != "user" or event.get("isSidechain"):
                        continue
                    for part in event.get("message", {}).get("content", []) or []:
                        if isinstance(part, dict) and part.get("type") == "text":
                            first = (part.get("text") or "").strip()
                            break
    except OSError:
        pass
    return first, title


def transcript_path(cwd: Path, session_id: str) -> Path | None:
    """Existing transcript file for `session_id`, or None.

    Single choke point for the traversal guard: a crafted id must not escape
    the project's transcript folder. Every caller that touches a transcript by
    id goes through here.
    """
    folder = transcript_dir(cwd)
    if folder is None:
        return None
    transcript = (folder / f"{session_id}.jsonl").resolve()
    if folder.resolve() not in transcript.parents or not transcript.is_file():
        return None
    return transcript


def read_session(cwd: Path, session_id: str) -> list[dict]:
    """Replayable events for one session.

    Transcript `user`/`assistant` lines carry the same `message` shape as live
    stream events, so the window renders them with the identical code path
    (plan §B-4: one renderer, two sources). Everything else in the file —
    queue-operation, attachment, last-prompt, and sidechain (subagent) turns —
    is bookkeeping and would only add noise.
    """
    transcript = transcript_path(cwd, session_id)
    if transcript is None:
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


def _load_paths(file: Path) -> list[str]:
    try:
        data = json.loads(file.read_text(encoding="utf-8"))
        return [str(item) for item in data if isinstance(item, str)]
    except (OSError, ValueError):
        return []


def _save_paths(file: Path, items: list[str]) -> None:
    try:
        file.write_text(json.dumps(items, indent=2), encoding="utf-8")
    except OSError:
        pass


def load_recents() -> list[str]:
    return _load_paths(RECENTS_FILE)


def remember_recent(cwd: Path) -> list[str]:
    recents = [item for item in load_recents() if item.lower() != str(cwd).lower()]
    recents.insert(0, str(cwd))
    recents = recents[:MAX_RECENTS]
    _save_paths(RECENTS_FILE, recents)
    return recents


def load_archived() -> list[str]:
    return _load_paths(ARCHIVED_FILE)


def drop_project_from_lists(*variants: str) -> None:
    """Forget a path in recents and archived (case-insensitive)."""
    gone = {v.lower() for v in variants}
    _save_paths(RECENTS_FILE, [i for i in load_recents() if i.lower() not in gone])
    _save_paths(ARCHIVED_FILE, [i for i in load_archived() if i.lower() not in gone])


class PermissionBroker:
    """Blocks an inbound `can_use_tool` request until the GUI answers (§B-5).

    One instance per server. `_answer_control_request` calls request() on its
    own thread and waits; the request is pushed to the window over SSE; the
    user's answer releases the waiter and becomes the control_response.
    """

    def __init__(self, hub: Hub) -> None:
        self.hub = hub
        self._lock = threading.Lock()
        self._pending: dict[str, dict] = {}
        # "always allow this tool for this session" — cleared when the server
        # exits, never written to the user's real settings.
        self.session_allow: set[str] = set()
        # The "autoApprove" posture: the wrapper approves instead of the user.
        # Wrapper-side on purpose — the CLI's own `auto` mode would approve
        # before we ever see the call, and then there is nothing to audit.
        self.auto_approve = False
        self.auto_log: list[dict] = []
        self.posture = "ask"

    def reset_posture(self) -> None:
        """A fresh CLI process spawns with --permission-mode default, so the
        posture and its audit log are session-scoped and must not survive it."""
        with self._lock:
            self.posture = "ask"
            self.auto_approve = False
            self.auto_log.clear()

    def set_posture(self, posture: str, auto: bool) -> None:
        with self._lock:
            self.posture = posture
            self.auto_approve = auto
        self.publish_posture()

    def publish_posture(self) -> None:
        """The pill binds to THIS event, never to its own click: the server
        sends it only after the CLI acknowledged the mode change."""
        with self._lock:
            event = {"type": "wrapper", "subtype": "posture",
                     "posture": self.posture, "auto_count": len(self.auto_log)}
        self.hub.publish(event)

    def request(self, tool_name: str, tool_input: dict, tool_use_id: str | None,
                display_name: str | None = None, description: str | None = None,
                suggestions: list | None = None) -> dict:
        if tool_name in AUTO_ALLOW:
            return {"decision": "allow", "reason": "auto-allow (read-only)"}
        with self._lock:
            if tool_name in self.session_allow:
                return {"decision": "allow", "reason": "session allow-rule"}

        request_id = uuid.uuid4().hex

        with self._lock:
            auto = self.auto_approve
            if auto:
                self.auto_log.append({"tool_name": tool_name,
                                      "at": time.time()})
                count = len(self.auto_log)
        if auto:
            # Approved without asking, but never silently: the window shows a
            # running count and each tool card gets its "allowed" note.
            self._publish_resolved(request_id, tool_use_id, "allow",
                                   auto=True, auto_count=count)
            return {"decision": "allow", "reason": "auto-approve posture"}

        waiter = threading.Event()
        with self._lock:
            self._pending[request_id] = {"event": waiter, "decision": None}

        # display_name/description/permission_suggestions come straight from the
        # CLI's can_use_tool payload -- better than anything we could derive, and
        # the suggestions are the CLI's own answer to "what should 'remember'
        # offer here". See wiki/permission-transport.md.
        self.hub.publish({
            "type": "wrapper",
            "subtype": "permission_request",
            "request_id": request_id,
            "tool_name": tool_name,
            "tool_input": tool_input,
            "tool_use_id": tool_use_id,
            "display_name": display_name,
            "description": description,
            "suggestions": suggestions or [],
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
                          decision: str, auto: bool = False,
                          auto_count: int = 0) -> None:
        self.hub.publish({
            "type": "wrapper",
            "subtype": "permission_resolved",
            "request_id": request_id,
            "tool_use_id": tool_use_id,
            "decision": decision,
            "auto": auto,
            "auto_count": auto_count,
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
                 broker: "PermissionBroker | None" = None) -> None:
        self.broker = broker
        self.cwd = cwd
        self.hub = hub
        self.claude_bin = claude_bin
        self.proc: subprocess.Popen | None = None
        self.session_id: str | None = None
        self.model: str | None = None
        self._write_lock = threading.Lock()
        self._generation = 0   # stale reader threads check this before publishing
        self._interrupt_seq = 0
        # Outbound control requests we are waiting on, keyed by our request_id.
        self._pending: dict[str, dict] = {}
        self._pending_lock = threading.Lock()
        self._control_seq = 0
        # The `initialize` reply: commands, models, account, output styles.
        # Fetched once per process at start(); everything the UI knows about
        # this CLI comes from here rather than being hardcoded.
        self.init_info: dict | None = None
        # First prompt of a brand-new session, kept until the first result
        # turns it into the session title (see _after_result).
        self._titled = True
        self._first_prompt: str | None = None

    def start(self, resume_id: str | None = None) -> None:
        self._generation += 1
        generation = self._generation

        # --resume reuses the same session_id rather than forking (verified,
        # B-9.8), so recovery after a crash is idempotent.
        resume_args = ["--resume", resume_id] if resume_id else []
        self.session_id = resume_id

        # No --settings: hooks supplied that way are ignored entirely by claude
        # 2.1.221 (wiki/permission-hook-broken.md). Approvals arrive in-band as
        # `can_use_tool` control requests instead -- see
        # _answer_control_request() and wiki/permission-transport.md. The user's
        # own ~/.claude/settings.json keeps applying, untouched.
        # CREATE_NO_WINDOW keeps a console from flashing when launched via pythonw.
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        self.proc = subprocess.Popen(
            [self.claude_bin, *CLAUDE_ARGS, *resume_args],
            cwd=str(self.cwd),
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
        self.init_info = None
        # Only a session started from scratch gets an auto-title: a resumed one
        # already has its own history (and possibly a title the user chose).
        self._titled = resume_id is not None
        self._first_prompt = None
        if self.broker:
            self.broker.reset_posture()
        threading.Thread(target=self._read_stdout, args=(proc, generation),
                         daemon=True).start()
        threading.Thread(target=self._read_stderr, args=(proc, generation),
                         daemon=True).start()
        # Ask what this CLI can do. Off-thread: control() blocks on the reader
        # thread above, which must already be running.
        threading.Thread(target=self._fetch_init_info, args=(generation,),
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
            etype = event.get("type")

            # Our own control_request answered. Resolve the waiter; never
            # render it -- the UI has no use for the raw envelope.
            if etype == "control_response":
                response = event.get("response") or {}
                with self._pending_lock:
                    slot = self._pending.pop(response.get("request_id"), None)
                if slot:
                    slot["response"] = response
                    slot["event"].set()
                continue

            # INBOUND control_request: the CLI asking us something. Today that
            # is only can_use_tool -- the approval path (wiki/permission-transport.md).
            # Answered off-thread because the broker blocks on the user, and
            # blocking here would freeze the whole event pump.
            if etype == "control_request":
                threading.Thread(target=self._answer_control_request,
                                 args=(event, generation), daemon=True).start()
                continue

            if etype == "system" and event.get("subtype") == "init":
                self.session_id = event.get("session_id")
                self.model = event.get("model")
            if event.get("type") == "result":
                # Off-thread: the statusline is someone else's script, and the
                # usage/rename control requests wait on THIS reader thread for
                # their replies — doing either here deadlocks the event pump.
                threading.Thread(target=self._after_result,
                                 args=(event, generation), daemon=True).start()
            self.hub.publish(event)
        if generation == self._generation:
            self.hub.publish({"type": "wrapper", "subtype": "cli_exited",
                              "returncode": proc.poll()})

    def _after_result(self, result: dict, generation: int) -> None:
        """Everything that happens once a turn is finished, on one thread."""
        if generation != self._generation:
            return
        try:
            self._title_session(generation)
            self._publish_usage(generation)
        except RuntimeError:
            pass   # the process went away mid-turn; there is nothing to ask
        self._publish_statusline(result, generation)

    def _title_session(self, generation: int) -> None:
        """Name a fresh session after its first prompt.

        Only after the first result: on a session with no messages yet the CLI
        writes the title nowhere at all and the rename is silently lost
        (wiki/control-protocol.md §4). The ack means nothing either way, so the
        sidebar reads the title back out of the transcript.
        """
        if self._titled or not self._first_prompt:
            return
        self._titled = True
        title = " ".join(self._first_prompt.split())[:TITLE_MAX]
        if title:
            self.control("rename_session", title=title)

    def _publish_usage(self, generation: int) -> None:
        """Real context/cost numbers from the CLI instead of client arithmetic.

        Both requests are free and answer on an idle process. If either is
        missing on an older build the client keeps its own estimate — hence
        every key here is optional.
        """
        patch: dict = {}
        context = self.control("get_context_usage", timeout=5.0)
        if context.get("subtype") == "success":
            body = context.get("response") or {}
            if isinstance(body.get("percentage"), (int, float)):
                patch["context"] = body["percentage"]
        usage = self.control("get_usage", timeout=5.0)
        if usage.get("subtype") == "success":
            body = usage.get("response") or {}
            cost = (body.get("session") or {}).get("total_cost_usd")
            if isinstance(cost, (int, float)):
                patch["cost"] = cost
            five = (body.get("rate_limits") or {}).get("five_hour") or {}
            if isinstance(five.get("utilization"), (int, float)):
                patch["quota"] = five["utilization"]
        if patch and generation == self._generation:
            self.hub.publish({"type": "wrapper", "subtype": "usage", **patch})

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
        if not self._titled and self._first_prompt is None:
            self._first_prompt = next(
                (b.get("text") for b in blocks if b.get("type") == "text"), None)
        self._write_line({"type": "user",
                          "message": {"role": "user", "content": blocks}})

    def send_text(self, text: str) -> None:
        self.send_blocks([{"type": "text", "text": text}])

    def control(self, subtype: str, timeout: float = CONTROL_TIMEOUT,
                wait: bool = True, **params) -> dict:
        """Send one control_request and (optionally) wait for its response.

        Unknown subtypes come back as {"subtype": "error", "error": "Unsupported
        control request subtype: X"} rather than failing silently -- that clean
        error is the feature-detection branch. Never gate on a CLI version.
        """
        self._control_seq += 1
        request_id = f"pcg-{subtype}-{self._control_seq}"
        slot = {"event": threading.Event(), "response": None}
        if wait:
            with self._pending_lock:
                self._pending[request_id] = slot
        try:
            self._write_line({
                "type": "control_request",
                "request_id": request_id,
                "request": {"subtype": subtype, **params},
            })
        except Exception:
            with self._pending_lock:
                self._pending.pop(request_id, None)
            raise
        if not wait:
            return {}
        if not slot["event"].wait(timeout):
            with self._pending_lock:
                self._pending.pop(request_id, None)
            return {"subtype": "error", "error": f"{subtype}: timed out"}
        return slot["response"] or {}

    def interrupt(self) -> None:
        """Stop the current turn without killing the process (B-9.10).

        Verified: the CLI answers with control_response subtype "success" and
        ends the turn as result/error_during_execution with terminal_reason
        "aborted_streaming". The process stays alive, so the session — and
        therefore the conversation — survives. Do not kill instead.

        Fire-and-forget: the turn's own result event is the real signal, and
        blocking here would stall the caller's HTTP response.
        """
        self.control("interrupt", wait=False)

    def _answer_control_request(self, event: dict, generation: int) -> None:
        """Answer a control_request the CLI sent US.

        Only `can_use_tool` today: the approval path enabled by
        --permission-prompt-tool stdio. The request_id is a CLI-generated UUID
        and must be echoed verbatim -- do not substitute our own counter.
        """
        request = event.get("request") or {}
        request_id = event.get("request_id")
        subtype = request.get("subtype")

        if subtype != "can_use_tool":
            # Unknown inbound request. Refuse explicitly rather than hanging
            # the CLI, and surface it so the drift is visible.
            self.hub.publish({"type": "wrapper", "subtype": "stderr",
                              "line": f"unhandled inbound control_request: {subtype}"})
            self._reply_control(request_id, {
                "subtype": "error",
                "error": f"unsupported inbound subtype: {subtype}",
            })
            return

        tool_name = request.get("tool_name") or "?"
        tool_input = request.get("input") or {}
        if self.broker is None:
            answer = {"decision": "deny", "reason": "no broker"}
        else:
            answer = self.broker.request(
                tool_name=tool_name,
                tool_input=tool_input,
                tool_use_id=request.get("tool_use_id"),
                display_name=request.get("display_name"),
                description=request.get("description"),
                suggestions=request.get("permission_suggestions") or [],
            )

        if generation != self._generation:
            return   # session restarted while the user was deciding

        if answer.get("decision") == "allow":
            body = {"behavior": "allow", "updatedInput": tool_input}
        else:
            body = {"behavior": "deny",
                    "message": answer.get("reason") or "denied by the user",
                    "interrupt": False}
        self._reply_control(request_id, {"subtype": "success", "response": body})

    def _reply_control(self, request_id: str | None, response: dict) -> None:
        try:
            self._write_line({"type": "control_response",
                              "response": {"request_id": request_id, **response}})
        except Exception as exc:
            self.hub.publish({"type": "wrapper", "subtype": "stderr",
                              "line": f"control_response failed: {exc}"})

    def _fetch_init_info(self, generation: int) -> None:
        """Ask the CLI what it can do, at spawn, before any user message.

        The `system/init` EVENT only arrives after the first turn, which is why
        a fresh window used to show an empty slash popup. This control request
        answers immediately and costs no turn, and its command list is richer
        (descriptions + argument hints). See wiki/control-protocol.md.
        """
        try:
            response = self.control("initialize", timeout=20.0)
        except Exception as exc:
            self.hub.publish({"type": "wrapper", "subtype": "stderr",
                              "line": f"initialize failed: {exc}"})
            return
        info = response.get("response") if response.get("subtype") == "success" else None
        if not info or generation != self._generation:
            return
        self.init_info = info
        self.hub.publish({"type": "wrapper", "subtype": "init_info", "info": info})
        # Publish the (reset) posture on the same path, so a window that opens
        # or reconnects later gets it out of Hub history instead of guessing.
        if self.broker:
            self.broker.publish_posture()

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
        elif parsed.path == "/api/projects":
            # Sidebar payload: all known projects with their sessions inline,
            # one round-trip. The current project may be brand new (opened via
            # --cwd at boot, no transcripts, not in recents yet) — always
            # include it so the sidebar can highlight it.
            projects = list_projects()
            current = str(self.session.cwd)
            if not any(p["path"].lower() == current.lower() for p in projects):
                projects.insert(0, {"path": current, "modified": 0.0, "sessions": []})
            self._send_json(HTTPStatus.OK, {
                "current_cwd": current,
                "current_session": self.session.session_id,
                "projects": projects,
            })
        elif parsed.path == "/api/session":
            session_id = params.get("id", [""])[0]
            if not session_id:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "missing id"})
                return
            # Optional cwd: the sidebar replays sessions from any project, not
            # just the open one. A bogus path just yields an empty event list.
            cwd_raw = params.get("cwd", [""])[0]
            cwd = Path(cwd_raw) if cwd_raw else self.session.cwd
            self._send_json(HTTPStatus.OK, {
                "session_id": session_id,
                "events": read_session(cwd, session_id),
            })
        elif parsed.path == "/favicon.ico":
            # Edge asks for this on its own; the auth cookie is already set by
            # the time it does. Same icon the desktop shortcut uses.
            self._serve_file(HERE / "assets" / "icon.ico")
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
        elif parsed.path == "/api/control":
            # One whitelisted chokepoint for every live CLI control (model,
            # permission mode, compact, rename, usage). Not a passthrough.
            subtype = (body.get("subtype") or "").strip()
            if subtype not in CONTROL_ALLOWED:
                self._send_json(HTTPStatus.BAD_REQUEST,
                                {"error": f"unsupported control: {subtype}"})
                return
            # Not `params` - that name already holds the parsed query string.
            control_params = body.get("params") or {}
            if not isinstance(control_params, dict):
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "params must be an object"})
                return
            # control() takes `timeout` and `wait` as its own keyword arguments,
            # so a params object carrying either would reach into the transport
            # instead of the CLI -- a browser must not be able to do that.
            if control_params.keys() & {"timeout", "wait"}:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "reserved param"})
                return
            try:
                response = self.session.control(subtype, **control_params)
            except (RuntimeError, TypeError) as exc:
                self._send_json(HTTPStatus.CONFLICT, {"error": str(exc)})
                return
            if response.get("subtype") == "error":
                # Includes "Unsupported control request subtype: X" from a CLI
                # build that lacks it - the client feature-detects on this.
                self._send_json(HTTPStatus.OK,
                                {"ok": False, "error": response.get("error")})
                return
            self._send_json(HTTPStatus.OK,
                            {"ok": True, "response": response.get("response") or {}})
        elif parsed.path == "/api/posture":
            # The approval posture is two settings at once (the CLI's permission
            # mode and the wrapper's auto-approve flag), so it is one endpoint
            # rather than two client calls that can half-apply.
            posture = (body.get("posture") or "").strip()
            if posture not in POSTURES:
                self._send_json(HTTPStatus.BAD_REQUEST,
                                {"error": f"unknown posture: {posture}"})
                return
            mode, auto = POSTURES[posture]
            try:
                response = self.session.control("set_permission_mode", mode=mode)
            except RuntimeError as exc:
                self._send_json(HTTPStatus.CONFLICT, {"error": str(exc)})
                return
            if response.get("subtype") == "error":
                # The CLI refused the mode: change nothing. The pill listens for
                # the posture event, so it stays on the posture that is real.
                self._send_json(HTTPStatus.OK,
                                {"ok": False, "error": response.get("error")})
                return
            self.broker.set_posture(posture, auto)
            self._send_json(HTTPStatus.OK, {"ok": True, "posture": posture,
                                            "mode": mode})
        elif parsed.path == "/api/attach/pick":
            self._send_json(HTTPStatus.OK, {"paths": pick_files(Path(sys.executable))})
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
        elif parsed.path == "/api/project/archive":
            # Hide from the sidebar but keep every transcript — reversible.
            raw = (body.get("path") or "").strip()
            if not raw:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "missing path"})
                return
            flag = bool(body.get("archived"))
            items = [i for i in load_archived() if i.lower() != raw.lower()]
            if flag:
                items.insert(0, raw)
            _save_paths(ARCHIVED_FILE, items)
            self._send_json(HTTPStatus.OK, {"ok": True, "archived": flag})
        elif parsed.path == "/api/project/remove":
            # Deletes the project's TRANSCRIPTS and list entries. Never touches
            # the project folder itself — those are the user's files.
            raw = (body.get("path") or "").strip()
            if not raw:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "missing path"})
                return
            target = Path(raw).expanduser()
            norm = str(target.resolve()).lower()
            if norm == str(self.session.cwd).lower():
                self._send_json(HTTPStatus.CONFLICT, {"error": "project is open"})
                return
            folder = transcript_dir(target)
            if folder is not None:
                # Always a child of PROJECTS_DIR by construction (the sanitised
                # name contains no separators; the fallback iterates children).
                shutil.rmtree(folder, ignore_errors=True)
            drop_project_from_lists(raw, norm)
            self._send_json(HTTPStatus.OK, {"ok": True})
        elif parsed.path == "/api/session/resume":
            session_id = (body.get("session_id") or "").strip()
            if not session_id:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "missing session_id"})
                return
            # Optional path: resuming a session that belongs to another project
            # must switch cwd in the same restart, not spawn twice.
            raw = (body.get("path") or "").strip()
            cwd = None
            if raw:
                target = Path(raw).expanduser()
                if not target.is_dir():
                    self._send_json(HTTPStatus.BAD_REQUEST, {"error": "not a folder"})
                    return
                target = target.resolve()
                if str(target).lower() != str(self.session.cwd).lower():
                    cwd = target
            self.session.restart(cwd=cwd, resume_id=session_id)
            if cwd is not None:
                remember_recent(cwd)
            self._send_json(HTTPStatus.OK, {"session_id": session_id})
        elif parsed.path == "/api/session/delete":
            session_id = (body.get("session_id") or "").strip()
            if not session_id:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "missing session_id"})
                return
            # The live process keeps writing its own transcript; deleting it
            # underneath the CLI is a broken state, not a feature.
            if session_id == self.session.session_id:
                self._send_json(HTTPStatus.CONFLICT, {"error": "session is active"})
                return
            # Optional path: the sidebar deletes sessions in any project. The
            # traversal guard on the id lives in transcript_path either way.
            raw = (body.get("path") or "").strip()
            cwd = Path(raw).expanduser() if raw else self.session.cwd
            transcript = transcript_path(cwd, session_id)
            if transcript is None:
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "no such session"})
                return
            try:
                transcript.unlink()
            except OSError as exc:
                self._send_json(HTTPStatus.CONFLICT, {"error": str(exc)})
                return
            self._send_json(HTTPStatus.OK, {"ok": True, "session_id": session_id})
        elif parsed.path == "/api/status":
            self._send_json(HTTPStatus.OK, {
                "session_id": self.session.session_id,
                "cwd": str(self.session.cwd),
                "running": bool(self.session.proc and self.session.proc.poll() is None),
                # Commands, models and account from the CLI's own `initialize`.
                # None until it answers (milliseconds after spawn); the UI must
                # tolerate that and also listen for wrapper/init_info over SSE.
                "init_info": self.session.init_info,
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


def serve(cwd: Path, open_window: bool, verbose: bool) -> None:
    token = secrets.token_urlsafe(32)
    port = free_port()
    endpoint = f"http://127.0.0.1:{port}"
    hub = Hub()
    broker = PermissionBroker(hub)
    session = ClaudeSession(cwd=cwd, hub=hub, claude_bin=find_claude(),
                            broker=broker)
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
    args = parser.parse_args()

    serve(cwd=Path(args.cwd).resolve(),
          open_window=not args.no_window,
          verbose=not args.quiet)


if __name__ == "__main__":
    main()
