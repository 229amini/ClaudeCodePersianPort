# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

**M0–M7 done, 2026-08-04.** The app is feature-complete and packaged: stdlib
server, real RTL Persian UI, token streaming, **spec tests 1–12 passing**, Persian permission
dialog, sessions (resume after a kill, history replay, folder picker), parity chrome (stop, slash
autocomplete, attach, statusline passthrough), and a one-double-click `setup.bat` bootstrap.
**All ten §B-9 verification items are answered.**

**2026-08-05: claude.ai-style shell redesign** (user-approved: dark-only, Codex-style right
sidebar with projects→sessions, home greeting state, `/api/projects` + cross-project
resume/replay/delete). Spec tests re-passed after the redesign. See
`wiki/rtl-rendering-notes.md` (new CSS traps) and `wiki/sessions-and-history.md` (new endpoints).

**2026-08-05: rework underway — see `REWORK-PLAN.md`, tracked as beads `pcg-b67`
(`bd list --tree`).** Phases 0–6 are closed. Phase 2 split `static/app.js` into ES modules under
`static/js/` (seven since Phase 4 added `controls.js`) and put `style.css` on cascade layers; read
`wiki/frontend-modules.md` before touching either. **Phase 4 made the GUI a capability mirror**:
the model picker, slash popup and approval pill are rendered from what `initialize` returned, and
every live change goes through `/api/control` or `/api/posture` — nothing about the CLI is
hardcoded. Read `wiki/approval-postures.md` before touching the pill, and note that `compact` is
**not** a control subtype on this build.

**Phase 5 (2026-08-05) — rebrand + Codex-style shell.** The product is «کلاد فارسی» with an
**original** mark (a mirrored terminal prompt, `assets/make_icon.py` — never Anthropic's Claude
mark, never «کلود», which is gone from the UI). Home state gained four action cards, the sidebar
gained a 300 ms hover preview, and both are wired to endpoints that already existed — Phase 5 added
**no** server route. Read `wiki/sessions-and-history.md` before touching `read_session` or
`session_meta`: `user` content arrives in two shapes and one of them is mostly the CLI talking to
itself.

**Phase 6 (2026-08-05) — open-source scaffolding.** `README.md` (bilingual, Persian first),
`LICENSE` (MIT), `CONTRIBUTING.md` are at the repo root; `.gitignore` already covered what the
phase asked for. UI strings are now read as `window.STRINGS` (aliased to `window.FA` at the foot of
`strings.fa.js`) — that alias is the whole i18n seam; keep new user-visible text out of the
modules. **The README has no screenshots yet** — capture them manually, the tooling here cannot
write a PNG into the repo. The phase's fresh-clone exit criterion found a shortcut bug in
`setup.ps1` (`Rename-Item -Force` does not overwrite); fixed and re-verified — see
`wiki/packaging.md`, which also records that `WScript.Shell` reads a Persian-named `.lnk` back as
blank.

**Phase 7 (2026-08-05) — bare-machine acceptance, M8′ — half done.** `M8-acceptance.md` is updated
for the post-Phase-4/5 UI and gained a **§0.5 clean-VM pre-flight**; `clean-machine.wsb` at the
repo root boots a Windows Sandbox for it (Sandbox itself needs one elevated enable + reboot, not
done). Auditing the four never-executed install branches found two real defects in `setup.ps1`,
both invisible on this PC and both fixed: `EAP=Stop` made a native command's **stderr** terminating
(the not-logged-in machine got a red English stack trace instead of the Persian login
instructions), and the claude installer ran under `Invoke-Expression`, whose `exit 1` kills the
caller without running its `catch`. Read `wiki/packaging.md` §"Two ways a never-executed branch
dies silently" before editing `setup.ps1`'s native calls. The not-logged-in branch is now executed
and proven; **Python install, claude install and `-Payload` are still unexecuted anywhere.**

**2026-08-06 — M8 §4/§5 run on the author PC (browser-driven).** The spec cases in live view *and*
history replay, plus the chrome-path sweep. Every path site reads LTR, ZWNJ round-tripped composer
→ CLI → disk, and allow/deny work. It found **three layout defects the spec gate is structurally
blind to** — the composer could never grow past one line, every tool card was flex-shrunk to 2 px
once the transcript scrolled, and Persian lines in tool params were RTL but left-aligned. All three
fixed; the gate is now **`PASS — 20/20`** with two layout guards added. Read
`wiki/rtl-rendering-notes.md` §"Three defects the spec gate could not see" before touching
`#log`, `.comp-box` or `linesAuto()`, and `wiki/dev-environment.md` §5–8 before driving the app
with the browser extension — one of those gotchas costs a paid turn every time.

