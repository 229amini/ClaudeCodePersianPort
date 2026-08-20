# The stream-json control protocol — measured 2026-08-05

**This file invalidates three assumptions recorded elsewhere.** Measured against `claude` 2.1.221
on this machine, by driving a real `claude -p --input-format stream-json` child and reading its
stdout. Probe scripts were throwaway; the shapes below are copied from actual responses.
Sections 4–5 were re-measured the same day on **2.1.222** — the CLI auto-updated mid-project, and
everything above still held on the newer build.

A **control request** is a line written to the CLI's stdin alongside normal `user` messages:

```json
{"type":"control_request","request_id":"<any-string>","request":{"subtype":"<name>", ...}}
```

The reply comes back on stdout as

```json
{"type":"control_response","response":{"subtype":"success","request_id":"<echoed>","response":{...}}}
```

and on failure as `{"subtype":"error","error":"Unsupported control request subtype: foo"}`.
**That clean error is the feature-detection mechanism** — send a probe, branch on the reply, never
hardcode a CLI version check.

## 1. `initialize` — everything the UI needs, at spawn, for free

```json
{"type":"control_request","request_id":"init","request":{"subtype":"initialize"}}
```

Answers **immediately after spawn, before any user message, and it does NOT cost a turn.**

This kills the biggest UX constraint in the project. `wiki/cli-stream-json-findings.md` records that
`system/init` (and therefore `slash_commands`) only arrives *after* the first user message — true,
and the reason `/` showed an empty popup on a fresh window. `initialize` sidesteps it entirely.

Response keys: `commands`, `models`, `account`, `agents`, `available_output_styles`,
`output_style`, `fast_mode_state`, `fast_mode_disabled_reason`, `pid`,
`ide_rc_auto_enable_gate`, `remote_control_auto_enable`, `remote_control_auto_on_by_default`.

- **`commands`** — 59 entries here, and *richer than `system/init.slash_commands`*, which is names
  only. Each is `{name, description, argumentHint, aliases?}`. Skills carry a ` (user)` suffix in
  the description and namespaced ones look like `ui-ux-pro-max:ui-ux-pro-max` with an `aliases`
  array. This is what the CLI's own autocomplete renders.
- **`models`** — the model picker, fully data-driven. Per entry:
  `{value, resolvedModel, displayName, description, supportsEffort, supportedEffortLevels,
  supportsAdaptiveThinking?, supportsFastMode?, supportsAutoMode?}`.
  Observed on this account: `default` → "Default (recommended)" (`claude-opus-5[1m]`),
  `opus[1m]` → "Opus (1M context)", `claude-fable-5[1m]` → "Fable", `sonnet` → "Sonnet",
  `haiku` → "Haiku". Effort levels are `low|medium|high|xhigh|max` and Haiku alone reports no
  effort support — so **read `supportsEffort` per model, never assume**.
  **The list is account- and plan-specific. Never hardcode it** — that is exactly the bug that
  would ship a broken picker to every user on a different plan.
- **`account`** — `{email, organization, subscriptionType, apiProvider}`.
- **`agents`**, **`available_output_styles`** (`default`, `Proactive`, `Explanatory`, `Learning`).

## 2. `set_model` — works mid-process, verified to take effect

```json
{"type":"control_request","request_id":"m","request":{"subtype":"set_model","model":"haiku"}}
```

Returns `success` with an empty response body — so the ack alone proves nothing. Verified properly
by setting `haiku`, then sending one real message: `system/init` reported
`model='claude-haiku-4-5-20251001'`, both `assistant` events carried that model, and `result.modelUsage`
was keyed by it. Accepts both aliases (`opus`) and full ids (`claude-fable-5`).

## 3. `set_permission_mode` — also works mid-process

```json
{"type":"control_request","request_id":"p","request":{"subtype":"set_permission_mode","mode":"plan"}}
```

Returns `{"mode":"plan"}` **and** the CLI then emits `{"type":"system","subtype":"status",
"permissionMode":"plan"}` — a confirmation event the UI can bind to rather than trusting its own
optimistic state. Valid modes come from `--permission-mode`:
`acceptEdits`, `auto`, `bypassPermissions`, `manual`, `dontAsk`, `plan`.

**This retires the note in `wiki/parity-chrome.md`** that mode switching was left unbuilt because
"nothing verified lets it change mid-session… a restart would be a surprising thing for a button to
do." It changes live. No restart, no `--resume`, no lost context.

