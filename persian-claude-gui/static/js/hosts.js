/* ============================================================================
   Servers as tabs in THIS window (wiki/linux-ssh.md §"Tabs").

   A strip along the top, the way Notepad and VS Code hold several files:
   «این رایانه» (this window's own app) and one tab per open server. A server's
   tab is its own app, served through its SSH tunnel, in an iframe — the
   server needs nothing new, and nothing is rebuilt here. Switching hides a
   tab, never unloads it: a conversation running on a server keeps running
   and coming back to it is instant. The strip is drawn only while a server
   tab is open; with none, the window is exactly what it was.

   Each tab's dot says what its server is doing without a visit: working, has
   news (a turn ended or asks for permission while the tab was not in front),
   or cut off. A dropped tunnel is noticed by the poll below and reopened
   with a back-off; the page inside reconnects its own event stream.

   The page inside talks to this one with postMessage, both ends pinned to
   127.0.0.1 origins: `hello` once loaded, `busy`, `news` (render.js
   flashTaskbar, which inside a tab asks the window holding it to flash
   instead — the server's own /api/attention has no screen), and `key` for
   Ctrl+PageUp/PageDown, which the frame would otherwise swallow. A server on
   an older version sends none of them and still works; its tab just has no
   dot.

   Open tabs are kept beside tunnels.json (servers.py, /api/servers/tabs),
   not in web storage: this window's port, and with it the origin, changes
   every run.

   ONE FILE, BOTH EDITIONS: static/js/hosts.js and static-terminal/js/
   hosts.js are byte-identical. It imports only api.js.
   ========================================================================= */
"use strict";

import { api, token, remote } from "./api.js";

const FA = window.STRINGS;
const POLL_MS = 5000;
const BUSY_MS = 1000;
const RETRY_MS = [5000, 10000, 20000, 40000, 60000];
const TRANSIENT = new Set(["unreachable", "penalty", "tunnel", "other"]);
const LOCAL_ORIGIN = /^http:\/\/127\.0\.0\.1:\d+$/;

export const embedded = (() => {
  try {
    return window.top !== window;
  } catch (e) {
    return true;
  }
})();

/* --- inside a tab: the page talks to the window that holds it --------------- */

function hostOrigin() {
  const origin = location.ancestorOrigins?.[0] ?? "";
  return LOCAL_ORIGIN.test(origin) ? origin : null;
}

/* True when this page is inside a tab (and the message, if any, went). */
export function tellHost(kind, extra = {}) {
  if (!embedded) return false;
  const origin = hostOrigin();
  if (origin) window.parent.postMessage({ pcg: kind, ...extra }, origin);
  return true;
}

function initEmbedded() {
  tellHost("hello");
  let busy = false;
  setInterval(() => {
    const now = !!document.querySelector(".busy");
    if (now !== busy) tellHost("busy", { busy: (busy = now) });
  }, BUSY_MS);
  document.addEventListener("keydown", (e) => {
    const dir = cycleKey(e);
    if (!dir) return;
    e.preventDefault();
    e.stopPropagation();
    tellHost("key", { dir });
  }, true);
}

function cycleKey(e) {
  if (!e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return 0;
  if (e.key === "PageDown") return 1;
  if (e.key === "PageUp") return -1;
  return 0;
}

/* --- the window that holds them --------------------------------------------- */

const tabs = [];           // {target, name, port, origin, url, ...}
let active = null;         // a target, or null for this window's own app
let strip = null;
let frames = null;
let localTab = null;
let pollTimer = 0;

function el(tag, props = {}, ...kids) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids.filter((k) => k != null));
  return node;
}

function why(code) {
  return FA.srvErrors?.[code] ?? FA.srvErrors?.other ?? code;
}

function find(target) {
  return tabs.find((t) => t.target === target) ?? null;
}

function build() {
  if (strip) return;
  strip = el("nav", { id: "hosts", className: "hosts", dir: "rtl" });
  strip.setAttribute("aria-label", FA.hostsLabel);
  localTab = el("button", { type: "button", className: "host-tab on", textContent: FA.hostsLocal });
  localTab.setAttribute("aria-current", "true");
  localTab.addEventListener("click", () => activate(null));
  strip.append(el("span", { className: "host-wrap on" }, localTab));
  frames = el("div", { id: "host-frames", hidden: true });
  document.body.prepend(strip);
  document.body.append(frames);
}

