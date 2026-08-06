The offline install payload (M8-acceptance.md §0).

Put python-3.12.10-amd64.exe here:
  https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe
(~27 MB. setup.ps1 -Payload looks for python-3.12*-amd64.exe in this folder and
falls back to 3.12.9 / 3.12.8, so any of those three works.)

The installer is deliberately NOT committed -- .gitignore keeps *.exe out. This
folder is committed only so clean-machine-offline.wsb has something to map; an
absent HostFolder stops Windows Sandbox from starting at all.

Claude Code has no offline installer. Its own install.ps1 downloads a binary
from downloads.claude.ai, so on a machine that cannot reach that host `claude`
must already be present -- see M8-acceptance.md §0.