## 4. `rename_session` — persists, but only into the transcript (measured 2026-08-05)

```json
{"type":"control_request","request_id":"r","request":{"subtype":"rename_session","title":"…"}}
```

`title` is the right key (others error). The reply is a bare `success` with no body, and **the ack
proves nothing** — what it actually does is append one line to the session's own transcript:

```json
{"type":"custom-title","customTitle":"زیتون…","sessionId":"11dec6fc-…"}
```

in `~/.claude/projects/<sanitized-cwd>/<session-id>.jsonl`. Consequences:

- The sidebar reads titles from the file it already scans — take the **last** `custom-title` line
  in a transcript, fall back to the 160-char preview. No new store, no wrapper-side title file.
- On a **fresh session with no messages there is no transcript yet**, and the rename is silently
  lost — nothing lands on disk anywhere. So rename only after the first `result`, never at spawn.
- It does **not** touch `~/.claude/sessions/<pid>.json`. That file (one per *running* CLI, deleted
  on exit) keeps `name` as the cwd-derived string with `nameSource:"derived"`; it is a live-process
  index, not a title store. Do not read it.

## 5. `apply_flag_settings` — accepts anything; the ack is worthless

Requires an object: `{"subtype":"apply_flag_settings","settings":{...}}` — a bare `effort` key
errors with ``apply_flag_settings requires `settings` to be an object, got undefined``. But every
payload inside `settings` then returns `success`, including `{"zzz_not_a_flag":"nonsense"}` and
`{"effort":"banana"}`. **It validates the wrapper shape only.** There is therefore no free way to
feature-detect live effort switching; treat `--effort` as a spawn flag and only claim a live effort
control if a paid turn ever proves one. Same trap as `set_model`, which *is* real but also acks
empty — the difference is that `set_model` was verified by a following turn's `system/init.model`.

`set_max_thinking_tokens`, `get_context_usage` and `get_usage` all answer on a message-less
process. `get_context_usage` returns `categories[]` with per-bucket token counts; `get_usage`
returns `{session:{total_cost_usd,…}, subscription_type, rate_limits{…}}` — real statusline data
for free, no client-side arithmetic.

## 6. What Phase 4 measured on top (2026-08-05, 2.1.222)

- **`compact` is NOT a control subtype.** `{"subtype":"compact"}` answers
  `Unsupported control request subtype: compact` in 0.1 s. It was in the wrapper's whitelist on the
  strength of a strings-grep; that was wrong. `/compact` reaches the CLI as ordinary message text
  like every other slash command, and the GUI must not intercept it.
- **`set_permission_mode` accepts `default`** — the mode the wrapper spawns with, and the one the
  cautious posture returns to. The valid list comes from the error on a bad value:
  `acceptEdits, auto, bypassPermissions, default, dontAsk, plan`.
- **`manual` is a silent alias for `default`.** It is not in the valid list, yet
  `{"mode":"manual"}` answers `success` with `{"mode":"default"}` — an ack that reports a mode you
  did not ask for. Read the `mode` in the reply, and bind the UI to the `system/status` echo.
- **`get_context_usage`** answers `{categories[], totalTokens, maxTokens, percentage, gridRows[]}`.
  `percentage` is the whole statusline number — no client-side arithmetic over `modelUsage`.
- **`get_usage`** answers `{session:{total_cost_usd,…}, subscription_type, rate_limits:{five_hour:
  {utilization, resets_at}, seven_day:{…}, limits:[…]}}`. `five_hour.utilization` is an integer
  percent: the subscription quota, free, every turn.
- Both answer on an idle process in well under a second, so firing them after each `result` costs
  nothing. Do it off the stdout reader thread — `control()` waits for a reply that only that thread
  can deliver, so calling it from there deadlocks the event pump.

## Consequences for this project

- Slash autocomplete can be populated **at spawn**, with descriptions and argument hints, instead
  of being empty until turn one finishes.
- The model picker and the approval-mode picker are both **live controls**, not restart-flag
  choices. Build them as instant switches.
- Everything the picker renders (model names, descriptions, effort levels, output styles) is
  **supplied by the CLI per account** — the open-source build stays correct on plans we never see.
- Feature-detect with a probe subtype and degrade gracefully; the NDJSON/control surface drifts
  across CLI versions and this is all measured against 2.1.221 only.

## Relevant spawn flags (from `claude --help`, same build)

