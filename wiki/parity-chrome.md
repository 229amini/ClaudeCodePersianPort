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

Non-image attachments become an `@"path"` mention appended to the text — CLI-native behaviour, so
the wrapper never reads those files itself. Images are capped at 5 MB.

The mention is **quoted** (A1, 2026-09-09): the CLI's unquoted form stops at the first space, so
`@C:\Users\ali reza\note.txt` attached `C:\Users\ali` and said nothing. A non-image dropped or
pasted into the terminal edition is spilled to `PASTE_DIR` first and capped at **256 KiB** with a
text-decodability check, both enforced here rather than by the CLI — see
`cli-stream-json-findings.md` §5.2 for why the CLI cannot report either failure.

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

## The composer bar (2026-09-29, pcg-d5q)

claude.ai/code's bar, in both editions, by user decision: `COMPOSER-BAR.md` at the repo root holds
the measured sources and the shape. What cost time or is not obvious:

- **`js/bar.js` is one file in two places**, byte-identical (`test_bar.py` checks), a leaf that
  imports nothing: each edition passes its own `toCss` (terminal `prefs.js cssPx`, web identity)
  and its own state. The **web edition keeps its in-cell `.menu-popup`** for model/mode/style —
  `test_layout.py` and `test_split.py` measure that popup staying inside its own cell at five
  sizes, a guarantee a floating popover would give up — and only gained the title row, ✓ and
  digit keys. The slider, the usage panel and «+» come from `bar.js` in both.
- **`mcp_toggle` is persistent**: it writes `projects/<cwd>/disabledMcpServers` into
  `~/.claude.json` (measured in a throwaway HOME), as the TUI's `/mcp` does. The menu says so.
- **`get_usage` takes `skip_behaviors: true`**: without it the reply scans every transcript
  touched in seven days for a `behaviors` section nothing here reads. `rate_limits` carries
  `model_scoped[] {display_name, utilization, resets_at}` — the «Weekly · Fable» row.
- The mode menu is the wrapper's four postures, **not** the CLI's `auto` (approval-postures.md).
- «+ → پیوست فایل» is `/api/attach/pick` (native dialog, real paths) in both editions; the
  browser file input the terminal got first would have base64'd every file through the page.

## The statusLine payload (2026-09-29, pcg-cds)

The user's script printed `~/Desktop | [CAVEMAN]` here and a full bar in the TUI (model, effort,
context bar, cache ratio, 5h/7d). Not a rendering bug: `_publish_statusline` handed it six fields,
and a statusLine script prints what it is given. `server.py statusline_payload()` now builds the
CLI's own shape — `fKn` in the 2.1.284 bundle, read out of the binary — from what the wrapper
already measures:

| Field | Source |
|---|---|
| `model.id` / `display_name` | `self.model`, or before `system/init` the effective settings' `model` resolved through `initialize.models`; the name is the first half of the catalogue entry's `description` («Sonnet 5.5 · …») |
| `context_window` | the last **main-thread** assistant `usage` (the CLI's `PEe`) against the window from `result.modelUsage[*].contextWindow` or `get_context_usage.maxTokens`; a resume reads the usage back from the transcript tail |
| `cost` | `get_usage.session` — the CLI's own five keys |
| `rate_limits` | `get_usage.rate_limits`; its `utilization` is already a percent |
| `effort`, `output_style` | `get_settings.effective` (left out when unset, as the CLI omits `effort`) |
| `prompt_cache` | counted off the stream per API request (one id, however many partial events): Σ cache reads / Σ all input, which is the CLI's `hitRatio` |
| `worktree` | the tab's own worktree, branch `worktree-<name>` |

Anything the wrapper cannot know is **left out, never invented**. It runs at **spawn** too (from
`_fetch_init_info`, fresh or resumed), because the TUI draws its bar before the first message and a
fresh conversation here had none; and right after `get_usage` rather than behind the slow
`get_context_usage` (§9 of control-protocol.md), with a second run if that names a window.
`thinking` and `vim` are not sent. Re-read `fKn` after a CLI upgrade: it is the contract.

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
**2026-09-29 (pcg-e11), after claude.ai/code:** a row now has four actions: ⧉ copy, ↺ back into
the prompt (the old ✕ behaviour), ✕ delete, and «الان بفرست», which is `/api/interrupt`: since
2026-08-31 an interrupt keeps the queue, so the running turn ends and the queue runs at once. A
delete marks the row's **own** entry (`discard`), because the CLI's `cancelled` event can beat the
HTTP reply and it hands the text back; `state` is the focused conversation and a click need not be
in it. The paragraph below describes the cancel request both ↺ and ✕ use.

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

## Message marks: copy, pin, when, and the turn's change card (2026-09-29, pcg-8ip)

After claude.ai/code, both editions. Under each message on hover: **⧉ copy** (the message's
*source* text, markdown and all), **pin**, and **when** («۹ دقیقهٔ پیش», the exact moment in the
`title`). Pinned messages list in a **rail** of dashes at the top of the transcript; hovering it
opens «شروع گفتگو» plus one row per pin, and a click scrolls there and flashes the message. At the
end of every turn that edited files, one **change card** «N فایل ویرایش شد  +A −D», one row per
file, each opening that file's last edit card. Read-aloud was not built (user decision: Persian
TTS is not good enough). `js/marks.js` is a leaf and byte-identical in both editions.