**2026-08-06 — M8 §6 feature pass, also on the author PC.** Streaming, stop, the whole permission
dialog, the model picker, all three postures, kill-and-resume, slash, attachments. **Four more
defects, three of them in the approval path** — «دوباره نپرس» approved silently *and* survived into
the next project, and the audit counter had no click handler at all. Read
`wiki/approval-postures.md` §"What «دوباره نپرس» does" before touching `session_allow` or
`_publish_resolved`. Gates: spec **21/21**, `smoke_test.py` PASS, `test_transcript_path.py` PASS.
Note for anyone testing postures: the CLI silently auto-approves shell commands it judges read-only
(`echo`), so use a mutating command or the test lies.

**2026-08-07 — the pythonw shortcut served nothing.** The first click after the `run.vbs` removal
opened an Edge window on **ERR_EMPTY_RESPONSE** and logged nothing: `pythonw.exe` has no console,
so `sys.stderr` is `None`, and the verbose `log_message` raised inside `send_response` before any
byte reached the socket. Fixed at the one place `verbose` is computed. `test_no_console.py` is the
free check that catches this whole class, and `setup.ps1` now runs it before the paid smoke test.
Read `wiki/packaging.md` §"The launcher's third failure" — **the launcher is a different
interpreter from the one every test uses**, which is why a 21/21 suite stayed green while the
shipped app served nothing.

**2026-08-07 — four UI features, each measured before it was built.** `AskUserQuestion` renders as
a real question (it arrives over the `can_use_tool` pipe and its answer rides back in
`updatedInput.answers` — read `wiki/permission-transport.md` before touching the broker, it is
excluded from both auto-approve paths on purpose). A **context notice** puts `/compact` and
`/clear` above the composer, triggered by the CLI's own measured percentage, not by scraped text.
An **effort chip** mirrors `initialize` and writes through `apply_flag_settings` — read
`wiki/control-protocol.md` §6 first: there is no `set_effort`, the ack is worthless, `initialize`
advertises a `max` level the settings schema refuses, and the CLI's own `/effort` would edit the
user's real `settings.json`. **Edit/Write/MultiEdit render real diffs**, in the tool card and in the
permission dialog, through one `renderToolDetail()`. Gates: spec **38/38**, smoke **12/12**.
`wiki/rtl-rendering-notes.md` gained the rule that pays for itself: **a `textContent` assertion is
blind to every BiDi defect** — the diff count rendered `1- 2+` while its check passed.

**2026-08-07 — MCP tool rows (`pcg-9jx`).** A tool named `mcp__<server>__<tool>` has no Persian
verb and can never have one — the server set is per-machine — so the row fell through to the raw
40-character identifier and clipped. `toolSummary()` now splits it (tool as the name, server as an
LTR-isolated muted chip) and `.tool-name` finally ellipses instead of overflowing. Fallback only:
do not add MCP names to `strings.fa.js`.

**2026-08-07 — the user's first real pass over the shell, and plan mode.** Four defects, all of the
same family: **state that belongs to one session surviving into the next.** The statusline kept the
previous conversation's cost and context, the model picker kept `chosen`/`resolved` (picking Haiku
once hid the effort chip forever after — it is the only model without `supportsEffort`), and the
kebab menu's armed delete never disarmed, so a reopened menu showed a coral confirm slab waiting for
an accidental click. All now reset at the one choke point every session swap goes through, the
wrapper's `reset` event. The fifth was layout: `.comp-row` could not wrap, so once a session had a
posture and an audit counter the row overflowed and pushed the effort chip out of the box.

**«طرح‌ریزی» (plan) is now the fourth posture** — measured, not assumed: `set_permission_mode
{"mode":"plan"}` is accepted and echoed as `system/status.permissionMode`, asserted in
`smoke_test.py`. Read `wiki/approval-postures.md` §"Plan mode exits by itself" before touching
`sync_cli_mode()`: plan is the one mode the CLI leaves **on its own** (when `ExitPlanMode` is
approved), so the pill is bound to the engine's echo rather than to the user's click. The plan
itself renders as markdown through `renderToolDetail()`, not as a `plan:` parameter blob. Gates:
spec **40/40**, smoke **13/13**.

**2026-08-08 — the last two picker-shaped parity gaps.** An **output-style chip** («لحن پاسخ»)
mirrors `initialize.available_output_styles`. Read `wiki/control-protocol.md` §7 before touching
it: it uses the same `apply_flag_settings` route as effort **and the effort chip's design does not
transfer** — `outputStyle` has no schema at all, so a typo is accepted and confirmed by both
read-backs. The guard is at the door (`/api/output-style` refuses a name the CLI never advertised),
and the proof is `system/init.output_style` on the next turn. The **subagent picker was not built**:
there is no `set_agent` subtype and the model dispatches agents itself, so a picker would be a lie.
`initialize.agents` is used as a label instead — a `Task` row now names the agent and carries the
CLI's own description, where before every subagent rendered as the same «کار فرعی» line.
Gates: spec **42/42**, smoke **15/15**.

