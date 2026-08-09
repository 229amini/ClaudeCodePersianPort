"""The pure server-side helpers behind the statusline and clipboard paste.

No server, no CLI, no cost. Run: C:\\Python314\\python.exe test_units.py

Both of these guard failure modes that produce no error message at all —
`run_statusline` swallowed a non-zero exit for months, and `save_pasted_image`
takes bytes straight off a POST body.
"""
import base64
import json
import os
import subprocess
import sys
import tempfile
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

print("session_meta: opening a session must not reorder the sidebar")
# The exact line shapes the CLI writes at SPAWN, before a word is exchanged --
# plus the isMeta `user` line a SessionStart hook produces. If any of these
# counted, clicking a session would bump it to the top of the list.
OPEN_ONLY = [
    '{"type":"mode","mode":"default","timestamp":"2026-08-08T12:00:00.000Z"}',
    '{"type":"attachment","attachment":{},"timestamp":"2026-08-08T12:00:00.000Z"}',
    '{"type":"file-history-snapshot","timestamp":"2026-08-08T12:00:00.000Z"}',
    '{"type":"user","isMeta":true,"message":{"content":"hook output"},'
    '"timestamp":"2026-08-08T12:00:00.000Z"}',
]
SPOKEN = ('{"type":"user","message":{"content":[{"type":"text","text":"سلام"}]},'
          '"timestamp":"2026-08-01T09:00:00.000Z"}')

with tempfile.TemporaryDirectory() as tmp:
    transcript = Path(tmp) / "s.jsonl"
    transcript.write_text("\n".join([SPOKEN, *OPEN_ONLY]) + "\n", encoding="utf-8")
    first, _, spoken = server.session_meta(transcript)
    check("the first prompt still reads", first == "سلام")
    check("spawn-only lines do not count as activity",
          spoken == server.iso_epoch("2026-08-01T09:00:00.000Z"))
    # And the value it replaces really would have moved: mtime is now-ish.
    check("mtime would have said otherwise",
          transcript.stat().st_mtime - spoken > 3600)

    empty = Path(tmp) / "e.jsonl"
    empty.write_text("\n".join(OPEN_ONLY) + "\n", encoding="utf-8")
    check("a transcript with nothing said falls back to mtime",
          server.session_meta(empty)[2] is None)

check("Z-suffixed ISO parses", server.iso_epoch("2026-08-01T09:00:00.000Z") > 0)
check("garbage timestamp is dropped", server.iso_epoch("not-a-time") is None)

# --- background agents -------------------------------------------------------
# wiki/background-agents.md: registry state comes ONLY from the main
# transcript on disk. These lines are the synthetic shape of the three
# markers that contract describes, not a copy of a real transcript.


def _line(obj) -> str:
    # Compact, no spaces -- the real CLI writes jsonl this tight, and
    # build_agent_registry's cheap pre-filters (e.g. '"name":"Agent"') assume it.
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def _launch(tool_use_id, description, subagent_type="general-purpose", ts="2026-08-09T10:00:00.000Z"):
    return _line({
        "type": "assistant", "timestamp": ts,
        "message": {"role": "assistant", "content": [{
            "type": "tool_use", "id": tool_use_id, "name": "Agent",
            "input": {"description": description, "subagent_type": subagent_type},
        }]},
    })


def _ack_with_result(tool_use_id, agent_id, description, ts="2026-08-09T10:00:05.000Z"):
    # The toolUseResult sibling field -- present when the CLI's own record
    # carries it (wiki: authoritative source #1).
    return _line({
        "type": "user", "timestamp": ts,
        "toolUseResult": {"isAsync": True, "status": "async_launched",
                          "agentId": agent_id, "description": description,
                          "resolvedModel": "claude-fable-5"},
        "message": {"role": "user", "content": [{
            "tool_use_id": tool_use_id, "type": "tool_result",
            "content": [{"type": "text", "text": "Async agent launched successfully."}],
        }]},
    })


def _ack_text_only(tool_use_id, agent_id, ts="2026-08-09T10:01:05.000Z"):
    # No toolUseResult at all -- what actually streams live (wiki:
    # authoritative source #2, the fallback).
    text = ("Async agent launched successfully. (internal metadata)\n"
            f"agentId: {agent_id} (internal ID - do not mention to user.)")
    return _line({
        "type": "user", "timestamp": ts,
        "message": {"role": "user", "content": [{
            "tool_use_id": tool_use_id, "type": "tool_result",
            "content": [{"type": "text", "text": text}],
        }]},
    })


