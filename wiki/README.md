# Wiki index

Project memory for the Persian RTL Claude Code front-end. One topic per file, kebab-case.
Write here when a session learns something a future session would otherwise re-derive —
especially the §B-9 verification answers, which are pinned to a specific `claude` version.

- [bridgemind-one.md](bridgemind-one.md) — a commercial Tauri wrapper measured 2026-09-06: same
  `stream-json` + `can_use_tool` transport as ours, broader (3 CLIs, panes, conpty) but no RTL.
- [editions.md](editions.md) — **two editions, one engine (2026-09-05).** Web «کلاد فارسی» in
  `static/`, terminal «کلاد فارسی — ترمینال» in `static-terminal/`, picked by `--ui` /
  `PCG_UI`; which tests gate which edition; why the shortcut once said v1.1.0 on the wrong tree.
  Its sidebar section is now **right-edge** (moved back 2026-09-10) and carries the `--side-w`
  rule, the two-inset `[popover]` trap, and the gate that measured the wrong box for a commit.
  Since 2026-09-24 (BridgeMind port P1) the sidebar and panes are cards on a ground, one
  gutter in — and `test_layout.py`'s edge check moved with them.
- [cli-stream-json-findings.md](cli-stream-json-findings.md) — **read first.** Measured CLI
  contract on 2.1.221: required flags, every event type seen on the wire, and the permission
  mechanism that actually works (it is not the one in the plan).
- [permission-transport.md](permission-transport.md) — **the approval mechanism that works.**
  Hidden spawn flag `--permission-prompt-tool stdio` + inbound `can_use_tool` control requests,
  verified allow and deny. `permission_hook.py`, the 8.3 short-path hack and the HTTP callback are
  **deleted** as of 2026-08-05, and so is the old `permission-broker.md` that documented them.
- [approval-postures.md](approval-postures.md) — the three-posture pill: why the full-auto one is
  wrapper-side (the CLI's own `auto`/`dontAsk` approve before we are ever asked, leaving nothing to
  audit) and why the pill only ever moves on the server's echo.
- [permission-hook-broken.md](permission-hook-broken.md) — evidence record for why the
  `--settings` PreToolUse hook was abandoned: it does not fire at all on 2.1.221, leaving the gate
  silently inert (unattended writes under `auto`, silent denial under `default`).
- [control-protocol.md](control-protocol.md) — **read second.** The `control_request` surface:
  `initialize` hands over commands + the account's model list at spawn for free, and `set_model` /
  `set_permission_mode` change both live mid-process. Retires the "slash list arrives late" and
  "mode switching needs a restart" limitations recorded in the two files below. §4–5 also record
  where `rename_session` really stores a title and why `apply_flag_settings`'s `success` is worthless.
- [dev-environment.md](dev-environment.md) — **the repo runs on two PCs and the interpreter path
  differs on each** (`Python314` on `Lion`, `Python312` on `ladyg`) — resolve it, don't copy it.
  Also: how to point
  the Chrome extension at the running app (it works as of 2026-08-05 — hold an SSE connection or
  the watchdog kills the server first), and why headless screenshots are a dead end here.
  **2026-09-24:** running the headless gates on Linux Chromium (`PCG_BROWSER` + a
  `--no-sandbox` wrapper), and the Chromium 141 stale-layout bug that explains the failures only
  that environment has.
- [frontend-modules.md](frontend-modules.md) — **read before editing `static/js/`.** The
  seven-module layout, the import cycle it rests on and the one invariant that keeps it safe, and why the CSS
  cascade layers are ordered the way they are (not the way the plan sketched). Since v2.3 it also
  carries **the composer's key dispatcher rules** — capture order is the priority list, and every
  keydown listener after it must check `defaultPrevented` — and, since v2.4, **why the dialogs are
  rows in the column** rather than modals, and the four things that had to change together for
  that to hold.
- [rtl-rendering-notes.md](rtl-rendering-notes.md) — how to re-run the spec tests (one free
  command now), why bare paths need a JS pass, and the two traps (subresource auth, global-scope
  collision) that a screenshot cannot catch. Also **what breaks when the window is made small**,
  and why the picker menus were sizing themselves off their own anchor. **2026-09-24:** an empty
  `dir="auto"` box is LTR (the composer placeholder), and how progressive stream markdown works.
