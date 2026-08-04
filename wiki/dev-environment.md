# Dev environment — this machine (author PC)

Probed 2026-08-04. This is the **author's** PC (`ladyg`), not the colleague's target machine.
Re-run the probe on the target before M8; nothing here transfers automatically.

| Item | Result |
|---|---|
| OS | Windows 10 Home 19045 |
| `claude` | 2.1.221 at `C:\Users\ladyg\.local\bin\claude.exe` |
| node / npm | not installed |
| cargo / rustc / uv | not installed |
| VS Code (`code`) | not installed |
| **winget** | **NOT AVAILABLE** — see below |
| WebView2 | 138.0.3351.121 |
| `msedge.exe` | present, x86 path only: `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` |
| Python | **installed by this project** — see below |
| git | **installed by this project** 2026-08-04 — see below |

## winget is missing, and the Store-stub trap is real

`winget` resolves nowhere and `winget.exe` is absent from
`%LOCALAPPDATA%\Microsoft\WindowsApps`. The `Microsoft.DesktopAppInstaller` package *is* present
(1.0.30251.0, status Ok) but that build predates the winget executable.

Consequence: **`setup.ps1` cannot rely on winget on Windows 10 images.** Plan §0.5 step 2 already
specified a direct-download fallback; on this machine that fallback is the *only* path, so it is
the primary code path, not an edge case. Test it first, not second.

`WindowsApps` contained only `python.exe`, `python3.exe`, `python3.7.exe` — all Store alias stubs.
Running `python --version` printed *"Python was not found but can be installed from the Microsoft
Store"*. This is exactly the shadowing the plan warns about.

## Python install that worked

```powershell
# 26,964,224 bytes
Invoke-WebRequest -Uri "https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe" `
  -OutFile python-3.12.10-amd64.exe -UseBasicParsing
Start-Process -FilePath .\python-3.12.10-amd64.exe -Wait -PassThru -ArgumentList `
  "/quiet","InstallAllUsers=0","PrependPath=1","Include_test=0","Include_launcher=1"
```

Exit code 0, no admin prompt, no reboot. Lands at:

```
C:\Users\ladyg\AppData\Local\Programs\Python\Python312\python.exe
C:\Users\ladyg\AppData\Local\Programs\Python\Python312\pythonw.exe
```

**Use those absolute paths.** `PrependPath=1` does not help the current shell, and the Store stub
still shadows `python` in any session whose PATH was resolved earlier — the exact reason
CLAUDE.md requires an absolute interpreter path in `run.vbs`.

3.12.9 and 3.12.8 also exist on the FTP mirror; 3.12.10 was the newest 3.12.x available and is
what `setup.ps1` should pin (with a fallback loop, since python.org prunes old point releases).

## git install that worked

Also absent on this machine. Installed user-scope, no admin, from the official Git for Windows
release (resolved via the GitHub releases API so it does not pin a stale version):

```powershell
$api   = Invoke-RestMethod "https://api.github.com/repos/git-for-windows/git/releases/latest"
$asset = $api.assets | Where-Object { $_.name -match '^Git-.*-64-bit\.exe$' } | Select-Object -First 1
Invoke-WebRequest $asset.browser_download_url -OutFile git-installer.exe -UseBasicParsing
# /LOADINF supplies the answers the silent installer would otherwise prompt for
Start-Process .\git-installer.exe -Wait -ArgumentList `
  "/VERYSILENT","/NORESTART","/NOCANCEL","/SP-","/LOADINF=`"$PWD\git.inf`""
```

`git.inf` set `Dir=%LOCALAPPDATA%\Programs\Git`, `PathOption=Cmd`, `DefaultBranchOption=main`,
`CRLFOption=CRLFCommitAsIs`.

Lands at `C:\Users\ladyg\AppData\Local\Programs\Git\cmd\git.exe` (2.55.0). **`PathOption=Cmd`
only affects new shells** — an already-running session still needs the absolute path, the same
trap as Python.

`CRLFCommitAsIs` matters here: `setup.ps1` must keep its UTF-8 BOM and `run.vbs` its UTF-16LE,
and line-ending rewriting is the kind of thing that quietly breaks them. Verified after the first
commit that the committed blob still carries `EF BB BF` and correct Farsi yeh (U+06CC), and that
the fonts and icon are byte-identical.

## Running the wrapper in dev

```powershell
$env:PYTHONIOENCODING = "utf-8"
& "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" `
    "C:\Users\ladyg\Desktop\Claude\persian-claude-gui\server.py" --cwd <project> --no-window
```

`--no-window` skips the Edge launch so the server can be driven from a script. It prints the
tokenised URL on stdout; the smoke test scrapes it with
`re.search(r"(http://127\.0\.0\.1:\d+/\?t=[\w\-]+)", line)`.

Set `PYTHONIOENCODING=utf-8` when driving it from PowerShell, or Persian in the console output
mojibakes.
