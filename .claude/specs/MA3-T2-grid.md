# MA3-T2 — terminal edition: the 1 / 2 / 4 grid, focus, routing, `/split`, `alt+1..4`, `test_split.py`
Agent: builder
Files: `persian-claude-gui/static-terminal/index.html`, `style.css`, `js/app.js`, `js/render.js`,
`js/commands.js`, `js/agents.js`, `js/chrome.js` (tab-strip click → focused cell),
`strings.fa.js` (the `/split` help line + cell badge word), new `test_split.py`,
`test_layout.py` (a `data-split=4` pass).
Spec: Read `.claude/specs/MA3-design.md` in full; implement §2–§5.
1. `index.html`: `#stage` content becomes a `<template id="cell-tpl">`; `#grid` holds 1, 2 or 4
   `.cell` stamped from it, `data-split="1|2|4"` on `#grid`. Each cell's topbar shows its Persian
   digit badge («۱»…«۴») — cell order is DOM order, so «۱» is top-RIGHT under `dir=rtl`.
2. `app.js`: `cells[]`, `focused` index; a tab lives in ≤1 cell; `switchTab(tab)` places the tab
   in the focused cell (parking that cell's previous tab, server tab stays open, sidebar/tab-strip
   still list it) or focuses the cell that already holds it. Focus follows `pointerdown`/`focusin`
   inside a cell (capture) and `alt+1..4` (`e.code === "DigitN"`, never `e.key`). POST
   `/api/tab/activate` on focus; never rely on `cls.active` for anything.
3. Routing per design §2: `routeEvent` renders every tagged event through
   `withRenderTarget(entry.node, entry.scope)`; `scope.background = !scope.cell`; busy toggles
   `cell.root.classList` and the focused cell mirrors to `body.busy`; a `permission_request` for
   an unplaced tab opens in the focused cell with the existing «از نشست دیگر» source line.
4. The three document-level chords (shift+tab, Esc, ctrl+o/t) registered ONCE and dispatched to
   the focused cell per design §3.
5. `/split 1|2|4` as a window-local command in `WINDOW_COMMANDS` + `cmdHelp.split`; shrinking
   parks the removed cells' tabs; growing stamps empty cells (`blankView()` state).
6. CSS: `#grid{display:grid; grid-template-columns/rows: minmax(0,1fr)…}` per `data-split`;
   `.cell{display:flex;flex-direction:column;min-width:0;min-height:0}`; popups capped to the cell
   and kept in-viewport; the four `@media (max-width:820px)` rules move to `@container` on
   `.cell` (`container-type:inline-size`). `.focused` cell gets a visible but calm marker
   (the edition's existing accent token, 1px, nothing animated — `emil-design-eng` restraint).
7. `test_split.py` exactly as design §5 lists, reusing `measure()`/`hold_sse` from
   `test_layout.py`; negative-test it (remove `min-height:0` on `.cell` → it must fail; put a
   stray `id` inside the template → it must fail). `test_layout.py` gains a `data-split=4` pass
   at 1280×800.
8. Measure one long stream (`run_spec_test.py`'s 40-append case or a 500-line synthetic) with
   4 cells placed and report appends/frame vs a single cell — design risk 2.
Context: the user's "many agents at once" view (epic `pcg-6nf`), terminal edition first. Read
`wiki/rtl-rendering-notes.md` (`flex: none` family, `minmax(0,1fr)`, `[popover]` insets) and
`wiki/editions.md` before writing CSS. A 2×2 at 1280px gives ~496px cells — the exact width
that broke the shell on 2026-08-23; `test_layout.py`'s 500px case is your reference. Persian
strings only via `strings.fa.js`; keep `test_strings.py` green (T3 finishes wiki/help).
Acceptance:
- `PCG_UI=terminal python persian-claude-gui\test_split.py` → PASS, ≥ 12 checks, both
  negative tests shown to fail.
- `PCG_UI=terminal`: `run_spec_test.py`, `test_keys.py`, `test_dialogs.py`, `test_shell.py`,
  `test_column.py`, `test_layout.py` (incl. the new pass), `test_strings.py` PASS.
- `test_no_console.py` with `PCG_UI=terminal` PASS (index.html changed).
- `git diff --stat -- persian-claude-gui/static/` empty.
Verify: as MA3-T0 plus the two new gates.
Report: ≤ 30 lines incl. the stream measurement.
Out of scope: persisting cell→tab across reload (follow-up bead), wiki/help text (T3), web
edition (MA4).
