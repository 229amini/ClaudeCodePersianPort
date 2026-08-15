"""The pure server-side helpers behind the statusline and clipboard paste.

No server, no CLI, no cost. Run: C:\\Python314\\python.exe test_units.py

Both of these guard failure modes that produce no error message at all —
`run_statusline` swallowed a non-zero exit for months, and `save_pasted_image`
takes bytes straight off a POST body.
"""
import base64
import http.client
import json
import os
import queue
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

print("build_agent_registry: the route is the parsed shape, not substring order")
# The three cheap markers ('"name":"Agent"', '"tool_result"',
# "task-notification") may FILTER a line but must never DECIDE its route: a
# notification carries the finished agent's own final text and can quote any
# of them. Measured across this machine's 315 real transcripts, a genuine
# notification is `queue-operation`+string (708) or `user`+string (273) and
# never a `user`+list -- so `type` plus the SHAPE of message.content is the
# CLI's actual contract, and a substring cascade only agrees with it by luck.


def _with_raw_marker(line, decoy):
    r"""Append a sibling field carrying `decoy` VERBATIM.

    Hand-built on purpose. The CLI escapes every quote inside the
    notification's own text, so a body quoting `"tool_result"` reaches the
    line as `\"tool_result\"` and no substring test can see it -- a marker
    OUTSIDE the JSON string is the only shape in which a substring cascade
    and the parsed record can disagree, and disagreeing is exactly what
    dropped the notification (leaving the agent "running" forever).
    """
    return line[:-1] + f',"noise":{decoy}}}'


AGENT_C = "cccccccccccccccc"   # its notification line also reads "tool_result"
AGENT_D = "dddddddddddddddd"   # its notification line also reads "name":"Agent"

with tempfile.TemporaryDirectory() as tmp:
    transcript = Path(tmp) / "noisy.jsonl"
    transcript.write_text("\n".join([
        _launch("toolu_C", "Quote a tool result"),
        _ack_with_result("toolu_C", AGENT_C, "Quote a tool result"),
        _with_raw_marker(
            _notification(AGENT_C, "toolu_C", 'Agent "Quote a tool result" finished',
                          "2026-08-09T11:00:00.000Z", as_queue_op=False),
            '{"type":"tool_result"}'),
        _launch("toolu_D", "Quote a launch"),
        _ack_text_only("toolu_D", AGENT_D),
        _with_raw_marker(
            _notification(AGENT_D, "toolu_D", 'Agent "Quote a launch" finished',
                          "2026-08-09T11:01:00.000Z", as_queue_op=False),
            '{"name":"Agent"}'),
    ]) + "\n", encoding="utf-8")

    noisy = server.build_agent_registry(transcript)
    check('a notification whose line also reads "tool_result" still completes its agent',
          noisy.get(AGENT_C, {}).get("completed") is True)
    check('a notification whose line also reads "name":"Agent" still completes its agent',
          noisy.get(AGENT_D, {}).get("completed") is True)
    check("launch -> ack -> notification still yields a completed entry with its description",
          noisy.get(AGENT_D, {}).get("description") == "Quote a launch"
          and noisy[AGENT_D]["summary"] == 'Agent "Quote a launch" finished')

print("build_agent_registry: a tool_result that merely MENTIONS a launch mints nothing")
# Measured: 3 such entries across this machine's real transcripts, every one
# of them stuck at completed=False, i.e. reporting "running" for the life of
# the process. Reading a wiki page or another session's transcript is enough --
# the quoted text carries the CLI's own launch line, agentId and all. Only the
# join to a pending `Agent` tool_use says this ack is real.
with tempfile.TemporaryDirectory() as tmp:
    transcript = Path(tmp) / "mention.jsonl"
    transcript.write_text(_line({
        "type": "user", "timestamp": "2026-08-09T12:00:00.000Z",
        "message": {"role": "user", "content": [{
            "tool_use_id": "toolu_READ", "type": "tool_result",
            "content": [{"type": "text", "text":
                         "wiki/background-agents.md line 20:\n"
                         "Async agent launched successfully. (internal metadata)\n"
                         "agentId: 0123456789abcdef (internal ID)"}],
        }]},
    }) + "\n", encoding="utf-8")
    check("a quoted launch with no Agent tool_use behind it creates no entry",
          server.build_agent_registry(transcript) == {})

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

