# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

**M0–M7 done, 2026-08-04. No git repo yet.** The app is feature-complete and packaged: stdlib
server, real RTL Persian UI, token streaming, **spec tests 1–12 passing**, Persian permission
dialog, sessions (resume after a kill, history replay, folder picker), parity chrome (stop, slash
autocomplete, attach, statusline passthrough), and a one-double-click `setup.bat` bootstrap.
**All ten §B-9 verification items are answered.**

**2026-08-05: claude.ai-style shell redesign** (user-approved: dark-only, Codex-style right
sidebar with projects→sessions, home greeting state, `/api/projects` + cross-project
resume/replay/delete). Spec tests re-passed after the redesign. See
`wiki/rtl-rendering-notes.md` (new CSS traps) and `wiki/sessions-and-history.md` (new endpoints).

**2026-08-05: rework underway — see `REWORK-PLAN.md`, tracked as beads `pcg-b67`
(`bd list --tree`).** Phases 0–4 are closed. Phase 2 split `static/app.js` into ES modules under
`static/js/` (seven since Phase 4 added `controls.js`) and put `style.css` on cascade layers; read
`wiki/frontend-modules.md` before touching either. **Phase 4 made the GUI a capability mirror**:
the model picker, slash popup and approval pill are rendered from what `initialize` returned, and
every live change goes through `/api/control` or `/api/posture` — nothing about the CLI is
hardcoded. Read `wiki/approval-postures.md` before touching the pill, and note that `compact` is
**not** a control subtype on this build. Phase 5 (Codex-style shell + rebrand) is next.

**M8 — acceptance on the colleague's PC — is the only milestone left, and it cannot be done from
this machine.** Note that M7's install branches (Python install, Claude Code install, `-Payload`
offline, not-logged-in) never executed here because this PC already has both tools; see
`wiki/packaging.md`. Do not report the bootstrap as proven end-to-end until it has run on a bare
machine.

Before touching anything, read `wiki/cli-stream-json-findings.md` — it holds the measured CLI
contract and it already invalidates part of the plan. Then, by area:
`wiki/dev-environment.md` (**the repo moved machines — the interpreter path in older docs is
wrong**), `wiki/frontend-modules.md` **and** `wiki/rtl-rendering-notes.md`
before editing `static/`, `wiki/permission-transport.md` + `wiki/control-protocol.md` before
touching approvals or any control request — both document failure modes that produce no error
message at all, only a cheerful `success` — `wiki/sessions-and-history.md` before
touching restart, replay, or the renderer's `user` case, `wiki/parity-chrome.md` for the
interrupt/slash/attach/statusline contracts, and `wiki/packaging.md` before editing `setup.ps1`
or `run.vbs` — all three of their encoding rules fail silently and corrupt Persian.

The three source documents, all 2026-08-04, remain authoritative for everything not yet
measured. Read the relevant one rather than trusting this summary:

- `claude-persian-rtl-plan.md` — scope, build order (M0–M8), every decision the user has made.
- `claude-persian-rtl-spec.md` — **binding** rendering rules: base CSS, 7 numbered rules, the 8
  test cases, and a "looks like a solution but isn't" list. Hand to the builder verbatim. Do not
  paraphrase it into code comments; cite rule numbers.
- `claude-persian-rtl-options.md` — decision context, the Phase 0 probe script, verified
  `--print` flags, and what was already tried and rejected.

**Stale detail in the source docs:** they were written against a `C:\Users\Lion\...` profile and
record the author PC's `claude` at `C:\Users\Lion\.local\bin\claude.exe`, version 2.1.221. This
machine is `ladyg`. Treat every measured value in the options doc as a stale reference reading —
re-run the probe, never hardcode a path or version from those tables.

**Already settled — do not re-open.** The options doc's four "Open questions" are all answered by
the plan: Persian UI (not just message content), full decision path A→B, B2 runtime, and near-CLI
parity. Its rejected alternatives stay rejected: Claude Desktop (setup doesn't carry, wrong
direction, no PC control), BiDi terminals like mlterm (fixes glyph shaping only — Claude Code's
TUI is Ink-based and does its own cursor and cell-width math with no BiDi algorithm, so layout
stays broken), and an Agent SDK rebuild (config-parity work plus a likely shift from the
subscription to API credits).

