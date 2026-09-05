/* ============================================================================
   BiDi discipline — claude-persian-rtl-spec.md.

   The whole contract lives in this file:
     - isolateTechnicalTokens() wraps bare paths/URLs/versions/flags in <bdi>
       (spec rule 2)
     - applyDirection() gives every block-level element its own direction
       (spec rule 1), via autoDir()
     - the marked renderer override that makes raw HTML render as text
   Everything that renders model or user text must go through renderMarkdown()
   so every pass runs — or, for prose filling an element the chrome already
   owns, through fillInline(). A leaf module: it imports nothing.
   ========================================================================= */
"use strict";

/* Neutral characters (\ / . : - _ @ #) take their direction from the
   surrounding text, so a bare path inside a Persian sentence gets its
   separators reordered. <bdi> isolates the run. Spec rule 2. */
const TECHNICAL = new RegExp(
  [
    "[A-Za-z]:\\\\[^\\s\u060C\u061B\u061F\"'`]+",  // C:\Users\...
    "\\\\\\\\[^\\s\"'`]+",                          // \\server\share
    "https?://[^\\s\"'`]+",                         // URLs
    "\\B--[A-Za-z][\\w-]*",                         // --flags
    "\\bv?\\d+\\.\\d+(?:\\.\\d+)+\\b",              // 2.1.221
  ].join("|"),
  "g"
);

/* Direction is never decided by these tags — they are forced LTR in CSS, and
   <a>/<bdi> already isolate. Walking into them would double-wrap. */
const SKIP_TAGS = new Set(["PRE", "CODE", "BDI", "A", "SCRIPT", "STYLE"]);

/* marked v15 renders a raw HTML token verbatim — it has no sanitizer any more,
   by design ("use a library"). In this window that is an injection hole on both
   halves of the transcript: a user pasted CSS into the composer and the <style>
   block restyled the whole app (reported), and <img src=x onerror=…> would run
   script inside the token-authenticated page. So raw HTML renders as the
   literal text it was: escape the token instead of emitting it. ONE override
   covers block and inline alike — the parser's two dispatch sites both call
   renderer.html(token) — and `code`/`codespan` tokens are untouched, so fenced
   and inline code behave exactly as before.
   Configured here, once, at module evaluation: vendor/marked.min.js is a
   CLASSIC script and has therefore finished before any module body runs
   (frontend-modules.md), and this module imports nothing, so the load-order
   invariant that governs the render.js/chrome.js cycle is not in play. */
const escapeHtml = (s) => String(s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
window.marked?.use?.({ renderer: { html: ({ text }) => escapeHtml(text) } });

export function isolateTechnicalTokens(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      for (let p = node.parentElement; p && p !== root; p = p.parentElement) {
        if (SKIP_TAGS.has(p.tagName)) return NodeFilter.FILTER_REJECT;
      }
      return TECHNICAL.test(node.nodeValue)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });

  const targets = [];
  while (walker.nextNode()) targets.push(walker.currentNode);

  for (const node of targets) {
    const frag = document.createDocumentFragment();
    let last = 0;
    TECHNICAL.lastIndex = 0;
    let match;
    while ((match = TECHNICAL.exec(node.nodeValue)) !== null) {
      if (match.index > last) {
        frag.append(node.nodeValue.slice(last, match.index));
      }
      const bdi = document.createElement("bdi");
      bdi.className = "path";
      bdi.textContent = match[0];
      frag.append(bdi);
      last = match.index + match[0].length;
    }
    if (last < node.nodeValue.length) frag.append(node.nodeValue.slice(last));
    node.replaceWith(frag);
  }
}

/* Paragraph-level direction: a Persian paragraph and an English paragraph in
   one message each align correctly. Let the browser detect from the first
   strong character — never compute it in JS. Spec rule 1. */
