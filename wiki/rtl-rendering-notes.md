# RTL rendering — what M3 actually needed

Built and verified 2026-08-04. **Extended 2026-08-05 with spec rule 8 and cases 9–12; extended
again 2026-08-06 with two layout guards: the gate is now `PASS — 20/20`** (12 cases, 20 assertions)
in `persian-claude-gui/static/spec-test.html`. This file records what was **not** obvious from
`claude-persian-rtl-spec.md`.

## Three defects the spec gate could not see, found by driving the real app (2026-08-06)

The §4/§5 acceptance pass on the author PC. All three are shell-layout bugs, and the harness is
structurally blind to them: `spec-test.html` has no `.app` class, so it never builds the flex shell
the real window uses.

1. **The composer could never grow past one line.** `composer.js` sets
   `input.style.height = scrollHeight`, but `#input { flex: 1 }` resolves to `flex-basis: 0%`, and
   in a COLUMN flex box (`.comp-box`) the basis replaces the height property on the main axis. The
   inline height was computed and discarded on every keystroke; a six-line Persian message stayed a
   36 px box with a hidden scrollbar. Fixed with `flex: none` in `.comp-box #input`.
2. **Every tool card was crushed to 2 px once the transcript scrolled.** `#log` is a column flex
   box and `details.card` sets `overflow: hidden`, which zeroes a flex item's *automatic minimum
   size* — so cards shrank freely while `.msg` bubbles (overflow visible) held their content size.
   Short conversation: invisible. Long one: the summary line, the parameters and the tool output
   all vanish behind a 2 px border, including in history replay. Fixed with `#log > * { flex: none }`
   and guarded by the `flexShrink === "0"` assertion — the one thing about it that is
   layout-independent enough for the harness to check.
3. **Persian lines in an LTR box were RTL but left-aligned.** The spec's base block sets
   `text-align: left` on `pre`/`.tool-output`, and that *inherits* into `linesAuto()`'s per-line
   divs. Direction was right, alignment was not — M8-acceptance case 9/10 asks for right-aligned
   Persian lines. `linesAuto()` now tags each line `.ln` and `.ln { text-align: start }` resolves
   per line. A direct rule beats an inherited value from any layer, so the binding spec block is
   untouched.

A fourth, smaller one: `renderMarkdown()` now passes `breaks: true`, so the newlines a user types
survive into the bubble. Without it six typed lines rendered as one run-on paragraph — harder to
re-segment by eye in Persian than in Latin.

## Rule 8 — the containers that are LTR on purpose

Cases 1–8 are all message-shaped and **structurally cannot** catch the project's worst BiDi bug.
`.tool-output`, `<pre>` and `.path` force `direction: ltr`, which is right for the *box* and wrong
for its *content* — and that content is Persian far more often than it looks: a file being written,
an `Edit.new_string`, a command's output, the parameters shown in the approval dialog. Until
2026-08-05 the dialog pushed every string through `pathEl()` and the tool card dumped
`JSON.stringify(input)`, so the user read mangled LTR Persian *at the moment they were asked to
consent to it*.

The fix is `linesAuto()` in `js/bidi.js`: split on `\n`, one `<div dir="auto">` per line, inside the
LTR container. Three things about it are load-bearing:

- **Per line, not per run.** A run-level `<bdi>` around the Persian leaves adjacent digits outside
  the isolate — case 12 exists to catch exactly that.
- **No direction detection in JS.** `dir="auto"` is the whole algorithm; splitting on newlines is
  not a content sniff.
- **A blank line needs a `<br>`** or it has no line box and silently vanishes.

`renderParamRows()` in `js/render.js` is the single builder for tool parameters, used by the card
**and** the dialog — case 10 fails if they ever diverge again. The harness therefore carries a copy
of the `<dialog id="perm">` markup from `index.html`; `js/chrome.js` reads those ids at
module-evaluation time, so removing them makes the whole verdict empty rather than failing one case.

## How to re-run the spec tests

One command, free, no CLI turn spent (added 2026-08-05):

```powershell
python persian-claude-gui\run_spec_test.py     # exit 0 = PASS
```

It boots the server, **holds one SSE connection open for the whole run**, drives Edge headless
with `--dump-dom`, and parses `#verdict` out of the DOM. The SSE hold is not optional: the idle
watchdog (`server.py:1349`) tears the server down 10 s after the last client leaves, so a headless
run that only fetches the page loses the race and reports a false failure.

Manual equivalent, if you want to see it: start the server with `--no-window` and open
`http://127.0.0.1:<port>/static/spec-test.html?t=<token>`. The verdict bar shows `PASS — n/n` and
`window.__specChecks` holds the machine-readable result.

The harness pushes each case through `window.renderEvent` — the **shipping** renderer, not a copy
— so a regression in `static/js/render.js` fails the harness. It runs as
`<script type="module">`; see `frontend-modules.md` for why that is load-bearing.