`--model <alias|full-id>`, `--effort <low|medium|high|xhigh|max>`,
`--permission-mode <mode>`, `--session-id <uuid>`, `--fork-session`, `--setting-sources`,
`--disable-slash-commands`. Spawn flags still matter for the *initial* state; the control requests
above are for changing it afterwards.

## 6. Reasoning effort: there is no `set_effort`, and the ack is worse than useless (2026-08-07)

Measured on **2.1.223**. The full control-subtype list, read out of the bundle:

```
set_model, set_permission_mode, interrupt, set_max_thinking_tokens, rename_session,
set_color, mcp_authenticate, mcp_oauth_callback_url, mcp_reconnect,
apply_flag_settings, side_question, reload_plugins
```

No effort subtype. The only route is **`apply_flag_settings {settings:{effortLevel: …}}`**, whose
ack is `{}` — it reports `success` for a level it silently drops, exactly like §5 records for
garbage keys.

The honest read-back is **`get_settings`** (a real subtype, not in the list above — the SDK issues
it). Its response has three parts, and only one of them is true:

| key | what it is |
|---|---|
| `sources[0]` | the user's real `~/.claude/settings.json` — **never written** by this route |
| `sources[1]` | a session-scoped overlay `apply_flag_settings` creates |
| `applied.effort` | the last level **requested**. Not what is in force. Lies. |
| `effective.effortLevel` | **the merged truth. Use this one.** |

### The two lists disagree, and the CLI is on both sides of it

`initialize` advertises `supportedEffortLevels: ["low","medium","high","xhigh","max"]` per model
(Haiku advertises no effort support at all). The settings schema is
`effortLevel: enum(["low","medium","high","xhigh"]).catch(undefined)`. So **`max` is offered by the
CLI and refused by the CLI**: applying it acks success, `applied.effort` says `"max"`, and
`effective.effortLevel` falls back to whatever the user's own settings.json says.

Measured through `/api/effort`:

```
low  -> {"ok": true,  "effort": "low"}
high -> {"ok": true,  "effort": "high"}
max  -> {"ok": false, "effort": "xhigh"}     <- reverted to the user's own value
wat  -> {"ok": false, "effort": "xhigh"}
```

`~/.claude/settings.json` was byte-identical before and after all four. That matters: the CLI's own
`/effort` command **does** persist to userSettings (`Ni("userSettings", {effortLevel})`), so sending
`/effort high` as message text would edit the colleague's real settings. `apply_flag_settings` does
not. That difference is the only reason this route is acceptable — see the project rule that the
wrapper never edits the user's settings.

### Consequences for the wrapper

- `apply_flag_settings` is **deliberately not in `CONTROL_ALLOWED`**. Its params are a free-form
  settings blob, so whitelisting the subtype would let the page write any setting, permissions
  included. `/api/effort` takes one level string instead.
- The chip repaints from `effective`, never from the ack, and remembers a refused level so the user
  meets that dead end at most once. Nothing about `max` is hardcoded — if a later CLI accepts it,
  it starts working with no change here.
- Gate: `smoke_test.py` asserts both halves (`low` sticks, `max` does not, settings.json untouched).

## 7. Output styles: the same route, with the opposite problem (2026-08-08)

Measured on 2.1.223. `initialize` advertises `available_output_styles`
(`["default","Proactive","Explanatory","Learning"]` here — extensible per machine) and the current
one as `output_style`, a plain string.

There is **no `set_output_style` subtype** (probed: `Unsupported control request subtype`), so the
only route is `apply_flag_settings {settings:{outputStyle: …}}` again. Note the key is
**`outputStyle`**, camelCase; `output_style` is *also* accepted and stored, because nothing
validates the key either.

**`outputStyle` has no schema behind it at all.** Where `effortLevel` is a four-value enum that
silently drops `max`, `outputStyle` accepts anything:

```
apply outputStyle='Explanatory'    -> effective.outputStyle='Explanatory'    initialize.output_style='Explanatory'
apply outputStyle='nonsense-style' -> effective.outputStyle='nonsense-style' initialize.output_style='nonsense-style'
```

So the effort chip's whole design — apply, read back, detect the refusal — **does not transfer**.
There is no refusal to detect, and both read-backs will happily confirm a typo. The guard has to be
at the door: `/api/output-style` rejects any name not in the *current* `init_info
.available_output_styles`. `~/.claude/settings.json` stays byte-identical, same as effort.