## What is being built

A Persian, fully-RTL desktop front-end for the Claude Code CLI, for a non-technical colleague
who must never touch a terminal. Runtime decision is locked: **Option B2 — Python + Edge
app-mode**. Option A (VS Code extension) is a gate that is expected to fail on the
Persian-UI requirement, not a parallel track.

## Architecture

Three processes, one chain:

```
Edge --app=http://127.0.0.1:PORT/?t=TOKEN   chrome-less window, static/ UI
   ↓ POST /api/*        ↑ SSE GET /api/events
server.py (Python 3.12, stdlib only)         subprocess mgr, NDJSON parser,
   ↓ stdin stream-json  ↑ stdout stream-json  transcript reader, permission broker
claude -p                                     real CLI: same ~/.claude, skills,
                                              hooks, subscription auth
```

**Why a window and not a terminal.** The goal is the Claude Code CLI with full Persian
support. Windows terminals cannot deliver that. A terminal is a fixed grid of cells; Persian is
cursive, contextually joined, and requires reordering logical order for display. Windows Terminal
does some DirectWrite shaping, so joining is partly there, but BiDi reordering is a long-standing
unresolved gap and conhost is worse — mixed Persian/English lines come out in the wrong order,
and there is no ZWNJ input. A TUI cannot fix this from the inside, because the grid, not the
program, is the constraint. The Edge app-mode window is therefore not a "web app" in spirit — it is the terminal
replacement, chosen because a browser is the only Windows text renderer that shapes Persian
correctly for free. The real `claude` CLI still runs underneath, unmodified.
Do not re-litigate this toward a real TUI (user confirmed 2026-08-04: form is free, goal and
plan structure are fixed).

Load-bearing consequences:

- **The CLI is not reimplemented.** Auth, skills, hooks, and settings come from the target
  machine's real `~/.claude`. The wrapper must respect `permissions.defaultMode` and a custom
  `statusLine` command rather than reinventing them (plan B-7).
- **One long-lived `claude` process per open project.** A new turn is one NDJSON `user`
  message on stdin, never a respawn. `session_id` is captured from the `system/init` event and
  is the only recovery path — `--resume <session_id>` after any crash or kill.
- **SSE + POST, never WebSocket.** Python stdlib has no WebSocket server; that constraint
  drives the transport choice.
- **One renderer, two sources.** Live NDJSON events and replayed
  `~/.claude/projects/<sanitized-cwd>/*.jsonl` history go through the same rendering code.
  Do not fork a separate history path.
- **Server lifetime is tied to the window.** Last SSE client gone for ~10 s → kill the `claude`
  subprocess and exit.
- **Security:** bind `127.0.0.1` only, random free port, single-use token in the URL checked on
  every request.

## Non-negotiable constraints

- **Stdlib only, no build step, no npm, no CDN.** `http.server` / `threading` / `subprocess` /
  `json` / `tkinter` (folder dialog). `marked` and Vazirmatn fonts are vendored into
  `static/vendor/` and `static/fonts/` — the target PC may be offline or locked down.
- **BiDi discipline is the project's highest-frequency failure mode.** Apply
  `claude-persian-rtl-spec.md` as written — its base CSS and rules 1–7 are the contract, and its
  closing list names the traps (`text-align:right` without `direction`, reversing strings in JS,
  a manual direction toggle, expecting the font to fix direction).
  Two project-specific deltas the spec does not cover, both from plan §B-2:
  - The spec's core rule is "never global `dir=rtl`", but the Persian-UI decision makes the shell
    `<html dir="rtl" lang="fa">`. The rule then survives only by discipline — every
    content-bearing element carries its own direction. Spec tests 3 and 4 are the check that the
    discipline actually held.
  - **Windows paths in chrome** — statusline cwd, tab titles, folder picker, session previews,
    tool-card params — must all use `.path` (LTR + isolate + `<bdi>`). The spec's test cases are
    message-focused and will not catch a regression here; plan §B-10 item 2 is the sweep that does.

  Spec rule 6 supplies a ZWNJ handler using `document.execCommand`; plan §B-2 prefers
  `beforeinput` / `setRangeText` if that is trivial, and accepts `execCommand` in Chromium
  otherwise. Either is spec-compliant — the binding part is that `Shift+Space` inserts `U+200C`
  and that it survives the round-trip to the CLI and back.
