# MA3-T1 — terminal edition: composer, controls and permission dialog become per-cell factories
Agent: builder
Files: `persian-claude-gui/static-terminal/js/composer.js`, `controls.js`, `chrome.js`, new
`perm.js`, `render.js`, `app.js`, `commands.js`, `agents.js`, `spec-test.html`; test selectors
only where a factory's root changes them.
Spec: Read `.claude/specs/MA3-design.md` in full; implement §1 and §2 with ONE cell.
(a) `composer.js` → `makeComposer(root, cell)` returning `{input, setBusy, snapshot, restore,
setSlashCommands, noteContext, contextFull, restoreDraft, setBlank, focus}`; module-level `let`s
become instance state; `promptKeys` stays capture-first on the instance textarea, registration
order preserved. `controls.js` → `makeControls(root, cell)` the same way. (b) The permission
queue/current/list block of `chrome.js` moves verbatim into `perm.js` as `makePerm(root, cell)`
with `show(ev)`, `dismissTab(tab)`; sidebar half of `chrome.js` untouched. (c) `render.js`:
`scope.cell`, `scope.tab`; `statusline` becomes a `let` swapped in `withRenderTarget` beside
`log`; ONE `APPLY` table replaces `toChrome`'s copy and `app.js applyChrome`; `setStatus`,
`paintQueued` paint into `state.cell`; `toggleTranscript/toggleKind` take the log element;
`initTranscript(getFocused)`. (d) Every session-scoped POST in `js/` carries `tab` explicitly
(design §2 lists the sites) — the server already reads `body.tab`. (e) `app.js` builds exactly
one cell from the existing `#stage` DOM (`root = #stage`), and today's `parkActive/applySwitch`
run against it; `spec-test.html` passes `root = document`. The window must behave exactly as
before this task.
Context: step between T0 (classes) and T2 (grid). The "wrong conversation" class of bug is the
one to fear: any state left at module level is shared between cells in T2. Read
`wiki/frontend-modules.md` (newest-pair rule, reload re-render) and `wiki/permission-transport.md`
before moving the perm code — the AskUserQuestion path and its timeout semantics must move
unchanged. Ponytail: move, wrap, do not redesign; review your own diff with `git diff -w`.
Acceptance:
- `grep -n '^let \|^const .* = document' static-terminal/js/composer.js controls.js perm.js`
  shows no per-cell DOM/state at module level (paste it).
- `grep -n "api(" static-terminal/js/*.js` — every POST to a session-scoped route carries
  `tab` (paste the list with a ✓ each).
- `PCG_UI=terminal`: `run_spec_test.py`, `test_keys.py` (60+), `test_dialogs.py` (31+),
  `test_shell.py` (MA1 count), `test_column.py` (22+), `test_strings.py`, `test_layout.py` all
  PASS — unchanged counts or higher; only selector/root edits in the test files.
- `git diff --stat -- persian-claude-gui/static/` empty.
Verify: as MA3-T0.
Report: ≤ 25 lines.
Out of scope: the grid, `/split`, `alt+N`, CSS beyond what a moved selector needs (T2); the
web edition.
