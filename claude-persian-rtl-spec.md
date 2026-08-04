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

Test 3 is the one that catches the global-`dir="rtl"` mistake. Test 4 catches a missing `unicode-bidi: isolate`.

---

## Things that look like solutions but are not

- **Setting `text-align: right` without `direction`** — aligns the block but leaves character order wrong.
- **Reversing strings in JavaScript** — never do this. The Unicode Bidirectional Algorithm is the browser's job; manual reversal corrupts combining marks and breaks copy-paste.
- **A CSS `direction` toggle button** — a per-message `dir="auto"` handles mixed conversations automatically. A manual toggle is wrong the moment one message is Persian and the next is English.
- **Relying on the font to fix direction** — the font handles glyph shaping and joining. Direction and reordering are separate concerns handled by CSS and the BiDi algorithm.
