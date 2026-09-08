# MA5 — the grid survives a reload (pcg-6nf.8), both editions

## The bug, measured

After a browser reload `data-split` reverts to 1 with a single empty cell. Neither the split
count nor the cell→tab map survives, so a user in a 4-way split loses the whole layout, not
just which conversation sat where.

## What is true today (scouted, do not re-derive)

- The grid is **purely a client concept**. `/api/tabs` (`server.py:3349`) returns
  `{active, tabs:[{tab, session_id, cwd, busy, pending_permission, spawned_at, worktree}]}` —
  no cell index, no split count. **The server needs no change for this bead.**
- `setSplit(n)` (`static/js/app.js:184`, `static-terminal/js/app.js:188`) is the one writer of
  `grid.dataset.split`; it adds/parks cells and calls `paintSplitControl` (web only).
- A cell's tab is assigned in exactly two places per edition: `park()` clears it
  (`static/js/app.js:413`, terminal `:383`) and the placement path sets it
  (`static/js/app.js:475`, terminal `:445`).
- Boot: `addCell()` makes one cell, then `loadTabs()` → `applyTabs(data)`, whose
  `if (!focusedTab())` branch puts **one** tab into the focused cell.
- **Nothing in this project persists any client state today** — no `localStorage`, no
  `sessionStorage`, not even composer drafts. This is the first one; keep it that way, one
  mechanism only.

## Design

`sessionStorage`, not `localStorage`. The server binds a **random free port every run**, so the
page origin differs run to run and neither store survives a relaunch — but `localStorage` would
leave a dead entry per port forever, and `sessionStorage` cleans itself up when the window
closes. Scope is therefore exactly what the bead asks: **across reload**, not across relaunch.

One key, one shape:

```js
sessionStorage.setItem("pcg.layout", JSON.stringify({ split: cells.length, cells: [tabId, ...] }))
```

`cells` is positional; a cell with nothing in it stores `""`.

## Acceptance

1. `saveLayout()` and `restoreLayout(alive)` live in `app.js`, both editions, both wrapped in
   `try/catch` — a window with site data blocked must boot normally, not throw.
2. `saveLayout()` is called from the three sites that can change the layout: `setSplit()`,
   `park()`, and the placement path that sets `cell.tab`. No other call sites.
3. Restore runs inside `applyTabs()`, at the top of the existing `if (!focusedTab())` branch:
   apply the saved split, then place each saved tab **that is still in `alive`** into its own
   cell index. If it placed at least one tab, the branch's existing auto-pick is skipped; if it
   placed none, today's behaviour runs unchanged.
4. Restore happens **once per page load**. A module-level flag guards it — `applyTabs` also runs
   on reconnect, and a reconnect after the user closed every tab must not resurrect a stale
   layout.
5. A saved tab that the server no longer lists is dropped silently; its cell stays blank
   (`composer.setBlank(true)`, as `setSplit` already does for a fresh cell).
6. A corrupt or absent value parses to "no saved layout" and boots exactly as today.
7. Web edition: the segmented control reads the restored split (`paintSplitControl` already runs
   inside `setSplit`, so this should need no extra line — verify, don't add one).

## Verify

- `python test_split.py` — extend it, don't write a new gate. Assertions: after a save with
  split 4 and three placed tabs, a fresh grid + `applyTabs` with the same tab list restores
  split 4 and the same three cell indices; with one tab missing from the list, that cell is
  blank and the others hold; with `sessionStorage` empty, placement is byte-identical to today's
  behaviour; a second `applyTabs` on the same load does not re-restore.
- `python run_spec_test.py` and `PCG_UI=terminal python run_spec_test.py` — both must stay at
  207/207 and 174/174.
- `python test_layout.py` and `PCG_UI=terminal python test_layout.py`.
- Report ≤ 20 lines.

## Out of scope

Composer drafts, focus position, and the sidebar's scroll offset. One mechanism, one bead.
`pcg-1ug` (an open session redraws as the home greeting after reload, transcript empty) is a
**separate root cause** being fixed alongside this — do not try to fix the empty transcript here.
