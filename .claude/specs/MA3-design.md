# MA3 — split view for the terminal edition: the design (architect, 2026-09-06)

Base: `D:\projects\Claude\persian-claude-gui\` — `js/*` below means `static-terminal\js\*`.
Line numbers are as of 2026-09-06 before MA1/MA2 landed; re-locate by symbol, not by number.

## Decision
Build the grid as N copies of today's "one visible view": a `.cell` is exactly what `#stage` is
now (`static-terminal\index.html:72-254`) stamped from a `<template>`, and `app.js` runs today's
`parkActive/applySwitch` (`js/app.js:172-213`) per cell instead of once. Three singletons become
factories — `makeComposer(root)`, `makeControls(root)`, and the perm dialog cut out of chrome.js
into a new `js/perm.js` `makePerm(root)` — render.js gains `scope.cell` + `scope.tab` and drives
cell chrome through ONE apply-table, and every cell-local `id` becomes a class. Focus is one
`cells[focused]` index; the three document-level chords dispatch to it. `/split 1|2|4` +
`alt+1..4`. A 5th session parks the focused cell's tab (server tab stays open, sidebar lists
it): never auto-close, never auto-grow. Fixed grid, no draggable splits (user decision).

## 1. Refactor surface
Untouched: `api.js`, `bidi.js`, `choice.js`, the drawer half of `agents.js`, the sidebar half of
`chrome.js` (:54-160, :296-700), `commands.js` table. `composer.js` has 25 module-level `let`s
and 12 `getElementById`s that are all per-cell state (`:18-26, :46, :147-157, :301-357,
:450-452, :590-616, :681-686, :740-747, :880, :932`) → wrap the file in
`makeComposer(root, cell)` returning `{input, setBusy, snapshot, restore, setSlashCommands,
noteContext, contextFull, restoreDraft, setBlank, focus}`; `promptKeys` stays capture-first on
the instance's textarea (`:1184`, registration order preserved). `controls.js:34-46/:58-66/
:317-339` same wrap. `chrome.js:1021-1420` (perm queue/current/list) → `perm.js`. `render.js`:
`statusline` (`:39`) becomes a `let` swapped in `withRenderTarget` (`:1001-1013`) beside `log`;
`toChrome` (`:528`) → `state.cell ? APPLY[key](state.cell, v) : state.chrome[key]=v`, and
`applyChrome` (`app.js:217-237`) uses the same `APPLY` — one table replaces two hand-kept copies
(`render.js:2341-2371` vs `app.js`); `setStatus` (`:1624`) and `paintQueued` (`:909`) paint into
`state.cell`; `toggleTranscript/toggleKind` (`:1710, :1779`) take the log element;
`initTranscript(getFocused)` (`:1795`). Ids→classes: everything inside `#stage` (~40) plus
JS-built `queue-strip` (`render.js:841`) and `agents-strip` (`agents.js:47`); window ids stay
(`sidebar, open-tabs, projects, btn-new, keys, agent-drawer`).

## 2. Routing
`routeEvent` (`app.js:110`): a tagged event ALWAYS renders via `withRenderTarget(entry.node,
entry.scope)`; `entry.node` IS `cell.log` while placed and a detached div while parked, so
`scope.background = !scope.cell` and the existing gates keep working. busy: `endBatch`
(`render.js:776`) → `cell.composer.setBusy` → `cell.root.classList.toggle("busy")`; app mirrors
the focused cell onto `body.busy` for `agents.js:153/180` and `checkIdle`. `permission_request`
(`:2305`): `(cellOf(ev.tab) ?? focusedCell()).perm.show(ev)` — a tab in no cell opens in the
focused cell with the existing «از نشست دیگر» line (`chrome.js:1192-1208` already tests
`tab !== openActive`); the reply needs no tab because `respond_permission` scans every broker by
`request_id` (`server.py:3068-3082`). `dismissTabPermissions` → all cells. Every session-scoped
POST carries `tab` explicitly (server reads `body.tab`, `server.py:3451/3454`): the raw fetches
at `composer.js:1273/1288`, the pickers, `render.js:795` recap and `:889` queue-cancel
(`state.tab`), `commands.js`/`agents.js` (focused cell). Still POST `/api/tab/activate` on focus
so `/api/tabs.active` survives a reload — but never rely on `cls.active`: click-then-Enter beats
the POST.

## 3. Focus and keys
`focused` set by pointerdown/focusin inside a cell (capture), `alt+N`, and `switchTab` to a tab
already placed elsewhere (a tab lives in ≤1 cell; switching to it focuses its cell).
Textarea-level chords (ZWNJ `:1195`, ctrl+r/ctrl+g/`@`/`!`/`?`/ctrl+x in `promptKeys :1008`) are
per instance, untouched. The three document handlers register ONCE in app.js: shift+tab
(`composer.js:1330` → `cell.controls.cyclePosture()`, `e.target !== cell.composer.input`,
`.slash-popup`), Esc (`:1349` → `cell.root.querySelector("dialog[open], .slash-popup:not([hidden]),
.file-popup:not([hidden])")` + global `:popover-open, #keys[open]`), ctrl+o/t (`render.js:1796` →
`toggleTranscript(cell.log)`). Tests: `test_keys.py:112-115`, `test_shell.py:67-72`,
`test_column.py:61-62,182,189`, `test_layout.py:68-75` swap `getElementById("x")`/`#x` for `.x`
(one `$` helper each); `test_dialogs.py:97-128` literals become `class="perm"` etc. and the regex
`.perm,\n.picker {`; `spec-test.html` keeps its ids and ADDS the classes (factories get
`root=document` there). `test_keys.py:55` CONTEXTS gains `Grid`; `wiki/tui-keys.md` gains
`## Grid — window only` (`alt+1`…`alt+4`); `test_tui_vocab.py:54-75` is a hardcoded list,
unaffected.

## 4. Layout selection
`/split 1|2|4` in `WINDOW_COMMANDS` (`commands.js:306`) + `cmdHelp.split`
(`test_strings.py:262-289` gates both). `alt+1..4` via `e.code === "DigitN"` (a Persian layout
puts «۱» in `e.key`; `choice.js:34` shows the trap). Free: Chat binds only alt+p/alt+t
(`tui-keys.md:71-73`); alt+←/→ rejected — Edge Back/Forward. No layout chord. Shrinking parks the
removed cells' tabs; cell order is DOM order, so «۱» is top-RIGHT under `dir=rtl`
(`wiki/editions.md:47-50`) — a digit badge in each cell topbar says so.

## 5. RTL/grid risks and the gate
`#stage` (`style.css:516`) → `.cell{display:flex;flex-direction:column;min-width:0;min-height:0}`
in `#grid{display:grid;…minmax(0,1fr)}` — the `minmax(0,1fr)` lesson (`:159`), or a long
transcript grows the cell off-screen. `.log > *{flex:none}` (`:726`) and
`.perm,.picker{position:static;flex:none}` (`:1697`) keep meaning but lose id specificity — sed,
then run spec/layout/column gates on `PCG_UI=terminal`. `positionMenu()` is already gone here
(`test_dialogs.py:137-140`) — moot. Popups are absolute inside `.comp-box` (`:1524`, relative
`:1331`) so they follow the cell; cap `40vh` to the cell and assert in-viewport (top row opens
upward over the row above). `@media (max-width:820px)` (`:2513-2523`) is window-width; a 2×2 at
1280px yields ~496px cells — the exact 500px case of 2026-08-23 — so move those four rules to
`@container` on `.cell` (`container-type:inline-size`), native, no JS. `#agent-drawer` (`:2293`)
stays global; its `inset-inline-end:auto` untouched.
**`test_split.py`** (sibling of `test_column.py`, reuse `measure()`/`hold_sse` from
`test_layout.py`): at 1280×800 and 1000×700 run `/split 4`; assert 4 `.cell` each with one
`.log/.perm/.picker/.composer/.statusline`; **no duplicate `id` in `document`**; every cell inside
the viewport, none wider than its box; `wrapper/user_echo` tagged `t2` paints into cell 2 only; a
`permission_request` for an unplaced tab opens in the focused cell with `.perm-source` visible;
`alt+3` moves `.focused` and DOM focus; shift+tab POSTs `/api/posture` with the focused cell's
`tab`; `/split 1` parks three tabs and `#open-tabs` still lists them.

## 6. Size and order
~3.5k lines touched, ~600 new: index.html ~60, style.css ~200, composer/controls wrapped (diff is
indentation — review with `-w`), perm.js +420 moved, render.js ~80, app.js ~150, chrome.js ~80,
commands.js ~30, agents.js ~15 (strip re-anchors to the focused cell), strings/help/wiki ~40,
tests ~60, test_split.py ~250.
Tasks: **T0** (implementer) ids→classes, zero behaviour change. **T1a** (builder)
`makeComposer`/`makeControls`, app.js instantiates one cell. **T1b** (builder) `perm.js`,
render.js `scope.cell`/APPLY/statusline swap, explicit `tab` on every POST. **T2** (builder)
template + `#grid` + cells + focus + routing + `/split` + `alt+N` + CSS + `test_split.py`.
**T3** (implementer) wiki/strings/help. Then one `/code-review`.

## Rejected
- iframe per cell: N SSE clients break the "last client gone → exit" watchdog, N tokens, no home
  for a hidden tab's permission, sidebar needs postMessage.
- N SSE connections: `subscribe()` replays the whole backlog per connection (`server.py:300-319`).
- Re-render from backlog on placement: replay re-fires everything `live` gates (recap,
  notification, give-back — `render.js:773-796`) and discards the parked node.
- Duplicate ids per cell: invalid, and any leftover `getElementById` silently hits cell 1 — the
  "wrong conversation" class.
- Swap singletons on focus, no factories: an unfocused busy cell shows no stop button and its
  permission opens in another cell.

## Known risks
- id→class specificity drop cannot be proven by sed; the terminal gates after T0 are the proof.
- `withRenderTarget` now copies ~20 scope fields per event for the focused tab too — per rAF
  frame, negligible; measure one long stream in T2.
- Reload restores only cell 1 (server `active`); persisting cell→tab is a follow-up.
- The `Tabs` context's 4 binary chords are unnamed in the wiki (`tui-keys.md:157`); alt+digit
  does not collide with any Chat/Global row — confirm against the extractor output in T3.
