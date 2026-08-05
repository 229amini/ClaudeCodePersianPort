# Persian / RTL Rendering Spec

**Written:** 2026-08-04
**Purpose:** implementation spec for any HTML-based front-end that displays Persian (Farsi) content mixed with code, file paths, and terminal output. Hand this to the builder verbatim.

Companion file: `claude-persian-rtl-options.md`

---

## The core rule

**Never set a global `dir="rtl"` on the page or body.**

A global RTL direction mangles every Latin-script fragment on the page. `C:\Users\Lion\Desktop\test.md` renders with the drive letter and the separators reordered, and becomes unreadable. This is the single most common failure and it looks like a font problem when it is actually a direction problem.

Set direction **per message bubble**, and isolate every technical fragment.

---

## Base CSS

```css
/* Per-bubble automatic direction detection.
   `plaintext` applies the Unicode Bidirectional Algorithm paragraph-by-paragraph,
   so a Persian paragraph goes RTL and an English one goes LTR, inside the same bubble. */
.msg {
  unicode-bidi: plaintext;
  line-height: 1.9;
}

/* Code, paths, diffs and terminal output always stay LTR,
   regardless of the surrounding paragraph direction. */
pre,
code,
.path,
.diff,
.tool-output {
  direction: ltr;
  unicode-bidi: isolate;
  text-align: left;
}
```

`unicode-bidi: isolate` is what prevents a code block from inheriting or leaking direction across its boundary. `direction: ltr` alone is not sufficient.

---

## Rules

### 1. `dir="auto"` per message element

```html
<div class="msg" dir="auto">سلام، این یک پیام فارسی است.</div>
<div class="msg" dir="auto">Hello, this is an English message.</div>
```

Let the browser detect direction from the first strong character. Do not compute it yourself.

### 2. Wrap inline identifiers in `<bdi>`

Neutral characters — `\ / . : ( ) [ ] { } - _ @ #` — take their direction from the surrounding text. Inside a Persian sentence, an unwrapped file path or function name will have its punctuation reordered.

```html
<!-- WRONG — the path breaks inside the Persian sentence -->
<p dir="auto">فایل C:\Users\Lion\test.md را باز کن</p>

<!-- CORRECT -->
<p dir="auto">فایل <bdi>C:\Users\Lion\test.md</bdi> را باز کن</p>
```

Apply `<bdi>` to: file paths, function and variable names, package names, URLs, commit SHAs, flags, and version numbers.

### 3. Font

**Vazirmatn** — the best free Persian UI font, with good Latin coverage so mixed text stays visually consistent.

```css
body {
  font-family: "Vazirmatn", "Segoe UI", system-ui, sans-serif;
}

/* Code needs a monospace face; Vazirmatn is not monospace. */
pre, code {
  font-family: "Cascadia Code", "Consolas", ui-monospace, monospace;
}
```

Self-host the font files. Do not rely on a CDN if the app must work offline.

### 4. Line height

`line-height: 1.9` minimum for Persian text. Persian glyphs have taller ascenders and deeper descenders than Latin; the usual `1.5` clips them and makes diacritics collide.

### 5. Digits

Keep **Latin digits** (`0123456789`) inside code, paths, version numbers, line numbers, and any value the user might copy. Persian digits (`۰۱۲۳۴۵۶۷۸۹`) are fine in prose only.

Copying a Persian digit into a terminal or a config file produces a broken value. Never render digits inside a `<pre>`, `<code>`, or `.path` element as Persian.

### 6. ZWNJ in the input box

The zero-width non-joiner (نیم‌فاصله, `U+200C`) is required for correct Persian word forms — for example `می‌رود` versus `میرود`. It has no default key on a standard layout.

Map it to `Shift+Space` in the composer:

```js
inputEl.addEventListener("keydown", (e) => {
  if (e.key === " " && e.shiftKey) {
    e.preventDefault();
    document.execCommand("insertText", false, "\u200C");
  }
});
```

Verify the ZWNJ survives the round-trip to the CLI and back — some pipelines strip zero-width characters as whitespace.

### 7. Scrollbars and layout chrome

When a container is RTL, the scrollbar moves to the left in most engines. Decide deliberately whether the message list is RTL (scrollbar left, feels native to Persian readers) or LTR with RTL text inside it (scrollbar right). Be consistent — mixing the two across panes looks broken.

