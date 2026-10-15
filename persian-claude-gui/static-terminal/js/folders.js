/* ============================================================================
   Picking a folder on the SERVER, inside the page.

   Under `server.py --serve` the window is on another machine (an SSH tunnel,
   wiki/linux-ssh.md): the tkinter dialog /api/project/pick opens would land on
   a screen nobody is looking at, so the server refuses it and this sheet does
   the job off /api/fs/dirs -- one folder's subfolder names per request. A typed
   path goes anywhere a click cannot (hidden folders are not listed).

   A window-level sheet like the sign-in one (showModal): which folder a
   conversation runs in is not one column's business. Imports only leaves.
   ========================================================================= */
"use strict";

import { api } from "./api.js";
import { pathEl } from "./bidi.js";

const FA = window.STRINGS;
let sheet = null;
let settle = null;        // resolves the pending pickServerFolder() promise
let shown = null;         // the listing on screen: {path, parent, git, dirs, more}

function el(tag, props = {}, ...kids) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids.filter((k) => k != null));
  return node;
}

function button(text, onClick, cls = "") {
  return el("button", { type: "button", className: cls, textContent: text, onclick: onClick });
}

function finish(result) {
  const done = settle;
  settle = null;
  if (sheet?.open) sheet.close();
  done?.(result);
}

function getSheet() {
  if (sheet) return sheet;
  sheet = el("dialog", { id: "folders" });
  sheet.setAttribute("aria-labelledby", "folders-title");
  // Esc, or anything else that closes it, is a cancel.
  sheet.addEventListener("close", () => finish(null));
  document.body.append(sheet);
  return sheet;
}

/* One row per subfolder; a click goes INTO it. The way back up is its own row. */
function row(name, target, cls = "") {
  const b = el("button", { type: "button", className: "folders-row " + cls });
  b.append(typeof name === "string" ? pathEl(name) : name);
  b.addEventListener("click", () => go(target));
  return b;
}

async function go(path) {
  const d = getSheet();
  const field = d.querySelector(".folders-path");
  const err = d.querySelector(".folders-error");
  let got;
  try {
    got = await api("/api/fs/dirs", { path });
  } catch (e) {
    err.textContent = FA.folderBad;
    err.hidden = false;
    field?.select();
    return;
  }
  shown = got;
  err.hidden = true;
  field.value = got.path;
  const join = (name) => got.path.replace(/[\\/]+$/, "") + (got.path.includes("\\") ? "\\" : "/") + name;
  const list = d.querySelector(".folders-list");
  list.replaceChildren(
    ...(got.parent ? [row(el("span", { textContent: FA.folderUp }), got.parent, "up")] : []),
    ...got.dirs.map((name) => row(name, join(name))),
  );
  if (!got.dirs.length) list.append(el("p", { className: "meta", textContent: FA.folderEmpty }));
  if (got.more) list.append(el("p", { className: "meta", textContent: FA.folderMore }));
  list.scrollTop = 0;
}

/* Resolves {path, git} for the folder chosen, or null when cancelled. */
export function pickServerFolder(start = "") {
  if (settle) finish(null);
  const d = getSheet();
  const field = el("input", { type: "text", className: "folders-path", dir: "ltr",
                              spellcheck: false, autocomplete: "off" });
  field.setAttribute("aria-label", FA.folderPathLabel);
  field.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); go(field.value.trim()); }
  });
  d.replaceChildren(
    el("h2", { id: "folders-title", textContent: FA.folderTitle }),
    el("div", { className: "folders-bar" }, field, button(FA.folderGo, () => go(field.value.trim()), "ghost")),
    el("div", { className: "folders-list" }),
    el("p", { className: "folders-error", role: "alert", hidden: true }),
    el("menu", {},
       button(FA.folderCancel, () => finish(null), "ghost"),
       button(FA.folderChoose, () => shown && finish({ path: shown.path, git: !!shown.git }))),
  );
  if (!d.open) d.showModal();
  const promise = new Promise((resolve) => { settle = resolve; });
  go(start);
  field.focus();
  return promise;
}