**Every fact comes from the message, never from the render** (frontend-modules.md §"A reload
RE-RENDERS every finished turn"). Measured with a free bogus-model probe (`total_cost_usd: 0`):

- a **user** message is written to the transcript under the uuid `send_blocks()` minted, so the
  live `user_echo` uuid and the replayed record's uuid are the same key. `user_echo` now also
  carries a server-side `timestamp`;
- a live **assistant** event carries its transcript record's `uuid` and `timestamp`, so the same
  key works live and in replay. `_normalize_transcript_event` copies both onto replayed events
  (`_marks_of`).

The time is re-formatted on every hover, so it never freezes at render time and a replayed message
is never «همین حالا». The card is summed from the Edit/Write/MultiEdit `tool_use` inputs (the same
`diffOf()` the tool card draws), which both sources carry. Subagent text
(`parent_tool_use_id`) is not marked.

**Pins are the wrapper's, not the CLI's.** `pins.json` next to `server.py` (git-ignored, the same
store as `pinned.json`), `{session_id: [{uuid, label}]}`, behind `GET/POST /api/pins`. Both ids
pass `MARK_ID_RE`, and the label is capped at `PIN_LABEL_MAX`. A redeploy keeps it because the
source tree has none to copy over.

Three things cost time:

- **The words are CSS, not text.** The copy glyph, the time and every rail label are
  `::before { content: attr(data-…) }`. As text nodes they entered the message's `textContent`,
  which `/export`, the loop fold and the spec cases all read. Three spec cases went red on «⧉»
  and «پیش» before the switch.
- **An async result must not hold `state`.** Render scopes are copied in and out of the shared
  `state` by `withRenderTarget`, so a `/api/pins` answer that lands later would write into
  whichever conversation is current by then. Pins live in module-level maps keyed by session id.
  Every `.log` carries `dataset.sid` (stamped in `setStatus`), and a pin click reads its session
  from `el.closest(".log")`.
- **Every render scope needs `turnEdits`.** The harnesses build scopes by hand, so the tally
  starts with `state.turnEdits ??= new Map()`. Without it the spec harness never ran.

Gate: `test_marks.py`, **29** checks over both editions, route-stubbed. It includes a *measured*
left-to-right check of every `+A −D`, because a `textContent` assertion is blind to BiDi.
Negative-tested: dropping the settle flush, `setPinned`'s class toggle, or the stats' `dir=ltr`
each fails it.

### The four follow-ups (2026-10-04, pcg-lw0, web 1.7.0 / terminal 0.7.0)

From `wiki/claude-ai-code-reference.md`, all four, both editions, user decisions in brackets.
All the shared parts are in `marks.js`, so it stays one file.

- **The row under a turn's last answer is always drawn** (`markTurnEnd`): in flow, muted, no
  hover. A turn ends at the one boundary both sources share, `flushEdits()` (the next user
  row, the settle, the end of a replay), so the mark is the first line of that function, before
  its early return. Only the last decorated answer AFTER the last user row is marked, so a turn
  that ran tools and said nothing does not re-mark the previous turn's answer.
- **A change-card row opens that file's edits beside the transcript** [the turn's own edits,
  not git; beside, not over]. `state.turnEdits` keeps each edit's `{name, input}`, and the panel
  draws `renderDiff(diffOf(…))` per edit, so it always agrees with the card's `+A −D`, needs no
  repository and replays identically. `openDiff()` puts `section.diff-side` AFTER `.log` and
  gives `.log` a 50 % inline-end margin (left, in RTL); the panel is absolutely placed over that
  half, its top and height copied from the log's box and kept there by a `ResizeObserver`. No
  wrapper element around `.log` on purpose: the last time a pane's display changed, the prompt
  vanished. Under 640 px of pane (`@container`) the panel covers the log. ✕ and Esc close it;
  `park()` closes it when the pane changes conversation; a transcript that was following its
  bottom keeps following it across open and close.
