#!/usr/bin/env bash
# Persian Claude, terminal edition, on a Linux machine (wiki/linux-ssh.md).
#
# Installs the app beside your real `claude` CLI and runs it as a systemd
# --user service (`server.py --serve`): it listens on 127.0.0.1 only, keeps one
# token in ~/.config/persian-claude/token, and keeps every conversation running
# when your SSH connection drops. Your window connects through an SSH tunnel
# (connect.bat on Windows). Safe to re-run: it updates in place.
#
#   ./install-linux.sh                 install or update, start the service
#   ./install-linux.sh --port 8800     a different port on this machine
#   ./install-linux.sh --desktop       also add a launcher to a Linux desktop
#   ./install-linux.sh --no-service    copy the files only
#   ./install-linux.sh --uninstall     stop the service, remove the app
#                                      (your ~/.claude and its chats stay)
set -euo pipefail

PORT=8765
SERVICE=1
DESKTOP=0
UNINSTALL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --desktop) DESKTOP=1; shift ;;
    --no-service) SERVICE=0; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/persian-claude"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT="$UNIT_DIR/persian-claude.service"
LAUNCHER="${XDG_DATA_HOME:-$HOME/.local/share}/applications/persian-claude.desktop"
TOKEN_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/persian-claude/token"

say() { printf '==> %s\n' "$*"; }
warn() { printf '!!  %s\n' "$*" >&2; }
have_user_systemd() { command -v systemctl >/dev/null && systemctl --user show-environment >/dev/null 2>&1; }

if [ "$UNINSTALL" = 1 ]; then
  if have_user_systemd && [ -f "$UNIT" ]; then
    systemctl --user disable --now persian-claude.service || true
    rm -f "$UNIT"
    systemctl --user daemon-reload
  fi
  rm -f "$LAUNCHER"
  rm -rf "$DEST"
  say "removed. Kept: ~/.claude (your chats) and $TOKEN_FILE"
  exit 0
fi

# 1. Python 3.10+, by absolute path: a service has no login shell to find it.
PY="$(command -v python3 || true)"
if [ -z "$PY" ]; then
  warn "python3 not found. Install it (e.g. sudo apt install python3), then re-run."
  exit 1
fi
PY="$(readlink -f "$PY")"
if ! "$PY" -c 'import sys; sys.exit(sys.version_info < (3, 10))'; then
  warn "$("$PY" --version) is too old: 3.10 or newer is needed."
  exit 1
fi
say "python: $PY ($("$PY" --version 2>&1))"

# 2. The real Claude Code CLI. Its own installer, its own login: this app
#    never reimplements either.
CLAUDE="$(command -v claude || true)"
[ -z "$CLAUDE" ] && [ -x "$HOME/.local/bin/claude" ] && CLAUDE="$HOME/.local/bin/claude"
if [ -z "$CLAUDE" ]; then
  warn "the claude CLI is not installed."
  printf 'Install it now with the official installer (curl -fsSL https://claude.ai/install.sh | bash)? [y/N] '
  read -r answer
  case "$answer" in
    y|Y) curl -fsSL https://claude.ai/install.sh | bash
         CLAUDE="$HOME/.local/bin/claude" ;;
    *) warn "install claude, then re-run."; exit 1 ;;
  esac
fi
say "claude: $CLAUDE ($("$CLAUDE" --version 2>/dev/null || echo '?'))"

# 3. The files. The json lists beside server.py (recents, pins, names) are
#    yours: only the code is replaced.
mkdir -p "$DEST"
cp "$SRC/server.py" "$DEST/server.py"
rm -rf "$DEST/static-terminal" "$DEST/assets"
cp -R "$SRC/static-terminal" "$DEST/static-terminal"
cp -R "$SRC/assets" "$DEST/assets"
say "app: $DEST"

# 4. The service.
if [ "$SERVICE" = 1 ]; then
  if ! have_user_systemd; then
    warn "no systemd --user here. Start it by hand instead:"
    echo "    nohup $PY $DEST/server.py --serve --port $PORT --ui terminal --cwd \$HOME >/dev/null 2>&1 &"
  else
    mkdir -p "$UNIT_DIR"
    cat > "$UNIT" <<EOF
[Unit]
Description=Persian Claude (terminal edition) for windows over SSH
After=network.target

[Service]
ExecStart=$PY $DEST/server.py --serve --port $PORT --ui terminal --cwd %h
Environment=PYTHONIOENCODING=utf-8
Environment=PATH=$(dirname "$CLAUDE"):$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
EOF
    systemctl --user daemon-reload
    systemctl --user enable persian-claude.service >/dev/null
    systemctl --user restart persian-claude.service
    say "service: persian-claude.service (systemctl --user status persian-claude)"
    # Without linger, systemd stops every --user service when your last SSH
    # session ends -- exactly the drop this mode exists to survive.
    if [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null || echo no)" != "yes" ]; then
      if loginctl enable-linger "$USER" 2>/dev/null; then
        say "linger on: the service keeps running after you log out"
      else
        warn "could not turn on linger. Without it the service stops when you log out:"
        echo "    sudo loginctl enable-linger $USER"
      fi
    fi
    for _ in 1 2 3 4 5 6 7 8 9 10; do [ -s "$TOKEN_FILE" ] && break; sleep 0.5; done
  fi
fi

# 5. A Linux desktop: a launcher that opens the window on THIS machine
#    (native dialogs, closes with its window), like the Windows shortcut.
if [ "$DESKTOP" = 1 ]; then
  mkdir -p "$(dirname "$LAUNCHER")"
  cat > "$LAUNCHER" <<EOF
[Desktop Entry]
Type=Application
Name=Persian Claude
Name[fa]=کلاد فارسی — ترمینال
Exec=$PY $DEST/server.py --ui terminal --quiet --cwd $HOME
Icon=$DEST/assets/icon.ico
Terminal=false
Categories=Development;
EOF
  say "launcher: $LAUNCHER"
fi

echo
say "done. From Windows:  connect.bat $USER@$(hostname)$( [ "$PORT" != 8765 ] && echo " -RemotePort $PORT")"
say "by hand:  ssh -N -L $PORT:127.0.0.1:$PORT $USER@$(hostname)"
say "          then open http://127.0.0.1:$PORT/?t=<the line in $TOKEN_FILE>"
say "sign in once on this machine if you have not: claude  (or /login in the window)"