def _notification(task_id, tool_use_id, summary, ts, as_queue_op, with_result=True):
    content = (f"<task-notification>\n<task-id>{task_id}</task-id>\n"
              f"<tool-use-id>{tool_use_id}</tool-use-id>\n<status>completed</status>\n"
              f"<summary>{summary}</summary>\n")
    if with_result:
        content += "<result>the deliverable, with an escaped &amp; in it</result>\n"
    content += "</task-notification>"
    if as_queue_op:
        return _line({"type": "queue-operation", "operation": "enqueue",
                     "timestamp": ts, "content": content})
    return _line({"type": "user", "timestamp": ts, "message": {"role": "user", "content": content}})


print("build_agent_registry: the three markers, from synthetic transcript lines")
AGENT_A = "aaaaaaaaaaaaaaaa"     # toolUseResult-carrying ack
AGENT_B = "bbbbbbbbbbbbbbbb"     # text-only ack (no toolUseResult)
CMD_ID = "cmd0123456"           # a background COMMAND's short task-id

lines = [
    _launch("toolu_A", "Do the async thing"),
    _ack_with_result("toolu_A", AGENT_A, "Do the async thing"),
    _launch("toolu_B", "Do the other thing"),
    _ack_text_only("toolu_B", AGENT_B),
    _notification(AGENT_A, "toolu_A", 'Agent "Do the async thing" finished',
                 "2026-08-09T10:05:00.000Z", as_queue_op=True),
    _notification(CMD_ID, "toolu_C", 'Background command "echo hi" completed (exit code 0)',
                 "2026-08-09T10:06:00.000Z", as_queue_op=True, with_result=False),
]

with tempfile.TemporaryDirectory() as tmp:
    transcript = Path(tmp) / "reg.jsonl"
    transcript.write_text("\n".join(lines) + "\n", encoding="utf-8")

    registry = server.build_agent_registry(transcript)
    check("both agent launches are registered", set(registry) >= {AGENT_A, AGENT_B, CMD_ID})
    check("toolUseResult-carrying ack resolves kind+model",
          registry[AGENT_A]["kind"] == "agent" and registry[AGENT_A]["model"] == "claude-fable-5")
    check("toolUseResult-carrying ack's startedAt is the ack's own timestamp",
          registry[AGENT_A]["startedAt"] == server.iso_epoch("2026-08-09T10:00:05.000Z"))
    check("text-only ack still resolves the agentId",
          registry[AGENT_B]["kind"] == "agent" and registry[AGENT_B]["description"] == "Do the other thing")
    check("notification marks the agent completed with its summary",
          registry[AGENT_A]["completed"] is True
          and registry[AGENT_A]["summary"] == 'Agent "Do the async thing" finished')
    check("an unmatched task-id becomes a kind:command entry",
          registry[CMD_ID]["kind"] == "command" and registry[CMD_ID]["completed"] is True)
    check("a still-running agent (no notification yet) is not completed",
          registry[AGENT_B]["completed"] is False)

    # Duplicate notification for the SAME task-id -- last one wins, no new entry.
    before = len(registry)
    dup = _notification(AGENT_A, "toolu_A", 'Agent "Do the async thing" finished AGAIN',
                        "2026-08-09T10:07:00.000Z", as_queue_op=False)
    transcript.write_text(transcript.read_text(encoding="utf-8") + dup + "\n", encoding="utf-8")
    registry2 = server.build_agent_registry(transcript)
    check("a duplicate notification does not add an entry", len(registry2) == before)
    check("a duplicate notification overwrites (last one wins)",
          registry2[AGENT_A]["summary"] == 'Agent "Do the async thing" finished AGAIN')

print("build_agent_registry: incremental parsing only reads appended bytes")
offsets = []
orig_tail = server._tail_lines


def _spy(path, offset):
    offsets.append(offset)
    return orig_tail(path, offset)


