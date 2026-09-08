# MA3-T3 — terminal edition: vocabulary, help and wiki for the grid
Agent: implementer
Files: `wiki/tui-keys.md`, `wiki/tui-strings.md`, new `wiki/grid.md`, `wiki/README.md`,
`persian-claude-gui/static-terminal/help.html`, `static-terminal/strings.fa.js` (only if a
`test_strings.py` row demands it), `test_keys.py` (CONTEXTS gains `Grid`), `test_tui_vocab.py`
only if it asserts the wiki tables' shape.
Spec: (1) `wiki/tui-keys.md` gains `## Grid — window only` with `alt+1`…`alt+4` and `/split`,
Persian column filled, marked as window-added (not a binary chord); confirm against
`extract_tui_vocab.py` output that alt+digit collides with nothing in Chat/Global and say so in
the table note. (2) `wiki/tui-strings.md` gains the rows for the `/split` help line, the cell
badge and the «از نشست دیگر» reuse, matching `strings.fa.js` byte for byte. (3) `wiki/grid.md`:
the design in ≤ 40 lines (cell = stamped stage, factories, one apply-table, focus model, parking
rule, the `minmax(0,1fr)` and `@container` decisions, reload restores cell 1 only) — condensed
from `.claude/specs/MA3-design.md`, plus the MA1 status semantics and the MA2 worktree facts;
index it in `wiki/README.md`. (4) `help.html`: a short Persian section «چند گفتگو هم‌زمان»:
`/split`, `alt+N`, what the dots and the badge mean, the worktree action and that the CLI keeps
the worktree locked while a session is open (removal is manual, `git worktree remove`). Load
`stop-slop` before writing the help text — it is colleague-facing; wiki text is internal.
Acceptance: `PCG_UI=terminal`: `test_strings.py`, `test_keys.py`, `test_tui_vocab.py` PASS;
`wiki/README.md` has the `grid.md` line; help section present (`grep -c "چند گفتگو" help.html` ≥ 1).
Verify: the three gates from `D:\projects\Claude` with `PYTHONIOENCODING=utf-8`.
Report: ≤ 15 lines.
Out of scope: code changes in `js/`; the web edition's help (MA4).