`ultracode` was measured at the same time and **deliberately left out of the UI** — see
`wiki/control-protocol.md` §8. It is a real live flag and `Workflow` really is in `system/init
.tools` headless, but the CLI exposes it as a *prompt keyword*, not a command, so a chip would be
more prominent than the thing it mirrors and would hand a non-technical user a one-click quota
burn. Fast mode answers itself: `fast_mode_disabled_reason: "sdk_opt_in_required"`.

**2026-08-08 — the sidebar reordered itself when you clicked it.** `_sessions_in` sorted on
`st_mtime`, and the CLI rewrites a transcript at **spawn** (`mode`/`attachment`/
`file-history-snapshot`, plus an `isMeta` `user` line from any `SessionStart` hook) — so opening a
session bumped it to the top before a word was exchanged. `session_meta()` now also returns the
last **non-`isMeta`** `user`/`assistant` timestamp and the list sorts on that; mtime is the
fallback for a transcript with nothing said in it. Read `wiki/sessions-and-history.md` §"The
sidebar cannot sort on st_mtime". Guarded free in `test_units.py`.

**2026-08-10 — three defects from the user's second pass, one per layer.** The agents drawer opened
but could not be scrolled: the `[popover]` UA sheet sets `height: fit-content`, and a non-`auto`
height makes an absolutely positioned box ignore its own `inset-block-end`, so `inset-block: 8vh`
only pinned the top and the panel grew off the bottom of the window (`block-size: auto` is the
whole fix — `wiki/rtl-rendering-notes.md`). A `/skill` invocation dumped the entire SKILL.md into
the transcript: **the live stream spells `isMeta` as `isSynthetic`** and sends no `isMeta` at all,
so the guard that already fixed replay never fired live — read out of the binary, recorded in
`wiki/sessions-and-history.md`. And **a markdown list is one block, not N**: `dir="auto"` per `li`
let a bullet opening with an inline `code` span go LTR while its Persian siblings stayed RTL, which
is the "scrambled ul". The list decides once and its items give up their own `dir` so it can read
them (`bidi.js`); an English list still resolves LTR, which is the assertion that stops anyone
"fixing" this with `direction: rtl`. Gate: spec **80/80**.

**2026-08-10 — the same list, reported again, one layer down.** Making the list decide was correct
and insufficient: `dir="auto"`'s scan skips only `<bdi>` and subtrees carrying their own `dir`, so
an inline `<code>` — LTR in CSS, silent in the DOM — still voted, and a bullet **opening** with a
code span flipped the whole list LTR. `applyDirection()` now sets `dir="ltr"` on `pre,code`; that
one line fixes `p`, `li`, `h2` and `td` together. The gate had been blind because its list case put
the code-opening item *second*, and only the first strong character votes — see
`wiki/rtl-rendering-notes.md` §"An inline `<code>` at the start of a block flips it LTR" before
adding any guard for a first-strong-character rule. Gate: spec **82/82**.

**2026-08-18 — the user's third pass: ten reports, one session, every root cause measured.**
`scroll-behavior: smooth` on `#log` animated every programmatic scroll, so `atBottom()` read a
stale offset and the transcript stopped following the stream (2/40 vs 40/40 appends measured) —
the "overlapping rows" screenshots were compositor tear, not layout. Raw HTML rode marked v15
into `innerHTML`: a pasted `<style>` restyled the whole app and `<img onerror>` would have run
script — one `renderer.html` override in `bidi.js` now escapes it. First-strong `dir="auto"`
resolved majority-Persian blocks LTR whenever they open with a Latin term; `autoDir()` now
counts strong **letters** (digits and Arabic punctuation vote for nobody; Cyrillic/Greek/CJK
count as LTR) and may only *promote* to `rtl` — **spec rule 1 carries a dated amendment
sanctioning exactly that and nothing more.** The AskUserQuestion dialog rendered model markdown
as `textContent` (backticks, reordered neutrals, LTR flip) — fixed once, via prose builders
shared by the dialog and the transcript. Stuck busy/stop: anything that eats a `result`
(subprocess death mid-read, SSE-replay double-count, interrupt bookkeeping) stranded the spinner
forever; `wrapper/idle_sync` now fires after 5 s of CLI **silence** — any stdout line defers it,
`_inflight` is re-checked under the lock at publish. The context notice flickered because
`CONTEXT_EXHAUSTED` matched the CLI's per-frame «Context low» status-line warning — fatal-only
now, phrasings read out of the 2.1.234 bundle. Stream deltas are rAF-coalesced (one write per
frame; was O(n²) per answer). New: Shift+Tab cycles the posture through the pill's own
`pickPosture()`; ≥3 identical (sentence + tool row) polling cycles fold into one pair with a
«N بار» chip — **newest pair wins**, which is what keeps the folded output the final poll's.
A high-effort review of the diff returned 10 verified findings (two data-loss in the fold);
all fixed. `/btw` is not a command on 2.1.234 — `initialize.commands` probed, 60 entries.
Gates: spec **143/143** (negative-tested), units, transcript guard, `test_no_console`, smoke
**15/15**. Read `wiki/rtl-rendering-notes.md` (autoDir, the escape-writing trap),
`wiki/parity-chrome.md` §idle_sync, and `wiki/frontend-modules.md` (the newest-pair rule)
before touching any of it.

