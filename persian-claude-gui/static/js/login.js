/* ============================================================================
   Signing in without a terminal.

   `/login` typed into a -p session answers "isn't available in this
   environment". The server runs `claude auth login` instead (LoginFlow,
   wiki/cli-login.md): the CLI opens the browser and prints the same link,
   Anthropic's page shows a code, the person pastes it here, and the server
   writes it to the CLI's stdin. A login that took respawns every idle tab on
   its own conversation, so nothing is lost.

   Opened by `/login`, `/logout`, and on its own at start-up when the CLI says
   nobody is signed in. A window-level sheet like the keys sheet (showModal):
   an account is the machine's, not one conversation's.

   ONE FILE, BOTH EDITIONS: static/js/login.js and static-terminal/js/login.js
   are byte-identical. It imports only api.js.
   ========================================================================= */
"use strict";

import { api, token } from "./api.js";

const FA = window.STRINGS;
let sheet = null;
let flowOpen = false;     // a `claude auth login` is waiting for its code
let attempt = 0;          // bumped per link, so a stale poll or reply stands down
const POLL_MS = 1500;

function el(tag, props = {}, ...kids) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids.filter((k) => k != null));
  return node;
}

function getSheet() {
  if (sheet) return sheet;
  sheet = el("dialog", { id: "login" });
  sheet.setAttribute("aria-labelledby", "login-title");
  sheet.addEventListener("close", () => {
    if (flowOpen) api("/api/auth/cancel", {}).catch(() => {});
    flowOpen = false;
  });
  document.body.append(sheet);
  return sheet;
}

function plan(status) {
  const name = (FA.loginPlans ?? {})[status.subscriptionType];
  return name ?? status.subscriptionType ?? "";
}

/* One frame of the sheet: a title, the body nodes, the footer buttons. */
function paint(title, body, buttons) {
  const d = getSheet();
  d.replaceChildren(
    el("h2", { id: "login-title", textContent: title }),
    el("div", { className: "login-body" }, ...body),
    el("menu", {}, ...buttons),
  );
  if (!d.open) d.showModal();
  return d;
}

function button(text, onClick, cls = "") {
  return el("button", { type: "button", className: cls, textContent: text, onclick: onClick });
}

function errorLine() {
  return el("p", { className: "login-error", role: "alert", hidden: true });
}

function showError(line, text) {
  line.textContent = text;
  line.hidden = !text;
}

/* An email is LTR inside a Persian sentence: isolated, never reordered. */
function who(status) {
  const mail = el("bdi", { className: "path", dir: "ltr", textContent: status.email ?? "" });
  const p = el("p", {}, FA.loginAs + " ", mail);
  const kind = plan(status);
  return kind ? [p, el("p", { className: "meta", textContent: FA.loginPlan.replace("{p}", kind) })] : [p];
}

function showSignedIn(status, justNow = false) {
  const err = errorLine();
  paint(justNow ? FA.loginDone : FA.loginTitleIn, [...who(status), err], [
    button(FA.loginClose, () => sheet.close(), "ghost"),
    button(FA.loginSwitch, () => begin(), "ghost"),
    button(FA.logoutButton, async () => {
      try {
        const r = await api("/api/auth/logout", {});
        if (!r.ok) return showError(err, FA.logoutFailed);
        begin();
      } catch (e) {
        showError(err, FA.logoutFailed);
      }
    }, "danger"),
  ]);
}

/* `why`: the line a retry opens with — the last code's verdict. */
async function begin(why = "") {
  const err = errorLine();
  paint(FA.loginTitle, [el("p", { textContent: FA.loginStarting }), err],
        [button(FA.loginCancel, () => sheet.close(), "ghost")]);
  let reply;
  try {
    reply = await api("/api/auth/login", {});
  } catch (e) {
    showError(err, FA.loginNoLink);
    return;
  }
  if (!sheet.open) {      // cancelled while the link was on its way
    api("/api/auth/cancel", {}).catch(() => {});
    return;
  }
  flowOpen = true;
  const mine = ++attempt;
  let sending = false;
  const link = el("a", { href: reply.url, target: "_blank", rel: "noopener",
                         textContent: FA.loginOpenPage });
  const input = el("input", { type: "text", className: "login-code", dir: "ltr",
                              spellcheck: false, autocomplete: "off",
                              placeholder: FA.loginCodeHint });
  input.setAttribute("aria-label", FA.loginCodeHint);
  const submit = button(FA.loginSubmit, () => send());
  const send = async () => {
    const code = input.value.trim();
    if (!code) return input.focus();
    sending = true;
    submit.disabled = input.disabled = true;
    submit.textContent = FA.loginChecking;
    showError(err, "");
    let r;
    try {
      r = await api("/api/auth/code", { code });
    } catch (e) {
      r = { ok: false };
    }
    if (attempt !== mine) return;     // the browser finished it first
    flowOpen = false;
    if (r.ok && r.status?.loggedIn) return showSignedIn(r.status, true);
    // The CLI's one try is spent: a wrong code needs a fresh link.
    begin(FA.loginBadCode);
  };
  /* Approving in the browser the CLI opened needs no code: its localhost
     callback ends the process, and this is how the sheet finds out. */
  const poll = async () => {
    if (attempt !== mine || !sheet.open || !flowOpen) return;
    if (!sending) {
      let r = null;
      try {
        r = await api("/api/auth/flow", {});
      } catch (e) {
        // A missed beat; the next one asks again.
      }
      if (attempt !== mine || !flowOpen) return;
      if (r?.state === "done") {
        attempt++;
        flowOpen = false;
        if (r.ok && r.status?.loggedIn) return showSignedIn(r.status, true);
        return begin(FA.loginFailed);
      }
      if (r?.state === "idle") return;
    }
    setTimeout(poll, POLL_MS);
  };
  setTimeout(poll, POLL_MS);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); send(); }
  });
  paint(FA.loginTitle, [
    el("p", { textContent: FA.loginStep1 }),
    el("p", { className: "meta", textContent: FA.loginWaiting }),
    el("p", {}, FA.loginStep2 + " ", link),
    el("p", { textContent: FA.loginStep3 }),
    el("div", { className: "login-row" }, input, submit),
    err,
  ], [button(FA.loginCancel, () => sheet.close(), "ghost")]);
  showError(err, why);
  input.focus();
}

/* `/login`: who is signed in, or the way in. `/logout` lands on the same
   sheet, where leaving is one deliberate click rather than a typed verb. */
export async function openLogin() {
  if (!token) return true;
  paint(FA.loginTitleIn, [el("p", { className: "meta", textContent: FA.loginChecking })],
        [button(FA.loginClose, () => sheet.close(), "ghost")]);
  try {
    const status = await api("/api/auth");
    if (status.loggedIn) showSignedIn(status);
    else begin();
  } catch (e) {
    begin();
  }
  return true;
}

/* At start-up: nobody signed in means every message would come back as
   "Not logged in", so the sheet opens before the first one is typed. */
export async function initLogin() {
  if (!token) return;
  try {
    const status = await api("/api/auth");
    if (status.loggedIn === false) begin();
  } catch (e) {
    // The check is a courtesy; a failure costs nothing but the prompt.
  }
}
