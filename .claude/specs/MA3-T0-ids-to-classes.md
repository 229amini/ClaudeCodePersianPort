# MA3-T0 — terminal edition: every cell-local `id` becomes a class, zero behaviour change
Agent: implementer
Files: `persian-claude-gui/static-terminal/index.html`, `style.css`, `js/*.js`,
`spec-test.html`; the probe pages/selectors inside `test_keys.py`, `test_shell.py`,
`test_column.py`, `test_dialogs.py`, `test_layout.py`, `run_spec_test.py` (terminal branch only).
Spec: Read `.claude/specs/MA3-design.md` §1, §3, §5 first. Every element inside `#stage`
(the transcript `#log`, composer box, prompt textarea, slash/file popups, `#perm`, `#picker`,
status rows, queue strip, agents strip built in JS) loses its `id` and gains the same name as a
class (`id="log"` → `class="log"`; keep any existing classes). Window-level ids stay:
`sidebar`, `open-tabs`, `projects`, `btn-new`, `keys`, `agent-drawer`, `grid`/`stage`. Every
`getElementById("x")`, `querySelector("#x")` and CSS `#x` for a renamed element becomes the class
form (one `$`/`q` helper per module is fine; no other refactor). `spec-test.html` keeps its ids
AND adds the classes. Update the test files' selectors and the `test_dialogs.py` literal/regex
checks per design §3. Nothing else changes: no factories, no grid, no new CSS rules.
Context: prerequisite of the split grid — duplicate ids per cell are invalid and a leftover
`getElementById` would silently hit cell 1. Wait: MA1/MA2 builders edited these files today;
start from the current tree and re-read before every edit. Ponytail: mechanical, additive.
Acceptance:
- `grep -n 'getElementById\|querySelector("#' static-terminal/js/*.js` shows only the window ids
  listed above (paste the output).
- `PCG_UI=terminal`: `run_spec_test.py` `PASS — 174/174` (or the MA1 count), `test_keys.py`,
  `test_dialogs.py`, `test_shell.py`, `test_column.py`, `test_strings.py`, `test_layout.py`,
  `test_tui_vocab.py` all PASS at their pre-task counts.
- Web edition untouched: `git diff --stat -- persian-claude-gui/static/` is empty.
Verify: `$env:PYTHONIOENCODING='utf-8'; $env:PCG_UI='terminal'` then each gate from
`D:\projects\Claude` (interpreter: `(Get-Command python).Source`).
Report: ≤ 20 lines: grep output, gate lines, deviations.
Out of scope: anything in `static/` (web), factories (T1), grid (T2).
