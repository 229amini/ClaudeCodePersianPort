# Claude Code + Persian (RTL) — Options for a Non-Terminal User

**Written:** 2026-08-04
**For:** a follow-up session (Fable) to pick an approach and build it
**Target machine:** a colleague's PC — **NOT** the machine this was written on. See "Probe the target PC first."

---

## The goal

A colleague who is not comfortable with a terminal needs to use **Claude Code** with:

1. Correct Persian rendering — RTL direction and text alignment, not just correct glyphs
2. The full existing Claude Code setup preserved — skills, hooks, `CLAUDE.md`, permission rules, login
3. Real control over the PC and the project, the same as the CLI has

Constraint set by the user: **keep using Claude Code.** Do not replace it with a different product.

---

## Already tried and rejected

### Claude Desktop app — rejected, 3 problems

1. The existing Claude Code setup does not carry over
2. Persian words render, but alignment/direction is wrong (not RTL)
3. Behaves like a chat website — no real control over the PC or the project the way the CLI has

### BiDi-capable terminal (mlterm and similar) — rejected

Fixes glyph shaping only, not layout. Claude Code's TUI is Ink-based and does its own cursor positioning and cell-width math with no Unicode Bidirectional Algorithm support. A BiDi terminal solves half the problem and leaves the layout broken.

### Rebuilding on the Claude Agent SDK — rejected

`@anthropic-ai/claude-agent-sdk` / `claude-agent-sdk` is Claude Code packaged as a library, so it is technically capable. Rejected because:

- It means reimplementing Claude Code's config loading to get setup parity back
- Auth and billing likely shift to API credits rather than the existing Claude subscription — **verify this before considering it**
- Option B below gets the same UI freedom while keeping the real CLI and the real subscription

---

## The key technical unlock

`claude --print` has a headless streaming mode. Verified flags:

```
--output-format   text | json | stream-json
--input-format    text | stream-json
--resume          <session-id>
--continue
--settings        <file-or-json>
--agents          <json>
--mcp-config      <configs...>
--json-schema     <schema>
```

This means **any front-end can be put on the real Claude Code CLI.** The binary, the config directory, the auth, the tools, and the subscription all stay exactly as they are — only the rendering layer changes.

---

## Probe the target PC first

Everything in the "runtime" table below was measured on the author's PC. **The colleague's PC will differ.** Run this on the target machine before choosing:

```powershell
foreach ($c in @("node","npm","python","py","pip","cargo","rustc","uv","winget","claude","code")) {
  $p = Get-Command $c -ErrorAction SilentlyContinue
  if ($p) { "$c => $($p.Source)" } else { "$c => NOT FOUND" }
}
echo "--- python real or Store stub? ---"
try { $v = & python --version 2>$null; if ($v) { "python works: $v" } else { "Store alias stub - not real Python" } } catch { "python failed" }
echo "--- WebView2 ---"
$k = "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
if (Test-Path $k) { "WebView2: $((Get-ItemProperty $k).pv)" } else { "WebView2: not found" }
echo "--- Edge ---"
"msedge.exe: $(Test-Path 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe')"
echo "--- claude version + install ---"
claude --version
```

For reference, the **author's** PC measured:

| Item | Result |
|---|---|
| node / npm | not installed |
| rust / cargo | not installed |
| python | Microsoft Store alias stub only — **not real Python** |
| VS Code / Cursor / Windsurf | not installed |
| winget | available |
| WebView2 runtime | 150.0.4078.105 installed |
| msedge.exe | present |
| claude | 2.1.221, native install at `C:\Users\Lion\.local\bin\claude.exe` |

---

## Option A — VS Code + Claude Code extension

**Zero build. Test this before building anything.**

```powershell
winget install Microsoft.VisualStudioCode
```

Then install the Claude Code extension from the marketplace.

**Why it addresses all three problems:**

| Problem | How A solves it |
|---|---|
| Setup doesn't carry over | Same `claude` binary, same `~/.claude` directory — every skill, hook, `CLAUDE.md`, permission rule and the existing login carry over unchanged |
| Persian alignment wrong | The extension panel is a webview — HTML rendering, so BiDi and Arabic shaping are handled natively by the browser engine |
| No real PC/project control | It drives the real CLI, so Bash / Read / Write / Edit / Glob / Grep all work as normal |

Plus: the colleague never opens a terminal.

**Unverified:** whether the panel's own CSS aligns Persian RTL correctly. This is the one thing to test. It is a 10-minute check versus weeks of building Option B.

**Test procedure:** install, open the panel, paste a Persian paragraph mixed with a Windows file path such as `C:\Users\Lion\Desktop\test.md`, and check that (a) the Persian text is right-aligned and reads right-to-left, and (b) the path is **not** mangled or reversed.

---

## Option B — thin GUI wrapper over the headless CLI

Spawn `claude -p --output-format stream-json --input-format stream-json`, parse the NDJSON event stream, and render it in HTML that you fully control.

**Why this beats an Agent SDK rebuild:** it *is* Claude Code. Same process, same config directory, same subscription auth. No config-parity work, no API-credit billing surprise.

### Runtime choice

Pick after running the probe above.

| | Install needed | Notes |
|---|---|---|
| **B1** — Node + Electron or Tauri | `winget install OpenJS.NodeJS` | Most examples and documentation available. Heaviest bundle. Side benefit: unblocks the `nano-banana` MCP server, which is currently blocked on Node being absent. |
| **B2** — Python + local HTTP server, rendered in Edge app-mode | `winget install Python.Python.3.12` (the Store alias stub will not work) | **Recommended default.** WebView2 and Edge are already present on Windows 11, so no Electron bundle is needed. `msedge --app=http://localhost:PORT` produces a chrome-less desktop window. The colleague double-clicks a shortcut. |
| **B3** — PowerShell `System.Net.HttpListener` + static HTML | none | Zero install, fully native Windows. Streaming NDJSON from a subprocess in PowerShell is genuinely painful to write. Only choose this if no install is permitted on the target PC. |

### Design problems to solve during the build

1. **Permission prompts.** Headless mode has no TUI to approve tool calls. The user's `permissions.defaultMode` is set to `"auto"` at user scope, which covers most cases, but decide the fallback explicitly: `--permission-mode`, allow-rules in `permissions.allow`, or a custom approval UI in the wrapper.
2. **Session continuity.** Use `--input-format stream-json` to push successive turns into one long-lived process instead of respawning per message. Use `--resume <session-id>` or `--continue` for reconnect after a crash or restart.
3. **Transcript replay.** `~/.claude/projects/<sanitized-cwd>/*.jsonl` holds the full session history as newline-delimited JSON. Useful as an alternate read path for rendering history without re-running anything.
4. **Persian/RTL rendering.** See the companion file `claude-persian-rtl-spec.md` — hand it to the builder verbatim.

---

## Recommended decision path

1. Run the probe on the colleague's PC.
2. Install VS Code, install the Claude Code extension, run the Persian test described in Option A.
3. If the RTL alignment is acceptable → **done, ship Option A.** No build.
4. If it is not → build **Option B2** (or B1 if Node is already installed on the target PC, or B3 if nothing may be installed).

Do not start with Option B. The zero-build path may already solve it.

---

## Open questions for the follow-up session

- Does the Claude Code VS Code extension panel handle RTL correctly? (blocking — decides A vs B)
- Is the colleague's PC locked down against software installs? (decides B1/B2 vs B3)
- Does the colleague need to work on their own projects, or shared ones? (affects where the wrapper sets its working directory)
- Should the wrapper UI itself be in Persian, or only the message content? (affects scope significantly)
