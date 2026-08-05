/* ============================================================================
   Token + the one fetch helper.

   A LEAF module: it imports nothing. render.js and chrome.js import each other
   (the renderer drives the sidebar; the sidebar replays through the renderer),
   and keeping the token here is what stops that cycle from ever reaching into a
   half-evaluated module — see the load-order note in app.js.
   ========================================================================= */
"use strict";

/* The window opens at /?t=<token>. spec-test.html is opened without one and
   therefore drives no server: token is null and every caller no-ops. */
export const token = new URLSearchParams(location.search).get("t");

export async function api(path, body) {
  const url = path + (path.includes("?") ? "&" : "?") + "t=" + encodeURIComponent(token);
  const options = body === undefined
    ? {}
    : { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body) };
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(path + " -> " + res.status);
  return res.json();
}