**A page that never ran and a page that passed look the same from outside.** An empty `#verdict`
is what a module load error produces, so the runner treats "no verdict" as FAIL, not as silence.
Confirmed by deleting `js/render.js` and re-running: `FAIL — harness never ran`. If you change the
runner, re-do that negative test — a gate that cannot fail is not a gate.

## Bare paths in prose need JS, not CSS

Spec rule 2 says wrap identifiers in `<bdi>`, but markdown from the CLI contains bare paths that
were never backticked — spec test 3 is exactly that case. CSS cannot reach them. `app.js`
therefore post-processes the rendered DOM with a `TreeWalker`, wrapping matches of:

- `C:\...` drive paths and `\\server\share` UNC
- `http(s)://…`
- `--flags`
- dotted versions (`2.1.221`)

It skips `PRE`, `CODE`, `BDI`, `A`, `SCRIPT`, `STYLE` — those are already isolated, and
double-wrapping breaks the match. Anything rendered outside `renderMarkdown()` misses this pass,
so all message content must go through it.

## Stream deltas must not be fed to marked

Partial `stream_event` text is rendered as **plain text** into the bubble; the markdown parse
happens once on the final `assistant` message, which then replaces the bubble's children. Feeding
half-written fences to `marked` produces flickering garbage. The plain-text phase is still
BiDi-correct because `.msg` carries `unicode-bidi: plaintext` and `dir="auto"`.

## Two bugs the browser found that a screenshot would not

1. **Subresources 403'd.** The window opens at `/?t=<token>` but `style.css`, `app.js`, the fonts
   and the SSE reconnect cannot carry that query string, so every one of them was rejected and
   the page rendered unstyled with no JS. Fixed by having the server set the token as an
   `HttpOnly; SameSite=Strict` cookie on any response whose token arrived in the URL, and
   accepting query **or** header **or** cookie. Do not "simplify" this by exempting `/static/`
   from auth — that would leave the whole UI readable by any local process.
2. **Global scope collision.** `app.js` declared `const log` / `const input` at top level;
   `spec-test.html` loads app.js *and* its own classic script, so both threw
   `Identifier 'log' has already been declared` and the harness silently never ran. The IIFE that
   fixed it is gone as of the 2026-08-05 module split — module scope makes the collision
   impossible — but the two `window.*` exports it introduced are still the harness's only entry
   point. Do not remove them.

## Shift+Space is safe, despite appearances

Browser automation's `type` action delivers ordinary spaces with `shiftKey` set, so an automated
Persian sentence comes out with **every space eaten** and looks like a catastrophic bug. It is a
harness artifact. Probed directly with synthetic events:

| input | `defaultPrevented` | result |
|---|---|---|
| `keydown` space, `shiftKey:false` | `false` | space types normally |
| `keydown` space, `shiftKey:true` | `true` | `U+200C` inserted |

If a future session sees spaces vanishing under automation, verify with a synthetic-event probe
before touching `app.js`. Real keyboards behave correctly.

`setRangeText` is used rather than the spec's `document.execCommand` — it keeps native undo and is
not deprecated. Plan §B-2 explicitly permits either.

## Design decisions

- **Dark-only** since the claude.ai-style shell redesign (user decision 2026-08-04, superseding
  the earlier follow-the-OS light+dark). Warm graphite palette (`#262624` bg, `#d97757` coral
  accent), reference screenshots: claude.ai home + Codex sidebar. Vazirmatn stays binding
  (spec rule 3).
- **Shell layout**: `body.app` is a two-column grid; RTL puts the first column — the sidebar —
  on the RIGHT. spec-test.html has no `.app` class and keeps the old stacked body layout; keep
  that split or the harness breaks.
- **User bubble at the RTL start (right) in a filled bubble; assistant is plain full-width text**
  (claude.ai-style, no border). Alignment is layout only; it never substitutes for `dir`.
- **Home / empty state** is class-driven: a MutationObserver on `#log` toggles `body.home`
  whenever the log has no children. Renderer stays untouched.
- **Scrollbar sits on the left** because the shell is RTL, consistently in every pane
  (spec rule 7).
- `line-height: 1.9` is a spec floor, not taste — measured 30.4px at 16px base. Code blocks drop
  to 1.6 because their content is Latin.

## Two CSS traps the redesign hit (will bite again)

1. **A class display rule defeats `hidden`.** `button.round { display:inline-flex }` made the
   stop button visible despite `stopBtn.hidden = true` — the UA's `[hidden]{display:none}` loses
   to any authored display. Guard: `[hidden] { display:none !important }` now sits in the shell
   block. Don't remove it.
2. **The global `button` style leaks into chrome buttons.** `button:hover { background:
   var(--accent-strong) }` painted sidebar session rows coral on hover, because `.sess` and
   `.proj-head` are `<button>`s. Any new transparent button needs its own hover override.

Both survive the 2026-08-05 cascade-layer restructure untouched — `!important` beats normal
declarations in any layer, and trap 2 is why every visual rule shares one `components` layer.
See `frontend-modules.md`.
