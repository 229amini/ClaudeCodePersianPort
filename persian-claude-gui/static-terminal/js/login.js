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

   Signing in again ADDS an account (server.py AccountVault): the sheet lists
   the others with a switch each, and render.js asks wallAccounts() for the
   same buttons under a usage wall.

   ONE FILE, BOTH EDITIONS: static/js/login.js and static-terminal/js/login.js
   are byte-identical. It imports only api.js.
   ========================================================================= */
"use strict";

import { api, token, remote } from "./api.js";

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

function mailEl(email) {
  return el("bdi", { className: "path", dir: "ltr", textContent: email ?? "" });
}

/* A sentence with one email in it: the {a} slot becomes an isolated <bdi>. */
export function withMail(template, email) {
  const [before, after = ""] = template.split("{a}");
  const span = document.createElement("span");
  span.append(before, mailEl(email), after);
  return span;
}

/* SEVERAL ACCOUNTS (pcg-6ml, wiki/accounts.md). Every account signed in here
   stays in a vault on this PC; switching swaps only the identity, so skills,
   settings and history are the same under each. The list is the other
   accounts: a switch button each, or a fresh login for one whose refresh
   token ran out, and a remove. */
async function fetchAccounts() {
  try {
    const r = await api("/api/accounts");
    return Array.isArray(r.accounts) ? r : { active: null, accounts: [] };
  } catch (e) {
    return { active: null, accounts: [] };
  }
}

function accountList(listing, err) {
  const others = listing.accounts.filter((a) => !a.active);
  if (!others.length) return [];
  const rows = others.map((a) => {
    const kind = plan({ subscriptionType: a.plan });
    const name = el("span", { className: "account-name" }, mailEl(a.email),
                    el("span", { className: "meta",
                                 textContent: a.expired ? FA.accountExpired : kind }));
    const go = a.expired
      ? button(FA.accountRelogin, () => begin(), "ghost")
      : button(FA.accountSwitch, async () => {
          go.disabled = true;
          showError(err, "");
          try {
            const r = await api("/api/accounts/switch", { email: a.email });
            if (r.status?.loggedIn) return showSignedIn(r.status, { switched: true, deferred: r.deferred });
            showError(err, FA.accountSwitchFailed);
          } catch (e) {
            showError(err, FA.accountSwitchFailed);
          }
          go.disabled = false;
        }, "ghost");
    const drop = button(FA.accountRemove, async () => {
      drop.disabled = true;
      try {
        await api("/api/accounts/remove", { email: a.email });
        row.remove();
      } catch (e) {
        drop.disabled = false;
      }
    }, "ghost");
    drop.setAttribute("aria-label", FA.accountRemove + " " + a.email);
    const row = el("li", { className: "account-row" }, name, go, drop);
    return row;
  });
  return [el("p", { className: "meta", textContent: FA.accountOthers }),
          el("ul", { className: "account-list" }, ...rows)];
}

async function showSignedIn(status, { justNow = false, switched = false, deferred = 0 } = {}) {
  const err = errorLine();
  const listing = await fetchAccounts();
  const notes = [];
  if (switched) notes.push(el("p", { className: "meta", textContent: FA.accountSwitched }));
  if (deferred) notes.push(el("p", { className: "meta", textContent: FA.accountDeferred }));
  paint(justNow ? FA.loginDone : FA.loginTitleIn,
        [...who(status), ...notes, ...accountList(listing, err), err], [
    button(FA.loginClose, () => sheet.close(), "ghost"),
    button(FA.loginSwitch, () => begin(), "ghost"),
    button(FA.logoutButton, async () => {
      try {
        const r = await api("/api/auth/logout", {});
        if (!r.ok) return showError(err, FA.logoutFailed);
        showSignedOut();
      } catch (e) {
        showError(err, FA.logoutFailed);
      }
    }, "danger"),
  ]);
}

/* Nobody signed in. With accounts in the vault that is one click away, so
   the sheet offers them before a fresh login. */
async function showSignedOut() {
  const listing = await fetchAccounts();
  if (!listing.accounts.length) return begin();
  const err = errorLine();
  paint(FA.loginTitle, [el("p", { textContent: FA.accountSignedOut }),
                        ...accountList(listing, err), err], [
    button(FA.loginCancel, () => sheet.close(), "ghost"),
    button(FA.loginSwitch, () => begin()),
  ]);
}

/* THE USAGE WALL (render.js USAGE_WALL): the other accounts, one button each,
   under the wall's own row. A click switches and the server carries this tab
   -- and every other tab waiting at a wall -- on, on that account. No other
   account: one button to add one. Live rows only; a replay has no wall left. */
export async function wallAccounts(row, tab) {
  if (!token) return;
  const listing = await fetchAccounts();
  const usable = listing.accounts.filter((a) => !a.active && !a.expired);
  const strip = el("div", { className: "wall-accounts" });
  if (!usable.length) {
    strip.append(button(FA.accountAddAtWall, () => begin(), "resume-act"));
  }
  for (const a of usable) {
    const b = el("button", { type: "button", className: "resume-act" },
                 withMail(FA.accountContinueOn, a.email));
    b.addEventListener("click", async () => {
      for (const other of strip.querySelectorAll("button")) other.disabled = true;
      try {
        const r = await api("/api/accounts/switch", { email: a.email, resume: tab });
        if (r.active === a.email) return strip.remove();
      } catch (e) {
        // falls through: the buttons come back
      }
      for (const other of strip.querySelectorAll("button")) other.disabled = false;
    });
    strip.append(b);
  }
  row.append(strip);
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
    if (r.ok && r.status?.loggedIn) return showSignedIn(r.status, { justNow: true });
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
        if (r.ok && r.status?.loggedIn) return showSignedIn(r.status, { justNow: true });
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
  /* A remote window (api.js `remote`): the CLI's browser opens on the SERVER,
     and its localhost callback lives there too, so the link and the code are
     the only way in -- the sheet says so instead of "a browser opens". */
  paint(FA.loginTitle, [
    ...(remote ? [el("p", {}, FA.loginStepRemote + " ", link)] : [
      el("p", { textContent: FA.loginStep1 }),
      el("p", { className: "meta", textContent: FA.loginWaiting }),
      el("p", {}, FA.loginStep2 + " ", link),
    ]),
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
    else showSignedOut();
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
    if (status.loggedIn === false) showSignedOut();
  } catch (e) {
    // The check is a courtesy; a failure costs nothing but the prompt.
  }
}
