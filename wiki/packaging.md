# Packaging and bootstrap (M7)

Built and verified 2026-08-04. `setup.bat` → `setup.ps1` installs prerequisites, deploys the app,
writes a desktop shortcut, and ends with a live smoke test.

```powershell
.\setup.ps1                        # normal
.\setup.ps1 -Payload D:\usb        # offline: installers from a folder
.\setup.ps1 -DeployRoot C:\tmp\x -ProjectDir ... -ShortcutDir ... -SkipSmokeTest   # testing
```

`-DeployRoot` / `-ProjectDir` / `-ShortcutDir` exist so the whole thing can be exercised without
touching the real install or dropping a broken shortcut on the desktop. Use them.

## Three encoding rules, each of which silently corrupts Persian

These are the whole reason M7 is fiddly. All three fail *quietly*.

1. **`setup.ps1` must be UTF-8 WITH BOM.** Windows PowerShell 5.1 reads a BOM-less script as the
   system ANSI codepage, turning every Persian string in it into mojibake. After any edit that
   strips the BOM, restore it:
   ```powershell
   $t = [IO.File]::ReadAllText($f, [Text.Encoding]::UTF8)
   [IO.File]::WriteAllText($f, $t, (New-Object Text.UTF8Encoding($true)))
   ```
2. ~~`run.vbs` must be UTF-16LE WITH BOM.~~ **Gone 2026-08-07 — there is no `run.vbs` any more.**
   The launcher was a one-line VBScript run through `wscript.exe`; on a clean Windows 11 image the
   shortcut died with «There is no script engine for file extension ".vbs"», because VBScript is
   deprecated and its engine is a Feature-on-Demand fresh installs need not carry. The shortcut now
   targets `pythonw.exe` directly — a GUI-subsystem binary, so it allocates no console by itself,
   which is all the VBScript ever bought. Rule kept here only so nobody reintroduces the file.
3. **`.lnk` Description is ANSI-lossy.** Writing Persian there silently rewrites ی (U+06CC, Farsi
   yeh) as ي (U+064A, Arabic yeh) — subtly wrong Persian, the exact failure this project exists to
   avoid. The description is therefore ASCII.
4. **`WshShell.CreateShortcut(path).Save()` is ANSI-lossy on the path too**, not just the
   Description — found 2026-08-05 on a machine whose system codepage is Western European (1252),
   which has no Persian glyphs at all. Calling `CreateShortcut("...\کلود.lnk")` then `.Save()`
   throws `FileNotFoundException`, and the exception text itself shows the mangled path
   (`????.lnk`) — the COM Automation layer downgrades the BSTR to ANSI before touching the
   filesystem, independent of the `.ps1` file's own encoding (that part was already correct,
   UTF-8 BOM verified intact). NTFS itself has no problem with Persian filenames — proof was
   sitting on the same Desktop, a Persian-named `.lnk` created by some other installer. The fix:
   `CreateShortcut`+`Save()` under an ASCII working name (`claude-launcher.lnk`), then
   `Rename-Item` to the Persian name — a plain NTFS rename with no COM/ANSI round-trip. This is
   what `setup.ps1`'s shortcut step now does; do not revert it to a direct `CreateShortcut` call
   with a Persian path.

   Two consequences found 2026-08-05 while testing Phase 6's fresh-clone exit criterion:

   - **`Rename-Item -Force` does not overwrite an existing destination.** `-Force` only unblocks a
     read-only/hidden *source*. The second `setup.ps1` run therefore died with "Cannot create a
     file when that file already exists" and left `claude-launcher.lnk` next to the Persian one —
     two icons for one app, and a non-zero exit from an installer that is supposed to be
     re-runnable. The step now `Remove-Item`s the old shortcut before renaming.
   - **Reading the shortcut back with `WScript.Shell` lies.** `$wsh.CreateShortcut('…\کلاد
     فارسی.lnk')` returns an object with empty `TargetPath`/`Arguments` — the same ANSI
     downgrade, now on the read side, so it silently hands back a blank new shortcut instead of
     the existing one. A raw byte scan of the `.lnk` is also inconclusive (mixed ANSI/UTF-16
     string sections). To verify a Persian-named shortcut, use `Shell.Application`:
     ```powershell
     $l = (New-Object -ComObject Shell.Application).NameSpace($dir).ParseName($name).GetLink
     $l.Path; $l.Arguments; $l.WorkingDirectory
     ```

