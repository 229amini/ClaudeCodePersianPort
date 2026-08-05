# CRITICAL — the permission hook does not fire on this machine (2026-08-05)

> **✅ SOLVED the same day — see [permission-transport.md](permission-transport.md).**
> The replacement is the hidden spawn flag `--permission-prompt-tool stdio`, which routes approvals
> to inbound `can_use_tool` control requests. Verified allow *and* deny. This file remains as the
> evidence record for *why* the hook was abandoned; do not try to revive it.

**The wrapper's only safety gate is silently inert.** Measured against `claude` 2.1.221 on the
`Lion` machine, driving the **real shipping `server.py`**, not a reconstruction.

## What was observed

`server.py --hook-log <file>` was started against a scratch folder and asked to `Write` a file:

| | result |
|---|---|
| permission dialogs raised | **0** |
| `--hook-log` file created | **no — the hook never ran** |
| `probe.txt` actually written | **yes** |
| `init.permissionMode` | `auto` |

The file was created with **no approval prompt of any kind**. `--hook-log` exists precisely to
tell "hook never ran" apart from "hook ran and denied" (CLAUDE.md, M4 row); it says *never ran*.

## Scope — it is not the mode, and not our wiring

A spawn-flag matrix, each variant asking for one `Write`, with a hook that only logs and allows:

| spawn flags | `init` mode | hook fired | file written |
|---|---|---|---|
| *(none)* | `auto` | no | **yes** (unattended) |
| `--permission-mode default` | `default` | no | no (silently denied) |
| `--permission-mode manual` | `default` | no | no (silently denied) |
| `--setting-sources user,project,local` | `auto` | no | **yes** (unattended) |
| `--settings` as **inline JSON string** | `auto` | no | **yes** |
| **`PostToolUse`** instead of PreToolUse | `auto` | no | **yes** |

So: **no hook supplied via `--settings` fires at all** — not `PreToolUse`, not `PostToolUse`,
neither as a file path nor as an inline JSON string. Meanwhile hooks from the user's own
`~/.claude/settings.json` *do* fire (`SessionStart:startup` appears on the stream every run), and
the probe hook script runs correctly when piped JSON by hand. The wiring matches `server.py`'s
`_write_settings()` byte for byte, including the 8.3 short-path treatment, and the hook command
contains no space.

**Most likely cause: deliberate CLI hardening.** Honouring hooks from `--settings` is an arbitrary
code-execution vector — anything that can pass a flag could run any command. Treat this as
intentional and *permanent*, not a bug to wait out.

## Why this is severe, not cosmetic

Two different failure shapes, and the user sees neither:

- **`permissions.defaultMode: "auto"`** (what this machine's `~/.claude/settings.json` sets):
  every tool runs **unattended**. The Persian approval dialog the product promises never appears.
  For a non-technical audience being handed a file-editing agent, that is the worst possible
  silent failure.
- **`default` / `manual` mode**: every tool is **silently denied** with
  `"Write denied — permission not granted"` and no dialog, so the app just looks broken.

Which one a user gets depends on `permissions.defaultMode` in *their* `~/.claude/settings.json` —
a file the wrapper neither reads nor controls, and the audience will never open. Plan §B-7 says the
wrapper "must respect `permissions.defaultMode`"; it does not, and the consequence is a safety gate
that is present in the UI and absent in reality.

M4 passed on the **other** machine (`ladyg`), whose `permissionMode` the wiki records as `default`
— so this was never caught. **Do not ship until it is re-solved.**

## The replacement mechanism (identified, handshake not yet found)

`--permission-prompt-tool` still does not exist on this build (`claude --help`), confirming the
original M4 finding. But strings inside the 2.1.221 binary describe the real path:

> "Emitted when a tool call is auto-denied without an interactive permission prompt (e.g. auto-mode
> classifier, dontAsk mode, **headless-agent auto-deny**, or a deny rule). **The 'ask' path surfaces
> via a `can_use_tool` control_request**; this event covers the 'deny' short-circuit in `canUseTool`
> so SDK hosts can render the denial instead of only seeing an `is_error` tool_result.
> PreToolUse hook denies bypass `canUseTool` and are not covered here."

So permissions are meant to arrive as an **inbound `control_request` (CLI → client) with subtype
`can_use_tool`**, answered with a `control_response` carrying `{behavior: "allow"|"deny"}`. That
would be strictly better than the hook: in-band on the pipe already open, no grandchild process, no
8.3 short-path hack, no HTTP callback, no `PCG_TOKEN` env var — it deletes `permission_hook.py` and
the project's single most-documented footgun.

**Not yet working.** Sending `initialize` with `{"capabilities":{"canUseTool":true}}` produced no
inbound request; the CLI auto-denied instead. The correct handshake is still unknown — the binary
gates it somewhere near a `Jpe() !== "stdio"` check, which hints at a stdio-transport permission
setting. **Finding this handshake is the first implementation task**, and everything about the
approval-mode pill depends on its outcome.

## Also discovered while grepping the dispatch switch

Full outbound `control_request` subtypes on 2.1.221:

`initialize`, `interrupt`, `set_model`, `set_permission_mode`, `set_max_thinking_tokens`,
`apply_flag_settings`, `seed_read_state`, `compact`, `rename_session`, `get_context_usage`,
`get_status`, `get_usage`, `get_conversation`, `get_file`, `get_project`, `list_files`,
`list_projects`, `set_expanded_view`, `set_in_progress_tool_use_ids`, `set_color`, and several
design/remote-control ones.

Directly useful here:
- **`rename_session`** — the CLI can title a session. That is the fix for "sessions have no titles"
  (sidebar currently shows the first user message truncated to 160 chars), rather than inventing
  a wrapper-side title store.
- **`get_context_usage`** / **`get_usage`** — real context-% and cost for the statusline.
- **`compact`** — `/compact` as a first-class control rather than passthrough text.

`bypassPermissions` is refused by the engine with
`"set_permission_mode:bypassPermissions rejected — disabled by settings"`, and `auto` is gated too
(`"auto rejected — gate not enabled"`). So a "full access" pill cannot be implemented by sending
`bypassPermissions`, independent of the hook question.
