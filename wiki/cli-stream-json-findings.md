# CLI stream-json findings — plan §B-9 spikes

**Tested against `claude` 2.1.221**, native install at `C:\Users\ladyg\.local\bin\claude.exe`,
on Windows 10 Home 19045, 2026-08-04. Every answer below is version-pinned — re-verify after a
CLI upgrade.

## 2.1.261 — V2-PLAN §5, the v2.1 probes (2026-09-05, author PC)

The binary self-updated again overnight, 2.1.260 → 2.1.261. It moved no keys (206 bindings, 25
contexts, unchanged) and no behaviour found here; it renamed two minified temporaries, which
`test_tui_vocab.py` caught and now ignores by design.

**All ten §5 probes are answered, and one the plan did not know to ask.** Method, in order of
preference: read the bundle at the construction site (free, exact, and it survives having no
login), then a live control request (free), and only then a turn. **Total spend for the whole
of v2.1: $0.107**, from one probe that turned out to be paid and is now pinned so nobody pays
for it twice. `probe_v21.py` re-runs the live half for free — 25/25.

`probe_v21.py` also fixed two ways of measuring wrongly, both of which had produced a
confident wrong answer first:

- **`result.total_cost_usd` is the SESSION total, not the turn's.** Summing it across a run
  bills every later phase for an earlier one's turn. The first run charged `/export` $0.107
  for a `side_question` that had run before it. Phases now take a *delta*.
- **`settle()` returns instantly if the CLI was already quiet.** After any previous phase it
  has been, so a command that answers in two seconds was recorded as answering never. Three
  local commands were written down as "emits no events at all" — they emit a full lifecycle.
  A probe now sleeps past the settle window before it is allowed to conclude silence.

### §5.1 `!ls` — the CLI will not run it (bundle)

`!` is a **TUI input mode, not a text prefix**. The input state is constructed as
`m = ize() && c.startsWith("!"); {query: m ? c.slice(1) : c, cursorOffset: …, mode: m ? "bash" : "prompt"}`
— the `!` is stripped and becomes a `mode` field, in a constructor that also builds a text
cursor, i.e. the TUI's own input state. A stream-json `user` frame carries no `mode`, so
**`!ls` over the pipe is literal text in mode `prompt` and reaches the model.**

What the TUI does with bash mode, and therefore what `/api/shell` must imitate: it runs the
command locally and injects the result into the conversation as a user message tagged
`<bash-input>…</bash-input>`, with `<bash-stdout>` and `<bash-stderr>` siblings
(`/^<bash-input>([\s\S]*?)<\/bash-input>/` is in the transcript reader). So **bash output does
enter the model's context** — `/api/shell` is not display-only, and to match the TUI it must
send the tagged text back as a user turn.

`#` memory mode is the same shape, tagged `<user-memory-input>` (§5.3).

### §5.2 `@README.md` — the CLI DOES expand it (bundle)

At-mention extraction is a pure text scan over the prompt, `Lps(e)`:

```
/(^|[\s\u3002\u3001\uFF1F\uFF01])@"([^"]+)"/g     @"path with spaces"
/(^|[\s\u3002\u3001\uFF1F\uFF01])@([^\s]+)\b/g    @path
```

with siblings for `@server:resource` (MCP), `@agent-name` / `@"name (agent)"` (subagents), and
a `#L10-20` line-range suffix. Its caller gathers `at_mentioned_files` alongside
`mcp_resources`, `agent_mentions`, `peer_mentions`, `queued_commands`, `todo_reminders`. The
**only** gates on that path are `CLAUDE_CODE_DISABLE_ATTACHMENTS`, `CLAUDE_CODE_SIMPLE`,
`options.bareFork` and `CLAUDE_CODE_EVAL_CONFINED` — **there is no interactive-mode gate**, and
the one sibling that *is* interactivity-gated (`peer_mentions`, on `isHumanTypedPrompt`) proves
the author writes that gate explicitly when they want it.

**Consequence:** v2 sends `@path` as plain text and the CLI attaches the file. `/api/files`
never needs to read file content.

### §5.3 `#note` — plain turn, `#` stays out (bundle)

Same mechanism as `!`: a TUI input mode whose product is a `<user-memory-input>` user message.
Nothing on the stream-json path builds it. V2-PLAN §4's decision to leave `#` out stands, and
now on a measurement rather than an assumption.

### §5.4 `side_question` — routed, and it COSTS A TURN (live, paid once)

```
request   {subtype:"side_question", question:"…", history?:[…]}
response  {response: string|null, synthetic: bool,
           refusal_fallback?: {original_model, fallback_model, content}}
```

