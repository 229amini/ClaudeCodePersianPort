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

## 2.1.241 (2026-08-25, `ladyg` PC) — same contract

The CLI auto-updated itself 2.1.240 → 2.1.241 minutes after `setup.ps1` probed it (setup logged
`2.1.227`, the pre-update binary; `claude.exe.old.*` is left behind in `~/.local/bin`, so a
version printed by setup is only as fresh as the moment it ran). Smoke re-run against 2.1.241:
**15/15 PASS**, no drift beyond 2.1.240 — `initialize` now reports **5 models / 66 commands**
(was 61 commands), `system/thinking_tokens` still emitted (×5) and still dropped. Nothing to
change.

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

---

## The message queue: one `result` does not mean one send (2.1.241)

Read out of the 2.1.241 bundle and confirmed against a real transcript
(`~/.claude/projects/D--Project/e9ecc3c6-…jsonl`) on 2026-08-24. This is the contract behind the
reported "it still says it is thinking after it finishes".

**A mid-turn send is FOLDED into the running turn.** It does not become a turn of its own. The
transcript records the whole life of one:

```
516  23:36:12  {"type":"queue-operation","operation":"enqueue"}
521  23:36:12  {"type":"attachment","attachment":{"type":"queued_command","prompt":[…],
                "commandMode":"prompt"}}          ← delivered beside the next tool_result
522  23:40:17  {"type":"queue-operation","operation":"remove"}
```

The CLI says it itself, in a comment beside `cancel_queued`: *"it never runs as its own turn."*
There is a second merge path too — several prompts already in the queue drain into **one** turn at
turn start (`lA.length > 1 → merge`, each contributing uuid still getting its own `started`).

Consequence: **N sends can produce ONE `result`.** Any wrapper that counts sends and decrements per
result leaks upward for the life of the session. Nothing on our stream names the fold: the SDK only
echoes those prompts under `--replay-user-messages`, which we do not pass.

**There is an exact replacement, and it needs one field from us.** In `-p`/SDK sessions the CLI
emits, on stdout:

```json
{"type":"command_lifecycle","command_uuid":"…","state":"queued","uuid":"…","session_id":"…"}
```

- `command_uuid` is **the client-supplied `uuid` on the inbound message**. The schema is explicit:
  *"Commands enqueued without a uuid … emit no lifecycle events."* We send none today, so the
  channel is simply off. The value must match `^[0-9a-f]{8}-[0-9a-f]{4}-…` — `uuid.uuid4()` does.
- States: `queued` → `started` → exactly one of `completed` / `cancelled` / `discarded` / `refused`.
- **Ordering against the `result` frame is per-path**: a command that starts a fresh turn emits
  `completed` **after** that turn's result; a command **folded** into an in-flight turn emits
  `completed` **before** it.
- Holes the schema documents, so a backstop is required rather than optional: a turn that fails by
  throwing can leave `started` with **no terminal state**; a dropped message can leave `queued` with
  none; internally-enqueued commands mint their own uuid and skip `queued`; and *"on process exit a
  wrapper should synthesize `discarded` for uuids it has not seen reach a terminal state."*
- `cancelled` is also what a *user-requested* removal looks like, so it is not by itself a failure.

**`interrupt` does not cancel the queue unless asked.**

