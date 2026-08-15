# TASKS — user's 2026-08-14 defect/feature batch

Tracking: beads pcg-k5q, pcg-lx3, pcg-987, pcg-1nn, pcg-0qp, pcg-9o8.
Waves: T1+T2 parallel → T3+T5+T6 after exploration → T4 (concurrent sessions) last, it
touches server.py + every frontend module and must not race the others.

---

# T1 — Copy button on code blocks (pcg-lx3)
Agent: implementer
Files: persian-claude-gui/static/js/bidi.js, persian-claude-gui/static/style.css,
persian-claude-gui/static/strings.fa.js, persian-claude-gui/static/spec-test.html
Spec:
- In `renderMarkdown()` (bidi.js ~line 123), after the existing table-wrap loop, wrap every
  `pre` in `host.querySelectorAll("pre")` in `<div class="code-wrap">` (same
  replaceWith/append shape as the table loop) and append a
  `<button type="button" class="code-copy">` to the wrapper — NOT inside the `pre`
  (applyDirection sets dir="ltr" on pre, and spec assertions read pre.textContent).
- Button content: inline SVG copy glyph only (two overlapping rects, stroke currentColor,
  ~14px), `title` + `aria-label` = `window.STRINGS?.copyCode`. Click handler in try/catch:
  `navigator.clipboard.writeText(pre.textContent)`; on success swap to a check glyph and
  title `window.STRINGS?.copied` for 1.5 s, then restore.
- bidi.js is a leaf module: read `window.STRINGS` global, add no imports.
- strings.fa.js: add `copyCode: "کپی کد"` and `copied: "کپی شد"` near `moreActions`
  (~line 113). No Persian literals in bidi.js.
- style.css — all rules inside the existing `components` layer, do not add a layer:
  `.code-wrap { position: relative; margin-block: .45em; }` and `.code-wrap > pre
  { margin-block: 0; }` (pre has overflow-x:auto, so the wrapper must be the positioning
  context; `.msg > :first-child/:last-child` margin resets now land on the wrapper).
  `.code-copy`: absolute, `top: .4rem; right: .4rem` (physical — code area is visually LTR),
  `background: var(--surface-2); color: var(--fg-muted); opacity: 0;` reveal via
  `.code-wrap:hover .code-copy, .code-copy:focus-visible { opacity: 1 }`.
  MUST declare `.code-copy:hover { background: var(--surface-2); color: var(--fg) }`
  explicitly — a global `button:hover { background: var(--accent-strong) }` (~line 1016)
  will repaint it coral otherwise.
- spec-test.html: add assertions to the code-block case: `.code-wrap > pre` exists,
  `.code-wrap .code-copy` exists, and `querySelector("pre").textContent` contains no «کپی»
  (button text must never join the pre). Existing assertions that read the first `pre` and
  `pre code` must keep passing.
Context: one renderer, two sources — this single function serves live, replay, plan cards
and the permission dialog, so the button appears everywhere for free; that is accepted.
strings.fa.js and style.css are being edited concurrently by another task — if an Edit
fails to match, re-read the file and retry at your anchor.
Acceptance:
- `run_spec_test.py` exits 0 with all assertions passing (count grows by the new ones).
- No files changed outside the four listed.
Verify: `$env:PYTHONIOENCODING='utf-8'; C:\Python314\python.exe persian-claude-gui\run_spec_test.py`
Out of scope: render.js, agents.js, server.py; no clipboard fallback; no visible-on-touch
handling.

---

# T2 — Project rename, display-name override (pcg-9o8)
Agent: builder
Files: persian-claude-gui/server.py, persian-claude-gui/static/js/chrome.js,
persian-claude-gui/static/strings.fa.js, persian-claude-gui/static/style.css,
persian-claude-gui/test_units.py, .gitignore
Spec:
Server:
- Add `NAMES_FILE = HERE / "names.json"` beside RECENTS_FILE (~line 233). Store shape:
  `{path: name}` dict. Write dict helpers `_load_names() -> dict` / `_save_names(d)` —
  the existing `_load_paths/_save_paths` are list-shaped, do NOT reuse them (they'd
  silently drop a dict). UTF-8, tolerant of missing/corrupt file.
- Lookup is case-insensitive on path (same convention as `entry_for()` in
  `list_projects()`); store the path as sent.
