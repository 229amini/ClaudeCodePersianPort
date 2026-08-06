# M8 — Acceptance on the colleague's PC

Run this **on the target machine, with the colleague present**. It is the plan's §B-10 acceptance
pass plus the specific failure modes M0–M7 actually uncovered.

Everything before this point was verified on the author's PC only. Four install branches have
**never executed anywhere** (see `wiki/packaging.md`), and they all execute here for the first
time. Expect to find something.

Take the USB payload folder with you (§0 below) — if the machine blocks downloads you cannot
improvise it on site.

---

## 0. Before you go

- [ ] Prepare the offline payload folder: `python-3.12.10-amd64.exe` from
      `https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe`, plus the whole
      `persian-claude-gui/` folder. Fonts and `marked` are already vendored inside it.
      **`-Payload` covers Python only.** Claude Code has no offline installer — its own
      `install.ps1` downloads a binary from `downloads.claude.ai`. If that host is unreachable
      (blocked network, or the region check in the vendor script), `claude` must already be on the
      machine or the trip is wasted.
- [ ] Confirm the colleague's Claude account credentials are available — **login cannot be
      automated** and is the one manual step.

---

## 0.5 Pre-flight: run the install branches in a clean VM — **before** the trip

A restructure must not meet its first bare machine and its first install-branch execution on the
same day. `clean-machine.wsb` at the repo root boots a throwaway Windows with the package mapped to
the Desktop, read-only. Enable Sandbox once, elevated, then reboot:

```powershell
DISM /Online /Enable-Feature /FeatureName:Containers-DisposableClientVM /All
```

Status of the four branches as of 2026-08-07 (`wiki/packaging.md`):

| branch | state |
|---|---|
| not-logged-in (smoke test fails) | **executed and passed with the real smoke test** — 2026-08-07, after the fix below. Before it, the test passed while not logged in |
| Python install (download → silent install → re-detect) | **executed and passed** — Run A, clean sandbox, 2026-08-06 |
| Claude Code install (`irm claude.ai/install.ps1 \| iex`) | **executed and passed** — 2.1.223 installed, setup continued; `claude` was **not** on PATH afterwards and only the `.local\bin` fallback found it |
| `-Payload` offline | never executed |

**What Run A found.** A CLI with no credentials answers `result` with subtype **success**, cost 0,
body `Not logged in · Please run /login`. `smoke_test.py` only checked that a `result` event
arrived, so it printed `PASS`, setup printed «آزمایش موفق بود», and the Persian login instructions
never printed — on a machine where nothing worked. Fixed: the check now requires `PONG` in the
result body, and re-running in the same not-logged-in sandbox produced the Persian login steps.

**And the launcher did not run at all.** Clicking «کلاد فارسی» on the sandbox desktop raised
«There is no script engine for file extension ".vbs"». VBScript is deprecated; its engine is a
Feature-on-Demand that a current Windows image need not carry, and the shortcut went through a
generated `run.vbs`. The shortcut now targets `pythonw.exe` directly (no console either way), and
`run.vbs` is gone. Nothing on this PC could ever have shown it — the author's Windows still has the
engine.

**Run A — online, nothing installed** (double-click `clean-machine.wsb`, then in the sandbox open
`Desktop\pkg` and double-click `setup.bat`):

- [ ] Persian renders correctly in the sandbox console — a fresh Windows is where a lost BOM shows.
- [ ] Python branch: downloads, installs silently, and is **re-detected by path** afterwards
      (PATH is stale inside the running script — this is the step most likely to fail).
- [ ] Claude branch: the vendor installer's output is echoed and logged, and setup **continues
      afterwards**. It now runs in a child `powershell` — if it ever goes back to
      `Invoke-Expression`, an `exit 1` inside it kills setup silently.
- [ ] Not-logged-in: the smoke test fails and the **Persian login instructions** print. No red
      English stack trace, and the script still ends with «نصب تمام شد».
