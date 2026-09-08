# T1 — the terminal edition's user row is a `>` echo, not a bubble (pcg-qmy.10)

## The bug, measured

Post-TP1 visual pass, 2026-09-08. `static-terminal/` inherited the web edition's chat bubble
verbatim. V2-PLAN §3.1 row 1 reads `> prompt echo, dimmed | wrapper/user_echo with uuid | One row,
.path on any Windows path inside | have` — it is marked **have** and it is not.

Computed style of `.msg.user` on the live page:

```
border-radius: 14px
background:    rgb(58, 57, 55)   <- a filled pill
padding:       7px 14px
opacity:       1                 <- the plan says DIMMED
::before content: none           <- no prompt marker at all
```

This is the most visible remaining gap in the edition whose entire purpose is TUI fidelity: every
conversation opens with a user message.

## Wanted

One row. No pill, no background, no border radius. Dimmed. Opening with the mirrored prompt marker,
**in the same gutter the assistant's coral `⏺` uses** — the gutter is already established and
`test_column.py` asserts the `⏺` marker shares it with a tool icon.

`.path` LTR-isolation on any Windows path inside the text already works. Keep it. The 2026-09-09
`bidi.js` change (a token-only `<a>` gets `dir="ltr"`) also applies here and must keep applying.

**Do NOT touch `static/`.** The web edition keeps its bubble; that is a standing decision, not an
oversight.

## The marker: reuse the mark that already ships

**Amended 2026-09-09**, after the first attempt correctly refused the original wording. The spec had
said the marker must come from `strings.fa.js` as `FA.*`. That was wrong: no glyph in this edition
works that way. `⏺` is `content: "⏺"` inlined at `static-terminal/style.css:1005`, and
`⎿ ※ ☐ ☑ ▸ ⏵ ✻` are literal characters handed to `glyph()` in `js/render.js` (445, 1596, 1707,
2548). Zero glyphs live in `strings.fa.js`, and `test_strings.py` does not check any — it scans
Persian strings for leaked Latin words. Putting this one marker behind `FA.*` would contradict six
precedents sitting beside it.

Use **the product's own mirrored prompt mark, which already ships**: the `.comp-mark` SVG at
`static-terminal/index.html:220-225`, documented at `style.css:1596` as the same geometry as the
sidebar head and `assets/make_icon.py`, and named by `V2-PLAN.md` §3.2 row 1 ("Mirrored prompt mark
(the product mark already is one)"). This is reuse of a recorded mark, not an invented glyph, which
is what the original wording was trying to protect against.

One constraint on the mechanism, your choice otherwise: the mark must take its colour from the row
(`currentColor` via `mask-image`, or equivalent) rather than carrying a baked fill, so the dimming
and any future theme change reach it. A per-row inline `<svg>` element is not wanted — this is a
transcript row rendered many times, and a CSS `::before` is the cheaper shape.

## Also in scope — corrected

The original spec assumed V2-PLAN §3.1 row 2, the queued-prompt row, wears the same pill. **It does
not**, measured 2026-09-09: it is not a `.msg.user` at all but `.queue-strip`/`.queued-row`
(`style.css:2381-2411`), already `background: none` and `color: var(--fg-muted)`, and it lives above
the composer rather than in the transcript (`wiki/parity-chrome.md` §"The queue strip"). Nothing to
fix there.

Leave its behaviour and position alone. Do add one cheap guard assertion that `.queued-row` still
carries no background, so a later change to the user row does not quietly drag the queue strip back
into a pill.

## Out of scope

Assistant rows, tool rows and the `⎿` result branch already read correctly. Do not touch them.

## Acceptance

1. `.msg.user` in the terminal edition: no background, no border-radius, no pill padding; dimmed;
   one row; marker present in the shared gutter.
2. The marker is the product's own already-shipping mirrored prompt mark, drawn via a CSS
   `::before` that takes its colour from the row. No new glyph, no `FA.*` entry, no per-row `<svg>`.
3. A Windows path inside a user row still renders LTR-isolated (`.path`), and a bare URL still gets
   the token-only `dir="ltr"` treatment from `bidi.js`.
4. `.queued-row` still has no background (a guard, not a change).
5. History replay and live rendering agree — the same row shape both ways. This project has been
   bitten repeatedly by a replayed turn rendering differently from a live one
   (`wiki/frontend-modules.md` §"A reload RE-RENDERS every finished turn"), and the reload backfill
   added at `645abf4` means a user row is now re-rendered from `/api/session` on every reload.
6. `static/` is byte-identical to HEAD.

## Verify (all free)

- Extend `test_column.py` (the gate that owns the gutter and the TUI glyphs): assert the user row's
  marker shares the gutter, and that the row carries no pill (background and radius both absent).
  It must be a computed-style or geometric assertion — `wiki/rtl-rendering-notes.md`: a
  `textContent` assertion is blind to this entire class.
- NEGATIVE-TEST it: revert the CSS, watch the new assertion fail, restore. Report the failure text.
- `PCG_UI=terminal python run_spec_test.py` → 177/177 plus additions; `python run_spec_test.py` →
  210/210 unchanged (proof `static/` was not touched).
- `test_column.py`, `test_keys.py`, `test_dialogs.py`, `test_shell.py`, `test_strings.py`,
  `test_tui_vocab.py`, `test_split.py` both editions, `test_reload.py` both, `test_layout.py` both.
- Report ≤ 20 lines.
