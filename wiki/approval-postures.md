# Approval postures — why the full-auto one is wrapper-side

Built 2026-08-05 (rework Phase 4). Read `permission-transport.md` first: approvals arrive in-band
as `can_use_tool` control requests because the spawn carries `--permission-prompt-tool stdio`.

## The four postures

`server.py:POSTURES` is the whole mapping:

| pill | CLI permission mode | wrapper auto-approve |
|---|---|---|
| «طرح‌ریزی» `plan` | `plan` | no — the engine refuses edits itself (added 2026-08-07) |
| «محتاط» `ask` | `default` | no — every non-`AUTO_ALLOW` tool asks |
| «ویرایش آزاد» `acceptEdits` | `acceptEdits` | no — the CLI stops asking about edits |
| «خودکار» `autoApprove` | `default` | **yes — the wrapper answers instantly and logs it** |

## Plan mode exits by itself, so the pill has to follow the engine

The other three postures only ever change because the user pressed the pill. `plan` does not: the
model finishes planning, calls **`ExitPlanMode`**, and — once that call is approved — the CLI drops
out of `plan` on its own. Nothing the wrapper did caused it, so nothing the wrapper knew would have
repainted the pill, and it would have sat there reading «طرح‌ریزی» over an engine that was editing
files. That is the same failure as the dead `PreToolUse` hook: a safety control that looks engaged
and is not.

`PermissionBroker.sync_cli_mode()` binds the posture to the CLI's own `system/status` echo, which
is the only honest report of the mode in force (`set_permission_mode`'s ack returns modes nobody
asked for). `default` is ambiguous — both `ask` and `autoApprove` map to it — so an echo of
`default` that already agrees with the current posture is ignored, which is how «خودکار» survives
its own status events.

Two consequences worth knowing:

- **`ExitPlanMode` is not in `AUTO_ALLOW`**, so the plan reaches the permission dialog like any
  other tool call. Under «خودکار» it is auto-approved with everything else — but «خودکار» and
  «طرح‌ریزی» are the same control, so the two cannot be on at once.
- The plan itself is markdown written for a human to read, and `renderToolDetail()` renders it as
  markdown rather than as a `plan:` parameter blob. Spec gate cases cover both halves.

Measured 2026-08-07 on 2.1.223: `set_permission_mode {"mode":"plan"}` is accepted and echoed back as
`system/status.permissionMode == "plan"` (`smoke_test.py`, "the CLI accepts plan mode"). The exit
half is **not** covered by that test — it needs a real planning turn.

## Why the third one is not a CLI mode

The CLI has modes that would do it (`auto`, `dontAsk`, `bypassPermissions`), and using one is the
obvious lazy choice. It is the wrong one: in those modes the CLI approves the call **before it ever
asks us**, so no `can_use_tool` arrives, the wrapper sees nothing, and there is nothing to show or
count. The posture that needs an audit trail the most would be the one with no audit trail at all.
`bypassPermissions` is refused by the engine outright.

So the full-auto posture keeps the CLI in `default` — it still asks the wrapper about every tool —
and the broker answers `allow` immediately, appends to `PermissionBroker.auto_log`, and publishes
`wrapper/permission_resolved` with `auto: true` and the running count. The window shows
«N اقدام خودکار» next to the pill and each tool card still gets its «اجازه داده شد» note. Nothing
happens invisibly.

## The pill never moves on its own click

`POST /api/posture` sends `set_permission_mode` and changes the broker **only after** the CLI
acknowledges; the pill repaints only when the server's `wrapper/posture` event arrives. An
optimistic pill would be the same class of bug as the dead `PreToolUse` hook: a safety control that
looks engaged and is not (`permission-hook-broken.md`).

Two measured reasons not to trust anything less:

- `set_permission_mode` **acks a mode you did not ask for** — `manual` returns
  `success {"mode":"default"}` (`control-protocol.md` §6).
- Every other ack on this surface lies by omission: `set_model` and `rename_session` both answer
  `success` with an empty body whether or not anything happened.

## What «دوباره نپرس» does — and the two ways it used to go quiet (fixed 2026-08-06)

The remember tick adds the tool name to `PermissionBroker.session_allow`. Driving the real §6 pass
found that set doing two things nobody intended:

1. **It approved silently.** The `session_allow` check returned *before* `_publish_resolved()`, so a
   remembered `Write` or `PowerShell` ran with no «اجازه داده شد» note, no counter, no trace of any
   kind in the window. Under «محتاط», which is the posture that promises to ask. The claim above —
   "nothing happens invisibly" — was false for exactly this path. It now publishes with
   `auto: true`, `why: "remembered"`, so it lands in the same counter and the same audit list.
2. **It outlived its session.** `reset_posture()` cleared the posture and the audit log on every
   spawn but not `session_allow`, and nothing else ever cleared it. So a project switch or a resume
   put the pill back at «محتاط» while a `Write` remembered for the *previous* conversation, in a
   *different folder*, kept approving itself. `reset_posture()` now clears it too. Verified: after
   «گفتگوی جدید» the same tool prompts again.

The counter is also **clickable** as of the same day — it opens the list of what was approved and
why (`«چون گفتید دوباره نپرس»` / `«سطح اجازه: خودکار»`). It was a `<span>` with a tooltip before,
so M8-acceptance §6's "Click it: every auto-approved action is listed" had never been built. No
endpoint was added: the `permission_resolved` events already carry `tool_name`, and the Hub replays
them to a reconnecting window, so the list survives a refresh exactly as far as the count does.

## Session-scoped, and reset with the process

`start()` calls `broker.reset_posture()`, so a project switch or a `--resume` comes back at
«محتاط» with an empty audit log and no remembered tools. That is deliberate: a new CLI process spawns with
`--permission-mode default` regardless, so keeping the old pill would show a posture that is no
longer in force. The posture is re-published right after `initialize`, which puts it in Hub history
for any window that connects or reconnects later.