Two things worth keeping:

- **`initialize` is re-callable mid-process**, and its `output_style` follows the overlay. That is a
  free read-back of the CLI's own view, not just an echo of the settings blob.
- **`system/init.output_style`** names the style the turn actually ran under — the same class of
  evidence as `system/init.model` for `set_model`, and the only proof that costs nothing extra.
  `smoke_test.py` applies a style *before* its one turn and asserts that field.

## 8. `ultracode` and fast mode — measured 2026-08-08, deliberately NOT built

`get_settings.applied` is `{model, effort, advisor, ultracode}`, and two of those look like more
picker material. They were probed rather than guessed:

| flag | result |
|---|---|
| `apply_flag_settings {ultracode: true}` | **works** — `applied.ultracode` follows, both ways, and `~/.claude/settings.json` is untouched |
| `apply_flag_settings {advisor: "opus"}` | acked, `applied.advisor` stays `null` — wrong value shape, or refused |
| fast mode | not a flag at all: `initialize` answers `fast_mode_state:"off"` with `fast_mode_disabled_reason:"sdk_opt_in_required"` — **the CLI says it is unavailable in this transport**, so there is nothing to mirror |

And ultracode is not a no-op here: one probe turn confirmed `system/init.tools` (35 tools) contains
`Workflow` alongside the whole `Task*` family, so the machinery it turns on really is present in
`-p --input-format stream-json`.

**It is still not in the UI, on purpose.** The wrapper's rule is to mirror what the CLI advertises,
and the CLI does not advertise this one: there is no `/ultracode` among the 59 entries in
`initialize.commands` (only `ultrareview`, `agents`, `__remote-workflow`,
`workflow-launch-exec`), and the bundle's own symbols are `ultracodeActive` and
**`ultracodeKeywordTrigger`** — it is turned on by a word in the prompt. A chip would therefore be
*more* prominent than the affordance it mirrors, and it would hand a non-technical user a
one-click way to spend a five-hour quota on a task they thought was small. Typing the keyword
already works, because prompt text passes through untouched.

## §9 — a control request sent right after a `result` is NOT answered promptly (2026-08-20)

`_after_result` fires three things the moment a turn ends: `rename_session`, `get_context_usage`,
`get_usage`. All three are free and all three answer instantly **on an idle process** — which is
what the earlier note here measured, and what made the 5-second budget on the usage pair look
generous. It is not the same situation:

- the CLI does not answer control requests while it is finishing a turn, and
- `get_context_usage` then has real work to do. Its response prices **every skill, agent, MCP
  tool, slash command and memory file in scope** (`categories`, `skills`, `agents`, `mcpTools`,
  `slashCommands`, `memoryFiles`, `messageBreakdown`, plus `percentage` / `totalTokens` /
  `maxTokens`). On a machine with a large `~/.claude` that is seconds of work, and a SessionStart
  hook chain pushes the first one out further still.

Measured on this PC with 2.1.235: the same request answers in well under a second when the process
is idle, times out at 12 s in one run, and answers on a retry in the next. The failure is
**silent and machine-shaped** — `_publish_usage` builds its patch out of whatever answered, so a
timed-out `get_context_usage` publishes `wrapper/usage` with `cost` and no `context`, and the
window's context meter and «گفتگو پر شده» notice simply never move. On a colleague's PC with a bare
`~/.claude` nothing is wrong at all.

Two changes, and the second is the load-bearing one:

- `get_context_usage` gets `CONTEXT_USAGE_TIMEOUT` (60 s). Nothing is lost by waiting —
  `_after_result` runs on its own thread precisely so the event pump does not.
- **the two publish separately.** `_publish_usage` used to build ONE patch and publish it at the
  end, which put the fast request in a queue behind the slow one: raising the context budget to
  60 s made things *worse*, because a context breakdown that still did not answer dropped `cost`
  and `quota` with it and published nothing at all. `get_usage` now goes first and publishes its
  own `wrapper/usage`; the context percentage follows in a second one whenever it arrives. The
  renderer has merged partial usage patches since it was written ("a missing one must not erase a
  good value"), so this needed no client change. Do not re-merge them.

Measured after this: `usage {'cost': 0.017, 'quota': 2}` then `usage {'context': 12}`, smoke 15/15.

Note the shape has NOT changed: `percentage` is still there in 2.1.235. If the meter is dark, the
request timed out; do not go looking for a renamed field.
