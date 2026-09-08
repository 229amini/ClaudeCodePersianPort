# The grid — split view (both editions, MA3/MA4)

Design: `.claude/specs/MA3-design.md` (architect, 2026-09-06). T0-T2 build the grid;
this file is T3's condensed record of it, plus the MA1/MA2 facts a cell reuses.

## Shape

A `.cell` is today's single `#stage`, stamped N times from `<template
id="cell-tpl">` into `#grid` (`display:grid`, `grid-template-columns:
repeat(N, minmax(0,1fr))`). Three former singletons became factories —
`makeComposer(root)`, `makeControls(root)`, `makePerm(root)` (perm dialog cut
out of `chrome.js` into new `js/perm.js`) — one instance per cell. Every
cell-local `id` from the one-cell era is now a class (T0): a duplicate id
across four stamped copies is invalid, and a stray `getElementById` would
silently always hit cell 1. `render.js` paints cell chrome through ONE
apply-table (`APPLY`) instead of the two hand-kept copies `toChrome` and
`applyChrome` used to be; `scope.cell` rides beside `scope.tab`/
`scope.background` through `withRenderTarget`.

## Focus and commands

One index, `cells[focused]`, set by pointerdown/focusin inside a cell
(capture), by `alt+1`..`alt+4` (`e.code`, never `e.key` — a Persian layout
puts «۱» in `e.key`), and by switching to a tab already placed elsewhere. The
three document-level chords (shift+tab, Esc, ctrl+o/t) dispatch to the
focused cell rather than binding per instance. `/split 1|2|4` is the only
layout command; any other number is refused as text, never sent to the CLI.

## Parking, not closing

Shrinking the grid parks the removed cells' tabs — server session stays
open, sidebar still lists it — never auto-closes, never auto-grows past 4.
A `permission_request` for a tab placed in no cell opens in the focused
cell, reusing the existing «این درخواست از گفتگوی دیگری است» line unchanged.

## Two CSS decisions

`.cell { min-width:0; min-height:0 }` inside the `minmax(0,1fr)` grid — the
same overflow bug this project has hit three times before (2026-08-06,
2026-08-23), now per-column instead of per-window. And the old window-width
`@media` breakpoints move to `@container` on `.cell`
(`container-type:inline-size`): a 2x2 grid at 1280px gives each cell ~496px
— the exact 2026-08-23 narrow-window case — but a window-width media query
cannot see a per-cell size, only `@container` can.

Reload restores cell 1 only (the server's own `active` tab); persisting
which tab sat in which cell is a follow-up, not built here.

## MA1 status, reused per cell

One function, `tabStatus(tab)`, four states, no second source of truth:
`running` (`state.outstanding.size > 0`), `waiting` (a queued
`can_use_tool`/AskUserQuestion for that tab, wins over `running`), `error`
(last `result` was `is_error` and not `aborted_streaming`, cleared by the
next send), else `idle`. Painted as the binary's own `●` glyph, recolored
per state, Persian word in `title`. The grid's per-cell dot and the
sidebar's `.sess-dot` call the same function — one computation, two paint
sites, plus each cell's own digit badge (`cellBadgeTitle`) for which
`alt+N` reaches it.

## MA2 worktree, reused per cell

`--worktree <name>` at spawn (not `--name`, which echoes nowhere) puts the
session's transcript under `<repo>/.claude/worktrees/<name>` on branch
`worktree-<name>`, git-locked by the CLI for as long as a process holds it.
`worktree:"auto"` picks `agent-<n>`, smallest free `n`. Such a session shows
an LTR `⎇ agent-2` chip after its title. `/api/projects` folds a worktree's
sessions into its parent repo rather than listing the worktree on its own.
Removal is manual (`git worktree remove`) — the CLI owns the lock and
nothing in this app releases it.

## Web edition (MA4)

MA4 ported the same grid onto `static/` — same factories, same `APPLY` table,
same focus model — with three deltas, all because the web edition is a
window for a colleague who will never type a command. A three-segment
control (`#split-seg`, «۱ | ۲ | ۴») sits in `#window-bar` above `#grid` and
drives the split by click; `/split 1|2|4` still works, through the same
`js/composer.js` path, and both write the same `data-split` attribute — the
control exists because a chord or a slash command is not something this
audience discovers on its own. `positionMenu()` (`controls.js`) measures
against the focused cell's own box now, not the window: `.cell` is
`position: relative` so a popup's `offsetParent` is the cell, which is what
keeps a menu opened in the left-most cell (under RTL, cell 2 or 4) inside
that cell instead of the window it would otherwise overflow into — the same
per-column fix the `@container` breakpoints are. And `#perm` is no longer a
`<dialog>` opened with `showModal()`: `showModal()` blocks the *whole
page*, so one cell asking for approval would have frozen the other three.
It moved in-flow as `.perm`, opened with `show()` (MA4-T0), with the
Esc/backdrop behaviour `showModal()` used to give for free now hand-built
in `perm.js`.

## Open items

- `/split 4` under roughly 1000px window width is unproven headlessly:
  headless Edge's `--virtual-time-budget` wedges before the probe finishes
  at that size. Verify by eye below ~1000px.
- At 760x480, four columns cannot fit their own chrome (topbar + prompt +
  status line) under any CSS — `test_split.py` marks that size `tight` and
  checks only that the column boxes stay inside the window, not that their
  content does.
