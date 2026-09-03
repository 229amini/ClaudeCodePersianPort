"""
server.py - local host for a Persian/RTL front-end over the real Claude Code CLI.

Stdlib only: no npm, no build step, no CDN (see CLAUDE.md). Responsibilities:

  1. serve static/ to a chrome-less Edge app-mode window
  2. own one long-lived `claude -p` subprocess per open TAB (up to MAX_TABS
     concurrent conversations), pumping NDJSON both ways
  3. fan CLI events out to the window over SSE, each tagged with its tab

The CLI contract below is verified against claude 2.1.221 and recorded in
wiki/cli-stream-json-findings.md. Re-verify after a CLI upgrade; the flags and the
event shapes are version-pinned.

Milestone: M2 (skeleton + English round-trip). The permission broker is M4.
"""

from __future__ import annotations

import argparse
import base64
import datetime
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

# Bump on every release. Substituted into any .html this server sends
# ({{VERSION}}), so the window title and the sidebar footer prove which
# build is actually running after an update — the one question a
# non-technical user cannot answer from a folder listing.
APP_VERSION = "1.0.1"

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

# AskUserQuestion is not a permission at all. The CLI routes the model's
# question to us over this same can_use_tool pipe and reads the answer back out
# of the ALLOW reply's `updatedInput.answers`, keyed by question TEXT (measured
# 2026-08-07 -- wiki/permission-transport.md). Three consequences, each a silent
# failure if missed:
#   * it must never be auto-approved. An allow carrying no `answers` is
#     answered "The user did not answer the questions." -- the posture would
#     eat the question and the user would never see it.
#   * it needs its own deadline. The CLI's own askUserQuestionTimeout defaults
#     to "never", so PERMISSION_TIMEOUT is the ONLY thing ending a question,
#     and 110 s is not long enough to read one and decide.
#   * that deadline must ALLOW with no answers, never deny. Allow-with-nothing
#     is exactly what the CLI's own Skip button sends; a deny comes back as an
#     is_error tool_result and reads to the model as a failure.
ASK_TOOL = "AskUserQuestion"
ASK_TIMEOUT = 900.0

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
# `apply_flag_settings` is deliberately NOT in that list even though the effort
# chip needs it. Its params are a free-form settings blob, so whitelisting the
# subtype would let the page write ANY setting -- permissions included -- which
# is the whole reason CONTROL_ALLOWED is a whitelist. /api/effort takes one
# level string instead. See ClaudeSession.set_effort().

# How long a control_request may take before the caller gives up. These are
# local round-trips on an open pipe, so anything slow means trouble.
CONTROL_TIMEOUT = 15.0

# The interrupt receipt's own, much shorter budget. The CLI answers an
# interrupt as soon as it reads the line -- this is NOT one of the slow
# post-result requests (get_context_usage prices every skill, agent and MCP
# tool in scope and was measured at 13 s here; wiki/control-protocol.md §9), and
# borrowing that budget would leave a stop waiting a minute for facts the
# silence backstop had already settled without it. Nothing waits on this
# answer: it only lets the ledger settle EARLIER than the quiet window would.
INTERRUPT_RECEIPT_TIMEOUT = 5.0

# Dropping ONE message from the CLI's command queue by uuid. Same shape of
# request as the interrupt receipt -- a local queue lookup the CLI answers as
# soon as it reads the line -- and emphatically NOT one of the slow
# post-result requests, so it gets its own short budget rather than borrowing
# CONTROL_TIMEOUT. A user is waiting on this one: they clicked the row's x.
CANCEL_QUEUED_TIMEOUT = 5.0

# After an interrupt, how long the CLI must be SILENT before we tell the window
# the turn is over. The window derives "still working" from the result events it
# has seen, so a turn that never reports one leaves it spinning for the life of
# the session -- and the user has ALREADY pressed stop, which makes an
# idle-looking window the more truthful of the two lies.
#
# Silence, not elapsed time, is the signal, and that distinction is the whole
# safety of this: a genuinely stuck CLI says NOTHING, while one that merely
# takes a while to abort (a Bash child resisting termination) keeps streaming.
# Firing on a clock instead would land mid-stream -- resetTurn() nulls the
# streaming bubble, the pulse and the stop button vanish while output is still
# printing, and the next delta opens an orphan bubble nothing settles.
IDLE_SYNC_SECONDS = 5.0

# What /recap says when it has nothing to recap or could not generate one, read
# out of the 2.1.235 bundle. All three come back as an ordinary SUCCESSFUL
# result, so the text is the only thing that tells them from a real recap.
# Re-check after a CLI upgrade; a drifted string costs one stray line, not a
# crash.
# get_context_usage gets its own, much longer budget. It is free, it runs
# off-thread, and nothing waits on it -- but it is not fast: its answer prices
# every skill, agent, MCP tool, slash command and memory file in scope, and it
# is asked at the one moment the CLI is busiest (right after a result).
# Measured 13 s on this PC after a free local command and longer after a real
# turn; the old 5 s budget meant the window's context meter never moved HERE
# and moved fine on a bare machine. See wiki/control-protocol.md §9.
CONTEXT_USAGE_TIMEOUT = 60.0

RECAP_NON_ANSWERS = ("Nothing to recap yet", "Recap cancelled",
                     "Couldn't generate a recap")

# command_lifecycle states that CLOSE a message: `queued` and `started` say
# nothing anyone here can act on. Exactly one of these arrives per command --
# `cancelled` is also what a user-requested removal looks like, so it is not by
# itself a failure. See wiki/cli-stream-json-findings.md "The message queue".
LIFECYCLE_TERMINAL = frozenset({"completed", "cancelled", "discarded",
                                "refused"})

# The three approval postures the pill offers -> (CLI permission mode, wrapper
# auto-approve). `bypassPermissions` is never sent (the engine refuses it) and
# neither is `auto`: it approves before the wrapper is ever asked, so there is
# nothing left to show the user. The full-auto posture is therefore wrapper-side
# -- the CLI still asks us, we answer instantly, and every answer is logged.
POSTURES = {
    # `plan` is the CLI's own mode: it refuses every edit and every command and
    # answers with a plan instead, which the model then asks to leave through
    # ExitPlanMode -- a normal can_use_tool request, so the plan arrives in the
    # same dialog as any other approval and is NOT in AUTO_ALLOW.
    "plan": ("plan", False),
    "ask": ("default", False),
    "acceptEdits": ("acceptEdits", False),
    "autoApprove": ("default", True),
}

# The reverse map, for a mode the CLI changed by itself -- approving a plan
# leaves `plan` behind. `default` is deliberately absent: two postures map to
# it, so an echo of `default` is ambiguous and handled in sync_cli_mode().
CLI_MODE_POSTURE = {"plan": "plan", "acceptEdits": "acceptEdits"}

# Longest session title we ask the CLI to store. Titles render in a narrow
# sidebar; anything longer is truncated by CSS anyway.
TITLE_MAX = 60
# Same reasoning for a project's display name (one line in the same sidebar).
NAME_MAX = 64

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


# Replay events kept PER TAB. Six long-lived conversations never reset any
# more, so this is the only bound left on Hub memory -- reset() used to supply
# one by accident, every time the single session was swapped.
HISTORY_MAX = 5000


