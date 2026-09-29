# The composer bar, after claude.ai/code (2026-09-29)

User request, with five reference screenshots of claude.ai/code: bring its composer bar to
**both** editions. The terminal edition dropped its chips at v2.4 to look like the TUI; this is
the user's decision to bring a bar back there, claude.ai-style, while `/model`, `/effort`,
`/permissions` and Shift+Tab keep working as they do.

## What the CLI gives us (measured 2026-09-29, CLI 2.1.284, all free)

| Control | Source | Notes |
|---|---|---|
| Model menu | `initialize.models` | 5 entries here: `displayName`, `description` («Opus 5.5 · …»), `supportedEffortLevels`. No "more models" list exists in the CLI; show them all. |
| Effort slider | the current model's `supportedEffortLevels` | no default/recommended level is advertised (`defaultEffort` absent), so no «Recommended» mark. `max` is refused by the settings schema (control-protocol.md §6) and is learned as refused, as today. |
| Mode menu | the wrapper's four postures | **not** the CLI's `auto`: measured 2026-08-31, `auto` bypasses the wrapper's approval dialog entirely (approval-postures.md). |
| Context panel | `get_context_usage` | `totalTokens`, `maxTokens`, `autoCompactThreshold`, `categories[] {name, tokens, color, kind}` with `kind` used/deferred/buffer/free and the CLI's own colour names. «Compact» sends `/compact` as text (it is not a control subtype). |
| Usage limits | `get_usage.rate_limits` | `five_hour`, `seven_day`, `seven_day_opus`, `seven_day_sonnet` as `{utilization, resets_at}`, and `model_scoped[] {display_name, utilization, resets_at}` (the «Weekly · Fable» row). `null` with `rate_limits_available: false` on an API-key login. `skip_behaviors: true` skips a 7-day transcript scan we never read. |
| Connectors | `mcp_status` → `{mcpServers: [{name, status, scope, source}]}`; `mcp_toggle {serverName, enabled}` | **the toggle is persistent**: it writes `projects/<cwd>/disabledMcpServers` in `~/.claude.json`, as the TUI's `/mcp` does. The menu says so. claude.ai's own connector directory has no CLI equivalent. |
| «+» → files | the existing paste/drop path (`/api/attach/paste`) behind a file picker | |
| «+» → slash commands | opens the existing slash popup | |

Not built: claude.ai's «Cloud session credits» row (no CLI source).

## Shape

One module, `js/bar.js`, **byte-identical in both editions** (a leaf: imports nothing; the host
passes `api` and its own state). It builds four popovers, all `[popover=auto]`, placed from the
anchor's rect through a `toCss` the host supplies (terminal: `prefs.js cssPx`; web: identity):

1. `menu(anchor, {title, rows, onPick})`: numbered rows (title, note, ✓ on the current one); a
   digit picks while it is open.
2. `slider(anchor, {levels, current, onPick})`: «سریع‌تر ↔ باهوش‌تر», one stop per level.
3. `usagePanel(anchor, {context, limits, onCompact})`: the context bar in category colours with
   «N تا فشرده‌سازی خودکار» and a compact button; then each limit with its bar and reset time.
4. `plusMenu(anchor, {onFiles, onSlash, servers, onToggle})`.

Terminal: a bar row under the prompt, `[+] [حالت]  …  [مدل] [تلاش] [◔]`.
Web: the existing chips open these popovers instead of `.menu-popup`; the paperclip becomes «+»;
a ◔ usage ring joins the row.

## Server

- `get_usage` with `skip_behaviors: true`; `wrapper/usage` also carries `limits` (the whole
  `rate_limits` object) and `context_detail` (`total`, `max`, `threshold`, `categories`).
- `mcp_status` and `mcp_toggle` join `CONTROL_ALLOWED`.

## Gates

`test_bar.py`, both editions: each popover from synthetic events, digits, the slider's POST, the
panel's numbers and colours, the compact message, the «+» rows and the MCP toggle's request.