- [ ] The log landed in `%TEMP%\persian-claude-setup-log.txt` (the mapped folder is read-only, so
      it took the fallback path **and the fallback name** — it is not `setup-log.txt` there) and
      reads complete.
- [ ] Shortcut «کلاد فارسی» exists on the sandbox desktop and launches the window.
- [ ] Re-run `setup.bat` — still clean, still one shortcut.

**Run B — offline `-Payload`.** `clean-machine-offline.wsb` at the repo root is that file already:
networking disabled, `payload\` mapped read-only as a second folder. Drop
`python-3.12.10-amd64.exe` into `payload\` first (see `payload\README.txt`), then run from the
sandbox:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\setup.ps1 -Payload C:\Users\WDAGUtilityAccount\Desktop\payload
```

- [ ] Python installs **from the folder**, no download attempted.
- [ ] The claude step fails with the Persian network/region message — expected, and it must be that
      message rather than a raw PowerShell error.
- [ ] Point `-Payload` at a folder that does not exist → the warning names the folder, instead of
      silently falling through to a download.

Record anything that broke in `wiki/packaging.md` before travelling.

---

## 1. Probe the target PC (before installing anything)

Run the probe block from `claude-persian-rtl-options.md` §"Probe the target PC first". Record the
answers; they decide what happens next.

| Question | Answer | Consequence if bad |
|---|---|---|
| Is `claude` installed and **logged in**? | | Blocking for everything |
| Real Python, or the Store alias stub? | | Stub → setup installs real Python |
| `winget` present? | | Absent is fine — setup never uses it |
| `msedge.exe` present? WebView2? | | Absent → degraded to a normal browser tab |
| **Are installs permitted at all?** | | Forbidden → B2 is impossible, re-plan (plan Phase 0) |

One more the plan's probe does not ask, and it silently breaks things:

- [ ] **Is the username non-ASCII (e.g. Persian)?**
      → the paths baked into the shortcut's arguments. `WshShell.Save()` round-trips them through
      the ANSI codepage, so verify the shortcut actually launches rather than assuming.

---

## 2. Install — `setup.bat` only

The whole point is that nothing else is needed.