/* `th` belongs in this list exactly like `td` does: every content-bearing
   element resolves its own direction (rule 1), and a table header row mixing
   an English and a Persian column ("| Command | توضیح |") must let each `th`
   read correctly on its own. A prior pass added `table` here but dropped
   `th` in the same edit — the project's own highest-frequency defect class,
   state bleeding across what should be independent — and left a comment
   claiming the drop was deliberate ("skips every descendant that carries its
   own dir" would blind the table's own dir=auto to the header) which is true
   as far as it goes: once every td/th carries dir=auto, `<table dir=auto>`'s
   own scan (which explicitly excludes text under a descendant that has its
   own dir attribute) finds nothing to read and falls back to its ltr default,
   so a table no longer picks column order from its header's language. That
   trade is the right one — a header cell silently losing its own direction is
   the bug this project keeps re-discovering; a table always laying out
   left-to-right is not. */
const BLOCK_TAGS = "p,li,h1,h2,h3,h4,h5,h6,blockquote,table,td,th,dd,dt,figcaption";

/* Strong-direction LETTERS, per UAX#9 -- and letters ONLY, which is the whole
   correction here. The old comment already claimed that "digits, punctuation,
   whitespace vote for nobody" and the RTL class did not honour it: one flat
   U+0590-U+08FF range swept in the Arabic-Indic digits (U+0660-U+0669), their
   Extended-Arabic twins (U+06F0-U+06F9) and the Arabic punctuation and format
   blocks (U+0600-U+061F, U+066A-U+066D) -- every one of them bidi-WEAK or
   NEUTRAL. So a line like "Total: <12 Persian digits>" counted twelve RTL
   votes against five Latin ones and was pinned rtl, while the browser lays it
   out left-to-right. The gaps between the ranges below are exactly those
   non-letters.

   The LTR class had the mirror-image hole: it knew Latin and nothing else, so
   a Greek, Cyrillic, Armenian, Japanese, Chinese or Korean paragraph quoting
   one Persian word measured rtl=1 ltr=0 and was pinned rtl. All of those are
   strong L in UAX#9.

   Matches the dated amendment to spec rule 1: promote-to-rtl only, letters
   only, same subtree exclusions. */