- [sessions-and-history.md](sessions-and-history.md) — `--resume` semantics, where transcripts
  live, how they differ from the live stream, the restart pitfalls (stale readers, replay
  history), and **the two shapes a `user` turn arrives in** — one of which is mostly the CLI's own
  injected envelopes, not the person.
- [parity-chrome.md](parity-chrome.md) — the interrupt control message, slash commands, image
  blocks, statusLine passthrough, and the CLI features deliberately left unbuilt.
- [background-agents.md](background-agents.md) — the measured background-agent lifecycle on
  2.1.226: launch ack shape, `<task-notification>`, `subagents/agent-*.jsonl` + meta.json, and
  why agent state must come from the transcript file, never the stdout stream.
- [packaging.md](packaging.md) — `setup.ps1`/shortcut, the encoding rules that
  each silently corrupt Persian, and exactly which install branches are still unproven.
- [tui-keys.md](tui-keys.md) — every keystroke the TUI binds, parsed out of `claude.exe` by
  `extract_tui_vocab.py`, with a «کلید v2» column that `test_keys.py` reads its cases from. The
  binary self-updates overnight, so a hand-written key table would already be stale — regenerate,
  never transcribe.
- [tui-strings.md](tui-strings.md) — the same for the TUI's words: every string v2 translates,
  the key it ships as in `static/strings.fa.js`, and the ones deliberately dropped with the reason.
  §8 is the list of strings v2 **authored**, grouped by phase, waiting on one review by a native
  speaker. Gated by `test_tui_vocab.py` (against the binary) and `test_strings.py` (against the file).
- [grid.md](grid.md) — the split view on both editions (MA3 terminal, MA4 web): cell = stamped
  `#stage`, the composer/controls/perm factories, one `APPLY` table, the focus model, the
  parking rule (never auto-close, never auto-grow), and why the old window-width breakpoints
  became `@container` on `.cell`. Also condenses what a cell reuses from MA1 (per-tab status)
  and MA2 (git worktrees), the two open items headless Edge could not settle, and what MA4
  changed for the web edition (the segmented `۱ | ۲ | ۴` control, `positionMenu` measuring
  inside a cell, the perm dialog no longer modal). **2026-09-10:** the terminal edition got that
  control too, plus the 48 px rail that takes a 4-up cell from 378 px to 490 px, and the per-cell
  identity row — with the three accessibility traps collapsing a sidebar sets. **2026-09-24 (P4):**
  the new-session page — why its limit reads `/api/tabs` and not the debounced tab list, why
  `fits()` measures `#stage`, and the open/posture/message order it must keep. **P5:** the notification
  centre — what counts as news, and why a notice's title is looked up when it is drawn. **P7:** the run, the
  long-message fold and the history tail. **P8:** the Changes panel and its one route. **P9:** app
  zoom and the prefs store, as swappable values.
  **2026-09-24 (pcg-0o7):** why `focusCell()` defers itself while a `withRenderTarget` is open
  — a dialog focusing itself mid-render used to file one conversation's state under another.
  Same day, pcg-973: the web edition's status dots differ in shape as well as hue.
- [log.md](log.md) — running session log: what was verified, decided, or discovered, with dates.

## §B-9 verification: all ten answered

Every item is recorded in the files above, pinned to `claude` 2.1.221. Re-verify after a CLI
upgrade — flags and stream shapes drift between releases, and the permission design in particular
depends on undocumented behaviour.

M7 packaging is built and verified here. What remains is **M8 acceptance on the colleague's PC**,
which cannot be done from this machine — run `M8-acceptance.md` at the repo root.

## Also worth capturing

- Target PC probe results (`claude` version + path, WebView2/Edge, real Python vs. Store stub,
  winget usable, install permissions) and the contents of its `~/.claude/settings.json`.
- Whatever the Option A gate produced — which spec tests failed in the VS Code panel informs
  where the wrapper needs extra care.