# --- project display names ---------------------------------------------------
# The store is a DICT, unlike the three lists above — _load_paths would take it
# and hand back [] with no error, which is the whole reason these are separate.
print("set_project_name: the display-name override")
with tempfile.TemporaryDirectory() as tmp:
    old_names = server.NAMES_FILE
    olds = (server.RECENTS_FILE, server.ARCHIVED_FILE, server.PINNED_FILE)
    try:
        server.NAMES_FILE = Path(tmp) / "names.json"
        check("a missing file reads as an empty dict", server._load_names() == {})

        in_force = server.set_project_name(r"D:\Work\App", " برنامه‌ی کاری ")
        check("Persian name round-trips through the file",
              server._load_names() == {r"D:\Work\App": "برنامه‌ی کاری"})
        check("the name in force comes back stripped", in_force == "برنامه‌ی کاری")
        check("lookup is case-insensitive",
              server._names_lower().get(r"d:\work\app") == "برنامه‌ی کاری")

        # Same folder, the case Windows handed us this time.
        server.set_project_name(r"d:\WORK\app", "دومی")
        check("renaming in another case replaces rather than duplicates",
              list(server._load_names().values()) == ["دومی"])

        check("a name longer than NAME_MAX is capped",
              len(server.set_project_name(r"D:\Work\App", "ب" * 200)) == server.NAME_MAX)

        check("an empty name reports the folder's own name",
              server.set_project_name(r"D:\Work\App", "   ") == "App")
        check("and deletes the override entirely", server._load_names() == {})

        server.NAMES_FILE.write_text("{ not json", encoding="utf-8")
        check("a corrupt file reads as an empty dict", server._load_names() == {})
        server.NAMES_FILE.write_text('["a list"]', encoding="utf-8")
        check("a list-shaped file reads as an empty dict", server._load_names() == {})

        # A removed project must not leave its name behind for the next folder
        # created at the same path.
        server.RECENTS_FILE = Path(tmp) / "r2.json"
        server.ARCHIVED_FILE = Path(tmp) / "a2.json"
        server.PINNED_FILE = Path(tmp) / "p2.json"
        server.set_project_name(r"D:\Work\App", "برنامه")
        server.drop_project_from_lists(r"d:\work\app")
        check("removing a project forgets its display name too",
              server._load_names() == {})
    finally:
        server.NAMES_FILE = old_names
        server.RECENTS_FILE, server.ARCHIVED_FILE, server.PINNED_FILE = olds

# --- resume prefill ----------------------------------------------------------
# After /api/session/resume the bar stayed blank until the first turn: every
# source that fills it (system/init, result, usage, statusline) waits for the
# CLI to process a message. The three facts below are already known at spawn.
# What can go wrong is silent in both directions -- a stale generation painting
# a dead session's numbers over the new one, or a machine with no statusLine
# taking the whole prefill down with it.
print("_publish_resume_prefill: the bar is filled before the first turn")

PREFILL_ID = "resumed-0123456789"
PREFILL_CWD = Path("D:/proj")


def _stub_session(hub):
    """A ClaudeSession with no subprocess: __init__ spawns nothing, and control()
    is the only thing _publish_resume_prefill needs from the live CLI."""
    session = server.ClaudeSession(PREFILL_CWD, hub, "claude.exe")
    session.session_id = PREFILL_ID
    session._generation = 1
    session.asked = []

    def _control(subtype, timeout=None, wait=True, **params):
        session.asked.append(subtype)
        if subtype == "get_context_usage":
            return {"subtype": "success", "response": {"percentage": 12.5}}
        if subtype == "get_usage":
            return {"subtype": "success", "response": {
                "session": {"total_cost_usd": 0.42},
                "rate_limits": {"five_hour": {"utilization": 7}}}}
        return {"subtype": "error", "error": f"unexpected: {subtype}"}

    session.control = _control
    return session


