"""
test_servers.py - Linux servers managed from the window (pcg-kwk, wiki/linux-ssh.md).

Three halves, all offline and free (a throwaway APPDATA, so the PC's own
tunnels.json is never read or written -- asserted):

1. servers.py on its own: connect.ps1's bare-port entries read, a new server
   takes the first port no server has and nothing listens on, an edit keeps
   its port, a rename moves the entry, ssh's errors map to the window's words,
   the Linux payload is the four things install-linux.sh needs with LF line
   ends, and the askpass helper is the measured one.
2. The routes through the real server: list, a bad address is a 400, a good
   one is saved, an unknown target is a 404, remove.
3. The window, per PCG_UI, every route stubbed in the page: the sidebar's two
   entries, the list and what each server has, add -> password -> install ->
   ready, the password cleared after it is sent, remove on the second click.

The live half -- a real server, a real password, a real install -- ran by hand
against the VMware Ubuntu guest on 2026-10-16 (wiki/linux-ssh.md); set
PCG_SSH_TARGET=user@host to repeat the key-login part of it here.
"""

from __future__ import annotations

import io
import json
import os
import shutil
import socket
import sys
import tarfile
import tempfile
import threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

REAL_STATE = Path(os.environ.get("APPDATA") or Path.home() / ".config") / "persian-claude" / "tunnels.json"