server._tail_lines = _spy
try:
    with tempfile.TemporaryDirectory() as tmp:
        transcript = Path(tmp) / "inc.jsonl"
        transcript.write_text(_launch("toolu_X", "first") + "\n"
                              + _ack_with_result("toolu_X", "c" * 16, "first") + "\n",
                              encoding="utf-8")
        server.build_agent_registry(transcript)
        check("first parse starts at offset 0", offsets[-1] == 0)
        size_after_first = transcript.stat().st_size

        with transcript.open("a", encoding="utf-8") as handle:
            handle.write(_launch("toolu_Y", "second") + "\n"
                         + _ack_with_result("toolu_Y", "d" * 16, "second") + "\n")
        registry3 = server.build_agent_registry(transcript)
        check("second parse resumes from where the first left off, not 0",
              offsets[-1] == size_after_first)
        check("both agents are visible after the incremental parse",
              {"c" * 16, "d" * 16} <= set(registry3))

        # Shrunk file (rotated/truncated) -- must fall back to a full rescan.
        transcript.write_text(_launch("toolu_Z", "third") + "\n"
                              + _ack_with_result("toolu_Z", "e" * 16, "third") + "\n",
                              encoding="utf-8")
        registry4 = server.build_agent_registry(transcript)
        check("a shrunk file rescans from 0", offsets[-1] == 0)
        check("a shrunk file's registry does not carry over stale agents",
              set(registry4) == {"e" * 16})
finally:
    server._tail_lines = orig_tail

print("agent_file_path: traversal guard")
with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    cwd = root / "proj"
    cwd.mkdir()
    old_projects_dir = server.PROJECTS_DIR
    server.PROJECTS_DIR = root / "projects"
    folder = server.PROJECTS_DIR / str(cwd).replace(":", "-").replace("\\", "-").replace("/", "-")
    folder.mkdir(parents=True)
    (folder / "sess.jsonl").write_text("{}\n", encoding="utf-8")
    subagents = folder / "sess" / "subagents"
    subagents.mkdir(parents=True)
    good_id = "abcdef0123456789"
    (subagents / f"agent-{good_id}.jsonl").write_text("{}\n", encoding="utf-8")
    outside = root / "projects" / "secret.jsonl"
    outside.write_text("{}\n", encoding="utf-8")

    try:
        check("a real agent id resolves inside the subagents folder",
              server.agent_file_path(cwd, "sess", good_id, "jsonl")
              == (subagents / f"agent-{good_id}.jsonl").resolve())
        for escape in ("../../secret", "..\\..\\secret", good_id + "/../../../secret"):
            check(f"traversal-shaped id is rejected: {escape}",
                  server.agent_file_path(cwd, "sess", escape, "jsonl") is None)
        for bad in ("ABCDEF0123456789", "abc", "not-hex-at-all!", ""):
            check(f"bad-charset/length id is rejected: {bad!r}",
                  server.agent_file_path(cwd, "sess", bad, "jsonl") is None)
        check("outside file was never touched", outside.is_file())
        check("an id with no matching file is rejected",
              server.agent_file_path(cwd, "sess", "f" * 16, "jsonl") is None)
    finally:
        server.PROJECTS_DIR = old_projects_dir

print("read_session: a bare-string <task-notification> survives replay")
with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    cwd = root / "proj2"
    cwd.mkdir()
    old_projects_dir = server.PROJECTS_DIR
    server.PROJECTS_DIR = root / "projects"
    folder = server.PROJECTS_DIR / str(cwd).replace(":", "-").replace("\\", "-").replace("/", "-")
    folder.mkdir(parents=True)
    notif = _notification("aaaa1111", "toolu_Q", "Agent finished",
                          "2026-08-09T10:08:00.000Z", as_queue_op=False)
    queue_op = _notification("aaaa1111", "toolu_Q", "Agent finished",
                             "2026-08-09T10:07:59.000Z", as_queue_op=True)
    # A skill load (pcg-e5q): the CLI injects the whole SKILL.md as ordinary
    # BLOCK-shaped content under isMeta:true -- shape modelled on the real
    # line in a04d070b-7743-41f0-9b4c-9c34756e0a78.jsonl. The CLI's own UI
    # never shows this; replaying it was one giant user bubble.
    skill_meta = _line({
        "type": "user", "isMeta": True, "timestamp": "2026-08-09T10:07:00.000Z",
        "message": {"role": "user", "content": [
            {"type": "text", "text": "Base directory for this skill: C:\\fake\\path\n\n"
                                     "# Some Skill\n\nlong SKILL.md body here..."},
        ]},
    })
    (folder / "s2.jsonl").write_text(
        queue_op + "\n" + skill_meta + "\n" + notif + "\n", encoding="utf-8")

    try:
        events = server.read_session(cwd, "s2")
        check("isMeta + queue-operation both stay filtered -- one event replays",
              len(events) == 1)
        check("it is a text block carrying the raw <task-notification> string",
              events[0]["message"]["content"][0]["type"] == "text"
              and events[0]["message"]["content"][0]["text"].startswith("<task-notification>"))
        check("the isMeta skill body never made it into replay",
              "SKILL.md" not in str(events))
        # Proof this needed a special case: today's envelope filter alone
        # WOULD have dropped it -- "task-notification" matches CLI_ENVELOPE_RE
        # the same as the noise it exists to drop.
        check("user_prompt_text alone (no special-case) would have dropped it",
              server.user_prompt_text(json.loads(notif)["message"]["content"]) is None)
    finally:
        server.PROJECTS_DIR = old_projects_dir