### 8. LTR containers must still give each line its own `dir="auto"`

*Added 2026-08-05, after the rules above shipped.* `direction: ltr` is correct for a container that must not be reordered — a code block, a path, a tool-parameter box, a tool's stdout. It is **not** correct for the text inside it. An LTR container forces LTR onto every line it holds, so a Persian line comes out left-aligned with its trailing punctuation on the wrong side.

Those containers are not always code. A file's contents, an edit's replacement text, a command's output, the parameters of a tool call awaiting approval — all of them routinely hold Persian, and the tool-approval case is the worst possible place to render it wrongly: the user is being asked to consent to text they cannot read properly.

Keep the container LTR and wrap **every line** in its own `dir="auto"` element:

```html
<div class="tool-output">          <!-- direction: ltr; unicode-bidi: isolate -->
  <div dir="auto">این خط فارسی است</div>
  <div dir="auto">const x = 1;</div>
</div>
```

Line order and the box's own alignment stay LTR; each line resolves its own direction from its first strong character. Latin and neutral-only lines are unaffected.

**Per line, never per run.** Wrapping the Persian *run* inside a line in `<bdi>` looks equivalent and is not: adjacent digits fall outside the isolate and get reordered against the text they belong to. Splitting on `\n` is the whole algorithm — do not detect direction in JavaScript (that is still forbidden by rule 1 and the list at the end of this document).

A blank line needs a `<br>` inside its wrapper, or it has no line box and the blank line silently disappears.

---

## Test cases

Paste each of these and confirm the described result.

| # | Input | Expected |
|---|---|---|
| 1 | `سلام دنیا` | Right-aligned, reads right-to-left, glyphs joined |
| 2 | `Hello world` | Left-aligned, unchanged |
| 3 | `فایل C:\Users\Lion\Desktop\test.md را باز کن` | Persian right-aligned; path intact and readable left-to-right, backslashes in correct positions |
| 4 | A fenced code block containing `if (x > 0) { return "ok"; }` | Left-aligned, LTR, braces and quotes in correct positions, unaffected by surrounding Persian |
| 5 | `نسخه 2.1.221 نصب شد` | Version number reads `2.1.221`, not reordered |
| 6 | `می‌رود` typed via Shift+Space | ZWNJ present; renders as two disjoint word-parts, not `میرود` |
| 7 | Persian paragraph immediately followed by a code block | Neither affects the other's direction or alignment |
| 8 | Long Persian paragraph wrapping over several lines | Consistent right alignment on every line, no clipped descenders |
| 9 | Tool card for a `Write` whose `content` is Persian, Latin code and a blank line | Persian lines right-aligned, Latin lines left-aligned, both inside one LTR box; blank line still visible |
| 10 | Permission dialog for an `Edit` with a Persian `new_string` | The replacement text is readable in the dialog, rendered exactly as the tool card renders it |
| 11 | `tool_result` whose output mixes Persian and Latin lines | Every line takes its own direction; line order unchanged |
| 12 | Persian line containing Latin digits (`مقدار 42 تنظیم شد`) inside tool output | Digits stay attached to that line, in the right place |

Test 3 is the one that catches the global-`dir="rtl"` mistake. Test 4 catches a missing `unicode-bidi: isolate`. Tests 9–12 catch rule 8, and cases 1–8 structurally cannot: they are all message-shaped, and the bug lives in containers that are deliberately LTR.

---

## Things that look like solutions but are not

- **Setting `text-align: right` without `direction`** — aligns the block but leaves character order wrong.
- **Reversing strings in JavaScript** — never do this. The Unicode Bidirectional Algorithm is the browser's job; manual reversal corrupts combining marks and breaks copy-paste.
- **A CSS `direction` toggle button** — a per-message `dir="auto"` handles mixed conversations automatically. A manual toggle is wrong the moment one message is Persian and the next is English.
- **Relying on the font to fix direction** — the font handles glyph shaping and joining. Direction and reordering are separate concerns handled by CSS and the BiDi algorithm.
- **Treating `direction: ltr` on a container as "handled"** — it fixes the box and breaks the content. See rule 8.