_old_statusline_command = server.statusline_command
try:
    # The machine HAS a statusLine: echo the payload back so the JSON the
    # script is handed can be read out of the published text.
    server.statusline_command = lambda: (
        f'"{sys.executable}" -c "import sys; sys.stdout.write(sys.stdin.read())"')

    prefill_hub = _Hub()
    _stub_session(prefill_hub)._publish_resume_prefill(1)
    kinds = [e.get("subtype") for e in prefill_hub.events]
    check("resumed is published first, then usage, then the statusline",
          kinds == ["resumed", "usage", "statusline"])
    check("the resumed event carries the session id and the cwd",
          prefill_hub.events[0] == {"type": "wrapper", "subtype": "resumed",
                                    "session_id": PREFILL_ID, "cwd": str(PREFILL_CWD)})
    usage = next((e for e in prefill_hub.events if e.get("subtype") == "usage"), {})
    check("usage carries the CLI's own numbers, not client arithmetic",
          (usage.get("context"), usage.get("cost"), usage.get("quota")) == (12.5, 0.42, 7))
    statusline = next((e for e in prefill_hub.events
                       if e.get("subtype") == "statusline"), {})
    payload = json.loads(statusline.get("text") or "{}")
    check("the statusline script is handed the resumed session's own id",
          payload.get("session_id") == PREFILL_ID)
    check("and no model — only system/init knows which one this session runs on",
          payload.get("model", {}).get("id") is None)

    # A restart while this thread was still starting up: publishing anything
    # now writes the dead session's numbers into the live one's bar.
    stale_hub = _Hub()
    stale = _stub_session(stale_hub)
    stale._publish_resume_prefill(0)
    check("a stale generation publishes nothing", stale_hub.events == [])
    check("a stale generation does not even ask the CLI", stale.asked == [])

    # statusline_command() returns None on a machine that configured none --
    # the silent-skip path, which must not take the prefill down with it.
    server.statusline_command = lambda: None
    bare_hub = _Hub()
    _stub_session(bare_hub)._publish_resume_prefill(1)
    check("no statusLine configured still prefills id, cwd and usage",
          [e.get("subtype") for e in bare_hub.events] == ["resumed", "usage"])
finally:
    server.statusline_command = _old_statusline_command

# --- concurrent tabs ---------------------------------------------------------
# N conversations at once, each its own ClaudeSession + PermissionBroker,
# distinguished ONLY by the tab their TabHub stamps on every event. What can go
# wrong here is invisible until it is expensive: one tab's events rendered into
# another, a bucket that grows for a week because nothing resets it any more, or
# a resume that starts a SECOND CLI on a transcript one is already appending to.


def _drain(q):
    out = []
    while True:
        try:
            out.append(q.get_nowait())
        except queue.Empty:
            return out


print("TabHub: every publish carries its tab")
live_hub = server.Hub()
tab_a = server.TabHub(live_hub, "tab-a")
tab_b = server.TabHub(live_hub, "tab-b")
tab_a.publish({"type": "wrapper", "subtype": "x"})
tab_b.publish({"type": "wrapper", "subtype": "y"})

client = live_hub.subscribe()
replayed = _drain(client)
check("a new client replays every bucket", len(replayed) == 2)
check("each event carries the tab that published it",
      {e["subtype"]: e["tab"] for e in replayed} == {"x": "tab-a", "y": "tab-b"})
tab_a.publish({"type": "wrapper", "subtype": "z"})
check("a live publish reaches the connected client, tagged",
      [(e["subtype"], e["tab"]) for e in _drain(client)] == [("z", "tab-a")])

print("Hub.reset(tab): one bucket, not the server")
tab_a.reset()
check("the reset event itself is tagged with the tab it cleared",
      [(e["subtype"], e["tab"]) for e in _drain(client)] == [("reset", "tab-a")])
check("tab A's history is gone, tab B's is untouched, and the reset replays",
      {(e["subtype"], e["tab"]) for e in _drain(live_hub.subscribe())}
      == {("y", "tab-b"), ("reset", "tab-a")})

print("Hub: replay history is capped PER TAB")
# The bound matters now: six long-lived tabs never reset, where the
# single-session server used to bound this by accident on every project switch.
capped = server.Hub()
_old_max = server.HISTORY_MAX
try:
    server.HISTORY_MAX = 5
    noisy = server.TabHub(capped, "loud")
    quiet = server.TabHub(capped, "quiet")
    quiet.publish({"n": -1})
    for n in range(8):
        noisy.publish({"n": n})
    kept = _drain(capped.subscribe())
finally:
    server.HISTORY_MAX = _old_max
check("a busy tab is capped at HISTORY_MAX",
      [e["n"] for e in kept if e["tab"] == "loud"] == [3, 4, 5, 6, 7])
check("the cap is per tab, so a quiet tab keeps its one event",
      [e["n"] for e in kept if e["tab"] == "quiet"] == [-1])