print("read_agent_events: after/next offset behaviour")
with tempfile.TemporaryDirectory() as tmp:
    agent_file = Path(tmp) / "agent-f00d.jsonl"
    agent_lines = [
        _line({"type": "user", "isSidechain": True,
              "message": {"role": "user", "content": "the agent's own prompt"}}),
        _line({"type": "attachment", "isSidechain": True, "attachment": {}}),
        _line({"type": "assistant", "isSidechain": True,
              "message": {"role": "assistant", "content": [{"type": "text", "text": "working..."}]}}),
    ]
    agent_file.write_text("\n".join(agent_lines) + "\n", encoding="utf-8")

    events, next1 = server.read_agent_events(agent_file, 0)
    check("isSidechain does not drop lines from an agent's own file",
          len(events) == 2 and events[0]["type"] == "user" and events[1]["type"] == "assistant")
    check("next counts raw lines, including the dropped attachment line", next1 == 3)

    events2, next2 = server.read_agent_events(agent_file, next1)
    check("polling again with after=next yields nothing new", events2 == [] and next2 == 3)

    with agent_file.open("a", encoding="utf-8") as handle:
        handle.write(_line({"type": "assistant", "isSidechain": True,
                            "message": {"role": "assistant",
                                       "content": [{"type": "text", "text": "done"}]}}) + "\n")
    events3, next3 = server.read_agent_events(agent_file, next1)
    check("after=<previous next> returns only the newly appended event",
          len(events3) == 1 and events3[0]["message"]["content"][0]["text"] == "done")
    check("next advances by exactly the appended line", next3 == 4)

print("read_agent_events: a half-written trailing line is not counted into next")
# Same straggler class _tail_lines() was written to avoid: the CLI is still
# mid-write on the transcript's last line when the poll lands.
with tempfile.TemporaryDirectory() as tmp:
    agent_file = Path(tmp) / "agent-half.jsonl"
    first = _line({"type": "assistant", "isSidechain": True,
                  "message": {"role": "assistant",
                             "content": [{"type": "text", "text": "first"}]}})
    second_full = _line({"type": "assistant", "isSidechain": True,
                        "message": {"role": "assistant",
                                   "content": [{"type": "text", "text": "second"}]}})
    truncated = second_full[:-8]   # cut mid-record, no trailing newline yet
    agent_file.write_text(first + "\n" + truncated, encoding="utf-8")

    events, next1 = server.read_agent_events(agent_file, 0)
    check("only the complete line is returned",
          len(events) == 1 and events[0]["message"]["content"][0]["text"] == "first")
    check("the truncated trailing line is NOT counted into next", next1 == 1)

    # The CLI finishes writing the record.
    with agent_file.open("a", encoding="utf-8") as handle:
        handle.write(second_full[len(truncated):] + "\n")
    events2, next2 = server.read_agent_events(agent_file, next1)
    check("re-reading from the same `next` now returns the completed line",
          len(events2) == 1 and events2[0]["message"]["content"][0]["text"] == "second")
    check("next advances past it once complete", next2 == 2)

