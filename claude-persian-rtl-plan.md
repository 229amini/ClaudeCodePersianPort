# Plan — Persian RTL Front-End for Claude Code

**Written:** 2026-08-04
**Inputs:** `claude-persian-rtl-spec.md` (rendering rules — binding, hand to builder verbatim), `claude-persian-rtl-options.md` (decision context)
**Decisions made by user:**
- Scope: full decision path (probe → Option A gate → Option B build)
- Option B runtime: **B2 — Python + Edge app-mode**
- UI language: **Persian UI, full RTL chrome**
- v1 features: permission approval UI, session resume + history, project/folder picker, slash commands + file attach, **near-parity with CLI** (statusline, todos, thinking, cost, modes)

This is a plan only. No implementation has been started.

---

## Phase 0 — Probe the target PC (~30 min)

Run the probe script from `claude-persian-rtl-options.md` §"Probe the target PC first" on the **colleague's** machine. Record:

1. `claude` version and install path (must exist and be logged in — verify `claude --version` and that `~/.claude` has the expected settings/skills).
2. WebView2 + `msedge.exe` presence (required for B2's app-mode window).
3. Whether `python` is real or the Store alias stub.
4. Whether `winget` works and whether installs are permitted at all.

**Decision matrix from probe:**

| Probe result | Consequence |
|---|---|
| Installs forbidden entirely | B2 impossible → fall back to B3 (re-plan; out of scope here) |
| Edge/WebView2 missing | Use default browser tab instead of `--app` window (degraded but works) |
| Node already present | Reconsider B1 only if Python install is blocked; otherwise stay B2 |
| `claude` missing or logged out | Install/login first — blocking for everything |

Also capture on the target PC: `~/.claude/settings.json` contents (especially `permissions.defaultMode`, `statusLine`, hooks) — the wrapper must respect these, and the statusline feature reuses them (see B-7).

---

## Phase 0.5 — Automated bootstrap (`setup.ps1`)

Assume the target PC has **nothing** installed. All prerequisites are installed by one script — the colleague (or whoever sets up the machine) runs a single file; no manual winget commands, no PATH fiddling.

**Entry point:** `setup.bat` containing `powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"` — double-clickable, sidesteps execution policy without changing system settings.

**`setup.ps1` responsibilities, in order (idempotent — every step checks before acting, safe to re-run):**

1. **Probe** — runs the Phase 0 probe inline, logs results to `setup-log.txt` (becomes the probe record; no separate manual probe run needed).
2. **winget check** — if winget itself is missing/broken (possible on unmanaged or older images), fall back to direct-download installers:
   - Python: `https://www.python.org/ftp/python/3.12.x/python-3.12.x-amd64.exe` with `/quiet InstallAllUsers=0 PrependPath=1 Include_test=0`
   - VS Code: `https://update.code.visualstudio.com/latest/win32-x64-user/stable` with `/VERYSILENT /MERGETASKS=!runcode`
3. **Claude Code** — if `claude` missing: native installer `irm https://claude.ai/install.ps1 | iex`. If present: log version. **Login cannot be automated** — if `claude` is not authenticated, the script launches the login flow and pauses with a Persian on-screen instruction; this is the single manual step.
4. **Phase 1 prerequisites (only when testing Option A):** `winget install Microsoft.VisualStudioCode --silent --accept-package-agreements --accept-source-agreements`, then `code --install-extension anthropic.claude-code` (verify exact extension id at build time).
5. **Phase 2 prerequisites (Option B path):** `winget install Python.Python.3.12 --silent ...`. Then **verify the Store alias stub is defeated**: run `python --version` from a fresh environment; if the stub still shadows real Python, use the full path to the installed `python.exe`/`pythonw.exe` in `run.vbs` instead of relying on PATH (more robust than editing App Execution Aliases programmatically — do this unconditionally, actually: shortcut always uses absolute interpreter path).
6. **WebView2/Edge** — verify presence (Windows 11 default); if Edge somehow absent, winget `Microsoft.Edge`; if that fails, mark "browser-tab fallback" in the log.
7. **Deploy wrapper** — copy `persian-claude-gui/` to `%LOCALAPPDATA%\persian-claude-gui\`, write the desktop shortcut (Persian name, e.g. «کلود», custom icon) pointing at `run.vbs` with the absolute `pythonw.exe` path baked in.
8. **Smoke test** — start the server, send one no-op request to the local API, confirm `claude -p` round-trips one trivial prompt, print pass/fail summary (Persian) and exit.

**PATH freshness gotcha:** installs in the same PowerShell session don't refresh `PATH`. The script must re-read `PATH` from the registry (`Machine` + `User` scopes) after each install, or call binaries by absolute path — never assume `python`/`code`/`claude` resolve immediately after their installer finishes.

**Offline/locked-down fallback:** if the target PC blocks downloads, `setup.ps1` accepts a `-Payload <dir>` switch pointing at a USB-stick folder with the offline installers (Python exe, VS Code exe, Vazirmatn fonts are already vendored in the wrapper). Prepare that folder as part of M7 packaging.

The author's dev PC uses the same script (it also lacks real Python) — one code path, tested twice before it ever reaches the colleague.

---

## Phase 1 — Option A gate: VS Code + Claude Code extension (~1 hr)

Install via `setup.ps1` step 4 (VS Code + extension, silent). Open the panel, then run **all 8 test cases** from `claude-persian-rtl-spec.md` §"Test cases" inside the panel. Tests 3 (Persian sentence containing a Windows path) and 4 (code block after Persian) are the blockers.

**Gate criteria — Option A ships only if ALL hold:**

1. Tests 1–5, 7, 8 pass in the extension panel (test 6 / ZWNJ keybinding is not controllable in the extension — check whether pasting a ZWNJ at least survives; typing convenience is a known loss).
2. The colleague accepts an **English UI** — VS Code has no official Persian language pack, so the "Persian UI" preference **cannot be met by Option A**. This is a real conflict with the user's decision; surface it explicitly at the gate:
   - If Persian UI is a hard requirement → Option A fails the gate regardless of rendering.
   - If Persian message rendering alone is acceptable → A can ship.
3. Extension covers enough of the feature list natively (it has permission prompts, session history, file context; check statusline equivalent).

**If A passes:** pin VS Code + panel as the workflow, create a desktop shortcut opening the project folder, done — skip Phase 2 entirely.
**If A fails:** proceed to Phase 2 with the failure noted (which tests failed — informs whether the wrapper needs extra care in the same areas).

---

## Phase 2 — Option B2 build plan

### B-0. Architecture

```
┌───────────────────────────────┐
│ Edge --app=http://127.0.0.1:P │  chrome-less window, Persian RTL UI
│  index.html + app.js + css    │
└──────────────┬────────────────┘
        SSE (events) ↓ ↑ POST /api/* (JSON)
┌──────────────┴────────────────┐
│ server.py — Python 3.12       │  stdlib only: http.server / threading /
│  · subprocess mgr             │  subprocess / json / tkinter (folder dlg)
│  · NDJSON parser              │
│  · session/transcript reader  │
│  · permission broker          │
└──────────────┬────────────────┘
        stdin (stream-json) ↓ ↑ stdout (stream-json NDJSON)
┌──────────────┴────────────────┐
│ claude -p                     │  real CLI: same binary, ~/.claude,
│  --input-format stream-json   │  skills, hooks, subscription auth
│  --output-format stream-json  │
│  --include-partial-messages   │  (verify flag — see B-9)
└───────────────────────────────┘
```

- **Transport:** SSE (`GET /api/events`) for server→client streaming; plain `POST` for client→server. Both are stdlib-doable; no WebSocket dependency (Python stdlib has none).
- **One long-lived `claude` process per open project.** New user turn = one NDJSON `user` message written to stdin. No respawn per message.
- **Binding:** `127.0.0.1` only, random free port, single-use token in the app URL (`?t=...`) checked on every request — prevents other local users/processes from driving the wrapper.
- **Launch:** a desktop shortcut runs `pythonw.exe server.py` (no console window); server picks a port, then spawns `msedge --app=http://127.0.0.1:PORT/?t=TOKEN`. Server watches the SSE connection: when the last client disconnects and doesn't return within ~10 s, shut down the `claude` subprocess and exit.

### B-1. File layout

```
persian-claude-gui/
  setup.bat              # double-click entry — runs setup.ps1 with ExecutionPolicy Bypass
  setup.ps1              # automated bootstrap (Phase 0.5): probe, install, deploy, smoke test
  server.py              # HTTP + SSE + subprocess + permission broker
  permission_mcp.py      # only if permission mechanism requires an MCP tool (B-5)
  static/
    index.html
    app.js               # rendering, state, composer
    style.css            # RTL chrome + spec CSS verbatim
    strings.fa.js        # Persian UI labels (single flat object)
    vendor/marked.min.js # vendored locally — offline requirement, no CDN
    fonts/Vazirmatn-*.woff2  # self-hosted, per spec
  run.vbs                # silent launcher for the shortcut
```

No framework, no build step, no npm. One `winget install Python.Python.3.12` is the entire toolchain.

### B-2. Rendering layer (binding: `claude-persian-rtl-spec.md`)

Apply the spec verbatim, plus these resolutions the spec leaves open once the chrome itself is RTL:

- **Chrome vs content:** `<html dir="rtl" lang="fa">` for the app shell (Persian UI decision). The spec's core rule ("never global `dir=rtl`") is satisfied by discipline, not by keeping the page LTR: **every content-bearing element carries its own direction** — each `.msg` gets `dir="auto"` + `unicode-bidi: plaintext`; every `pre/code/.path/.diff/.tool-output` gets `direction:ltr; unicode-bidi:isolate; text-align:left`. Spec tests 3 and 4 remain the acceptance check that this discipline actually held.
- **Chrome paths:** the statusline, tab titles, and folder picker display Windows paths **inside RTL chrome** — every one of them must use the `.path` class (LTR + isolate + `<bdi>`). This is the most likely place for a regression the spec's message-focused tests won't catch; add explicit test cases (B-10).
- **Markdown:** render assistant markdown with vendored `marked`, then post-process the resulting DOM: wrap inline `<code>` output per spec, keep fenced blocks LTR-isolated, add `dir="auto"` per block-level element (paragraph-level BiDi, so a Persian paragraph and an English paragraph in one message each align correctly).
- **Digits:** Latin digits everywhere in code/paths/versions/costs per spec rule 5. Persian digits only if trivially cheap in pure-prose UI labels — otherwise skip entirely (YAGNI).
- **Scrollbar:** message list is RTL chrome → scrollbar left, consistently across all panes (spec rule 7).
- **Composer:** `dir="auto"` on the textarea; ZWNJ on Shift+Space per spec rule 6 (use `beforeinput`/`setRangeText` instead of deprecated `execCommand` if trivial; otherwise `execCommand` still works in Chromium — not worth fighting). **Verification item:** ZWNJ survives the JSON round-trip to the CLI and back into the transcript.

### B-3. Stream handling

Parse NDJSON events from stdout. Minimum event coverage for CLI parity:

| Event | UI treatment |
|---|---|
| `system/init` | capture `session_id` (for resume), model, cwd, tools → statusline |
| `assistant` text deltas | stream into current bubble (needs `--include-partial-messages`; else render per complete message — degraded, still shippable) |
| `assistant` `thinking` blocks | collapsed "thinking…" section, toggleable (parity with CLI verbose) |
| `assistant` `tool_use` | tool card: name + key params (paths through `.path`), collapsible |
| `user` `tool_result` | append into the matching tool card; diffs/terminal output LTR-isolated |
| TodoWrite tool calls | render as the CLI's todo checklist panel |
| `result` | turn cost, duration, token usage → statusline; error subtype → error banner |

Unknown event types: render as a collapsed raw-JSON card, never crash — the stream format grows over time.

### B-4. Sessions, resume, history

- **Continuity:** keep the process alive across turns (stream-json stdin). On crash/restart of wrapper or CLI: respawn with `--resume <session_id>` (captured from `init`).
- **History browser:** read `~/.claude/projects/<sanitized-cwd>/*.jsonl` directly. Session list = files sorted by mtime with first-user-message preview; opening one replays it through the same renderer used for live events (one renderer, two sources — no separate history code path). "ادامه" (continue) button = spawn with `--resume` on that file's session id.
- **Project/folder picker:** `tkinter.filedialog.askdirectory` invoked server-side (stdlib, native Windows dialog), plus a recents list persisted in a small JSON next to `server.py`. Switching project = stop current process, start new one with new cwd.

### B-5. Permission approval UI (blocking design question — resolve first in build)

Headless mode has no TUI prompt. Target PC has `permissions.defaultMode: "auto"` at user scope, which handles most calls, but the wrapper must handle the remainder explicitly or it will silently hang. Two candidate mechanisms — **verify which works on the installed CLI version before building anything else on top:**

1. `--permission-prompt-tool` pointing at a tiny stdio MCP server (`permission_mcp.py`): CLI calls the tool when a permission decision is needed → MCP server forwards to `server.py` (local socket/pipe) → GUI shows Persian approve/deny dialog with the tool name + params (paths LTR-isolated) → response flows back.
2. Control-protocol permission requests over the existing stream-json stdin/stdout channel (the mechanism the Agent SDK uses), if the CLI exposes it to plain `-p` consumers.

Prefer whichever is verified to work with the least moving parts; (1) is the documented headless mechanism, so assume (1) until testing says otherwise. Include "always allow this tool for this session" as a checkbox that appends a session-scoped allow rule.

### B-6. Slash commands, skills, file attach

- **Slash commands / skills:** send as plain text (`/skill-name args`) over stream-json — the CLI resolves them. **Verification item:** confirm built-in and custom skills trigger in `-p` mode on the target version; list any that don't as known losses.
- Composer autocomplete: on typing `/`, show a Persian-labeled popup listing skills read from `~/.claude/skills-catalog.md`-adjacent dirs (`~/.claude/skills/`, project `.claude/skills/`) — names LTR-isolated, descriptions as-is.
- **File attach:** paperclip button → file dialog → for text files, inline as an `@path` mention in the message (CLI-native behavior); for images, base64 `image` content block in the stream-json user message. **Verification item:** exact accepted content-block shape for images on this CLI version.

### B-7. Statusline + CLI parity chrome

- Bottom statusline: model name, cwd (`.path`), session cost, context-usage indicator, permission mode — all from `init`/`result` events.
- If target `~/.claude/settings.json` defines a custom `statusLine` command: run it server-side on each `result` event with the same JSON input contract the CLI uses, display its output (LTR-isolated). This inherits the user's existing statusline instead of reimplementing it.
- Mode switching (plan mode etc.): expose only what stream-json input actually supports on the installed version — probe first, don't promise. Known-unavailable CLI features (e.g. `Esc` interrupt semantics, `!` shell passthrough) get a short "known differences" list in the final handoff rather than half-built imitations.
- Interrupt button ("توقف"): verify the supported mechanism (control message vs signal) — a non-technical user needs a working stop button; killing the process loses the session, so `--resume` on next message is mandatory fallback.

### B-8. Persian UI strings

All chrome labels from `strings.fa.js` (flat key→string object, no i18n framework). Persian labels for: send, stop, new session, sessions list, continue, project picker, attach, approve/deny/always-allow, thinking toggle, settings. Digits in labels stay Latin where they abut technical values.

### B-9. Verification checklist (run during build, before feature work)

Ordered — each gates work stacked on it:

1. `claude -p --output-format stream-json --input-format stream-json` works on target version; does it require `--verbose`?
2. `--include-partial-messages` exists → token streaming; absent → per-message rendering fallback.
3. Permission mechanism (B-5): which of the two works.
4. Slash commands / skills fire in `-p` mode.
5. Image content-block shape accepted on stream-json input.
6. ZWNJ survives composer → CLI → transcript round-trip.
7. Long-lived process: second turn over same stdin lands in same session (session_id stable).
8. `--resume` from wrapper-spawned session works after kill.
9. Hooks (SessionStart, UserPromptSubmit) fire in `-p` mode as they do interactively.

### B-10. Acceptance tests (on the target PC, with the colleague)

1. All 8 test cases from `claude-persian-rtl-spec.md` — in the live message view **and** in history replay.
2. Chrome-path tests: statusline cwd, session list previews, folder picker, tool cards — no mangled path anywhere in RTL chrome.
3. Feature pass: send Persian prompt → streamed reply; trigger a permission prompt → approve in Persian dialog; kill wrapper mid-session → relaunch → continue same session; open old session from history; switch project via picker; run a skill via `/`; attach an image; stop button mid-generation.
4. The colleague completes a real small task end-to-end **without touching a terminal**.

### B-11. Milestones (build order)

| # | Milestone | Exit criterion |
|---|---|---|
| M0 | Probe + Phase 1 gate | A/B decision recorded |
| M1 | Verification spikes (B-9 items 1–5) | mechanisms confirmed, fallbacks chosen |
| M2 | Skeleton: server + spawn + SSE + plain-text chat | English round-trip works |
| M3 | Rendering: markdown, spec CSS, RTL chrome, Vazirmatn | spec tests 1–8 pass |
| M4 | Permissions UI | B-5 flow works end-to-end |
| M5 | Sessions: resume, history replay, folder picker | B-10 item 3 session parts pass |
| M6 | Parity chrome: statusline, todos, thinking, stop, slash, attach | remaining B-10 item 3 parts pass |
| M7 | Packaging + bootstrap: `setup.ps1`/`setup.bat` (Phase 0.5), shortcut, pythonw absolute path, port/token, shutdown-on-close, offline `-Payload` folder | on a machine with nothing installed: double-click `setup.bat` → working app, no console, no manual steps except `claude` login |
| M8 | Acceptance on target PC with colleague | B-10 fully green, installed via `setup.bat` only |

Everything through M3 is buildable/testable on the author's PC (requires the same `winget install Python.Python.3.12` here — author's PC also lacks real Python). M8 must happen on the target machine.

---

## Risks

- **Permission mechanism unverified** (B-5) — highest technical risk; that's why it's M1, not M4.
- **Persian-UI RTL chrome** doubles the surface where the spec's "isolate every technical fragment" rule can be violated — mitigated by the `.path` discipline and B-10 item 2.
- **Stream format drift** across CLI updates — mitigated by the unknown-event fallback card and pinning the tested `claude` version in the handoff notes.
- **Option A partially passing** (renders RTL fine, but English UI) — a judgment call the user must make at the gate, not a technical outcome. Flagged in Phase 1 criteria.
