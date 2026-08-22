# CLI stream-json findings — plan §B-9 spikes

**Tested against `claude` 2.1.221**, native install at `C:\Users\ladyg\.local\bin\claude.exe`,
on Windows 10 Home 19045, 2026-08-04. Every answer below is version-pinned — re-verify after a
CLI upgrade.

## 2.1.240 re-verification (2026-08-23, author PC)

Probed with the wrapper's exact flags (free: `initialize`, `set_permission_mode plan`,
`get_context_usage`, empty-session `/recap`) plus one paid smoke turn. **The contract holds** —
spec 147/147, units, smoke 15/15, no code change needed for the upgrade itself. Drift found,
all absorbed by existing design:

- **New event: `system/thinking_tokens`** (seen ×6 in one smoke run). The renderer's `system`
  case handles only `init`/`status` and silently drops the rest, so it costs nothing. It is NOT
  an unknown top-level type, so no raw-JSON card either.
- **`result` gained keys**: `subagent_stats`, `fast_mode_state`, `fast_mode_disabled_reason`,
  `modelUsage`, `uuid`. Nothing reads them; nothing broke.
- **Output styles now include `Concise`** — the chip mirrors
  `initialize.available_output_styles`, so it appeared by itself.
- **Models list gained `claude-fable-5[1m]`** (supportsEffort true); `haiku` still the only one
  without `supportsEffort`. Mirrored, not hardcoded — picker updated by itself.
- `initialize.commands` is 61 entries (was 60 on 2.1.234); `/recap` still present,
  `supportsNonInteractive` unchanged, and the empty-session refusal string is byte-identical
  (`RECAP_NON_ANSWERS` still valid).
- Transcript records: `user` lines now carry `origin: {kind}` / `promptSource`; new
  `atis-latch` / `ai-title` record types. All filtered by type in `read_session` already.
- **`/recap` drift, minor:** the 2.1.235 finding said the recap turn is never written to the
  transcript. On 2.1.240 the *send* IS recorded (`user` + `system/local_command` records —
  measured in the probe cwd); the CLI's answer still is not, and `read_session` filters both
  record shapes anyway, so nothing leaks into replay.
- **An idle spawn writes no transcript; an idle `--resume` costs nothing.** Measured: a bare
  spawn (no input, killed after use) leaves no `.jsonl` at all, and a `--resume` left idle for
  12 s emits only the SessionStart `hook_started`/`hook_response` pair — zero inference-shaped
  events (`assistant`/`result`/`stream_event`/`rate_limit_event`). It does rewrite the
  transcript (+~170 bytes of spawn records, mtime bump — the known spawn-rewrite the sidebar
  sort ignores). Tokens are spent per turn only; merely opening and closing a session is free,
  regardless of how long ago it last ran.

The user-reported "finished session still says thinking" was NOT 2.1.240 drift — it was the
documented-unfixed SSE reconnect replay (parity-chrome.md §"The third way"), fixed the same day
with a `Last-Event-ID` cursor on the Hub.

## B-9.1 — `--verbose` is REQUIRED

Without it:

```
Error: When using --print, --output-format=stream-json requires --verbose
```

Working invocation:

```
claude -p --verbose --output-format stream-json --input-format stream-json
```

Exit 0, full NDJSON round-trip confirmed. Stdin can be a plain pipe; one NDJSON line in, full
event stream out. Input message shape that works:

```json
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"..."}]}}
```

## B-9.2 — `--include-partial-messages` EXISTS

Token streaming is available. The plan's per-message fallback is not needed. Help text:
*"Include partial message chunks as they arrive (only works with --print and
--output-format=stream-json)"*.

## B-9.3 — PERMISSION ARCHITECTURE IS INVALIDATED

**`--permission-prompt-tool` does not exist on 2.1.221.** It is absent from `--help`. Plan §B-5
mechanism (1) — the "assume this works" default — is dead. So is `permission_mcp.py` in the §B-1
file layout.

Mechanism (2) — control-protocol permission requests over the stream-json channel — **also does
not happen**. Tested with `--permission-mode manual` and a Write tool call. The CLI does not emit
any permission request event. It silently auto-denies and injects a synthetic error tool_result:

```json
{"type":"user","message":{"role":"user","content":[{"type":"tool_result",
 "is_error":true,"tool_use_id":"toolu_...",
 "content":"Claude requested permissions to write to <path>, but you haven't granted it yet."}]}}
```