- Decorate project entries with `"name": <override>` when one exists, at BOTH insertion
  points: inside `list_projects()` (~line 324) and the bare current-project dict the
  `/api/projects` handler inserts (~line 1916).
- New endpoint `POST /api/project/rename` — copy the shape of `/api/project/pin`
  (~lines 2193–2203). Body `{path, name}`. Strip the name, cap at 64 chars (see the
  TITLE_MAX precedent ~line 143); empty/missing name deletes the override (reset to
  folder name). Respond ok + effective name.
- `drop_project_from_lists()` (~lines 1146–1150) must also delete the path's entry from
  names.json, or a deleted project's name leaks onto a future folder at the same path.
- `.gitignore`: add `names.json` next to recents/archived/pinned (same comment block).
Frontend (chrome.js):
- Module-level map lowercased-path → name, filled in `loadProjects()` from the
  `/api/projects` payload. `displayName(path)` = map lookup || `basename(path)`.
  Use it in `projEl()` (~line 223, `.proj-name`) and `setChrome()` (~lines 88–97, topbar
  name + composer chip). `setChrome()` is also called from render.js on `system/init`
  with only a cwd string before any projects fetch — basename fallback is correct there;
  the debounced `refreshProjects()` corrects it moments later.
- Kebab menu on the project row: add item «تغییر نام» (string in strings.fa.js, e.g.
  `renameProject`). Clicking swaps the row's `.proj-name` for an `<input dir="auto">`
  prefilled with the current display name. Enter → POST `/api/project/rename`, then
  refresh projects. Escape or blur → cancel. Empty + Enter → reset to folder name.
  Follow the existing kebab patterns in chrome.js, and make sure any armed/edit state
  disarms when the menu closes or the row re-renders (the armed-delete-survives defect
  family is documented in CLAUDE.md — do not add a new member).
- Tooltips keep the full path (it is the disambiguator). Statusline «پوشه» stays the full
  path — do NOT plumb names into render.js. Tab title stays the constant.
Tests (test_units.py, offline, no CLI):
- names round-trip incl. Persian text, case-insensitive lookup, empty-name reset,
  drop_project_from_lists removes the names entry. Use a temp dir / monkeypatched
  NAMES_FILE per the file's existing patterns.
Context: there is no CLI control for project names (session rename uses the CLI's
`rename_session`; projects have no equivalent) — this is wrapper-only state, which is why
it lives in a names.json beside recents.json. Read wiki/frontend-modules.md before
touching chrome.js. strings.fa.js and style.css are being edited concurrently by another
task — if an Edit fails to match, re-read and retry.
Acceptance:
- `test_units.py` exits 0 including the new tests.
- `run_spec_test.py` exits 0 (unchanged behaviour for message rendering).
Verify: `$env:PYTHONIOENCODING='utf-8'; C:\Python314\python.exe persian-claude-gui\test_units.py`
then `C:\Python314\python.exe persian-claude-gui\run_spec_test.py`
Out of scope: render.js, agents.js, composer.js, controls.js; session rename; server
process management (a concurrent-sessions task will touch it later — keep your server.py
diff confined to the store, the decoration and the one endpoint).

---

# T3 — Agents panel: finished agents stuck/shown forever (pcg-k5q)
Agent: builder
Files: persian-claude-gui/server.py (agent registry area only), persian-claude-gui/static/js/agents.js,
persian-claude-gui/test_units.py
Spec:
1. Fix the substring dispatch in `build_agent_registry` (server.py ~791–796): a
   task-notification line whose body quotes `"tool_result"` or `"name":"Agent"` is routed to
   the wrong scanner and dropped, so the agent never flips to completed. Keep the cheap
   substring pre-filter, but decide the route from the PARSED line (json.loads once), not
   from substring order: user line with string content containing task-notification →
   notification scanner; user line with list content holding tool_result parts → ack
   scanner; assistant tool_use named Agent → launch scanner. Preserve the incremental
   cache contract in the docstring (append-only reads, shrink ⇒ rescan, shallow copy).
2. Fix phantom entries in `_scan_agent_ack` (~694–701): an entry may only be created when
   the tool_use_id joins a pending Agent launch (`pending.pop(id, None)` must be required,
   not optional) — today any tool_result whose TEXT mentions "Async agent launched"
   (e.g. a Read of another transcript) mints an unkillable "running" row.
