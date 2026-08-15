# Dev environment — this machine (author PC)

> **The repo moved machines on/before 2026-08-05.** Everything below the "Second author PC"
> section was measured on `ladyg` and no longer describes where you are running. In particular
> **the `Python312` path in every older command in this repo is wrong now.** Read the next
> section first.

## Second author PC — current, measured 2026-08-05

| Item | Result |
|---|---|
| OS | Windows 11 Pro 26200 |
| repo root | `D:\projects\Claude` (was `C:\Users\ladyg\Desktop\Claude`) |
| user profile | `C:\Users\Lion` |
| **Python** | **`C:\Python314\python.exe` (3.14.0)** — machine-wide, NOT under `%LOCALAPPDATA%\Programs\Python` |
| `msedge.exe` | present, x86 path only: `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` |
| node / npm | npm present (`bd` installs through it); no node needed by this project |
| Claude-in-Chrome extension | **connected as of 2026-08-05** — see below; it was unavailable before that |

Consequences, all of which cost time to rediscover:

- `%LOCALAPPDATA%\Programs\Python\Python312\python.exe` **does not exist here**; only `Python38`
  is under that root. Commands copied from CLAUDE.md or older wiki files fail with
  *"No such file or directory"*. Use `C:\Python314\python.exe`, or plain `python` — on this
  machine it resolves to 3.14 and is **not** a Store stub (that trap was `ladyg`-specific).
- There is still no node, so no Playwright. That is why `run_spec_test.py` drives Edge directly.
- **Headless `--screenshot` is a dead end — do not re-walk it.** `msedge --headless=new
  --screenshot` produces a uniformly blank `--bg`-coloured PNG for both `index.html` and
  `spec-test.html`, with or without an open SSE stream, with or without
  `--virtual-time-budget`. `--dump-dom` on the same command line works fine —
  **but only on pages without an open SSE stream**: `--dump-dom` on the real `index.html` hangs
  forever because `EventSource` keeps the load pending (measured 2026-08-14, incl. with
  `--timeout`). `spec-test.html` dumps fine — that is exactly what `data-render-only` exists for.

## Seeing the running app: the Chrome extension works now (2026-08-05)

For M0–M7 there was no way to *look* at the UI at all, and much of the project's caution is a
consequence of that. The Claude-in-Chrome MCP tools now drive the real app, and the first session
that used them caught two defects the 18/18 spec gate cannot see (garbage session titles, a hover
card overlapping the pane it explains). Use it — it is not a substitute for the spec gate, it
catches a different class of bug.

Four things that will otherwise waste a session:

1. **The server dies before you can look at it.** The idle watchdog kills it ~10 s after the last
   SSE client leaves, so `server.py --no-window` in a background shell is gone by the time the
   browser navigates. Boot it the way `run_spec_test.py` does — subprocess + a thread holding one
   `GET /api/events` open — and only then navigate. Symptom otherwise: the tab shows an error page
   while `Invoke-WebRequest` on the same URL still returns 200, because the server died in between.
2. **Pick the right browser.** `list_connected_browsers` can list more than one; a stale entry from
   another machine accepts `select_browser` and then reports *"Frame with ID 0 is showing error
   page"* for every single page. That message means wrong browser far more often than it means
   broken page.
3. **The token is single-use per boot** — it changes every restart, so re-read the URL from the
   server's stdout after every restart rather than reusing the last one.
4. `target="_blank"` navigations (the «راهنما» button) open a tab the extension cannot always
   address. Navigate the main tab to `/static/help.html?t=…` instead of chasing the popup.

Four more, all measured 2026-08-06 during the §4/§5 acceptance pass:

5. **Click coordinates are CSS-viewport pixels; screenshots are not.** The window reports
   `innerWidth` 2032 but a screenshot comes back 1568 wide (~0.77×). Reading a button's position
   off the screenshot and clicking it lands ~300 px away — silently, on the modal backdrop, with
   no error. Always take the target from `getBoundingClientRect()` via `javascript_tool` and click
   that. This burned one paid turn.
6. **The permission dialog self-destructs in 110 s** (`PERMISSION_TIMEOUT`, server.py). Every
   screenshot round-trip costs 5–30 s, so open→look→click→look blows the budget and the broker
   auto-denies; the client then closes the dialog without ever calling `resolvePermission`, so
   there is no `/api/permission/respond` in the log and it looks like the button did nothing.
   Answer it from *inside* one `javascript_tool` call (poll for `#perm.open`, then
   `#perm-allow.click()`), and take the screenshots for the visual check on a separate request.
7. **The `hover` action does not produce `:hover`.** The session preview card checks
   `row.matches(":hover, :focus")` after its 300 ms timer and never fired. `row.focus()` drives the
   same code path. Note the card hides again on blur, which the next tool call triggers — pin it
   with `Object.defineProperty(card, "hidden", {set(){}, get:()=>false})` before screenshotting.
8. **`javascript_tool` refuses to return anything that looks like a token or a query string** —
   `[BLOCKED: Cookie/query string data]`. Returning the log's `textContent` trips it. Return shapes
   and computed styles, not raw page text.

## First author PC (`ladyg`) — historical, probed 2026-08-04

Kept for the install-branch evidence (winget absence, the Store-stub trap, the exact Python and
git installers that worked). Re-run the probe on the colleague's target before M8; nothing here
transfers automatically.

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
CLAUDE.md requires an absolute interpreter path in the generated shortcut.

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

`CRLFCommitAsIs` matters here: `setup.ps1` must keep its UTF-8 BOM (`run.vbs` had a UTF-16LE rule
too, until it was deleted 2026-08-07), and line-ending rewriting is the kind of thing that quietly
breaks that. Verified after the first
commit that the committed blob still carries `EF BB BF` and correct Farsi yeh (U+06CC), and that
the fonts and icon are byte-identical.

## Running the wrapper in dev

```powershell
$env:PYTHONIOENCODING = "utf-8"
& "C:\Python314\python.exe" `
    "D:\projects\Claude\persian-claude-gui\server.py" --cwd <project> --no-window
```

(On `ladyg` this was `$env:LOCALAPPDATA\Programs\Python\Python312\python.exe` and a Desktop path.)

`--no-window` skips the Edge launch so the server can be driven from a script. It prints the
tokenised URL on stdout; the smoke test scrapes it with
`re.search(r"(http://127\.0\.0\.1:\d+/\?t=[\w\-]+)", line)`.

Set `PYTHONIOENCODING=utf-8` when driving it from PowerShell, or Persian in the console output
mojibakes.