The measurement that matters is not the schema, it is the price. Sent with **no** `question`
field, expecting the schema complaint every other malformed control request gives, it instead
**asked the model**, which answered «Question empty — no text came through. Ask again with
actual question.» That sentence is nowhere in the binary, which is how we know it was
generated. **$0.107.** There is no free negative probe for this subtype: nothing malformed gets
refused before the model sees it. Pinned in `probe_v21.py`; `--paid` re-measures.

It does **not** write the main transcript: the answer arrives only inside the
`control_response`, no `assistant` event carries it, and the TUI logs `[btw] panel mounted` —
it renders in a panel, not in the column. `/btw` in v2 is a side answer, as §2 assumed.

### §5.5 `--fork-session` — new id, same project (live, free)

`claude <wrapper flags> --resume <id> --fork-session`, then a free `/recap`:

| | |
|---|---|
| parent | `088497c9-fab6-4643-9d2f-0063884b4ad0` |
| fork | `03a867a6-8457-4275-9821-2a0e7b030e64` |
| project folder | the same `~/.claude/projects/<sanitized-cwd>/` |
| transcripts | one `.jsonl` each, both present |

**A fork mints a new session id in the same project.** `/branch` is buildable as a respawn, and
the sidebar sees the branch as a second session with no new code — it already lists every
transcript in the project folder.

### §5.6 rewind — there IS a control subtype. Two of them. (live, free)

V2-PLAN §4 leaves Esc-Esc rewind out *"unless the §5 probe finds a control subtype"*. It found
one, so that exclusion is **lifted pending a build decision**, not settled:

```
{subtype:"rewind_conversation", target_message_uuid:"<uuid>", interrupt_if_running?:bool}
  -> {rewound:false, prefillText:null, precedingAssistantUuid:null, error:"target not found"}
  -> {subtype:"error", error:"rewind_conversation: target_message_uuid must be a string"}

{subtype:"rewind_files", user_message_id:"<uuid>", dry_run?:bool}
  -> {canRewind:false, error:"File rewinding is not enabled."}
```

Both are routed on this build. `rewind_conversation` reaches its own logic and reports on the
uuid; the typed refusal names the parameter, which is a free schema read. `rewind_files` is
routed but **gated off** by a file-history feature this machine does not have enabled — so
conversation rewind is reachable and file rewind is not, and the two are separate subtypes.

The response shape is exactly what a window needs: `prefillText` is the rewound prompt to put
back in the composer, `precedingAssistantUuid` is where to truncate the column.

The TUI's `MessageSelector` context (15 bindings, `wiki/tui-keys.md`) and the string
«Double-tap esc to rewind the conversation to a previous point in time» are the UI on the other
end of these.

### §5.7 `/export`, `/copy`, `/resume` — refused locally, for free (live, free)

All three, plus an invented `/nonesuch-probe`, answer **without reaching the model**:

| Sent | Answer | Spent | Lifecycle |
|---|---|---|---|
| `/export` | `/export isn't available in this environment.` | $0 | queued → started → completed |
| `/copy` | `/copy isn't available in this environment.` | $0 | queued → started → completed |
| `/resume` | `/resume isn't available in this environment.` | $0 | queued → started → completed |
| `/nonesuch-probe` | `Unknown command: /nonesuch-probe` | $0 | queued → started → completed |

The bundle's branch: `options.isNonInteractiveSession && AI().has(d)` →
``` `/${…} isn't available in this environment.` ``` with `shouldQuery:!1` and telemetry
`cmd_unavailable_headless`, wrapped in `<local-command-stdout>`. The longer form is
«… opens an interactive panel and isn't available in this environment. Run it from the Claude
Code terminal instead.»

Two things follow. **They are window-local, as §3.5 says** — the CLI will not do them. And
**the uuid ledger always closes**: every one of them runs the full lifecycle, so v2's spinner
ends on the event rather than waiting for the silence watchdog.

### §5.8 `~/.claude/history.jsonl` — shape confirmed, and it is not append-only (free)

8,674 lines on this PC. Every line:

```json
{"display":"<the prompt, verbatim>","pastedContents":{},
 "timestamp":1788564003407,"project":"D:\\Project\\Example",
 "sessionId":"<uuid>"}
```

`timestamp` is epoch **milliseconds**; `project` is the absolute cwd; `pastedContents` is an
object, `{}` when there is none.

**The part the plan did not know:** the CLI **rewrites** this file. It runs a retention prune
that takes a lock and rewrites the whole thing, and it says so in its own error strings —
«History retention prune deferred: history.jsonl changed under the scan», «history.jsonl was
rewritten under the head an earlier scan judged», «the history lock could not be acquired». The
lock is a sibling built as `` `${path}.lock` `` (proper-lockfile, directory-based).