- **Absolute interpreter path** in `run.vbs`. Never rely on `python` resolving via PATH — the
  Store alias stub shadows it, and installs in the same PowerShell session do not refresh PATH.
- **Unknown stream events render as a collapsed raw-JSON card.** The NDJSON format drifts across
  CLI versions; crashing on an unrecognized type is a defect.

## Build order

Verification before features. Plan §B-9 items 1–3 are answered and recorded in
`wiki/cli-stream-json-findings.md`:

1. **`--verbose` is required** alongside `-p --output-format stream-json`, or the CLI refuses.
2. **`--include-partial-messages` exists** — token streaming, no per-message fallback needed.
3. **The plan's permission design is dead, and so is its M4 replacement.** `--permission-prompt-tool`
   is absent from `--help` but **present in the arg parser**: spawning with
   `--permission-prompt-tool stdio` routes approvals to inbound `can_use_tool` control requests,
   verified allow and deny (`wiki/permission-transport.md`). The M4 `PreToolUse` hook injected via
   `--settings` does not fire at all on this build (`wiki/permission-hook-broken.md`);
   `permission_hook.py`, `space_safe()` and the HTTP callback were **deleted 2026-08-05**. Neither
   `permission_mcp.py` nor `permission_hook.py` exists — the broker is in-band in `server.py`.
4. **Slash commands work** as plain text; `init.slash_commands` is the authoritative list.
5. **Image blocks accepted** — standard `{"type":"image","source":{"type":"base64",…}}`.
6. **ZWNJ survives** the composer → CLI → renderer round-trip.
7. **`session_id` is stable** across turns on one long-lived process.
8. **`--resume` survives a hard kill** and reuses the same `session_id` rather than forking.
9. ~~**Hooks fire in `-p` mode**~~ — **false on 2.1.221+.** Hooks from the user's real
   `~/.claude/settings.json` fire; hooks supplied via `--settings` never do. See item 3.
10. **Interrupt** is a `control_request` on stdin; the process survives, so the session does too.
    The aborted turn arrives as `error_during_execution` / `aborted_streaming` — check
    `terminal_reason` **before** `is_error`, or every stop looks like a crash.

All ten answered. What remains is packaging (M7) and acceptance on the target PC (M8).

Milestones M0–M8 are in the plan's B-11 table with exit criteria. M0–M3 are buildable on the
author's PC; M8 requires the colleague's machine.

Record every verification answer in `wiki/` as it lands — those are the facts that cost the most
to rediscover, and they are version-pinned to the tested `claude` build.

## Verification

The one command that exists today is the probe: a paste-ready PowerShell block in
`claude-persian-rtl-options.md` §"Probe the target PC first". It checks for
node/npm/python/py/pip/cargo/rustc/uv/winget/claude/code, distinguishes real Python from the
Store alias stub, reads the WebView2 version from the registry, tests for `msedge.exe`, and
prints `claude --version`. `setup.ps1` step 1 is meant to run this inline and log it.

Entry points (plan §0.5, §B-1). **The interpreter is `C:\Python314\python.exe` on this machine** —
the `%LOCALAPPDATA%\Programs\Python\Python312` path quoted throughout the older docs belongs to
the previous author PC and does not exist here (`wiki/dev-environment.md`). Shipped code must
still use an absolute path: `python` is a Store alias stub on the target machine.

| What | Command | Exists |
|---|---|---|
| Dev run with console | `C:\Python314\python.exe persian-claude-gui\server.py --cwd <project> --no-window` | **yes** |
| Dev run with window | same, without `--no-window` (launches Edge app-mode) | **yes** |
| Full bootstrap | double-click `setup.bat` (→ `powershell -NoProfile -ExecutionPolicy Bypass -File setup.ps1`) | **yes** |
| Bootstrap into a test location | `setup.ps1 -DeployRoot <dir> -ProjectDir <dir> -ShortcutDir <dir> -SkipSmokeTest` | **yes** |
| Offline bootstrap | `setup.ps1 -Payload <usb-dir>` | yes, **untested branch** |
| Run the wrapper | `run.vbs` (silent `pythonw.exe server.py`), generated by setup | **yes** |

