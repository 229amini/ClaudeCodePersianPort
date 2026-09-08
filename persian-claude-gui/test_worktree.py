r"""MA2 gate: a conversation in a git worktree of its own, end to end.

    $env:PYTHONIOENCODING='utf-8'
    python persian-claude-gui\test_worktree.py

FREE. It boots the real server and lets it spawn ONE real `claude` process, but
never sends a message, so nothing is inferred and nothing is billed — the same
shape as probe_queue.py. `--worktree` is created by the CLI at spawn, before
`initialize`, so the whole feature is observable before a turn exists.

What it holds (measured 2026-09-06, CLI 2.1.263):

1. `POST /api/project/open {worktree:"auto"}` picks `agent-1` and the CLI really
   makes `<repo>/.claude/worktrees/agent-1` — a git worktree, so `.git` inside
   it is a FILE pointing back at the repo.
2. `/api/tabs` reports the name, which is what the ⎇ chip renders from.
3. `/api/projects` still lists the repo ONCE and never lists the worktree path
   as a project of its own — the folding in list_projects().
4. The same request against a folder that is not a git repository is a 400,
   refused BEFORE a tab exists.

An SSE connection is held open throughout: the idle watchdog kills the server
about ten seconds after the last client leaves (wiki/dev-environment.md).
"""
import atexit
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import server  # noqa: E402  — for transcript_dir/drop_project_from_lists only

failures: list[str] = []
checks = 0


def check(label: str, ok: bool, detail: str = "") -> None:
    global checks
    checks += 1
    print(("  OK   " if ok else "  FAIL ") + label + (f"  -- {detail}" if not ok and detail else ""))
    if not ok:
        failures.append(label)


def git(*args: str, cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=str(cwd), capture_output=True,
                          text=True, encoding="utf-8", errors="replace")


# --- a throwaway repo, and a throwaway plain folder next to it ----------------
SCRATCH = Path(tempfile.mkdtemp(prefix="pcg-wt-"))
REPO = SCRATCH / "repo"
PLAIN = SCRATCH / "plain"
REPO.mkdir()
PLAIN.mkdir()
git("init", "-q", cwd=REPO)
git("config", "user.email", "test@example.invalid", cwd=REPO)
git("config", "user.name", "pcg test", cwd=REPO)
(REPO / "README.md").write_text("worktree gate\n", encoding="utf-8")
git("add", "-A", cwd=REPO)
# A worktree needs a commit to branch from — `git worktree add` on an unborn
# HEAD fails, and that failure would look exactly like the feature not working.
git("commit", "-q", "-m", "seed", cwd=REPO)

proc = subprocess.Popen(
    [sys.executable, str(HERE / "server.py"), "--cwd", str(REPO), "--no-window"],
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    text=True, encoding="utf-8", errors="replace", bufsize=1,
)


def _force_remove(func, path, _exc) -> None:
    """rmtree's error hook: clear the read-only bit and try once more."""
    try:
        os.chmod(path, stat.S_IWRITE)
        func(path)
    except OSError:
        pass


def _cleanup() -> None:
    """Leave nothing behind: no process, no worktree, no sidebar entry.

    The CLI holds a git lock on the worktree for the life of its process
    (`claude session agent-1 (pid N)`), so the server has to be gone before
    `git worktree remove` can succeed — and taskkill /T because a plain kill
    orphans the claude child, which then keeps both the lock and the cwd.
    """
    subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
    try:
        proc.wait(timeout=15)
    except Exception:
        pass
    tree = server.worktree_path(REPO, "agent-1")
    if tree.exists():
        git("worktree", "remove", "--force", str(tree), cwd=REPO)
    # Both project folders the run can have created: the repo's and the
    # worktree's. Named exactly, never globbed — this deletes transcripts.
    for folder in (REPO, tree, PLAIN):
        found = server.transcript_dir(folder)
        if found is not None:
            shutil.rmtree(found, ignore_errors=True)
        server.drop_project_from_lists(str(folder))
    for _ in range(20):
        # onerror, not ignore_errors: git marks everything under .git/objects
        # read-only, and Windows refuses to unlink a read-only file — so a
        # plain rmtree leaves the scratch repo behind every single run.
        shutil.rmtree(SCRATCH, onerror=_force_remove)
        if not SCRATCH.exists():
            break
        time.sleep(0.25)