- **Image thumbnails above the user bubble.** A replayed turn's image is in the transcript, so
  it is a `data:` URL. A live send names a file on disk, so `user_echo` gained `image_urls`:
  `GET /api/image?path=` serves **only** paths `build_message_blocks()` base64'd into an image
  block of a message the CLI then took (`SENT_IMAGES`, per process, filled after
  `send_blocks()` succeeds), never an arbitrary file; at serve time the path must still resolve
  to itself and still be within `MAX_IMAGE_BYTES` (a review found a swapped-in link or a grown
  file would otherwise be served). `test_units.py` checks the refusal before the send, for the
  file's neighbour, and for a file over the cap. No lightbox (the
  reference did not open one). 160 px tall, capped at `30cqh` in a small pane.
- **A long message is clipped at 15 lines** (`foldLong`, was 8 lines / 600 characters in the
  terminal edition only): > 15 lines or > 1200 characters, counted on the text so a background
  pane and a reload fold the same, a fade and the site's «بیشتر» chip. The web edition gained
  the fold and its two strings.

Gate: `test_marks.py` **50** (25 per edition run; was 30), each new check measured rather than read (the panel's
rect against the log's, the thumbnail's 160 px and its position above the bubble, the clip's
`scrollHeight`). Negative-tested by sabotaging all four in `marks.js` at once: 8 checks fail.

## claude.ai/code parity: the transcript, the tasks panel, the send button (2026-09-29, pcg-368)

The references were the user's screenshots of this project's own claude.ai/code session and a
full measured pass of that page from a session on the user's PC (`claude-ai-code-reference.md`),
plus the CLI's rules read out of the 2.1.284 binary (`tui-transcript.md`). Plan and phases are
in `CLAUDE-AI-PARITY.md`. Both editions unless noted.

**A run is one line.** Every step between two sentences joins one shut `details.run` (classes
`card tool group run`, built by hand in `openRun()`, because `card()` would route it back
through `toolHome()`). Its line is `activity()`, which uses the site's vocabulary:

