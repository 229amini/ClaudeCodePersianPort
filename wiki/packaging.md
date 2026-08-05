# Packaging and bootstrap (M7)

Built and verified 2026-08-04. `setup.bat` → `setup.ps1` installs prerequisites, deploys the app,
writes `run.vbs` and a desktop shortcut, and ends with a live smoke test.

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
2. **`run.vbs` must be UTF-16LE WITH BOM.** `wscript` reads a BOM-less `.vbs` as ANSI. It does not
   matter for the ASCII comment — it matters because the **baked-in paths** would mangle on a
   machine whose Windows username is not ASCII, which for this project's audience is entirely
   plausible.
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

- **Shortcut targets `wscript.exe`** with the `.vbs` path as an argument, rather than pointing
  `TargetPath` at the `.vbs` directly — more reliable across shell configurations.
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
| `run.vbs` launch | `pythonw` running, **0 console windows** |
| Edge | `msedge.exe --app=http://127.0.0.1:<port>/?t=<token>` window opened |
| close the window | server exited within 16 s, **no orphaned `claude` process** |
| smoke test | passed — real CLI round-trip through the deployed copy |
| Persian-named `.lnk` on a 1252-codepage machine | fails without the rename workaround, see rule 4 above — passes with it |
| fresh `git clone` → `setup.ps1` twice (2026-08-05, Phase 6 exit) | both runs exit 0, one shortcut, target verified via `Shell.Application` — the tracked file set is enough to install from |

## NOT verified here — needs a bare machine (M8)

These branches never executed because this PC already has both:

- the **Python install** path (download, silent install, re-detect)
- the **Claude Code install** path (`irm https://claude.ai/install.ps1 | iex`)
- the **`-Payload` offline** path
- the **not-logged-in** flow, which prints Persian instructions to run `claude` once and re-run
  setup. Login genuinely cannot be automated; this is the single manual step the plan allows.

Do not claim M7 is proven end-to-end until it has run on a machine with nothing installed.