## Other decisions

- **Shortcut targets `pythonw.exe`** with `server.py --cwd <project>` as its arguments
  (2026-08-07). It used to target `wscript.exe` + a generated `run.vbs`; see rule 2 for why that
  whole layer is gone. Read it back with `Shell.Application`, never `WScript.Shell`.
- **Absolute interpreter path**, always. `python` on PATH is the Store alias stub, and a PATH
  change from an installer never reaches the already-running shell. `setup.ps1` re-detects the
  interpreter by filesystem path after installing rather than trusting `Get-Command`.
- **winget is not used at all.** It is absent on this machine (see `dev-environment.md`), so the
  direct download from python.org is the primary path with a version fallback list
  (3.12.10 → 3.12.9 → 3.12.8), since python.org prunes old point releases.
- **Log falls back to `%TEMP%`** if the script's own folder is not writable — the offline
  `-Payload` case runs from a USB stick that may be read-only.
- **The 8.3 short-name check is gone** (2026-08-05). It existed because a space in `$DeployRoot`
  or the Python path silently disabled tool approvals through the `PreToolUse` hook command. That
  hook was deleted — approvals now ride the CLI's own stdin pipe
  (`permission-transport.md`) — so spaces in install paths are ordinary again. A username with a
  space is no longer a packaging hazard.
- **Icon** is generated by a stdlib script (PNG embedded in an ICO container — legal since Vista
  and far simpler than a DIB with an AND mask). The generator was missing from the repo until
  2026-08-05, which made the icon effectively un-regenerable; it is now
  `assets/make_icon.py` — run it after any change to the mark. Six sizes (16…256), coral tile,
  the «کلاد فارسی» mark. Anti-aliasing is analytic (signed distance → coverage), one sample per
  pixel, so no image library is needed.
- **The mark is duplicated on purpose** — the same 24×24 geometry lives in `make_icon.py`
  (`SEGMENTS`) and in `static/index.html` (two inline SVGs, sidebar + greeting). Edit all three or
  the desktop icon stops matching the one in the window.
- **Rebrand, 2026-08-05:** the product is «کلاد فارسی», never «کلود» (the old spelling is gone from
  the UI) and never Anthropic's Claude mark. The desktop shortcut is now `کلاد فارسی.lnk`;
  `setup.ps1` deletes a leftover `کلود.lnk` so a re-run over an old install leaves one icon, not
  two. The `.lnk` `Description` stays ASCII — it round-trips through an ANSI codepage and would
  rewrite Persian ی (U+06CC) as Arabic ي.

## Verified on this machine

| check | result |
|---|---|
| `setup.ps1` run twice back to back | idempotent, second run clean |
| deployed tree | server, hook, smoke test, `static/` incl. fonts + vendor, `assets/` |
| shortcut launch | `pythonw` running, **0 console windows** (re-verified 2026-08-07 with the direct `pythonw.exe` target) |
| Edge | `msedge.exe --app=http://127.0.0.1:<port>/?t=<token>` window opened |
| close the window | server exited within 16 s, **no orphaned `claude` process** |
| smoke test | passed — real CLI round-trip through the deployed copy |
| Persian-named `.lnk` on a 1252-codepage machine | fails without the rename workaround, see rule 4 above — passes with it |
| fresh `git clone` → `setup.ps1` twice (2026-08-05, Phase 6 exit) | both runs exit 0, one shortcut, target verified via `Shell.Application` — the tracked file set is enough to install from |

## Two ways a never-executed branch dies silently (both found 2026-08-05, Phase 7)

Both are PowerShell 5.1 semantics, both were live in the shipped script, and neither could ever
show up on this PC because the branches that trigger them need a machine without Python/claude.