atexit.register(_cleanup)

url = None
deadline = time.time() + 30
while time.time() < deadline:
    line = proc.stdout.readline()
    if not line:
        break
    print("[srv]", line.rstrip())
    match = re.search(r"(http://127\.0\.0\.1:\d+/\?t=[\w\-]+)", line)
    if match:
        url = match.group(1)
        break

if not url:
    print("FAIL: server never printed its URL")
    sys.exit(1)

base, token = url.split("/?t=")
threading.Thread(target=lambda: [print("[srv]", ln.rstrip()) for ln in proc.stdout],
                 daemon=True).start()

# Held open for the length of the run, or the idle watchdog shuts the server
# down underneath the checks.
events: list[dict] = []


def read_sse() -> None:
    try:
        with urllib.request.urlopen(f"{base}/api/events?t={token}") as resp:
            for raw in resp:
                text = raw.decode("utf-8").rstrip("\n")
                if text.startswith("data: "):
                    events.append(json.loads(text[6:]))
    except OSError:
        pass   # the teardown kill ends this read; the verdict is already printed


threading.Thread(target=read_sse, daemon=True).start()


def post(path: str, payload: dict) -> tuple[int, dict]:
    request = urllib.request.Request(
        f"{base}{path}?t={token}", data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8") or "{}")


def get(path: str) -> dict:
    with urllib.request.urlopen(f"{base}{path}?t={token}", timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


print("1. a folder that is not a git repository refuses before a tab exists")
status, body = post("/api/project/open", {"path": str(PLAIN), "worktree": "auto"})
check("400, not a spawned tab", status == 400, f"{status} {body}")
check("and it says why", body.get("error") == "not a git repo", str(body))
check("no tab was opened for it",
      not any(t["cwd"].lower() == str(PLAIN).lower() for t in get("/api/tabs")["tabs"]))

print("\n2. the repo opens a conversation in a worktree of its own")
status, opened = post("/api/project/open", {"path": str(REPO), "worktree": "auto"})
check("200", status == 200, f"{status} {opened}")
check("the server named it agent-1 with no prompt", opened.get("worktree") == "agent-1",
      str(opened))

tabs = {}
tree = server.worktree_path(REPO, "agent-1")
# The CLI creates the tree at spawn, before initialize — but "before initialize"
# is still after Popen returns, so this is polled rather than asserted straight
# off the POST.
deadline = time.time() + 60
while time.time() < deadline:
    tabs = get("/api/tabs")
    if (tree / ".git").exists():
        break
    time.sleep(0.5)

check("/api/tabs carries the name for the ⎇ chip",
      [t.get("worktree") for t in tabs.get("tabs", [])] == ["agent-1"], str(tabs))
check("the tab still belongs to the REPO, not to the worktree path",
      tabs["tabs"][0]["cwd"].lower() == str(REPO).lower())
check("the CLI really made the worktree", tree.is_dir(), str(tree))
# A worktree's .git is a FILE ("gitdir: …"), which is why list_projects tests
# .exists() rather than .is_dir() before offering the action.
check("with a real .git link in it", (tree / ".git").is_file())
listed = git("worktree", "list", cwd=REPO).stdout
check("git itself lists it", "agent-1" in listed, listed)

print("\n3. the sidebar shows one project, not two")
projects = get("/api/projects")["projects"]
paths = [p["path"] for p in projects]
check("the repo is listed once", sum(p.lower() == str(REPO).lower() for p in paths) == 1,
      str(paths))
check("no worktree path is a project of its own",
      not any("worktrees" in p for p in paths), str(paths))
check("the repo advertises git, so the menu can offer the action",
      next((p.get("git") for p in projects if p["path"].lower() == str(REPO).lower()), None)
      is True)

print("\n4. nothing was inferred")
# The proof it stayed free: a turn was never sent, so no result event exists.
# Any cost at all would have to arrive on one.
costs = [e.get("total_cost_usd") for e in events if e.get("type") == "result"]
check("no result event, so total_cost_usd is 0", not any(costs), str(costs))
print("  total_cost_usd:", 0 if not costs else costs)

print()
if failures:
    print(f"FAIL — {checks - len(failures)}/{checks}")
    for item in failures:
        print("   ", item)
    sys.exit(1)
print(f"PASS — {checks}/{checks}")
sys.exit(0)
