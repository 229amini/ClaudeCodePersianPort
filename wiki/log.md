# Session log

Newest first. One entry per session that produced a decision, a verification answer, or a
discovered gotcha. Keep entries short — point at code and at other wiki files instead of
restating them.

## 2026-08-05 — rework Phase 5: Codex-style shell + rebrand

- **Rebrand to «کلاد فارسی»** with an original mark — a mirrored terminal prompt (`_<`), coral
  tile. «کلود» is gone from the UI, `setup.ps1` and `help.html`; the CLI is «کلاد کد» where it has
  to be named. `assets/make_icon.py` is new: the previous icon's generator was never committed, so
  the icon could not be regenerated at all. Disclaimer «این پروژه مستقل است و وابسته به Anthropic
  نیست.» now sits at the foot of `help.html`. Detail in `packaging.md`.
- **Home: four action cards; sidebar: 300 ms hover preview.** Both wired to endpoints that already
  existed — Phase 5 added no server route. The resume card hides itself when the folder has no
  earlier session rather than offering a dead button. `help.html` documents both.
- **First visual QA this project has ever had.** The Chrome extension is connected now
  (`dev-environment.md` §"Seeing the running app" — the watchdog will kill the server out from
  under you unless you hold an SSE connection). It immediately caught two things the 18/18 spec
  gate structurally cannot see, and both were real:
  - every session started outside the wrapper was titled `<local-command-caveat>Caveat: The
    messages below we…`;
  - the hover card opened half-on-top of the sidebar, because it anchored on the row button rather
    than the pane.
- **The bug underneath the first one:** `user` transcript content has **two** shapes, and the
  array-only code failed silently in two places (no preview, and replay iterating a string
  character by character → zero user bubbles). Fixed once in `server.py`'s `user_prompt_text()`,
  used by both `session_meta()` and `read_session()`, which now normalises and envelope-filters
  server-side so the client still sees exactly one shape. `sessions-and-history.md`.
- Gates: spec **18/18**, `test_transcript_path.py` PASS, `smoke_test.py` **9/9** (one paid turn).

## 2026-08-05 — rework Phase 4: capability-mirror composer

- Shipped: Jalali/Persian-digit dates in the sidebar (`Intl.DateTimeFormat('fa-IR')`), slash popup
  fed from `initialize` with descriptions + argument hints, model picker and 3-posture approval
  pill rendered from the account's own model list, real session titles via `rename_session`, and
  statusline numbers from `get_context_usage`/`get_usage` instead of client arithmetic.
  New module `static/js/controls.js` (`frontend-modules.md`); posture design in
  `approval-postures.md`.
- **Three fixes that came out of measuring rather than trusting the plan:**
  - `compact` is **not** a control subtype (`Unsupported control request subtype`) — removed from
    the whitelist, `/compact` passes through as text. The plan's `/compact → /api/control` step
    would have failed every time.
  - `set_permission_mode` accepts `default` (so the cautious posture works) but silently answers
    `success {"mode":"default"}` for `manual`. `control-protocol.md` §6.
  - `/api/control` params could carry `timeout`/`wait` straight into the transport's own kwargs.
    Rejected now.
- **Effort picker deliberately not built.** `apply_flag_settings` acks any garbage, so live effort
  switching cannot be verified for free (`control-protocol.md` §5) — and a greyed control that
  explains it does nothing is clutter for this audience. `--effort` remains a spawn flag.
- `smoke_test.py` now asserts the whole capability mirror in its **same single paid turn**:
  initialize data, posture round-trip + `system/status` echo, `set_model` proven by the next
  turn's `system/init.model`, usage numbers, and the session title read back out of the transcript.
  9/9 PASS. Spec gate still 18/18.

## 2026-08-04 — M8 materials written