**2026-08-20 — "it still says it is thinking after it finishes", and the CLI's recap.** The
reported stuck spinner was not stuck: a page refresh replays the hub's whole backlog, so
`renderEvent` re-runs every finished turn — and the closing line **invented** two of its parts at
render time. The verb was `Math.random()` (a different Persian word after every reload) and the
duration was wall-clock (a replayed turn takes milliseconds, so every line in history read
«۰ ثانیه»). The verb is now a hash of the turn's own prompt and the settled time is
`max(wall clock, Σ result.duration_ms)`; read `wiki/frontend-modules.md` §"A reload RE-RENDERS
every finished turn" before adding anything to a transcript entry that a second render could not
reproduce. Guarded by replaying one turn twice and comparing.

The TUI's **«※ recap: …»** now exists here too. Measured first: the automatic one is
`awaySummary`, which leaves over a remote-only channel and is disabled outright in print mode, but
`/recap` is a **local command** (`supportsNonInteractive: true`) that answers over our own stdin
pipe, is never written to the transcript, and refuses **for free** on an empty session — which is
how the whole mechanism was proven without spending a turn. It costs an API call when it really
answers, so the window asks only on the CLI's own condition: the turn ended while the window was
hidden or untouched for five minutes (`composer.js isAway()`). Read `wiki/parity-chrome.md`
§"The session recap" before touching `request_recap()` or the reader's swallow — `_recap_wanted`
left standing would eat the next **real** answer, silently, which is why any ordinary send clears
it.

Chasing the same report through the smoke test found **a third defect, and this one really is
machine-shaped.** `_publish_usage` gave `get_context_usage` a 5-second budget on the grounds that
it is free and answers instantly on an idle process — true, and irrelevant: it is asked the moment
a turn ends, when the CLI is busiest, and its answer prices **every skill, agent, MCP tool, slash
command and memory file in scope**. Measured on this PC at **13 s** after a free local command and
longer after a real turn; on a bare `~/.claude` it is instant. The patch is built from whatever
answered, so the failure was silent — `wrapper/usage` published `cost` with no `context`, and the
window's context meter and «گفتگو پر شده» notice simply never moved *here* and worked fine
everywhere else. It now has its own `CONTEXT_USAGE_TIMEOUT` (60 s) **and its own event**:
`_publish_usage` built one merged patch, so the slow request held the fast one hostage and a
context breakdown that never came took `cost` and `quota` down with it. The two publish
separately now — the renderer has always merged partial `wrapper/usage` patches, so this needed
nothing on the client. Read `wiki/control-protocol.md` §9 before shortening any post-`result`
control timeout or re-merging those two. The smoke test's own title check was wrong too — it took
the first title anywhere in `/api/projects`, which lists every project on the machine, so it
started reporting a stranger's title the moment another project had one; it matches on the session
id now. Gates: spec **147/147**, units, transcript guard, `test_no_console`, smoke **15/15**.

**2026-08-23 — CLI 2.1.240, and the third way is closed.** The upgrade needed **no port**: the
whole contract re-probed free (initialize, plan mode, `get_context_usage`, `/recap` refusal
string byte-identical) plus one paid smoke turn — see `wiki/cli-stream-json-findings.md`
§"2.1.240 re-verification" for the drift list (new `system/thinking_tokens` event, dropped;
`Concise` style and `claude-fable-5[1m]` appeared by themselves because both chips mirror
`initialize`). The reported "finished session still shows thinking" was **not** CLI drift: it
was the documented-unfixed SSE reconnect replay — an `EventSource` auto-reconnect (sleep/wake)
re-delivered the whole backlog, duplicating the transcript and double-counting
`user_echo`/`result`, so a drop landing mid-turn stuck the window busy forever. Fixed with a
monotonic `seq` on `Hub.publish` emitted as the SSE `id:` line and honoured via `Last-Event-ID`
in `subscribe(after)`; a fresh window (no header) still replays everything. Read
`wiki/parity-chrome.md` §"The third way" before touching `Hub` or `_serve_sse`. Verified on the
wire, pinned in `test_units.py`. Gates: spec **147/147**, units, transcript guard, smoke
**15/15** — both re-run after the change.

