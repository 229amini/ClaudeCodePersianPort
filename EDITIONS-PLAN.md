# Two editions, one engine — plan (2026-09-05)

User decision, 2026-09-05, supersedes the "v2 replaces the web shell" framing in
`V2-PLAN.md` §1 and the «v2» naming in `CLAUDE.md`. Both editions ship; neither replaces
the other.

| Edition | Title | Folder | Version line | Audience |
|---|---|---|---|---|
| **Web** | «کلاد فارسی» | `static/` | `1.x` (next release **1.2.0**) | wants buttons, chat flow, never a command |
| **Terminal** | «کلاد فارسی — ترمینال» | `static-terminal/` | starts at **0.0.1** | wants the CLI's look and keys, plus a VS Code-style project list on the **left** |

One `server.py`, picked by `--ui web|terminal` (default `web`). Two desktop shortcuts. Every
engine route (`/api/history`, `/api/files`, `/api/shell`, `/api/editor`, `/api/export`,
`/api/session/fork`, background tasks) is shared — a fix lands in both. The `v2` branch is the
working branch; it merges to `main` when both editions pass their gates.

## Rules

- **Nothing is removed from the web edition.** Every chip, picker, card and menu on `main`
  today stays. The CLI features v2 measured reachable are *added* in the web look.
- **The terminal edition is the v2 tree as built** (phases v2.0–v2.7), plus: sidebar on the
  left edge, its own name and version, no chips (that is the point of it).
- `wiki/` and the test suite are shared. A test that reads `index.html` takes the folder as a
  parameter; edition-specific tests say which edition they gate.
- The `{{VERSION}}` marker becomes `{{TITLE}}` + `{{VERSION}}`, both written by the process
  that answers, per edition.

## Phases

| # | Phase | Exit criterion |
|---|---|---|
| E1 | **Split**: `git mv static static-terminal`; restore `static/` from `main`; `--ui` flag + `EDITIONS` table in `server.py`; `{{TITLE}}`; tests parameterised by folder; two shortcuts in `setup.ps1` | `--ui web` serves the 1.1.0 window byte-for-byte (spec 174/174, layout, units); `--ui terminal` serves today's v2 window (test_column/keys/dialogs/shell/strings green); `test_no_console` under both |
| E2 | **Terminal identity**: left sidebar, title «کلاد فارسی — ترمینال», version 0.0.1, help.html header, `V2-PLAN.md` retitled | `test_layout.py --ui terminal` at three widths with the sidebar on the left; title bar reads the new name |
| E3 | **Web port** of the reachable CLI features, in the web look, one task each: (a) shared history + Ctrl+R, (b) `@` file completion, (c) `!` shell mode, (d) Ctrl+G editor, (e) `/export` + `/branch` (the CLI's verb; was specced as `/fork`, aligned 2026-09-05), (f) background `/tasks` | each feature spec-asserted in `run_spec_test.py`; nothing on `main`'s chrome removed (diff of `static/` vs `main` is additive) |
| E4 | **Release**: web → 1.2.0 tagged `v1.2.0`; terminal → 0.0.1 tagged `terminal-v0.0.1`; `README`, `CLAUDE.md` status, `M8-acceptance.md` gains an edition column | both shortcuts on a fresh `setup.ps1` run open the right window with the right title |

Out of scope, unchanged: `V2-PLAN.md` §4's will-not-build list applies to both editions.
