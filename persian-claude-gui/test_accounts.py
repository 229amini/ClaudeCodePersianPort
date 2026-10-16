"""
test_accounts.py - several Claude accounts on one config dir (pcg-6ml, wiki/accounts.md).

Two halves, both against a throwaway CLAUDE_CONFIG_DIR holding FAKE tokens, so
the machine's own login is never read or written (asserted at the end):

1. AccountVault and the JSON surgery, in-process: capture, switch, a rotated
   refresh token surviving a switch, mcpOAuth and duplicate keys in
   .claude.json left byte-for-byte alone, an expired account refused.
2. The routes, against the real server and the real CLI: GET /api/accounts
   enrols the account already signed in, a switch writes the other one and
   `claude auth status` reads it back, the open tab survives its respawn, the
   active account cannot be removed, an unknown one cannot be switched to.

Free: nothing here sends a message, so the fake tokens are never shown to
Anthropic.
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

REAL_DIR = Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude")
# Not ~/.claude.json: every running Claude Code (this one included) writes it.
REAL_FILES = [REAL_DIR / ".credentials.json", REAL_DIR / ".persian-claude-accounts.json"]

FUTURE_MS = int((time.time() + 30 * 86400) * 1000)
PAST_MS = int((time.time() - 86400) * 1000)


def oauth(tag: str, refresh_until: int = FUTURE_MS) -> dict:
    return {"accessToken": f"sk-ant-oat01-fake-{tag}", "refreshToken": f"sk-ant-ort01-fake-{tag}",
            "expiresAt": FUTURE_MS, "refreshTokenExpiresAt": refresh_until,
            "scopes": ["user:inference", "user:profile"], "subscriptionType": "max",
            "rateLimitTier": "default_claude_max_5x"}


def account(email: str) -> dict:
    return {"accountUuid": f"uuid-{email}", "emailAddress": email,
            "organizationUuid": f"org-{email}", "organizationName": f"{email}'s Organization",
            "displayName": email.split("@")[0]}


MCP = {"higgsfield|abc": {"accessToken": "mcp-token", "expiresAt": FUTURE_MS}}

# A .claude.json the way the real one looks where it matters: other keys
# around oauthAccount, Persian in a value, and the two duplicate project keys
# Windows paths produce (a dict would fold them into one).
CONFIG = """{
  "numStartups": 12,
  "userID": "u-1",
  "projects": {
    "C:/WINDOWS/system32": {"allowedTools": []},
    "C:/Windows/System32": {"allowedTools": ["Read"]}
  },
  "oauthAccount": %s,
  "tipsHistory": {"x": 1.50},
  "note": "سلام"
}
"""


def write_login(cfg: Path, tag: str, email: str) -> None:
    """What `claude auth login` leaves on disk for EMAIL."""
    creds_path = cfg / ".credentials.json"
    creds = json.loads(creds_path.read_text(encoding="utf-8")) if creds_path.exists() else {}
    creds["claudeAiOauth"] = oauth(tag)
    creds["mcpOAuth"] = MCP
    creds_path.write_text(json.dumps(creds), encoding="utf-8")
    config = cfg / ".claude.json"
    if config.exists():
        import server
        text = server.replace_top_level(config.read_text(encoding="utf-8"),
                                        "oauthAccount", account(email))
    else:
        text = CONFIG % json.dumps(account(email), indent=2).replace("\n", "\n  ")
    config.write_text(text, encoding="utf-8")


def outside_oauth(text: str) -> str:
    """The config text with the oauthAccount value cut out."""
    import server
    span = server._top_level_span(text, "oauthAccount")
    return text[:span[0]] + text[span[1]:] if span else text


# --- 3. the window: the sheet and the wall, every route stubbed in the page --

PROBE_JS = r"""
<pre id="probe-out" hidden></pre>
<script type="module">
import { openLogin } from "/static/js/login.js";
import { bulkAppend } from "/static/js/render.js";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FA = window.STRINGS;
const calls = [];
const json = (o, status = 200) => new Response(JSON.stringify(o), { status,
  headers: { "Content-Type": "application/json" } });
let active = "b@x.io";
let signedIn = true;
let accounts = [
  { email: "a@x.io", plan: "pro", org: null, expired: false },
  { email: "b@x.io", plan: "max", org: null, expired: false },
  { email: "c@x.io", plan: "max", org: null, expired: true },
];
const listing = () => ({ active: signedIn ? active : null, accounts: accounts.map((a) => ({
  ...a, active: signedIn && a.email === active, expired: a.expired && a.email !== active })) });