**2026-08-23 (same session) — the boot tab is gone.** Launching the app used to `open_tab(--cwd)`
at serve(): a real CLI spawned in the shortcut's `Documents\Claude` and the window opened ON a
conversation — contradicting both the user's expectation and `M8-acceptance.md` §4 line 147,
which already demanded the home state. `serve()` no longer opens a tab; zero tabs was already a
fully-supported state (`blankView()`, `/api/tabs` `{tabs: [], active: ""}`), and `--cwd` still
seeds recents so the shortcut's project is one click away. `smoke_test.py` now opens its own tab
via `/api/project/open` — the only caller that relied on the boot tab. Verified live: zero tabs
and **no CLI child process** at boot, spawn only on explicit open. Also measured (free): an idle
`--resume` emits zero inference-shaped events in 12 s — opening/closing a session costs no
tokens, no matter how old the session; only a sent turn pays (and after a long gap the next
turn's cache re-write cost is per-turn API behaviour, unrelated to having opened the session
earlier). See `wiki/cli-stream-json-findings.md` §"2.1.240 re-verification". Gates re-run: spec
**147/147**, units, `test_no_console`, smoke **15/15**.

**2026-08-23 — the window was never responsive, and the picker menu was sizing itself.** Reported
as small resolutions breaking, with a screenshot of the posture menu crushed into a ~180px column
whose rows drew on top of each other. Measured headlessly against the real `index.html` first:
`positionMenu()` writes a physical `right` on a **shrink-to-fit** popup, so the offset that lines
the menu up with its chip was also *subtracting from its width* — the posture chip is the last one
on the row, which is why that menu was the narrow one (201px in a 760px window, 282px in a 1280px
one). It opens upward, so `max-height: 46vh` was clipped by the top of the window in the home state
(first row at `y = -64`, no scrollbar to say so) — capped from the anchor's rect now, and
`#slash-popup` needed the same line. `.menu-row` carried `min-height: 0`, so the rows shrank below
their own content instead of the popup scrolling: **the third appearance of the `#log > * { flex:
none }` family**. And the shell had no `@media` block at all — a 500px window handed `#stage` 194px
for 244px of content and drew the composer at `x = -30`, off the window, with every spec assertion
still green. Two breakpoints, no drawer (Chromium will not go below ~490px of viewport). Read
`wiki/rtl-rendering-notes.md` §"Nothing in the shell was responsive" before touching `positionMenu`
or the sidebar column. New free gate: **`test_layout.py`**, negative-tested against the old CSS
(7 failures). Gates: layout **PASS**, spec **150/150**, units, transcript guard, `test_no_console`.
The smoke test was not re-run — nothing here touches transport.

**2026-08-24 — a version marker, so an update is visible without a terminal.**
`APP_VERSION` in `server.py` is the one constant; `_serve_file()` substitutes `{{VERSION}}` into
every `.html` it serves, so the window title («کلاد فارسی — v1.0.0») and the sidebar footer are
written by the process that is actually answering — not by a static file that may not have been
copied. Bump it on release; see `wiki/packaging.md` §"The version marker". Gates re-run: layout
**PASS**, spec **150/150**, `test_no_console` **PASS**.

