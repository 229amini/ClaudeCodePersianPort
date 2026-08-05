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
