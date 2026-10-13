"""
test_login.py - the sign-in routes against the REAL `claude auth` (wiki/cli-login.md).

Boots the server with a throwaway CLAUDE_CONFIG_DIR, so the CLI under it is
signed out and the machine's own login is never touched (asserted: the real
credentials file is not written). Free: a bogus code is refused by Anthropic's
token endpoint with a 400, which is the whole point of sending one -- it proves
the pasted code reaches the CLI's stdin and that a refusal comes back as a
refusal, not as a cheerful `ok`.

What a REAL code does is not checked here; that needs a person.
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import threading
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from test_layout import boot_server, hold_sse  # noqa: E402

REAL_CREDS = Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude") / ".credentials.json"


def call(base: str, token: str, path: str, body: dict | None = None) -> tuple[int, dict]:
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(f"{base}{path}?t={token}", data=data,
                                 headers={"Content-Type": "application/json"},
                                 method="GET" if body is None else "POST")
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            return res.status, json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        return err.code, json.loads(err.read().decode("utf-8") or "{}")


def main() -> int:
    results: list[tuple[bool, str, str]] = []

    def check(ok: bool, what: str, why: str = "") -> None:
        results.append((bool(ok), what, why))

    before = REAL_CREDS.stat().st_mtime if REAL_CREDS.exists() else None
    cfg = tempfile.mkdtemp(prefix="pcg-login-cfg-")
    project = tempfile.mkdtemp(prefix="pcg-login-proj-")
    saved = os.environ.get("CLAUDE_CONFIG_DIR")
    saved_browser = os.environ.get("BROWSER")
    os.environ["CLAUDE_CONFIG_DIR"] = cfg
    # The CLI runs $BROWSER with the link when it is set; a command that does
    # not exist opens nothing. Unset, it opened the PERSON's browser on every
    # run of this file (2026-10-14).
    os.environ["BROWSER"] = "pcg-no-browser"
    stop = threading.Event()
    proc = None
    try:
        proc, base, token = boot_server(cwd=Path(project))
        threading.Thread(target=hold_sse, args=(base, token, stop), daemon=True).start()

        code, st = call(base, token, "/api/auth")
        check(code == 200 and st.get("loggedIn") is False,
              "GET /api/auth reports a signed-out CLI as loggedIn: false", str(st))

        code, r = call(base, token, "/api/auth/code", {"code": "x#y"})
        check(r.get("ok") is False and "no login" in r.get("error", ""),
              "a code with no login under way is refused", str(r))

        code, r = call(base, token, "/api/auth/code", {"code": "  "})
        check(code == 400, "an empty code is a 400", f"{code} {r}")

        code, r = call(base, token, "/api/auth/login", {})
        url = r.get("url", "")
        check(code == 200 and "/oauth/authorize?" in url
              and "platform.claude.com%2Foauth%2Fcode%2Fcallback" in url,
              "login hands back the OAuth link whose callback shows a code", str(r)[:200])
        code, r = call(base, token, "/api/auth/flow", {})
        check(r.get("state") == "waiting", "the flow reports a login waiting", str(r))

        code, r = call(base, token, "/api/auth/code", {"code": "bogus-code#bogus-state"})
        check(r.get("ok") is False and "Login failed" in r.get("error", ""),
              "a bogus code reaches the CLI and comes back refused", str(r))
        check("status" not in r, "a refused code respawns nothing", str(r))
        code, r = call(base, token, "/api/auth/flow", {})
        check(r.get("state") == "idle", "and the poll does not report it a second time", str(r))

        call(base, token, "/api/auth/login", {})
        code, r = call(base, token, "/api/auth/cancel", {})
        check(r.get("ok") is True, "cancel answers ok", str(r))
        code, r = call(base, token, "/api/auth/code", {"code": "x#y"})
        check("no login" in r.get("error", ""), "after cancel no login is waiting", str(r))

        code, opened = call(base, token, "/api/project/open", {"path": project})
        tab = opened.get("tab", "")
        code, r = call(base, token, "/api/auth/logout", {})
        check(r.get("ok") is True and r.get("status", {}).get("loggedIn") is False,
              "logout answers ok with the status read back", str(r))
        code, tabs = call(base, token, "/api/tabs")
        check([t.get("tab") for t in tabs.get("tabs", [])] == [tab],
              "the open tab survives its respawn", str(tabs)[:200])
        # get_context_usage is answered by the CLI locally: a process is there.
        code, r = call(base, token, "/api/control", {"tab": tab, "subtype": "get_context_usage"})
        check(code == 200, "the respawned CLI answers a control request", f"{code} {str(r)[:200]}")
    except Exception as err:                                  # noqa: BLE001
        check(False, "the run finished", repr(err))
    finally:
        stop.set()
        if proc:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except Exception:                                 # noqa: BLE001
                proc.kill()
        for key, value in (("CLAUDE_CONFIG_DIR", saved), ("BROWSER", saved_browser)):
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        shutil.rmtree(cfg, ignore_errors=True)
        shutil.rmtree(project, ignore_errors=True)

    after = REAL_CREDS.stat().st_mtime if REAL_CREDS.exists() else None
    check(before == after, "the machine's own login was not touched", f"{before} -> {after}")

    for ok, what, why in results:
        print(("  ok   " if ok else "  FAIL ") + what + ("" if ok else f"  -- {why}"))
    passed = sum(ok for ok, _, _ in results)
    print(("PASS" if passed == len(results) else "FAIL") + f" — {passed}/{len(results)}")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