Two checks exist:

| Check | How | Asserts |
|---|---|---|
| Transport (M2) + capability mirror | `python persian-claude-gui\smoke_test.py` | boots the server, drives one real CLI turn, expects a `result` event and a 403 on a bad token. **Also asserts the Phase-4 claims whose acks lie**: `initialize` data, posture round-trip + `system/status` echo, `set_model` proven by the next turn's `system/init.model`, CLI-reported usage, and the session title read back out of the transcript. 9 checks, still one subscription turn. |
| Rendering (M3) | `python persian-claude-gui\run_spec_test.py` | the 12 spec cases through the shipping renderer, headless — 18 assertions, so `PASS — 18/18` is the gate. Exit 0 = pass. Free. Holds an SSE connection so the idle watchdog cannot kill the run; treats an empty verdict as FAIL, because a module that fails to load looks identical to silence |
| Permissions (M4) | run the server, ask for a `Write` | dialog appears; allow creates the file, deny does not, "remember" skips the next prompt. Approvals now arrive in-band as `can_use_tool` control requests, so a missing dialog means the spawn lost `--permission-prompt-tool stdio` — not a hook problem. `--hook-log` is gone. |
| Sessions (M5) | drive `/api/sessions`, `/api/session`, `/api/session/resume`, `/api/project/open` | list/preview/order, replay filtered to user+assistant, traversal guard, resume adopts the session id, project switch rejects a bad folder. **Hold an SSE connection open** or the idle watchdog kills the server mid-run. |
| Transcript guard | `python persian-claude-gui\test_transcript_path.py` | `transcript_path()` resolves real ids and rejects traversal — the one choke point `read_session` and session delete both route through. No server, no CLI, no cost. |

Set `PYTHONIOENCODING=utf-8` before driving the server from PowerShell or Persian mojibakes in
the console. There is no Playwright here (no node) **and the Claude-in-Chrome extension is not
connected**, so there is no automated *visual* check at all — `run_spec_test.py` covers computed
styles and DOM structure, and anything that must be seen is a manual acceptance item. Headless
`--screenshot` renders blank on this machine; do not spend time on it (`wiki/dev-environment.md`).

`setup.ps1` must stay idempotent — every step checks before acting, safe to re-run (verified by
running it twice). It ends in the smoke test above. **It must stay UTF-8 with BOM**, and the
`run.vbs` it generates must stay UTF-16LE with BOM; see `wiki/packaging.md` for why both fail
silently otherwise.

Acceptance is plan §B-10: the 12 spec test cases in *both* live view and history replay, the
chrome-path sweep, the feature pass, and the colleague completing a real task without a terminal.
**`M8-acceptance.md` at the repo root is the executable checklist** — it expands §B-10 with the
failure modes M0–M7 actually uncovered (username with a space, non-ASCII username, the four
install branches that have never run anywhere).

The colleague-facing Persian guide is `static/help.html`, reachable from the «راهنما» button in
the app and openable directly from the deployed folder. Keep it in sync when behaviour changes —
it is the only documentation that audience will ever read.

## Skills (project)

stack: python-stdlib backend + vanilla HTML/CSS/JS frontend (`ui-ux-pro-max` stack:
`html-tailwind`) + PowerShell bootstrap

selected:
- `ui-ux-pro-max`: Use when building or reviewing anything in `static/` — the chat view, tool
  cards, permission dialog, statusline, session list.
- `emil-design-eng`: Use when deciding interaction feel for streaming text, collapse/expand
  toggles, the stop button, and dialog transitions. This is a calm tool for a non-technical
  user — restraint, not maximalism.
- `webapp-testing`: Use for visual QA of the running localhost app: RTL screenshots, the
  chrome-path sweep (B-10 item 2), browser console errors.

How:
- Auto-activate the matching skill per task.
- Prefer one skill at a time.
- Announce once: `I activated <skill> for <reason>.`
- Do not activate skills for unrelated work.
- Never pair `emil-design-eng` with `gpt-taste` / `high-end-visual-design` — opposing
  philosophies. This project is committed to the calm direction.
- No UI skills for `server.py`, `setup.ps1`, or the verification spikes.

All three are already installed globally — no install, no reload needed.


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:6cd5cc61 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->
