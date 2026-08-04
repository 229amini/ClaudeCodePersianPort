# RTL rendering — what M3 actually needed

Built and verified 2026-08-04. All 8 spec test cases pass, plus 11 automated assertions in
`persian-claude-gui/static/spec-test.html`. This file records what was **not** obvious from
`claude-persian-rtl-spec.md`.

## How to re-run the spec tests

```powershell
$env:PYTHONIOENCODING = "utf-8"
& "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" `
    "persian-claude-gui\server.py" --cwd . --no-window
# then open the URL it prints, swapping the path:
#   http://127.0.0.1:<port>/static/spec-test.html?t=<token>
```

The verdict bar at the bottom shows `PASS — n/n`, and `window.__specChecks` holds the machine
readable result. The harness pushes each case through `window.renderEvent` — the **shipping**
renderer, not a copy — so a regression in `app.js` fails the harness.

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
   `Identifier 'log' has already been declared` and the harness silently never ran. `app.js` is
   now wrapped in an IIFE exporting only `window.renderEvent` and `window.renderMarkdown`. The
   M5 history view will hit the same trap if that wrapper is removed.

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

- **Light + dark**, driven by `prefers-color-scheme`. The `ui-ux-pro-max` skill recommended
  dark-only and a Lora/Raleway pairing; both were declined — Vazirmatn is binding under spec
  rule 3, and a tool the colleague uses all day should follow the OS.
- **User bubble at the RTL start (right), assistant at the end (left).** Alignment is layout
  only; it never substitutes for `dir` on the text.
- **Scrollbar sits on the left** because the shell is RTL, consistently in every pane
  (spec rule 7).
- `line-height: 1.9` is a spec floor, not taste — measured 30.4px at 16px base. Code blocks drop
  to 1.6 because their content is Latin.
