# Permission broker (M4) — how approvals actually work

Built and verified 2026-08-04 against `claude` 2.1.221. This replaces plan §B-5 entirely: both
mechanisms the plan proposed are unavailable (see `cli-stream-json-findings.md` §B-9.3).

## The flow

```
claude wants a tool
   ↓ PreToolUse hook (wired via --settings, never the user's real settings.json)
permission_hook.py  ── POST /api/permission/request ──►  server.py
                                                            ↓ SSE
                                                        window: Persian dialog
                                                            ↓ POST /api/permission/respond
permission_hook.py  ◄── {"decision":"allow"|"deny"} ───  server.py (releases the waiter)
   ↓ stdout {"hookSpecificOutput":{"permissionDecision":...}}
claude proceeds or refuses
```

The hook **blocks the CLI** while the dialog is open. `ThreadingHTTPServer` gives the blocked
request its own thread, so SSE and the rest of the API stay live.

Verified end to end: allow → file created; deny → file not created; "remember" → the second call
to the same tool resolved as `session allow-rule` with no dialog. Hook log:

```
-> allow (user decision)
-> deny (user decision)
-> allow (user decision)
-> allow (session allow-rule)
```

## THE TRAP: a space in the hook command silently disables it

**The CLI splits a PreToolUse `command` on whitespace and does not honour quotes.** A quoted
command never runs. There is no error, no stderr, no hook event — the tool call is simply denied,
which looks exactly like "hooks don't work in `-p` mode". This cost the most time in M4.

Measured:

| command form | hook fires |
|---|---|
| `"C:\...\python.exe" "C:\...\hook.py"` (quoted) | **no** |
| `C:\...\python.exe C:\...\hook.py` (unquoted, no spaces) | yes |
| `cmd /c ""C:\...\python.exe" "C:\dir with space\hook.py""` | **no** |
| `C:\...\PYTHON~1\python.exe C:\...\DIRWIT~1\HOOK~1.PY` (8.3 short paths) | yes |

So `cmd /c` does **not** rescue it. The fix in `server.py` is `space_safe()`: emit the command
unquoted, and if either path contains a space convert it with `GetShortPathNameW` (ctypes,
stdlib). This matters on the target PC — a Windows username with a space puts a space in
`%LOCALAPPDATA%`, which is where the wrapper gets deployed.

If 8dot3 name creation is disabled on the volume, no short name exists and the hook cannot be
wired. `server.py` publishes a loud `stderr` event in that case rather than failing silently.

## Other measured facts

- **`matcher` is a regex, not a glob.** `"*"` is an invalid pattern that matches nothing — again
  indistinguishable from a broken hook. Use `".*"`.
- **Environment variables DO propagate** server → `claude` → hook. `PCG_ENDPOINT`, `PCG_TOKEN`
  and `PCG_HOOK_LOG` all arrive. This is why the token never has to be written to the settings
  file on disk.
- **PreToolUse hooks are not echoed on stdout**, unlike `SessionStart`. The wrapper only learns
  about a pending approval because the hook itself calls in.
- Debug with `--hook-log <file>`: the hook appends what it received and what it decided. Without
  it, "hook did not run" and "hook ran and denied" are indistinguishable. Keep this for M8.

## Design decisions

- **The wrapper brokers every tool**, rather than deferring to the user's `permissions.allow`
  rules. There is no way to ask the CLI "would this be allowed?", and in `-p` anything not
  pre-allowed is auto-denied with no prompt. Predictable prompting beats clever inference for a
  non-technical user.
- **`AUTO_ALLOW`** is deliberately tiny and read-only (`Read`, `Glob`, `Grep`, `NotebookRead`,
  `TodoWrite`). Prompting on every file read is how people learn to click "allow" without
  reading it.
- **Every failure denies.** Hook can't reach the server, timeout, malformed input, window closed,
  Escape pressed → deny. Closing a window is not consent. The hook's timeout (120 s) is
  deliberately longer than the server's (110 s) so the server decides and can tell the UI.
- **"Remember" is session-scoped and in memory only.** It never writes to the user's real
  settings; closing the window forgets it.
- Tool parameters render as key/value lines, not `JSON.stringify` output — the latter escapes
  every backslash, so `C:\Users\...` reaches the user as `C:\\Users\\...`. The person approving
  is non-technical and must see the real path. Values go through `<bdi class="path">`.

## QA gotcha

**CDP `Page.captureScreenshot` times out while a native modal `<dialog>` is open.** Screenshots
of the approval dialog have to be taken with `dialog.show()` (non-modal) instead of
`showModal()`. Do not "fix" the product code for this — the modal is correct; the screenshot tool
is the limitation.

## Note on the assistant's language

The wrapper spawns the real CLI with the real `~/.claude`, so the user's own `SessionStart` hooks
run inside it. On this machine that meant replies came back in the author's configured English
terse style even to Persian prompts. That is correct behaviour — the wrapper inherits the target
machine's config — but it means the colleague's PC needs its own `~/.claude` set up for Persian
replies. Not a wrapper bug; check it during M8.
