/* ============================================================================
   Linux servers over SSH, managed from the window (pcg-kwk, server.py
   /api/servers*, servers.py, wiki/linux-ssh.md).

   One sheet: the servers this PC knows, each with its state (open = its
   tunnel is up) and what the server has (filled in a moment later, one key
   login each); open / disconnect / edit / remove. «افزودن سرور» asks for the
   address and the user, then walks the setup: the password ONCE (it installs
   this PC's SSH key and is never kept), then «نصب روی سرور» when the app is
   not there yet, with the installer's own output, then «باز کردن».

   Also the sidebar's two entries, «حساب‌ها» (login.js) and «سرورها». A window
   that is itself at the end of a tunnel (api.js `remote`) has no servers
   entry: there is nothing to open a tunnel from.

   ONE FILE, BOTH EDITIONS: static/js/servers.js and static-terminal/js/
   servers.js are byte-identical. It imports only api.js and login.js.
   ========================================================================= */
"use strict";

import { api, token, remote } from "./api.js";
import { openLogin } from "./login.js";

const FA = window.STRINGS;
let sheet = null;
let view = 0;              // bumped per painted view, so a late reply stands down
const POLL_MS = 1500;

function el(tag, props = {}, ...kids) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids.filter((k) => k != null));
  return node;
}

function button(text, onClick, cls = "") {
  return el("button", { type: "button", className: cls, textContent: text, onclick: onClick });
}

/* An address or a user name is LTR inside a Persian line: isolated. */
function ltr(text, cls = "path") {
  return el("bdi", { className: cls, dir: "ltr", textContent: text ?? "" });
}

function getSheet() {
  if (sheet) return sheet;
  sheet = el("dialog", { id: "servers" });
  sheet.setAttribute("aria-labelledby", "servers-title");
  sheet.addEventListener("close", () => { view++; });
  document.body.append(sheet);
  return sheet;
}

function paint(title, body, buttons) {
  const d = getSheet();
  const mine = ++view;
  d.replaceChildren(
    el("h2", { id: "servers-title", textContent: title }),
    el("div", { className: "servers-body" }, ...body),
    el("menu", {}, ...buttons),
  );
  if (!d.open) d.showModal();
  return mine;
}

function errorLine(text = "") {
  return el("p", { className: "login-error", role: "alert", hidden: !text, textContent: text });
}

function say(line, text) {
  line.textContent = text;
  line.hidden = !text;
}

/* servers.py classify() -> one Persian sentence. */
function why(code, detail) {
  const text = FA.srvErrors?.[code] ?? FA.srvErrors?.other ?? code;
  return detail && code === "other" ? text + " " + detail : text;
}

/* --- the list ------------------------------------------------------------- */

export async function openServers() {
  if (!token || remote) return true;
  paint(FA.srvTitle, [el("p", { className: "meta", textContent: FA.loginChecking })],
        [button(FA.loginClose, () => sheet.close(), "ghost")]);
  let data;
  try {
    data = await api("/api/servers");
  } catch (e) {
    data = { servers: [], ssh: true };
  }
  showList(data);
  return true;
}

function showList(data) {
  const err = errorLine(data.ssh === false ? FA.srvNoSsh : "");
  const rows = (data.servers ?? []).map((s) => serverRow(s, data.version, err));
  const body = [el("p", { className: "meta", textContent: FA.srvIntro })];
  body.push(rows.length ? el("ul", { className: "server-list" }, ...rows)
                        : el("p", { textContent: FA.srvEmpty }));
  body.push(err);
  const mine = paint(FA.srvTitle, body, [
    button(FA.loginClose, () => sheet.close(), "ghost"),
    button(FA.srvAdd, () => showForm(null), ""),
  ]);
  // What each server has, a moment later: one key login per row.
  for (const row of rows) row.check?.(mine);
}