**1. `$ErrorActionPreference = 'Stop'` turns a native command's stderr into a terminating error.**
`& $python $smoke 2>&1 | ForEach-Object { Log $_ }` aborts the whole script on the *first* stderr
line, as a `NativeCommandError`. Consequence: on a not-logged-in machine — the single most likely
state of the colleague's PC — the smoke test's Python traceback killed `setup.ps1` at the last
step, so the **Persian login instructions never printed**. The user saw a red English stack trace
and no «نصب تمام شد». A/B verified on the real script with a stub `smoke_test.py` that writes to
stderr and exits 1.

Redirecting to a file (`2>$err`) does **not** avoid it — tested, same error. The fix is to drop the
preference to `Continue` around that one call and restore it after, capturing `$LASTEXITCODE` into
a variable before anything else can overwrite it. Applied at both native call sites.

**2. `Invoke-Expression` runs the vendor installer in *this* scope.**
`Invoke-Expression (Invoke-RestMethod 'https://claude.ai/install.ps1')` was the claude-install
branch. Reading that script (2026-08-05) shows two things it does to its caller:

- every failure path ends in a top-level `exit 1` — verified that an `exit` inside `Invoke-Expression`
  terminates the calling script immediately, **without running the surrounding `catch`**;
- it sets `Set-StrictMode -Version Latest`, which then governs every later step of `setup.ps1`, on
  the success path too.

Now spawned as a child `powershell -NoProfile -Command "irm … | iex"` with its exit code checked.
Nothing about a vendor script's control flow can reach us. Do not revert it to `Invoke-Expression`
for tidiness.

Two smaller ones fixed alongside: the Python installer's exit code **3010** (`REBOOT_REQUIRED`) was
treated as failure, and a `-Payload` folder that is missing or has no installer fell through to a
download in silence — on a blocked network that surfaces as «دانلود ناموفق», pointing at the wrong
problem.

## Clean-VM kit

`clean-machine.wsb` at the repo root maps `persian-claude-gui/` read-only onto a Windows Sandbox
desktop. Sandbox needs one elevated enable + reboot
(`DISM /Online /Enable-Feature /FeatureName:Containers-DisposableClientVM /All`); this PC has the
firmware virtualization for it. Read-only is deliberate — it also exercises the log's `%TEMP%`
fallback. The checklist is `M8-acceptance.md` §0.5.

## Run A executed — clean sandbox, 2026-08-06/07

Two of the three remaining branches are no longer theoretical. In a fresh Windows Sandbox
(`clean-machine.wsb`, nothing installed, `probe` reported all seven tools NOT FOUND):

- **Python install** — downloaded 3.12.10, installed silently to
  `%LOCALAPPDATA%\Programs\Python\Python312`, and was **re-detected by path** on the next step.
  The re-detect is load-bearing exactly as commented: the installer's `PrependPath=1` does not
  reach the running script, and even a *later, brand-new* console still reported
  `probe claude => NOT FOUND` (see below), so nothing here may lean on PATH.
- **Claude Code install** — the child-process call worked, output echoed and logged, exit 0,
  version 2.1.223 at `%USERPROFILE%\.local\bin\claude.exe`, and setup **continued past it**. The
  vendor installer prints its own warning that `.local\bin` is not on PATH and it is right:
  `Get-Command claude` still failed afterwards. Only the `$local` fallback in step 3 found it.
  Deleting that fallback would break every fresh install while looking harmless on this PC.
- Four consecutive runs, all idempotent: one shortcut, same deploy root, no prompts.

**The defect Run A found: the smoke test passed while the CLI was not logged in.** A CLI with no
credentials answers `result` with subtype **success**, `is_error` unset, cost 0 and the body
`Not logged in · Please run /login`. `smoke_test.py`'s first check was `"turn completed": ok`,
where `ok` only meant *a `result` event arrived* — so it printed `RESULT: PASS`, `setup.ps1` printed
«آزمایش موفق بود», and the Persian login instructions never printed on a machine where the wrapper
cannot work at all. That is the exact failure the 2026-08-05 stderr fix was supposed to expose; it
was verified against a *stub* smoke test that exits 1, which the real one never did.
Fixed 2026-08-07: the check now asserts the answer (`PONG` in the `result` body, `is_error` false),
not the envelope. 10 checks now. **Rule: never gate on an event's arrival when its body carries the
outcome** — the same class of lie as the control-protocol acks in `wiki/control-protocol.md`.
Re-run in the same not-logged-in sandbox: FAIL → Persian login steps → «نصب تمام شد».

