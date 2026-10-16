"""
SSH servers, managed from the window (pcg-kwk, wiki/linux-ssh.md).

The window on THIS PC lists the Linux servers it knows, opens one (an SSH tunnel
plus its own app window), closes the tunnel, and sets a new server up: the
password is asked once to install this PC's SSH key, and the app is copied and
installed there with install-linux.sh. Everything is plain OpenSSH; stdlib only.

State is %APPDATA%\\persian-claude\\tunnels.json, the same file connect.ps1
keeps, so connect.bat and the window agree on every server's local port. An
entry is {"port", "name", "ssh_port", "remote_port"}; connect.ps1's older bare
port number is read as {"port": n}.

Measured 2026-10-16 (Windows OpenSSH 9.5, Ubuntu 26.04 / OpenSSH 10):
- A password goes in through SSH_ASKPASS + SSH_ASKPASS_REQUIRE=force; a .cmd
  helper that prints the value with delayed expansion survives & ! ^ % in it.
- stdin to ssh must be BYTES: Python's text mode on Windows turns \\n into
  \\r\\n, and a password or script line then carries a \\r.
- OpenSSH 10's PerSourcePenalties drops every connection from an address for
  15 s or more after a failed login: "Connection closed" right after a wrong
  password means "wait", not "unreachable".

Imported lazily by server.py: a Linux server (install-linux.sh copies
server.py only) never needs it.
"""

from __future__ import annotations

import base64
import io
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tarfile
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
NEW_GROUP = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)

FIRST_LOCAL_PORT = 8701
DEFAULT_REMOTE_PORT = 8765
CONNECT_TIMEOUT = 10
TUNNEL_TIMEOUT = 20
TARGET_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}@[A-Za-z0-9.:_-]{1,253}$")

_lock = threading.RLock()


# --- state -------------------------------------------------------------------

def state_dir() -> Path:
    base = os.environ.get("APPDATA")
    return (Path(base) if base else Path.home() / ".config") / "persian-claude"


def state_file() -> Path:
    return state_dir() / "tunnels.json"


