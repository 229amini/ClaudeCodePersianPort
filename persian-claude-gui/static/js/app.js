/* ============================================================================
   Entry point: SSE transport and init order.

   Module map (was one 1100-line classic script until 2026-08-05):

     api.js       token + fetch helper                       (leaf, no imports)
     bidi.js      the whole BiDi contract, spec rules 1-2    (leaf, no imports)
     render.js    renderEvent: stream events -> DOM
     chrome.js    sidebar, home state, replay, permission dialog
     composer.js  input, ZWNJ, send/stop, attachments, slash
     app.js       this file

   LOAD ORDER. render.js and chrome.js import each other on purpose (the
   renderer drives the sidebar; the sidebar replays through the renderer). That
   cycle is only safe because NO module body does work at evaluation time — the
   side effects live in initChrome() / initComposer(), called from here once
   every module is live, in the same order the single-file version ran them.
   Keep it that way: a `const` read across the cycle during evaluation is a
   temporal-dead-zone crash with a very unhelpful stack.

   strings.fa.js and vendor/marked.min.js stay CLASSIC scripts: they set window
   globals and classic scripts finish before any module runs.
   ========================================================================= */
"use strict";

import { renderMarkdown } from "./bidi.js";
import { renderEvent, setStatus } from "./render.js";
import { initChrome } from "./chrome.js";
import { initComposer } from "./composer.js";
import { token } from "./api.js";

// Reused by history replay and by spec-test.html, so the acceptance tests
// exercise the shipping code path rather than a copy of it.
window.renderEvent = renderEvent;
window.renderMarkdown = renderMarkdown;

initChrome();

/* --- transport ------------------------------------------------------------ */

/* No token means this page is not driving a server. spec-test.html DOES carry
   one (its subresources need the auth cookie) but is a rendering harness, so it
   opts out explicitly: a live stream would render real events into the middle
   of the test log, and the never-ending request also stops a headless
   --dump-dom run from ever settling (run_spec_test.py). */
const wantsTransport = token && !document.body.hasAttribute("data-render-only");
const events = wantsTransport
  ? new EventSource("/api/events?t=" + encodeURIComponent(token))
  : null;
if (events) events.onmessage = (e) => {
  let parsed;
  try {
    parsed = JSON.parse(e.data);
  } catch (err) {
    console.error("bad SSE payload", err, e.data);
    return;
  }
  try {
    renderEvent(parsed);
  } catch (err) {
    console.error("render failed", err, parsed);
  }
};
if (events) events.onerror = () => setStatus({});

initComposer();