> "queued commands survive the interrupt and are listed under `still_queued` … A
> Stop-means-stop-everything client (a remote UI's Stop button) sets this true so one round-trip
> halts the session; a wrapper that wants per-uuid control leaves it false and follows up with
> `cancel_async_message`. … older CLIs ignore the field and behave as if false."

So `{"subtype":"interrupt","cancel_queued":true}` is what this window wants, and the **response**
carries `cancelled[]` and `still_queued[]`. `interrupt(wait=False)` throwing that receipt away is
why `_reset_inflight()` after a stop is an assumption, not a fact.

**Resolved 2026-08-24.** `interrupt()` now reads the receipt (`server.py _settle_interrupt()`, off
the reader thread so the HTTP handler never blocks on it) and closes only the uuids it names
`cancelled`; `still_queued` uuids are left alone because they will run and report for themselves.
`_reset_inflight()`/`_inflight` are gone outright, replaced by the uuid ledger (`_outstanding`) —
see wiki/parity-chrome.md §"The queue strip" and §"the receipt settles the ledger" in
`test_units.py`. No receipt at all (an older CLI, a timeout) still falls through to the silence
backstop, unchanged.

Two things about this measured only as far as the bundle and a fake CLI go, not on the wire:

- The interrupt receipt is read as `response.response.cancelled` — a nested envelope
  (`control_response.response.cancelled`, since the outer `response` is the control-protocol
  wrapper and the inner one is the interrupt's own payload). If a future CLI build flattens that
  shape, `_settle_interrupt()` finds nothing to act on and falls back to the quiet window silently
  — no error, just a slower settle. Re-check this shape after any CLI upgrade.
- `probe_queue.py` does not drive an interrupt at all (its payload is `/recap` on an empty
  session, chosen because it is free) — the receipt path above is fake-CLI-tested only
  (`test_units.py`), never verified against a live process. The folded command's `started`-before-
  `result` ordering claimed earlier in this section is likewise still bundle-read, not
  wire-measured — it would need a paid turn with a message sent mid-turn to confirm.

**`cancel_async_message`** — `{"subtype":"cancel_async_message","message_uuid":"…"}` →
`{"cancelled": bool}`. *"Drops a pending async user message from the command queue by uuid. No-op
if already dequeued for execution."*

**Capabilities**, advertised on `system/init` — gate everything above on them rather than on a
version string: `msg_lifecycle_v1`, `interrupt_receipt_v1`, `interrupt_cancel_queued_v1`.

**The replay consequence, and it is data loss.** The folded prompt is written to the transcript
**only** as that `attachment` / `queued_command` record — there is no `user` line for it anywhere in
the file (verified by grepping the real transcript for the prompt text: one hit, line 521, an
attachment). `read_session()` keeps user/assistant lines and drops the rest, so refreshing the
window erases a message the user actually sent while the answer to it stays on screen.

Tracked as `pcg-tyy` and its children.

### Measured on the wire, 2.1.241, 2026-08-24 (`probe_queue.py`, PASS 8/8, `total_cost_usd = 0`)

Everything above was read out of the bundle; this is the same contract driven against a live CLI
spawned with our exact `CLAUDE_ARGS`. The probe is free because its payload is `/recap` on an empty
session, which refuses locally — re-run it after every CLI upgrade.

```
send  {"type":"user","uuid":"ba2f40f9-…","message":{"role":"user","content":[{"type":"text","text":"/recap"}]}}

recv  command_lifecycle  state=queued     command_uuid=ba2f40f9-…
recv  command_lifecycle  state=started    command_uuid=ba2f40f9-…
recv  system/init
recv  assistant
recv  result             subtype=success  total_cost_usd=0  "Nothing to recap yet — send a message first."
recv  command_lifecycle  state=completed  command_uuid=ba2f40f9-…
```

- **The uuid goes at the TOP LEVEL of the user frame**, beside `type` — not inside `message`. That
  was the one thing still assumed; it is measured now.
- `queued → started → completed`, and for a command that starts a **fresh** turn `completed` lands
  **after** the `result`, exactly as the schema says. (A folded one lands before it — that half is
  still bundle-read, not wire-measured; it needs a paid turn.)
- The same frame with **no** `uuid` produced **no** lifecycle events at all. The channel really is
  opt-in per message.
- `cancel_async_message` with a uuid that was never enqueued answers `{"cancelled": false}` — free,
  and therefore the cheap way to prove the subtype exists on a future build.

**The capability list is on `system/init`, not on the `initialize` reply.** `initialize` answers
with `account, agents, available_output_styles, commands, current_permission_mode,
fast_mode_disabled_reason, fast_mode_state, ide_rc_auto_enable_gate, models, output_style, pid,
remote_control_auto_enable, remote_control_auto_on_by_default, session_state` — and
`capabilities: null`. `system/init` carries `capabilities` (with `msg_lifecycle_v1`,
`interrupt_receipt_v1`, `interrupt_cancel_queued_v1`) — **but it is not emitted until the first turn
starts**, as the trace above shows. So nothing may gate on capabilities at spawn time. Detect by
observation instead, and keep a backstop that works either way.
