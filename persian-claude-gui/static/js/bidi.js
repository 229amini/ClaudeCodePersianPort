/* ============================================================================
   BiDi discipline — claude-persian-rtl-spec.md.

   The whole contract lives in this file:
     - isolateTechnicalTokens() wraps bare paths/URLs/versions/flags in <bdi>
       (spec rule 2)
     - applyDirection() sets dir="auto" on every block-level element
       (spec rule 1)
   Everything that renders model or user text must go through renderMarkdown()
   so both passes run. A leaf module: it imports nothing.
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
const BLOCK_TAGS = "p,li,h1,h2,h3,h4,h5,h6,blockquote,td,th,dd,dt,figcaption";

export function applyDirection(root) {
  for (const el of root.querySelectorAll(BLOCK_TAGS)) {
    el.setAttribute("dir", "auto");
  }
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
  return host;
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