function serverRow(s, localVersion, err) {
  const state = el("span", { className: "server-state" + (s.open ? " on" : ""),
                             textContent: s.open ? FA.srvOpen : FA.srvClosed });
  const facts = el("span", { className: "meta server-facts", textContent: FA.srvChecking });
  const name = el("span", { className: "server-name" },
                  el("strong", { textContent: s.name }),
                  el("span", { className: "server-addr" }, ltr(s.target), " ", state),
                  facts);
  const acts = el("span", { className: "server-acts" });
  const openBtn = button(FA.srvOpenBtn, async () => {
    openBtn.disabled = true;
    say(err, "");
    openBtn.textContent = FA.srvOpening;
    let r;
    try {
      r = await api("/api/servers/open", { target: s.target });
    } catch (e) {
      r = { ok: false, error: "other" };
    }
    openBtn.disabled = false;
    openBtn.textContent = FA.srvOpenBtn;
    if (!r.ok) return say(err, why(r.error));
    state.textContent = FA.srvOpen;
    state.classList.add("on");
    closeBtn.hidden = false;
  }, "");
  const closeBtn = button(FA.srvCloseBtn, async () => {
    closeBtn.disabled = true;
    try {
      await api("/api/servers/close", { target: s.target });
      state.textContent = FA.srvClosed;
      state.classList.remove("on");
      closeBtn.hidden = true;
    } catch (e) {
      // the row stays as it was
    }
    closeBtn.disabled = false;
  }, "ghost");
  closeBtn.hidden = !s.open;
  const edit = button(FA.srvEdit, () => showForm(s), "ghost");
  const drop = button(FA.srvRemove, async () => {
    if (!drop.dataset.armed) {          // one click arms, the second removes
      drop.dataset.armed = "1";
      drop.textContent = FA.srvRemoveSure;
      return;
    }
    drop.disabled = true;
    try {
      showList({ ...(await api("/api/servers/remove", { target: s.target })), version: localVersion });
    } catch (e) {
      drop.disabled = false;
    }
  }, "ghost");
  for (const b of [edit, drop, closeBtn]) b.setAttribute("aria-label", b.textContent + " " + s.name);
  acts.append(openBtn, closeBtn, edit, drop);
  const row = el("li", { className: "server-row" }, name, acts);

  /* The server's own facts: installed? which version? reachable? */
  row.check = async (mine) => {
    let r;
    try {
      r = await api("/api/servers/check", { target: s.target });
    } catch (e) {
      r = { ok: false, error: "other" };
    }
    if (mine !== view) return;
    facts.replaceChildren();
    if (!r.ok) {
      facts.textContent = why(r.error);
      if (r.error === "auth") facts.append(" ", button(FA.srvFixKey, () => showPassword(s), "link"));
      if (r.error === "hostkey") facts.append(" ", button(FA.srvHostKey, () => acceptHostKey(s), "link"));
      return;
    }
    if (!r.installed) {
      facts.textContent = FA.srvNotInstalled + " ";
      facts.append(button(FA.srvInstall, () => showInstall(s), "link"));
      openBtn.disabled = true;
      return;
    }
    facts.textContent = FA.srvVersion.replace("{v}", r.version);
    if (r.version !== localVersion) {
      facts.append(" · ", button(FA.srvUpdate.replace("{v}", localVersion), () => showInstall(s, true), "link"));
    }
  };
  return row;
}

async function acceptHostKey(s) {
  try {
    await api("/api/servers/hostkey", { target: s.target });
  } catch (e) {
    // the check below says what is still wrong
  }
  afterSave(s.target, s.name);
}

/* --- add / edit ------------------------------------------------------------ */

function field(label, input) {
  return el("label", { className: "server-field" }, el("span", { textContent: label }), input);
}

function input(value, { dir = "ltr", placeholder = "", type = "text" } = {}) {
  const node = el("input", { type, value: value ?? "", dir, placeholder, spellcheck: false,
                             autocomplete: "off", className: "login-code" });
  return node;
}

function showForm(s) {
  const name = input(s?.name && s.name !== s.host ? s.name : "", { dir: "auto", placeholder: FA.srvNameHint });
  const host = input(s?.host, { placeholder: "192.168.1.20" });
  const user = input(s?.user, { placeholder: "ubuntu" });
  const port = input(String(s?.ssh_port ?? 22), { type: "number" });
  port.min = 1;
  port.max = 65535;
  const err = errorLine();
  const save = async () => {
    if (!host.value.trim() || !user.value.trim()) {
      say(err, FA.srvNeedAddr);
      return (host.value.trim() ? user : host).focus();
    }
    say(err, "");
    let r;
    try {
      r = await api("/api/servers/save", { host: host.value.trim(), user: user.value.trim(),
                                           ssh_port: Number(port.value) || 22, name: name.value,
                                           was: s?.target ?? null });
    } catch (e) {
      return say(err, FA.srvBadAddr);
    }
    afterSave(r.target, name.value.trim() || host.value.trim());
  };
  for (const node of [name, host, user, port]) {
    node.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); save(); }
    });
  }
  paint(s ? FA.srvEditTitle : FA.srvAddTitle, [
    el("p", { className: "meta", textContent: FA.srvAddIntro }),
    field(FA.srvHost, host), field(FA.srvUser, user), field(FA.srvPort, port),
    field(FA.srvName, name), err,
  ], [
    button(FA.loginCancel, () => openServers(), "ghost"),
    button(FA.srvSave, save),
  ]);
  (s ? name : host).focus();
}

/* After a save: does a key login work, and is the app there? Each answer
   leads to the one next step. */
async function afterSave(target, label) {
  const s = { target, name: label };
  const mine = paint(FA.srvSetupTitle.replace("{n}", label),
                     [el("p", { className: "meta", textContent: FA.srvChecking })],
                     [button(FA.loginCancel, () => openServers(), "ghost")]);
  let r;
  try {
    r = await api("/api/servers/check", { target });
  } catch (e) {
    r = { ok: false, error: "other" };
  }
  if (mine !== view) return;
  if (!r.ok && r.error === "auth") return showPassword(s);
  if (!r.ok && r.error === "hostkey") {
    return paint(FA.srvSetupTitle.replace("{n}", label), [el("p", { textContent: why("hostkey") })], [
      button(FA.loginCancel, () => openServers(), "ghost"),
      button(FA.srvHostKey, () => acceptHostKey(s)),
    ]);
  }
  if (!r.ok) {
    return paint(FA.srvSetupTitle.replace("{n}", label), [errorLine(why(r.error, r.detail?.[0]))], [
      button(FA.loginCancel, () => openServers(), "ghost"),
      button(FA.srvRetry, () => afterSave(target, label)),
    ]);
  }
  if (!r.installed) return showInstall(s, false, r);
  return showReady(s, r);
}

