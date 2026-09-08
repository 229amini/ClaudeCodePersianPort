# TP1 — the terminal edition's prompt, status line and empty state (bead `pcg-qmy.9`)

Measured side-by-side on 2026-09-08: the running `claude` TUI **2.1.263** (screen-captured) against
`static-terminal/` in Chrome, same project, same empty state. Everything below is drift from
**V2-PLAN §3.2 / §3.4** and `wiki/tui-strings.md` §4 — not taste. Read those three sections first;
they are binding. `wiki/tui-keys.md` and `wiki/editions.md` give the surrounding contract.

**What the real TUI draws in the empty state** (reference, LTR — this edition mirrors it):
mark flush at the TOP-LEFT with three unboxed lines beside it (`Claude Code v2.1.263` /
`Opus 5 (1M context) with high effort · Claude Max` / `D:\projects\Claude`); a large empty body;
a full-width horizontal rule; a bare `>` prompt line; a second full-width rule; then the status
rows immediately beneath — `D:/projects/Claude | [PONYTAIL] | Opus 5 (1M context) | High` and
`▶▶ auto mode on (shift+tab to cycle)`. No box anywhere, no buttons, nothing centred.

Two user decisions taken 2026-09-08, both recorded here so nobody re-opens them: **full TUI prompt
shape**, and **follow the CLI and drop the welcome box**.

## 1. The prompt becomes a TUI prompt
- Delete the rounded card: `.comp-box` loses its `border-radius: 16px`, its border and its
  background fill. In their place, one 1px rule above and one below, each spanning the **full
  column width** (use the palette's existing muted border colour — add no new token).
- Add the mirrored prompt mark at the start of the input line (RTL start = the **right**). §3.2:
  "Mirrored prompt mark (the product mark already is one)". Muted, decorative, and **never part of
  the textarea's value** — it must not reach the CLI, be selectable as text, or shift the caret.
- Remove the circular send button, the paperclip and the folder chip from the prompt area. Enter
  already sends; `pickPosture()` already has Shift+Tab. **Delete only the visible controls, never
  the code paths** — Ctrl+V paste and drag-and-drop attachment must still work, and the `?` keys
  sheet already documents both.
- The prompt block sits at the **bottom** of the column; the transcript grows from the top.

## 2. The status line moves under the prompt
- §3.4 is titled "Status line, under the prompt" — it currently renders **424px** below it, pinned
  to the window bottom while the composer floats mid-column. It must sit immediately beneath the
  prompt's lower rule, with no gap, and the pair must be bottom-anchored together.
- **The model is missing.** §3.4 row 3 is "Model, effort, output style | Muted, one line"; the row
  renders `تفکر / لحن / پوشه` only. Add the model. Take the field order and every string from
  `wiki/tui-strings.md` §4 and `strings.fa.js` — invent no wording. If the model genuinely only
  arrives on `system/init`, say so in the report rather than faking a placeholder.
- The posture row draws one `⏵`. `wiki/tui-strings.md` §4 annotates `posture.accept_edits` with
  «با `⏵⏵`». **Check the table before changing anything**: if the double glyph belongs only to
  `accept_edits`, a single glyph on «حالت محتاط» is correct and this item is closed with no edit.

## 3. The empty state
- Drop the welcome box: no border, no background, no radius (currently radius 10px / 1px border /
  `#30302e`). The mark plus its three lines sit flush at the top **start** of the column — RTL, so
  that is the top-**right**, mirrored from the TUI's top-left.
- Keep the three hint columns (`/`, `@`, `?`). `wiki/tui-strings.md` §5 assigns them to the welcome
  («جعبهٔ خوش‌آمد») and the key-outside-the-sentence rule there still applies; only the box chrome goes.
- Nothing is vertically centred any more: content grows from the top, the prompt stays at the bottom.

## Out of scope
`static/` (the web edition keeps its own look — `git diff --stat -- persian-claude-gui/static/`
must be unchanged), `server.py`, and the Claude mark itself (this project ships an **original**
mark by CLAUDE.md; never Anthropic's pixel-art creature).

## Verify — run all, paste every verdict line
`PCG_UI=terminal` for the terminal gates, `PYTHONIOENCODING=utf-8` always (Persian output crashes
the run without it):
- `run_spec_test.py` terminal → `PASS — 174/174`, web → `PASS — 207/207`
- `test_keys.py` 60 · `test_dialogs.py` 31 · `test_shell.py` 29 · `test_column.py` 23 ·
  `test_strings.py` 24 · `test_tui_vocab.py` 82
- `test_layout.py` on both editions · `test_split.py` terminal `PASS - 91/91`, web `PASS - 99/99`
- `test_no_console.py`, `test_units.py`

Several of these assert the very shape being changed (`test_shell.py` checks the status stack in
§3.4's order; `test_layout.py` measures the composer; `test_dialogs.py` requires the dialogs to sit
inside `#stage` above the prompt). Where an assertion legitimately describes the OLD shape, update
it **and say so, line by line, in the report** — never weaken or delete one silently. If a gate
fails for a real reason, stop and report; do not tune the gate to pass.

Files are CRLF; keep them CRLF. Report ≤ 25 lines.
