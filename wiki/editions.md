# Two editions, one engine

**Decision, 2026-09-05 (user):** the terminal-shaped rewrite of `V2-PLAN.md` does not
replace the web shell. Both ship, as two products behind one `server.py`:

| Edition | Title | Folder | `--ui` | Version line |
|---|---|---|---|---|
| Web | «کلاد فارسی» | `static/` | `web` (default) | `1.x` |
| Terminal | «کلاد فارسی — ترمینال» | `static-terminal/` | `terminal` | `0.x`, from 0.0.1 |

Plan and phases: `EDITIONS-PLAN.md` at the repo root (E1 split → E2 terminal identity →
E3 web port of the CLI features → E4 release). Beads `pcg-4ob.*`.

## How the switch works

- `server.py` holds one `EDITIONS` table; `--ui` (or env `PCG_UI`) picks the folder, the
  title and the version at startup. `STATIC_DIR`, `APP_TITLE`, `APP_VERSION` are module
  globals set in `main()` before `serve()`.
- `_serve_file()` substitutes `{{TITLE}}` and `{{VERSION}}` into every `.html` — the title
  tag in both `index.html`s carries the marker, so the window says which edition and build is
  answering (`wiki/packaging.md` §"The version marker" for why it is server-side).
- The URL path is `/static/...` for both editions; only the on-disk folder differs. Nothing
  in the JS knows which edition it is.
- `setup.ps1` writes two shortcuts, «کلاد فارسی.lnk» and «کلاد فارسی — ترمینال.lnk», the
  second with `--ui terminal`, and deploys both folders. `test_no_console.py` runs once per
  edition.

## Why the user's shortcut showed the terminal edition as "v1.1.0" (2026-09-05)

The shortcut targets the repo working tree, which was checked out on branch `v2` with
`APP_VERSION` never bumped. The web shell on `main` was untouched the whole time. That
confusion is what produced this split: the user wanted both windows, not one replacing the
other.

## Tests

Every test that reads a static folder takes the edition from `PCG_UI` and imports `EDITIONS`
from `server.py`. Defaults: web for `run_spec_test.py`, `test_layout.py`, `test_no_console.py`;
terminal for `test_column.py`, `test_keys.py`, `test_dialogs.py`, `test_shell.py`,
`test_strings.py`, `test_tui_vocab.py`. `test_layout.py` and `test_split.py` (MA4, the
1/2/4 grid) both run on both editions and gate their edition-specific selectors in one table
each. Run the web gates with `PCG_UI` unset and the terminal gates with `PCG_UI=terminal`; a
gate you forget to flip passes against the wrong tree silently.

## The terminal edition's sidebar: left (E2), then right again (2026-09-10)

E2 put it on the left, VS Code shaped. The user's first real pass over the built shell moved it
back to the **right** — in an RTL window the start edge is the right one, and the web edition
had always had it there, so the two editions disagreeing was the anomaly. Read this section as
the mechanics of "which edge", not as an argument for either.

The page is `<html dir="rtl">`, so grid column 1 is the right edge:
`body.app { grid-template-columns: var(--side-w) minmax(0,1fr) }` with
`#sidebar { grid-column: 1 }` / `#stage { grid-column: 2 }`, both pinned `grid-row: 1`.
**No `direction` flip anywhere** — that would re-order every inline child
(`rtl-rendering-notes.md`).

**`--side-w` is the only width knob, and that is load-bearing.** It is 272 px, and 48 px under
`body.app.rail` (see `grid.md` §the rail). The two narrow-window `@media` blocks override the
custom property and never the `grid-template-columns` shorthand — a shorthand override would
re-declare the collapsed track and silently reopen the tree at exactly the widths where the
rail matters most. `body.app.rail` is (0,2,1) against `body.app`'s (0,1,1), so it wins by
specificity at every breakpoint regardless of source order.

Two things follow the pane's inner edge and move with it: `#sidebar`'s border is
`border-inline-end`, and `showPreview()` in `chrome.js` opens the hover card off
`min(anchor.left, pane.left) − card.offsetWidth − 10`, clamped ≥ 8.

**A `[popover]` will not move by changing one inset.** The agent drawer has to sit away from
whichever edge the sidebar is on. Changing only the near inset measures **no change**: the
popover UA sheet sets `inset: 0`, so the opposite side is still `0`, the box is
over-constrained, and Chromium keeps the side you were trying to leave. The opposite inset set
to `auto` is what makes the move real — the same family as the `height: fit-content` trap in
`rtl-rendering-notes.md`. With the sidebar on the right the drawer is
`inset-inline-end: 28px; inset-inline-start: auto`; it was the mirror of that when the sidebar
was on the left. `test_layout.py`'s terminal branch opens the drawer and asserts it does not
intersect the sidebar; the check went red with the one-property version, in both directions.

`test_layout.py` asserts `side.x + side.w == documentElement.clientWidth` and `stage.x == 0` —
`clientWidth`, not `innerWidth`, because the probe page carries a 10 px classic scrollbar and
the shell lays out 10 px narrower.

**The gate measured the wrong box for one commit.** `test_layout.py` captured its `sidebar`
rect *inline in the final result object*, which runs AFTER the split-4 block — so the moment
the rail existed, the right-edge and drawer-overlap assertions silently retargeted onto the
48 px rail and kept passing. The rect is hoisted next to `menuBox`, before the split, now. Any
assertion about the sidebar's *expanded* geometry must be captured before anything changes the
split.

### Cards on a ground (BridgeMind port P1, 2026-09-24)

`body.app` carries `padding` and `gap` of `--gap` (8 px, 4 px at ≤ 820 px) on `--ground`, so the
sidebar and every pane are cards one gutter in from the window edge. `test_layout.py` asserts
`side.x + side.w == clientW − GUTTER` and `stage.x == GUTTER` — the same exact-position check,
moved by one gutter; its `GUTTER` constant is the CSS value and must change with it. The stage is
deliberately not a card (the panes are), and `#grid`'s old `gap: 1px` on a `--border` background
(the gap *was* the divider) is gone. Design: `BRIDGEMIND-PORT.md` §D2–§D4.

## Rules

- Nothing is removed from the web edition; CLI features are added in its own look.
- The terminal edition has no chips or pickers by design; `/model`, `/effort`,
  `/output-style`, `/permissions` and Shift+Tab are the interface.
- `V2-PLAN.md` §4's will-not-build list applies to both.
- A server route serves both editions; never fork one per edition.