class Hub:
    """Fan-out of CLI events to every connected SSE client.

    Replay history is bucketed by tab: every event carries the `tab` it belongs
    to (stamped by TabHub), one client replays all of them and routes per tab,
    and closing a tab drops its bucket wholesale.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._clients: set[queue.Queue] = set()
        self._history: dict[str | None, list[dict]] = {}
        # Tabs that have been closed. A stopped session's reader thread is
        # still draining a dying pipe and publishes wrapper/cli_exited some
        # milliseconds later -- without this it lands AFTER drop() and
        # re-creates the bucket it just deleted, which then replays to every
        # window for the life of the server.
        self._closed: set[str] = set()
        # Monotonic cursor stamped on every published event and sent as the
        # SSE `id:` field. An EventSource auto-reconnect sends it back as
        # Last-Event-ID, and subscribe() then replays only what the window
        # missed. Without this a reconnect (sleep/wake, any transient drop)
        # re-delivered the whole backlog: the transcript duplicated and the
        # renderer's user_echo/result counting ran a second time -- a
        # reconnect landing mid-turn left the window busy FOREVER, which is
        # the "finished session still says it is thinking" report.
        self._seq = 0
        self.last_empty_at: float | None = time.monotonic()

    def subscribe(self, after: int = 0) -> queue.Queue:
        q: queue.Queue = queue.Queue()
        with self._lock:
            # Replay what already happened so a reconnecting window is not
            # blank. Order holds WITHIN a bucket, which is all that matters:
            # the client renders one tab at a time. `after` is the seq the
            # window last saw; 0 (a fresh window) replays everything.
            #
            # A FRESH window's replay is marked, because that window has to be
            # able to tell backlog from live: everything in it already happened,
            # and the give-back paths (a cancelled queued message hands its text
            # back to the composer) would re-run on every reload and grow a
            # zombie draft. A CURSOR-resume is deliberately NOT marked -- those
            # events have never been processed by that window, so they are
            # live-equivalent. Marked on a shallow COPY: the stored event is
            # replayed to every future subscriber and must stay pristine.
            for bucket in self._history.values():
                for event in bucket:
                    if event.get("seq", 0) > after:
                        q.put(event if after else {**event, "replayed": True})
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
            if event.get("tab") in self._closed:
                return
            self._seq += 1
            event["seq"] = self._seq
            bucket = self._history.setdefault(event.get("tab"), [])
            bucket.append(event)
            if len(bucket) > HISTORY_MAX:
                del bucket[:-HISTORY_MAX]
            targets = list(self._clients)
        for q in targets:
            q.put(event)

    def idle_seconds(self) -> float:
        with self._lock:
            if self._clients or self.last_empty_at is None:
                return 0.0
            return time.monotonic() - self.last_empty_at

    def reset(self, tab: str | None = None) -> None:
        """Drop ONE tab's replay history and tell every window to clear it.

        Without this a window that reconnects would replay a conversation the
        tab no longer holds. Other tabs' buckets are untouched -- that is the
        whole difference from the single-session server this replaced.
        """
        with self._lock:
            self._history.pop(tab, None)
        self.publish({"type": "wrapper", "subtype": "reset", "tab": tab})

    def drop(self, tab: str) -> None:
        """Forget a closed tab entirely: nothing of it replays again, and
        nothing it publishes from here on is kept either."""
        with self._lock:
            self._history.pop(tab, None)
            self._closed.add(tab)


class TabHub:
    """A Hub view bound to one tab: `publish` stamps, `reset` scopes.

    Every publisher underneath a conversation -- the ClaudeSession, its
    PermissionBroker, the /api/message echo -- holds one of these instead of
    the Hub itself, so all ~16 publish sites tag their events without knowing
    that tabs exist.
    """

    def __init__(self, hub: Hub, tab: str) -> None:
        self.hub = hub
        self.tab = tab

    def publish(self, event: dict) -> None:
        event["tab"] = self.tab
        self.hub.publish(event)

    def reset(self) -> None:
        self.hub.reset(self.tab)


PROJECTS_DIR = Path.home() / ".claude" / "projects"
RECENTS_FILE = HERE / "recents.json"
ARCHIVED_FILE = HERE / "archived.json"
PINNED_FILE = HERE / "pinned.json"
# Display-name overrides, {path: name}. Wrapper-only state: the CLI has no
# project-rename route (rename_session is a SESSION thing), and the folder on
# disk is never touched -- so it lives here beside the other three lists.
NAMES_FILE = HERE / "names.json"
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
        preview, title, spoken = session_meta(transcript)
        sessions.append({
            "session_id": transcript.stem,
            # When the conversation last SAID something, not when the file was
            # last touched -- see session_meta(). mtime only stands in for a
            # transcript with no message in it at all.
            "modified": spoken or mtime,
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
    pinned = {p.lower() for p in load_pinned()}
    names = _names_lower()
    # Pinned first, then most recent. Two keys in one sort rather than two
    # passes: `modified` is a float, so negating it reverses only that half.
    result = sorted(projects.values(),
                    key=lambda p: (p["path"].lower() not in pinned, -p["modified"]))
    for entry in result:
        entry["archived"] = entry["path"].lower() in archived
        entry["pinned"] = entry["path"].lower() in pinned
        # Absent when there is no override -- the window falls back to the
        # folder's own name, so there is nothing to send.
        if entry["path"].lower() in names:
            entry["name"] = names[entry["path"].lower()]
    return result


CLI_ENVELOPE_RE = re.compile(r"^\s*<[a-z][a-z-]+>")


def user_prompt_text(content) -> str | None:
    """What the person actually typed on a `user` turn, or None.

    Two shapes reach here and only the second was ever handled, which is why
    every session started outside the wrapper had no preview at all:

    * the wrapper's own turns go out as stream-json, so they come back as
      ``[{"type": "text", ...}]``;
    * a session started in the interactive CLI stores the typed prompt as a
      bare **string**.

    That string is frequently not a prompt. The CLI injects its own
    ``<local-command-caveat>``, ``<command-name>`` and ``<system-reminder>``
    envelopes as user turns — it talking to itself. Showing one as a session's
    title, or replaying it as something the person said, is worse than showing
    nothing, so those are dropped and the caller keeps looking.
    """
    if isinstance(content, str):
        text = content.strip()
    else:
        text = ""
        for part in content or []:
            if isinstance(part, dict) and part.get("type") == "text":
                text = (part.get("text") or "").strip()
                break
    if not text or CLI_ENVELOPE_RE.match(text):
        return None
    return text


TIMESTAMP_RE = re.compile(r'"timestamp":"([^"]+)"')


def session_meta(path: Path) -> tuple[str | None, str | None, float | None]:
    """(first user text, session title, last spoken time) in one pass.

    `rename_session` persists a title by APPENDING
    {"type":"custom-title","customTitle":…} to the session's own transcript --
    the only place it lands (wiki/control-protocol.md §4). The last such line
    wins, so the file has to be read to the end; json.loads runs only on the
    lines that can possibly matter, because a long transcript is thousands of
    lines and the sidebar re-reads every session on each refresh.

    The third value is why the sidebar does not sort on st_mtime. MERELY OPENING
    a session rewrites its transcript: the CLI appends `mode`, `attachment` and
    `file-history-snapshot` lines at spawn, and any SessionStart hook adds an
    isMeta `user` line on top of that. So mtime moves the instant you click --
    the clicked session jumps to the top of the list under the cursor, before a
    single word has been exchanged. Measured on this machine: transcripts whose
    last real message was six hours old carried an mtime from a minute ago.

    A `user`/`assistant` line that is not isMeta is the one thing an open cannot
    fabricate, so its timestamp is what "recent" has to mean. Matched as raw
    text, not parsed: these files run to thousands of lines and every session in
    the sidebar is re-read on each refresh.
    """
    first = title = None
    spoken = None
    try:
        with path.open("r", encoding="utf-8", errors="replace") as handle:
            for line in handle:
                if ('"type":"user"' in line or '"type":"assistant"' in line) \
                        and '"isMeta":true' not in line:
                    stamp = TIMESTAMP_RE.search(line)
                    if stamp:
                        spoken = stamp.group(1)
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
                    first = user_prompt_text(event.get("message", {}).get("content"))
    except OSError:
        pass
    return first, title, iso_epoch(spoken)


def iso_epoch(stamp: str | None) -> float | None:
    """Transcript timestamps are UTC ISO-8601 with a literal Z, which
    fromisoformat only accepts from 3.11 on -- and the target PC's Python is
    whatever setup.ps1 found there."""
    if not stamp:
        return None
    try:
        return datetime.datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


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


def _normalize_transcript_event(event: dict) -> dict | None:
    """One transcript line -> the `{type, message}` shape the renderer wants,
    or None to drop it. Shared by `read_session()` and the per-agent
    transcript view (`read_agent_events()`) — an agent's own `.jsonl` is
    written in the identical record format (wiki/background-agents.md), so
    the normalisation is the same; only the caller-side `isSidechain` check
    differs, because an agent file is entirely sidechain by definition.

    A message folded into a running turn (sent while one is in flight) is
    written ONLY as an `attachment`/`queued_command` line -- there is no
    `type:"user"` record for it anywhere in the file, so without this it
    silently disappears from replay while the answer to it stays. Every
    other attachment shape (`queue-operation` folds, bare bookkeeping) stays
    dropped; this is the one attachment shape that is a real thing the
    person said.
    """
    if event.get("type") == "attachment":
        attachment = event.get("attachment") or {}
        if (attachment.get("type") == "queued_command"
                and attachment.get("commandMode") == "prompt"
                and not event.get("isMeta") and not event.get("isSynthetic")):
            return {"type": "user", "message": {"content": attachment.get("prompt") or []}}
        return None
    if event.get("type") not in ("user", "assistant"):
        return None
    message = event.get("message", {})
    if event["type"] == "user" and isinstance(message.get("content"), str):
        raw = message["content"]
        if raw.lstrip().startswith("<task-notification>"):
            # A real event, not the CLI talking to itself like the envelopes
            # below — must survive replay so the completion card can render.
            # Passed through BEFORE user_prompt_text(): its CLI_ENVELOPE_RE
            # matches "<task-notification>" too (same shape as the noise it
            # exists to drop), so this has to jump the filter, not pass it.
            message = {"content": [{"type": "text", "text": raw}]}
        else:
            # A typed prompt from a session started outside the wrapper.
            # Normalised to the block shape the renderer already handles, so
            # "one renderer, two sources" keeps holding, and filtered so the
            # CLI's own envelopes never replay as the person's words.
            text = user_prompt_text(raw)
            if text is None:
                return None
            message = {"content": [{"type": "text", "text": text}]}
    return {"type": event["type"], "message": message}


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
            if event.get("isMeta"):
                # The CLI's own UI never shows these, and a skill load injects
                # its ENTIRE SKILL.md as ordinary block-shaped content under
                # this flag -- session_meta() already treats isMeta as "not
                # real activity" for sort purposes; this is that same flag,
                # gating replay instead. A task-notification user message
                # carries no isMeta key, so this cannot eat one.
                continue
            if event.get("isSidechain"):
                continue
            normalized = _normalize_transcript_event(event)
            if normalized is not None:
                events.append(normalized)
    return events


# --- Background agents ---------------------------------------------------
#
# wiki/background-agents.md is the measured contract. Registry state comes
# ONLY from the main transcript file on disk, never from the live stdout
# stream: whether the task-notification actually reaches stream-json stdout
# in `-p` mode is unmeasured (the session the contract was measured against
# ran the interactive TUI), but the CLI demonstrably WRITES both the launch
# ack and every notification to the transcript, live and in replay alike.
# One parser, one source of truth, no leaning on an unverified stream shape.

AGENT_ID_RE = re.compile(r"^[0-9a-f]{6,40}$")
TASK_NOTIFICATION_RE = re.compile(r"<task-notification>(.*?)</task-notification>", re.DOTALL)
ASYNC_AGENT_ID_RE = re.compile(r"agentId:\s*([0-9a-f]{6,40})")


def subagents_dir(cwd: Path, session_id: str) -> Path | None:
    r"""`<transcript-dir>\<session-id>\subagents\` for one session, or None.

    Routed through `transcript_path()` first, so a session id that fails
    ITS traversal/existence guard can never reach here either.
    """
    transcript = transcript_path(cwd, session_id)
    if transcript is None:
        return None
    folder = transcript.parent / session_id / "subagents"
    return folder if folder.is_dir() else None


def agent_file_path(cwd: Path, session_id: str, agent_id: str, suffix: str) -> Path | None:
    """`agent-<agent_id>.<suffix>` inside one session's subagents folder, or
    None. Same choke-point discipline as `transcript_path()`: the id must
    match the CLI's own hex-id shape AND the resolved path must stay inside
    the folder — every caller that touches an agent file by id goes through
    here.
    """
    if not AGENT_ID_RE.match(agent_id):
        return None
    folder = subagents_dir(cwd, session_id)
    if folder is None:
        return None
    target = (folder / f"agent-{agent_id}.{suffix}").resolve()
    if folder.resolve() not in target.parents or not target.is_file():
        return None
    return target


def _xml_unescape(text: str) -> str:
    """task-notification content escapes &, < and > (wiki/background-agents
    .md) — undo it before a tag's value reaches a caller."""
    return (text.replace("&lt;", "<").replace("&gt;", ">")
                .replace("&quot;", '"').replace("&apos;", "'")
                .replace("&amp;", "&"))


def _tag(body: str, name: str) -> str | None:
    match = re.search(rf"<{name}>(.*?)</{name}>", body, re.DOTALL)
    return _xml_unescape(match.group(1).strip()) if match else None


def _tool_result_text(content) -> str:
    """Plain text out of a `tool_result`'s own `content`, which is either a
    bare string or the usual `[{"type": "text", ...}]` blocks."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(part.get("text", "") for part in content
                        if isinstance(part, dict) and part.get("type") == "text")
    return ""


def _tail_lines(path: Path, offset: int) -> tuple[list[str], int]:
    """Complete lines appended after byte `offset`, and the new offset.

    A trailing partial line (the CLI still mid-write) is left unconsumed —
    parsing it now would silently drop it on a JSON error, and the offset
    would already be past it, losing it for good. So the offset only
    advances past the last full line; the partial one is read whole on the
    next poll.
    """
    with path.open("rb") as handle:
        handle.seek(offset)
        chunk = handle.read()
    if not chunk:
        return [], offset
    cut = chunk.rfind(b"\n")
    if cut == -1:
        return [], offset
    lines = chunk[:cut].decode("utf-8", errors="replace").split("\n")
    return lines, offset + cut + 1


def _msg_content(event: dict):
    """`message.content`, or None. Its SHAPE is what tells the two `user`
    records apart (see `_scan_agent_line`): a bare string is the CLI
    auto-submitting a task-notification, a list is tool_result parts."""
    message = event.get("message")
    return message.get("content") if isinstance(message, dict) else None


def _scan_agent_launch(event: dict, pending: dict) -> None:
    """`assistant` event, `tool_use` named "Agent" -> stash description +
    agentType under the tool_use id, awaiting the launch ack (the join key,
    wiki/background-agents.md)."""
    for part in (_msg_content(event) or []):
        if not (isinstance(part, dict) and part.get("type") == "tool_use"
                and part.get("name") == "Agent"):
            continue
        tool_use_id = part.get("id")
        if not tool_use_id:
            continue
        inp = part.get("input") or {}
        # A synchronous agent (run_in_background: false) never acks, so this
        # entry is simply never claimed — harmless, not worth pruning for the
        # lifetime of one project's cache entry.
        pending[tool_use_id] = {
            "description": inp.get("description"),
            "agentType": inp.get("subagent_type"),
        }


def _scan_agent_ack(event: dict, registry: dict, pending: dict) -> None:
    """`user` event carrying the `tool_result` for an `Agent` tool_use ->
    create the registry entry. Two data sources, per wiki/background-agents
    .md: the sibling `toolUseResult` field when present, else the
    `tool_result` TEXT (what actually streams live), parsed as a fallback.

    An entry is created ONLY when the tool_use_id joins a pending `Agent`
    launch. Without that join any tool_result whose TEXT merely quotes
    "Async agent launched" — reading a wiki page or another transcript does
    it — minted a description-less entry that reported "running" for the
    life of the process (3 such entries across this machine's 315 real
    transcripts, all stuck at completed=False).
    """
    for part in (_msg_content(event) or []):
        if not (isinstance(part, dict) and part.get("type") == "tool_result"):
            continue
        tool_use_id = part.get("tool_use_id")
        launch = pending.pop(tool_use_id, None) if tool_use_id else None
        if launch is None:
            continue
        tur = event.get("toolUseResult")
        agent_id = model = description = None
        if isinstance(tur, dict) and tur.get("isAsync") and tur.get("status") == "async_launched":
            agent_id = tur.get("agentId")
            model = tur.get("resolvedModel")
            description = tur.get("description")
        else:
            text = _tool_result_text(part.get("content"))
            if "Async agent launched" not in text:
                continue
            match = ASYNC_AGENT_ID_RE.search(text)
            if not match:
                continue
            agent_id = match.group(1)
        if not agent_id:
            continue
        entry = registry.setdefault(agent_id, {"completed": False, "finishedAt": None, "summary": None})
        entry["id"] = agent_id
        entry["kind"] = "agent"
        entry["description"] = description or launch.get("description")
        entry["agentType"] = launch.get("agentType")
        entry["model"] = model
        entry["startedAt"] = iso_epoch(event.get("timestamp"))


def _scan_notification(event: dict, registry: dict) -> None:
    """A `<task-notification>` block, as either a `queue-operation` record
    or the `user` message the CLI auto-submits from it (wiki/background-
    agents.md) — both carry the same tags, and the same task-id can appear
    twice, so this always overwrites rather than appending.

    A task-id with no matching registry entry is a background COMMAND
    (`Bash` with `run_in_background`): it has no Agent launch/ack to join
    to and no subagents files, so its notification IS the whole record.
    """
    content = event.get("content") if event.get("type") == "queue-operation" \
        else _msg_content(event)
    if not isinstance(content, str):
        return
    match = TASK_NOTIFICATION_RE.search(content)
    if not match:
        return
    body = match.group(1)
    task_id = _tag(body, "task-id")
    if not task_id:
        return
    timestamp = iso_epoch(event.get("timestamp"))
    entry = registry.get(task_id)
    if entry is None:
        entry = {
            "id": task_id, "kind": "command", "description": None,
            "agentType": None, "model": None, "startedAt": timestamp,
        }
        registry[task_id] = entry
    entry["finishedAt"] = timestamp
    entry["summary"] = _tag(body, "summary")
    entry["completed"] = True


# The cheap pre-filter: a line mentioning none of these three cannot carry any
# of the three markers, and skipping it costs one substring scan instead of a
# json.loads. It is a FILTER, never a route — see _scan_agent_line().
_AGENT_MARKERS = ('"name":"Agent"', '"tool_result"', "task-notification")


def _scan_agent_line(line: str, registry: dict, pending: dict) -> None:
    """Route one transcript line to the scanner its PARSED shape calls for.

    Deciding the route from substring order instead was wrong in both
    directions: a task-notification carries the finished agent's own final
    text, so it can quote `"tool_result"` or `"name":"Agent"` and be handed
    to a scanner that parses it cleanly, matches nothing and drops it — after
    which nothing ever marks that agent completed and the panel reports it
    running forever. json.loads once, then dispatch on `type` plus the SHAPE
    of `message.content`: a bare string is the auto-submitted notification, a
    list is tool_result parts (wiki/background-agents.md).
    """
    if not any(marker in line for marker in _AGENT_MARKERS):
        return
    try:
        event = json.loads(line)
    except json.JSONDecodeError:
        return
    if not isinstance(event, dict):
        return
    etype = event.get("type")
    if etype == "assistant":
        _scan_agent_launch(event, pending)
    elif etype == "queue-operation":
        _scan_notification(event, registry)
    elif etype == "user":
        content = _msg_content(event)
        if isinstance(content, str):
            _scan_notification(event, registry)
        elif isinstance(content, list):
            _scan_agent_ack(event, registry, pending)


_AGENT_CACHE: dict[str, dict] = {}
_AGENT_CACHE_LOCK = threading.Lock()


def build_agent_registry(transcript: Path) -> dict[str, dict]:
    """Agents and background commands launched from one transcript, keyed by
    id.

    Cached per transcript path: a request re-stats the file and parses only
    the bytes appended since the last call — the CLI only appends, so the
    common case is a handful of new lines, not a multi-thousand-line re-read
    on every poll. A file that got SHORTER than the cached offset (rotated,
    or a stale cache from a deleted+recreated session) forces a full rescan
    rather than reading from a now-bogus offset.

    Returns a shallow copy so a caller iterating the result cannot collide
    with another thread's concurrent scan mutating the live cache —
    ThreadingHTTPServer means two /api/agents polls for the same session can
    race.
    """
    key = str(transcript)
    with _AGENT_CACHE_LOCK:
        try:
            size = transcript.stat().st_size
        except OSError:
            return {}
        cached = _AGENT_CACHE.get(key)
        if cached is None or cached["offset"] > size:
            offset, registry, pending = 0, {}, {}
        else:
            offset, registry, pending = cached["offset"], cached["registry"], cached["pending"]
        lines, new_offset = _tail_lines(transcript, offset)
        for line in lines:
            _scan_agent_line(line, registry, pending)
        _AGENT_CACHE[key] = {"offset": new_offset, "registry": registry, "pending": pending}
        return {agent_id: dict(entry) for agent_id, entry in registry.items()}


def _agent_status(entry: dict, live: bool, spawned_at: float | None) -> str:
    """"completed" once any task-notification was seen, else "running" only
    if this is the wrapper's currently live CLI session AND the entry's ack
    (`startedAt`) is not older than that process's own `spawned_at`.

    `--resume` keeps `session_id` stable across a kill (B-9.8), so `live`
    alone cannot tell a genuinely running agent from one orphaned by a PRIOR
    process: killing the CLI kills every agent it launched too, but writes no
    task-notification, so nothing ever marks that entry completed. Without
    the age check, --resume makes `live` true again and the orphan reports
    "running" forever. An entry with no `startedAt` (unparseable timestamp)
    is given the benefit of the doubt rather than assumed orphaned.
    """
    if entry.get("completed"):
        return "completed"
    if not live:
        return "stopped"
    started = entry.get("startedAt")
    if spawned_at is not None and started is not None and started < spawned_at:
        return "stopped"
    return "running"


def _enrich_agent_meta(folder: Path | None, entry: dict) -> None:
    """Fill agentType/model from `agent-<id>.meta.json` when it exists —
    written once per agent and more precise than the launch/ack (wiki/
    background-agents.md: meta's `model` is the short name, e.g. "opus",
    where the ack's `resolvedModel` is the full id)."""
    agent_id = entry.get("id") or ""
    if folder is None or entry.get("kind") != "agent" or not AGENT_ID_RE.match(agent_id):
        return
    try:
        meta = json.loads((folder / f"agent-{agent_id}.meta.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return
    if meta.get("agentType"):
        entry["agentType"] = meta["agentType"]
    if meta.get("model"):
        entry["model"] = meta["model"]


def read_agent_events(agent_file: Path, after: int = 0) -> tuple[list[dict], int]:
    """Replayable events from one agent's own transcript, same `{type,
    message}` shape as `read_session()` — the file is the identical record
    format (wiki/background-agents.md), but every line is `isSidechain:
    true` (the file IS the sidechain), so that flag is not a drop signal
    here the way it is for the main transcript.

    `after` and the returned int are LINE indices into the raw file, not
    event counts (most lines are bookkeeping the caller never sees), so the
    client can pass the returned value back verbatim as the next `after`.

    Same straggler discipline as `_tail_lines()`: text-mode iteration still
    yields a trailing line with no newline yet (the CLI mid-write on it), so
    a line missing its terminator is never counted into `total` -- doing so
    would put the client's cursor past a record that doesn't exist yet, and
    once the CLI finished writing it the line would be skipped forever.
    """
    events: list[dict] = []
    total = 0
    with agent_file.open("r", encoding="utf-8", errors="replace") as handle:
        for total, line in enumerate(handle, start=1):
            if total <= after:
                continue
            if not line.endswith("\n"):
                total -= 1
                break
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if event.get("isMeta"):
                # Same flag, same reason as read_session()'s isMeta guard --
                # a skill load injects its whole SKILL.md under this flag, and
                # unlike there, _normalize_transcript_event() drops isMeta
                # entirely, so it must be checked on the raw event.
                continue
            normalized = _normalize_transcript_event(event)
            if normalized is not None:
                events.append(normalized)
    return events, total


USER_SETTINGS = Path.home() / ".claude" / "settings.json"
ANSI_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
SGR_RE = re.compile(r"\x1b\[([0-9;]*)m")
NON_SGR_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-ln-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)")

# xterm-256 index -> #rrggbb. 0-15 is the terminal's own palette (these are the
# Windows Terminal / VS Code values); 16-231 is the 6x6x6 cube, 232-255 the
# greyscale ramp. Both formulas are the standard ones.
BASE16 = ("#3b3b3b", "#cd3131", "#0dbc79", "#e5e510", "#3b8eea", "#bc3fbc",
          "#11a8cd", "#cccccc", "#666666", "#f14c4c", "#23d18b", "#f5f543",
          "#6ab0ff", "#d670d6", "#29b8db", "#ffffff")
CUBE = (0, 95, 135, 175, 215, 255)


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


def xterm_color(n: int) -> str:
    if n < 16:
        return BASE16[n]
    if n < 232:
        n -= 16
        return "#%02x%02x%02x" % (CUBE[n // 36], CUBE[n // 6 % 6], CUBE[n % 6])
    v = 8 + 10 * (n - 232)
    return "#%02x%02x%02x" % (v, v, v)


def apply_sgr(style: dict, params: str) -> dict:
    """Fold one SGR escape into the running style. Unknown codes are ignored."""
    codes = [int(p) for p in params.split(";") if p != ""] or [0]
    style = dict(style)
    i = 0
    while i < len(codes):
        c = codes[i]
        if c == 0:
            style = {}
        elif c in (1, 2, 3):
            style[{1: "bold", 2: "dim", 3: "italic"}[c]] = True
        elif c == 22:
            style.pop("bold", None), style.pop("dim", None)
        elif c == 23:
            style.pop("italic", None)
        elif c == 39:
            style.pop("fg", None)
        elif c == 49:
            style.pop("bg", None)
        elif 30 <= c <= 37:
            style["fg"] = BASE16[c - 30]
        elif 90 <= c <= 97:
            style["fg"] = BASE16[c - 82]
        elif 40 <= c <= 47:
            style["bg"] = BASE16[c - 40]
        elif 100 <= c <= 107:
            style["bg"] = BASE16[c - 92]
        elif c in (38, 48):
            key = "fg" if c == 38 else "bg"
            if codes[i + 1:i + 2] == [5] and len(codes) > i + 2:
                style[key] = xterm_color(codes[i + 2])
                i += 2
            elif codes[i + 1:i + 2] == [2] and len(codes) > i + 4:
                style[key] = "#%02x%02x%02x" % tuple(codes[i + 2:i + 5])
                i += 4
        i += 1
    return style


def ansi_segments(text: str) -> list[dict]:
    """Split terminal output into styled runs: [{text, fg?, bg?, bold?, …}].

    A statusline encodes meaning in colour — which mode is active, whether the
    context bar is near full. The window used to strip ANSI and show grey text,
    which threw that channel away. Parsed here rather than in JS so the client
    only has to build spans, and so nothing ever reaches the DOM as markup.
    """
    text = NON_SGR_RE.sub("", text)
    segments: list[dict] = []
    style: dict = {}
    pos = 0
    for m in SGR_RE.finditer(text):
        run = text[pos:m.start()]
        if run:
            segments.append({"text": run, **style})
        style = apply_sgr(style, m.group(1))
        pos = m.end()
    if text[pos:]:
        segments.append({"text": text[pos:], **style})
    return segments


def run_statusline(command: str, payload: dict) -> list[dict] | None:
    # NOT shell=True. That becomes `cmd /c <command>`, and cmd strips the outer
    # quote pair of a command that starts with a quoted exe path — which is
    # exactly what every statusLine running node or python out of
    # "C:\Program Files\…" looks like. It failed with rc=1 and empty stdout,
    # and this function swallowed it, so plan §B-7 passthrough was silently
    # dead. `/s /c "<command>"` is the documented form: strip one outer pair,
    # pass the rest through verbatim.
    comspec = os.environ.get("COMSPEC", "cmd.exe")
    try:
        done = subprocess.run(
            f'{comspec} /s /c "{command}"',
            input=json.dumps(payload, ensure_ascii=False),
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=10, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    return ansi_segments((done.stdout or "").strip()) or None


IMAGE_SUFFIXES = frozenset({".png", ".jpg", ".jpeg", ".gif", ".webp"})
IMAGE_MEDIA_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                     ".gif": "image/gif", ".webp": "image/webp"}
MAX_IMAGE_BYTES = 5 * 1024 * 1024
PASTE_DIR = Path(tempfile.gettempdir()) / "persian-claude-gui-paste"


def save_pasted_image(media_type: str, data: str) -> str | None:
    """Spill a clipboard image to disk and hand back its path.

    Ctrl+V in the CLI attaches an image; in the window the clipboard gives us
    bytes with no path, and every downstream step here (the chip row,
    build_message_blocks, the size cap) is written against paths. Writing one
    temp file reuses all of it instead of growing a second attachment shape.
    """
    suffix = next((s for s, m in IMAGE_MEDIA_TYPES.items() if m == media_type), None)
    if suffix is None:
        return None
    try:
        raw = base64.b64decode(data, validate=True)
    except (ValueError, TypeError):
        return None
    if not raw or len(raw) > MAX_IMAGE_BYTES:
        return None
    PASTE_DIR.mkdir(parents=True, exist_ok=True)
    target = PASTE_DIR / f"paste-{uuid.uuid4().hex[:12]}{suffix}"
    target.write_bytes(raw)
    return str(target)


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


# Every read-modify-write of recents/archived/pinned/names goes under this.
# ponytail: one lock for all four files, not one per file -- they are written
# on a user click, never in a loop. Concurrent /api/project/open calls (one per
# tab) are what made them reachable from two threads at once.
_STORE_LOCK = threading.Lock()


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


def _load_names() -> dict[str, str]:
    """The {path: display name} store.

    Deliberately NOT _load_paths: that one filters a LIST of strings, so a dict
    reaches it as its keys at best and as [] at worst -- silently, which is how
    every renamed project would lose its name with no error anywhere.
    """
    try:
        data = json.loads(NAMES_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    return {str(k): str(v) for k, v in data.items() if isinstance(v, str)}


def _save_names(names: dict[str, str]) -> None:
    try:
        NAMES_FILE.write_text(json.dumps(names, ensure_ascii=False, indent=2),
                              encoding="utf-8")
    except OSError:
        pass


def _names_lower() -> dict[str, str]:
    """Overrides keyed by LOWERCASED path -- the same case convention the
    sidebar's own dedupe (entry_for) and every path list here already use.
    The stored key keeps whatever case the window sent."""
    return {k.lower(): v for k, v in _load_names().items()}


def set_project_name(raw: str, name: str) -> str:
    """Store (or clear) one project's display name; returns the name in force.

    An empty name deletes the override, and the name in force falls back to the
    folder's own -- which is exactly what the sidebar renders when there is no
    entry, so the response never has to describe two different states.
    """
    name = (name or "").strip()[:NAME_MAX]
    with _STORE_LOCK:
        names = {k: v for k, v in _load_names().items() if k.lower() != raw.lower()}
        if name:
            names[raw] = name
        _save_names(names)
    return name or Path(raw).name


def load_recents() -> list[str]:
    return _load_paths(RECENTS_FILE)


def remember_recent(cwd: Path) -> list[str]:
    with _STORE_LOCK:
        recents = [item for item in load_recents() if item.lower() != str(cwd).lower()]
        recents.insert(0, str(cwd))
        recents = recents[:MAX_RECENTS]
        _save_paths(RECENTS_FILE, recents)
    return recents


def load_archived() -> list[str]:
    return _load_paths(ARCHIVED_FILE)


def load_pinned() -> list[str]:
    return _load_paths(PINNED_FILE)


def toggle_in_list(file: Path, raw: str, on: bool) -> None:
    """Add or remove one path in a path-list file, case-insensitively."""
    with _STORE_LOCK:
        items = [i for i in _load_paths(file) if i.lower() != raw.lower()]
        if on:
            items.insert(0, raw)
        _save_paths(file, items)


def drop_project_from_lists(*variants: str) -> None:
    """Forget a path in recents, archived, pinned and names (case-insensitive).

    The name has to go too: a folder created again at the same path is a
    different project, and inheriting the removed one's name is a lie that
    survives forever because nothing ever asks about it again.
    """
    gone = {v.lower() for v in variants}
    with _STORE_LOCK:
        for file in (RECENTS_FILE, ARCHIVED_FILE, PINNED_FILE):
            _save_paths(file, [i for i in _load_paths(file) if i.lower() not in gone])
        _save_names({k: v for k, v in _load_names().items() if k.lower() not in gone})


class PermissionBroker:
    """Blocks an inbound `can_use_tool` request until the GUI answers (§B-5).

    One instance per SESSION, holding that session's TabHub. That is what makes
    the posture, «دوباره نپرس» and the auto-approve audit per-tab by
    construction: the leakage family recorded in reset_posture() below cannot
    cross a tab boundary because there is nothing shared to cross.

    `_answer_control_request` calls request() on its own thread and waits; the
    request is pushed to the window over SSE; the user's answer releases the
    waiter and becomes the control_response.
    """

    def __init__(self, hub: "Hub | TabHub") -> None:
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
        posture, its audit log and every "don't ask again" are session-scoped
        and must not survive it.

        session_allow used to be the exception, and it was the dangerous one:
        the pill went back to «محتاط» on a project switch while a Write the
        user had remembered for the PREVIOUS conversation was still approving
        itself silently in the new folder.
        """
        with self._lock:
            self.posture = "ask"
            self.auto_approve = False
            self.auto_log.clear()
            self.session_allow.clear()

    def has_pending(self) -> bool:
        """Is anyone still waiting on the user to answer a dialog?

        Read by ClaudeSession._sync_idle: a blocked CLI is stdout-silent, and
        silence is what that watchdog treats as proof there is nothing left.
        """
        with self._lock:
            return bool(self._pending)

    def sync_cli_mode(self, mode: str) -> None:
        """Follow a permission mode the CLI changed on its own.

        Approving an ExitPlanMode call is the case that matters: the engine
        leaves `plan` by itself, and a pill still reading «طرح» would be the
        exact failure this project keeps writing down -- a safety control that
        looks engaged and is not. Bound to the `system/status` echo, which is
        the only honest report of the mode in force (the ack for
        set_permission_mode returns modes nobody asked for).
        """
        with self._lock:
            if POSTURES.get(self.posture, ("", False))[0] == mode:
                return          # already agrees; also how autoApprove survives
            posture = CLI_MODE_POSTURE.get(mode) or ("ask" if mode == "default" else None)
            if posture is None or posture == self.posture:
                return          # a mode the pill does not model (auto, dontAsk)
            self.posture, self.auto_approve = posture, POSTURES[posture][1]
        self.publish_posture()

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

        request_id = uuid.uuid4().hex

        # A question is never "approved" -- see ASK_TOOL. Both silent paths are
        # skipped here rather than at their two call sites, so a future third
        # auto-approver cannot reintroduce the swallow.
        asking = tool_name == ASK_TOOL

        with self._lock:
            remembered = not asking and tool_name in self.session_allow
            auto = not asking and self.auto_approve
            if remembered or auto:
                self.auto_log.append({"tool_name": tool_name, "at": time.time(),
                                      "why": "remembered" if remembered else "posture"})
                count = len(self.auto_log)

        if remembered:
            # «دوباره نپرس» is consent given once, not consent to go quiet. This
            # used to return before publishing anything, so a remembered Write
            # or PowerShell ran with NO trace in the window -- the same silent
            # approval the postures exist to prevent, and it happened under
            # «محتاط» too.
            self._publish_resolved(request_id, tool_use_id, "allow", auto=True,
                                   auto_count=count, tool_name=tool_name,
                                   why="remembered")
            return {"decision": "allow", "reason": "session allow-rule"}

        if auto:
            # Approved without asking, but never silently: the window shows a
            # running count and each tool card gets its "allowed" note.
            self._publish_resolved(request_id, tool_use_id, "allow",
                                   auto=True, auto_count=count,
                                   tool_name=tool_name, why="posture")
            return {"decision": "allow", "reason": "auto-approve posture"}

        waiter = threading.Event()
        with self._lock:
            # tool_use_id/tool_name ride along so deny_all() can publish the
            # same shaped resolved event this thread would have published.
            self._pending[request_id] = {"event": waiter, "decision": None,
                                         "tool_use_id": tool_use_id,
                                         "tool_name": tool_name}

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

        answered = waiter.wait(timeout=ASK_TIMEOUT if asking else PERMISSION_TIMEOUT)
        with self._lock:
            entry = self._pending.pop(request_id, None)
        if answered and entry is None:
            # deny_all() got here first: it took the entry, published the deny
            # and released us. Publishing again would double the event.
            return {"decision": "deny", "reason": "the conversation was closed"}
        decision = (entry or {}).get("decision")

        if not answered or decision not in ("allow", "deny"):
            if asking:
                # An unanswered question is a skip, not a refusal: allow with
                # no answers is what the CLI's own Skip button sends.
                self._publish_resolved(request_id, tool_use_id, "allow",
                                       tool_name=tool_name)
                return {"decision": "allow", "answers": {}}
            # Timed out or the window went away. Deny: an unattended wrapper
            # must not approve a tool call on the user's behalf.
            self._publish_resolved(request_id, tool_use_id, "deny",
                                   tool_name=tool_name)
            return {"decision": "deny", "reason": "timed out waiting for the user"}

        self._publish_resolved(request_id, tool_use_id, decision,
                               tool_name=tool_name)
        return {"decision": decision, "reason": "user decision",
                "answers": (entry or {}).get("answers")}

    def _publish_resolved(self, request_id: str, tool_use_id: str | None,
                          decision: str, auto: bool = False,
                          auto_count: int = 0, tool_name: str | None = None,
                          why: str | None = None) -> None:
        self.hub.publish({
            "type": "wrapper",
            "subtype": "permission_resolved",
            "request_id": request_id,
            "tool_use_id": tool_use_id,
            "decision": decision,
            "auto": auto,
            "auto_count": auto_count,
            # The window's audit list names the tool and says which of the two
            # silent paths approved it; the card cannot supply either when the
            # card is not there yet.
            "tool_name": tool_name,
            "why": why,
        })

    def respond(self, request_id: str, decision: str, remember: bool,
                tool_name: str | None, answers: dict | None = None) -> bool:
        with self._lock:
            entry = self._pending.get(request_id)
            if entry is None:
                return False
            entry["decision"] = decision
            # AskUserQuestion's payload. Keyed by question text; the value is an
            # option label, a list of labels, or free text. Validated by the CLI,
            # not here -- a value it does not recognise is still a real answer
            # and is passed through as typed.
            if isinstance(answers, dict):
                entry["answers"] = answers
            if remember and decision == "allow" and tool_name:
                self.session_allow.add(tool_name)
            entry["event"].set()
        return True

    def deny_all(self) -> None:
        """Answer every request still waiting on the user: deny, right now.

        Closing a tab used to leave its waiters blocked for the full
        PERMISSION_TIMEOUT, and the deny they published on the way out landed
        AFTER Hub.drop() -- discarded by the closed-tab guard, so the window's
        dialog for that conversation never went away either. Both halves are
        fixed by resolving here, synchronously: the publish happens while the
        tab still exists, and the waiter is released before it is stopped.

        The entry is taken rather than just flagged, so request() knows this
        path already published its event (it returns without publishing a
        second one).
        """
        with self._lock:
            pending = list(self._pending.items())
            self._pending.clear()
        for request_id, entry in pending:
            entry["decision"] = "deny"
            entry["event"].set()
            self._publish_resolved(request_id, entry.get("tool_use_id"), "deny",
                                   tool_name=entry.get("tool_name"))


class ClaudeSession:
    """One long-lived `claude -p` process. A turn is one NDJSON line on stdin.

    Multi-instance by design: every field here is per-instance and the reader
    threads are guarded by `_generation`, so N of these run side by side, one
    per open tab. What ties an instance to a tab is the TabHub it publishes
    through — nothing else in here knows tabs exist.
    """

    def __init__(self, cwd: Path, hub: "Hub | TabHub", claude_bin: str,
                 broker: "PermissionBroker | None" = None) -> None:
        self.broker = broker
        self.cwd = cwd
        self.hub = hub
        self.claude_bin = claude_bin
        self.proc: subprocess.Popen | None = None
        self.session_id: str | None = None
        self.spawned_at: float | None = None  # set in start(); see _agent_status()
        # THE LEDGER: the command_uuid of every message we have sent that the
        # CLI has not yet reported finished. Not a count, because one `result`
        # does not mean one send on 2.1.241 -- a mid-turn message is FOLDED into
        # the running turn and never runs as its own turn, and a queued batch
        # MERGES into one turn, so N sends can produce ONE result and a counter
        # leaks upward for the life of the session (the reported "it still says
        # it is thinking"). The CLI closes each entry itself on its
        # `command_lifecycle` channel -- see wiki/cli-stream-json-findings.md
        # "The message queue". /api/tabs reports `busy`, which is the only way a
        # background tab can show it is working.
        #
        # A dict rather than a set purely for its INSERTION ORDER: the legacy
        # compat path (_close_one_command) has to close the OLDEST entry, and a
        # set's iteration order is arbitrary -- it closed message B while A was
        # the one that finished, promoting a still-queued message into the
        # transcript as delivered. Values are unused.
        self._outstanding: dict[str, None] = {}
        self._outstanding_lock = threading.Lock()
        # Has this process ever spoken on that channel? Anything older than
        # 2.1.241 never does, and its entries would never close -- see
        # _after_result(), which then closes one per result itself.
        self._lifecycle_seen = False
        self.model: str | None = None
        self._write_lock = threading.Lock()
        self._generation = 0   # stale reader threads check this before publishing
        # Monotonic instant after which an interrupt with no answer gives up and
        # tells the window itself. 0.0 = nothing is waiting. Pushed forward by
        # every byte the CLI sends (_touch_idle) -- see IDLE_SYNC_SECONDS.
        self._idle_deadline = 0.0
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
        # A /recap is in flight: swallow its answer (see the reader loop), and
        # the ledger entry it opened, which is the one command the window is
        # never told about.
        self._recap_wanted = False
        self._recap_uuid: str | None = None

    # ponytail: the ledger is stick-proofed at both ends -- discarding an
    # unknown uuid is free, every path that ends a PROCESS empties it outright
    # (start, cli exit), and an interrupt settles it from the CLI's own receipt
    # with five seconds of silence behind that. A uuid that sticks leaves a tab
    # reporting "working" for the life of the server, and nothing else would
    # ever clear it.
    @property
    def busy(self) -> bool:
        return bool(self._outstanding)

    def _reset_inflight(self) -> list[str]:
        """Empty the ledger; returns the uuids that never reported.

        (The name is what test_units.py pins it by.) The caller decides whether
        anyone is told: only the process-exit path owes the window a synthetic
        terminal state for each of them.
        """
        with self._outstanding_lock:
            dropped = list(self._outstanding)
            self._outstanding.clear()
            # Whatever a pending /recap was waiting for is not coming (a new
            # process, a dead one). A flag left standing would swallow the next
            # REAL answer, so it dies with the ledger. (interrupt() clears it
            # too, without emptying the ledger -- see there.)
            self._recap_wanted = False
            return dropped

    def start(self, resume_id: str | None = None) -> None:
        self._generation += 1
        generation = self._generation
        # A DELIBERATE respawn (a resume, a restart) kills whatever the old
        # process still held exactly as a crash would -- and the generation bump
        # above suppresses the old reader's own death-path publish, so this is
        # the only report those uuids will ever get. Without it a queued
        # message's text vanished on a restart while the identical crash case
        # handed it back to the composer. Before the new process exists, so
        # nothing it says can overtake it.
        for command_uuid in self._reset_inflight():
            self.hub.publish({"type": "command_lifecycle",
                              "command_uuid": command_uuid,
                              "state": "discarded", "synthetic": True})
        # Detected per process, never from a version string: the capability
        # list lives on system/init, which is not emitted until the first turn
        # starts, so nothing can gate on it at spawn time.
        self._lifecycle_seen = False

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
        # This process's own incarnation, not the session's: --resume keeps
        # session_id stable across a kill (B-9.8), so session_id alone can't
        # tell a live agent from one orphaned by a prior, now-dead process --
        # _agent_status() needs this to tell the two apart.
        self.spawned_at = time.time()
        proc = self.proc
        self.init_info = None
        # Only system/init knows which model a session runs on. Carrying the
        # previous one over would feed a stale name to the statusline payload
        # below, which now runs before the first turn on a resume.
        self.model = None
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
        # A resumed session already has an identity; a fresh one has nothing to
        # show yet. Same reason as above for the thread: control() waits on the
        # reader thread.
        if resume_id:
            threading.Thread(target=self._publish_resume_prefill,
                             args=(generation,), daemon=True).start()

    # restart() is gone with the single-session server. Switching project or
    # resuming a session now SPAWNS a tab (Handler.open_tab); killing the
    # running conversation to make room for another one was the whole defect.

    def alive(self) -> bool:
        return bool(self.proc and self.proc.poll() is None)

    def _read_stdout(self, proc: subprocess.Popen, generation: int) -> None:
        # try/finally, not a plain loop-then-tail: this thread is the ONLY thing
        # that can tell a window its CLI is gone, and the window's "still
        # working" state is derived from events this loop publishes. An
        # exception in here (a closed pipe mid-read, a thread that cannot be
        # spawned for a result) used to skip the exit publish entirely, leaving
        # the pulse breathing over a process that no longer exists.
        try:
            self._pump_stdout(proc, generation)
        finally:
            if generation == self._generation:
                # Every queued message died with the process, not just the
                # current turn. The CLI's own instruction to wrappers is to
                # synthesize `discarded` for anything that never reached a
                # terminal state, so the ledger closes on the same channel it
                # opened on -- BEFORE the exit notice, which is the last word
                # this thread has (and what test_units.py asserts).
                for command_uuid in self._reset_inflight():
                    self.hub.publish({"type": "command_lifecycle",
                                      "command_uuid": command_uuid,
                                      "state": "discarded", "synthetic": True})
                self.hub.publish({"type": "wrapper", "subtype": "cli_exited",
                                  "returncode": proc.poll()})

    def _pump_stdout(self, proc: subprocess.Popen, generation: int) -> None:
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            # A restarted session leaves the old reader draining a dead pipe;
            # its events must not leak into the new conversation.
            if generation != self._generation:
                continue
            # This line is proof of life. A pending interrupt waits for SILENCE,
            # not for a clock, so anything the CLI says pushes that deadline out
            # -- see _sync_idle(). Before the parse: a line we cannot read is
            # still a line it sent.
            self._touch_idle()
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                # Never crash on unparseable output; surface it as a raw card.
                self.hub.publish({"type": "raw", "line": line})
                continue
            etype = event.get("type")

            # BACKSTOP for the ledger, and it is required rather than optional:
            # the schema documents two holes (a turn that fails by THROWING can
            # leave `started` with no terminal state, a dropped message can
            # leave `queued` with none). Five seconds of CLI SILENCE after a
            # result is the version-independent proof there is nothing left --
            # every stdout line pushes the deadline out (_touch_idle above) and
            # send_blocks() disarms it, so only a CLI with nothing to say fires
            # it. Armed here rather than in _after_result so the swallowed
            # /recap result arms it too.
            if etype == "result":
                # Under the lock like every other write to it: _sync_idle reads
                # and clears it there, so an unlocked write can be lost or read
                # stale right on the five-second boundary.
                with self._outstanding_lock:
                    self._idle_deadline = time.monotonic() + IDLE_SYNC_SECONDS
                self._arm_idle_sync(IDLE_SYNC_SECONDS)

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

            # A /recap we asked for ourselves. It answers as an ordinary
            # assistant+result pair, so without this the window would render
            # the CLI's own closing note as a reply to a message nobody sent.
            # Swallowed here and re-published as its own event instead.
            if self._recap_wanted and etype in ("assistant", "result",
                                                "stream_event"):
                if etype != "result":
                    continue
                self._recap_wanted = False
                # _after_result never runs for this event, so on a CLI with no
                # lifecycle channel the recap's own command would sit in the
                # ledger forever. Closed SILENTLY, unlike every other one: the
                # window never learned this uuid (a recap publishes no
                # user_echo), so a terminal state for it would be noise.
                with self._outstanding_lock:
                    self._outstanding.pop(self._recap_uuid, None)
                text = (event.get("result") or "").strip()
                if (text and not event.get("is_error")
                        and not text.startswith(RECAP_NON_ANSWERS)):
                    self.hub.publish({"type": "wrapper", "subtype": "recap",
                                      "text": text})
                continue

            # The CLI closing an entry in the ledger. Forwarded to the window
            # like any other event -- the renderer keys its own status line on
            # exactly these uuids, which is the whole point of not counting
            # results. Unknown uuids are the CLI's own (a cron trigger, a
            # teammate's prompt, a deferred turn resuming: those emit
            # started/terminal with no `queued`), and pop() ignores them.
            if etype == "command_lifecycle":
                self._lifecycle_seen = True
                if event.get("state") in LIFECYCLE_TERMINAL:
                    with self._outstanding_lock:
                        self._outstanding.pop(event.get("command_uuid"), None)

            if etype == "system" and event.get("subtype") == "init":
                self.session_id = event.get("session_id")
                self.model = event.get("model")
                # The CLI shows its statusline from the moment it starts, not
                # from the first answer. Publishing only on `result` left the
                # bar empty for the whole first turn. Off-thread for the same
                # reason `_after_result` is: it runs someone else's script.
                threading.Thread(target=self._publish_statusline,
                                 args=(event, generation), daemon=True).start()
            # The CLI's own echo of the mode in force. It moves without being
            # asked -- approving a plan leaves `plan` -- so the pill follows it.
            if etype == "system" and isinstance(event.get("permissionMode"), str):
                if self.broker:
                    self.broker.sync_cli_mode(event["permissionMode"])
            self.hub.publish(event)
            if etype == "result":
                # Off-thread: the statusline is someone else's script, and the
                # usage/rename control requests wait on THIS reader thread for
                # their replies — doing either here deadlocks the event pump.
                # AFTER the publish above, so the synthetic terminal state it
                # may emit cannot overtake the result it belongs to.
                threading.Thread(target=self._after_result,
                                 args=(event, generation), daemon=True).start()

    def _after_result(self, result: dict, generation: int) -> None:
        """Everything that happens once a turn is finished, on one thread."""
        if generation != self._generation:
            return   # a dead process's turn; start() already emptied the ledger
        # A CLI with no command_lifecycle channel (anything before 2.1.241)
        # never closes its own entries, so the wrapper closes one per result --
        # exactly what it counted before the channel existed -- and SAYS so on
        # that channel, so the window has one code path for both. A CLI that
        # does have it always emits `queued`/`started` before the first result,
        # so this never fires there.
        if not self._lifecycle_seen:
            self._close_one_command()
        try:
            self._title_session(generation)
            self._publish_usage(generation)
        except RuntimeError:
            pass   # the process went away mid-turn; there is nothing to ask
        self._publish_statusline(result, generation)

    def _close_one_command(self) -> None:
        """Close the OLDEST ledger entry ourselves, on the CLI's behalf.

        The legacy contract is one result per message, in order, so the oldest
        open entry is the one this result belongs to -- which is why the ledger
        is insertion-ordered. Taking an arbitrary one closed the message still
        sitting in the CLI's queue and promoted it into the transcript as
        delivered while the CLI still held it. The window keys on the uuid, so
        the closure is published rather than done silently -- it renders
        identically to a real terminal state.
        """
        with self._outstanding_lock:
            command_uuid = next(iter(self._outstanding), None)
            if command_uuid is None:
                return
            self._outstanding.pop(command_uuid, None)
        self.hub.publish({"type": "command_lifecycle", "state": "completed",
                          "command_uuid": command_uuid, "synthetic": True})

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
        def publish(patch: dict) -> None:
            if patch and generation == self._generation:
                self.hub.publish({"type": "wrapper", "subtype": "usage", **patch})

        # Two requests, published SEPARATELY as each answers -- the renderer
        # merges whatever keys arrive and never erases a good value with a
        # missing one. One patch at the end put them in a queue, and the slow
        # one then took the fast one down with it: get_usage is ~1 s, while
        # get_context_usage after a real turn is tens of seconds (§9), so the
        # cost and quota numbers were lost to a context breakdown that had not
        # come back yet.
        usage = self.control("get_usage")
        if usage.get("subtype") == "success":
            body = usage.get("response") or {}
            patch: dict = {}
            cost = (body.get("session") or {}).get("total_cost_usd")
            if isinstance(cost, (int, float)):
                patch["cost"] = cost
            five = (body.get("rate_limits") or {}).get("five_hour") or {}
            if isinstance(five.get("utilization"), (int, float)):
                patch["quota"] = five["utilization"]
            publish(patch)

        # Last, and with a budget of its own: nothing waits on it now.
        context = self.control("get_context_usage", timeout=CONTEXT_USAGE_TIMEOUT)
        if context.get("subtype") == "success":
            body = context.get("response") or {}
            if isinstance(body.get("percentage"), (int, float)):
                publish({"context": body["percentage"]})

    def _publish_statusline(self, result: dict, generation: int) -> None:
        command = statusline_command()
        if not command:
            return
        segments = run_statusline(command, {
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
        if segments and generation == self._generation:
            self.hub.publish({"type": "wrapper", "subtype": "statusline",
                              "segments": segments,
                              "text": "".join(s["text"] for s in segments)})

    def _publish_resume_prefill(self, generation: int) -> None:
        """Fill the status bar of a resumed session before its first turn.

        Everything that normally paints it — system/init, result, usage,
        statusline — only arrives once the CLI has processed a message, so a
        resumed session showed a blank bar until the user typed. By now we
        already know the two facts that identify it: session_id (it IS the
        resume id, set in start()) and cwd. The rest is free — both usage
        control requests answer on an idle process (wiki/control-protocol.md
        §6) and the statusline runs off-thread with its own timeout.

        The model stays unknown until system/init names it. init_info's
        `models` is the catalogue of what this account CAN use, not what this
        session is on — reading it here would print a confident wrong answer.
        """
        if generation != self._generation:
            return
        self.hub.publish({"type": "wrapper", "subtype": "resumed",
                          "session_id": self.session_id, "cwd": str(self.cwd)})
        try:
            self._publish_usage(generation)
        except RuntimeError:
            pass   # the process went away; there is nothing to ask
        self._publish_statusline({}, generation)

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

    def send_blocks(self, blocks: list[dict], recap: bool = False) -> str:
        """Send one message; returns the command_uuid the CLI will report on."""
        if not self._titled and self._first_prompt is None:
            self._first_prompt = next(
                (b.get("text") for b in blocks if b.get("type") == "text"), None)
        # The uuid is what turns the lifecycle channel ON for this message: the
        # CLI emits no lifecycle events at all for a frame without one, and it
        # validates the format, so uuid4 rather than anything of our own.
        command_uuid = str(uuid.uuid4())
        # Recorded BEFORE the write: a fast result can land while _write_line is
        # still returning, and recording it afterwards would leave the ledger --
        # and therefore the tab -- stuck at "working" forever.
        with self._outstanding_lock:
            self._outstanding[command_uuid] = None
            # Set here rather than by the caller so that ANY ordinary send
            # clears it: a /recap whose answer never arrived would otherwise
            # leave the flag standing and eat the next real reply.
            self._recap_wanted = recap
            # Disarm the silence backstop: the CLI has work again, so whatever
            # quiet the last result armed is no longer evidence of anything.
            self._idle_deadline = 0.0
        try:
            # The uuid goes at the TOP LEVEL of the frame, beside `type` -- not
            # inside `message`. Measured on the wire, 2.1.241.
            self._write_line({"type": "user", "uuid": command_uuid,
                              "message": {"role": "user", "content": blocks}})
        except Exception:
            with self._outstanding_lock:
                self._outstanding.pop(command_uuid, None)
                self._recap_wanted = False   # nothing was sent; nothing to swallow
            raise
        return command_uuid

    def send_text(self, text: str, recap: bool = False) -> str:
        return self.send_blocks([{"type": "text", "text": text}], recap=recap)

    def request_recap(self) -> bool:
        """Ask the CLI for its own one-line session recap.

        `/recap` is a LOCAL command (`supportsNonInteractive: true`, measured on
        2.1.235): it answers over this same pipe as a synthetic assistant
        message plus a result, is never written to the transcript, and on an
        empty session refuses for free with "Nothing to recap yet". It is not
        free otherwise -- it re-reads the conversation and generates a line --
        which is why the CLI itself only fires it when the user has been away.

        Refused while a turn is running: the reader tells a recap from a real
        answer by a flag, and two in flight at once would cross the wires.
        """
        if self.busy or self._recap_wanted:
            return False
        self._recap_uuid = self.send_text("/recap", recap=True)
        return True

    def control(self, subtype: str, timeout: float = CONTROL_TIMEOUT,
                wait: bool = True, **params) -> dict:
        """Send one control_request and (optionally) wait for its response.

        Unknown subtypes come back as {"subtype": "error", "error": "Unsupported
        control request subtype: X"} rather than failing silently -- that clean
        error is the feature-detection branch. Never gate on a CLI version.
        """
        request_id, slot = self._send_control(subtype, wait, params)
        if slot is None:
            return {}
        return self._await_control(subtype, request_id, slot, timeout)

    def _send_control(self, subtype: str, wait: bool,
                      params: dict) -> tuple[str, dict | None]:
        """Write one control_request; returns its id and (if waiting) its slot.

        Split out of control() so a caller can send on ITS OWN thread and wait
        on another -- interrupt() must, because the reply arrives on the reader
        thread and the HTTP handler may not sit on it (see _settle_interrupt).
        """
        slot = {"event": threading.Event(), "response": None} if wait else None
        # The counter mints the request_id, so it belongs under the same lock as
        # the pending table: spawn already fires initialize/get_settings/usage
        # concurrently, and two callers reading the same seq would produce one
        # id for two waiters -- the reply then resolves whichever it finds and
        # the other waits out its timeout for an answer that already arrived.
        with self._pending_lock:
            self._control_seq += 1
            request_id = f"pcg-{subtype}-{self._control_seq}"
            if slot is not None:
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
        return request_id, slot

    def _await_control(self, subtype: str, request_id: str, slot: dict,
                       timeout: float) -> dict:
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

        Fire-and-forget for the CALLER: the receipt is read on a thread of its
        own and the turn's own result event is still the real signal, so the
        HTTP response never waits on either.
        """
        # `cancel_queued` FALSE, matching the CLI's own Esc: the interrupt
        # aborts the turn that is RUNNING, and queued messages survive to run
        # next -- "queued commands survive the interrupt", the CLI's own docs
        # (wiki/cli-stream-json-findings.md, "The message queue"). This build
        # sent True from 2026-08-24 to 2026-08-31 because a surviving queue
        # then ran with no spinner and no way out; the uuid ledger closed that
        # hole (still_queued rows keep the window busy, `started` promotes
        # them), so True had become parity debt: the TUI's Esc keeps the queue,
        # this window's stop drained it. The strip's per-row X
        # (/api/queue/cancel) is the queue-cancel now; stop is not one.
        #
        # Sent even when we believe nothing is running. The ledger is our
        # bookkeeping, not the CLI's, and a stop button that quietly declines to
        # send because OUR view drifted is the failure the user reported --
        # pressing it twice is exactly what happens when the first press looked
        # like nothing. The CLI answers an interrupt it has no turn for with a
        # plain `success`, so the cost of being wrong here is one line on a pipe.
        request_id, slot = self._send_control("interrupt", True,
                                              {"cancel_queued": False})
        # Off-thread on purpose: the answer is delivered BY the reader thread,
        # so waiting on this one would deadlock the event pump, and the HTTP
        # handler must not sit on it either.
        threading.Thread(target=self._settle_interrupt,
                         args=(request_id, slot, self._generation),
                         daemon=True).start()
        # Whatever a pending /recap was waiting for is not coming; a flag left
        # standing would refuse the next recap and (until the next ordinary
        # send reset it) swallow an answer.
        self._recap_wanted = False
        # ONE path, busy or not, and the ledger is NOT emptied here: the receipt
        # says which uuids the CLI actually cancelled, and the ones it lists as
        # still queued will run and report for themselves. What covers the rest
        # -- no receipt at all, an older CLI, the running command's terminal
        # state (unmeasured, so never assumed) -- is SILENCE, which also answers
        # the "we already knew nothing was running" case, since a CLI with
        # nothing to do is exactly the one that stays quiet.
        # Under the lock: send_blocks() disarms it there, and an unlocked arm
        # here could land after a concurrent send had already cancelled it.
        with self._outstanding_lock:
            self._idle_deadline = time.monotonic() + IDLE_SYNC_SECONDS
        self._arm_idle_sync(IDLE_SYNC_SECONDS)

    def cancel_queued(self, message_uuid: str) -> bool:
        """Drop ONE pending message from the CLI's command queue, by uuid.

        `cancel_async_message` is documented as a no-op for a message already
        dequeued for execution, and answers {"cancelled": false} for it -- which
        is the whole protocol the window needs: false means that message is
        running and its own `started` will report it, so the row it belongs to
        must stay. Measured free for a uuid that was never enqueued
        (wiki/cli-stream-json-findings.md, probe_queue.py).

        A true answer closes our ledger entry and SAYS so on the lifecycle
        channel, exactly as _settle_interrupt does: the window keys its status
        line on these uuids, so a cancellation nobody publishes would leave it
        working forever. Whether the CLI also emits its own `cancelled` for the
        uuid is unmeasured and does not matter -- discarding an entry that is
        already gone is a no-op here and in the window.
        """
        reply = self.control("cancel_async_message",
                             timeout=CANCEL_QUEUED_TIMEOUT,
                             message_uuid=message_uuid)
        if reply.get("subtype") != "success":
            return False
        if not (reply.get("response") or {}).get("cancelled"):
            return False
        with self._outstanding_lock:
            ours = message_uuid in self._outstanding
            self._outstanding.pop(message_uuid, None)
        if ours:
            self.hub.publish({"type": "command_lifecycle", "state": "cancelled",
                              "command_uuid": message_uuid, "synthetic": True})
        return True

    def _settle_interrupt(self, request_id: str, slot: dict,
                          generation: int) -> None:
        """Close the ledger entries the interrupt's receipt says were cancelled.

        The receipt (`interrupt_receipt_v1`) carries `cancelled[]` and
        `still_queued[]`. Only the first list is acted on: a still-queued
        command WILL run and report its own terminal state, and clearing it here
        was the defect -- the window settled its status line while a message it
        had sent was still on its way to an answer.

        Idempotent by construction: the CLI may also emit its own `cancelled`
        lifecycle for these uuids, and discarding one that is already gone is a
        no-op both here and in the window (render.js ignores a uuid it never
        sent). No receipt, or one this build does not answer, is not an error --
        the silence backstop in _sync_idle() settles exactly as it did before.
        """
        receipt = self._await_control("interrupt", request_id, slot,
                                      INTERRUPT_RECEIPT_TIMEOUT)
        if generation != self._generation:
            return   # a dead process's ledger; start()/cli exit emptied it
        cancelled = (receipt.get("response") or {}).get("cancelled")
        if receipt.get("subtype") != "success" or not isinstance(cancelled, list):
            return
        for command_uuid in cancelled:
            with self._outstanding_lock:
                if command_uuid not in self._outstanding:
                    continue        # already closed, or never ours
                self._outstanding.pop(command_uuid, None)
            # Published, not dropped: the window keys its own status line on
            # these uuids (the _close_one_command precedent) and a synthetic
            # terminal state renders identically to a real one.
            self.hub.publish({"type": "command_lifecycle", "state": "cancelled",
                              "command_uuid": command_uuid, "synthetic": True})

    def _arm_idle_sync(self, delay: float) -> None:
        timer = threading.Timer(delay, self._sync_idle, (self._generation,))
        timer.daemon = True   # never hold the process open for this
        timer.start()

    def _touch_idle(self) -> None:
        """Any byte from the CLI means it is alive: push the deadline out.

        Cheap on purpose -- this runs once per stdout line. Re-arming a real
        timer per event would be one thread per event; the timer already out
        re-arms itself once, for whatever is left (see _sync_idle).

        Under the lock, like every other read or write of the deadline: it is
        uncontended, and once per stdout line is not a cost worth a race with
        the timer thread that reads-then-clears it.
        """
        with self._outstanding_lock:
            if self._idle_deadline:
                self._idle_deadline = time.monotonic() + IDLE_SYNC_SECONDS

    def _sync_idle(self, generation: int) -> None:
        """Tell every window this conversation has nothing in flight.

        The window keys its status line on the same uuid ledger this class
        keeps, so anything that loses a terminal state strands it at "working"
        forever -- an interrupt the CLI answered with silence, a turn that
        failed by throwing, a reader thread that died mid-batch. This is the
        wrapper saying what only it can know.

        Two guards, each for a race that would produce a visible defect:

        - a deadline still in the FUTURE means the CLI has spoken since the
          arming, so it is alive and its own events will do the cleanup. Wait
          out the rest of the silence rather than firing mid-stream, which would
          null the streaming bubble and drop the pulse and the stop button while
          output was still printing.
        - a ZERO deadline means nobody is waiting. That dedupes the second timer
          left over by a second press of stop, and it is how send_blocks()
          cancels a sync whose window elapsed just as a message went out --
          under the SAME lock this reads it, so there is no gap left.

        There is a THIRD guard, and it is the one that made silence an unsafe
        proof on its own: a `can_use_tool` request the user has not answered yet
        is the CLI BLOCKED, not the CLI idle -- it says nothing on stdout for as
        long as the dialog is up, so the deadline expires mid-turn and the ledger
        gets cleared under a running turn. The broker is the only side that knows,
        so the deadline is pushed out for as long as it has anyone waiting.

        The residual this leaves is a model that stalls for more than five
        seconds between stream events with NO permission pending, which is
        accepted: it settles the window early, and both halves of that are
        harmless now -- a queued row is handed back to the composer rather than
        lost (render.js clearQueued), and the settle buys no /recap, so it cannot
        eat the answer that is still coming.

        The ledger is then EMPTIED rather than consulted: it is armed only by an
        interrupt or by a `result`, and after either of those a CLI that still
        had work would be talking. Silence is the evidence. Idempotent -- the
        renderer's handler is a no-op on a window that has already settled, so
        the ordinary fire five seconds after a finished turn costs nothing.
        """
        if generation != self._generation:
            return
        with self._outstanding_lock:
            deadline = self._idle_deadline
            if not deadline:
                return
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                if self.broker and self.broker.has_pending():
                    # Blocked on the user, not idle. Re-arm for a full window:
                    # the answer is the event that makes the CLI speak again.
                    self._idle_deadline = time.monotonic() + IDLE_SYNC_SECONDS
                    remaining = IDLE_SYNC_SECONDS
                else:
                    self._idle_deadline = 0.0
                    self._outstanding.clear()
                    self.hub.publish({"type": "wrapper", "subtype": "idle_sync"})
                    return
        self._arm_idle_sync(remaining)

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
            updated = dict(tool_input)
            # The one place an AskUserQuestion answer can travel. Absent for
            # every other tool, so the input goes back byte-identical.
            if isinstance(answer.get("answers"), dict):
                updated["answers"] = answer["answers"]
            body = {"behavior": "allow", "updatedInput": updated}
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
        self.publish_effort()

    # --- reasoning effort ---------------------------------------------------
    #
    # `initialize` advertises supportedEffortLevels PER MODEL, but there is no
    # set_effort control subtype on this build -- the only route is
    # apply_flag_settings, whose ack is an empty object and means nothing
    # (measured: a garbage level acks "success" and changes nothing).
    #
    # The honest read-back is get_settings().response.effective.effortLevel:
    #
    #   sources[0]  the user's real ~/.claude/settings.json  -- never written
    #   sources[1]  a session-scoped overlay apply_flag_settings creates
    #   applied     the last level REQUESTED, not the one in force
    #   effective   the merged truth
    #
    # This matters because the two lists disagree: models advertise five levels
    # including "max", while the settings schema is a four-value enum
    # (low/medium/high/xhigh) that silently drops anything else and falls back
    # to the user's own value. So "max" is offered by the CLI and refused by the
    # CLI. Never report success from the ack -- only from effective.

    def effort(self) -> str | None:
        response = self.control("get_settings", timeout=10.0)
        if response.get("subtype") != "success":
            return None
        effective = ((response.get("response") or {}).get("effective") or {})
        level = effective.get("effortLevel")
        return level if isinstance(level, str) else None

    def set_effort(self, level: str) -> str | None:
        """Apply a level and return what is ACTUALLY in force afterwards.

        The caller compares: a returned level that is not the requested one
        means the CLI refused it, quietly, with a cheerful success.
        """
        self.control("apply_flag_settings", timeout=10.0,
                     settings={"effortLevel": level})
        return self.effort()

    def publish_effort(self, level: str | None = None) -> None:
        try:
            current = level if level is not None else self.effort()
        except RuntimeError:
            return   # the process went away; nothing to report
        if current:
            self.hub.publish({"type": "wrapper", "subtype": "effort",
                              "effort": current})

    # --- output style -------------------------------------------------------
    #
    # Same route as effort -- apply_flag_settings, ack still an empty object --
    # with one difference measured 2026-08-08 on 2.1.223: `outputStyle` has no
    # schema behind it at all. "nonsense-style" is accepted, lands in
    # effective.outputStyle, AND is echoed back by a second `initialize`. So
    # unlike effortLevel there is no refusal to detect, and the read-back cannot
    # vet a name. The guard goes at the door instead: only a style the CLI
    # itself advertised in initialize.available_output_styles gets through
    # (see the /api/output-style handler).
    #
    # There is no set_output_style control subtype -- probed, "Unsupported
    # control request subtype" -- and the CLI's own /output-style command writes
    # the user's real settings.json, which this wrapper never does.

    def output_style(self) -> str | None:
        response = self.control("get_settings", timeout=10.0)
        if response.get("subtype") == "success":
            effective = ((response.get("response") or {}).get("effective") or {})
            name = effective.get("outputStyle")
            if isinstance(name, str):
                return name
        # Nothing applied on this process yet, so the settings overlay is empty
        # and the spawn-time value is the truth.
        name = (self.init_info or {}).get("output_style")
        return name if isinstance(name, str) else None

    def set_output_style(self, name: str) -> str | None:
        self.control("apply_flag_settings", timeout=10.0,
                     settings={"outputStyle": name})
        return self.output_style()

    def publish_output_style(self, name: str | None = None) -> None:
        """Fired after a change only: init_info already carries the spawn value.

        A window that reloads replays Hub history, where this lands *after* the
        init_info that named the old style -- so the chip repaints to the new
        one rather than to the stale spawn value.
        """
        try:
            current = name if name is not None else self.output_style()
        except RuntimeError:
            return   # the process went away; nothing to report
        if current:
            self.hub.publish({"type": "wrapper", "subtype": "output_style",
                              "style": current})

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


# --- tabs ----------------------------------------------------------------
#
# N concurrent conversations, keyed by a wrapper-minted uuid4. NOT by the CLI's
# session_id: that is None until the first turn completes (wiki/cli-stream-json
# -findings.md), so it cannot be the routing key for a tab the user just opened.

# ponytail: arbitrary ceiling, raise if RAM allows. Each tab is a real `claude`
# process.
MAX_TABS = 6

# ThreadingHTTPServer answers every request on its own thread, so the tab
# registry is shared mutable state: two windows (or a double-click) reaching
# /api/project/open at once both read len(sessions) < MAX_TABS and both spawn,
# and an unguarded `active = tab` lets the second spawn steal the first one
# mid-flight. Every mutation of `Handler.sessions` / `Handler.active` takes this
# -- same pattern as _STORE_LOCK above. Held only around the dict work: the
# spawn itself happens outside it, on a slot already reserved.
_SESSIONS_LOCK = threading.Lock()


def tab_running(sessions: dict[str, ClaudeSession], session_id: str) -> str | None:
    """The tab whose LIVE process owns `session_id`, or None.

    One rule, three callers: /api/session/resume ADOPTS that tab instead of
    starting a second CLI on the same transcript (two processes appending to
    one .jsonl is corruption), /api/session/delete refuses to unlink it, and
    /api/agents reads its spawned_at. A dead tab does not count -- its process
    is not writing anything any more.
    """
    if not session_id:
        return None
    for tab, session in list(sessions.items()):
        if session.session_id == session_id and session.alive():
            return tab
    return None


def respond_permission(sessions: dict[str, ClaudeSession], request_id: str,
                       decision: str, remember: bool, tool_name: str | None,
                       answers: dict | None) -> bool:
    """Hand an answer to whichever tab's broker is holding `request_id`.

    Scanned rather than routed: request ids are uuid4, so the window does not
    have to tell us which tab it answered for, and a stale dialog from a closed
    tab simply finds no holder and reports False.
    """
    for session in list(sessions.values()):
        broker = session.broker
        if broker is not None and broker.respond(request_id, decision, remember,
                                                 tool_name, answers):
            return True
    return False


def stop_all(sessions: dict[str, ClaudeSession]) -> None:
    """The window closed -> every tab dies. Unchanged product semantics from
    the single-session server, now plural."""
    for session in list(sessions.values()):
        session.stop()


class Handler(BaseHTTPRequestHandler):
    server_version = "PersianClaudeGUI/0.1"
    protocol_version = "HTTP/1.1"

    # Injected by serve().
    token: str = ""
    hub: Hub
    claude_bin: str = ""
    # Open conversations, insertion-ordered (that is the tab strip's order), and
    # which one an endpoint means when it is given no `tab`.
    sessions: dict[str, ClaudeSession] = {}
    active: str = ""

    # --- tabs ----------------------------------------------------------

    @classmethod
    def open_tab(cls, cwd: Path, resume_id: str | None = None) -> str | None:
        """Spawn one more conversation and make it active, or None at the cap.

        The boot tab comes through here too, so there is one spawn path rather
        than a second one in serve() that drifts -- and the MAX_TABS check
        lives HERE, with the assignment it guards. Checked by the caller it
        raced every other request thread: two callers both saw room and both
        spawned, and the seventh `claude` process was already running by the
        time anything noticed.
        """
        tab = uuid.uuid4().hex
        view = TabHub(cls.hub, tab)
        session = ClaudeSession(cwd=cwd, hub=view, claude_bin=cls.claude_bin,
                                broker=PermissionBroker(view))
        with _SESSIONS_LOCK:
            if len(cls.sessions) >= MAX_TABS:
                return None
            # The slot is reserved here; start() spawns outside the lock, so a
            # slow CLI launch cannot block the other tabs' endpoints.
            cls.sessions[tab] = session
            cls.active = tab
        session.start(resume_id=resume_id)
        return tab

    @classmethod
    def activate_tab(cls, tab: str) -> bool:
        """Make an existing tab active. False when there is no such tab."""
        with _SESSIONS_LOCK:
            if tab not in cls.sessions:
                return False
            cls.active = tab
            return True

    @classmethod
    def close_tab(cls, tab: str) -> None:
        """Stop that conversation and forget it, everywhere."""
        with _SESSIONS_LOCK:
            session = cls.sessions.pop(tab, None)
            if session is not None and cls.active == tab:
                # The most recently spawned survivor, which is the one nearest
                # to what the user was doing. Empty string when none is left.
                # Skipped when another thread already made its own new tab
                # active -- that one is nearer still.
                cls.active = max(cls.sessions,
                                 key=lambda t: cls.sessions[t].spawned_at or 0.0,
                                 default="")
        if session is None:
            return
        # Order is the fix here. Pending approvals are denied FIRST: their
        # waiters are released now instead of sitting out PERMISSION_TIMEOUT,
        # and the resolved event that dismisses the window's dialog is
        # published while the tab still exists -- after hub.drop() the
        # closed-tab guard would throw it away.
        if session.broker is not None:
            session.broker.deny_all()
        session.stop()
        # Published BEFORE the bucket is dropped: live windows get the event,
        # and nothing of a closed tab is ever replayed to a new one.
        session.hub.publish({"type": "wrapper", "subtype": "closed"})
        cls.hub.drop(tab)

    @classmethod
    def tabs_payload(cls) -> dict:
        return {
            "active": cls.active,
            "tabs": [{
                "tab": tab,
                "session_id": session.session_id,
                "cwd": str(session.cwd),
                "busy": session.busy,
                "spawned_at": session.spawned_at,
            } for tab, session in list(cls.sessions.items())],
        }

    def _target(self, tab: str | None) -> ClaudeSession | None:
        """The session an endpoint acts on: the named tab, else the active one.

        Answers 404 itself when there is no such tab, so a caller only has to
        `return` on None. Every session-scoped endpoint takes `tab` as an
        OPTIONAL body key or query param -- omitting it is what keeps the
        pre-tabs window and smoke_test.py working unchanged.
        """
        session = self.sessions.get(tab or self.active)
        if session is None:
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "no such tab"})
        return session

    def _cwd_for(self, cwd_raw: str, tab: str | None) -> Path | None:
        """The explicit `cwd` a history endpoint was given, else the tab's own.
        None means no such tab and the 404 has already been sent."""
        if cwd_raw:
            return Path(cwd_raw).expanduser()
        session = self._target(tab)
        return session.cwd if session is not None else None

    def _owner(self, session_id: str) -> ClaudeSession | None:
        """The live session running this CLI session id, in whichever tab —
        which is not necessarily the active one, and is None for a session
        that is only history."""
        tab = tab_running(self.sessions, session_id)
        return self.sessions.get(tab) if tab else None

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
        tab = params.get("tab", [""])[0]

        if parsed.path in ("/", "/index.html"):
            self._serve_file(STATIC_DIR / "index.html", set_cookie=set_cookie)
        elif parsed.path == "/api/events":
            self._serve_sse()
        elif parsed.path == "/api/tabs":
            self._send_json(HTTPStatus.OK, self.tabs_payload())
        elif parsed.path == "/api/sessions":
            session = self._target(tab)
            if session is None:
                return
            self._send_json(HTTPStatus.OK, {
                "cwd": str(session.cwd),
                "current": session.session_id,
                "recents": load_recents(),
                "sessions": list_sessions(session.cwd),
            })
        elif parsed.path == "/api/projects":
            # Sidebar payload: all known projects with their sessions inline,
            # one round-trip. The current project may be brand new (opened via
            # --cwd at boot, no transcripts, not in recents yet) — always
            # include it so the sidebar can highlight it.
            #
            # Deliberately TAB-LESS: only the current-project entry needs a live
            # session, so closing the last tab must not 404 here. It did, and
            # the window catches that silently — the sidebar simply froze on
            # the last payload it ever got, which is also the state the user is
            # in when they need it most (nothing open, pick something).
            session = self.sessions.get(tab or self.active)
            projects = list_projects()
            current = str(session.cwd) if session is not None else ""
            if current and not any(p["path"].lower() == current.lower() for p in projects):
                bare = {"path": current, "modified": 0.0, "sessions": []}
                # Decorated here too: a brand-new project skips list_projects()
                # entirely, and without this its rename would show up nowhere.
                name = _names_lower().get(current.lower())
                if name:
                    bare["name"] = name
                projects.insert(0, bare)
            self._send_json(HTTPStatus.OK, {
                "current_cwd": current,
                "current_session": session.session_id if session is not None else None,
                "projects": projects,
            })
        elif parsed.path == "/api/session":
            session_id = params.get("id", [""])[0]
            if not session_id:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "missing id"})
                return
            # Optional cwd: the sidebar replays sessions from any project, not
            # just the open one. A bogus path just yields an empty event list.
            cwd = self._cwd_for(params.get("cwd", [""])[0], tab)
            if cwd is None:
                return
            self._send_json(HTTPStatus.OK, {
                "session_id": session_id,
                "events": read_session(cwd, session_id),
            })
        elif parsed.path == "/api/agents":
            # Background-agents panel, one round-trip per poll. Same id/cwd
            # convention as /api/session -- any project's history, not just
            # the open one.
            session_id = params.get("id", [""])[0]
            if not session_id:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "missing id"})
                return
            cwd = self._cwd_for(params.get("cwd", [""])[0], tab)
            if cwd is None:
                return
            transcript = transcript_path(cwd, session_id)
            if transcript is None:
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "no such session"})
                return
            # "Live" means some tab is running this very session -- not that it
            # is the tab asking. An agent launched in tab 2 keeps reporting
            # running while the user reads tab 1.
            owner = self._owner(session_id)
            live = owner is not None
            spawned_at = owner.spawned_at if owner else None
            folder = subagents_dir(cwd, session_id)
            agents = []
            for entry in build_agent_registry(transcript).values():
                _enrich_agent_meta(folder, entry)
                agents.append({
                    "id": entry["id"], "kind": entry["kind"],
                    "description": entry.get("description"),
                    "agentType": entry.get("agentType"),
                    "model": entry.get("model"),
                    "status": _agent_status(entry, live, spawned_at),
                    "startedAt": entry.get("startedAt"),
                    "finishedAt": entry.get("finishedAt"),
                    "summary": entry.get("summary"),
                })
            agents.sort(key=lambda a: a["startedAt"] or 0)
            self._send_json(HTTPStatus.OK, {"agents": agents})
        elif parsed.path == "/api/agent":
            # One agent's own transcript, incrementally: `after` is the line
            # offset the client already has (see read_agent_events()).
            session_id = params.get("id", [""])[0]
            agent_id = params.get("agent", [""])[0]
            if not session_id or not agent_id:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "missing id"})
                return
            cwd = self._cwd_for(params.get("cwd", [""])[0], tab)
            if cwd is None:
                return
            transcript = transcript_path(cwd, session_id)
            if transcript is None:
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "no such session"})
                return
            agent_file = agent_file_path(cwd, session_id, agent_id, "jsonl")
            if agent_file is None:
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "no such agent"})
                return
            try:
                after = max(0, int(params.get("after", ["0"])[0]))
            except ValueError:
                after = 0
            events, next_line = read_agent_events(agent_file, after)
            entry = build_agent_registry(transcript).get(agent_id, {})
            _enrich_agent_meta(subagents_dir(cwd, session_id), entry)
            owner = self._owner(session_id)
            self._send_json(HTTPStatus.OK, {
                "events": events,
                "next": next_line,
                "running": _agent_status(entry, owner is not None,
                                         owner.spawned_at if owner else None) == "running",
                "meta": {
                    "description": entry.get("description"),
                    "agentType": entry.get("agentType"),
                    "model": entry.get("model"),
                },
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

        # Every session-scoped endpoint below reads this; absent means the
        # active tab, which is how the pre-tabs window keeps working.
        tab = body.get("tab") if isinstance(body.get("tab"), str) else None

        if parsed.path == "/api/message":
            session = self._target(tab)
            if session is None:
                return
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
                command_uuid = session.send_blocks(blocks)
            except RuntimeError as exc:
                self._send_json(HTTPStatus.CONFLICT, {"error": str(exc)})
                return
            # Echo locally so the window can render the user turn immediately:
            # the CLI does not replay user messages back to us. Through the
            # session's own TabHub, or the echo would land in no tab at all.
            # The uuid rides along because the window keeps the same ledger the
            # session does: this is the only place it learns which command the
            # CLI will later report finished (command_lifecycle).
            session.hub.publish({
                "type": "wrapper", "subtype": "user_echo",
                "uuid": command_uuid,
                "text": next((b["text"] for b in blocks if b["type"] == "text"), ""),
                "images": sum(1 for b in blocks if b["type"] == "image"),
            })
            self._send_json(HTTPStatus.OK, {"ok": True})
        elif parsed.path == "/api/tab/activate":
            # Class state under _SESSIONS_LOCK: `self.active = …` would shadow
            # it, and the check has to be atomic with the assignment or a tab
            # closing on another thread is activated after it stopped existing.
            wanted = (body.get("tab") or "").strip()
            if not self.activate_tab(wanted):
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "no such tab"})
                return
            self._send_json(HTTPStatus.OK, {"ok": True, "active": wanted})
        elif parsed.path == "/api/tab/close":
            wanted = (body.get("tab") or "").strip() or self.active
            if wanted not in self.sessions:
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "no such tab"})
                return
            self.close_tab(wanted)
            self._send_json(HTTPStatus.OK, {"ok": True, "active": Handler.active})
        elif parsed.path == "/api/interrupt":
            session = self._target(tab)
            if session is None:
                return
            try:
                session.interrupt()
            except RuntimeError as exc:
                self._send_json(HTTPStatus.CONFLICT, {"error": str(exc)})
                return
            self._send_json(HTTPStatus.OK, {"ok": True})
        elif parsed.path == "/api/queue/cancel":
            # One message out of the CLI's own command queue, by uuid. Not
            # reachable through /api/control: that whitelist is for requests
            # whose params are a fixed shape the page cannot abuse, and this one
            # needs the ledger bookkeeping in cancel_queued() around it.
            session = self._target(tab)
            if session is None:
                return
            message_uuid = (body.get("uuid") or "").strip()
            if not message_uuid:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "no uuid"})
                return
            try:
                cancelled = session.cancel_queued(message_uuid)
            except RuntimeError as exc:
                self._send_json(HTTPStatus.CONFLICT, {"error": str(exc)})
                return
            # The CLI's own answer, unedited: false is not an error, it is
            # "already running" (see ClaudeSession.cancel_queued).
            self._send_json(HTTPStatus.OK, {"cancelled": cancelled})
        elif parsed.path == "/api/recap":
            # Fire-and-forget: the recap arrives over SSE as wrapper/recap, the
            # same way every other CLI answer does. `ok:false` means the window
            # asked while a turn was still running -- not an error.
            session = self._target(tab)
            if session is None:
                return
            try:
                started = session.request_recap()
            except RuntimeError as exc:
                self._send_json(HTTPStatus.CONFLICT, {"error": str(exc)})
                return
            self._send_json(HTTPStatus.OK, {"ok": started})
        elif parsed.path == "/api/control":
            # One whitelisted chokepoint for every live CLI control (model,
            # permission mode, compact, rename, usage). Not a passthrough.
            session = self._target(tab)
            if session is None:
                return
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
                response = session.control(subtype, **control_params)
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
        elif parsed.path == "/api/effort":
            # One level string, never a settings blob: apply_flag_settings takes
            # arbitrary settings and must not be reachable from the page.
            # The reply carries what is ACTUALLY in force, which is not always
            # what was asked for -- see ClaudeSession.set_effort().
            session = self._target(tab)
            if session is None:
                return
            level = (body.get("level") or "").strip()
            if not level or not level.isalpha():
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "bad level"})
                return
            try:
                current = session.set_effort(level)
            except RuntimeError as exc:
                self._send_json(HTTPStatus.CONFLICT, {"error": str(exc)})
                return
            session.publish_effort(current)
            self._send_json(HTTPStatus.OK,
                            {"ok": current == level, "effort": current})
        elif parsed.path == "/api/output-style":
            # One style name, never a settings blob -- same reason as /api/effort.
            # Validated against what the CLI advertised, because nothing
            # downstream will: apply_flag_settings takes any string as
            # outputStyle and both read-backs echo a typo happily.
            session = self._target(tab)
            if session is None:
                return
            name = (body.get("style") or "").strip()
            offered = (session.init_info or {}).get("available_output_styles")
            if not isinstance(offered, list) or name not in offered:
                self._send_json(HTTPStatus.BAD_REQUEST,
                                {"error": f"unknown output style: {name}"})
                return
            try:
                current = session.set_output_style(name)
            except RuntimeError as exc:
                self._send_json(HTTPStatus.CONFLICT, {"error": str(exc)})
                return
            session.publish_output_style(current)
            self._send_json(HTTPStatus.OK,
                            {"ok": current == name, "style": current})
        elif parsed.path == "/api/posture":
            # The approval posture is two settings at once (the CLI's permission
            # mode and the wrapper's auto-approve flag), so it is one endpoint
            # rather than two client calls that can half-apply. Per tab: the
            # posture belongs to one conversation's broker, not to the server.
            session = self._target(tab)
            if session is None:
                return
            posture = (body.get("posture") or "").strip()
            if posture not in POSTURES:
                self._send_json(HTTPStatus.BAD_REQUEST,
                                {"error": f"unknown posture: {posture}"})
                return
            mode, auto = POSTURES[posture]
            try:
                response = session.control("set_permission_mode", mode=mode)
            except RuntimeError as exc:
                self._send_json(HTTPStatus.CONFLICT, {"error": str(exc)})
                return
            if response.get("subtype") == "error":
                # The CLI refused the mode: change nothing. The pill listens for
                # the posture event, so it stays on the posture that is real.
                self._send_json(HTTPStatus.OK,
                                {"ok": False, "error": response.get("error")})
                return
            if session.broker:
                session.broker.set_posture(posture, auto)
            self._send_json(HTTPStatus.OK, {"ok": True, "posture": posture,
                                            "mode": mode})
        elif parsed.path == "/api/attach/pick":
            self._send_json(HTTPStatus.OK, {"paths": pick_files(Path(sys.executable))})
        elif parsed.path == "/api/attach/paste":
            path = save_pasted_image(str(body.get("media_type") or ""),
                                     str(body.get("data") or ""))
            if path is None:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "not an image"})
                return
            self._send_json(HTTPStatus.OK, {"path": path})
        elif parsed.path == "/api/permission/respond":
            # No `tab` needed: the request id names exactly one broker across
            # every open tab (see respond_permission).
            ok = respond_permission(
                self.sessions,
                body.get("request_id") or "",
                body.get("decision") or "deny",
                bool(body.get("remember")),
                body.get("tool_name"),
                body.get("answers") if isinstance(body.get("answers"), dict) else None,
            )
            self._send_json(HTTPStatus.OK if ok else HTTPStatus.NOT_FOUND,
                            {"ok": ok})
        elif parsed.path == "/api/project/pick":
            chosen = pick_folder(Path(sys.executable))
            self._send_json(HTTPStatus.OK, {"path": chosen})
        elif parsed.path == "/api/project/open":
            # SPAWNS a tab. Every other open conversation keeps running -- this
            # endpoint used to kill the one session the server had, which is
            # the whole reason tabs exist.
            raw = (body.get("path") or "").strip()
            target = Path(raw).expanduser() if raw else None
            if not target or not target.is_dir():
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "not a folder"})
                return
            target = target.resolve()
            # The cap is enforced inside open_tab, atomically with the slot it
            # hands out -- checking it here would race every other spawn.
            new_tab = self.open_tab(target)
            if new_tab is None:
                self._send_json(HTTPStatus.CONFLICT,
                                {"error": "too many tabs", "max_tabs": MAX_TABS})
                return
            self._send_json(HTTPStatus.OK, {
                "cwd": str(target), "tab": new_tab,
                "recents": remember_recent(target),
            })
        elif parsed.path == "/api/project/archive":
            # Hide from the sidebar but keep every transcript — reversible.
            raw = (body.get("path") or "").strip()
            if not raw:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "missing path"})
                return
            flag = bool(body.get("archived"))
            toggle_in_list(ARCHIVED_FILE, raw, flag)
            self._send_json(HTTPStatus.OK, {"ok": True, "archived": flag})
        elif parsed.path == "/api/project/pin":
            # Sticks a project to the top of the sidebar. Same shape as archive
            # — a path list on disk — so the sort in list_projects() is the only
            # thing that has to know the difference.
            raw = (body.get("path") or "").strip()
            if not raw:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "missing path"})
                return
            flag = bool(body.get("pinned"))
            toggle_in_list(PINNED_FILE, raw, flag)
            self._send_json(HTTPStatus.OK, {"ok": True, "pinned": flag})
        elif parsed.path == "/api/project/rename":
            # Display name only — nothing on disk is renamed, and the CLI is
            # never told. An empty name deletes the override; the response is
            # always the name in force, so the window never has to guess.
            raw = (body.get("path") or "").strip()
            if not raw:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "missing path"})
                return
            self._send_json(HTTPStatus.OK, {
                "ok": True, "name": set_project_name(raw, str(body.get("name") or "")),
            })
        elif parsed.path == "/api/project/reveal":
            # Opens the project folder in Explorer. `startfile` on a directory is
            # what the shell does for a double-click, so the user's own file
            # associations decide — we are not naming explorer.exe.
            # The existence check is the trust boundary: this hands a string to
            # the Windows shell, so it opens FOLDERS THAT EXIST and nothing else
            # — never a file, which would run whatever is associated with it.
            raw = (body.get("path") or "").strip()
            target = Path(raw).expanduser() if raw else None
            if target is None or not target.is_dir():
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "not a folder"})
                return
            try:
                os.startfile(str(target.resolve()))   # noqa: S606 — Windows-only by design
            except OSError as exc:
                self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})
                return
            self._send_json(HTTPStatus.OK, {"ok": True})
        elif parsed.path == "/api/project/remove":
            # Deletes the project's TRANSCRIPTS and list entries. Never touches
            # the project folder itself — those are the user's files.
            raw = (body.get("path") or "").strip()
            if not raw:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "missing path"})
                return
            target = Path(raw).expanduser()
            norm = str(target.resolve()).lower()
            # ANY tab, not just the active one -- deleting the transcripts of a
            # project a background conversation is still writing to is the same
            # broken state, one tab over.
            if any(str(s.cwd).lower() == norm for s in list(self.sessions.values())):
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
            # Already open in a tab? ADOPT it -- just make that tab active.
            # Resuming it a second time would leave two CLI processes appending
            # to one .jsonl, which corrupts the transcript.
            adopted = tab_running(self.sessions, session_id)
            if adopted is not None and self.activate_tab(adopted):
                self._send_json(HTTPStatus.OK, {"ok": True, "tab": adopted,
                                                "adopted": True,
                                                "session_id": session_id})
                return
            # Optional path: a session that belongs to another project resumes
            # in its own folder. Without one, the tab that asked supplies it.
            raw = (body.get("path") or "").strip()
            if raw:
                target = Path(raw).expanduser()
                if not target.is_dir():
                    self._send_json(HTTPStatus.BAD_REQUEST, {"error": "not a folder"})
                    return
                cwd = target.resolve()
            else:
                current = self._target(tab)
                if current is None:
                    return
                cwd = current.cwd
            new_tab = self.open_tab(cwd, resume_id=session_id)
            if new_tab is None:
                self._send_json(HTTPStatus.CONFLICT,
                                {"error": "too many tabs", "max_tabs": MAX_TABS})
                return
            if raw:
                remember_recent(cwd)
            self._send_json(HTTPStatus.OK, {"ok": True, "tab": new_tab,
                                            "adopted": False,
                                            "session_id": session_id})
        elif parsed.path == "/api/session/delete":
            session_id = (body.get("session_id") or "").strip()
            if not session_id:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "missing session_id"})
                return
            # The live process keeps writing its own transcript; deleting it
            # underneath the CLI is a broken state, not a feature. Checked
            # across every tab -- the session need not be the active one.
            if tab_running(self.sessions, session_id) is not None:
                self._send_json(HTTPStatus.CONFLICT, {"error": "session is active"})
                return
            # Optional path: the sidebar deletes sessions in any project. The
            # traversal guard on the id lives in transcript_path either way.
            raw = (body.get("path") or "").strip()
            cwd = self._cwd_for(raw, tab)
            if cwd is None:
                return
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
            session = self._target(tab)
            if session is None:
                return
            self._send_json(HTTPStatus.OK, {
                "session_id": session.session_id,
                "cwd": str(session.cwd),
                "running": session.alive(),
                "tab": tab or self.active,
                "active": self.active,
                # Commands, models and account from the CLI's own `initialize`.
                # None until it answers (milliseconds after spawn); the UI must
                # tolerate that and also listen for wrapper/init_info over SSE.
                "init_info": session.init_info,
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
        if path.suffix.lower() == ".html":
            body = body.replace(b"{{VERSION}}", APP_VERSION.encode("utf-8"))
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

        # An EventSource auto-reconnect sends the last `id:` it saw back as
        # Last-Event-ID; honouring it is what stops a reconnect from replaying
        # a transcript the window already rendered (and from double-counting
        # user_echo/result, which stuck the busy pulse for good).
        try:
            after = int(self.headers.get("Last-Event-ID", "") or 0)
        except ValueError:
            after = 0
        q = self.hub.subscribe(after)
        try:
            while True:
                try:
                    event = q.get(timeout=SSE_HEARTBEAT_SECONDS)
                except queue.Empty:
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
                    continue
                data = json.dumps(event, ensure_ascii=False)
                seq = event.get("seq")
                head = f"id: {seq}\n" if seq is not None else ""
                self.wfile.write(f"{head}data: {data}\n\n".encode("utf-8"))
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


def idle_watchdog(hub: Hub, sessions: dict[str, ClaudeSession],
                  httpd: ThreadingHTTPServer, grace: float) -> None:
    """Server lifetime is tied to the window: last client gone -> shut down.

    Every tab dies with it. `sessions` is the live registry, not a copy, so a
    tab opened after this thread started is stopped too.
    """
    # Give the window time to make its first connection before arming.
    time.sleep(grace)
    while True:
        if hub.idle_seconds() > IDLE_SHUTDOWN_SECONDS:
            stop_all(sessions)
            threading.Thread(target=httpd.shutdown, daemon=True).start()
            return
        time.sleep(1.0)


def serve(cwd: Path, open_window: bool, verbose: bool) -> None:
    token = secrets.token_urlsafe(32)
    port = free_port()
    endpoint = f"http://127.0.0.1:{port}"
    hub = Hub()

    Handler.token = token
    Handler.hub = hub
    Handler.claude_bin = find_claude()
    Handler.sessions = {}
    Handler.active = ""
    # No boot tab: the window opens on the home state and nothing spawns until
    # the user picks a project or session (user decision 2026-08-23 — launching
    # the app must not open a conversation). --cwd still seeds the recents list
    # below, so the shortcut's project is one click away.

    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    httpd.daemon_threads = True
    httpd.verbose = verbose  # type: ignore[attr-defined]

    url = f"{endpoint}/?t={token}"
    if verbose:
        print(f"[server] cwd     : {cwd}")
        print(f"[server] listening: {url}", flush=True)

    remember_recent(cwd)
    threading.Thread(target=idle_watchdog,
                     args=(hub, Handler.sessions, httpd, 30.0),
                     daemon=True).start()
    if open_window:
        launch_window(url)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop_all(Handler.sessions)


def main() -> None:
    parser = argparse.ArgumentParser(description="Persian RTL front-end for Claude Code")
    parser.add_argument("--cwd", default=os.getcwd(),
                        help="project directory the CLI runs in")
    parser.add_argument("--no-window", action="store_true",
                        help="do not launch Edge (dev mode)")
    parser.add_argument("--quiet", action="store_true", help="suppress console logging")
    args = parser.parse_args()

    # The desktop shortcut runs pythonw.exe, a GUI-subsystem binary with no
    # console: sys.stderr is None there. print() is a silent no-op in that
    # case, but log_message's sys.stderr.write is not — it raises inside
    # send_response, before a single byte reaches the socket, so the window
    # gets ERR_EMPTY_RESPONSE instead of the UI. No console -> no logging.
    serve(cwd=Path(args.cwd).resolve(),
          open_window=not args.no_window,
          verbose=not args.quiet and sys.stderr is not None)


if __name__ == "__main__":
    main()