The assistant then gives up and ends the turn. The file was not created. There is no channel to
approve on. **A GUI approval dialog cannot be built this way.**

`--permission-mode` accepts: `acceptEdits`, `auto`, `bypassPermissions`, `manual`, `dontAsk`,
`plan`.

### The replacement: a PreToolUse hook — VERIFIED WORKING

Same denied scenario (`--permission-mode manual`, Write tool), but with a `PreToolUse` hook
injected via `--settings`: **the file was created**. The hook's decision overrides the auto-deny.

Hook returns on stdout:

```json
{"hookSpecificOutput":{"hookEventName":"PreToolUse",
 "permissionDecision":"allow",
 "permissionDecisionReason":"approved via GUI"}}
```

`permissionDecision` also takes `deny` and `ask`. This is the permission architecture. Replace
plan §B-5 mechanisms (1) and (2) with it, and drop `permission_mcp.py` from the §B-1 layout —
the broker is a hook script, not an MCP server.

Inject it with `--settings <file>` so the wrapper never edits the user's real
`~/.claude/settings.json`. Verified shape:

```json
{"hooks":{"PreToolUse":[{"matcher":"Write",
 "hooks":[{"type":"command","command":"powershell -NoProfile -ExecutionPolicy Bypass -File \"<path>\""}]}]}}
```

**Payload the hook receives on stdin** — this is the Persian dialog's data source:

```json
{"session_id":"...","transcript_path":"...","cwd":"...","prompt_id":"...",
 "permission_mode":"default","effort":{"level":"xhigh"},
 "hook_event_name":"PreToolUse","tool_name":"Write",
 "tool_input":{"file_path":"...","content":"HELLO\n"},
 "tool_use_id":"toolu_01Dyb3LFAfwX4ZWZny648Wan"}
```

Two things that make the GUI easy:

- **`tool_use_id` is the join key.** The same id appears in the `assistant` / `tool_use` event on
  stdout, so the dialog attaches to the exact tool card already rendered. No guessing.
- **`session_id`** routes the request to the right open project when several are running.

Caveats found:

- `permission_mode` inside the hook payload read `"default"` even though the CLI was launched
  with `--permission-mode manual`. Do not trust that field; track the mode the wrapper passed.
- **PreToolUse hooks are NOT echoed on stdout.** `SessionStart` produced
  `hook_started`/`hook_response` events, but the PreToolUse hook produced none. The wrapper
  learns about a pending permission only from the hook process itself, so the hook must be the
  one that calls the server. Blocking flow: hook → POST to server → server pushes dialog over
  SSE → user answers → server responds to the hook's request → hook prints the decision.
- The hook blocks the CLI while it waits. Needs a timeout and a safe default (deny) so a closed
  window cannot wedge the subprocess forever.

## Undocumented event types seen on the wire

Plan §B-3's table is incomplete. Also observed:

| Event | Contents |
|---|---|
| `system/hook_started` | `hook_id`, `hook_name`, `hook_event` |
| `system/hook_response` | `output`, `stdout`, `stderr`, `exit_code`, `outcome` |
| `system/status` | seen once per turn |
| `stream_event` | token deltas from `--include-partial-messages`; inner `event.type` is Anthropic-API shaped (`content_block_delta` with `delta.text`) |
| `rate_limit_event` | `status`, `resetsAt` (unix), `rateLimitType` (`five_hour`), `overageStatus` |

`rate_limit_event` is genuinely useful for the statusline — it carries the 5-hour window reset.
The unknown-event fallback card is already justified by this.

## `system/init` payload (richer than the plan assumed)

Beyond `session_id` / `cwd` / `model` / `tools`: `permissionMode`, `slash_commands` (full list —
**feeds the composer's `/` autocomplete directly, no need to scan skill dirs as plan §B-6
suggested**), `skills`, `agents`, `plugins`, `mcp_servers`, `output_style`,
`claude_code_version`, `memory_paths`, `apiKeySource`, and:

```json
"capabilities":["interrupt_receipt_v1","interrupt_cancel_queued_v1","msg_lifecycle_v1"]
```

Those capability strings are the interrupt mechanism for the stop button (plan §B-7). Note there
is **no permission capability advertised** — independent corroboration of the B-9.3 result.