**The second defect Run A found: the shortcut could not launch anything.** Clicking «کلاد فارسی»
on the sandbox desktop raised «There is no script engine for file extension ".vbs"». The launcher
was a generated `run.vbs` executed by `wscript.exe`, and VBScript is deprecated — on current
Windows images the engine is a Feature-on-Demand that need not be installed. It works on the
author's PC and on any machine old enough to still carry the engine, which is precisely why seven
milestones passed over it. `pythonw.exe` is a GUI-subsystem binary that allocates no console by
itself, which was the VBScript's only job, so the shortcut now targets it directly with
`server.py --cwd <project>` as arguments. Re-verified on the host: two idempotent installs into a
test root, `Shell.Application` reads back `pythonw.exe` + the right arguments, the shortcut starts
the server with **no** console window, Edge opens the app window, and closing it takes down both
the server and its `claude` child.

## The launcher's third failure: pythonw.exe has no stderr (2026-08-07)

Replacing `run.vbs` with a direct `pythonw.exe` shortcut immediately produced the next
launcher-only bug, and it was reported the same night: clicking «کلاد فارسی» opened an Edge window
showing **ERR_EMPTY_RESPONSE** — the server accepted the TCP connection and closed it without
writing a byte. Nothing was logged, because the thing that crashed *was* the logging.

`pythonw.exe` is a GUI-subsystem binary with no console, so **`sys.stderr` is `None`**. The
shortcut passes no `--quiet`, so the server ran with `verbose=True`, and `Handler.log_message`
does a bare `sys.stderr.write`. `BaseHTTPRequestHandler.send_response` calls `log_request` →
`log_message` *before* the status line is flushed, so the `AttributeError` killed the handler
thread with zero bytes written. Every request died the same way, including the first `GET /`.

Two details that make this class hard to see:

- **`print()` is not affected.** CPython's `print` returns silently when `sys.stdout` is `None`,
  so the two `[server]` startup prints never raised and never hinted at the problem. Only the
  direct `.write` did.
- **Every test in the repo ran the server under `python.exe`**, where stderr exists — `smoke_test.py`
  spawns it with `sys.executable`. The 21/21 spec gate, the smoke test and the transcript guard were
  all green while the shipped launcher served nothing at all.

Fixed in `main()`, at the one place `verbose` is computed:
`verbose=not args.quiet and sys.stderr is not None`. No console → no logging, and the whole
verbose-gated path stays consistent instead of guarding one call site.

`test_no_console.py` is the check that would have caught it, and it costs nothing: spawn
`pythonw.exe server.py --no-window`, find the listening port via `netstat -ano` filtered by PID
(there is no stdout to read the URL from — that is the point), and assert an unauthenticated
`GET /` comes back **403**, not a dropped socket. Verified red against the pre-fix `server.py`
(`RemoteDisconnected`) and green after. `setup.ps1` now runs it as step 5.5, before the paid smoke
test and gating it: it is free, independent of login, and it is the only step that exercises the
binary the colleague actually double-clicks.

**Rule: the launcher is a separate interpreter from the one every test uses.** Two of the three
launcher bugs so far were invisible to a fully green test suite for exactly that reason.

## NOT verified anywhere — still needs a bare machine (M8)

- the **`-Payload` offline** path. Note it covers **Python only**: Claude Code has no offline
  installer, `install.ps1` downloads its binary from `downloads.claude.ai` and has an explicit
  region check.

The **not-logged-in** flow is proven: re-run in the same not-logged-in sandbox right after the fix
(2026-08-07), the real `smoke_test.py` failed, `setup.ps1` printed «آزمایش ناموفق بود» plus the
three numbered Persian login steps, no English stack trace, and still ended with «نصب تمام شد».
The 2026-08-05 run of this path used a *stub* smoke test that exits 1 — which is why the real
one's false PASS survived two days. A stub proves the caller's error handling, never the check.
Login itself still cannot be automated; that is the single manual step the plan allows.

Do not claim M7 is proven end-to-end until it has run on a machine with nothing installed.