function showPassword(s) {
  const user = s.target.split("@")[0];
  const pw = input("", { type: "password" });
  pw.setAttribute("aria-label", FA.srvPassword);
  const err = errorLine();
  const go = button(FA.srvContinue, async () => {
    if (!pw.value) return pw.focus();
    go.disabled = pw.disabled = true;
    go.textContent = FA.loginChecking;
    say(err, "");
    let r;
    try {
      r = await api("/api/servers/check", { target: s.target, password: pw.value });
    } catch (e) {
      r = { ok: false, error: "other" };
    }
    pw.value = "";
    go.disabled = pw.disabled = false;
    go.textContent = FA.srvContinue;
    if (!r.ok) {
      say(err, why(r.error));
      return pw.focus();
    }
    if (!r.installed) return showInstall(s, false, r);
    showReady(s, r);
  });
  pw.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); go.click(); }
  });
  paint(FA.srvSetupTitle.replace("{n}", s.name), [
    el("p", {}, FA.srvPasswordWhy.split("{u}")[0], ltr(user), FA.srvPasswordWhy.split("{u}")[1] ?? ""),
    el("div", { className: "login-row" }, pw, go),
    el("p", { className: "meta", textContent: FA.srvPasswordKept }),
    err,
  ], [button(FA.loginCancel, () => openServers(), "ghost")]);
  pw.focus();
}

/* Not installed (or an older version): what it needs, then the installer's
   own output while it runs. */
function showInstall(s, update = false, facts = null) {
  const notes = [];
  if (facts && facts.python_ok === false) notes.push(errorLine(FA.srvNeedPython));
  if (facts && !facts.claude) notes.push(el("p", { className: "meta", textContent: FA.srvClaudeToo }));
  const run = async () => {
    const log = el("pre", { className: "server-log", dir: "ltr" });
    const mine = paint(FA.srvInstalling.replace("{n}", s.name),
                       [el("p", { className: "meta", textContent: FA.srvInstallWait }), log],
                       [button(FA.loginClose, () => sheet.close(), "ghost")]);
    try {
      await api("/api/servers/install", { target: s.target });
    } catch (e) {
      // the poll below reports what happened
    }
    const poll = async () => {
      if (mine !== view) return;
      let r = null;
      try {
        r = await api("/api/servers/install/state", { target: s.target });
      } catch (e) {
        // a missed beat
      }
      if (mine !== view) return;
      if (r) {
        log.textContent = (r.lines ?? []).join("\n");
        log.scrollTop = log.scrollHeight;
      }
      if (!r || r.running) return setTimeout(poll, POLL_MS);
      if (r.rc === 0) return afterSave(s.target, s.name);
      paint(FA.srvInstalling.replace("{n}", s.name),
            [errorLine(FA.srvInstallFailed), log], [
              button(FA.loginCancel, () => openServers(), "ghost"),
              button(FA.srvRetry, run),
            ]);
    };
    setTimeout(poll, POLL_MS);
  };
  paint(FA.srvSetupTitle.replace("{n}", s.name), [
    el("p", { textContent: update ? FA.srvUpdateWhy : FA.srvInstallWhy }),
    ...notes,
  ], [
    button(FA.loginCancel, () => openServers(), "ghost"),
    button(update ? FA.srvUpdateBtn : FA.srvInstall, run),
  ]);
}

function showReady(s, facts) {
  const err = errorLine();
  const open = button(FA.srvOpenBtn, async () => {
    open.disabled = true;
    let r;
    try {
      r = await api("/api/servers/open", { target: s.target });
    } catch (e) {
      r = { ok: false, error: "other" };
    }
    open.disabled = false;
    if (!r.ok) return say(err, why(r.error));
    openServers();
  });
  paint(FA.srvReadyTitle.replace("{n}", s.name), [
    el("p", { textContent: FA.srvReady.replace("{v}", facts.version ?? "") }),
    el("p", { className: "meta", textContent: FA.srvReadyLogin }),
    err,
  ], [
    button(FA.srvBack, () => openServers(), "ghost"),
    open,
  ]);
  open.focus();
}

/* --- the sidebar's two entries ---------------------------------------------- */

export function initSideFoot() {
  const accounts = document.getElementById("btn-accounts");
  const srv = document.getElementById("btn-servers");
  if (accounts) {
    document.getElementById("btn-accounts-label").textContent = FA.sideAccounts;
    accounts.title = FA.sideAccounts;
    accounts.hidden = !token;
    accounts.addEventListener("click", () => openLogin());
  }
  if (srv) {
    document.getElementById("btn-servers-label").textContent = FA.sideServers;
    srv.title = FA.sideServers;
    srv.hidden = !token || remote;
    srv.addEventListener("click", () => openServers());
  }
}