function save() {
  api("/api/servers/tabs", { tabs: tabs.map((t) => t.target), active }).catch(() => {});
}

function show() {
  const any = tabs.length > 0;
  strip.hidden = !any;
  document.body.classList.toggle("hosted", any);
  if (any && !pollTimer) pollTimer = setInterval(poll, POLL_MS);
  if (!any && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = 0;
  }
}

function paintTab(t) {
  t.dot.className = "host-dot" + (t.offline ? " offline" : t.news ? " news" : t.busy ? " busy" : "");
  t.dot.title = t.offline ? FA.hostsOfflineDot : t.news ? FA.hostsNews : t.busy ? FA.hostsBusy : "";
  t.label.textContent = t.name;
  t.button.title = t.target;
}

function note(t, text, retry = false) {
  t.note.replaceChildren();
  t.note.hidden = !text;
  if (!text) return;
  t.note.append(el("p", { textContent: text }));
  if (retry) {
    t.note.append(el("button", { type: "button", textContent: FA.srvRetry,
                                 onclick: () => connect(t, true) }));
  }
}

export function openInTab(s, { focus = true } = {}) {
  if (!token || remote || embedded) return false;
  build();
  let t = find(s.target);
  if (!t) {
    t = { target: s.target, name: s.name || s.target, busy: false, news: false,
          offline: false, hello: false, connecting: false, tries: 0, retryAt: 0,
          frame: null, url: "", origin: "" };
    t.dot = el("span", { className: "host-dot" });
    t.label = el("bdi", { className: "host-name", dir: "auto" });
    t.button = el("button", { type: "button", className: "host-tab" }, t.dot, t.label);
    t.button.addEventListener("click", () => activate(t.target));
    t.button.addEventListener("auxclick", (e) => { if (e.button === 1) closeTab(t.target); });
    const pop = el("button", { type: "button", className: "host-x host-pop", textContent: "⧉" });
    pop.title = FA.hostsPopOut.replace("{n}", t.name);
    pop.setAttribute("aria-label", pop.title);
    pop.addEventListener("click", () => popOut(t));
    const x = el("button", { type: "button", className: "host-x", textContent: "×" });
    x.title = FA.hostsClose.replace("{n}", t.name);
    x.setAttribute("aria-label", x.title);
    x.addEventListener("click", () => closeTab(t.target));
    t.wrap = el("span", { className: "host-wrap" }, t.button, pop, x);
    t.note = el("div", { className: "host-note", dir: "rtl", role: "status" });
    t.pane = el("div", { className: "host-pane", hidden: true }, t.note);
    strip.append(t.wrap);
    frames.append(t.pane);
    tabs.push(t);
    paintTab(t);
    connect(t);
  }
  show();
  if (focus) activate(t.target);
  else save();
  return true;
}

async function connect(t, now = false) {
  if (t.connecting) return;
  t.connecting = true;
  if (now) t.tries = 0;
  if (!t.frame || t.offline) {
    note(t, (t.offline ? FA.hostsOffline : FA.hostsConnecting).replace("{n}", t.name));
  }
  let r;
  try {
    r = await api("/api/servers/open", { target: t.target, inline: true });
  } catch (e) {
    r = { ok: false, error: "other" };
  }
  t.connecting = false;
  if (!find(t.target)) return;             // closed while it was connecting
  if (!r.ok) {
    t.offline = true;
    paintTab(t);
    const again = TRANSIENT.has(r.error);
    note(t, FA.hostsFailed.replace("{n}", t.name).replace("{why}", why(r.error)), true);
    t.retryAt = again ? Date.now() + RETRY_MS[Math.min(t.tries++, RETRY_MS.length - 1)] : Infinity;
    return;
  }
  t.tries = 0;
  t.offline = false;
  t.url = r.url;
  t.origin = "http://127.0.0.1:" + r.port;
  paintTab(t);
  if (!t.frame) {
    t.frame = el("iframe", { title: t.name, src: r.url });
    t.frame.addEventListener("load", () => { if (!t.offline) note(t, ""); });
    t.pane.prepend(t.frame);
  } else if (!t.hello) {
    t.frame.src = r.url;                   // it never loaded: load it now
  } else {
    note(t, "");                           // the page reconnects its own stream
  }
}

