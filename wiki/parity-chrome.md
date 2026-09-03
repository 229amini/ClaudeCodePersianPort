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

### Esc is the second door to it (2026-08-23, `pcg-b33`)

The TUI stops a turn with Esc, so the window does too — bound on `document`, not on the
textarea, and routed through the **stop button's own click** rather than a second `fetch`. That
buys the auto-repeat guard for free: the click handler disables the button until the POST comes
back, so a held-down Esc is one interrupt and not thirty.

The risk is entirely the other direction. Esc already dismisses four things here — the permission
`<dialog>`, the `popover` menus (kebab, agents drawer), the slash list and the chip menu — and a
stray interrupt would kill a turn the user only meant to un-open a menu for. The guard is one
`querySelector` (`dialog[open], :popover-open, #slash-popup:not([hidden]),
#menu-popup:not([hidden])`) plus `e.defaultPrevented`, which covers handlers that claim the key
without any of those states (the sidebar's inline rename field). **A DOM query, not a flag** —
registration order between two `document` listeners is not something a later module can be
trusted to preserve.

Idle Esc is deliberately unbound. The TUI clears its input line with it; here the composer is a
real `<textarea>` whose value is the only copy of what was typed, and there is no undo across a
programmatic clear.

Guarded by three spec checks, two of them negatives — those are the load-bearing ones.

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
2. **`interrupt()` and the window disagreeing by design.** ~~The server resets `_inflight` to 0 on
   an interrupt (`interrupt_cancel_queued_v1` means the queued turns never report); the window
   only zeroes on an `aborted_streaming` result. When that result never comes, the two never
   reconcile.~~ **Superseded 2026-08-24.** `_inflight` is gone. The server now keeps a uuid ledger
   (`_outstanding`); `interrupt()` leaves the ledger standing
   until the CLI's own receipt says which uuids it actually cancelled — see "The message queue: one
   `result` does not mean one send" in `cli-stream-json-findings.md` and `server.py
   _settle_interrupt()`. The disagreement this bug named is closed at the source now; the silence
   window below covers only what the receipt cannot (no receipt at all, an older CLI, a
   still-running command's own terminal state).

**The fix is `wrapper/idle_sync`** — the wrapper saying "this conversation has nothing in flight",
which is a fact only it holds. `/api/interrupt` arms it; the renderer's handler zeroes the count,
*settles* the pulse (the turn happened; its closing line is the record) and clears busy. It is
tagged with the tab like every other event, so it unsticks the conversation the stop belongs to
rather than whichever tab is on screen, and it is idempotent by construction — a late fire after a
normal result is three no-ops and prints nothing.

### What it waits on is SILENCE, not a clock

This is the part that took a review round to get right, and it is the whole safety of the feature.

**Updated 2026-08-24.** The receipt (`interrupt_receipt_v1`) is now the primary settlement path —
see `server.py _settle_interrupt()` and "the receipt settles the ledger" in `test_units.py` — so
`interrupt()` no longer zeroes anything up front; the ledger stands until the receipt, or absent
one this backstop, says otherwise. The reasoning
below is unchanged, just no longer resting on an eager zero: a CLI that is merely **slow** to
abort — a `Bash` child resisting termination — keeps streaming, and a receipt that never arrives
(an older CLI, a timeout) leaves nothing else to settle it. A plain "publish in 5 s unless busy"
would fire straight through that and land mid-stream: `resetTurn()` nulls the streaming bubble,
the pulse and the stop button vanish while output is still printing, and the next delta opens an
orphan bubble nothing ever settles.

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
| `broker.has_pending()` | **a `can_use_tool` request the user has not answered yet.** The CLI is stdout-silent *by construction* for as long as the dialog is up, so silence stopped being proof: the deadline expired mid-turn and `_sync_idle` cleared the ledger under a running turn. The deadline is pushed out for a full window instead. The residual this leaves — a model that stalls more than five seconds between stream events with **no** permission pending — is accepted and made harmless: the settle hands a queued row's text back rather than losing it, and it buys no `/recap` (`render.js endBatch(false)`), so it cannot eat the answer that is still coming |
| `_inflight` re-read **under `_inflight_lock`, with the publish inside it** | the timer thread reads 0, a `/api/message` lands and echoes, and the stale sync publishes after it. `send_blocks()` increments under that same lock before it writes, so there is no gap left |

There is deliberately no "publish immediately because we already knew nothing was running" branch.
A CLI with nothing to do is exactly the one that stays quiet, so silence answers that case too, and
one path cannot disagree with itself.

The interrupt itself is now sent **even when the server believes nothing is running**. `_inflight`
is our bookkeeping, not the CLI's, and a stop button that quietly declines to send because our own
counter drifted is the reported defect pointing the other way — pressing stop twice is exactly what
a user does when the first press looked like nothing.

### The third way, fixed 2026-08-23: the reconnect cursor

`Hub.subscribe()` used to replay the full per-tab backlog unconditionally and `_serve_sse` sent
no `id:` field, so an `EventSource` auto-reconnect (sleep/wake, any transient drop) re-delivered
every event the window already rendered: the transcript duplicated, and the `user_echo`/`result`
counting ran a second time. Balanced pairs cancel out, but a drop that lands **mid-turn** leaves
a `+1` no remaining `result` can pay back — permanently stuck busy with no process death
anywhere. This was the user's "the session is finished but it still says it is thinking" report
(2026-08-23, on 2.1.240 — but version-independent; the upgrade merely coincided).

The fix is a global monotonic `seq`, stamped in `Hub.publish` under the lock, emitted as the SSE
`id:` line. The browser sends it back as `Last-Event-ID` on auto-reconnect and
`subscribe(after)` replays only `seq > after`. A fresh window (no header) still replays
everything, which is what page refresh and the closing-line rules in frontend-modules.md assume.
Both stamping and filtering happen under the same `_lock` as client registration, so a publish
racing a reconnect is either in the replayed history or delivered live, never both. Pinned in
`test_units.py` (Hub cursor section) and verified on the wire — real server, `id:` lines, a
reconnect with `Last-Event-ID: 2` receiving exactly seq 3+. `idle_sync` stays: it covers the
interrupt-shaped ways to lose a `result`, which a cursor does nothing for.

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

## The queue strip (2026-08-24, the uuid-ledger rework)

A message sent while the CLI is still answering used to render as a delivered user bubble the
moment `/api/message` echoed it — a lie the instant the CLI folds, merges, or drops it rather than
running it as its own turn (see "The message queue" in `cli-stream-json-findings.md`). It now
parks in a dim «در صف» row in a strip above the composer (`render.js queueStripEl()`, built the
same way the background-agents strip is — agents.js `stripEl()` — because it is pure chrome that
also has to exist on the spec harness, which carries the composer markup and none of the rest of
the shell), and only the CLI's own `command_lifecycle` events move a row: `started` promotes it
into a real transcript user bubble at the point the CLI actually reached it (the same point a
folded prompt's `attachment/queued_command` replays to, so live and refresh converge); `completed`
with no `started` promotes it too, retroactively — a CLI with no lifecycle channel closes one
arbitrary ledger entry per result (`server.py _close_one_command`), and that is the only report
such a row will ever get; `cancelled`/`discarded`/`refused` remove the row and hand its text back
into the composer, because nothing typed into a queue the user never chose to see may be lost.
Per-row cancellation is the ✕: `POST /api/queue/cancel {uuid}` calls `cancel_async_message` and
only acts on a *true* answer — `false` is the CLI's documented "already dequeued for execution,"
i.e. the row is about to `started`, so it must stay. `idle_sync` and `cli_exited` clear the whole
strip **and give the text back**: a row still *sitting* in the strip has emitted no lifecycle event
at all — anything the CLI actually reached was promoted out of it by its own `started` long before
five seconds of total silence could elapse — so nothing left there can have run. (The earlier rule
here was no-give-back on `idle_sync`, justified as "the wrapper can no longer account for the
message"; that lost the typed text outright on the no-receipt stop path — an older CLI, or a
receipt that never came.) The `reset`/`resumed` paths still clear silently, because the **server**
hands those back explicitly instead: `start()` publishes one synthetic `discarded` per open uuid
before it spawns, so a deliberate respawn and a crash now behave identically.

A give-back is suppressed for a **replayed** event. A fresh window (no `Last-Event-ID`) is handed
the whole backlog, so an hour-old cancellation is re-delivered on every reload; `Hub.subscribe()`
marks those events `replayed: true` on a shallow copy, and the window drops the row but does not
hand the text back a second time. A cursor-resume is deliberately **not** marked — those events
have never been processed by that window, so they are live-equivalent. That mark replaced
`restoreDraft`'s `input.value.includes(text)` dedupe, which was also a way to *lose* text: a
returned message that happened to be a substring of the current draft was swallowed silently.

**A stop does not settle the whole ledger.** The receipt keeps `still_queued[]` on purpose, so the
window clears only the uuids that are **not** in the strip on an `aborted_streaming` result;
anything still parked there keeps `busy` true until its own lifecycle event arrives (the synthetic
`cancelled` the receipt publishes, or the `started` of one the CLI kept). A stop with nothing
queued still settles instantly, which is what keeps the button feeling instant.

**A stop no longer cancels the queue (2026-08-31).** `interrupt()` sends `cancel_queued: false` —
the TUI-parity the user asked for: Esc in the real CLI aborts the running turn and the queued
messages survive to run next. True (2026-08-24..31) drained the strip on every stop and handed
the text back, which read as "stop killed my queue". The window needed **nothing** for the flip:
the aborted result already clears only non-strip uuids, the surviving rows keep `busy`, and each
one's `started` promotes it — exactly the machinery the paragraph above describes. The strip's
per-row ✕ is the queue-cancel now; the receipt's `cancelled[]` normally comes back empty but the
settlement path stays, because it must keep acting on whatever any CLI reports. Re-measured on
2.1.251 the same day: queue contract unchanged (`probe_queue.py` 8/8).

Strip state (`state.queued`) lives in the same **render scope** as every other piece of
per-conversation chrome, so a background tab records without painting and a fresh window rebuilds
the same strip a live one had out of nothing but the SSE backlog — replay-deduped by uuid, the
same key the ledger and the transcript both use.
