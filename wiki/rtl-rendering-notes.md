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

## A fourth defect the spec gate could not see: "+2 −1" (2026-08-07)

The diff count on a collapsed tool row rendered as **`1- 2+`**. `+` and `−` are BiDi-neutral, and
in the RTL summary row they reordered to the far side of their own digits — each token individually
flipped, so the row read backwards in a way that looks like a typo rather than a layout bug.

What makes it worth recording is that the obvious check **cannot catch it**:

```js
stat.querySelector(".d-add").textContent === "+4"   // passes. Always.
```

`textContent` is logical order. It says `+4` no matter how the glyphs land on screen. The gate had
this exact assertion and was green while the UI was wrong. Only the computed style sees it:

```js
dirOf(stat) === "ltr" && getComputedStyle(stat).unicodeBidi === "isolate"
```

Fix is spec rule 2 at the smallest possible scope — `direction: ltr; unicode-bidi: isolate` on
`.diff-stat`, not on the row around it. The general lesson, and it applies to every future check
here: **an assertion on text content is blind to every BiDi defect there is.** If a check does not
read a computed style or a measured geometry, it is not a rendering check.

## Diffs render in `.diff`, and rule 8 moved with them

`Edit`/`Write`/`MultiEdit` no longer print `old_string`/`new_string`/`content` as parameter blobs —
they render a real LCS line diff (`render.js` `lineDiff`), in both the tool card and the permission
dialog, through one `renderToolDetail()` so the thing being approved is the thing being shown.

Consequences for anyone touching spec cases 9 and 10: they assert rule 8 against `.diff .dt` now,
not `.param-row .tool-output`. That is the same rule in a different element — an LTR container
whose lines each carry `dir="auto"` — and the content under test is the identical
Persian/Latin/blank mixture. `.tool-output` is still covered by cases 11–12 (Bash output), which is
why both containers stay under test.

Line numbers count **within the hunk**, not within the file. An `Edit`'s `old_string` is a fragment
and the CLI never says where it sits, so numbering from the file's start would be a confident lie.

## A `.kebab-item` is a `<button>`, so `button.danger` paints it (2026-08-08)

The ⋯ menu's delete row rendered as a **blank coral slab** — no icon, no text — and looked armed
before anyone clicked it. Nothing was wrong with the arming logic (`chrome.js:kebabMenu`
disarms every row on open, correctly). It was the cascade:

```
button.danger              (0,1,1)  background: var(--danger); color: #fff
.kebab-item                (0,1,0)  background: none            <- loses on background
.kebab-item.danger         (0,2,0)  color: var(--danger)        <- wins on colour
```

So the *unarmed* row got a coral fill from the generic filled-button rule and coral text from the
kebab rule: `#e5695a` on `#e5695a`. The armed rule `(0,3,0)` was the only one setting a quiet
`--danger-bg`, which meant the two states were **inverted** — arming made it calmer.

Rule: any `<button>` that is styled as a menu row, chip or bare icon must opt **out** of the
generic `button.*` fills explicitly, and the opt-out must be declared **before** the `:hover`
rule of the same specificity or hover stops repainting it. Fixed as
`.kebab-item.danger { color: var(--danger); background: none; }` above `.kebab-item:hover`.

Guarded in `spec-test.html` ("an unarmed delete row is legible, and arming is what changes"):
it asserts idle `color !== background-color`, which is precisely what `textContent` cannot see.

**Writing that guard has its own trap.** `button` carries `transition: background`, so a
`getComputedStyle()` read taken immediately after setting `data-armed` samples the transition at
t=0 and reports `rgba(0,0,0,0)` — a correct rule looks broken. Set `style.transition = "none"` on
the probe element first. Cost me two runs to see it, because the box-shadow from the *same* rule
read fine (box-shadow was not in the transition list).

## Density pass, and the one lever that is locked (2026-08-08)

The transcript was costing more scroll than it needed to. Measured on the spec harness (same
content, same JS, CSS swapped): **2511 px → 2226 px, −11%**, before the tool-call grouping is
counted on top.

**`--lh-fa: 1.9` is not a preference and was not touched.** The spec states it as a *minimum* for
Persian text (`claude-persian-rtl-spec.md` line 92) because Persian ascenders and descenders clip
and diacritics collide at the usual 1.5. It is the single biggest lever in the file and it is
closed. Everything below is what is left once you accept that.

Where the space actually was:

- **`.msg p` had no margin rule at all**, so it inherited the browser's `1em` — and at 1.9 leading
  that stacks a full blank line between paragraphs on top of a gap that already reads as a break.
  Now `.45em`. Biggest single win, and it only shows on multi-paragraph answers, which is why it
  survived every earlier screenshot.
- **`.tool-output` / `.diff` inherited 1.9** although they are terminal transcripts. Now 1.55, with
  the floor restored per line by `:is(.ln, .dl):dir(rtl)`. `:dir()` is the only way to ask —
  direction is decided by `dir="auto"` at render time and rule 1 forbids computing it in JS. If a
  browser lacks `:dir()` the rule drops and everything keeps 1.9, so the failure mode is safe.
  Guarded: "rule 3: a Persian output line keeps the 1.9 floor, a Latin one does not" asserts the
  *ratio* on a real Persian line next to a real Latin one, in the same box.
- `.msg.assistant` was carrying 10 px of block padding with no surface to sit on — it is the most
  repeated element in the app, so that is 20 px per turn for nothing.

**The rail was never continuous, and no `margin-block-start: 0` could have fixed it.** `#log` is a
flex column with a `gap`, and a gap is not a margin. Consecutive collapsed cards now pull back by
`calc(-1 * var(--log-gap))` — which is what the token exists for. Gated on **both** cards being
shut, matching the condition the rail draws under: two open cards are two bordered surfaces and
need the gap to stay two things.

## `dir="auto"` on a diff row sits on the text span, not the row (2026-08-09)

A line-height fix for `.tool-output`/`.diff` assumed `renderDiff()` set `dir="auto"` on `.dl`
(the row) the same way `bidi.js`'s `linesAuto()` sets it on `.ln` (a plain tool-output line) — it
doesn't. `renderDiff()` sets it on the child `.dt` (the text span) only. A `.dl:dir(rtl)` selector
therefore has no `dir` attribute of its own to read on `.dl` and silently resolves off whichever
ancestor has one — the RTL `<html>` shell — so it matches every diff row regardless of content,
in every browser, not just ones that don't support `:dir()`. The fix targets `.dt`, not `.dl`.
Lesson: two elements that look like siblings in the same rendering pass (`.ln` vs `.dl`) can carry
`dir="auto"` at different depths — always grep the actual builder (`renderDiff()`,
`linesAuto()`), never assume parallel structure implies parallel attribute placement.

## Two `popover` traps from the agent drawer (2026-08-09)

`#agent-drawer` (background-agents panel) is a `[popover]`, like the kebab menu, and it re-taught
two lessons worth pinning:

- **`display` on a `[popover]` defeats the UA rule that hides it when closed.** The UA sheet hides
  a closed popover with `display: none`; any authored `display` on the bare `[popover]` selector
  overrides that and the "closed" panel stays painted. Layout styles must sit under
  `:popover-open` only. Already true of `.kebab-menu`, now guarded by a spec assertion ("drawer is
  laid out only while open").
- **`popover`'s `toggle` event is queued, not synchronous.** Tearing down in the `toggle` handler
  alone leaves the panel (and its poll timer) alive for a task after `hidePopover()`. The close
  button calls the teardown directly; `toggle` only backstops Escape/light-dismiss. This cost one
  failing spec run before it was found.
