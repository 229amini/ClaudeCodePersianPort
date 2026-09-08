# MA4 — the 1 / 2 / 4 grid on the web edition («کلاد فارسی», `static/`)
Same design as `.claude/specs/MA3-design.md`, ported. Read that file first, then
`wiki/grid.md` (what T2 actually built), `wiki/editions.md`, `wiki/frontend-modules.md`,
`wiki/rtl-rendering-notes.md` §"Nothing in the shell was responsive" (the `positionMenu` trap).
The terminal edition's `static-terminal/js/{app,render,perm,composer,controls}.js` are the
reference implementation — copy the shape, keep the web look. Four stages, three dispatches,
strictly sequential. Web gates: `run_spec_test.py` (207+), `test_layout.py`, `test_no_console.py`,
`test_units.py`; new `test_split.py` must run on both editions via `PCG_UI` like `test_layout.py`.
Web-specific facts (scout, 2026-09-07): 40 ids inside `#stage` plus JS-built `#queue-strip`
(`render.js:739`), `#agents-strip` (`agents.js:47`), `#sess-card` (`chrome.js:706`, fixed-position
preview — window-level, keep); `#perm` is a body-level `<dialog>` opened with `showModal()`
(`index.html:262`, `chrome.js:1128`) — a modal would block every other cell; `positionMenu()`
(`controls.js:357-380`) anchors to a chip rect and writes physical `right` on a shrink-to-fit popup;
`body.app { grid-template-columns: 288px minmax(0,1fr) }` (`style.css:155`, sidebar on the RIGHT);
`@media (max-width:820px)` at `style.css:2513-2523`; `test_layout.py SHELL["web"]` reads
`#posture-chip` and `menu_id="#menu-popup"`; `spec-test.html` carries a copy of the `#perm` markup
and reads `#perm-proceed`, `#model-chip`.

## MA4-T0 (implementer) — ids → classes inside `#stage`, zero behaviour change
Every id inside `#stage` and the three JS-built strips become classes (keep existing classes);
window ids stay (`sidebar`, `open-tabs`, `projects`, `btn-new`, `sess-card`, `agent-drawer`,
`keys`, the home greeting if it is outside `#stage`). Move `<dialog id="perm">` INSIDE `#stage`
as `class="perm"`, switch `showModal()` → `show()` and give it the same in-flow placement the
terminal edition uses (`position: static; flex: none` above the composer — check
`static-terminal/style.css` `.perm` rules); the Esc/backdrop semantics must be re-created by hand
where `showModal` used to provide them (the terminal `perm.js` shows how). Update `spec-test.html`
(keeps ids AND adds classes), `test_layout.py SHELL["web"]` selectors. `<label for>` → `aria-label`
as T0 did. Acceptance: `grep -n 'getElementById\|querySelector("#' static/js/*.js` shows window
ids only (paste); web spec 207/207, layout PASS, `test_no_console` PASS;
`git diff --stat -- persian-claude-gui/static-terminal/` empty. Report ≤ 20 lines.

## MA4-T1 (builder) — factories, one cell
`makeComposer(root, cell)`, `makeControls(root, cell)` (chips, pickers, `positionMenu` measuring
against the CELL's box — `offsetParent` must be the cell: give `.cell` `position: relative` and
assert the popup never writes a `right` larger than the cell's slack), `makePerm(root, cell)` in a
new `static/js/perm.js` (verbatim move; AskUserQuestion and Skip-on-timeout unchanged);
`render.js`: `scope.cell`/`scope.tab`, `statusline` + context notice + queue strip painted into
`state.cell`, one `APPLY` table replacing `toChrome`'s copy and `app.js applyChrome`; every
session-scoped POST/GET carries `tab` (the terminal edition's list is the checklist; the web
also has `/api/attach/*` if it is per-session — check the server, and `/api/open-file`);
`app.js` builds one cell from `#stage`. Acceptance: `grep -n '^let \|^const .* = document'
static/js/composer.js controls.js perm.js` shows nothing per-session (paste); web spec
207/207, layout PASS; terminal diff empty. Report ≤ 25 lines.

## MA4-T2 (builder) — grid + the visible control + `test_split.py` on web
`#stage` → `#grid[data-split]` + `<template>`; `cells[]`, focus by pointerdown/focusin and
`alt+1..4` (`e.code`); a tab lives in ≤1 cell; shrink parks; 5th session parks the focused cell's
tab; the three document chords dispatch to the focused cell; permission for an unplaced tab opens
in the focused cell with the existing source line. **Web-only:** a three-segment control in the
window topbar (not per cell) — «۱ | ۲ | ۴» — because this edition is a GUI for a non-technical
user; `/split` also works via the same window-local command path `/export` and `/branch` use.
Each cell gets a digit badge; `.focused` marker calm (1px accent, `emil-design-eng` restraint).
CSS: `#grid` `minmax(0,1fr)` both axes, `.cell{display:flex;flex-direction:column;min-width:0;
min-height:0;position:relative;container-type:inline-size}`, the four `@media (max-width:820px)`
rules that concern the column → `@container`; sidebar rules stay `@media`. `test_split.py` gains a
web branch (`PCG_UI` unset) with the same 17 checks plus: the segmented control POSTs nothing and
sets `data-split`; a picker menu opened in the LEFT-most cell (cell 2 or 4 under RTL) is fully
inside that cell's box. Acceptance: `test_split.py` PASS on both editions; web spec ≥ 207, layout
PASS incl. a split-4 pass, `test_no_console` PASS; terminal gates unchanged (`test_split.py`
terminal still 51/51). Include the stream measurement as T2 did. Report ≤ 30 lines.

## MA4-T3 (implementer) — help + wiki
`static/help.html` gains the same «چند گفتگو هم‌زمان» section in this edition's voice (load
`stop-slop`); `wiki/grid.md` gains a "web edition" paragraph (segmented control, `positionMenu`
inside a cell, perm dialog no longer modal); `wiki/editions.md` notes that both editions share
`test_split.py`. Report ≤ 10 lines.