`permissionMode` came back `"default"` on this machine, not the `"auto"` the options doc recorded
for the author's PC. Read it from `init`, never assume.

**`init` does not arrive at spawn.** Observed arrival order on a cold start:
`hook_started` → `hook_response` → *(first user message written to stdin)* → `init` → `status` →
`stream_event`… → `assistant` → `rate_limit_event` → `result`. The CLI waits for stdin input
before emitting `init`, so `session_id`, model, and the slash-command list are **not available
until the first turn completes**. The statusline must tolerate an empty state on a fresh window,
and `--resume` recovery cannot be armed until turn one has happened.

> **Superseded in part, 2026-08-05.** The above is still true of the `init` *event*, but it is no
> longer a limitation: a `control_request` with subtype `initialize` answers at spawn, for free,
> with a **richer** command list (descriptions + argument hints) plus the account's model list.
> `session_id` still requires turn one. See [control-protocol.md](control-protocol.md).

## `result` event payload

`total_cost_usd`, `usage` (input/output/cache tokens, per-model breakdown, `contextWindow`,
`maxOutputTokens`), `duration_ms`, `duration_api_ms`, `num_turns`, `ttft_ms`, `stop_reason`,
`terminal_reason`, `permission_denials[]`, `result` (final text), `is_error`, `subtype`.

Everything the statusline needs (cost, context usage, permission mode) is available.

## B-9.6 — ZWNJ survives the round-trip

Sent `می‌رود` (with `U+200C`) from the composer through `/api/message` → stdin NDJSON → CLI →
stdout → renderer. It came back byte-identical, `U+200C` intact, in both the echoed user bubble
and the assistant reply. Nothing in the pipeline treats zero-width characters as whitespace.

Requires `json.dumps(..., ensure_ascii=False)` on the way in and `encoding="utf-8"` on the
subprocess pipes — both are in `server.py`.

## B-9.7 — session_id is stable across turns

Two turns over one long-lived process kept `session_id` `d1f409a3…` unchanged, and cost
accumulated across them ($0.1305 → $0.1492). The "one process per project, a turn is one NDJSON
line" design in plan §B-0 holds.

## Encoding gotcha

Running the CLI through a PowerShell **background job** mangled non-ASCII on the way back — an
em dash came out as `ظ¤`. The same text was clean when piped directly in the foreground. This is
PowerShell job/console encoding, not the CLI. Consequence for the build: `server.py` must pin
`encoding="utf-8"` explicitly on the `subprocess` pipes in both directions and never rely on the
platform default, or Persian will corrupt in transit.

## The CLI's context messages: which are fatal and which take themselves back

Read verbatim out of the shipped bundle (`C:\Users\Lion\.local\bin\claude.exe`, 2026-08-18) after
users reported «حافظه گفتگو پر شد» flashing up mid-work and clearing itself (bead pcg-63y). The
wrapper's `CONTEXT_EXHAUSTED` regex in `render.js` had `context low` in it, and that message is a
**warning the CLI redraws every frame**, not an outcome.

**Fatal** — the turn produced nothing and no percentage arrives with it, which is why the notice
has a second door at all:

```
Context exceeds the ${n}-token limit by ${m} tokens — run /compact or /clear to continue.
Context limit reached · /compact or /clear to continue
prompt is too long   /   input is too long for requested model
```

The middle one is the CLI's own `context_limit` error, whose `errorCode` is
`cleared_context_limit` — it clears the conversation. The last pair is what the bundle's own
overflow detector tests for (`t.includes("prompt is too long") || t.includes("input is too long
for requested model")`).

**Warnings, self-clearing** — never raise the panel:

```
Context low (${pct}% remaining) · Run /compact to compact & continue
Context is ${n} tokens past the ${m}-token compaction window — run /compact to continue.
```

The load-bearing detail: **neither warning says "/compact or /clear"**. That phrase appears only in
the two fatal messages, which is what makes it safe to keep as the loose drift catch-all while
matching nothing transient. The percentage-driven notice (`composer.js noteContext`, fed by
`get_context_usage`) is what covers the warning half — it is dismissible and re-arms itself, which
is the behaviour a warning is allowed to have.

Also here, since it is the same family and is easy to mistake for a limit message:

```
Autocompact is thrashing: the context refilled to the limit within 3 turns of the previous
compact, 3 times in a row. …
```