print("Hub.drop(tab): a closed tab replays nothing, ever")
closing = server.Hub()
server.TabHub(closing, "gone").publish({"subtype": "old"})
server.TabHub(closing, "stays").publish({"subtype": "kept"})
closing.drop("gone")
check("the closed tab's bucket is dropped entirely",
      [e["subtype"] for e in _drain(closing.subscribe())] == ["kept"])
# The stopped session's reader thread is still draining a dying pipe and
# publishes wrapper/cli_exited a few ms later. Measured on the running server:
# it lands after drop(), and without this it re-creates the bucket -- which
# then replays to every window for the life of the server.
server.TabHub(closing, "gone").publish({"subtype": "cli_exited"})
check("a late event from a closed tab does not resurrect its bucket",
      [e["subtype"] for e in _drain(closing.subscribe())] == ["kept"])


class _StubSession:
    """A ClaudeSession's tab-facing surface: no subprocess, no CLI."""

    def __init__(self, session_id, alive=True, cwd="D:/x"):
        self.session_id = session_id
        self.cwd = Path(cwd)
        self.spawned_at = 1.0
        self.broker = None
        self.hub = None
        self.stopped = False
        self._alive = alive

    def alive(self):
        return self._alive

    def stop(self):
        self.stopped = True
        self._alive = False


print("tab_running: resume ADOPTS a live tab and spawns for anything else")
# Two CLI processes appending to one .jsonl is corruption, so "already open"
# has to be answered before a resume spawns anything.
tabs = {
    "t1": _StubSession("sess-A"),
    "t2": _StubSession("sess-B", alive=False),   # killed; its transcript is idle
    "t3": _StubSession(None),                    # spawned, no first turn yet
}
check("a live tab on that session is adopted", server.tab_running(tabs, "sess-A") == "t1")
check("a DEAD tab is not adopted -- resume spawns a new one",
      server.tab_running(tabs, "sess-B") is None)
check("a session nobody is running spawns", server.tab_running(tabs, "sess-C") is None)
check("an empty session id never matches the tab that has none yet",
      server.tab_running(tabs, "") is None)

print("respond_permission: the id finds its own tab's broker, and only that one")
first, second = _StubSession("a"), _StubSession("b")
first.broker = server.PermissionBroker(_Hub())
second.broker = server.PermissionBroker(_Hub())
two_tabs = {"t1": first, "t2": second}

answered = {}
threading.Thread(target=lambda: answered.update(
    r=second.broker.request("Write", {"file_path": "x"}, "tu1")), daemon=True).start()
time.sleep(0.3)
held = list(second.broker._pending)
check("the second tab's broker is holding the request", len(held) == 1)
check("an unknown request id is refused by every broker",
      server.respond_permission(two_tabs, "no-such-id", "allow", False, "Write", None)
      is False)
if held:
    check("the answer reaches whichever broker holds the id",
          server.respond_permission(two_tabs, held[0], "allow", True, "Write", None)
          is True)
time.sleep(0.3)
check("the waiting caller got the decision", answered.get("r", {}).get("decision") == "allow")
check("«دوباره نپرس» stayed in the tab that granted it",
      second.broker.session_allow == {"Write"} and first.broker.session_allow == set())

print("close_tab: a pending approval is denied BEFORE the tab stops existing")
# The tabs rework broke an invariant the single-session server had for free:
# the broker always had a listener. Closing a tab left its waiters blocked for
# the full PERMISSION_TIMEOUT (110 s), and the deny they published on the way
# out landed after Hub.drop() -- discarded by the closed-tab guard, so the
# window's dialog for that conversation never went away.
closing_hub = server.Hub()
window = closing_hub.subscribe()          # a connected window, watching
victim = _StubSession("sess-doomed")
victim.hub = server.TabHub(closing_hub, "doomed")
victim.broker = server.PermissionBroker(victim.hub)

waited = {}
waiter = threading.Thread(target=lambda: waited.update(
    r=victim.broker.request("Write", {"file_path": "x"}, "tu-doomed")), daemon=True)
waiter.start()
time.sleep(0.3)
check("the doomed tab's broker is holding a request", len(victim.broker._pending) == 1)

_saved_tabs = (getattr(server.Handler, "hub", None),
               server.Handler.sessions, server.Handler.active)
try:
    server.Handler.hub = closing_hub
    server.Handler.sessions = {"doomed": victim}
    server.Handler.active = "doomed"
    started = time.monotonic()
    server.Handler.close_tab("doomed")
    check("close_tab does not block on the pending approval",
          time.monotonic() - started < 5.0)
