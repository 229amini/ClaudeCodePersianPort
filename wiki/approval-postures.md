# Approval postures — why the full-auto one is wrapper-side

Built 2026-08-05 (rework Phase 4). Read `permission-transport.md` first: approvals arrive in-band
as `can_use_tool` control requests because the spawn carries `--permission-prompt-tool stdio`.

## The three postures

The pill in the composer row offers exactly three, and `server.py:POSTURES` is the whole mapping:

| pill | CLI permission mode | wrapper auto-approve |
|---|---|---|
| «محتاط» `ask` | `default` | no — every non-`AUTO_ALLOW` tool asks |
| «ویرایش آزاد» `acceptEdits` | `acceptEdits` | no — the CLI stops asking about edits |
| «خودکار» `autoApprove` | `default` | **yes — the wrapper answers instantly and logs it** |

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

## Session-scoped, and reset with the process

`start()` calls `broker.reset_posture()`, so a project switch or a `--resume` comes back at
«محتاط» with an empty audit log. That is deliberate: a new CLI process spawns with
`--permission-mode default` regardless, so keeping the old pill would show a posture that is no
longer in force. The posture is re-published right after `initialize`, which puts it in Hub history
for any window that connects or reconnects later.