PROBE_JS = r"""
<pre id="probe-out" hidden></pre>
<script type="module">
import { openServers } from "/static/js/servers.js";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FA = window.STRINGS;
const calls = [];
const json = (o, status = 200) => new Response(JSON.stringify(o), { status,
  headers: { "Content-Type": "application/json" } });
let servers = [
  { target: "a@10.0.0.1", user: "a", host: "10.0.0.1", name: "سرور الف", ssh_port: 22, port: 8701, open: true },
  { target: "b@10.0.0.2", user: "b", host: "10.0.0.2", name: "10.0.0.2", ssh_port: 22, port: 8702, open: false },
  { target: "c@10.0.0.3", user: "c", host: "10.0.0.3", name: "10.0.0.3", ssh_port: 22, port: 8703, open: false },
];
let keyed = false, installed = false, installPolls = 0;
window.fetch = async (url, init) => {
  const u = String(url).split("?")[0];
  const body = init?.body ? JSON.parse(init.body) : null;
  calls.push({ url: u, body });
  if (u === "/api/servers") return json({ servers, version: "0.14.0", ssh: true });
  if (u === "/api/servers/check") {
    const t = body.target;
    if (t === "a@10.0.0.1") return json({ ok: true, installed: true, version: "0.14.0" });
    if (t === "b@10.0.0.2") return json({ ok: true, installed: true, version: "0.13.0" });
    if (t === "c@10.0.0.3") return json({ ok: false, error: "unreachable" });
    if (body.password) keyed = body.password === "s3cret&!";
    if (!keyed) return json({ ok: false, error: "auth" });
    return json({ ok: true, installed, version: installed ? "0.14.0" : null, claude: true, python_ok: true });
  }
  if (u === "/api/servers/save") {
    servers = [...servers, { target: body.user + "@" + body.host, user: body.user, host: body.host,
                             name: body.name || body.host, ssh_port: body.ssh_port, port: 8704, open: false }];
    return json({ target: body.user + "@" + body.host, servers });
  }
  if (u === "/api/servers/install") return json({ running: true, rc: null, lines: [] });
  if (u === "/api/servers/install/state") {
    installPolls++;
    if (installPolls < 2) return json({ running: true, rc: null, lines: ["==> python: /usr/bin/python3"] });
    installed = true;
    return json({ running: false, rc: 0, lines: ["==> python: /usr/bin/python3", "==> done."] });
  }
  if (u === "/api/servers/remove") {
    servers = servers.filter((s) => s.target !== body.target);
    return json({ servers });
  }
  if (u === "/api/servers/open") return json({ ok: true });
  if (u.startsWith("/api/projects")) return json({ projects: [] });
  if (u.startsWith("/api/tabs")) return json({ tabs: [], active: "" });
  if (u.startsWith("/api/session")) return json({ events: [] });
  if (u.startsWith("/api/agents")) return json({ agents: [] });
  if (u.startsWith("/api/accounts")) return json({ active: null, accounts: [] });
  return json({ ok: true });
};
const sheet = () => document.getElementById("servers");
const rows = () => [...(sheet()?.querySelectorAll(".server-row") ?? [])];
const btn = (text) => [...sheet().querySelectorAll("button")].find((b) => b.textContent === text);
const until = async (fn, ms = 4000) => { const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(50); } return false; };

(async () => {
 const out = {};
 try {
  await sleep(300);
  const side = document.getElementById("btn-servers");
  out.sideShown = !side.hidden && document.getElementById("btn-servers-label").textContent === FA.sideServers;
  out.accountsShown = !document.getElementById("btn-accounts").hidden;
  side.click();
  await until(() => rows().length === 3 && rows()[2].textContent.includes(FA.srvErrors.unreachable));
  out.rowCount = rows().length;
  out.addrLtr = rows().every((r) => r.querySelector("bdi")?.dir === "ltr");
  out.openState = rows()[0].querySelector(".server-state")?.textContent;
  out.factA = rows()[0].querySelector(".server-facts")?.textContent;
  out.factB = rows()[1].querySelector(".server-facts")?.textContent;
  out.wantUpdate = FA.srvUpdate.replace("{v}", "0.14.0");
  out.factC = rows()[2].querySelector(".server-facts")?.textContent;
  out.closeOnlyOpen = !rows()[0].querySelectorAll(".server-acts button")[1].hidden
    && rows()[1].querySelectorAll(".server-acts button")[1].hidden;

  btn(FA.srvAdd).click(); await sleep(50);
  const inputs = [...sheet().querySelectorAll("input")];
  out.fieldCount = inputs.length;
  btn(FA.srvSave).click(); await sleep(50);
  out.needAddr = sheet().textContent.includes(FA.srvNeedAddr);
  inputs[0].value = "10.0.0.9"; inputs[1].value = "maryam"; inputs[3].value = "دفتر";
  btn(FA.srvSave).click();
  await until(() => sheet().querySelector('input[type="password"]'));
  out.saveBody = calls.filter((c) => c.url === "/api/servers/save").at(-1)?.body;
  out.pwView = !!sheet().querySelector('input[type="password"]');
  out.pwUserLtr = sheet().querySelector("p bdi")?.textContent;
  const pw = sheet().querySelector('input[type="password"]');
  pw.value = "wrong"; btn(FA.srvContinue).click();
  await until(() => sheet().textContent.includes(FA.srvErrors.auth));
  out.wrongSaid = sheet().textContent.includes(FA.srvErrors.auth);
  out.pwCleared = sheet().querySelector('input[type="password"]')?.value === "";
  sheet().querySelector('input[type="password"]').value = "s3cret&!";
  btn(FA.srvContinue).click();
  await until(() => btn(FA.srvInstall));
  out.pwSent = calls.filter((c) => c.body?.password).map((c) => c.body.password);
  out.installView = !!btn(FA.srvInstall);
  btn(FA.srvInstall).click();
  await until(() => sheet().querySelector(".server-log")?.textContent.includes("python"));
  out.logLtr = sheet().querySelector(".server-log")?.dir;
  await until(() => btn(FA.srvOpenBtn) && sheet().textContent.includes(FA.srvReady.replace("{v}", "0.14.0")), 8000);
  out.ready = sheet().textContent.includes(FA.srvReady.replace("{v}", "0.14.0"));
  btn(FA.srvOpenBtn).click(); await sleep(150);
  out.openBody = calls.filter((c) => c.url === "/api/servers/open").at(-1)?.body;

  await until(() => rows().length === 4);
  const drop = () => [...rows()[1].querySelectorAll("button")].find((b) => b.textContent.startsWith(FA.srvRemove));
  drop().click(); await sleep(50);
  out.armedNoCall = !calls.some((c) => c.url === "/api/servers/remove");
  drop().click(); await until(() => rows().length === 3);
  out.removeBody = calls.filter((c) => c.url === "/api/servers/remove").at(-1)?.body;
  out.passwordNowhere = !JSON.stringify([...sheet().querySelectorAll("input")].map((i) => i.value)).includes("s3cret");
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
    probe = static / "_servers_probe.html"
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
        m = measure(find_edge(), f"{base}/static/_servers_probe.html?t={token}", 1280, 900)
    except Exception as err:                                  # noqa: BLE001
        return [(False, f"[{edition}] the probe page ran", repr(err))]
    finally:
        stop.set()
        if proc:
            proc.terminate()
        probe.unlink(missing_ok=True)
    if m.get("error"):
        return [(False, f"[{edition}] the probe ran", f"{m['error']} {m.get('partial')}")]
    out: list[tuple[bool, str, str]] = []

    def check(ok, what, why=""):
        out.append((bool(ok), f"[{edition}] {what}", why))

    check(m.get("sideShown") and m.get("accountsShown"),
          "the sidebar foot shows «حساب‌ها» and «سرورها»", f"{m.get('sideShown')} {m.get('accountsShown')}")
    check(m.get("rowCount") == 3 and m.get("addrLtr"), "the list draws each server, its address an LTR isolate")
    check(m.get("openState") and m.get("closeOnlyOpen"),
          "an open tunnel says so, and only it offers «قطع اتصال»", str(m.get("openState")))
    check("0.14.0" in (m.get("factA") or "") and m.get("wantUpdate") in (m.get("factB") or ""),
          "each row is filled from the server: its version, an update when it is behind",
          f"{m.get('factA')} / {m.get('factB')}")
    check(m.get("factC") and "0.14" not in m.get("factC"), "an unreachable server says why", str(m.get("factC")))
    check(m.get("fieldCount") == 4 and m.get("needAddr"),
          "add asks four things, and refuses without an address", str(m.get("fieldCount")))
    body = m.get("saveBody") or {}
    check(body.get("host") == "10.0.0.9" and body.get("user") == "maryam" and body.get("ssh_port") == 22
          and body.get("name") == "دفتر", "save posts the address, the user, the port and the name", str(body))
    check(m.get("pwView") and m.get("pwUserLtr") == "maryam",
          "no key login: the password is asked, naming the user", str(m.get("pwUserLtr")))
    check(m.get("wrongSaid") and m.get("pwCleared"), "a refused password says so and the field is emptied")
    check(m.get("pwSent") == ["wrong", "s3cret&!"], "the password goes out only on «ادامه»", str(m.get("pwSent")))
    check(m.get("installView") and m.get("logLtr") == "ltr", "not installed: «نصب روی سرور», then the log, LTR")
    check(m.get("ready"), "a finished install lands on «آماده است» with the version")
    check((m.get("openBody") or {}).get("target") == "maryam@10.0.0.9", "«باز کردن» opens that server",
          str(m.get("openBody")))
    check(m.get("armedNoCall") and (m.get("removeBody") or {}).get("target") == "b@10.0.0.2",
          "remove needs a second click", str(m.get("removeBody")))
    check(m.get("passwordNowhere"), "the password is in no field afterwards")
    return out


def main() -> int:
    results: list[tuple[bool, str, str]] = []

    def check(ok, what, why=""):
        results.append((bool(ok), what, why))

    before = REAL_STATE.stat().st_mtime if REAL_STATE.exists() else None
    appdata = tempfile.mkdtemp(prefix="pcg-srv-test-")
    saved = os.environ.get("APPDATA")
    os.environ["APPDATA"] = appdata
    proc = None
    stop = threading.Event()
    try:
        import servers as S
        state = Path(appdata) / "persian-claude" / "tunnels.json"
        state.parent.mkdir(parents=True)
        # connect.ps1's older shape, BOM included (Out-File -Encoding utf8).
        state.write_text('﻿{"old@10.1.1.1": 8701}', encoding="utf-8")
        check(S.load() == {"old@10.1.1.1": {"port": 8701, "name": "", "ssh_port": 22,
                                            "remote_port": 8765}},
              "a bare port from connect.ps1 reads as an entry", str(S.load()))
        with socket.socket() as busy:
            busy.bind(("127.0.0.1", 8702))
            busy.listen(1)
            t = S.upsert("me", "10.1.1.2", 2222, " دفتر ", None)
        e = S.load()[t]
        check(e["port"] == 8703 and e["ssh_port"] == 2222 and e["name"] == "دفتر",
              "a new server skips taken and listening ports", str(e))
        S.upsert("me", "10.1.1.2", 22, "x", t)
        check(S.load()[t]["port"] == 8703, "an edit keeps the local port")
        t2 = S.upsert("me", "10.1.1.9", 22, "x", t)
        check(t not in S.load() and S.load()[t2]["port"] == 8703, "a rename moves the entry, port and all")
        for bad in (("", "h"), ("u", ""), ("u;rm", "h"), ("u", "h h")):
            try:
                S.upsert(bad[0], bad[1], 22, "", None)
                check(False, f"bad address {bad} refused")
            except ValueError:
                pass
        check(True, "malformed users and hosts are refused")
        words = {"Permission denied (publickey,password).": "auth",
                 "@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@": "hostkey",
                 "ssh: Could not resolve hostname nowhere": "resolve",
                 "Connection closed by 1.2.3.4 port 22": "penalty",
                 "ssh: connect to host 1.2.3.4 port 22: Connection timed out": "unreachable"}
        check(all(S.classify(255, err) == want for err, want in words.items()) and S.classify(0, "") is None,
              "ssh's errors map to the window's words")
        with tarfile.open(fileobj=io.BytesIO(S.payload()), mode="r:gz") as tar:
            names = tar.getnames()
            script = tar.extractfile("install-linux.sh").read()
            mode = tar.getmember("install-linux.sh").mode
        check({"server.py", "install-linux.sh", "static-terminal/index.html", "assets"} <= set(names)
              and not any("_probe.html" in n or "__pycache__" in n for n in names),
              "the payload is what install-linux.sh copies", str(len(names)))
        check(b"\r\n" not in script and mode & 0o111 and b"--yes" in script,
              "install-linux.sh goes out LF, executable, with --yes")
        helper = S._askpass().read_text(encoding="ascii")
        check(("EnableDelayedExpansion" in helper and "!PCG_SSH_SECRET!" in helper)
              if sys.platform == "win32" else "PCG_SSH_SECRET" in helper,
              "the askpass helper prints the secret verbatim (delayed expansion)")

        live = os.environ.get("PCG_SSH_TARGET")
        if live:
            user, _, host = live.partition("@")
            lt = S.upsert(user, host, 22, "", None)
            info = S.probe(lt)
            check(info.get("ok"), f"live: {live} answers a key login", str(info))

        # --- the routes ---
        from test_layout import boot_server, hold_sse
        from test_login import call
        proc, base, token = boot_server()
        threading.Thread(target=hold_sse, args=(base, token, stop), daemon=True).start()
        code, r = call(base, token, "/api/servers")
        check(code == 200 and [s["target"] for s in r.get("servers", [])] == ["old@10.1.1.1", t2]
              and r.get("version"), "GET /api/servers lists them, with this PC's version", str(r)[:200])
        code, r = call(base, token, "/api/servers/save", {"user": "x y", "host": "h"})
        check(code == 400, "a bad address is a 400", f"{code} {r}")
        code, r = call(base, token, "/api/servers/save", {"user": "new", "host": "10.1.1.5", "name": "ن"})
        check(code == 200 and r.get("target") == "new@10.1.1.5", "a good one is saved", str(r)[:200])
        code, r = call(base, token, "/api/servers/check", {"target": "nobody@nowhere"})
        check(code == 404, "an unknown target is a 404", f"{code}")
        code, r = call(base, token, "/api/servers/remove", {"target": "new@10.1.1.5"})
        check(code == 200 and "new@10.1.1.5" not in [s["target"] for s in r.get("servers", [])],
              "remove drops it", str(r)[:200])
    except Exception as err:                                  # noqa: BLE001
        import traceback
        traceback.print_exc()
        check(False, "the run finished", repr(err))
    finally:
        stop.set()
        if proc:
            proc.terminate()
        if saved is None:
            os.environ.pop("APPDATA", None)
        else:
            os.environ["APPDATA"] = saved
        shutil.rmtree(appdata, ignore_errors=True)

    for ok, what, why in ui_checks():
        check(ok, what, why)
    after = REAL_STATE.stat().st_mtime if REAL_STATE.exists() else None
    check(before == after, "this PC's own tunnels.json was not touched", f"{before} -> {after}")

    for ok, what, why in results:
        print(("  ok   " if ok else "  FAIL ") + what + ("" if ok else f"  -- {why}"))
    passed = sum(ok for ok, _, _ in results)
    print(("PASS" if passed == len(results) else "FAIL") + f" — {passed}/{len(results)}")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