finally:
    server.Handler.hub, server.Handler.sessions, server.Handler.active = _saved_tabs

waiter.join(timeout=5)
check("the blocked waiter was released with a deny",
      waited.get("r", {}).get("decision") == "deny")
check("nothing is left pending", victim.broker._pending == {})
closed_events = _drain(window)
resolved = [e for e in closed_events if e.get("subtype") == "permission_resolved"]
check("exactly one resolved event, published while the tab still existed",
      len(resolved) == 1 and resolved[0]["decision"] == "deny"
      and resolved[0]["tab"] == "doomed")
check("it carries the tool_use_id the dialog is keyed on",
      resolved[0]["tool_use_id"] == "tu-doomed")
check("the deny is published BEFORE wrapper/closed",
      [e.get("subtype") for e in closed_events
       if e.get("subtype") in ("permission_resolved", "closed")]
      == ["permission_resolved", "closed"])
check("the session was stopped and its bucket dropped",
      victim.stopped and _drain(closing_hub.subscribe()) == [])

print("ClaudeSession.busy: an in-flight COUNTER, not a boolean")
# Two defects in one field. `busy = True` used to run AFTER _write_line, so a
# fast result cleared it before it was set and the tab reported "working"
# forever; and mid-turn sends are allowed by design (the CLI queues extra stdin
# messages), so turn 1's result cleared a flag queued turn 2 still owned.
counter = server.ClaudeSession(Path("D:/x"), _Hub(), "claude.exe")
seen_busy = []
counter._write_line = lambda obj: seen_busy.append(counter.busy)
counter._publish_usage = lambda generation: None
counter._publish_statusline = lambda result, generation: None
GEN = counter._generation

counter.send_blocks([{"type": "text", "text": "one"}])
check("busy is already true while the line is being written", seen_busy == [True])
counter.send_blocks([{"type": "text", "text": "two"}])       # queued mid-turn
counter._after_result({}, GEN)
check("turn 1's result does not clear a queued turn 2", counter.busy is True)
counter._after_result({}, GEN)
check("the second result clears it", counter.busy is False)
counter._after_result({}, GEN)                                # the extra result
counter.send_blocks([{"type": "text", "text": "three"}])
check("an extra result cannot drive the count below zero -- a later turn is busy",
      counter.busy is True)
counter._after_result({}, GEN)
check("and one result still ends it", counter.busy is False)

counter.send_blocks([{"type": "text", "text": "four"}])
counter.send_blocks([{"type": "text", "text": "five"}])
counter.interrupt()
check("interrupt drops the queued turns too (they never emit a result)",
      counter.busy is False)
counter._after_result({}, GEN)   # the aborted turn's own result still arrives
check("the aborted turn's result is absorbed by the clamp", counter.busy is False)


class _DeadPipe:
    """A process whose pipes are already at EOF: _read_stdout falls straight
    through to its exit path, which is also start()'s reset."""
    stdout = ()
    stderr = ()

    def poll(self):
        return 0


counter.send_blocks([{"type": "text", "text": "six"}])
counter._read_stdout(_DeadPipe(), GEN)
check("the CLI exiting resets the whole count, not just the current turn",
      counter.busy is False)
counter.send_blocks([{"type": "text", "text": "seven"}])
counter._reset_inflight()        # what start() calls on a restart
check("a restart resets it too", counter.busy is False)

