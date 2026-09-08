# MA3-T4 — terminal grid: what the real window showed (five defects, one gate extension)
Agent: builder
Files: `persian-claude-gui/static-terminal/style.css`, `static-terminal/js/app.js` (badge on
empty cells only), `static-terminal/strings.fa.js` + `wiki/tui-strings.md` (one word),
`test_split.py`.
Measured 2026-09-07 in a real Chrome window (terminal edition, `/split 4`):
1. `.statusline` overflows the cell bottom by 27 px at 1280×800; at 1242×622 and 1000×700 cell
   ۱'s status rows paint over cell ۳'s topbar. The `min-height: 0` family again — a flex child in
   the cell stack is not allowed to shrink, so the stack overflows instead of the `.log` giving way.
2. With `/model` open in a 4-way cell, 66 descendants overflow the cell (`picker-body` +48 px); the
   composer and the whole status line are pushed out and drawn over the cell below; the option list
   cuts mid-row on «Haiku».
3. At 350–400 px cell height the composer + the two-line key hint + 3–4 status rows leave one or
   two clipped transcript lines — the conversation is invisible in a 4-way split under ~800 px.
4. The notice for `/split 4` says «چیدمان به ۴ ستون تغییر کرد» but the layout is 2×2.
5. The digit badge renders only in an occupied cell; an empty cell's badge box is 0×0, so nothing
   says which blank cell `Alt+3` targets.
`/split 2` was clean at both sizes; Persian/LTR paths inside narrow cells were correct.

Spec:
- (1)+(2): make the cell stack honest. Every direct child of `.cell` that can grow (`.log`, the
  in-flow `.perm`/`.picker`) gets `min-height: 0` and its own `overflow-y: auto`; the fixed chrome
  (topbar, composer, status rows, key hint) stays `flex: none`. The picker must never push the
  composer: cap it with `max-height: 50cqh` (`.cell` is a size container — set
  `container-type: size`; cells are fixed grid items so this is safe) and scroll inside. Do NOT
  add `overflow: hidden` on `.cell` (it clips the upward slash/file popups); if a popup must be
  clipped instead, say so in the report.
- (3): `@container (max-height: 460px)` on `.cell`: hide the key-hint row, collapse the status
  stack to its single most useful row (the posture/cost row the design's §3.4 order puts first —
  check `wiki/grid.md`), and reduce the composer's max rows. The transcript must keep ≥ 40 % of
  the cell height at 1000×700 split 4.
- (4): change the word in `strings.fa.js` (and its `wiki/tui-strings.md` row byte-for-byte) so the
  notice names the layout truthfully for 2 (two columns) and 4 (a 2×2 grid) — two strings or one
  template, whichever the file already does for counts.
- (5): the badge is rendered by the cell, not by the tab it holds — show it in empty cells too.
- Gate: extend `test_split.py` (both existing sizes + 1242×622) with, per cell, **every**
  descendant's rect inside the cell's rect (1 px tolerance) — (a) with nothing open, (b) with the
  posture picker open in cell 1 via the existing `open_menu` path, (c) with a synthetic 60-line
  transcript in cell 1; plus the empty-cell badge has a non-zero box; plus `.log` height ≥ 40 % of
  the cell at 1000×700 split 4. These MUST fail against the current tree before your CSS change
  (paste the failure lines) — that is the negative test.
Context: the headless gate measured cell boxes against the window but never children against
their cell; this is the third time the project has paid for a flex child that could not shrink
(`wiki/rtl-rendering-notes.md` §"Three defects the spec gate could not see", the 2026-08-23
`.menu-row` case). Ponytail: CSS first, JS only for (5).
Acceptance: `test_split.py` PASS with the new checks (≥ 70 total) after failing before; terminal
`run_spec_test.py` 174/174, `test_keys.py`, `test_dialogs.py`, `test_shell.py`,
`test_column.py`, `test_strings.py`, `test_layout.py` PASS. Web tree untouched
(`git diff --stat -- persian-claude-gui/static/` unchanged from before you started — note the
count, MA4-T0 may be editing it concurrently; never write there).
Verify: `PCG_UI=terminal`, `PYTHONIOENCODING=utf-8`, from `D:\projects\Claude`.
Report: ≤ 20 lines incl. the pre-fix failure lines.
Out of scope: the URL-in-Persian-bubble BiDi nit (separate bead), the web edition.
