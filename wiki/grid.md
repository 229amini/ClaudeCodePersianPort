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

### A render may move focus; `focusCell()` waits for it (pcg-0o7, 2026-09-24)

`state` mirrors the focused column's scope, and `withRenderTarget` points `state`, `log` and
`statusline` at another scope for one synchronous render, then puts back what it saved. That
swap is only sound if nothing re-points those three while `fn()` runs — and a render can:
`permission_request` for a conversation in another column calls `showPermission()`, which opens
**that column's** dialog and `.focus()`es it. `focusin` fires synchronously, so the capture
listener ran `focusCell()` in the middle of the swap:

1. `stashFocusedScope()` copied `state` — at that moment the *asking* conversation's scope —
   over the scope of the column being left;
2. `adoptFocusedScope()` re-pointed `state`, and `setFocusedCell()` re-pointed `log`;
3. the render's `finally` then restored the **old** column's `state` and `log` under the new focus.

So the left column's running turn read idle (its ledger now held the other conversation's
`outstanding`), and — worse, and not in the original report — the newly focused conversation's
next lines were written into the column the keyboard had just left. The sidebar dot and the
per-cell dot were both wrong because `tabFacts()` reads the same corrupted scopes, which is why
they agreed and why the bug was first filed against `tabFacts()`.

The fix is at the choke point, not at the dialog: `render.js` counts nested
`withRenderTarget`s (`inRenderTarget()`), and `focusCell()` re-queues itself with
`queueMicrotask` while one is open. `fn()` is synchronous, so the microtask cannot run before the
swap is over; the dialog still takes the keyboard, the bookkeeping just follows one tick later.
Not "don't focus the dialog": that is a UX decision, and any other focus-moving render
(`composer.restore`, a future dialog) would reopen the same hole. Both editions carried the
identical code. Gated in `test_split.py` §6b — negative-tested: without the fix, both assertions
fail at every size on both editions.

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

**Shape, not only hue, in both editions (pcg-973, 2026-09-24).** The terminal edition draws the
state as a glyph (`● ◉ ⊘ ○`, one CSS rule in `static-terminal/style.css`). The web edition's dots
are empty 7px spans, so the same four shapes are drawn with the box instead: filled `background`
(running), an `outline` ring around the disc (waiting), an inset ring plus a 135° gradient band
(error), an inset ring alone (idle). The web spec gate reads each state's outline style, box
shadow, background image and fill (never a colour) and requires four different signatures, for
`.tab-dot` and `.sess-dot` both. Negative-tested: the old CSS gives four identical signatures.

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

## Terminal edition: the visible control, and the rail (2026-09-10)

The grid worked in the terminal edition from MA3 and the user never found it: `/split` was the
only way in, and `help.html` did not mention it. A feature a non-technical user cannot reach is
not shipped. The web edition's segmented `۱ | ۲ | ۴` control is ported into the terminal
sidebar on a labelled row (`paintSplitControl()`, called from `setSplit()` and at boot,
`aria-pressed` tracking the active split). No window bar: it would cost ~36 px of height off
every cell at once, and the sidebar head costs the grid nothing.

**The rail is what makes 4-up usable.** A 272 px sidebar beside four columns is 27% of a
1052 px window spent on chrome. `body.app.rail` collapses it to 48 px — mark, expand toggle,
«+», the split control stacked, a waiting-count ring, one status dot per open conversation,
help — and the 4-up cell goes **378 px → 490 px** at 1052x711, past the ~496 px this file
records as where the shell first broke. The width FOLLOWS the split (2|4 collapses, 1 expands);
the head toggle overrides that until the next split change; both ride the existing
`sessionStorage` record `pcg.layout`, so a reload restores them and a relaunch forgets them,
exactly like the split itself. Apply `body.rail` inside `restoreLayout()` **before**
`setSplit()`, or a restored 4-up lays out twice.

Three things that are not obvious from the CSS:

- **Collapsing must not `display: none` a label.** A `display: none` label is not in the
  accessibility tree, which would leave the rail's dots and its two icon buttons unnamed. The
  four labels are clipped instead (`position: absolute; 1x1px; clip-path: inset(50%)`), which
  keeps them.
- **The rail dot's own `title` wins the hit test** over the row it belongs to.
  `pointer-events: none` on the dot; its `role="img"` / `aria-label` stay.
- **The waiting badge's text is a sentence, not a number** («۲ منتظر تأیید»). The ring draws
  digits from `data-count` via `::before` — presentation only — while the sentence stays in the
  DOM at `font-size: 0` so it remains the accessible name.

Per-cell identity landed with it: `[۱] ● title project-chip`, the mono path moved out of the
topbar into the chip's `title` and the status line. The dot is `tabStatus()` (`chrome.js`) and
the CSS that already painted the sidebar rows — the only thing that had been missing was a
per-cell paint site (`paintCells()` in `repaintTabs()`). No server change. Density work took the
transcript from 58/59% of a 4-up cell to 64/65%, bought from padding and type scale, never by
hiding a status field — `test_split.py`'s "holds more than it shows" assertion exists to make
that non-negotiable, and `LOG_SHARE` is keyed by edition (`terminal: 60, web: 40`) because the
two editions measure differently and one shared number red-gates the other.

## The new-session page (BRIDGEMIND-PORT.md §D8, P4, 2026-09-24)

`static-terminal/js/newsession.js` fills `section#new-session` inside `#stage`; while it is open
`#stage.ns-open > #grid` is `display: none` (hidden, never destroyed — the conversations keep
running). It imports only the leaf modules and gets the grid through a bridge from `app.js`
(`initNewSession`): `currentCwd`, `fits(n)`, `place(tabs, target)`, `say`, `focusBack`.

Three things that are not obvious from the code:

- **The six-conversation limit is read from `/api/tabs` when the page opens**, not from the
  window's `tabList`. `refreshTabs()` is a 200 ms debounce, so a page opened right after a launch
  counted the conversations it had just opened as not there — `test_newsession.py` caught it.
- **`fits(n)` measures `#stage`, not `#grid`**: the grid has no box while the page covers it. It
  adds the sidebar's tree-minus-rail width back for n > 1, the same correction `addPane()` makes,
  because more than one pane collapses the sidebar (§1 of the rail section).
- **Order is the contract.** Opens are sequential (`worktree: "auto"` reserves its name
  server-side — `next_worktree_name` remembers names handed out in this process, since the CLI
  makes the folder only after spawn); any refusal closes every tab this launch opened; the
  reviewer's `plan` posture is set **before** its first message, or the first turn could edit.
  `/clear` is not this page: it is `chrome.js newChatHere()`, one fresh conversation in this
  folder, as in the TUI.

## Open items

- `/split 4` under roughly 1000px window width is unproven headlessly:
  headless Edge's `--virtual-time-budget` wedges before the probe finishes
  at that size. Verify by eye below ~1000px.
- At 760x480, four columns cannot fit their own chrome (topbar + prompt +
  status line) under any CSS — `test_split.py` marks that size `tight` and
  checks only that the column boxes stay inside the window, not that their
  content does.
