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
`test_strings.py`, `test_tui_vocab.py`. `test_layout.py` runs on both and gates its
edition-specific selectors in one `SHELL` table. Run the web gates with `PCG_UI` unset and the
terminal gates with `PCG_UI=terminal`; a gate you forget to flip passes against the wrong tree
silently.

## The terminal edition's left sidebar (E2, 2026-09-05)

The page is `<html dir="rtl">`, so grid column 1 is the right edge. The sidebar moved left by
swapping the track order (`minmax(0,1fr) 288px`, same swap in both `@media` blocks) and
pinning `#sidebar { grid-column: 2 }` / `#stage { grid-column: 1 }`. **No `direction` flip
anywhere** — that would re-order every inline child (`rtl-rendering-notes.md`). Two things
follow the pane's inner edge and had to move with it: `#sidebar`'s border is now
`border-inline-start`, and `showPreview()` in `chrome.js` opens the hover card off
`pane.right`, clamped to the window. `test_layout.py`'s terminal branch asserts the sidebar at
`x = 0` and the stage reaching `documentElement.clientWidth` — not `innerWidth`, because the
probe page carries a 10 px classic scrollbar and the shell lays out 10 px narrower.

**A `[popover]` will not move by changing one inset.** The agent drawer had to follow the
sidebar to the other edge (`inset-inline-end: 28px` had become physical left, on top of the
sidebar). Swapping it to `inset-inline-start: 28px` measured **no change**: the popover UA
sheet sets `inset: 0`, so the opposite side was still `0`, the box was over-constrained, and
Chromium kept the physical-right side. `inset-inline-end: auto` alongside it is what makes the
move real — the same family as the `height: fit-content` trap in `rtl-rendering-notes.md`.
`test_layout.py`'s terminal branch opens the drawer and asserts it does not intersect the
sidebar; the check went red with the one-property version.

## Rules

- Nothing is removed from the web edition; CLI features are added in its own look.
- The terminal edition has no chips or pickers by design; `/model`, `/effort`,
  `/output-style`, `/permissions` and Shift+Tab are the interface.
- `V2-PLAN.md` §4's will-not-build list applies to both.
- A server route serves both editions; never fork one per edition.
