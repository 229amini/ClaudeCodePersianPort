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
