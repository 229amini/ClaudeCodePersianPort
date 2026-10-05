The offline install payload (M8-acceptance.md §0).

Put two files here:

  python-3.12.10-amd64.exe
    https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe
    (~27 MB. setup.ps1 -Payload looks for python-3.12*-amd64.exe, so 3.12.9 /
    3.12.8 work too.)

  claude.exe
    Copy it from a machine that already has Claude Code:
    %USERPROFILE%\.local\bin\claude.exe (~250 MB, one self-contained binary,
    Windows x64). setup.ps1 copies it to the same place on the target. The CLI
    updates itself later, once it is online.

Neither file is committed -- .gitignore keeps *.exe out. This folder is
committed only so clean-machine-offline.wsb has something to map; an absent
HostFolder stops Windows Sandbox from starting at all.

The app itself still needs the internet to talk to Claude, and logging in
needs it once. -Payload is for a machine where the DOWNLOADS are blocked
(python.org, downloads.claude.ai and its region check), not for one that is
never online.