const RTL_STRONG =
  /[\u0590-\u05FF\u0620-\u065F\u066E-\u06EF\u06FA-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/g;
const LTR_STRONG =
  /[A-Za-z\u00C0-\u024F\u0370-\u04FF\u0531-\u058F\u3040-\u30FF\u3130-\u318F\u4E00-\u9FFF\uAC00-\uD7AF]/g;

/* `dir="auto"` is UAX#9 FIRST-strong: one Latin word at the head of a block
   decides for the whole of it. This product's prose is majority Persian and its
   first word is very often a Latin technical term, so real messages came out
   left-to-right — «Object Cache با Redis کانفیگ شده — ولی یک ایراد در تنظیمات
   دارد…», a list whose first bullet opens with a file name, a Persian sentence
   dense with inline code. Measure instead, and only in the RTL direction: a
   block at least half Persian is set `dir="rtl"`; everything else KEEPS
   `dir="auto"`, so an English block — including a mostly-English one quoting a
   Persian phrase — still resolves LTR by the browser's own algorithm, and the
   spec's first trap (a hardcoded `direction: rtl`) stays avoided.

   Spec rule 1 forbids computing direction in JS *instead of* letting the
   browser read the text; this reads the same text the browser would, skipping
   exactly the subtrees the browser's own scan skips: SKIP_TAGS, and anything
   carrying its own `dir` (pre/code/bdi already do by the time this runs). That
   exclusion is what keeps the table and nested-list trades documented below
   unchanged — a table whose cells all carry `dir` still measures nothing.

   One helper for blocks and for lists: they are the same question at two
   scopes, and forking it is how the two answers drift apart. */
export function autoDir(el, limit = Infinity) {
  let rtl = 0, ltr = 0, seen = 0;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      for (let p = node.parentElement; p && p !== el; p = p.parentElement) {
        if (SKIP_TAGS.has(p.tagName) || p.hasAttribute("dir")) {
          return NodeFilter.FILTER_REJECT;
        }
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  /* `limit` caps how much text is counted, and exists for ONE caller: the
     streaming bubble (render.js), which re-measures on every animation frame.
     Unbounded, that is a full-string regex scan allocating an array of every
     matched character ~60x/s for the length of the answer -- the O(n)-per-frame
     cost the paint coalescing was written to remove, reintroduced beside it.
     The verdict is stable after a few hundred characters; every other caller
     leaves it Infinity and is exact, including the applyDirection() pass that
     re-measures the finished markdown when the message closes. */
  while (seen < limit && walker.nextNode()) {
    const text = walker.currentNode.nodeValue.slice(0, limit - seen);
    seen += text.length;
    rtl += (text.match(RTL_STRONG) ?? []).length;
    ltr += (text.match(LTR_STRONG) ?? []).length;
  }
  el.setAttribute("dir", rtl > 0 && rtl >= ltr ? "rtl" : "auto");
  return el;
}

export function applyDirection(root) {
  /* `dir="auto"` reads the first strong character of the block, and its scan
     skips exactly two things: <bdi>/<script>/<style>, and any subtree that
     carries its own `dir` attribute. An inline <code> carries neither, so a
     block OPENING with a code span — «`seasonOf(ts)` یک تابع خالصه» — resolved
     LTR off the code's Latin letters, and through the list's own dir="auto"
     that dragged every sibling item LTR with it. Measured in Edge: without
     this line `ul:ltr li:[ltr,ltr,ltr]`, with it `ul:rtl li:[rtl,rtl,rtl]`.
     Code is already `direction: ltr` in the spec base CSS — this only makes
     the DOM say what the stylesheet says, which is what takes it out of the
     scan. Fixes p/li/h2/td alike, so it runs before every other pass. */
  for (const el of root.querySelectorAll("pre,code")) el.setAttribute("dir", "ltr");

  /* Two passes over the same list, and the order is the whole trade: every
     block must already CARRY a dir before any of them is measured, or an
     ancestor would count text that its own `dir="auto"` scan is required to
     skip. That is what keeps `table` measuring nothing once its cells have
     their own direction — the documented trade above, unchanged. */
  const blocks = [...root.querySelectorAll(BLOCK_TAGS)];
  for (const el of blocks) el.setAttribute("dir", "auto");
  for (const el of blocks) autoDir(el);
  /* A list is ONE block, not N. Per-`li` dir="auto" let a bullet that opens
     with a Latin token — a file name, a product name, a flag — resolve LTR
     while its Persian siblings stayed RTL: markers down both sides of the same
     list and the trailing «.» of a Persian sentence stranded on the wrong end.
     That is the "scrambled ul", and it is the same first-strong-character
     heuristic the table comment above describes, just applied at a scope too
     small to be meaningful — a list decides its direction once, for all of its
     items, the way a paragraph decides for all of its lines.
     dir="auto" skips descendant text that carries its own dir, so the items
     have to give theirs up for the list to be able to read them at all — same
     mechanism as the table, opposite trade, because unlike a table's columns
     the items of one list are one run of prose. Outermost list only: a nested
     one inherits from the list it hangs off. */
  for (const list of root.querySelectorAll("ul,ol")) {
    if (list.closest("li")) continue;
    for (const el of list.querySelectorAll("li,p,ul,ol")) el.removeAttribute("dir");
    /* Same measurement as a paragraph, at the scope that actually decides: the
       items have just given up their `dir`, so the count reads all of them —
       which is why a list whose FIRST item opens with a code span no longer
       flips the other two. */
    autoDir(list);
  }
}

/* Copy button on code blocks. Idle glyph is two overlapping squares; a
   successful copy swaps it to a check for 1.5s. No Persian literals here —
   labels come from window.STRINGS (this file is a leaf, see header). */
const COPY_ICON =
  '<svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2">' +
  '<rect x="2" y="4" width="8" height="8" rx="1"/><rect x="4" y="2" width="8" height="8" rx="1"/></svg>';
const CHECK_ICON =
  '<svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4">' +
  '<polyline points="2.5,7.5 5.5,10.5 11.5,3.5"/></svg>';

function codeCopyButton(pre) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "code-copy";
  const setState = (icon, label) => {
    btn.innerHTML = icon;
    btn.title = label;
    btn.setAttribute("aria-label", label);
  };
  setState(COPY_ICON, window.STRINGS?.copyCode);
  btn.addEventListener("click", () => {
    try {
      navigator.clipboard.writeText(pre.textContent).then(() => {
        setState(CHECK_ICON, window.STRINGS?.copied);
        setTimeout(() => setState(COPY_ICON, window.STRINGS?.copyCode), 1500);
      });
    } catch { /* no Clipboard API (e.g. insecure context) — button stays idle */ }
  });
  return btn;
}

export function renderMarkdown(text) {
  const host = document.createElement("div");
  const parse = window.marked?.parse ?? window.marked;
  // breaks:true — a single newline is a <br>, as in every chat UI. Without it
  // the six separate lines a user typed collapse into one run-on paragraph, and
  // in Persian that is much harder to re-segment by eye than in Latin.
  host.innerHTML = typeof parse === "function" ? parse(text, { breaks: true }) : "";
  isolateTechnicalTokens(host);
  applyDirection(host);
  // A table wider than the bubble has to scroll itself; left alone it widens the
  // whole transcript, which the spec's no-horizontal-scroll guard forbids.
  for (const table of host.querySelectorAll("table")) {
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    table.replaceWith(wrap);
    wrap.append(table);
  }
  // The copy button sits in the WRAPPER, never inside <pre>: applyDirection()
  // already set dir="ltr" on pre, and spec assertions read pre.textContent —
  // Persian button text landing inside it would corrupt both.
  for (const pre of host.querySelectorAll("pre")) {
    const wrap = document.createElement("div");
    wrap.className = "code-wrap";
    pre.replaceWith(wrap);
    wrap.append(pre, codeCopyButton(pre));
  }
  return host;
}

/* Short model-written prose that FILLS an element the chrome already owns — an
   AskUserQuestion question, an option's label, an option's description. It is
   markdown like everything else the model writes, and as bare textContent it
   lost both halves of the contract: an inline code span kept its literal
   backticks, and its neutral characters («/price-photo/») reordered against the
   Persian around them. That is the scrambled question the user reported, and it
   was rendered at the moment they were asked to answer it.

   parseInline, not parse: the host element is already styled (`.ask-text`,
   `.q-desc`) and a block parse would wrap the text in a <p> carrying a margin
   the stylesheet never set for it. Raw HTML is escaped by the renderer override
   at the top of this file, so `innerHTML` here is exactly as safe as
   renderMarkdown's.

   The host's OWN direction is deliberately not set here: an option label is a
   <bdi> that must stay invisible to its row's scan (spec rule 2), so the caller
   decides — call autoDir() where the element itself is the block. */
export function fillInline(el, text) {
  const src = String(text ?? "");
  if (typeof window.marked?.parseInline === "function") {
    el.innerHTML = window.marked.parseInline(src, { breaks: true });
  } else {
    el.textContent = src;            // no marked: literal text, never markup
  }
  isolateTechnicalTokens(el);
  applyDirection(el);                // inline output has no blocks; pre/code → ltr
  return el;
}

/* Spec rule 8. An LTR container (.tool-output, <pre>, .path) is correct for the
   BOX — code and paths must not be reordered — but it also forces LTR onto the
   CONTENT, so a Persian line inside it comes out left-aligned with its
   punctuation on the wrong side. That is exactly what a tool card and the
   permission dialog show: file content, an Edit's new_string, a tool's stdout.
   Give every line its own dir="auto" and the browser picks per line: Latin and
   neutral-only lines stay LTR, Persian lines go RTL, and line ORDER stays the
   container's. Per line, never per run — a run-level <bdi> strands the digits
   next to it outside the isolate. */
export function linesAuto(text) {
  const frag = document.createDocumentFragment();
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const el = document.createElement("div");
    el.className = "ln";        // .ln { text-align: start } — see style.css
    el.setAttribute("dir", "auto");
    // An empty div has no line box; <br> keeps blank lines visible and still
    // copies back as a newline.
    if (line === "") el.append(document.createElement("br"));
    else el.textContent = line;
    frag.append(el);
  }
  return frag;
}

/* A Windows path shown in chrome (statusline, tab title, session preview,
   folder picker). Always LTR + isolate + <bdi>. For tool PARAMETERS use
   linesAuto instead — they carry content, not just paths. */
export function pathEl(value) {
  const bdi = document.createElement("bdi");
  bdi.className = "path";
  bdi.textContent = value ?? "";
  return bdi;
}