So the §5.8 conclusion is *not* "append a line and you are done". A blind append during a
prune rewrite is a lost line, or worse. **v2 must take `history.jsonl.lock` before appending.**

The remaining half of §5.8 — append a line, open the real TUI, press Up — needs an interactive
terminal and a human, and is the one probe that cannot be automated from here.

### §5.9 `/compact` — the event shape, from the construction site (bundle)

```json
{"type":"system","subtype":"compact_boundary","session_id":"…","uuid":"…",
 "compact_metadata":{"trigger":"…","pre_tokens":N,"post_tokens":N,
                     "cumulative_dropped_tokens":N,"duration_ms":N,"user_context":"…",
                     "messages_summarized":N,"precomputed":…,
                     "pre_compact_discovered_tools":…,"preserved_segment":…}}
```

Only `trigger` and `pre_tokens` are always present; everything after is spread conditionally.
The TUI's own content string for it is `"Conversation compacted"`, level `info` — which is the
string `wiki/tui-strings.md` already translates as «گفتگو فشرده شد». §3.1's divider can render
from data without a paid compaction run.

### §5.10 background tasks — they DO emit on the pipe, so `/tasks` is buildable (bundle)

The plan budgeted a paid turn for this. It was not needed; the emit sites are all in the
bundle, and they are a whole family:

```json
{"type":"system","subtype":"background_tasks_changed",
 "tasks":[{"task_id":"…","task_type":"…","description":"…","ambient":true}]}

{"type":"system","subtype":"task_started","task_id","tool_use_id","description",
 "subagent_type","owned_by_subagent","is_backgrounded","spawn_depth"}
{"type":"system","subtype":"task_progress","task_id","tool_use_id","description",
 "subagent_type","usage":{"total_tokens","tool_uses","duration_ms"},
 "last_tool_name","summary","workflow_progress"}
{"type":"system","subtype":"task_notification","task_id","tool_use_id","status",
 "output_file","summary","usage","resource_links","skip_transcript"}
{"type":"system","subtype":"task_summary","detail": … | null}
```

and a control request to kill one: `{subtype:"stop_task", task_id}` (plus
`{subtype:"background_tasks", tool_use_id}` → `{backgrounded:bool}` to send one to the
background). **§4's "out if not" for `/tasks` does not apply: it is in.**

### §5.11 (not in the plan) `file_suggestions` — the CLI's own file index IS reachable

V2-PLAN §2 says the TUI's fuzzy file list "is in-process and unreachable". **Measurably wrong.**
It is a control subtype the CLI answers, free and fast:

```
{subtype:"file_suggestions", query:"nested_module"}
  -> {suggestions:[{path:"src\\deep\\nested_module.py", score:…}, …]}
```

Measured behaviour, which the `@` menu has to live with:

- **Project files come back cwd-relative and rank first**; after them the index returns
  **absolute** paths from outside the project — `~/.claude/skills/…`, `~/.claude/agents/…`.
  The window must show the relative ones and decide, deliberately, what to do with the rest.
- **The first query after spawn returns zero.** The index warms on demand, and the warm-up
  outlasts a 3-second sleep. The `@` menu must tolerate an empty first answer and re-ask.
- It matches **filename substrings**, not paths: `nested_module` → 1 hit, `main.py` → 1 hit,
  `src/` → **0**. A path prefix is not a query.
- Case matters in practice: `READ` came back empty on a cold index that then answered `main`.

**Consequence for V2-PLAN §2:** `GET /api/files?q=` does not need `os.walk`. It can proxy
`file_suggestions` and inherit the CLI's own ranking, with `os.walk` as the fallback for the
cold-index window. That is one fewer place where the window and the terminal disagree about
what a file is called.

## 2.1.259 re-verification (2026-09-03, author PC)

The native binary updated itself to 2.1.259 that morning (`~/.local/bin/claude.exe`, versions
dir `~/.local/share/claude/versions/2.1.259`). Free probes only; `smoke_test.py` was **not**
re-run. **The queue/interrupt contract holds** — `probe_queue.py` 8/8. Measured for `V2-PLAN.md`:

- **`initialize.commands` is 64 entries** (62 on 2.1.251). Each entry carries only `name`,
  `description`, `argumentHint` and sometimes `aliases` — there is **no `supportsNonInteractive`
  key on the wire**; the list is already filtered to what the pipe accepts. Skills count as
  commands (`/stop-slop`, `/dataviz`, …), so the number is per machine.