- [ ] Copy `persian-claude-gui/` to the machine — **from a fresh clone, or delete `setup-log.txt`,
      `recents.json`, `archived.json` and `__pycache__/` first**. They are gitignored, so a clone is
      clean, but a copy of the author's working folder carries the author's own project list and a
      log full of `C:\Users\<author>` paths. (In the §0.5 sandbox that stale log was mistaken for
      the run's own log.) Then double-click **`setup.bat`**. Nothing else.
- [ ] Watch for Persian text rendering correctly in the console. Mojibake here means the
      UTF-8 BOM was lost from `setup.ps1` (see `wiki/packaging.md`).
- [ ] Python install branch runs — **first execution ever**. Note any prompt or failure.
- [ ] Claude Code install branch, if `claude` is absent — **first execution ever**.
- [ ] If not logged in: setup prints Persian instructions. Run `claude` once, log in, re-run
      `setup.bat`.
- [ ] Smoke test reports success (`آزمایش موفق بود`). It is 10 checks, one paid CLI turn — a
      failure line names which check fell over.
- [ ] Desktop shortcut «کلاد فارسی» exists, with the coral prompt mark (**not** Anthropic's Claude
      logo, and never the pre-rebrand «کلود» name — if that one is on the desktop too, the
      idempotency cleanup in step 5 of `setup.ps1` did not run).
- [ ] Read `setup-log.txt` end to end for anything that looks skipped rather than done.
- [ ] Re-run `setup.bat` once more — must be clean and idempotent.

If downloads are blocked: `setup.ps1 -Payload <usb-folder>` — **also a first-ever execution**.

---

## 3. Launch

- [ ] Double-click «کلاد فارسی». A chrome-less window opens on the home state (greeting + action
      cards), not an empty chat.
- [ ] **No console window appears at any point.**
- [ ] The window shows the Persian UI, right-aligned, with joined letterforms.
- [ ] Close the window. Within ~15 s: no `pythonw` and no wrapper-spawned `claude` process
      remains (Task Manager, or `Get-Process pythonw,claude`).

---

## 4. Spec test cases 1–12 — **in both live view and history replay**

Plan §B-10 item 1. The automated harness covers the mechanics; this is the human check on a real
machine with the colleague's own fonts and display scaling.

> **Dry-run on the author PC, 2026-08-06** (browser-driven, ~2 paid turns): §4 and §5 both pass
> now, but only after three shell-layout defects were fixed — see `wiki/rtl-rendering-notes.md`
> §"Three defects the spec gate could not see". Still never exercised anywhere: the **folder
> picker** and **attachment chips** (both open a native tkinter dialog that automation cannot
> answer) and the **three-card home state** (needs a folder with no history). Check those by hand
> on the target.

- [ ] Open `/static/spec-test.html?t=<token>` (token from the address bar). Verdict bar reads
      `PASS — 20/20`.
- [ ] Then, in the **live chat**, send each case as a real message and eyeball it:

| # | Send | Must look like |
|---|---|---|
| 1 | `سلام دنیا` | right-aligned, RTL, letters joined |
| 2 | `Hello world` | left-aligned, unchanged |
| 3 | `فایل C:\Users\Lion\Desktop\test.md را باز کن` | **path intact and readable LTR, backslashes in place** |
| 4 | a fenced code block | left-aligned, LTR, braces correct |
| 5 | `نسخه 2.1.221 نصب شد` | version reads `2.1.221`, not reordered |
| 6 | type `می` + Shift+Space + `رود` | renders `می‌رود`, not `میرود` |
| 7 | Persian paragraph then a code block | neither disturbs the other |
| 8 | long Persian paragraph | right-aligned on every line, descenders not clipped |
| 9 | ask it to write a file whose content is Persian | the tool card's `content` shows Persian lines right-aligned, Latin lines left-aligned, in one box |
| 10 | approve that write | the **permission dialog** shows the same content, just as readable — this is the moment of consent |
| 11 | ask it to read a file with mixed Persian/Latin lines | every line takes its own direction; order unchanged |
| 12 | make sure one of those lines has Latin digits in it | digits stay in place inside the Persian line |

- [ ] **Now replay the same conversation from the sessions list and check all 12 again.** This is
      the half people skip; the renderer is shared but the event path is not.

---

## 5. Chrome-path sweep (plan §B-10 item 2)

The spec's cases are message-focused and will not catch these. Every Windows path in the UI
chrome must read left-to-right with separators in the right places:

- [ ] statusline cwd (bottom bar)
- [ ] top bar project name + cwd
- [ ] **sidebar project names** (hover one: the `title` tooltip shows the full path — check it too)
- [ ] sidebar session previews (mixed Persian/Latin previews must each read correctly)
- [ ] the project chip in the composer (name + tooltip path)
- [ ] folder picker result after switching project
- [ ] tool card summary line and its parameters
- [ ] **permission dialog parameters** — must show `C:\Users\…`, never `C:\\Users\\…`
- [ ] attachment chips
- [ ] **session hover preview card** (rest on a session row for a moment) — each of the 2–3 lines
      picks its own direction; a Windows path inside an assistant line still reads LTR
- [ ] **home action cards** — the «ادامه آخرین گفتگو» note is the previous session's own title, so
      it can be Persian, English or mixed
- [ ] the home cards must show **four** on a project with history and **three** on a fresh folder
      (no last session ⇒ no resume card, never a dead button)

---

## 6. Feature pass (plan §B-10 item 3)

> **Dry-run on the author PC, 2026-08-06.** Everything below passes except the folder picker (its
> native dialog cannot be driven by automation) — but only after four fixes, three of them in the
> approval path (`wiki/approval-postures.md`). One trap for whoever repeats this: the CLI
> auto-approves shell commands it classifies as read-only, so testing «ویرایش آزاد» with `echo`
> shows no prompt and looks like a broken posture. Use something that mutates.

- [ ] Persian prompt → reply streams in token by token.
- [ ] **Reply comes back in Persian.** If it does not, that is the colleague's `~/.claude` config,
      not a wrapper bug — the wrapper inherits their real settings and hooks (found in M4). Fix
      their `CLAUDE.md` / output style.
- [ ] Trigger a tool that needs approval → Persian dialog appears with a readable path.
- [ ] **Approve** → the action happens.
- [ ] **Deny** → the action does not happen, and the reply says so calmly.
- [ ] Tick "تا پایان این نشست … دوباره نپرس" → the next same-tool call does not prompt.
- [ ] Press Escape on a dialog → treated as **deny**, never as approve.

The composer's two capability controls (Phase 4) are rendered from what the CLI's `initialize`
returned, so on the colleague's machine they may list different models than they do here — that is
correct behaviour, not a bug. What must hold:

- [ ] **Model picker** («مدل») lists the models the CLI reported, with the current one marked.
      Pick another, send a turn → the reply actually comes from it (the statusline/model label
      follows the new turn, not the click).
- [ ] **Posture pill** («سطح اجازه») offers exactly «محتاط» / «ویرایش آزاد» / «خودکار».
      Switch to «ویرایش آزاد» → a file edit stops prompting; a shell command still prompts.
- [ ] Switch to «خودکار» → nothing prompts, and the counter «N اقدام خودکار» climbs next to the
      pill. Click it: every auto-approved action is listed. **A silent full-auto mode is a defect** —
      the count and the per-card «اجازه داده شد» note are the whole justification for the posture.
- [ ] **The pill never moves on its own click** — if the CLI refuses, it snaps back and «تغییر سطح
      اجازه ممکن نشد» appears. Watch for it once: a safety control that looks engaged and is not is
      the exact failure this project already shipped and fixed.
- [ ] Switch project (or resume a session) → the pill is back at «محتاط» with an empty count.
- [ ] Stop button mid-generation → «متوقف شد», **not** a red error. Conversation still usable
      afterwards.
- [ ] Kill the wrapper mid-session (Task Manager) → relaunch → open the session from the list →
      "ادامه" → it remembers the earlier conversation.
- [ ] Open an old session from history and read it.
- [ ] Switch project with the folder picker; the session list changes with it.
- [ ] Type `/` → command list appears; pick one; it runs.
- [ ] Attach an image and ask about it → the model describes it.
- [ ] Attach a non-image file → arrives as an `@path` mention and the model can read it.

---

## 7. The real test (plan §B-10 item 4)

- [ ] **The colleague completes a genuine small task of their own, end to end, without touching a
      terminal, and without you driving.**

Sit on your hands. Watch where they hesitate — that is the actual finding, not the checkboxes.

- [ ] Note every point of confusion, in their words.

---

## 8. After

- [ ] Record probe results and anything that broke in `wiki/` — especially any install branch that
      failed, since those are the untested ones.
- [ ] Note the tested `claude --version` on that machine. Every finding in `wiki/` is pinned to
      2.1.221; if theirs differs, the permission design in particular needs re-verification
      (`wiki/permission-transport.md`).
- [ ] Hand over `راهنما` (the Persian guide) — it opens from the «راهنما» button in the app.

## Known differences from the real CLI — tell them up front

Not defects; deliberately not built (plan §B-7):

- No plan mode. Permission level **is** switchable mid-session, but only through the three pill
  postures — the CLI's other modes (`auto`, `dontAsk`, `bypassPermissions`) are deliberately not
  offered, because in them the CLI approves before it asks the wrapper and nothing can be shown or
  counted (`wiki/approval-postures.md`).
- No `!` shell passthrough.
- `Esc` does not interrupt — the «توقف» button does. (`Esc` closes a dialog or the slash popup.)
- Cost shows `$0.0000` for an interrupted turn; that is what the CLI reports.