def load() -> dict[str, dict]:
    try:
        raw = json.loads(state_file().read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return {}
    out: dict[str, dict] = {}
    for target, value in (raw.items() if isinstance(raw, dict) else []):
        entry = {"port": value} if isinstance(value, int) else value
        if isinstance(entry, dict) and isinstance(entry.get("port"), int):
            out[target] = {"port": entry["port"],
                           "name": str(entry.get("name") or ""),
                           "ssh_port": int(entry.get("ssh_port") or 22),
                           "remote_port": int(entry.get("remote_port") or DEFAULT_REMOTE_PORT)}
    return out


def save(entries: dict[str, dict]) -> None:
    state_dir().mkdir(parents=True, exist_ok=True)
    tmp = state_file().with_suffix(".tmp")
    tmp.write_text(json.dumps(entries, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, state_file())


def tabs_file() -> Path:
    return state_dir() / "tabs.json"


def load_tabs() -> dict:
    """The servers open as tabs in the window (js/hosts.js) and the one in
    front, kept here because the window's own origin changes every run."""
    try:
        raw = json.loads(tabs_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"tabs": [], "active": None}
    known = load()
    tabs = [t for t in raw.get("tabs", []) if isinstance(t, str) and t in known]         if isinstance(raw, dict) else []
    active = raw.get("active") if isinstance(raw, dict) else None
    return {"tabs": tabs, "active": active if active in tabs else None}


def save_tabs(tabs: list, active) -> None:
    known = load()
    tabs = [t for t in tabs if isinstance(t, str) and t in known][:32]
    state_dir().mkdir(parents=True, exist_ok=True)
    tmp = tabs_file().with_suffix(".tmp")
    tmp.write_text(json.dumps({"tabs": tabs, "active": active if active in tabs else None}),
                   encoding="utf-8")
    os.replace(tmp, tabs_file())


def port_open(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", port)) == 0


def listing() -> list[dict]:
    rows = []
    for target, e in load().items():
        user, _, host = target.partition("@")
        rows.append({"target": target, "user": user, "host": host, "name": e["name"] or host,
                     "ssh_port": e["ssh_port"], "port": e["port"], "open": port_open(e["port"])})
    rows.sort(key=lambda r: r["name"].lower())
    return rows


def upsert(user: str, host: str, ssh_port: int, name: str, was: str | None) -> str:
    """Add or edit one server; returns its target. A NEW one takes the first
    local port from 8701 that no server has and nothing listens on; an edited
    one keeps its port, so its zoom and layout (per origin) stay."""
    target = f"{user}@{host}"
    if not TARGET_RE.match(target):
        raise ValueError("address")
    if not 1 <= ssh_port <= 65535:
        raise ValueError("port")
    with _lock:
        entries = load()
        old = entries.pop(was, None) if was and was != target else entries.get(target)
        if was and was != target and old:
            close(was, entries_hint=old)
        if old:
            port = old["port"]
        else:
            taken = {e["port"] for e in entries.values()}
            port = FIRST_LOCAL_PORT
            while port in taken or port_open(port):
                port += 1
        entries[target] = {"port": port, "name": name.strip()[:64],
                           "ssh_port": ssh_port,
                           "remote_port": (old or {}).get("remote_port", DEFAULT_REMOTE_PORT)}
        save(entries)
    return target


def remove(target: str) -> None:
    with _lock:
        entries = load()
        entry = entries.pop(target, None)
        if entry:
            close(target, entries_hint=entry)
            save(entries)


# --- ssh ---------------------------------------------------------------------

def ssh_bin() -> str | None:
    found = shutil.which("ssh")
    if found:
        return found
    fallback = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "OpenSSH" / "ssh.exe"
    return str(fallback) if fallback.exists() else None


def _askpass() -> Path:
    """A helper that prints PCG_SSH_SECRET, the one channel OpenSSH takes a
    password from with no terminal. The password itself is only ever in the
    environment of the one ssh process that needs it."""
    state_dir().mkdir(parents=True, exist_ok=True)
    if sys.platform == "win32":
        path = state_dir() / "askpass.cmd"
        body = "@echo off\r\nsetlocal EnableDelayedExpansion\r\necho(!PCG_SSH_SECRET!\r\n"
    else:
        path = state_dir() / "askpass.sh"
        body = "#!/bin/sh\nprintf '%s\\n' \"$PCG_SSH_SECRET\"\n"
    if not path.exists() or path.read_text(encoding="ascii", errors="replace") != body:
        path.write_text(body, encoding="ascii", newline="")
        if sys.platform != "win32":
            os.chmod(path, 0o700)
    return path


def _base(target: str, password: str | None = None) -> tuple[list[str], dict]:
    ssh = ssh_bin()
    if not ssh:
        raise FileNotFoundError("ssh")
    e = load().get(target) or {}
    args = [ssh, "-o", f"ConnectTimeout={CONNECT_TIMEOUT}",
            "-o", "StrictHostKeyChecking=accept-new", "-p", str(e.get("ssh_port", 22))]
    env = dict(os.environ)
    if password is None:
        args += ["-o", "BatchMode=yes"]
    else:
        args += ["-o", "PubkeyAuthentication=no", "-o", "NumberOfPasswordPrompts=1"]
        env.update(SSH_ASKPASS=str(_askpass()), SSH_ASKPASS_REQUIRE="force",
                   PCG_SSH_SECRET=password, DISPLAY=env.get("DISPLAY", ":0"))
    return args, env


def run(target: str, script: str, password: str | None = None,
        stdin: bytes | None = None, timeout: float = 30) -> tuple[int, str, str]:
    """Run SCRIPT on the server with sh. With STDIN, the script is the
    command line; without, the script itself goes in on stdin (no quoting
    to get wrong on either side)."""
    args, env = _base(target, password)
    if stdin is None:
        args += [target, "sh", "-s"]
        stdin = script.replace("\r\n", "\n").encode("utf-8")
    else:
        args += [target, script]
    try:
        done = subprocess.run(args, input=stdin, capture_output=True, env=env,
                              timeout=timeout, creationflags=NO_WINDOW)
    except subprocess.TimeoutExpired:
        return 124, "", "timed out"
    return (done.returncode, done.stdout.decode("utf-8", "replace"),
            done.stderr.decode("utf-8", "replace"))


def classify(rc: int, err: str) -> str | None:
    """What went wrong, as one of the window's words, or None if nothing."""
    if rc == 0:
        return None
    low = err.lower()
    if "remote host identification has changed" in low or "host key verification failed" in low:
        return "hostkey"
    if "permission denied" in low:
        return "auth"
    if "could not resolve" in low or "name or service not known" in low:
        return "resolve"
    if "connection closed" in low or "connection reset" in low:
        return "penalty"
    if "timed out" in low or "no route" in low or "refused" in low or "unreachable" in low:
        return "unreachable"
    if rc == 124:
        return "unreachable"
    return "other"


PROBE = r"""
TOK="${XDG_CONFIG_HOME:-$HOME/.config}/persian-claude/token"
APP="${XDG_DATA_HOME:-$HOME/.local/share}/persian-claude/server.py"
[ -s "$TOK" ] && echo "token=$(head -n1 "$TOK")"
PF="${XDG_CONFIG_HOME:-$HOME/.config}/persian-claude/port"
UNIT="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/persian-claude.service"
if [ -s "$PF" ]; then echo "port=$(head -n1 "$PF")"
elif [ -f "$UNIT" ]; then echo "port=$(sed -n 's/.*--port \([0-9][0-9]*\).*/\1/p' "$UNIT" | head -n1)"; fi
[ -f "$APP" ] && echo "version=$(sed -n 's/.*"static-terminal".*"\([0-9][0-9.]*\)").*/\1/p' "$APP" | head -n1)"
C="$(command -v claude 2>/dev/null)"; [ -z "$C" ] && [ -x "$HOME/.local/bin/claude" ] && C="$HOME/.local/bin/claude"
echo "claude=$C"
echo "python=$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null)"
echo "service=$(systemctl --user is-active persian-claude 2>/dev/null)"
echo "host=$(hostname)"
"""


def _facts(target: str) -> tuple[str | None, list[str], dict]:
    """PROBE over a key login: (problem, stderr tail, facts). The server's own
    port, when it reports one, is written into the entry: a second user on
    the same box listens on 8766, and a tunnel to 8765 would land on the
    FIRST user's window."""
    rc, out, err = run(target, PROBE)
    problem = classify(rc, err)
    if problem:
        return problem, err.strip().splitlines()[-1:] or [""], {}
    facts = dict(line.split("=", 1) for line in out.splitlines() if "=" in line)
    port = facts.get("port", "")
    if port.isdigit() and 1 <= int(port) <= 65535:
        with _lock:
            entries = load()
            if target in entries and entries[target]["remote_port"] != int(port):
                entries[target]["remote_port"] = int(port)
                save(entries)
    return None, [], facts


def probe(target: str) -> dict:
    """What the server has, over a key login. Never returns the token."""
    problem, detail, facts = _facts(target)
    if problem:
        return {"ok": False, "error": problem, "detail": detail}
    python = facts.get("python", "")
    try:
        py_ok = tuple(int(p) for p in python.split(".")) >= (3, 10)
    except ValueError:
        py_ok = False
    return {"ok": True, "installed": bool(facts.get("token")) and bool(facts.get("version")),
            "version": facts.get("version") or None, "claude": bool(facts.get("claude")),
            "python": python or None, "python_ok": py_ok,
            "service": facts.get("service") or None, "hostname": facts.get("host") or None}


def key_path() -> Path:
    return Path.home() / ".ssh" / "id_ed25519"


def ensure_key() -> Path:
    """This PC's key, made once (no passphrase: the tunnel runs unattended)."""
    key = key_path()
    if not key.exists():
        key.parent.mkdir(parents=True, exist_ok=True)
        keygen = shutil.which("ssh-keygen") or str(Path(ssh_bin() or "ssh").with_name(
            "ssh-keygen.exe" if sys.platform == "win32" else "ssh-keygen"))
        subprocess.run([keygen, "-q", "-t", "ed25519", "-N", "", "-C",
                        f"persian-claude@{socket.gethostname()}", "-f", str(key)],
                       capture_output=True, timeout=30, creationflags=NO_WINDOW, check=True)
    return key.with_suffix(".pub")


ADD_KEY = ("umask 077; mkdir -p ~/.ssh; k=$(cat); "
           "grep -qxF \"$k\" ~/.ssh/authorized_keys 2>/dev/null || printf '%s\\n' \"$k\" >> ~/.ssh/authorized_keys")


def install_key(target: str, password: str) -> str | None:
    """Put this PC's public key on the server with the password, once.
    Returns None, or the reason it did not take."""
    try:
        pub = ensure_key().read_bytes().strip() + b"\n"
    except (OSError, subprocess.SubprocessError):
        return "keygen"
    rc, _, err = run(target, ADD_KEY, password=password, stdin=pub)
    problem = classify(rc, err)
    if problem:
        return problem
    rc, _, err = run(target, "true")
    return classify(rc, err)


def forget_host_key(target: str) -> None:
    """The server was reinstalled (or a VM got another's address): drop the
    old key so accept-new takes the new one. Only on the person's click."""
    host = target.partition("@")[2]
    e = load().get(target) or {}
    keygen = shutil.which("ssh-keygen") or "ssh-keygen"
    for name in (host, f"[{host}]:{e.get('ssh_port', 22)}"):
        subprocess.run([keygen, "-R", name], capture_output=True, timeout=15,
                       creationflags=NO_WINDOW)


# --- install on the server ---------------------------------------------------

LINUX_PAYLOAD = ("server.py", "install-linux.sh", "static-terminal", "assets")


def payload() -> bytes:
    """The app as install-linux.sh expects to find it beside itself, gzipped
    tar, LF scripts (a Windows checkout may hold CRLF)."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for name in LINUX_PAYLOAD:
            src = HERE / name
            if name.endswith(".sh"):
                data = src.read_bytes().replace(b"\r\n", b"\n")
                info = tarfile.TarInfo(name)
                info.size, info.mode, info.mtime = len(data), 0o755, int(time.time())
                tar.addfile(info, io.BytesIO(data))
            else:
                tar.add(src, arcname=name,
                        filter=lambda i: None if "__pycache__" in i.name or i.name.endswith(
                            ("_probe.html",)) else i)
    return buf.getvalue()


INSTALL = ('d=$(mktemp -d) && tar -xzf - -C "$d" && bash "$d/install-linux.sh" --yes; '
           'rc=$?; rm -rf "$d"; exit $rc')


class InstallJob:
    """One install per server at a time, its output kept for the window to
    poll (the way LoginFlow is polled)."""

    jobs: dict[str, "InstallJob"] = {}

    def __init__(self, target: str) -> None:
        self.target = target
        self.lines: list[str] = []
        self.rc: int | None = None

    @classmethod
    def start(cls, target: str) -> "InstallJob":
        with _lock:
            job = cls.jobs.get(target)
            if job and job.rc is None:
                return job
            job = cls.jobs[target] = InstallJob(target)
        threading.Thread(target=job._run, daemon=True).start()
        return job

    def _run(self) -> None:
        try:
            data = payload()
            args, env = _base(self.target)
            proc = subprocess.Popen(args + [self.target, INSTALL], stdin=subprocess.PIPE,
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                    env=env, creationflags=NO_WINDOW)
            threading.Thread(target=self._feed, args=(proc, data), daemon=True).start()
            for raw in proc.stdout:
                self.lines.append(raw.decode("utf-8", "replace").rstrip())
            self.rc = proc.wait(timeout=600)
        except Exception as err:                                  # noqa: BLE001
            self.lines.append(f"!! {err}")
            self.rc = 1

    @staticmethod
    def _feed(proc: subprocess.Popen, data: bytes) -> None:
        try:
            proc.stdin.write(data)
            proc.stdin.close()
        except OSError:
            pass

    def state(self) -> dict:
        return {"running": self.rc is None, "rc": self.rc, "lines": self.lines[-200:]}


# --- the tunnel and the window -----------------------------------------------

def _tunnel_pids(port: int) -> list[int]:
    """Every ssh process forwarding PORT, whoever started it (this window or
    connect.bat)."""
    pattern = f"-L {port}:127.0.0.1:"
    if sys.platform == "win32":
        script = ("Get-CimInstance Win32_Process -Filter \"Name = 'ssh.exe'\" | "
                  f"Where-Object {{ $_.CommandLine -like '*{pattern}*' }} | "
                  "ForEach-Object { $_.ProcessId }")
        encoded = base64.b64encode(script.encode("utf-16-le")).decode("ascii")
        done = subprocess.run(["powershell", "-NoProfile", "-NonInteractive",
                               "-EncodedCommand", encoded],
                              capture_output=True, text=True, timeout=30, creationflags=NO_WINDOW)
    else:
        done = subprocess.run(["pgrep", "-f", pattern], capture_output=True, text=True, timeout=10)
    return [int(p) for p in done.stdout.split() if p.isdigit()]


def close(target: str, entries_hint: dict | None = None) -> int:
    entry = entries_hint or load().get(target)
    if not entry:
        return 0
    pids = _tunnel_pids(entry["port"])
    for pid in pids:
        try:
            if sys.platform == "win32":
                subprocess.run(["taskkill", "/PID", str(pid), "/F"], capture_output=True,
                               timeout=10, creationflags=NO_WINDOW)
            else:
                os.kill(pid, 15)
        except (OSError, subprocess.SubprocessError):
            pass
    return len(pids)


def open_tunnel(target: str) -> str | None:
    """The tunnel up (it may already be), or the reason it is not."""
    entry = load().get(target)
    if not entry:
        return "unknown"
    if port_open(entry["port"]):
        return None
    args, env = _base(target)
    forward = f"{entry['port']}:127.0.0.1:{entry['remote_port']}"
    # Detached from this server: the tunnel belongs to the server's window,
    # which outlives the local window that opened it.
    subprocess.Popen(args + ["-N", "-o", "ExitOnForwardFailure=yes",
                             "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=3",
                             "-L", forward, target],
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                     stderr=subprocess.DEVNULL, env=env,
                     creationflags=NO_WINDOW | NEW_GROUP,
                     start_new_session=sys.platform != "win32")
    deadline = time.monotonic() + TUNNEL_TIMEOUT
    while time.monotonic() < deadline:
        if port_open(entry["port"]):
            return None
        time.sleep(0.3)
    return "tunnel"


def open_server(target: str, launch=None) -> dict:
    """Tunnel + the server's own app window (LAUNCH is server.launch_window),
    or, with no LAUNCH, the address for a tab in THIS window (js/hosts.js):
    the token goes only to the window of the person who could read it off
    the server with their own key anyway."""
    problem, _, facts = _facts(target)
    secret = facts.get("token", "")
    if problem or len(secret) < 32:
        return {"ok": False, "error": problem or "notinstalled"}
    problem = open_tunnel(target)
    if problem:
        return {"ok": False, "error": problem}
    port = load()[target]["port"]
    url = f"http://127.0.0.1:{port}/?t={secret}"
    if launch is None:
        return {"ok": True, "url": url, "port": port}
    launch(url)
    return {"ok": True}
