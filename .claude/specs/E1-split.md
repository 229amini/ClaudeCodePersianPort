# E1 — Split into two UI folders, one engine (bead pcg-4ob.1)

Context: `EDITIONS-PLAN.md` at the repo root. Branch `v2`. Work dir `persian-claude-gui/`.
Read `wiki/dev-environment.md` first (interpreter is `C:\Python314\python.exe`; set
`PYTHONIOENCODING=utf-8`). Do NOT edit any file under `wiki/` or `*.md` — the foreman owns docs.

## Goal

After this task, `server.py --ui web` serves the web shell exactly as `main` has it today, and
`server.py --ui terminal` serves the v2 tree exactly as this branch has it today. Nothing in
either UI changes behaviour. Only the folder layout, the edition selector, and the test harness
change.

## Steps

1. **Folders.** `git mv persian-claude-gui/static persian-claude-gui/static-terminal`, then
   `git checkout main -- persian-claude-gui/static` so `static/` is `main`'s web tree,
   byte-identical (verify with `git diff main -- persian-claude-gui/static` → empty, before step 3).

2. **`server.py` edition table.** Replace the two constants (`APP_VERSION` line 52, `STATIC_DIR`
   line 55) with:
   ```python
   EDITIONS = {
       "web":      ("static",          "کلاد فارسی",            "1.1.0"),
       "terminal": ("static-terminal", "کلاد فارسی — ترمینال",  "0.0.1"),
   }
   UI_EDITION = os.environ.get("PCG_UI", "web")
   STATIC_DIR, APP_TITLE, APP_VERSION = (HERE / EDITIONS[UI_EDITION][0],) + EDITIONS[UI_EDITION][1:]
   ```
   Add `--ui {web,terminal}` to argparse (line ~4061), default from `PCG_UI` env, default `web`;
   `main()` sets the three globals from the choice before `serve()` (keep `serve()`'s signature).
   Every existing reader of `STATIC_DIR` / `APP_VERSION` must see the chosen edition — grep them.
   The env var exists so tests that boot the server can select the edition without a flag.

3. **`{{TITLE}}` marker.** At the substitution (line ~3945) also replace `b"{{TITLE}}"` with
   `APP_TITLE`. In BOTH `static/index.html` and `static-terminal/index.html`, change the `<title>`
   tag's literal «کلاد فارسی» to `{{TITLE}}`. Only the title tag — sidebar header, footer,
   welcome box, `strings.fa.js appName` and `help.html` stay literal (E2 handles the terminal
   edition's other name sites). Rendered web title must still read «کلاد فارسی — v1.1.0».

4. **Tests take the edition.** Every test that reads or serves a static folder gets one
   helper: `EDITION = os.environ.get("PCG_UI", <default>)`, `STATIC = HERE / EDITIONS[EDITION][0]`
   (import the table from `server.py` — do not duplicate it). Tests that boot `server.py` pass
   `--ui EDITION`. Defaults:
   - default **web**: `run_spec_test.py`, `test_layout.py`, `test_no_console.py`, `smoke_test.py`
     (if it touches static at all — check).
   - default **terminal**: `test_column.py`, `test_keys.py`, `test_dialogs.py`, `test_shell.py`,
     `test_strings.py`, `test_tui_vocab.py` (lines 277–325 read `static/js/...` — point them at
     the terminal folder).
   Line references from the scout: `STATIC = HERE / "static"` at test_strings.py:47,
   test_shell.py:54, test_layout.py:30, test_keys.py:42, test_dialogs.py:47, test_column.py:46;
   runtime `/static/` URLs at run_spec_test.py:74, test_shell.py:480, test_layout.py:253,
   test_keys.py:601, test_column.py:358. The URL path the server serves stays `/static/...`
   regardless of edition — only the on-disk folder moves.

5. **`test_layout.py` on both editions.** The file on this branch was extended for v2 (70 lines
   vs `main`). It must pass with `PCG_UI=web` AND `PCG_UI=terminal`. Where a v2 assertion has no
   counterpart in the web tree (or vice versa — compare with `git show main:persian-claude-gui/test_layout.py`),
   gate that assertion on `EDITION`. Same rule for `run_spec_test.py` if its Python side has
   grown edition-specific expectations (it is not in the `main..v2` diff, so probably not).

6. **`setup.ps1`.** A second shortcut next to the existing one (line 234 `'کلاد فارسی.lnk'`,
   243–244 target/arguments): name `'کلاد فارسی — ترمینال.lnk'`, same `$pythonw` target,
   arguments `"$serverPy" --cwd "$ProjectDir" --ui terminal`. Keep the file UTF-8 **with BOM**
   (`wiki/packaging.md` — encoding failures are silent). Run `test_no_console.py` (line 276)
   once per edition. Keep the script idempotent (re-running must not error on an existing
   shortcut — copy whatever guard the first shortcut uses).

## Acceptance

- `git diff main -- persian-claude-gui/static` shows only the `<title>` marker change.
- `PCG_UI=web`: `run_spec_test.py` → `PASS — 174/174`; `test_layout.py` PASS at all three widths;
  `test_no_console.py` PASS.
- `PCG_UI=terminal`: `run_spec_test.py` PASS at the count it reports on this branch today
  (record it); `test_layout.py` PASS; `test_no_console.py` PASS; `test_column.py` 22,
  `test_keys.py` 60, `test_dialogs.py` 31, `test_shell.py` 29, `test_strings.py` 24,
  `test_tui_vocab.py` 82 — all PASS, all unchanged counts.
- `test_units.py` and `test_transcript_path.py` PASS (edition-independent).
- Booting `server.py --no-window --ui terminal` and fetching `/` with the token gives a page whose
  `<title>` is «کلاد فارسی — ترمینال — v0.0.1»; `--ui web` gives «کلاد فارسی — v1.1.0».
- `setup.ps1` still parses: `powershell -NoProfile -Command "[scriptblock]::Create((Get-Content -Raw setup.ps1))"` exits 0.
- No `smoke_test.py` run — transport is untouched.

## Verify (run all, paste counts)

```
cd persian-claude-gui
set PYTHONIOENCODING=utf-8
C:\Python314\python.exe run_spec_test.py
C:\Python314\python.exe test_layout.py
C:\Python314\python.exe test_no_console.py
C:\Python314\python.exe test_units.py
C:\Python314\python.exe test_transcript_path.py
set PCG_UI=terminal
C:\Python314\python.exe run_spec_test.py
C:\Python314\python.exe test_layout.py
C:\Python314\python.exe test_no_console.py
C:\Python314\python.exe test_column.py
C:\Python314\python.exe test_keys.py
C:\Python314\python.exe test_dialogs.py
C:\Python314\python.exe test_shell.py
C:\Python314\python.exe test_strings.py
C:\Python314\python.exe test_tui_vocab.py
```

Do not commit. Report ≤ 20 lines: files touched, every gate's count, anything you had to
decide that this spec did not say.