window.fetch = async (url, init) => {
  const u = String(url);
  const body = init?.body ? JSON.parse(init.body) : null;
  calls.push({ url: u, body });
  if (u.startsWith("/api/auth/")) return json({ ok: true });
  if (u.startsWith("/api/auth")) return json(signedIn
    ? { loggedIn: true, email: active, subscriptionType: "max" } : { loggedIn: false });
  if (u.startsWith("/api/accounts/switch")) {
    active = body.email; signedIn = true;
    return json({ ...listing(), deferred: 1,
                  status: { loggedIn: true, email: active, subscriptionType: "pro" } });
  }
  if (u.startsWith("/api/accounts/remove")) {
    accounts = accounts.filter((a) => a.email !== body.email);
    return json(listing());
  }
  if (u.startsWith("/api/accounts")) return json(listing());
  if (u.startsWith("/api/projects")) return json({ projects: [] });
  if (u.startsWith("/api/tabs")) return json({ tabs: [], active: "" });
  if (u.startsWith("/api/session")) return json({ events: [] });
  if (u.startsWith("/api/agents")) return json({ agents: [] });
  return json({ ok: true });
};
const sheet = () => document.getElementById("login");
const rows = () => [...(sheet()?.querySelectorAll(".account-row") ?? [])];
const wall = (text = "You've hit your limit · resets 3:46pm (Asia/Tehran)") =>
  window.renderEvent({ type: "assistant", message: { model: "<synthetic>",
    content: [{ type: "text", text }] } });
const strips = () => document.querySelectorAll(".wall-accounts").length;
const lastStrip = () => [...document.querySelectorAll(".wall-accounts")].at(-1);
const lastCall = (path) => calls.filter((c) => c.url.startsWith(path)).at(-1);

