# BridgeMind One — a commercial product on the same architecture (measured 2026-09-06)

Installed by the user at `%LOCALAPPDATA%\BridgeMind One\` (`bridgemind-one-rust.exe`, Tauri 2 +
a fixed WebView2 runtime, ~18 MB). Strings read out of the binary, not the marketing page:

- **Same transport as ours.** Spawns the real CLI on stdin/stdout with `stream-json`,
  `--resume`, `--mcp-config`; approvals are inbound `can_use_tool` control requests;
  `set_permission_mode`; a `bypassPermission` setting. Independent confirmation of the B2
  decision and of `wiki/permission-transport.md` — a $50/month product landed on the identical
  contract, not on the SDK and not on a PTY for chat.
- **Broader, not deeper.** Three providers (`claude-code`, `codex`, `gemini` in its SQLite
  `chat_threads` schema), pane layout (Terminal / Browser / Files panes with split ratios, conpty
  + PowerShell hooks recording `commands` with `cwd`/`exit_code`), named agent profiles with
  routines and voice, auto-updater. No RTL, no Persian, and the terminal pane is a real conpty
  grid — exactly the surface that cannot render Persian (CLAUDE.md §"Why a window and not a
  terminal").
- **How it shows many agents (read out of its shipped CSS and SQLite schema, same day; the app
  itself is behind a login wall).** Agents are **tabs, not tiles**: `workspace-tabs` with a
  status dot per tab, plus a sidebar tree workspace → thread rows carrying
  `--running / --waiting / --failed` dots, an unread badge and a running-count badge on the
  rail. `chat_thread_summaries` has `status ∈ idle|running|waiting|error`, `tab_order`,
  `workspace_id`, `pinned`. Panes are a *stack* with one divider (`main-pane--stacked`,
  `pane-divider`) — there is no tiling grid anywhere. Each session may get its own git worktree
  under `.worktrees/`. Reusable CDP client (stdlib WebSocket) that got this far is in the
  session scratchpad; launch with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=N`.
- Closed source, commercial (Pro $50/mo). Public site says Mac v0.1.0 with Windows "in
  development"; the installed binary is a Windows build. https://www.bridgemind.ai/

Why it is here: the next time someone asks "should we just use X", this is the reading — our
edge is the Persian rendering discipline and zero-install stdlib packaging, not the transport.