- one part per kind, in the order each kind was first used, past tense;
- one file is named (a `<bdi>`, from the card's `data-target`) and several are counted;
- `+A −D` when the run edited (`data-added`/`data-removed`);
- «(N ناموفق)» when a step failed (`noteRunError`, marking `data-failed`);
- «از N ابزار استفاده شد» for anything unnamed, MCP included;
- a lone shell step shows its own `description`, the site's «Committed P1».

A background task's notice (`.agent-note`) joins the run as «کار پس‌زمینه تمام شد». The
polling-loop fold now pairs [sentence][run holding exactly one step].

**Thinking draws nothing until it has text.** 620 of 755 thinking blocks in a real session
were signature-only; each used to be a «در حال فکر کردن» card. A thought with text is an
uncounted step. A replayed `thinking` part now renders too, so live and replay agree: before
this, live drew the empty cards and replay drew none.

**The working line is live only.** It shows the spark, `time · tokens`, the «N کار در حال اجرا»
chip (`setRunningTasks`, fed by `agents.js`), then the phase. It is **removed** when the turn
ends. The CLI keeps a `✻ Worked for …` record there; the site does not, and the user read it
as noise. The reload defects it used to have (a re-rolled verb, a «۰ ثانیه» clock) are gone
with it. «Esc برای توقف» (`spinnerInterrupt`) is its tooltip now.

**The Background tasks panel** (`#tasks-panel`, a `[popover]` at the stage side, with the
same inset rules as `#agent-drawer`):

- Running cards show the title, «عامل · ۲ دقیقه», the model, tokens, tool uses and the
  current step. The numbers are `system/task_progress` (`usage.total_tokens`, `tool_uses`,
  `last_tool_name`), which nothing read before; `noteTaskProgress()` keeps them per task id.
- «دیدن گزارش» opens the per-agent drawer.
- The stop square sends `stop_task {task_id}`, which is now on `CONTROL_ALLOWED`.
- «پایان‌یافته N» is folded, and the trash wipes that list client-side.
- The strip above the composer is only the chip, and only while helpers run after the turn.
- `/tasks` opens the panel.

**Terminal edition only — the button at the end of the box.**

- It is send ↵, or stop ⊙ while a turn runs and the box is empty.
- Mid-turn, hovering send offers «بفرست» (now, into the running turn, which is what the CLI
  does with a mid-turn message) and «بعداً بفرست» (Ctrl+Enter).
- A held message waits client-side in `.later-strip`. One is posted per finished turn, and its
  row's × puts the text back.
- The web edition keeps its own composer buttons.

**The bar (P1).**

- The state line no longer repeats the mode or the model.
- The mode chip falls back to the CLI's `permissionMode`.
- The audit count is the mode menu's footer. The CLI has no auto-approval counter at all.
- Models are shown as the newest of each family, with «مدل‌های دیگر ›» opening the rest in a
  flyout. The flyout is a `position: fixed` child *inside* the menu popover, so it neither
  light-dismisses the menu nor is clipped by it.
- The menu check is the site's blue.

Gates:

- spec: terminal 202, web 220;
- `test_bar`: 45 across both editions (the button's six checks are terminal-only);
- `test_column`: 29;
- negative-tested: an empty-thinking card, a leftover working line, a missing `task_progress`
  route and a missing Ctrl+Enter branch each fail a gate.

## VS Code extension parity: five gaps closed (2026-10-04, pcg-ahh)

After a feature-by-feature comparison with the Claude Code VS Code extension (its docs at
code.claude.com/docs/en/vs-code; the marketplace is unreachable from the cloud container), the
user picked five. Terminal edition unless noted. Gate: `test_parity.py` (28, each section
negative-tested).

1. **Session search and rename.** A field above the sidebar filters every project's conversations
   (archived ones too) into one flat, newest-first list, each hit naming its project. Matching
   folds ي/ی, ك/ک, the half-space and case — a Persian name typed on an Arabic layout must
   still find itself. Rename is in the conversation's ⋯ menu, edited in place.
   `POST /api/session/rename` asks a RUNNING CLI (`rename_session`, which writes the record
   itself — two writers on one transcript is the corruption delete refuses) and otherwise appends
   the same `{"type":"custom-title",…}` line the CLI would have, so `claude --resume` shows the
   name too. Renaming a live session also sets `_titled`, or the first-prompt title would win
   after the next result.
2. **The Questions row, and «۲ از ۵».** An answered question's card shuts and one row stays
   under it: each question, then the pick. Replay needed a server fix to show it at all: the
   transcript writes the structured answer as `toolUseResult`, the live stream as the event's
   `tool_use_result`, and `_normalize_transcript_event` dropped it — so every replayed answer had
   been the model-facing English sentence. It is passed on now for that shape only. The line's
   direction is the QUESTION's: both children carry their own `dir`, so `dir="auto"` on the line
   read nothing and fell to LTR (a spec case caught it). Stacked permission requests count their
   place in the run, «۲ از ۵», from the first that arrived while none was open.
3. **«تأیید همه», not «خودکار»** (both editions). The window's approve-every-request posture had
   the name of the CLI's Auto mode, which the window deliberately leaves out because it skips the
   dialog — and the state line literally said «حالت خودکار روشن». The CLI's own `auto` echo keeps
   that name; the posture got `slPostureAutoApprove`.
4. **A new conversation from a message.** The fork button under a message (marks.js, shared;
   the web edition passes no handler, so it draws none). From an answer the copy keeps everything
   through it; from something the person said it keeps what came before, and the words go back
   into the new prompt — the CLI's /rewind, without cutting the original. The CLI does the cut
   (`--resume-session-at`, measured: `wiki/cli-stream-json-findings.md`); the window draws the
   new column from the SOURCE transcript cut at the same uuid, because a forked CLI re-emits
   nothing. The pane a message is drawn in names its conversation (`cells` hold no `data-tab`).
   Before the first message there is nothing to keep, so that is a plain new conversation.
   Files are not rewound.
5. **Focus view** (`focus.js`, Ctrl+Alt+F or `/focus`). Each turn's process rows — runs,
   helper cards, older to-do lists — fold behind its first one, which keeps its place and says
   «۷ مرحله»; a click opens that turn in place. Nothing is moved or wrapped: the renderer's
   polling fold compares `nextElementSibling`, so a marker element would have broken it; focus
   only writes classes and one `data-focus-label`, repainted from scratch one frame after any
   append. AltGr is Ctrl+Alt on a Windows keyboard, so the chord backs off when `AltGraph` is held.
   The preference lives in `prefs.js`, i.e. for the life of the window (the port, and so the
   origin, changes every run). `/focus` left V2-PLAN §4 the same day.
