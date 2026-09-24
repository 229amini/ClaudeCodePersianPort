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

- **CORRECTION 2026-09-24 — it DOES tile.** User screenshots of the current Mac build (CLI
  2.1.280, "Code" mode) show a **3x2 grid of framed panes**, each a real terminal running the
  TUI. The "no tiling grid anywhere" line above was read out of the Windows build's CSS and is
  wrong for the current product. What the screenshots establish:
  - Shell = **floating cards on a darker ground**: sidebar card and stage card, rounded, 1px
    hairline, ~8px gutter everywhere. Panes are cards too, with ~8px gaps — never edge to edge.
  - Pane header ~24px: status dot + agent glyph at the start; `⋯ ⤢ + ✕` at the end. Nothing else.
  - Pane body = the CLI's own banner, then transcript, then `❯ Try "…"` between two hairlines,
    then ONE status line of **state** (`▸▸ auto mode on (shift+tab to cycle) · 3 shells · 2
    agents`). No key cheat-sheet in the pane.
  - Top-centre segmented mode switch `Agent | Code | Thread`.
  - "4 at once" is not a split control: a **New session page** (PRESET / AGENT grid / HOW MANY
    1–6 / ISOLATION shared-vs-worktree / WILL LAUNCH preview) opens N panes in one action.
  - Sidebar: `Workspaces +`, small-caps section labels `Pinned` / `Folders`, 34px rows,
    no per-row icons, count badge on the right, the active project expands to its session rows
    with a dot. Footer: plan, credits, theme, settings.

Why it is here: the next time someone asks "should we just use X", this is the reading — our
edge is the Persian rendering discipline and zero-install stdlib packaging, not the transport.