print("read_agent_events: isMeta lines are dropped before normalisation, same as read_session")
with tempfile.TemporaryDirectory() as tmp:
    agent_file = Path(tmp) / "agent-meta.jsonl"
    # Shape modelled on the real skill-load line (pcg-e5q) -- block content
    # under isMeta:true, which _normalize_transcript_event() cannot filter
    # because it discards the isMeta flag on its way out.
    skill_meta = _line({
        "type": "user", "isSidechain": True, "isMeta": True,
        "message": {"role": "user", "content": [
            {"type": "text", "text": "Base directory for this skill: C:\\fake\\path\n\n"
                                     "# Some Skill\n\nlong SKILL.md body here..."},
        ]},
    })
    normal = _line({"type": "assistant", "isSidechain": True,
                    "message": {"role": "assistant",
                               "content": [{"type": "text", "text": "working..."}]}})
    agent_file.write_text(skill_meta + "\n" + normal + "\n", encoding="utf-8")

    events, next1 = server.read_agent_events(agent_file, 0)
    check("the isMeta skill-load line never reaches the agent drawer",
          len(events) == 1 and events[0]["type"] == "assistant")
    check("next still counts the isMeta line -- it's complete, just filtered", next1 == 2)

print("_agent_status: an agent orphaned by a killed-then-resumed process reports stopped")
# --resume keeps session_id stable across a kill (B-9.8), so `live` alone
# can't distinguish this process's agents from a prior, now-dead process's.
OLD_ACK = server.iso_epoch("2026-08-09T10:00:00.000Z")
NEW_SPAWN = server.iso_epoch("2026-08-09T10:05:00.000Z")
NEW_ACK = server.iso_epoch("2026-08-09T10:06:00.000Z")
orphan = {"completed": False, "startedAt": OLD_ACK}
fresh = {"completed": False, "startedAt": NEW_ACK}
check("an ack from BEFORE the current process's spawn is stopped, not running",
      server._agent_status(orphan, True, NEW_SPAWN) == "stopped")
check("an ack from AFTER the current process's spawn is still running",
      server._agent_status(fresh, True, NEW_SPAWN) == "running")
check("completed wins regardless of age", server._agent_status(
    {"completed": True, "startedAt": OLD_ACK}, True, NEW_SPAWN) == "completed")
check("not live is stopped regardless of age",
      server._agent_status(fresh, False, NEW_SPAWN) == "stopped")
check("no spawned_at falls back to the live-only check",
      server._agent_status(orphan, True, None) == "running")

# --- pinned / archived path lists -------------------------------------------
# Both toggles and the "forget this project" sweep are the same few lines of
# case-insensitive matching — exactly the kind of thing that works on the path
# you typed and fails on the one Windows handed you.
with tempfile.TemporaryDirectory() as tmp:
    store = Path(tmp) / "pinned.json"
    server.toggle_in_list(store, r"C:\Users\Lion\Proj", True)
    check("pin writes the path", server._load_paths(store) == [r"C:\Users\Lion\Proj"])
    server.toggle_in_list(store, r"c:\users\lion\proj", True)
    check("pinning the same path in another case does not duplicate it",
          server._load_paths(store) == [r"c:\users\lion\proj"])
    server.toggle_in_list(store, r"C:\USERS\LION\PROJ", False)
    check("unpin matches case-insensitively", server._load_paths(store) == [])

    # drop_project_from_lists sweeps all three files; it used to name only two,
    # so a removed project would come back pinned the next time it was opened.
    olds = (server.RECENTS_FILE, server.ARCHIVED_FILE, server.PINNED_FILE)
    try:
        server.RECENTS_FILE = Path(tmp) / "r.json"
        server.ARCHIVED_FILE = Path(tmp) / "a.json"
        server.PINNED_FILE = Path(tmp) / "p.json"
        for f in (server.RECENTS_FILE, server.ARCHIVED_FILE, server.PINNED_FILE):
            server.toggle_in_list(f, r"D:\Work\App", True)
        server.drop_project_from_lists(r"d:\work\app")
        check("removing a project forgets it in recents, archived AND pinned",
              not any(server._load_paths(f) for f in
                      (server.RECENTS_FILE, server.ARCHIVED_FILE, server.PINNED_FILE)))
    finally:
        server.RECENTS_FILE, server.ARCHIVED_FILE, server.PINNED_FILE = olds

print(("FAIL — " + ", ".join(fails)) if fails else "PASS — all unit checks")
sys.exit(1 if fails else 0)