- **The TUI's own command registry is greppable out of the native exe** and holds ~40 names the
  pipe never advertises (`resume`, `help`, `status`, `export`, `copy`, `cd`, `add-dir`, `branch`,
  `fork`, `btw`, `bash`, `tasks`, `plan`, `permissions`, `hooks`, `memory`, `config`, `theme`,
  `keybindings`, `voice`, `radio`, `tui`, `teleport`, `desktop`, `mobile`, `remote-control`, …).
  That is the window's "known differences" list. The method, which also pulls keystroke hints
  and prompt wording verbatim:

  ```
  cd ~/.local/bin
  LC_ALL=C grep -a -o -E 'name:"[a-z][a-z0-9-]{1,30}",(aliases:\[[^]]{0,60}\],)?description:"[^"]{0,50}' claude.exe | sort -u
  LC_ALL=C grep -a -o -E "(ctrl|shift|alt|meta)\+[a-z0-9]+( to [a-z ]{3,28})?" claude.exe | sort | uniq -c | sort -rn
  ```

  Multi-byte glyphs (`⏺`, `✻`) do **not** grep as UTF-8 — the JS stores them escaped — but
  `※` and every ASCII string («Pasted text», «don't ask again», «Would you like to proceed»,
  «tell Claude what to do differently», «esc to interrupt») do.
- `initialize` keys now: `account, agents, analytics_disabled, available_output_styles,
  commands, current_permission_mode, fast_mode_disabled_reason, fast_mode_state,
  ide_rc_auto_enable_gate, models, output_style, pid, remote_control_auto_enable,
  remote_control_auto_on_by_default, remote_control_available, session_state` (`idle`).
  Models: `default`, `opus[1m]`, `fable[1m]`, `sonnet` (all `supportsEffort`), `haiku` (none).
  Output styles unchanged. Nothing reads the new keys; nothing broke.
- **`~/.claude/history.jsonl` is the TUI's prompt history**: one object per line with `display`,
  `pastedContents`, `timestamp`, `project`, `sessionId`. Plain file, appendable — the basis for
  shared Up/Down history in v2 (`V2-PLAN.md` §1, probe §5.8 still open).
- `~/.claude.json` carries no `theme` on this PC and `~/.claude/keybindings.json` does not exist,
  so the TUI runs on defaults here.

## 2.1.251 re-verification (2026-08-31, author PC)

Free probes only, plus one deliberate paid auto-mode measurement (below). **The queue/interrupt
contract holds** — `probe_queue.py` 8/8 (`msg_lifecycle_v1`, `interrupt_receipt_v1`,
`interrupt_cancel_queued_v1` all still advertised), spec 174/174, units green. Drift found:

- **`initialize.commands` is 62 entries** (was 61 on 2.1.240). **`/design` is one of them** —
  the video-announced artboard skill. It appears in the slash popup by itself (capability
  mirror); how its output renders in this window is unmeasured — unknown events fall back to
  the raw-JSON card by design, so worst case is ugly, not broken.
- **`set_permission_mode` accepts SIX modes** — its own refusal names them (free negative
  probe): `acceptEdits, auto, bypassPermissions, default, dontAsk, plan`. New vs 2.1.221:
  `auto` and `dontAsk`. The pill deliberately models neither — see
  `approval-postures.md` §"Why the third one is not a CLI mode", re-measured this day: **in
  `auto` mode a Write AND a shell `Remove-Item -Force` both executed with ZERO `can_use_tool`
  reaching the wrapper** (one paid turn, $0.33, isolated cwd, transcript cleaned). The
  classifier approves silently; there is no consent UI left to show. `system/status` echoes
  `auto` and `sync_cli_mode()` already ignores it gracefully.
- **`system/init` gained `messaging_socket_path`** — the cross-session-messaging plumbing from
  the 2.1 announcements, present even on this Windows build. If a model ever calls
  `ListAgents`/`SendMessage` here they render as generic tool rows (the MCP-fallback policy:
  readable, no Persian verb until the tools are actually seen in use).
- `initialize` gained `account`, `ide_rc_auto_enable_gate`, `remote_control_*`,
  `session_state`, `pid` keys; nothing reads them, nothing broke.

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

**Reversed 2026-08-31: this window sends `cancel_queued: false` now.** "Stop-means-stop-
everything" was the wrong client to be — the user reported it as a defect against the TUI, whose
Esc aborts only the running turn and lets the queue proceed. The 2026-08-24 fear (a surviving
queue running with no spinner) is exactly what the uuid ledger fixed, so `false` costs nothing:
still-queued rows keep the window busy and promote on their own `started`. Per-uuid cancel via
`cancel_async_message` (the strip's ✕) is the remaining queue control, as the CLI's own docs
above recommend for wrappers.

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