function activate(target) {
  const t = target ? find(target) : null;
  active = t ? t.target : null;
  localTab.classList.toggle("on", !t);
  localTab.parentElement.classList.toggle("on", !t);
  if (t) localTab.removeAttribute("aria-current");
  else localTab.setAttribute("aria-current", "true");
  for (const other of tabs) {
    const on = other === t;
    other.wrap.classList.toggle("on", on);
    other.pane.hidden = !on;
    if (on) other.button.setAttribute("aria-current", "true");
    else other.button.removeAttribute("aria-current");
  }
  frames.hidden = !t;
  if (t) {
    t.news = false;
    paintTab(t);
    if (t.offline && !t.connecting && t.retryAt !== Infinity) connect(t, true);
    t.frame?.focus();
  }
  save();
}

function closeTab(target) {
  const at = tabs.findIndex((t) => t.target === target);
  if (at < 0) return;
  const [t] = tabs.splice(at, 1);
  t.wrap.remove();
  t.pane.remove();                          // the tunnel stays, as it always has
  if (active === target) activate(tabs[Math.min(at, tabs.length - 1)]?.target ?? null);
  else save();
  show();
}

async function popOut(t) {
  let r;
  try {
    r = await api("/api/servers/open", { target: t.target });
  } catch (e) {
    r = { ok: false, error: "other" };
  }
  if (r.ok) closeTab(t.target);
  else note(t, FA.hostsFailed.replace("{n}", t.name).replace("{why}", why(r.error)), true);
}

function cycle(dir) {
  const order = [null, ...tabs.map((t) => t.target)];
  const at = order.indexOf(active);
  activate(order[(at + dir + order.length) % order.length]);
}

async function poll() {
  let data;
  try {
    data = await api("/api/servers");
  } catch (e) {
    return;
  }
  const rows = new Map((data.servers ?? []).map((s) => [s.target, s]));
  for (const t of [...tabs]) {
    const row = rows.get(t.target);
    if (!row) {                            // removed from the list: its tab goes
      closeTab(t.target);
      continue;
    }
    if (row.name && row.name !== t.name) {
      t.name = row.name;
      paintTab(t);
    }
    if (row.open || t.connecting) continue;
    if (!t.offline) {
      t.offline = true;
      t.retryAt = Date.now();
      paintTab(t);
    }
    if (Date.now() >= t.retryAt) connect(t);
  }
}

function onMessage(e) {
  const t = tabs.find((x) => x.frame && e.source === x.frame.contentWindow);
  if (!t || e.origin !== t.origin || typeof e.data?.pcg !== "string") return;
  const away = document.hidden || !document.hasFocus();
  switch (e.data.pcg) {
    case "hello":
      t.hello = true;
      if (!t.offline) note(t, "");
      break;
    case "busy":
      t.busy = !!e.data.busy;
      paintTab(t);
      break;
    case "news":
      if (active !== t.target || away) {
        t.news = active !== t.target;
        paintTab(t);
      }
      if (away) api("/api/attention", { title: document.title }).catch(() => {});
      break;
    case "key":
      if (e.data.dir === 1 || e.data.dir === -1) cycle(e.data.dir);
      break;
  }
}

export async function initHosts() {
  if (embedded) {
    initEmbedded();
    return;
  }
  if (!token || remote) return;
  window.addEventListener("message", onMessage);
  document.addEventListener("keydown", (e) => {
    const dir = cycleKey(e);
    if (!dir || !tabs.length) return;
    e.preventDefault();
    cycle(dir);
  }, true);
  let data;
  try {
    data = await api("/api/servers");
  } catch (e) {
    return;                                // no servers here (409): no strip
  }
  const saved = data.tabs ?? {};
  const rows = new Map((data.servers ?? []).map((s) => [s.target, s]));
  for (const target of saved.tabs ?? []) {
    const row = rows.get(target);
    if (row) openInTab(row, { focus: false });
  }
  if (saved.active && find(saved.active)) activate(saved.active);
}
