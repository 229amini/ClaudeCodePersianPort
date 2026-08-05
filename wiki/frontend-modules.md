# Front-end module layout and CSS layers

Split 2026-08-05 (rework Phase 2). Pure refactor: every spec-test assertion is byte-identical and
still passed 11/11 at the time. `static/app.js` was one 1100-line classic-script IIFE; it is now six
ES modules under `static/js/`. (The gate is 18/18 since rule 8 landed — see
`rtl-rendering-notes.md`.)

## The modules

| file | contents |
|---|---|
| `api.js` | `token` + the `api()` fetch helper. **Leaf — imports nothing.** |
| `bidi.js` | The whole BiDi contract: `TECHNICAL`, `isolateTechnicalTokens`, `applyDirection`, `renderMarkdown`, `pathEl`. **Leaf — imports nothing.** |
| `controls.js` | model picker + approval pill + auto-approval counter. **Imports `api.js` only** — deliberately outside the cycle below; `render.js` drives it one-way (Phase 4) |
| `render.js` | `renderEvent`, renderer `state`, bubble/card/label/block builders, todos, raw cards, statusline |
| `chrome.js` | sidebar (projects → sessions), home state, replay banner, permission dialog |
| `composer.js` | input, ZWNJ, send/stop, attachments, slash autocomplete, lifecycle verbs |
| `app.js` | entry: `window.renderEvent`/`window.renderMarkdown`, init order, SSE transport |

`controls.js` reports failures **inside its own menu**, not through `bubble()`, purely so it never
has to import `render.js` — that import would close a second cycle for a message the user reads
better next to the control they just used anyway.

The composer's lifecycle verbs (`/model`, `/permissions`, `/clear`) `.click()` the button that
already does the job rather than importing the module that owns it. One implementation, no cycle,
and a verb whose button is hidden falls through to the CLI as ordinary text.

## The load-order rule — the one way to break this

`render.js` and `chrome.js` **import each other**, and `render.js` also imports `composer.js`.
That cycle is deliberate and unavoidable: the renderer drives the sidebar (`system/init` →
`setChrome`, `refreshProjects`) and the sidebar replays old transcripts back through the renderer
(plan §B-4's "one renderer, two sources"). Splitting them would mean forking a second history
path, which the architecture forbids.

The cycle is only safe because of one invariant:

> **No module body does work at evaluation time.** Every side effect the single-file version ran
> at top level now lives in `initChrome()` / `initComposer()`, called from `app.js` after all
> modules are live, in the original order.

Break that invariant and you get a temporal-dead-zone `ReferenceError` with a stack that points
nowhere useful: during a cycle, hoisted **function declarations** are already initialised but
`const`/`let` bindings are not. `state` (a `const` in `render.js`) is the live tripwire — read it
at chrome.js evaluation time and it throws.

Two smaller consequences of the same rule:

- **Assignment across the cycle is impossible.** You cannot assign to an imported binding, so
  `currentSession = ev.session_id` became `setCurrentSession(ev.session_id)` (chrome.js) and
  `slashCommands = […]` became `setSlashCommands(…)` (composer.js). The setter keeps the old
  `?? current` semantics — nullish input is ignored.
- **`api.js` exists to keep the cycle small.** `token`/`api()` were originally going to sit in
  `app.js` per the plan's 5-file table, but `app.js` is the *entry*: its body runs last, so
  anything reading `token` during a dependency's evaluation would hit the TDZ. A leaf module costs
  20 lines and removes the whole class of problem.

`strings.fa.js` and `vendor/marked.min.js` stay **classic** scripts. Classic scripts finish before
the first module runs, so `window.FA` and `window.marked` are always there.

## spec-test.html: the gate that fails silently

Modules are deferred. The harness block in `spec-test.html` reads `window.renderEvent`, so as a
plain `<script>` it would run **before** the app module and every assertion would fail — looking
exactly like a BiDi regression. It is now `<script type="module">`: module scripts execute in
document order, so `js/app.js` is guaranteed to have run first. **If you ever convert app.js back
to a classic script, convert the harness back in the same commit.**

The harness also carries a copy of the `<dialog id="perm">` markup from `index.html` (spec case 10
drives the real dialog). `chrome.js` grabs those ids in a module-level `const`, so deleting them
does not fail one case — it throws during evaluation and empties the whole verdict.

`<body data-render-only>` was added to the harness: it carries a token (its subresources need the
auth cookie) but must not open the SSE stream. Live events would land in the middle of the test
log, and the never-ending request stops a headless run from ever settling. `js/app.js` reads the
attribute.

## CSS: one file, four layers

`style.css` stays ONE file. `@layer tokens, base, components, spec;` — lowest priority first.

The two non-obvious choices, both deliberate:

1. **`spec` is LAST, not first.** The binding direction block used to be beatable by any later or
   more specific rule. In the final layer it is not. The plan's sketch had it in `base` (lowest),
   which would have made it *easier* to outrank by accident — the wrong direction for this
   project's highest-frequency failure mode.
2. **Every visual rule shares ONE `components` layer.** The plan proposed `layout` / `components` /
   `state` as separate layers. Don't: layer order beats specificity, so splitting them silently
   flips pairs that specificity currently resolves — `.proj-head:hover` (0,2,0) vs `button:hover`
   (0,1,1) would invert and paint the sidebar coral, with no error anywhere. One layer means the
   intra-visual cascade is provably unchanged. That is the whole reason the split was safe to do
   without a visual regression test (which this machine cannot run — see `dev-environment.md`).

`@font-face` stays outside the layers (font-face is not cascade-sorted). Rules inside a layer are
**not re-indented** — the wrapper is a priority statement, and re-indenting 700 lines would bury
the real diff. Verified: diffing the file with `@layer` lines stripped shows zero rule changes.

`[hidden] { display: none !important }` is in `base` and still wins everywhere — `!important`
beats normal declarations regardless of layer.

Unlayered CSS beats **all** layers. `spec-test.html` and `help.html` both carry inline `<style>`
blocks; they won before by source order and win now by being unlayered, so nothing changed. Keep
that in mind before adding an inline block anywhere else.