3. UI: the strip above the composer shows RUNNING agents only — filter in `paint()`
   (agents.js ~132–151); the strip hides when none are running. The drawer keeps the full
   registry (it is the history view). Badge logic unchanged (already counts running).
4. test_units.py, synthetic lines (do not depend on this machine's transcripts):
   notification whose body quotes `"tool_result"` still completes the agent; notification
   quoting `"name":"Agent"` still completes; a tool_result text mentioning "Async agent
   launched" WITHOUT a pending launch creates no entry; a normal launch→ack→notification
   sequence still yields completed with description.
Context: read wiki/background-agents.md first — state derives from the main transcript on
disk, one parser for live+replay, `toolUseId` is the join key, the same task-id can notify
more than once (overwrite, not append). agents.js must keep zero work at evaluation time.
The panel-empty-after-resume symptom is a DIFFERENT task (T6) — out of scope here.
Acceptance:
- test_units.py exits 0 incl. the new tests; run_spec_test.py exits 0 (85/85).
Verify: `$env:PYTHONIOENCODING='utf-8'; C:\Python314\python.exe persian-claude-gui\test_units.py`
then `C:\Python314\python.exe persian-claude-gui\run_spec_test.py`
Out of scope: render.js, chrome.js, composer.js; in-process orphan watchdog (documented
gap, not this task); resume/session-id plumbing (T6).

---

# T5 — Orphaned «در حال …» pulse rows (pcg-987)
Agent: implementer
Files: persian-claude-gui/static/js/render.js, persian-claude-gui/static/js/chrome.js,
persian-claude-gui/static/spec-test.html
Spec:
- Root cause: `clearPulse()` (render.js ~280–283) clears the timer and nulls `state.pulse`
  but never touches the DOM node. Every path that replaces or resets a live pulse
  (second/third send during a running turn via `startPulse()`→`clearPulse()`, and
  `resetTurn()` from the live `user` text case) leaves the old node in the log with
  `class="pulse live"` — which keeps `order: 1` and the breathing animation forever.
- Fix at the choke point: in `clearPulse()`, if the current pulse element still carries
  `live` (i.e. it was never settled by `settlePulse()`), remove the element from the DOM
  before nulling the state. A settled pulse is a permanent transcript entry and must NOT
  be touched.
- Second fix: `resumeSession()` (chrome.js ~604) does `log.replaceChildren()` without
  `resetTurn()`, so `state.pulse` survives pointing at a detached node — add the same
  `resetTurn()` call `replaySession()` already makes (~569–570).
- spec-test.html: add a case — fire two `wrapper/user_echo` events back-to-back, assert
  exactly ONE `.pulse.live` and ONE `.pulse` total in the log; then fire a `result`,
  assert one settled `.pulse` and zero `.pulse.live`. Follow the existing pulse cases
  (~780–816) for harness idioms.
Context: the pulse is a transcript entry, not chrome — on settle the class comes off and
the node is re-appended; do not change `settlePulse()`. Do NOT gate the composer on busy:
the CLI queues extra stdin messages by design (interrupt_cancel_queued_v1). Read
wiki/frontend-modules.md before editing render.js.
Acceptance: run_spec_test.py exits 0 with the new assertions passing.
Verify: `$env:PYTHONIOENCODING='utf-8'; C:\Python314\python.exe persian-claude-gui\run_spec_test.py`
Out of scope: thinking cards (one per assistant message is intended), agents.js,
server.py, composer.js.

---

# T6 — Statusline (and session id) prefill on resume (pcg-0qp)
Agent: builder
Files: persian-claude-gui/server.py (ClaudeSession area), persian-claude-gui/static/js/render.js,
persian-claude-gui/test_units.py
Spec:
- After `/api/session/resume`, the bar is blank until the first turn because everything
  that fills it (`system/init`, `result`, `wrapper/usage`, `wrapper/statusline`) arrives
  only once the CLI processes a message. But at `restart()` return the server already
  holds `session_id` (= resume_id), `cwd`, `spawned_at`; `_publish_usage()` uses control
  requests documented in-file as free on an idle process; `_publish_statusline({}, gen)`
  tolerates an empty payload.
- Add `ClaudeSession._publish_resume_prefill(generation)`: publish a wrapper event
  (e.g. subtype `"resumed"`) carrying `{session_id, cwd}`, then call `_publish_usage()`
  and `_publish_statusline({}, generation)`. Run it on a daemon thread started from
  `restart()`/`start()` ONLY when a resume_id was given; guard every publish with the
  `_generation` check like the other threaded publishers. The statusline command must
  keep its existing off-thread/10 s-timeout/%COMSPEC% behaviour — reuse, don't rewrite.
- render.js: handle the new wrapper subtype — set `state.status.sessionId` and
  `state.status.cwd` from the event (this also fixes the stale-cwd cross-project resume),
  repaint via `setStatus`, then call `refreshAgents()` (the agents strip is blocked on
  `state.status.sessionId` after a resume for exactly the same reason).
- Model stays unknown until the first `system/init` — the statusline simply omits it;
  do not fake it from the model catalogue.
- test_units.py: factor so `_publish_resume_prefill` is testable with a stub session
  (fake hub collecting events): assert the resumed event shape/order, the generation
  guard (stale generation publishes nothing), and that a machine with no statusLine
  command configured does not crash.
Context: read wiki/parity-chrome.md §statusLine and wiki/control-protocol.md first —
the statusline command is inherited, never reimplemented; ANSI parsed, not stripped;
acks lie, so prove behaviour by events, not responses. render.js rule (~820–825):
everything except the folder belongs to ONE conversation — the prefill is that
conversation's own numbers, which is why it must come from the resumed process, never
from surviving frontend state.
Acceptance:
- test_units.py exits 0 incl. new tests; run_spec_test.py exits 0.
Verify: `$env:PYTHONIOENCODING='utf-8'; C:\Python314\python.exe persian-claude-gui\test_units.py`
then `C:\Python314\python.exe persian-claude-gui\run_spec_test.py`
Out of scope: agents.js internals (T3 owns them), the pulse (T5), model prefill,
`/api/project/open` without resume (a fresh chat has no session yet — nothing to show).

---

# T4a — Concurrent sessions, server half (pcg-1nn, folds in pcg-a8z)
Agent: builder
Files: persian-claude-gui/server.py, persian-claude-gui/test_units.py
Spec:
- Tab key = wrapper-minted `uuid4().hex` (CLI session_id is None until turn one — never
  the routing key). One `Hub`, one SSE stream; every event stamped `{"tab": key}`.
- `TabHub` — tiny view object holding (hub, tab): `publish(ev)` stamps `ev["tab"]` and
  forwards; `reset()` → `hub.reset(tab)`. Passed to `ClaudeSession` and its
  `PermissionBroker` at construction, so all 16 publish sites and the broker tag for
  free. The `user_echo` publish in the message handler must also go through the target
  session's TabHub.
- `Hub._history` → dict keyed by tab, per-tab cap (~5000 events, drop oldest — bound for
  runaway sessions, N tabs never reset any more). `subscribe()` replays every bucket
  (order within a bucket preserved; cross-bucket order irrelevant — clients route per
  tab). `reset(tab)` clears one bucket and publishes a tagged reset. A tab close drops
  its bucket entirely.
- Handler: `sessions: dict[tab, ClaudeSession]` + `active: str`. Every session-scoped
  endpoint accepts optional `tab` (body key or query param), defaulting to active —
  smoke_test.py and the frontend-before-T4b must keep working with no tab param.
- Per-session `PermissionBroker` (posture, session_allow, auto-approve audit are per-tab
  by construction). `/api/permission/respond` finds the broker holding the request id by
  scanning sessions (ids are uuid4 — collision-free).
- Endpoints:
  - `GET /api/tabs` → `{active, tabs: [{tab, session_id, cwd, busy, spawned_at}]}`.
    `busy` = a turn in flight: set on message send, cleared in `_after_result` /
    cli-exit paths.
  - `POST /api/tab/activate {tab}` → set active (default for tab-less requests, reconnect
    hint). 404 unknown tab.
  - `POST /api/tab/close {tab}` → stop that session, drop it and its history bucket,
    publish a tagged `wrapper/closed`; if it was active, promote the most recently
    spawned survivor (or none) and return the new active.
  - `/api/project/open` → SPAWN a new tab (keep others running), make it active. Boot
    creates the first tab through the same path. Cap concurrent tabs at `MAX_TABS = 6`
    (`# ponytail: arbitrary ceiling, raise if RAM allows`) — over cap returns a JSON
    error the frontend can show.
  - `/api/session/resume` → if some live tab already runs that session_id, adopt: set
    active to it, respond `{ok, tab, adopted: true}`, no spawn, no reset (two CLIs on one
    .jsonl is corruption). Else spawn a new tab with resume_id (prefill from T6 rides
    along). The old restart-in-place path disappears with its callers.
- Liveness guards now scan ALL tabs: `/api/session/delete` (409 if live anywhere),
  `/api/project/remove` (refuse if any live tab's cwd is that project), `/api/agents`
  (live/spawned_at from whichever tab runs the requested session id).
- `idle_watchdog` and `serve()`'s finally stop every session (window close still kills
  all — unchanged product semantics).
- Locks: recents/archived/pinned/names read-modify-writes under one module-level
  `threading.Lock` (now reachable from concurrent opens); `_control_seq` increment moves
  under the existing `_pending_lock` (pcg-a8z — collision would resolve the wrong
  pending future).
- test_units.py: TabHub stamps and forwards; per-tab history cap and reset isolation
  (bucket A cleared, B intact); subscribe replays all buckets; close drops the bucket;
  resume-adopt decision (live id → adopt, dead id → spawn) factored testable; broker
  lookup across two sessions resolves the right request.
Context: read wiki/cli-stream-json-findings.md, wiki/permission-transport.md,
wiki/control-protocol.md, wiki/sessions-and-history.md first. `ClaudeSession` is already
multi-instance-safe (all state per-instance, `_generation` guards its threads) — do not
restructure it; the work is the shell around it. Do NOT run smoke_test.py (it costs a
paid subscription turn — the orchestrator runs it once at the end); prove behaviour with
the free gates and the new unit tests.
Acceptance:
- test_units.py exits 0 incl. new tests; run_spec_test.py exits 0 (87/87 — frontend
  untouched, untagged rendering unaffected); test_transcript_path.py and
  test_no_console.py exit 0.
Verify: `$env:PYTHONIOENCODING='utf-8'` then run all four:
`C:\Python314\python.exe persian-claude-gui\test_units.py`,
`…\run_spec_test.py`, `…\test_transcript_path.py`, `…\test_no_console.py`
Out of scope: every file under static/ (T4b does the frontend against your event shape);
smoke_test.py edits; orphan watchdog for agents.

---

# T4b — Concurrent sessions, frontend half (pcg-1nn) — dispatch AFTER T4a lands
Agent: builder
Files: static/js/app.js, render.js, chrome.js, composer.js, controls.js, agents.js,
static/strings.fa.js, static/style.css, static/index.html, static/spec-test.html,
static/help.html, wiki/sessions-and-history.md
Spec (summary — full prompt written at dispatch):
- app.js keeps `tabs: Map(tab → {node, scope, chrome/controls snapshot})` + `activeTab`.
  SSE routing: event without `tab` or with `tab === activeTab` → `renderEvent` as today
  (spec-test compatibility is exactly the untagged path); other tabs →
  `withRenderTarget(tab.node, tab.scope, …)` (the seam background agents already use).
  Tagged `wrapper/reset`/`wrapper/closed` clear/drop one tab.
- Switch: move #log children ↔ buffer node, swap render scope, repaint statusline,
  controls (needs snapshot/restore export in controls.js), busy flag, slash commands,
  context notice; `/api/tab/activate`. Boot + reconnect from `GET /api/tabs`.
- Sidebar: live sessions get a live/busy dot; clicking a live one switches tabs (no
  replay, no respawn); «بستن نشست» closes the tab; new-chat spawns a tab.
- Permission dialog: one modal FIFO across tabs, entries tagged, dialog names the asking
  session; answering routes by request id (unchanged).
- help.html gains a short Persian section on concurrent sessions; wiki updated.
- spec-test.html: add minimal cases — a tagged background event leaves #log untouched;
  a background tab's scope accumulates independently; switch swaps content.

---

# 2026-08-15 batch — the 10 review defects (beads pcg-14c.1–.10)

Waves: R1 + R2 + R3 in parallel (disjoint primary files; strings.fa.js / style.css /
spec-test.html are shared between R2 and R3 — on an Edit mismatch, re-read and retry).
Review lens for every fix: each defect is the tabs rework breaking an invariant the
single-session design guaranteed for free (one live session always, one transcript in
#log, broker always had a listener). Line numbers refer to the CURRENT uncommitted tree.

---

# R1 — Server half: permissions on close, busy race, tab-less projects, open_tab lock
Agent: builder
Beads: pcg-14c.2 (server half), pcg-14c.3, pcg-14c.4, pcg-14c.5
Files: persian-claude-gui/server.py, persian-claude-gui/test_units.py
Spec:
1. (.2 server half, P1) `close_tab` (server.py ~2136) pops the session and `hub.drop`
   adds the tab to `_closed` (~234) — but the session's PermissionBroker still holds
   pending `can_use_tool` futures. The waiter then blocks the full
   PERMISSION_TIMEOUT=110 s, and its `_publish_resolved` deny (~1459) is discarded by
   the Hub's closed-tab guard. Fix the ORDER inside close_tab: (a) resolve every
   pending request on that session's broker as deny FIRST (unblocks waiters
   immediately, and the resolved events still publish because the tab is not yet
   closed), (b) publish the tagged `wrapper/closed`, (c) only then `hub.drop`. Reuse
   the broker's own deny path — do not invent a second resolution mechanism.
2. (.3, P1) `self.busy = True` runs AFTER `_write_line` (~1794) with no ordering vs the
   reader thread's `busy = False` in `_after_result` (~1677): a fast result leaves busy
   stuck True forever. Mirror defect: mid-turn sends are allowed by design
   (composer.js queues on the CLI, wiki/cli-stream-json-findings.md), so turn 1's
   result clears busy while queued turn 2 still runs. Fix: replace the boolean with an
   in-flight counter — increment BEFORE `_write_line` (decrement on the RuntimeError
   path), decrement clamped at 0 in `_after_result`, expose `busy` as `count > 0`.
   Hard-reset the counter to 0 on the cli-exit/restart paths AND when an interrupt is
   sent (the CLI cancels queued messages on interrupt — interrupt_cancel_queued_v1 —
   and the aborted current turn still emits its own result, which the clamp absorbs).
   `# ponytail:` comment naming the clamp+reset as the stick-proofing.
3. (.4, P2) `GET /api/projects` (~2264) routes through `_target(...)` and 404s once the
   last tab closes (`cls.active = ""` at ~2140-2142), freezing the sidebar (frontend
   catches silently). Fix: serve the project list tab-less — only the current-cwd
   highlight/current-project entry needs a live session; omit it when there is none.
4. (.5, P2) The `len(sessions) >= MAX_TABS` check (~2593, ~2703) races other
   ThreadingHTTPServer threads, and `cls.sessions[tab] = …` / `cls.active = …` are
   assigned unguarded (a second spawn steals active mid-flight). Fix at the choke
   point: move the cap check AND both assignments inside `open_tab` under one
   module-level lock (reuse/extend `_STORE_LOCK`'s pattern; a dedicated
   `_SESSIONS_LOCK` is fine). `close_tab`/activate mutations of the registry go under
   the same lock. Never hold the lock across a blocking spawn wait longer than needed
   — reserve the tab slot under the lock, spawn outside if the code allows it simply;
   otherwise holding it through spawn is acceptable (document with a ponytail comment).
5. test_units.py, offline, no CLI, follow the file's existing stub/monkeypatch
   patterns: (a) close_tab resolves a pending broker future as deny before the hub
   drops the tab (assert future done + deny, and the resolved event reached the hub);
   (b) counter: increment-before-write visible, clamp at 0, reset on restart;
   (c) /api/projects handler path serves a list with zero sessions (no 404);
   (d) N threads racing open_tab with a stubbed spawn never exceed MAX_TABS and
   active is one of the winners.
Context: read wiki/permission-transport.md and wiki/control-protocol.md before touching
the broker (failure modes there produce cheerful `success` acks, prove by events);
wiki/sessions-and-history.md for the session registry shape. `ClaudeSession` is
multi-instance-safe by design — do not restructure it. Do NOT run smoke_test.py (paid;
the orchestrator runs it once at the end).
Acceptance:
- test_units.py exits 0 incl. new tests; run_spec_test.py exits 0;
  test_transcript_path.py exits 0; test_no_console.py exits 0.
Verify: `$env:PYTHONIOENCODING='utf-8'` then
`C:\Python314\python.exe persian-claude-gui\test_units.py`, `…\run_spec_test.py`,
`…\test_transcript_path.py`, `…\test_no_console.py`
Out of scope: everything under static/ (R2 owns the client half of .2), smoke_test.py,
agents endpoints, git commits.

---

# R2 — Frontend tab lifecycle: replay target, closed-tab dialogs, blank composer,
#      snapshot prune, Persian rename direction, pulse leak
Agent: builder
Beads: pcg-14c.1, pcg-14c.2 (client half), pcg-14c.6, pcg-14c.8, pcg-14c.9, pcg-14c.10
Files: persian-claude-gui/static/js/app.js, static/js/chrome.js, static/js/render.js,
static/js/composer.js (only if .6 needs it), static/spec-test.html,
static/strings.fa.js (only if .6 needs a string), static/style.css (only if .6 needs it)
Spec:
1. (.1, P1) `replaySession` (chrome.js ~759) and `resumeSession` (~806-818) render a
   foreign transcript into the global #log with no active-tab check; switchTab
   (app.js ~223) swallows errors and resumeSession never re-checks activeTab after its
   long await — the next `parkActive()` (app.js ~148) then copies the clobbered #log +
   scope into the ACTIVE tab permanently. Fix at the shared seam: both must render
   through `withRenderTarget(<tab's node>, <tab's scope>)` — resolve the target tab's
   render destination AT RENDER TIME through one helper: active tab → the live log and
   live scope exactly as today; parked tab → its buffer node + scope; tab gone
   (closed while the fetch was out) → drop the output silently. Re-resolve after every
   await.
2. (.2 client half, P1) A tagged `wrapper/closed` must also clear that tab's pending
   permission state: drop matching entries from perm.queue and dismiss the visible
   dialog if it belongs to the closed tab (dismissPermission currently only fires on
   permission_resolved, render.js ~1232). R1 makes the server deny pending requests
   before the drop, so a resolved event usually arrives first — this is the belt for
   the race where it does not. dropTab/blankView route through the same clearing.
3. (.6, P2) `blankView` (app.js ~208) leaves the composer enabled; a send POSTs with no
   tab → 404 → generic Persian send-failed bubble, a dead end for the non-technical
   user. Fix: in the blank state disable the composer input + submit and say why —
   lazy version: `disabled` + a placeholder string («برای شروع، گفتگویی باز کنید» —
   add to strings.fa.js, no Persian literals in modules). Re-enable on any tab
   becoming active (route through the same place blankView's inverse runs).
4. (.8, P2) `applyTabs` (app.js ~287) prunes local entries absent from a `/api/tabs`
   snapshot — but a GET served mid-spawn returns a list WITHOUT the new tab, so the
   debounced loadTabs deletes the entry holding the buffered `wrapper/init_info`
   (slash commands, model catalogue — replayed only on a fresh SSE subscribe, nothing
   re-requests it), and the prune can bounce activeTab to the snapshot's stale active.
   Fix: prune ONLY on the server's explicit tagged `wrapper/closed`; the snapshot may
   ADD entries and update metadata but never delete, and never overrides a locally
   newer activeTab (snapshot's active applies at boot/reconnect only).
5. (.9, P2) chrome.js ~125 (tab rows) and ~937 (permission dialog source line) render
   `pathEl(displayName(entry.cwd))` — `.path` forces direction:ltr + left-align
   (style.css ~110-121), so a Persian display name renders misordered in an RTL row,
   violating the CLAUDE.md contract that `.path` is for Windows paths only.
   chrome.js ~344 already renders the same value correctly as a plain dir="auto" node
   — reuse that exact pattern at both sites. (Tooltips keep the full path.)
6. (.10, P3) Non-active drop paths (`dropTab` app.js ~249, and whatever remains of the
   prune after fix 4) do `entry.node.replaceChildren(); tabs.delete(tab)` — but the
   500 ms pulse interval lives in the SCOPE (render.js ~334) and clearPulse only runs
   via blankView for the active tab: closing a background tab mid-turn leaks the
   interval painting detached nodes forever. Fix at the one choke point all drop paths
   share: clear the scope's pulse (timer + node ref) when a tab entry is dropped.
   Expose the smallest seam render.js needs (e.g. a clearPulse(scope) that takes the
   scope) — do not duplicate pulse logic in app.js.
7. spec-test.html guards, following the existing harness idioms (~780-816 for pulse
   cases): (a) a replay routed at a parked tab leaves #log untouched and lands in the
   parked node; (b) tagged wrapper/closed clears a queued permission entry for that
   tab; (c) a snapshot missing a locally-known tab does NOT delete it, wrapper/closed
   does; (d) after dropping a background tab whose scope held a live pulse, the
   scope's pulse is null/cleared; (e) a Persian display name in a tab row renders
   WITHOUT the .path class and with dir="auto" (keep the existing Latin assertion).
Context: read wiki/frontend-modules.md and wiki/rtl-rendering-notes.md first;
wiki/sessions-and-history.md for replay/resume. The spec gate currently passes 94/94 —
your changes must keep every existing assertion green while adding the new ones.
strings.fa.js / style.css / spec-test.html are being edited concurrently by another
task — on an Edit mismatch, re-read the file and retry at your anchor.
Acceptance:
- run_spec_test.py exits 0 (all existing + new assertions).
Verify: `$env:PYTHONIOENCODING='utf-8'; C:\Python314\python.exe persian-claude-gui\run_spec_test.py`
Out of scope: server.py (R1 owns it — assume its fixes land; code against the current
event shapes), agents.js (R3 owns it), the strip/drawer, git commits.

---

# R3 — Agents drawer entry point for finished agents
Agent: implementer
Beads: pcg-14c.7
Files: persian-claude-gui/static/js/agents.js, static/strings.fa.js, static/style.css,
static/spec-test.html
Spec:
- Defect: `paint()` (agents.js ~141) filters the strip to status==="running", and a
  row's click is the SOLE caller of openDrawer — once an agent completes its
  report/transcript is unreachable. Keep the running-only strip (deliberate, the
  finished-rows-forever complaint drove it) and add a history toggle:
  - Module-level `let showHistory = false`, reset to false in `resetAgents()`.
  - In `paint()`: `finished = registry.filter(a => a.status !== "running")`. Strip is
    visible when running.length OR finished.length. When `finished.length`, append one
    muted toggle `<button type="button" class="ag-history">` with text
    `FA.agentHistory.replace("{n}", finished.length.toLocaleString("fa-IR"))`; click
    flips showHistory and repaints. When showHistory, also paint the finished rows via
    the existing `rowEl()` (running first, then finished — rowEl already renders
    completed dots and keeps kind==="agent" rows clickable into the drawer).
  - The «در انتظار N عامل» wait line keeps its current condition (running only).
- strings.fa.js: add `agentHistory: "عامل‌های پیشین ({n})"` near the other agent*
  strings. No Persian literals in agents.js.
- style.css: `.ag-history` inside the existing components layer, muted like `.ag-wait`
  (var(--fg-muted), transparent background, small font). MUST declare
  `.ag-history:hover` explicitly (background var(--surface-2), color var(--fg)) — a
  global `button:hover { background: var(--accent-strong) }` repaints it coral
  otherwise.
- spec-test.html, following the existing agents-strip case idioms: drive
  `window.renderAgents` with one completed kind==="agent" entry → strip NOT hidden,
  `.ag-history` present, zero `.ag-row` painted; click `.ag-history` → a
  `button.ag-row[data-status="completed"]` exists; drive with `[]` → strip hidden.
Context: read wiki/background-agents.md and wiki/frontend-modules.md first. agents.js
must keep zero work at evaluation time (module body runs before init). strings.fa.js /
style.css / spec-test.html are being edited concurrently by another task — on an Edit
mismatch, re-read the file and retry at your anchor.
Acceptance:
- run_spec_test.py exits 0 (all existing + new assertions).
Verify: `$env:PYTHONIOENCODING='utf-8'; C:\Python314\python.exe persian-claude-gui\run_spec_test.py`
Out of scope: server.py, app.js, chrome.js, render.js, composer.js; the drawer's
internals; polling cadence; git commits.