(async () => {
 const out = {};
 try {
  await sleep(300);
  await openLogin(); await sleep(150);
  out.open = !!sheet()?.open;
  out.rowMails = rows().map((r) => r.querySelector("bdi")?.textContent).join();
  out.bdiLtr = rows().every((r) => r.querySelector("bdi")?.dir === "ltr");
  out.aButton = rows()[0]?.querySelector("button")?.textContent;
  out.cButton = rows()[1]?.querySelector("button")?.textContent;
  out.cExpired = rows()[1]?.textContent.includes(FA.accountExpired);
  out.addLabel = [...sheet().querySelectorAll("menu button")].map((b) => b.textContent).join("|");

  rows()[0].querySelector("button").click(); await sleep(200);
  out.switchBody = lastCall("/api/accounts/switch")?.body;
  out.afterText = sheet().textContent;
  out.afterRows = rows().map((r) => r.querySelector("bdi")?.textContent).join();

  rows().find((r) => r.textContent.includes("c@x.io"))
    ?.querySelectorAll("button")[1]?.click();
  await sleep(150);
  out.removeBody = lastCall("/api/accounts/remove")?.body;
  out.afterRemove = rows().map((r) => r.querySelector("bdi")?.textContent).join();
  sheet().close();

  wall(); await sleep(200);
  out.wallRow = lastStrip()?.parentElement?.textContent.startsWith(FA.usageWall);
  const strip = lastStrip();
  out.wallButtons = [...(strip?.querySelectorAll("button") ?? [])].map((b) => b.textContent);
  out.wantWall = FA.accountContinueOn.replace("{a}", "b@x.io");
  out.wallBdi = strip?.querySelector("button bdi")?.dir;
  strip?.querySelector("button")?.click(); await sleep(200);
  out.wallBody = lastCall("/api/accounts/switch")?.body;
  out.stripGone = strips() === 0;

  window.renderEvent({ type: "wrapper", subtype: "auto_resume", state: "fired",
                       uuid: "u9", account: "b@x.io" });
  await sleep(50);
  const resumed = [...document.querySelectorAll(".auto-resume")].at(-1);
  out.firedText = resumed?.textContent;
  out.wantFired = FA.autoResumeSwitched.replace("{a}", "b@x.io");
  out.firedBdi = resumed?.querySelector("bdi")?.dir;

  accounts = accounts.filter((a) => a.email === active);
  wall(); await sleep(200);
  out.loneButtons = [...(lastStrip()?.querySelectorAll("button") ?? [])]
    .map((b) => b.textContent);
  sheet()?.open && sheet().close();

  const before = document.querySelectorAll(".wall-accounts").length;
  bulkAppend(() => wall()); await sleep(200);
  out.replayStrips = document.querySelectorAll(".wall-accounts").length - before;

  accounts = [{ email: "a@x.io", plan: "pro", expired: false }];
  signedIn = false;
  await openLogin(); await sleep(150);
  out.outText = sheet().textContent;
  out.outRows = rows().map((r) => r.querySelector("bdi")?.textContent).join();
  document.getElementById("probe-out").textContent = "PROBE" + JSON.stringify(out) + "ENDPROBE";
 } catch (err) {
  document.getElementById("probe-out").textContent =
    "PROBE" + JSON.stringify({ error: String(err && err.stack || err), partial: out }) + "ENDPROBE";
 }
})();
</script>
"""


def ui_checks() -> list[tuple[bool, str, str]]:
    from server import EDITIONS
    from test_layout import boot_server, find_edge, hold_sse, measure
    edition = os.environ.get("PCG_UI", "web")
    static = HERE / EDITIONS[edition][0]
    probe = static / "_accounts_probe.html"
    page = (static / "index.html").read_text(encoding="utf-8").replace("{{VERSION}}", "9.9.9")
    marker = '<body class="app">'
    if marker not in page:
        return [(False, f"[{edition}] index.html opens with {marker}", "")]
    page = page.replace(marker, '<body class="app" data-render-only>', 1)
    probe.write_text(page.replace("</body>", PROBE_JS + "\n</body>", 1), encoding="utf-8")
    stop = threading.Event()
    proc = None
    try:
        proc, base, token = boot_server(edition=edition)
        threading.Thread(target=hold_sse, args=(base, token, stop), daemon=True).start()
        m = measure(find_edge(), f"{base}/static/_accounts_probe.html?t={token}", 1280, 900)
    except Exception as err:                                  # noqa: BLE001
        return [(False, f"[{edition}] the probe page ran", repr(err))]
    finally:
        stop.set()
        if proc:
            proc.terminate()
        probe.unlink(missing_ok=True)
    if m.get("error"):
        return [(False, f"[{edition}] the probe ran", f"{m['error']} {m.get('partial')}")]

    fa = m
    out: list[tuple[bool, str, str]] = []

    def check(ok: bool, what: str, why: str = "") -> None:
        out.append((bool(ok), f"[{edition}] {what}", why))

    check(fa.get("open") and fa.get("rowMails") == "a@x.io,c@x.io" and fa.get("bdiLtr"),
          "/login lists the OTHER accounts, each email an LTR isolate", str(fa.get("rowMails")))
    check(fa.get("cExpired") and fa.get("aButton") != fa.get("cButton"),
          "a run-out account says so and offers a fresh login instead",
          f"{fa.get('aButton')} / {fa.get('cButton')}")
    check(fa.get("switchBody") == {"email": "a@x.io"}, "its button posts the switch", str(fa.get("switchBody")))
    check(fa.get("afterRows") == "b@x.io,c@x.io" and "a@x.io" in (fa.get("afterText") or ""),
          "the sheet repaints on the new account, the old one now in the list", str(fa.get("afterRows")))
    check(fa.get("removeBody") == {"email": "c@x.io"} and fa.get("afterRemove") == "b@x.io",
          "remove posts that email and drops its row", f"{fa.get('removeBody')} {fa.get('afterRemove')}")
    check(fa.get("wallButtons") == [fa.get("wantWall")] and fa.get("wallBdi") == "ltr",
          "a live wall offers «ادامه با …» for each usable other account",
          str(fa.get("wallButtons")))
    check(fa.get("wallRow"), "...inside the wall's own row")
    body = fa.get("wallBody") or {}
    check(body.get("email") == "b@x.io" and isinstance(body.get("resume"), str) and fa.get("stripGone"),
          "a click switches with this tab to resume, and the buttons go", str(body))
    check(fa.get("firedText") == fa.get("wantFired") and fa.get("firedBdi") == "ltr",
          "the continued row names the account it went on", str(fa.get("firedText")))
    check(len(fa.get("loneButtons") or []) == 1, "with no other account the wall offers one login",
          str(fa.get("loneButtons")))
    check(fa.get("replayStrips") == 0, "a replayed wall has no buttons", str(fa.get("replayStrips")))
    check("a@x.io" in (fa.get("outRows") or "") and len(fa.get("outText") or "") > 0,
          "signed out with a saved account: the sheet offers it before a login", str(fa.get("outRows")))
    return out


def main() -> int:
    results: list[tuple[bool, str, str]] = []

    def check(ok: bool, what: str, why: str = "") -> None:
        results.append((bool(ok), what, why))

    before = [p.stat().st_mtime if p.exists() else None for p in REAL_FILES]
    cfg = Path(tempfile.mkdtemp(prefix="pcg-acct-cfg-"))
    project = tempfile.mkdtemp(prefix="pcg-acct-proj-")
    saved = os.environ.get("CLAUDE_CONFIG_DIR")
    os.environ["CLAUDE_CONFIG_DIR"] = str(cfg)
    proc = None
    stop = threading.Event()
    try:
        import server

        # --- the JSON surgery -------------------------------------------------
        text = CONFIG % '{"emailAddress": "a@x.io"}'
        out = server.replace_top_level(text, "oauthAccount", account("b@x.io"))
        check(json.loads(out)["oauthAccount"]["emailAddress"] == "b@x.io",
              "replace_top_level sets the value", out[:120])
        check(outside_oauth(out) == outside_oauth(text),
              "every byte outside oauthAccount is kept (duplicate keys, 1.50, Persian)")
        check(server.replace_top_level("{}", "k", 1) == '{\n  "k": 1\n}',
              "an empty object gets the key", repr(server.replace_top_level("{}", "k", 1)))
        added = server.replace_top_level('{"a": 1}', "k", {"b": 2})
        check(json.loads(added) == {"k": {"b": 2}, "a": 1}, "an absent key is inserted", added)
        check(server._top_level_span('{"x": {"oauthAccount": 1}}', "oauthAccount") is None,
              "a nested key of the same name is not the top-level one")

        # --- the vault, in-process ---------------------------------------------
        vault = server.AccountVault()
        check(vault.listing() == {"active": None, "accounts": []},
              "signed out: no accounts, none active", str(vault.listing()))

        write_login(cfg, "A1", "a@x.io")
        listing = vault.listing()
        check(listing["active"] == "a@x.io" and [r["email"] for r in listing["accounts"]] == ["a@x.io"],
              "the account on disk is enrolled by a listing", str(listing))
        vault_file = cfg / server.ACCOUNT_VAULT_NAME
        stamp = vault_file.stat().st_mtime_ns
        time.sleep(0.05)
        vault.listing()
        check(vault_file.stat().st_mtime_ns == stamp, "a listing with nothing new writes nothing")

        vault.capture()                     # what /api/auth/login does first
        write_login(cfg, "B1", "b@x.io")    # what the login itself leaves
        listing = vault.listing()
        check(listing["active"] == "b@x.io" and len(listing["accounts"]) == 2
              and listing["accounts"][0]["email"] == "b@x.io",
              "a second login ADDS an account, active first", str(listing))

        # The CLI refreshes B while it is in use: the refresh token rotates.
        creds = json.loads((cfg / ".credentials.json").read_text(encoding="utf-8"))
        creds["claudeAiOauth"] = oauth("B2")
        (cfg / ".credentials.json").write_text(json.dumps(creds), encoding="utf-8")
        config_before = (cfg / ".claude.json").read_text(encoding="utf-8")

        why = vault.switch("a@x.io")
        creds = json.loads((cfg / ".credentials.json").read_text(encoding="utf-8"))
        config_after = (cfg / ".claude.json").read_text(encoding="utf-8")
        check(why is None and creds["claudeAiOauth"]["accessToken"].endswith("A1"),
              "a switch writes the other account's token", f"{why} {creds.get('claudeAiOauth')}")
        check(creds.get("mcpOAuth") == MCP, "the MCP servers' tokens are untouched", str(creds.get("mcpOAuth")))
        check(json.loads(config_after)["oauthAccount"]["emailAddress"] == "a@x.io",
              "and the other account's oauthAccount")
        check(outside_oauth(config_after) == outside_oauth(config_before),
              "the rest of .claude.json is byte-identical")
        check(vault.current_email() == "a@x.io" and vault.listing()["active"] == "a@x.io",
              "the vault agrees which account is active")

        vault.switch("b@x.io")
        creds = json.loads((cfg / ".credentials.json").read_text(encoding="utf-8"))
        check(creds["claudeAiOauth"]["refreshToken"].endswith("B2"),
              "switching back restores the ROTATED token, not the stale one",
              creds["claudeAiOauth"]["refreshToken"])

        check(vault.switch("nobody@x.io") == "unknown account", "an unknown account is refused")
        data = json.loads(vault_file.read_text(encoding="utf-8"))
        data["accounts"]["a@x.io"]["oauth"]["refreshTokenExpiresAt"] = PAST_MS
        vault_file.write_text(json.dumps(data), encoding="utf-8")
        row = next(r for r in vault.listing()["accounts"] if r["email"] == "a@x.io")
        check(row["expired"] is True, "a run-out refresh token is marked expired", str(row))
        check(vault.switch("a@x.io") == "expired", "and switching to it is refused")
        check(vault.current_email() == "b@x.io", "a refused switch leaves the disk alone")
        data["accounts"]["a@x.io"]["oauth"]["refreshTokenExpiresAt"] = FUTURE_MS
        vault_file.write_text(json.dumps(data), encoding="utf-8")
        if os.name == "posix":
            check(vault_file.stat().st_mode & 0o077 == 0, "the vault is 0600",
                  oct(vault_file.stat().st_mode))

        # --- the routes, real server + real CLI ---------------------------------
        from test_layout import boot_server, hold_sse
        from test_login import call
        proc, base, token = boot_server(cwd=Path(project))
        threading.Thread(target=hold_sse, args=(base, token, stop), daemon=True).start()

        code, st = call(base, token, "/api/auth")
        check(st.get("email") == "b@x.io", "the CLI reads the fake login as b@x.io", str(st))
        code, listing = call(base, token, "/api/accounts")
        check(code == 200 and listing.get("active") == "b@x.io"
              and len(listing.get("accounts", [])) == 2, "GET /api/accounts lists both", str(listing))
        check("oauth" not in json.dumps(listing) and "sk-ant" not in json.dumps(listing),
              "no token leaves the server", json.dumps(listing)[:200])

        code, r = call(base, token, "/api/accounts/remove", {"email": "b@x.io"})
        check(code == 409, "the active account cannot be removed", f"{code} {r}")
        code, r = call(base, token, "/api/accounts/switch", {"email": "nobody@x.io"})
        check(code == 409, "an unknown account is a 409", f"{code} {r}")
        code, r = call(base, token, "/api/accounts/switch", {})
        check(code == 400, "no email is a 400", f"{code} {r}")

        # Last: a CLI that gets to USE a fake token is refused by Anthropic and
        # blanks accessToken/refreshToken in the file (measured here, 2.1.300),
        # so nothing after this point can rely on the fake login being valid.
        code, opened = call(base, token, "/api/project/open", {"path": project})
        tab = opened.get("tab", "")
        code, r = call(base, token, "/api/accounts/switch", {"email": "a@x.io"})
        check(code == 200 and r.get("active") == "a@x.io" and r.get("status", {}).get("email") == "a@x.io",
              "a switch answers with the new account, read back from the CLI", str(r)[:300])
        code, tabs = call(base, token, "/api/tabs")
        check(tab and tab in [t.get("tab") for t in tabs.get("tabs", [])],
              "the open tab survives its respawn", str(tabs)[:200])
        code, r = call(base, token, "/api/control", {"tab": tab, "subtype": "get_context_usage"})
        check(code == 200, "the respawned CLI answers a control request", f"{code} {str(r)[:200]}")
        code, r = call(base, token, "/api/accounts/remove", {"email": "b@x.io"})
        check(code == 200 and [a["email"] for a in r.get("accounts", [])] == ["a@x.io"],
              "an inactive account is removed", str(r))
    except Exception as err:                                  # noqa: BLE001
        import traceback
        traceback.print_exc()
        check(False, "the run finished", repr(err))
    finally:
        stop.set()
        if proc:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except Exception:                                 # noqa: BLE001
                proc.kill()
        if saved is None:
            os.environ.pop("CLAUDE_CONFIG_DIR", None)
        else:
            os.environ["CLAUDE_CONFIG_DIR"] = saved
        shutil.rmtree(cfg, ignore_errors=True)
        shutil.rmtree(project, ignore_errors=True)

    for ok, what, why in ui_checks():
        check(ok, what, why)

    after = [p.stat().st_mtime if p.exists() else None for p in REAL_FILES]
    check(before == after, "the machine's own login was not touched", f"{before} -> {after}")

    for ok, what, why in results:
        print(("  ok   " if ok else "  FAIL ") + what + ("" if ok else f"  -- {why}"))
    passed = sum(ok for ok, _, _ in results)
    print(("PASS" if passed == len(results) else "FAIL") + f" — {passed}/{len(results)}")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