print("GET /api/projects: the sidebar answers with no tabs open")
# Routing it through _target() 404d once the last tab closed, and the window
# catches that silently -- the sidebar froze exactly when the user needs it
# (nothing open, pick something).
with tempfile.TemporaryDirectory() as tmp:
    _saved_tabs = (getattr(server.Handler, "hub", None), server.Handler.sessions,
                   server.Handler.active, server.Handler.token)
    _saved_paths = (server.PROJECTS_DIR, server.RECENTS_FILE,
                    server.ARCHIVED_FILE, server.PINNED_FILE, server.NAMES_FILE)
    httpd = None
    try:
        # Hermetic: never scan the author's real ~/.claude/projects.
        server.PROJECTS_DIR = Path(tmp) / "projects"
        server.PROJECTS_DIR.mkdir()
        for attr in ("RECENTS_FILE", "ARCHIVED_FILE", "PINNED_FILE", "NAMES_FILE"):
            setattr(server, attr, Path(tmp) / f"{attr.lower()}.json")

        server.Handler.token = "unit-token"
        server.Handler.hub = server.Hub()
        server.Handler.sessions = {}          # every tab closed
        server.Handler.active = ""
        httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        httpd.daemon_threads = True
        httpd.verbose = False
        threading.Thread(target=httpd.serve_forever, daemon=True).start()

        conn = http.client.HTTPConnection("127.0.0.1", httpd.server_address[1], timeout=5)
        conn.request("GET", "/api/projects?t=unit-token")
        response = conn.getresponse()
        payload = json.loads(response.read().decode("utf-8"))
        conn.close()
        check("no tabs open is 200, not 404", response.status == 200)
        check("the project list is still a list", isinstance(payload.get("projects"), list))
        check("and it reports no current project rather than failing",
              payload.get("current_cwd") == "" and payload.get("current_session") is None)
    finally:
        if httpd is not None:
            httpd.shutdown()
            httpd.server_close()
        (server.Handler.hub, server.Handler.sessions,
         server.Handler.active, server.Handler.token) = _saved_tabs
        (server.PROJECTS_DIR, server.RECENTS_FILE, server.ARCHIVED_FILE,
         server.PINNED_FILE, server.NAMES_FILE) = _saved_paths

print("POST /api/project/open: MAX_TABS holds when every request thread asks at once")
# Driven over HTTP on purpose. ThreadingHTTPServer answers each request on its
# own thread, and the cap check used to sit in the ENDPOINT with a filesystem
# call (Path.resolve) between it and the spawn it guarded -- so N callers all
# read len(sessions) < MAX_TABS and all spawned. A seventh `claude` process is
# real memory, already running by the time anything notices. Calling open_tab
# directly cannot see this: the GIL hides a check and a store that sit next to
# each other, which is exactly why the check had to move down to the store.
with tempfile.TemporaryDirectory() as tmp:
    _saved_tabs = (getattr(server.Handler, "hub", None), server.Handler.sessions,
                   server.Handler.active, server.Handler.claude_bin,
                   server.Handler.token)
    _saved_recents = server.RECENTS_FILE
    _old_start = server.ClaudeSession.start
    httpd = None
    try:
        # Stubbed spawn: no CLI, but slow enough to keep the threads overlapping.
        server.ClaudeSession.start = lambda self, resume_id=None: time.sleep(0.02)
        server.RECENTS_FILE = Path(tmp) / "recents.json"
        server.Handler.token = "unit-token"
        server.Handler.hub = server.Hub()
        server.Handler.sessions = {}
        server.Handler.active = ""
        server.Handler.claude_bin = "claude.exe"
        httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        httpd.daemon_threads = True
        httpd.verbose = False
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        port = httpd.server_address[1]

        statuses = []
        statuses_lock = threading.Lock()
        # All of them inside the endpoint at once -- the whole point. Without
        # the barrier they queue up behind thread creation.
        gate = threading.Barrier(server.MAX_TABS * 3)

        def _race():
            payload = json.dumps({"path": tmp})
            gate.wait()
            conn = http.client.HTTPConnection("127.0.0.1", port, timeout=20)
            conn.request("POST", "/api/project/open?t=unit-token", payload,
                         {"Content-Type": "application/json"})
            status = conn.getresponse()
            status.read()
            conn.close()
            with statuses_lock:
                statuses.append(status.status)

        threads = [threading.Thread(target=_race) for _ in range(server.MAX_TABS * 3)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)

        check("never more tabs than MAX_TABS",
              len(server.Handler.sessions) == server.MAX_TABS)
        check("exactly MAX_TABS callers got one", statuses.count(200) == server.MAX_TABS)
        check("everyone else got the 409, not a seventh process",
              statuses.count(409) == server.MAX_TABS * 2)
        check("active is one of the winners, not a tab that lost the race",
              server.Handler.active in server.Handler.sessions)
    finally:
        if httpd is not None:
            httpd.shutdown()
            httpd.server_close()
        server.ClaudeSession.start = _old_start
        server.RECENTS_FILE = _saved_recents
        (server.Handler.hub, server.Handler.sessions, server.Handler.active,
         server.Handler.claude_bin, server.Handler.token) = _saved_tabs

print(("FAIL — " + ", ".join(fails)) if fails else "PASS — all unit checks")
sys.exit(1 if fails else 0)