- `M8-acceptance.md` (repo root) — the executable acceptance checklist. Expands plan §B-10 with
  what M0–M7 actually turned up: username-with-a-space (kills tool approvals via the 8.3 path),
  non-ASCII username (`run.vbs` encoding), the reply-language question (inherited from the
  colleague's own `~/.claude`, not a wrapper bug), and the four install branches that have never
  executed anywhere.
- `static/help.html` — Persian user guide for the colleague, RTL, Vazirmatn, standalone so it
  also opens by double-click from the deployed folder. Wired to a «راهنما» button in the top bar.
  Covers: starting, ZWNJ on Shift+Space, what the permission dialog means and that denying is
  safe, stop, sessions/resume, folder switching, attachments, slash commands, and the deliberate
  known differences from the CLI.
- Keep `help.html` in sync with behaviour changes — it is the only documentation that audience
  will ever read.

## 2026-08-04 — M7 done on this machine (packaging)

- `setup.bat` + `setup.ps1` (Persian output, idempotent, no winget), generated `run.vbs`, desktop
  shortcut «کلود» with a stdlib-generated icon. Detail in `packaging.md`.
- Verified: runs twice cleanly, launches with **zero console windows**, opens the Edge app-mode
  window, and the server exits within 16 s of the window closing with no orphaned `claude`.
  Full run including the live smoke test passes.
- **Three encoding traps found, all silent:** `setup.ps1` needs a UTF-8 BOM (PS 5.1 reads ANSI
  otherwise), `run.vbs` needs UTF-16LE (wscript reads ANSI — would break a non-ASCII Windows
  username), and the `.lnk` Description is ANSI-lossy and rewrites Persian ی as ي, so it is
  ASCII now. The shortcut *name* is fine.
- **Honest gap:** the Python-install, claude-install, `-Payload` offline and not-logged-in
  branches never executed, because this PC already has both tools. M7 is not proven end-to-end
  until it runs on a bare machine.
- Next: **M8 acceptance on the colleague's PC** — the only remaining milestone, and it cannot be
  done from here.

## 2026-08-04 — M6 done (parity chrome). All §B-9 items answered.

- Spiked the last three unknowns first: **interrupt** (control_request over stdin — process
  survives), **slash commands** (plain text, work), **image blocks** (standard base64 shape,
  accepted). Detail in `parity-chrome.md`.
- Built: stop button, slash autocomplete driven by `init.slash_commands`, file attach
  (images → base64 blocks, others → `@path`), context-usage %, and **statusLine passthrough** —
  the machine's own statusline script, run per result, ANSI stripped.
- Verified in the browser: stop mid-stream shows «متوقف شد» not an error; `/co` → 5 real matches,
  Tab completes; a blue PNG attached in Persian answered «آبی»; thinking/todos/tool-cards and the
  unknown-event raw card all render.
- **Gap the test exposed:** busy state was set only by the composer's submit handler, so a turn
  started any other way left the stop button hidden. Now derived from the `user_echo` event.
- Deliberately NOT built (plan §B-7 says list them, don't imitate): mid-session mode switching,
  `!` shell passthrough, `Esc` semantics.
- Next: **M7 packaging** — `setup.ps1`/`setup.bat`, shortcut, `run.vbs`, offline `-Payload`.
  Remember `wiki/dev-environment.md`: no winget here, so direct-download is the primary path.

## 2026-08-04 — M5 done (sessions, history, folder picker)

- **B-9.8 answered first, before building on it:** `--resume` survives a hard kill and reuses the
  same `session_id` rather than forking. Detail in `sessions-and-history.md`.
- Added to `server.py`: transcript discovery with a fallback scan, session list with previews,
  history replay, `ClaudeSession.restart()`, folder picker in a child process, recents file.
  UI: top bar with cwd + buttons, sessions dialog, replay banner.
- 17/17 API checks pass, including a path-traversal guard on the session id. Verified in the
  browser: session list, history replay, and resume-from-banner.
- **Bug worth remembering:** replayed user turns did not render. Live the CLI never echoes the
  user's prompt (so the wrapper emits `wrapper/user_echo`), but transcripts *do* contain them as
  `user` events with `text` parts — and `renderEvent` only handled `tool_result` there. Replay
  looked like an assistant monologue. Both paths must stay working.
- Also: stale reader threads from the old process needed a generation counter, or their events
  leak into the new conversation after a restart.
- Next: **M6 parity chrome** — statusline detail, todos, thinking blocks, stop button
  (B-9.10 interrupt), slash commands (B-9.4), file attach (B-9.5).

## 2026-08-04 — M4 done (permissions)

- `permission_hook.py` + broker in `server.py` + Persian approve/deny dialog. Full detail in
  `permission-broker.md`.
- Verified: allow creates the file, deny blocks it, "remember" suppresses the next prompt for
  that tool. All four decisions confirmed in the hook log.
- **The expensive lesson:** the CLI splits a hook `command` on whitespace and ignores quotes, so
  a quoted command — or any path containing a space — silently disables the hook with no error
  anywhere. `cmd /c` does not fix it; 8.3 short paths do. `server.py:space_safe()` handles it and
  warns loudly if no short name is available. This will bite on the colleague's PC if their
  Windows username has a space.
- Also learned: `matcher` is a regex (`"*"` matches nothing, `".*"` works), and env vars do
  propagate server → claude → hook, so the token stays off disk.
- Next: **M5 sessions** — resume, history replay through the same renderer, folder picker.

## 2026-08-04 — M3 done (rendering)

- `static/` now holds the real UI: `style.css` (spec base CSS + RTL chrome + light/dark tokens),
  `app.js` (single renderer, IIFE-wrapped), `strings.fa.js`, vendored `marked` + Vazirmatn,
  and `spec-test.html`. Details and gotchas → `rtl-rendering-notes.md`.
- **Spec tests 1–8 pass**, verified in a real browser: 11/11 automated assertions plus visual
  confirmation that a Windows path inside Persian prose (test 3) and a code block after Persian
  (test 4) both render intact.
- Two bugs the browser caught: subresources were 403ing because they cannot carry `?t=`
  (fixed with a token cookie), and `app.js` collided on global `log`/`input` (fixed with an IIFE).
- **B-9.6 and B-9.7 answered.** ZWNJ survives composer → CLI → render byte-identical, and
  `session_id` stays stable across turns on one long-lived process.
- Statusline renders the cwd LTR-isolated inside RTL chrome — early evidence for the §B-10 item 2
  sweep, though the full sweep still needs session previews and tool cards, which do not exist yet.
- Next: **M4 permissions** — build the `PreToolUse` hook broker whose mechanism was proved in M1.

## 2026-08-04 — M0, M1 (partial), M2 done

- **M0 probe** run on this PC → `dev-environment.md`. Headline: **winget does not exist here**,
  so `setup.ps1`'s direct-download fallback is the primary path, not an edge case. Python was a
  Store alias stub; installed real 3.12.10 user-scope from python.org.
- **M1 spikes 1–3** → `cli-stream-json-findings.md`. Headline: **the plan's permission
  architecture does not exist on 2.1.221.** `--permission-prompt-tool` is gone and no control
  protocol surfaces permission requests; the CLI just auto-denies. Verified replacement is a
  `PreToolUse` hook injected with `--settings`. `permission_mcp.py` is deleted from the design.
- **M2 built and passing.** `persian-claude-gui/server.py` (stdlib HTTP + SSE + subprocess pump)
  and a skeleton `static/index.html`. `smoke_test.py` boots it, drives a real turn, asserts a
  `result` event and a 403 on a bad token. Token streaming via `--include-partial-messages`
  confirmed live (7 `stream_event`s for a one-word reply).
- Next: **M3 rendering** — vendor `marked` + Vazirmatn, build the real event renderer, get spec
  tests 1–8 passing.

## 2026-08-04 — project init

- `CLAUDE.md` written from `claude-persian-rtl-plan.md`. No code exists yet; the repo is a plan
  plus this wiki.
- Skills selected (all already global, no install): `ui-ux-pro-max`, `emil-design-eng`,
  `webapp-testing`. Design direction committed to calm/restrained — `gpt-taste` and
  `high-end-visual-design` are explicitly excluded.
- Confirmed with user: the deliverable is the Claude Code CLI with full Persian support; the
  runtime form is whatever achieves that, and the plan's structure is to be followed as written.
  Recorded the terminal-vs-window rationale in `CLAUDE.md` so it is not re-opened — Windows
  terminals do no BiDi/joining/ZWNJ, so the browser window is the terminal replacement, not a
  detour into "making it a web app".
- ~~Open blocker: missing spec + options docs.~~ **Resolved same day** — user supplied both.
  `CLAUDE.md` now points at them instead of restating their content.
- Facts extracted from the newly-supplied docs:
  - The mlterm rejection has a sharper reason than "terminals can't do BiDi": Claude Code's TUI
    is **Ink-based** and does its own cursor positioning and cell-width math with no BiDi
    algorithm. A BiDi-capable terminal fixes glyph shaping and leaves layout broken. This is why
    no terminal-hosted variant can work, and why xterm.js-in-a-window fails too.
  - Verified `--print` flags are listed in the options doc. `--include-partial-messages` and
    `--permission-prompt-tool` are **not** among them — B-9 items 2 and 3 are genuinely open.
  - Source docs are written against a `C:\Users\Lion\...` profile; this machine is `ladyg`. Every
    measured path/version in the options doc tables is a stale reference reading. Re-probe.
  - The options doc's four "Open questions" are already answered by the plan's decisions. Closed.
- **Next step: M1 verification spikes** (plan §B-9 items 1–5). Nothing else is blocked.
