# E4 — code-review fixes (bead pcg-4ob.9)

Branch `v2`, work dir `persian-claude-gui/`. Eight verified findings from `/code-review`.
Do not commit. Do not edit `wiki/` or `*.md`. Each fix gets one negative test where a gate
exists (break it, watch the assertion go red, restore).

## Builder — `static/js/composer.js`, `static/js/render.js`, `static-terminal/js/render.js`, spec

**F1 Ctrl+R has two exits that skip `endSearch()`** (composer.js ~919). The submit handler
only flips `popMode` to `"slash"` and sends `input.value` — so clicking `#send` while
searching POSTs the search query as a chat message and loses the stashed draft. A tab switch
(`restoreComposer`/`applySwitch`) resets neither `popMode`, `searchDraft` nor the popup, so
the next Enter in the new tab inserts the old tab's history entry. Fix: submit in search mode
= `endSearch(true)` (accept the highlighted match into the box) and return without sending;
every composer restore/switch path calls `endSearch(false)` + `closePopup()` first. Spec:
one assertion for each exit.

**F2 Ctrl+G vs tab switch** (composer.js ~771). `editExternally()` disables the box while
`/api/editor` blocks, but `applySwitch()` re-enables it, and the resolve writes into whatever
tab is active. Fix: capture the tab id at request time; on resolve, if that tab is still
active `putInBox` as today, otherwise write the text into that tab's saved draft (the per-tab
composer snapshot that already exists) and leave the current box alone. Spec: switch tabs
between request and resolve, assert the current box is untouched and the origin tab's draft
holds the edited text.

**F3 Two bash predicates** (composer.js ~744). `refreshBashMode()` tests raw
`input.value.startsWith("!")`; submit tests `bashCommand(value.trim())` then `if (command)`.
So `" !dir"` runs a shell command with no chip shown, and a bare `"!"` shows the chip but is
sent to the CLI as a message. Fix: ONE predicate — `bashCommand(value)` returns `null` when
the trimmed value does not start with `!`, else the rest (possibly `""`); both the chip and
submit use it; submit does `if (command !== null)` and a bare `!` is swallowed, as the
terminal edition does (`static-terminal/js/composer.js` `runBash` path — copy its rule).
Spec: `" !dir"` shows the chip; bare `"!"` neither sends nor runs.

**F4 `/export` drops every closed card** (composer.js ~806). `transcriptText()` uses
`innerText`, which omits the body of a closed `<details>`, and every tool/diff/shell card
defaults closed. Fix: read the way the terminal edition's `textOf()` does if it handles this;
otherwise clone the log, set `open` on every `details` in the clone, take its `innerText`.
Spec: export a transcript with one closed tool card, assert the body is in the text.

**F6 `!` output does not survive a restart** (render.js ~1949). `wrapper/shell` lives only in
the in-memory Hub backlog. In the CLI's own transcript the command and its output arrive as
`<bash-input>…</bash-input>` / `<bash-stdout>…</bash-stdout>` / `<bash-stderr>…</bash-stderr>`
blocks **prepended to the next user message**, and neither edition's `render.js` recognises
them, so after `--resume` or a sidebar open the next user bubble shows the raw tags as prose.
**Measure first**: grep `~/.claude/projects/**/*.jsonl` for `<bash-input>` and read the exact
shape (which tags, whether stdout/stderr are separate, where in the `content` array). Then, in
the `user` case of BOTH `static/js/render.js` and `static-terminal/js/render.js`: split those
blocks off the text, render each as the same shell card the live `wrapper/shell` path draws
(one function, called from both), and render the remaining text as the user message (or
nothing if empty). Same normalisation in both editions so live view and replay converge
(`wiki/sessions-and-history.md` — one renderer, two sources). Spec (web) + `test_column.py`
(terminal): replay a user event carrying the tags, assert a shell card and no literal
`<bash-` in the bubble.

**F7 Ctrl+R renders up to 5000 rows per keystroke** (composer.js ~604). `refreshSlash()`
caps at `.slice(0, 50)`; `refreshSearch()` does not. Apply the same cap before `renderPopup()`.

## Implementer — `static-terminal/style.css`, `setup.ps1`, `test_layout.py`

**F5 Terminal agent drawer opens over the sidebar** (static-terminal/style.css ~2296).
`#agent-drawer { inset-inline-end: 28px }` is physical LEFT under `dir=rtl`, where the sidebar
now is. Change to `inset-inline-start: 28px` so it opens into the stage on the physical right.
Add to the terminal branch of `test_layout.py`: open the drawer (it is a `[popover]`,
`showPopover()` on it is enough in the probe) and assert its rect does not intersect the
sidebar's rect at 1280×800. Negative-test by flipping the property back.

**F8 `setup.ps1` runs `test_no_console.py` twice for zero coverage** (~line 293). That gate
only asserts a 403 and never reads a static file (its line 30 says so). Replace the second run
with what the comment claims: after deploy, `Test-Path` on `<DeployRoot>\static\index.html` and
`<DeployRoot>\static-terminal\index.html`, failing with the same Persian error style the
script uses elsewhere if either is missing. Keep the file UTF-8 **with BOM**, CRLF; parse-check
with `[scriptblock]::Create((Get-Content -Raw setup.ps1))`.

## Verify

```
cd persian-claude-gui
set PYTHONIOENCODING=utf-8
C:\Python314\python.exe run_spec_test.py          (web; count will grow — report it)
C:\Python314\python.exe test_layout.py
set PCG_UI=terminal
C:\Python314\python.exe run_spec_test.py          (174/174 unless F6 adds there — report)
C:\Python314\python.exe test_column.py            (22 + F6's assertion)
C:\Python314\python.exe test_keys.py              (60/60)
C:\Python314\python.exe test_layout.py
```

Report ≤ 20 lines: per finding what changed, the negative test, final counts, and for F6 the
measured transcript shape (paste one redacted line).
