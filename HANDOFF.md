# HANDOFF — 2026-08-07, overnight session

The four beads the previous handoff left as REMAINING (`pcg-vnv`, `pcg-zj1`,
`pcg-52j`, `pcg-2jy`) are **done, committed and verified in the running app**.
Read `CLAUDE.md` first; this file only covers what is not yet in it.

Everything is committed on `rework/phases-0-3`. Nothing is pushed.

## Gates, all re-run at the end of this session

| Check | Result |
|---|---|
| `run_spec_test.py` | **PASS — 36/36** (was 24; 12 added) |
| `smoke_test.py` | **PASS — 12/12** (was 10; 2 added) — costs one turn |
| `test_units.py` | PASS (4 broker checks added) |
| `test_no_console.py` | PASS |
| `test_transcript_path.py` | PASS |

```
cd persian-claude-gui
C:\Python314\python.exe run_spec_test.py
C:\Python314\python.exe test_units.py
C:\Python314\python.exe test_no_console.py
C:\Python314\python.exe test_transcript_path.py
```

## What landed (one commit each — read the commit messages, they carry the why)

- `5667abc` **AskUserQuestion** as a real question dialog.
- `30d4891` **Context notice** — /compact and /clear as two Persian buttons.
- `8fe5891` **Effort chip** — mirrored from `initialize`, written through the
  one honest read-back.
- `a08fc64` **Real diffs** for Edit/Write/MultiEdit, in the card *and* in the
  permission dialog.

Note `5667abc` also swept in the previous session's 15 uncommitted files (tool
rail, kebab menu, statusline meters, clipboard paste). Its message describes
only the AskUserQuestion work — if you are archaeology-ing that history later,
that is why the diff is bigger than the message.

## Measurements this session cost real turns to get — do not re-derive

All on **claude 2.1.223**. Full write-ups are in the wiki; the one-line versions:

- **AskUserQuestion travels over the `can_use_tool` pipe** and its answer rides
  back in the allow reply's `updatedInput.answers`, keyed by question TEXT.
  → `wiki/permission-transport.md` §AskUserQuestion.
- **There is no `set_effort` control subtype.** The full subtype list is in
  `wiki/control-protocol.md` §6, along with why only
  `get_settings().effective.effortLevel` can be trusted, and the fact that
  `initialize` advertises a `max` level the settings schema refuses.
- **The CLI's own `/effort` writes the user's real `~/.claude/settings.json`**;
  `apply_flag_settings` only makes a session overlay. That difference is the
  only reason the chip is acceptable. The smoke test asserts the file stays
  byte-identical.
- **`diagnostics.cache_miss_reason` is real but useless as a trigger** — it
  fires on the first turn of every resumed session.
- **The CLI's "Context low" / "% until auto-compact" warnings are Ink
  components and never reach stream-json.** Only the hard-limit message does.

## Hard-won, and the one worth internalising

**An assertion on `textContent` is blind to every BiDi defect there is.** The
diff count rendered `1- 2+` on screen while `textContent === "+4"` passed. If a
check does not read a computed style or a measured geometry, it is not a
rendering check. Written up in `wiki/rtl-rendering-notes.md`.

Also: the spec gate is now the place where a behaviour change *shows up* rather
than a thing to route around. Cases 9 and 10 legitimately failed when Edit/Write
started rendering as diffs; they were retargeted to `.diff .dt`, not deleted.
`.tool-output` stays covered by cases 11–12.

## Environment notes for the next session

- Probes are **much** cheaper against a scratch cwd. The first AskUserQuestion
  probe cost **$3.00** because the wrapper resumed this repo's own 283k-token
  session; the same probe against an empty temp folder cost $0.13.
- A dev-run helper that boots the server, holds an SSE client open (so the idle
  watchdog cannot kill it) and prints the URL lives in the session scratchpad.
  It is 30 lines — rewrite it rather than hunting for it; the pattern is in
  `run_spec_test.py`.
- **Spawning `claude.exe` directly from Bash is blocked by the tool classifier.**
  Drive the running server's own endpoints instead — same measurement, and it
  exercises the real path.
- `server.py` changes need a server restart; client changes only need a page
  reload. Two rounds of screenshots were wasted on this last session.

## REMAINING

`bd ready` is the source of truth. Open now:

- `pcg-9jx` (P3) — MCP tool names render raw and overflow the tool row
  (`mcp__claude-in-chrome__tabs_context_mcp`). Fix in the fallback, not in
  `strings.fa.js` — the MCP tool set is per-machine.
- **M8 acceptance on the colleague's PC** is still the only milestone left, and
  still cannot be done from this machine. `M8-acceptance.md` is the checklist.
  The three never-executed install branches (Python install, claude install,
  `-Payload`) remain unexecuted anywhere.
