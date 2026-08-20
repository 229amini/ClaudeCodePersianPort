# Parity chrome (M6) — stop, slash, attach, statusline

Built and verified 2026-08-04 against `claude` 2.1.221. Closes the last three §B-9 items.

## B-9.10 — interrupt: control_request over stdin

Send on stdin:

```json
{"type":"control_request","request_id":"pcg-int-1","request":{"subtype":"interrupt"}}
```

Reply on stdout:

```json
{"type":"control_response","response":{"subtype":"success","request_id":"pcg-int-1",
 "response":{"still_queued":[]}}}
```

The turn then ends as:

```
result subtype  : error_during_execution
terminal_reason : aborted_streaming
result text     : ''
```

**The process stays alive.** That is the whole point — the session, and therefore the
conversation, survives, so the plan's "killing the process loses the session, `--resume` on next
message is a mandatory fallback" worry does not apply. Never kill to implement stop.

**`error_during_execution` here is not a failure.** The renderer checks
`terminal_reason === "aborted_streaming"` *before* `is_error` and shows a calm «متوقف شد» note
instead of a red error banner. Getting that order wrong means every stop looks like a crash to a
non-technical user.

The `capabilities` array in `system/init` advertises this:
`interrupt_receipt_v1`, `interrupt_cancel_queued_v1`, `msg_lifecycle_v1`.

## B-9.4 — slash commands work in `-p`

Sending `/context` as plain user text returned real rendered markdown (context table, token
counts) with **no tool calls** — the CLI resolves the command internally. No special handling
needed; slash commands are just text.

Autocomplete is driven by **`system/init`'s `slash_commands` array**, which is authoritative for
whatever that machine actually has (built-ins, plugins, custom skills). Plan §B-6 suggested
scanning `~/.claude/skills/` and project `.claude/skills/` — don't. The CLI already tells us, and
its list includes plugin commands that directory scanning would miss.

**Prefer the `initialize` control request over the `init` event for this** (2026-08-05): same
authority, available at spawn instead of after turn one, and each entry carries a `description`
and `argumentHint` that `slash_commands` (names only) does not. See
[control-protocol.md](control-protocol.md).

## B-9.5 — image content blocks are accepted

Standard Anthropic shape, sent as a block in the stream-json user message:

```json
{"type":"image","source":{"type":"base64","media_type":"image/png","data":"<base64>"}}
```

Verified twice: a 1×1 red PNG ("Pink.") and a 64×64 blue PNG, asked in Persian, answered «آبی».

Non-image attachments become an `@path` mention appended to the text — CLI-native behaviour, so
the wrapper never reads those files itself. Images are capped at 5 MB.

## statusLine passthrough (plan §B-7)

The target machine's own `statusLine` command is **inherited, not reimplemented**. `server.py`
reads `~/.claude/settings.json`, and on every `result` runs the command with JSON on stdin,
strips ANSI, and publishes the text for the window to show LTR-isolated.

The input contract used:

```json
{"session_id":…,"cwd":…,"model":{"id":…,"display_name":…},
 "workspace":{"current_dir":…,"project_dir":…},"version":…,
 "output_style":{"name":"default"},"cost":{"total_cost_usd":…,"total_duration_ms":…}}
```

**Caveat worth knowing:** that shape was inferred, then validated against this machine's actual
statusline script — which only reads a few of the fields. It is not verified field-for-field
against what the real CLI passes. If a target machine's statusline shows blanks, that contract is
the first suspect.

### It never actually ran (fixed 2026-08-07)

`run_statusline` used `subprocess.run(command, shell=True)`. On Windows that becomes
`cmd /c <command>`, and **cmd strips the outer quote pair of a command that begins with a quoted
exe path** — which is what every `statusLine` invoking node or python out of
`"C:\Program Files\…"` looks like. The author PC's own statusline is exactly that shape:

```
"C:\Program Files\nodejs\node.exe" "C:/Users/…/statusline-command.js"
```

cmd reported `'"C:\Program Files' is not recognized`, exit 1, empty stdout — and `run_statusline`
returns `None` on empty output, so §B-7 passthrough was **silently dead for the entire life of the
feature**. Nothing logged, nothing rendered, and the built-in items still drew, so the bar looked
merely sparse rather than broken.

The fix is the documented cmd form, with `shell=False` so Python passes the string to
`CreateProcess` verbatim:

```python
subprocess.run(f'{os.environ.get("COMSPEC", "cmd.exe")} /s /c "{command}"', …)
```

`/s` makes cmd strip exactly one outer pair and pass the rest through untouched. `test_units.py`
pins it with a quoted-exe-path command.

Two things landed with it:

- **It publishes on `system/init`, not only on `result`.** The CLI shows its statusline from
  startup; ours left the bar empty for the whole first turn. Off-thread, same reason
  `_after_result` is.
- **ANSI is parsed, not stripped.** A statusline encodes meaning in colour (which mode is on, how
  full the context is); `ansi_segments()` turns SGR runs into `[{text, fg?, bg?, bold?, dim?,
  italic?}]` and the client builds spans. Parsed in Python so nothing reaches the DOM as markup
  and the client stays dumb. Supports basic/bright, `38;5;N`, `38;2;r;g;b`, and drops non-SGR
  escapes. `text` is still published alongside as the plain fallback.

**Rule this is the third instance of:** a helper that returns `None` on failure and has no caller
that logs is indistinguishable from a machine with no statusline configured. Same shape as the
launcher bug in `packaging.md` §"The launcher's third failure".

It runs on a background thread: a statusline is someone else's script and must never stall the
event pump. 10-second timeout.

## Known gaps, deliberately not half-built

Plan §B-7 says known-unavailable features get a "known differences" list rather than imitations:

- **Mode switching** (plan mode, acceptEdits toggle) — ~~not implemented. `--permission-mode` is a
  launch flag; nothing verified lets it change mid-session over stream-json. Would need a restart,
  which would be a surprising thing for a button to do.~~
  **Wrong as of 2026-08-05.** A `control_request` with subtype `set_permission_mode` changes it
  live and the CLI confirms with a `system/status` event; `set_model` works the same way. Neither
  needs a restart. See [control-protocol.md](control-protocol.md). Build these as instant controls.
- **`!` shell passthrough** and **`Esc` semantics** — terminal-only, no equivalent.
- Cost on an interrupted turn reports `$0.0000`. That is what the CLI returns for an aborted
  result; it is not a wrapper bug.

## Renderer coverage now verified

Driven synthetically through `window.renderEvent` (cheaper and more reliable than provoking the
real thing):

| input | result |
|---|---|
| `thinking` deltas | collapsible «در حال فکر کردن» card, paths inside still LTR-isolated |
| `TodoWrite` tool_use | checklist: ✓ completed struck through, ▸ in_progress accented, ○ pending |
| ordinary `tool_use` + `tool_result` | one card, params + output, `.tool-output` computes `direction: ltr` |
| `{"type":"totally_unknown_future_type"}` | collapsed raw-JSON card, no crash — the CLAUDE.md requirement |

## QA note

CDP `Page.captureScreenshot` intermittently times out on this page (also seen with an open modal
in M4). Retrying the same call usually succeeds. Not a page bug.

## The stop button that stopped nothing (2026-08-18, bead pcg-kk9)

Reported: the working pulse «در حال تراشیدن…» ran indefinitely with the stop button up, pressing
stop did nothing, and the CLI itself was idle.

**The mechanism, not the trigger.** The window derives "working" from the results it has SEEN —
`render.js state.inflight`, one `+1` per `wrapper/user_echo` and one `-1` per `result`, because a
queued batch has to keep ONE status line (see log.md 2026-08-14). So *anything* that eats a
`result` strands the window at working forever, and stop then interrupts a CLI with no turn to
interrupt, which produces no `aborted_streaming` result to unstick it either. Two ways found here:

