# Contributing

Be decent to each other. That is the whole code of conduct.

## The rules that are not negotiable

**Stdlib only.** No npm, no build step, no CDN, no new Python dependency. `marked` and
the Vazirmatn fonts are vendored under `persian-claude-gui/static/` because the target PC
may be offline or locked down. A PR that adds a package manager is a PR that breaks the
one machine this exists for.

**`claude-persian-rtl-spec.md` is binding** for anything that renders text — its base
CSS, its 7 numbered rules, its 12 test cases. When you touch rendering, cite the rule
number in the commit message or the code comment ("spec rule 4"), don't paraphrase the
spec into prose. Its closing list names the traps that look like fixes and aren't
(`text-align: right` without `direction`, reversing strings in JS, a manual direction
toggle, expecting the font to fix direction).

Two project deltas the spec doesn't cover: the shell is `<html dir="rtl" lang="fa">`, so
"never global `dir=rtl`" survives only by discipline — every content-bearing element
carries its own direction. And Windows paths anywhere in the chrome (statusline, titles,
folder picker, session previews, tool params) use `.path` (LTR + isolate + `<bdi>`); the
spec's cases are message-focused and will not catch a regression there.

**Read the `wiki/` page for the area first.** Several of them document failure modes that
produce no error at all — `permission-transport.md` and `control-protocol.md` describe
requests that answer a cheerful `success` while doing nothing.

## Running it

```powershell
C:\Python314\python.exe persian-claude-gui\server.py --cwd <project> --no-window
```

Use your own interpreter path — `python` on PATH is the Windows Store alias stub, and the
absolute path in the docs is this machine's. Set `PYTHONIOENCODING=utf-8` first or Persian
mojibakes in the console.

## Which check gates what

| You touched | Run | Cost |
|---|---|---|
| anything in `static/` | `python persian-claude-gui\run_spec_test.py` — must print `PASS — 20/20` | free |
| `transcript_path()`, session delete, replay | `python persian-claude-gui\test_transcript_path.py` | free |
| the transport, control requests, the capability mirror | `python persian-claude-gui\smoke_test.py` | **one real subscription turn** |
| `setup.ps1` / `run.vbs` | `setup.ps1 -DeployRoot <tmp> -ProjectDir <tmp> -ShortcutDir <tmp> -SkipSmokeTest`, twice — it must stay idempotent | free |

`smoke_test.py` spends a real turn of the Claude subscription every run. Phase exits, not
per commit.

There is no CI, on purpose: the CLI can't run in a CI container, so only
`test_transcript_path.py` would execute. Run the checks locally and say so in the PR.

## Three encoding traps that corrupt Persian silently

From `wiki/packaging.md`; all three fail quietly, none of them raises:

1. **`setup.ps1` must stay UTF-8 *with* BOM.** Windows PowerShell 5.1 reads a BOM-less
   script as the system ANSI codepage and every Persian string in it becomes mojibake.
   If your editor stripped the BOM, put it back:
   ```powershell
   $t = [IO.File]::ReadAllText($f, [Text.Encoding]::UTF8)
   [IO.File]::WriteAllText($f, $t, (New-Object Text.UTF8Encoding($true)))
   ```
2. **The generated `run.vbs` must stay UTF-16LE with BOM.** `wscript` reads a BOM-less
   `.vbs` as ANSI, which mangles the baked-in paths on any machine whose Windows username
   is not ASCII.
3. **`.lnk` fields are ANSI-lossy.** The shortcut `Description` stays ASCII — written in
   Persian, ی (U+06CC) silently becomes ي (U+064A). The same applies to the *path*:
   `CreateShortcut()`/`Save()` on a Persian filename throws, so setup saves under an ASCII
   name and `Rename-Item`s it. Don't "simplify" that back into a direct call.

## Style

Match the file you're in. Comments explain *why*, and the load-bearing ones name the
measured fact behind a decision — this codebase is pinned to a specific `claude` build and
several behaviours are not documented anywhere else. Unknown stream events must render as
a collapsed raw-JSON card, never crash: the NDJSON format drifts between CLI versions.

Persian UI strings live in `static/strings.fa.js` only. No hardcoded user-visible text in
the modules — they read `window.STRINGS`, which is where a second language would attach.
