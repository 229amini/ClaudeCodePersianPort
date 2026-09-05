# E2 — Terminal edition identity (bead pcg-4ob.2)

Context: `EDITIONS-PLAN.md`. Branch `v2`. Depends on E1 (`static-terminal/` exists, `--ui`
flag, `{{TITLE}}` marker). Work only inside `persian-claude-gui/static-terminal/` and
`test_layout.py`. Do NOT edit `static/` (web edition), `wiki/`, or `*.md`.
Read `wiki/rtl-rendering-notes.md` §"Nothing in the shell was responsive" and
`wiki/frontend-modules.md` before touching `style.css`. `stop-slop` principles apply to any
user-facing Persian text you touch in `help.html`: plain, human, no filler.

## Goal

The terminal edition is named «کلاد فارسی — ترمینال», reports v0.0.1, and its project/session
sidebar sits on the **left** edge of the window (VS Code placement), with the transcript column
on the right. Everything else about the v2 tree is unchanged.

## Steps

1. **Left sidebar.** `style.css` line ~154 (`body.app { grid-template-columns: 288px minmax(0, 1fr) }`).
   The page is `<html dir="rtl">`, so grid column 1 is the RIGHT edge. Put the sidebar on the
   left with the smallest change that keeps every existing `@media` breakpoint working:
   prefer swapping the column order and pinning `#sidebar` / `#stage` with explicit
   `grid-column` — do not flip `direction` on the grid or on `body` (that re-orders every
   inline child; `wiki/rtl-rendering-notes.md`). Check the two breakpoints from the 2026-08-23
   responsive work still collapse correctly (the narrow layouts must not draw the sidebar
   over the composer). The sidebar's own inner direction stays RTL — only its placement moves.
   The resize handle / hover-preview, if any, must anchor to the new inner edge.

2. **Name.** Replace the literal «کلاد فارسی» with «کلاد فارسی — ترمینال» at:
   `static-terminal/index.html` lines ~67 and ~95 (sidebar header, welcome box);
   `static-terminal/strings.fa.js` line 12 (`appName`) and line ~255 (welcome message);
   `static-terminal/help.html` title (line 6) and body mentions (lines ~52, 54, 60, 510) —
   only where the text names the product; a sentence that contrasts «کلاد فارسی» with the
   terminal keeps the plain name. The `<title>` tag already carries `{{TITLE}}` from E1.
   Check `test_strings.py` still passes — it compares wiki rows against `strings.fa.js`; if a
   changed string is one it checks, the wiki row is the foreman's to update: report it, do not
   edit the wiki.

3. **Version.** Already `0.0.1` in `server.py`'s `EDITIONS` table from E1. Confirm the footer
   and welcome box render `v0.0.1` — both read `{{VERSION}}`.

4. **`test_layout.py` (terminal).** Under `PCG_UI=terminal`, add ONE assertion: at 1280×800
   the sidebar's `getBoundingClientRect().left` is 0 (± 1px) and the stage's right edge is at the
   viewport's right. Keep the web-edition path untouched.

## Acceptance

- `PCG_UI=terminal`: `test_layout.py` PASS at all three widths including the new assertion;
  `test_column.py` 22, `test_keys.py` 60, `test_dialogs.py` 31, `test_shell.py` 29,
  `test_strings.py` 24, `test_tui_vocab.py` 82, `run_spec_test.py` at E1's terminal count.
- `PCG_UI=web`: `run_spec_test.py` 174/174, `test_layout.py` PASS — proves the web tree was not
  touched (`git diff -- persian-claude-gui/static` empty).
- Boot `server.py --no-window --ui terminal`, fetch `/`: `<title>` is
  «کلاد فارسی — ترمینال — v0.0.1»; the page contains no bare «کلاد فارسی» outside the
  contrast sentences you list in the report.

## Verify

```
cd persian-claude-gui
set PYTHONIOENCODING=utf-8
set PCG_UI=terminal
C:\Python314\python.exe test_layout.py
C:\Python314\python.exe test_column.py
C:\Python314\python.exe test_keys.py
C:\Python314\python.exe test_dialogs.py
C:\Python314\python.exe test_shell.py
C:\Python314\python.exe test_strings.py
C:\Python314\python.exe test_tui_vocab.py
C:\Python314\python.exe run_spec_test.py
set PCG_UI=web
C:\Python314\python.exe run_spec_test.py
C:\Python314\python.exe test_layout.py
```

Do not commit. Report ≤ 20 lines: the CSS change you chose and why, every gate count, any
wiki row that now disagrees with `strings.fa.js`.