1. **`_read_stdout` publishing no `cli_exited`.** The exit notice sat after the read loop, so an
   exception inside the loop (a closed pipe mid-read, a thread that could not be spawned for a
   `result`) skipped it entirely. It is a `try/finally` now — this thread is the only thing that
   can tell a window its CLI is gone.
2. **`interrupt()` and the window disagreeing by design.** The server resets `_inflight` to 0 on
   an interrupt (`interrupt_cancel_queued_v1` means the queued turns never report); the window
   only zeroes on an `aborted_streaming` result. When that result never comes, the two never
   reconcile.

**The fix is `wrapper/idle_sync`** — the wrapper saying "this conversation has nothing in flight",
which is a fact only it holds. `/api/interrupt` arms it; the renderer's handler zeroes the count,
*settles* the pulse (the turn happened; its closing line is the record) and clears busy. It is
tagged with the tab like every other event, so it unsticks the conversation the stop belongs to
rather than whichever tab is on screen, and it is idempotent by construction — a late fire after a
normal result is three no-ops and prints nothing.

### What it waits on is SILENCE, not a clock

This is the part that took a review round to get right, and it is the whole safety of the feature.

`interrupt()` zeroes `_inflight` (the queued turns are cancelled and will never report), which
means `busy` can no longer speak for *the very turn being aborted*. A plain "publish in 5 s unless
busy" therefore fires straight through a CLI that is merely **slow** to abort — a `Bash` child
resisting termination keeps streaming — and lands mid-stream: `resetTurn()` nulls the streaming
bubble, the pulse and the stop button vanish while output is still printing, and the next delta
opens an orphan bubble nothing ever settles.

So the wait is on silence. `interrupt()` sets `_idle_deadline = now + IDLE_SYNC_SECONDS` (5 s) and
arms one timer; **every stdout line pushes that deadline out** (`_touch_idle()`, called in
`_pump_stdout` before the parse — a line we cannot read is still a line the CLI sent). A timer that
wakes early re-arms itself for whatever is left rather than firing. A genuinely stuck CLI is
*silent*; anything that speaks is alive and its own `result` will do the cleanup.

Three guards in `_sync_idle()`, each for a race that produced a visible defect:

| guard | race |
|---|---|
| deadline in the future | the CLI spoke since the interrupt — wait out the rest of the silence |
| deadline `0.0` | nobody is waiting; also dedupes the timer left by a second press of stop |
| `_inflight` re-read **under `_inflight_lock`, with the publish inside it** | the timer thread reads 0, a `/api/message` lands and echoes, and the stale sync publishes after it. `send_blocks()` increments under that same lock before it writes, so there is no gap left |

There is deliberately no "publish immediately because we already knew nothing was running" branch.
A CLI with nothing to do is exactly the one that stays quiet, so silence answers that case too, and
one path cannot disagree with itself.

The interrupt itself is now sent **even when the server believes nothing is running**. `_inflight`
is our bookkeeping, not the CLI's, and a stop button that quietly declines to send because our own
counter drifted is the reported defect pointing the other way — pressing stop twice is exactly what
a user does when the first press looked like nothing.

### The third way, NOT fixed: SSE reconnect replays everything

`Hub.subscribe()` replays the full per-tab backlog (`HISTORY_MAX` 5000 events/tab) and `_serve_sse`
sends no `id:` field, so there is no `Last-Event-ID` cursor. An `EventSource` auto-reconnect
therefore re-delivers every event the window already rendered: the transcript duplicates, and the
`user_echo`/`result` counting runs a second time. Balanced pairs cancel out, but a reconnect that
lands **mid-turn** adds a `+1` that the single remaining `result` cannot pay back — permanently
stuck busy, with no process death anywhere. Fixing it needs a real cursor and is out of scope;
`idle_sync` is what unsticks it in the meantime.