**2026-08-24 — the queue rework: a uuid ledger closes the "still thinking" family for good.**
The send-counter that used to drive `busy` is gone. `ClaudeSession._outstanding` is a
lock-guarded, insertion-ordered ledger of `command_uuid`s (a dict, so the legacy compat path
closes FIFO), minted top-level on the user frame by `send_blocks()`, and
the CLI closes each one itself on the `command_lifecycle` channel — `queued` → `started` → exactly
one of `completed`/`cancelled`/`discarded`/`refused` (a fresh turn's `completed` lands after its
`result`; a folded one's before). `wrapper/user_echo` carries the uuid so the window keeps the
identical ledger; `render.js state.outstanding` settles the pulse when it empties, and `result`
itself no longer settles anything except that `terminal_reason === "aborted_streaming"` still
clears the set instantly, so Stop stays instant. Three backstops cover the CLI's own documented
holes: a silence watchdog armed on every `result` (5 s of quiet → `idle_sync`), a synthetic
`discarded` published per unreported uuid on process exit, and a `_lifecycle_seen` compat path
that closes one ledger entry per result for a pre-2.1.241 CLI that never speaks on the channel at
all. **Stop now means stop for the queue too** — interrupt sends `cancel_queued: true`
unconditionally, because capabilities live on `system/init`, which does not exist until the first
turn starts, so nothing can gate on them at spawn — and its own 5 s receipt (read off the reader
thread, never blocking the HTTP handler) closes exactly the uuids the CLI names `cancelled`; a
`still_queued` uuid is left alone to report for itself, and no receipt at all falls through to the
same silence backstop as before. A message sent mid-turn now shows the truth instead of a false
delivery: it parks in a dim «در صف» strip above the composer until the CLI's own lifecycle events
promote it into a real bubble or hand its text back to the composer (never on `idle_sync`/reset —
only when the process is provably gone), with a per-row ✕ (`POST /api/queue/cancel`) to cancel one
by hand. History replay of a folded message now converges with live rendering
(`attachment/queued_command` maps to a user event), and the context meter dropped its own
wrong-arithmetic `result`-event estimate in favour of the CLI's authoritative `get_context_usage`
exclusively. Shift+Tab now cycles the posture from anywhere outside the permission dialog and
slash popup. Read `wiki/cli-stream-json-findings.md` §"The message queue: one `result` does not
mean one send" (plus its 2.1.241 wire probe) and `wiki/parity-chrome.md` §"The stop button that
stopped nothing" (now corrected for the receipt-driven design) and the new §"The queue strip"
before touching any of it. A high-effort review of the whole diff returned 10 verified findings,
9 fixed the same day (the tenth matched existing per-tab draft semantics and was documented
instead): the silence watchdog defers while a permission request is pending, a backstop settle
can no longer buy a `/recap`, the aborted-result clear keeps `still_queued` uuids busy, SSE
backlog replay is marked `replayed: true` (no-cursor connects only) so a reload cannot resurrect
a returned draft, Shift+Tab backs off every editable/popover surface, `idle_sync` and a
deliberate respawn both hand queued text back, and every `_idle_deadline` access is under the
ledger lock. Each fix negative-tested. Gates: spec **171/171**, units, layout, transcript
guard, `test_no_console`, smoke **16/16** (re-run after the fixes — the SSE path changed).

**2026-08-31 — CLI 2.1.251, two user reports, both TUI-parity defects.** The upgrade re-probed
free (`probe_queue.py` 8/8, initialize dumped: 62 commands now including `/design`, six
permission modes, new `messaging_socket_path`) — see `wiki/cli-stream-json-findings.md`
§"2.1.251 re-verification". **Stop no longer cancels the queue**: `interrupt()` sends
`cancel_queued: false`, matching the TUI's Esc — the running turn aborts, queued messages
survive and run; the 2026-08-24 "no spinner, no way out" fear is exactly what the uuid ledger
already fixed, so the window needed zero changes (per-row ✕ stays the queue-cancel; help.html
updated). **Enter in the AskUserQuestion dialog submitted the Skip**: implicit form submission
clicks the tree-first submit button, `#perm-deny`, so a typed «جواب دیگر» plus Enter left as
allow-with-no-answers — "the user did not answer" with the form fully filled in. A keydown
handler on `#perm-ask` makes Enter answer; the wire is spec-asserted through a fetch stub
(`wiki/permission-transport.md` §"A fourth way"). Also measured (one paid turn): **`auto` mode
still bypasses the wrapper entirely** — a Write and a shell `Remove-Item -Force` both ran with
zero `can_use_tool` — so it stays out of the pill, now as a measurement
(`wiki/approval-postures.md`). Gates: spec **174/174**, units, probe_queue 8/8, smoke PASS on
2.1.251.

**2026-09-03 — v2 planned: the terminal, drawn with the DOM.** The user's read after a month of
use: the port lacks much of the CLI, and the problem was only Persian, never a need for a chat UI.
`V2-PLAN.md` at the repo root is the plan — same `server.py` engine, `static/` rebuilt as a
faithful DOM rendition of the Ink TUI (one column, TUI glyphs and keys, inline numbered dialogs,
the TUI's own wording translated). The sidebar (projects then sessions) and in-window tabs stay as
the one addition over the TUI, user decision the same day. Measured first (free, CLI **2.1.259** — it updated itself that morning; `probe_queue.py`
8/8): 64 pipe commands vs ~40 TUI-only ones read out of the exe, TUI strings and keystroke hints
greppable from the binary, `history.jsonl` shareable. See `wiki/cli-stream-json-findings.md`
§"2.1.259 re-verification". Tracked as the v2 epic in `bd list --tree`; phases v2.0–v2.7 with exit
criteria are in the plan §6. Nothing in `static/` has changed yet.

**2026-09-04 — `APP_VERSION` 1.0.1 → 1.1.0, tagged `v1.1.0` on `main`. `2.x` is reserved.**
This is a release of the **web shell** — the claude.ai-style window of Phase 5, unchanged in
behaviour; the bump exists so the colleague can read which build is running off the title bar.
Free gates re-run on `main`: units, spec **174/174**, `test_layout.py` at three widths, transcript
guard, `test_no_console`. `smoke_test.py` was not re-run — it costs a turn and nothing here
touches transport. The app was booted and answered on `127.0.0.1` with «کلاد فارسی — v1.1.0» in
its title, so the `{{VERSION}}` substitution is proven end to end, not just in the constant.
**«v2» means the terminal-shaped rewrite of `V2-PLAN.md` and nothing else** (user decision, this
date): the TUI-rendition shell that replaces this web shell, phases v2.0–v2.7, of which only v2.0
(Vocabulary) is built, on the `v2` branch. The tag `v2.0.0` is reserved until phase v2.7 closes.
The web shell keeps releasing as `1.x` in the meantime.

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
- **Absolute interpreter path** in the generated shortcut. Never rely on `python` resolving via
  PATH — the Store alias stub shadows it, and installs in the same PowerShell session do not
  refresh PATH. (The shortcut targets `pythonw.exe` directly; the `run.vbs` that used to sit in
  between is gone — clean Windows 11 images have no VBScript engine.)
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
| Run the wrapper | the desktop shortcut (silent `pythonw.exe server.py`), written by setup | **yes** |

Two checks exist:

| Check | How | Asserts |
|---|---|---|
| Transport (M2) + capability mirror | `python persian-claude-gui\smoke_test.py` | boots the server, drives one real CLI turn, expects the CLI to **answer** it (`PONG` in the `result` body — a bare `result` event is what a not-logged-in CLI returns, cheerfully, as `success`) and a 403 on a bad token. **Also asserts the Phase-4 claims whose acks lie**: `initialize` data, posture round-trip + `system/status` echo, `set_model` proven by the next turn's `system/init.model`, CLI-reported usage, the session title read back out of the transcript, and that `/api/effort` reports what is **in force** rather than what was asked (plus that it never writes the user's own `settings.json`), and that the CLI accepts `plan` mode, and that the output style applied before the turn is the one `system/init.output_style` reports for it (plus that an unadvertised style is refused — nothing downstream validates it). **Also asserts the uuid ledger (2026-08-24)**: the `command_uuid` the turn's send returns comes back on `command_lifecycle` events and reaches a terminal state by the time the result settles — zero extra turns, read off the one send this file already pays for. 16 checks, still one subscription turn. |
| Queue/lifecycle contract | `python persian-claude-gui\probe_queue.py` | free re-probe for the next CLI upgrade: boots the real CLI, checks `initialize`/`system/init` advertise `msg_lifecycle_v1`/`interrupt_receipt_v1`/`interrupt_cancel_queued_v1`, that a top-level `uuid` on the user frame produces `command_lifecycle` events reaching a terminal state, that the same frame with no `uuid` produces none, and that `cancel_async_message` on a never-enqueued uuid answers `cancelled: false`. 8 checks. Free because its payload is `/recap` on an empty session, which refuses locally — `total_cost_usd` must print `0`. |
| Rendering (M3) | `python persian-claude-gui\run_spec_test.py` | the 12 spec cases through the shipping renderer, headless — grown to 174 assertions by later passes, so `PASS — 174/174` is the gate. Exit 0 = pass. Free. Holds an SSE connection so the idle watchdog cannot kill the run; treats an empty verdict as FAIL, because a module that fails to load looks identical to silence |
| Narrow windows | `python persian-claude-gui\test_layout.py` | the shipping `index.html` (not a copy — the probe page is generated from it and deleted again) measured headlessly at 1280×800, 760×640 and 500×560: nothing drawn off the window, nothing wider than its own box, and the posture menu open — full width, on screen, rows at their natural height. Free. This is the class the spec gate is structurally blind to: it runs at one size and asserts message content |
| Permissions (M4) | run the server, ask for a `Write` | dialog appears; allow creates the file, deny does not, "remember" skips the next prompt. Approvals now arrive in-band as `can_use_tool` control requests, so a missing dialog means the spawn lost `--permission-prompt-tool stdio` — not a hook problem. `--hook-log` is gone. |
| Sessions (M5) | drive `/api/sessions`, `/api/session`, `/api/session/resume`, `/api/project/open` | list/preview/order, replay filtered to user+assistant, traversal guard, resume adopts the session id, project switch rejects a bad folder. **Hold an SSE connection open** or the idle watchdog kills the server mid-run. |
| Transcript guard | `python persian-claude-gui\test_transcript_path.py` | `transcript_path()` resolves real ids and rejects traversal — the one choke point `read_session` and session delete both route through. No server, no CLI, no cost. |
| TUI vocabulary (v2.0) | `python persian-claude-gui\test_tui_vocab.py` | `wiki/tui-keys.md` and `wiki/tui-strings.md` still agree with the installed `claude` binary: the binding table parses (206 bindings / 25 contexts on 2.1.261), the ~20 chords v2 actually commits to are the ones the binary has, the two platform-computed chords resolve to their Windows branch (`alt+v`, `shift+tab`), every English string and glyph the docs quote is present, every table row carries a Persian column, the per-context counts printed in the docs are real, and (added v2.6, §10) the five-hour usage-warning threshold and its two per-plan siblings are re-derived from the bundle. **82 checks.** Free, login-independent, spawns nothing — it reads `claude.exe` as a file. Regenerate the underlying data with `extract_tui_vocab.py`. This exists because the binary self-updates overnight (most recently 2.1.260 → 2.1.261 on 2026-09-05) and silently invalidates any hand-written key table. |
| Launcher (M7) | `python persian-claude-gui\test_no_console.py` | the server answers HTTP when run under **`pythonw.exe`** — the binary the shortcut uses and the one no other check here touches. Finds the port via `netstat` (there is no stdout), expects 403 on an unauthenticated `GET /`. Free, login-independent; `setup.ps1` runs it as step 5.5 and gates the smoke test on it. |
| Column (v2.2) | `python persian-claude-gui\test_column.py` | drives the shipping `index.html` headlessly: the `⏺` marker shares one gutter with a tool icon, a tool result's `⎿` branch and line count stay on one row, `Ctrl+O` opens/shuts every result at once, the checklist marks are the binary's `☐ ☑ ▸` and the directional glyphs flip under `data-mirror-glyphs`, a `compact_boundary` draws the divider from its own metadata, a subagent's steps render inside the `Agent` card, and a long paste is parked as a chip while what is *sent* is the expanded text. **22 checks.** Free, no CLI process, no login. |
| Keys (v2.3) | `python persian-claude-gui\test_keys.py` | every chord the «کلید v2» column of `wiki/tui-keys.md` binds, across the five contexts the prompt owns (Global, Chat, Confirmation, Autocomplete, HistorySearch), dispatched at the real composer in the real `index.html` with the new routes stubbed in, plus `!`, `@`, `\`+Enter and `?` as characters rather than chords. Fails in both directions: a table chord with nothing behind it, or a scenario here for a chord the table never bound. **40 checks** at v2.3, grown to **60** at v2.4 with the whole `Confirmation` context (permission/plan/question Esc and shift+Tab semantics). Free, no CLI process, no login. |
| Dialogs (v2.4) | `python persian-claude-gui\test_dialogs.py` | the *shape* `test_keys.py` dispatches keys at: the capability chips and the old popup are gone from `index.html`, both dialogs sit inside `#stage` above the prompt, the permission form has no submit button, dialogs open with `show()` and never `showModal()`, the four picker verbs (`/model` `/effort` `/output-style` `/permissions`) map to openers, `choice.js` stays a leaf module, the option digit is never inside the string, and every `FA.*` key the window reads exists in `strings.fa.js`. **31 checks.** Reads files and spawns nothing — the fastest gate here. |
| Shell (v2.5) | `python persian-claude-gui\test_shell.py` | the status-line stack (three rows in §3.4's order, the posture row following the wrapper rather than the raw CLI mode, one turn-end notification on a live settle and none on a replayed one) and every window-local command of §3.5 — the route each one calls, the body it sends, and the two (`/theme`, an unowned verb) that fall through to the CLI as text. **29 checks.** Driven headlessly with every route stubbed inside the page — no `claude` process, no login. |
| Strings (v2.6) | `python persian-claude-gui\test_strings.py` | the two arrows in `claude.exe → wiki/tui-strings.md → static/strings.fa.js → the page`: every wiki row's key exists in the file and the two texts agree, a row shipping nothing says so in both places, no un-allowlisted English in a Persian string, no key in the file that nothing reads, `/help` lists exactly the verbs the window answers, and `help.html` names every command V2-PLAN §4 says the window will not build. **24 checks.** Reads files and spawns nothing. |

Set `PYTHONIOENCODING=utf-8` before driving the server from PowerShell or Persian mojibakes in
the console. There is no Playwright here (no node), and headless `--screenshot` renders blank on
this machine — do not spend time on it. **The Claude-in-Chrome extension does work as of
2026-08-05** and is the only way to actually *see* the UI; it caught two defects on its first use
that the 18/18 spec gate structurally cannot. Read `wiki/dev-environment.md` §"Seeing the running
app" first — the idle watchdog kills the server before the browser arrives unless you hold an SSE
connection open, and a stale browser entry reports every page as an error page.

`setup.ps1` must stay idempotent — every step checks before acting, safe to re-run (verified by
running it twice). It ends in the smoke test above. **It must stay UTF-8 with BOM**; see
`wiki/packaging.md` for why that fails silently otherwise.

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