## Shift+Tab cycles the approval posture (2026-08-18, bead pcg-hta)

TUI parity. `composer.js` binds the key and calls `controls.js cyclePosture()`, which picks the
next entry of the same `POSTURES` list the pill's menu is built from and hands it to the same
`pickPosture()`. That is the whole design: both of the pill's load-bearing properties are inherited
by construction rather than re-implemented — the chip still moves only when the server's
`wrapper/posture` event arrives, and `plan` still exits on its own when the engine leaves it
(approval-postures.md). A posture that nothing has confirmed yet does not cycle at all.
The slash popup's `Tab` branch is now `Tab && !shiftKey`, or Shift+Tab would also accept a
completion on its way past.

## The session recap — the CLI's «※ recap: …» (2026-08-20)

The TUI prints a one-line recap under a finished turn: *"recap: Goal: … Next: …"*. Two different
mechanisms sit behind that word in the 2.1.235 bundle, and only one of them is reachable from here.

**The automatic one is remote-only.** It is `awaySummary`: it fires when the person has been away
5+ minutes, and it leaves through `notifyMetadataChanged({recap})` → `onMetadataChanged`, gated by
`DGS()` (`CLAUDE_CODE_ENABLE_REMOTE_RECAP` / the `tengu_harbor_moth` flag). That path feeds the
remote/desktop clients, **not** the stream-json stdout. Worse, `HKr()` — the enable check — begins
`if (Cn()) return !1`, so print mode disables it outright. Nothing about it can be listened for.

**The command is reachable.** `/recap` is a local command:

```js
{type:"local", name:"recap", description:"Generate a one-line session recap now",
 supportsNonInteractive:true, thinClientDispatch:"post-text"}
```

Measured on 2.1.235 by sending it as ordinary message text down the same stdin pipe every turn
uses. It answers as **a synthetic `assistant` message plus a `result`**, and:

- it is **never written to the transcript** — the `/recap` turn and its answer do not appear in
  `~/.claude/projects/<cwd>/*.jsonl`, so nothing of this leaks into history replay;
- on an empty session it refuses **for free**: `result` = `"Nothing to recap yet — send a message
  first."`, `num_turns: 0`, `total_cost_usd: 0`. That is the zero-cost probe for the whole
  mechanism — use it rather than spending a turn;
- when it really answers it **costs an API call** (~$0.018 on a 33k-token session; it re-reads the
  conversation). This is why the CLI itself only fires the automatic one when you are away.

### Consequences for the wrapper

`ClaudeSession.request_recap()` sends it and arms `_recap_wanted`; the reader loop swallows that
turn's `assistant` / `result` / `stream_event` and re-publishes `wrapper/recap` with the text.
Without the swallow the window renders the CLI's closing note as a reply to a message nobody sent.

**The flag is the dangerous part** — one left standing eats the next *real* answer, which is
silence with no error anywhere. Three things close that: it is set inside `send_blocks()` under the
in-flight lock, so **any ordinary send clears it**; `_reset_inflight()` clears it (start, CLI exit,
interrupt); and a send that raises clears it on the way out. `request_recap()` also refuses while
a turn is running, because the flag is the only thing telling a recap from a real answer.

`RECAP_NON_ANSWERS` in `server.py` holds the three strings the CLI uses when it cannot answer
(`"Nothing to recap yet"`, `"Recap cancelled"`, `"Couldn't generate a recap"`). All three come back
as an ordinary **successful** result, so the text is the only discriminator — re-check them after a
CLI upgrade; a drifted string costs one stray English line, not a crash.

The trigger lives in the window (`composer.js isAway()`, used by render.js at the turn's end): the
window is hidden, or nothing has been typed/clicked for five minutes. Turn traffic deliberately
does not count as input — a long answer arriving is exactly when the person walked off.
