# M8 — Acceptance on the colleague's PC

Run this **on the target machine, with the colleague present**. It is the plan's §B-10 acceptance
pass, rewritten for the TUI-shaped shell v2.2–v2.6 built, plus the specific failure modes M0–M7
actually uncovered.

**Rewritten 2026-09-05 for v2.7.** The window this checklist exercised through v1 was a mouse-driven
web chat: a greeting with four action cards, a clickable model chip, a clickable posture pill,
composer capability chips. None of that ships any more. v2.2–v2.6 replaced it with a column that
looks and answers like the real `claude` terminal — `⏺`/`⎿` rows, a status-line stack, numbered
in-flow dialogs, and slash commands — while the sidebar and tabs (v1's own surfaces) stayed
untouched. Every step below was cross-checked against `static/js/*.js`, `static/index.html` and
`static/help.html`, and against what `test_column.py`, `test_keys.py`, `test_dialogs.py`,
`test_shell.py` and `test_strings.py` actually assert. Nothing here describes a control that no
test or module implements — where v2 deliberately does not build something (rewind, `/theme`
switching, a diff panel), it is named as **not built** rather than left off silently.

Everything before this point was verified on the author's PC only. Four install branches have
**never executed anywhere** (see `wiki/packaging.md`), and they all execute here for the first
time. Expect to find something in the installer; the shell itself has 174/174 spec, six free gate
files and a dry run behind it, so surprises there should be smaller.

Take the USB payload folder with you (§0 below) — if the machine blocks downloads you cannot
improvise it on site.

---

## 0. Before you go — **free**

- [ ] Prepare the offline payload folder: `python-3.12.10-amd64.exe` from
      `https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe`, plus the whole
      `persian-claude-gui/` folder. Fonts and `marked` are already vendored inside it.
      **`-Payload` covers Python only.** Claude Code has no offline installer — its own
      `install.ps1` downloads a binary from `downloads.claude.ai`. If that host is unreachable
      (blocked network, or the region check in the vendor script), `claude` must already be on the
      machine or the trip is wasted.
- [ ] Confirm the colleague's Claude account credentials are available — **login cannot be
      automated** and is the one manual step.
- [ ] Know the installed `claude` version before you go (`claude --version` on the author PC is
      **2.1.261** as of 2026-09-05 — see `wiki/tui-keys.md`/`wiki/tui-strings.md` headers). The
      target machine's own `claude` may have moved since; §8 below is where that gets recorded.

---

## 0.5 Pre-flight: run the install branches in a clean VM — **before the trip, free**

A restructure must not meet its first bare machine and its first install-branch execution on the
same day. `clean-machine.wsb` at the repo root boots a throwaway Windows with the package mapped to
the Desktop, read-only. Enable Sandbox once, elevated, then reboot:

```powershell
DISM /Online /Enable-Feature /FeatureName:Containers-DisposableClientVM /All
```

Status of the four branches as of 2026-08-07 (`wiki/packaging.md`) — **unaffected by v2.2–v2.6**,
which changed the window's own screen, not the installer:

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

## 1. Probe the target PC (before installing anything) — **free**

Run the probe block from `claude-persian-rtl-options.md` §"Probe the target PC first". Record the
answers; they decide what happens next.

| Question | Answer | Consequence if bad |
|---|---|---|
| Is `claude` installed and **logged in**? | | Blocking for everything |
| Real Python, or the Store alias stub? | | Stub → setup installs real Python |
| `winget` present? | | Absent is fine — setup never uses it |
| `msedge.exe` present? WebView2? | | Absent → degraded to a normal browser tab |
| **Are installs permitted at all?** | | Forbidden → this section is impossible, re-plan |

One more the plan's probe does not ask, and it silently breaks things:

- [ ] **Is the username non-ASCII (e.g. Persian)?**
      → the paths baked into the shortcut's arguments. `WshShell.Save()` round-trips them through
      the ANSI codepage, so verify the shortcut actually launches rather than assuming.

---

## 2. Install — `setup.bat` only — **free**

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
- [ ] Smoke test reports success (`آزمایش موفق بود`). **Costs one paid CLI turn** — a
      failure line names which check fell over (16 checks; see CLAUDE.md's gate table).
- [ ] Desktop shortcut «کلاد فارسی» exists, with the coral prompt mark (**not** Anthropic's Claude
      logo, and never the pre-rebrand «کلود» name — if that one is on the desktop too, the
      idempotency cleanup in step 5 of `setup.ps1` did not run).
- [ ] Read `setup-log.txt` end to end for anything that looks skipped rather than done.
- [ ] Re-run `setup.bat` once more — must be clean and idempotent.

If downloads are blocked: `setup.ps1 -Payload <usb-folder>` — **also a first-ever execution**.

---

## 3. Launch — **free**

- [ ] Double-click «کلاد فارسی». A chrome-less window opens on the **TUI's own welcome box** —
      `✻` + «Welcome to Claude Code» (Persian) + the version, the folder being worked in, and the
      composer's own three footer hints (`/` for commands, `@` to mention a file, `?` on an empty
      prompt for the key sheet) — **not** an empty chat and **not** the old greeting-plus-four-cards
      home state, which v2.5 deleted (V2-PLAN §6, v2.5 decision 6).
- [ ] If no project folder is open yet, the same box says so instead of naming a folder — open one
      from the sidebar or the folder button beside the composer.
- [ ] **No console window appears at any point.**
- [ ] The window shows the Persian UI, right-aligned, with joined letterforms.
- [ ] Close the window. Within ~15 s: no `pythonw` and no wrapper-spawned `claude` process
      remains (Task Manager, or `Get-Process pythonw,claude`).

---

## 4. Spec test cases 1–12 — **in both live view and history replay — free**

Plan §B-10 item 1. The automated harness covers the mechanics; this is the human check on a real
machine with the colleague's own fonts and display scaling. Unchanged by v2.2–v2.6 — the BiDi
rules are message content, not the shell around it.

> **Dry-run on the author PC, 2026-08-06** (browser-driven, ~2 paid turns): §4 and §5 both pass
> now, but only after three shell-layout defects were fixed — see `wiki/rtl-rendering-notes.md`
> §"Three defects the spec gate could not see". Still never exercised anywhere: the **folder
> picker** and **attachment chips** (both open a native tkinter dialog that automation cannot
> answer) and the **welcome box with no project open**. Check those by hand on the target.

- [ ] Open `/static/spec-test.html?t=<token>` (token from the address bar). Verdict bar reads
      `PASS — 174/174` (grown from the 20 the harness started with — every phase's own gates added
      to this same run rather than a separate file).
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
| 9 | ask it to write a file whose content is Persian | the tool card's `content` shows Persian lines right-aligned, Latin lines left-aligned, in one box, marked with `⏺`/`⎿` like every other tool row |
| 10 | approve that write | the **numbered permission list** shows the same content, just as readable — this is the moment of consent |
| 11 | ask it to read a file with mixed Persian/Latin lines | every line takes its own direction; order unchanged |
| 12 | make sure one of those lines has Latin digits in it | digits stay in place inside the Persian line |

- [ ] **Now replay the same conversation from the sessions list and check all 12 again.** This is
      the half people skip; the renderer is shared but the event path is not.

---

## 5. Chrome-path sweep (plan §B-10 item 2) — **free**

The spec's cases are message-focused and will not catch these. Every Windows path in the UI
chrome must read left-to-right with separators in the right places:

- [ ] status-line stack, row 3 (bottom bar) — the «پوشه» field
- [ ] top bar project name + cwd
- [ ] **sidebar project names** (hover one: the `title` tooltip shows the full path — check it too)
- [ ] sidebar session previews (mixed Persian/Latin previews must each read correctly)
- [ ] the project chip in the composer (name + tooltip path) — this one survived v2.4's chip
      cleanup; only the four **capability** chips (model, posture, effort, style) were removed
- [ ] folder picker result after switching project — still a native dialog, still `/api/project/pick`
- [ ] tool card summary line and its parameters
- [ ] **permission dialog parameters** — must show `C:\Users\…`, never `C:\\Users\\…`
- [ ] attachment chips — still in the composer row (`#attachments`), unaffected by the capability
      chips' removal
- [ ] **session hover preview card** (rest on a session row for a moment) — each of the 2–3 lines
      picks its own direction; a Windows path inside an assistant line still reads LTR
- [ ] **the welcome box's own path row** — reads the open folder, right-to-left label / left-to-right
      path, and says so plainly when no folder is open (there is no "four cards vs three" case any
      more — v2.5 deleted the home action cards; see §3)

---

## 6. Feature pass (plan §B-10 item 3) — **free unless noted**

> **Dry-run on the author PC, 2026-08-06,** predating v2.2–v2.6; re-verify every item below against
> the current build, since the controls it describes (model chip, posture pill) no longer exist.
> The folder picker's native dialog still cannot be driven by automation — check it by hand.

- [ ] Persian prompt → reply streams in token by token, as `⏺` rows.
- [ ] **Reply comes back in Persian.** If it does not, that is the colleague's `~/.claude` config,
      not a wrapper bug — the wrapper inherits their real settings and hooks. Fix their
      `CLAUDE.md` / output style.
- [ ] Trigger a tool that needs approval → a **numbered permission list** appears above the
      composer, in the flow, not a popup — with a readable path.
- [ ] **Option 1 (بله)** → the action happens once.
- [ ] **Option "نه" (renumbered ۲ or ۳ depending on whether a remember scope applies)** → the
      action does not happen, and the reply says so calmly. Typing a note first and choosing this
      option sends that note as the model's reason.
- [ ] **`Esc` on a permission or plan dialog is a refusal ("نه"), never an approval.** Dismissing
      is never consent.
- [ ] Tick **"بله، و دیگر برای … نپرس"** (the remember option, present only when a remember scope
      applies) → the next same-tool call in this conversation does not prompt; the composer's audit
      counter climbs and every auto-approved card says «اجازه داده شد».
- [ ] **`Shift+Tab` on an open permission dialog** approves the tool AND hands your typed note to
      the composer via `restoreDraft()` — "approve and say this", not silent text loss.
- [ ] Trigger a **question** (`AskUserQuestion`, not a permission) → the dialog title reads «کلاد
      یک پرسش دارد» with an **«ارسال پاسخ»** button, not «اجازه بده». **`Esc` here is not a
      refusal** — it sends an allow with no answers, because a question is not a request for
      consent (v2.4 decision 5). This is the one dialog where Esc and a permission's Esc behave
      differently; confirm both in the same session.
- [ ] A **plan** approval (posture «طرح‌ریزی») draws only two options (accept / refuse) — there is
      no third "ask again" call to make, so the list is not padded to three.
- [ ] Approve a plan → the tool card says «طرح ذخیره شد» (plan **kept**, nothing executed) — not
      «اجازه داده شد», which would claim something ran. The posture then leaves «طرح‌ریزی» on its
      own, because the CLI exits plan mode itself; a pill still reading «طرح‌ریزی» while files are
      being written would be the defect this item exists for (there is no pill any more — watch
      the status line's posture row instead).

The composer's model, effort, output-style and permission controls are **commands and a chord now,
not clickable chips** — v2.4 removed all four capability chips, and the pickers are opened by
verb (`chat.js`/`composer.js` `openModelPicker()` etc.), never by `.click()` on an element that no
longer exists:

- [ ] **`/model`** (or `Alt`+`P`) opens a numbered list of the models this CLI account reports,
      current one marked. Pick another, send a turn → the reply actually comes from it (the status
      line's model field follows the new turn, not the click). An account with nothing to pick from
      makes `/model` fall through to the CLI as plain text — not a broken picker.
- [ ] **`Shift`+`Tab`** (composer focused, no dialog open) cycles the permission posture through
      the CLI's four: «محتاط» → «ویرایش آزاد» → «خودکار» → «طرح‌ریزی» → … . **`Shift`+`Tab` inside
      a text field with a selection, or with nothing to cycle yet (`initialize` not answered),
      belongs to the field/browser, not to the posture** — confirmed by `test_keys.py`.
- [ ] **`/permissions`** opens the same four postures as a numbered list, for picking one directly
      instead of cycling.
- [ ] Switch to «ویرایش آزاد» → a file edit stops prompting; a shell command still prompts.
- [ ] Switch to «خودکار» → nothing prompts, and the counter «N اقدام خودکار» climbs on the
      composer row (a label, not a control — no hover state, no pointer cursor). Click it: every
      auto-approved action is listed.
- [ ] **The posture never changes on its own without confirmation from the CLI.** There is no pill
      to snap back visually any more; watch the status line's posture row instead — if the CLI
      refuses a mode switch, the row must not silently claim the new one.
- [ ] Switch project (or resume a session) → the posture is back at «محتاط» with an empty count
      (a fresh conversation always starts there).
- [ ] `/effort` opens a numbered list of thinking-effort levels for this model; falls through to
      the CLI as text on a model with no effort levels.
- [ ] `/output-style` opens a numbered list of output styles the CLI reports; same fallback rule.
- [ ] `/clear` presses the same "new conversation" action the sidebar's own button does.
- [ ] Stop button (or `Esc` while a turn runs) mid-generation → the spinner's own line stops, cost
      shows `$0.0000` for that turn (what the CLI reports for an interrupted one), **not** a red
      error. Conversation still usable afterwards.
- [ ] Kill the wrapper mid-session (Task Manager) → relaunch → open the session from the list →
      the sidebar's session row → it remembers the earlier conversation. `/resume` (or focusing the
      sidebar) also works: it moves a roving tab stop onto the session list — `↑`/`↓` to move,
      `Esc` back to the prompt, `Enter` opens the highlighted row.
- [ ] Open an old session from history and read it.
- [ ] Switch project with the folder picker; the session list changes with it.
- [ ] Type `/` → command list appears; pick one with `↑`/`↓` + `Tab` (or click); **`Enter` always
      sends the message, even with the list open** — it never accepts a completion (v2.3 decision
      7, the same rule the `@` menu and the history search follow).
- [ ] Type `@` → file list opens; `Tab` accepts a file into the message, `Enter` still sends,
      `Esc` closes the menu.
- [ ] Type `!` at the start of a line → the composer visibly switches to shell mode (border
      colour change); the command runs in the project folder through `cmd.exe`, and its output
      rides in **front of the next real message** rather than being sent on its own (v2.3 decision
      4 — running `!` alone spends no turn).
- [ ] `Ctrl`+`R` opens history search over this project's own sent prompts; typing narrows it,
      `Ctrl`+`R` again goes to the next match, `Esc` **or** `Tab` accepts the match into the box
      (search has no destructive exit — v2.3 decision 15), `Enter` accepts and sends immediately.
- [ ] `↑`/`↓` on an empty or single-line composer walk this project's own prompt history; a
      half-typed draft is restored when you return past the newest entry.
- [ ] `Ctrl`+`G` opens the draft in your external text editor; saving and closing it brings the
      edited text back into the composer (waits for the file to stop changing, with a one-second
      settle).
- [ ] `Ctrl`+`L` clears the **composer box**, not the screen — the TUI's own default for this
      chord on Windows (v2.5/§8.6; there is no Windows "clear screen" chord to imitate).
- [ ] `Ctrl`+`O` expands every tool result in the column at once; press again to collapse them all.
- [ ] `Ctrl`+`T` toggles the todo list; `Alt`+`T` toggles "در حال فکر کردن" (thinking) text.
- [ ] `?` on an **empty** composer opens the key sheet — the same list `composer.js`'s own
      `KEY_SHEET` dispatches from, so it cannot show a key that does not work. `Esc` closes it.
- [ ] Paste a long block (≥800 characters or >2 newlines) → it collapses to a
      «متن چسبانده‌شده #N» chip; what is actually **sent** is the full pasted text, expanded back
      before the request goes out.
- [ ] Attach an image (paperclip button, native dialog) and ask about it → the model describes it.
- [ ] Attach a non-image file → arrives as an attachment the model can read, shown as a chip in the
      composer row before sending.
- [ ] `/copy` copies the last reply; `/export` writes the visible column to a file and names the
      path — both read what is on screen, not a separate transcript file.
- [ ] `/branch` opens a fork of the current conversation in a new tab; a note about the fork lands
      in the **new** tab's own column, not the one you branched from.
- [ ] `/btw <question>` warns **before sending** that it costs a turn, then answers as a dimmed
      `※` row that never enters the conversation's own context.
- [ ] `/tasks` unfolds the background-agents strip if anything is running, or says so if nothing is.
- [ ] `/status` opens a numbered (inert-digit) block with this tab's model, folder, session id and
      permission posture.
- [ ] `/help` opens the numbered list of everything the window answers (`/help`, `/resume`,
      `/status`, `/copy`, `/export`, `/branch`, `/btw`, `/bash`, `/tasks`, `/cd`/`/add-dir`,
      `/memory`, `/config`, `/hooks`, `/keybindings`, `/model`, `/effort`, `/output-style`,
      `/permissions`, `/clear`, plus rows for `/` and `?`), with a last row that opens
      `static/help.html` in a new tab.
- [ ] `/config`, `/hooks`, `/keybindings`, `/memory` each open the real underlying file in your
      text editor — not a picker.
- [ ] `/cd` and `/add-dir` both open the folder picker (one conversation has one cwd, so there is
      no second meaning for "add a directory" here).
- [ ] A verb the window does not own (or a known verb with an argument it does not take, e.g.
      `/model sonnet`) falls straight through to the CLI as ordinary text.

---

## 7. The real test (plan §B-10 item 4) — **free, needs the colleague**

- [ ] **The colleague completes a genuine small task of their own, end to end, by keyboard alone —
      no mouse for anything the keyboard can already do, no terminal, and no hint from you.**

This is the phase table's exit criterion for v2.7. Sit on your hands. Watch where they hesitate —
that is the actual finding, not the checkboxes.

**Pass/fail rubric:**

| Criterion | Pass looks like |
|---|---|
| Starts without help | Types into the composer within a few seconds of the window opening — no "where do I type" |
| Sends and reads a reply | `Enter` sends; they read the streamed `⏺` reply without asking what it means |
| Handles at least one permission dialog on their own | Picks an option (digit, `↑`/`↓` + `Enter`, or a click) without you naming the option for them |
| Recovers from one wrong move | If they Esc out of something or send the wrong thing, they continue without your intervention |
| Finishes the task | The task they set out to do is actually done, confirmed by them, not by you |

Pass = all five. Any row that needed you to say a key or a command name is a fail on that row, and
the note that follows records **which one**, not just pass/fail overall.

- [ ] Note every point of confusion, in their words.

**Record the run:**

| Field | Value |
|---|---|
| Date | |
| PC (make/model or asset tag) | |
| `claude --version` on this PC | |
| Task attempted | |
| Result (pass / fail, and which rubric row if fail) | |
| Points of confusion (colleague's own words) | |

---

## 8. After — **free**

- [ ] Record probe results and anything that broke in `wiki/` — especially any install branch that
      failed, since those are the untested ones.
- [ ] Note the tested `claude --version` on that machine (also recorded in §7's table). If it
      differs from the author PC's 2.1.261, re-run `test_tui_vocab.py` against a copy of that
      version's `claude.exe` before trusting any key or string claim above — the whole vocabulary
      (keys, strings, glyphs, thresholds) is pulled from one binary and is a gate, not a memory.
- [ ] Hand over `راهنما` (the Persian guide) — it opens from the last row of `/help`, or from
      `static/help.html` directly.

## Known differences from the real CLI — tell them up front

`static/help.html`'s own «تفاوت با ترمینال» section is the one to hand them; the short version:

- No `!` shell passthrough as a bare terminal replacement — `!` output does not enter the
  conversation on its own; it rides into the *next* real message.
- No rewind (`double-tap Esc`) — the capability exists on the wire but v2 has not built the dialog
  or the column truncation for it yet (V2-PLAN §8.11C, still open).
- No light theme — the window is dark-only by design decision (V2-PLAN §8.12A); `/theme` falls
  through to the CLI, which refuses it locally and free.
- `Esc` does not exit the window — the close button does, and `Ctrl+C`/`Ctrl+D` stay the browser's
  own copy/nothing rather than the terminal's exit chords.
- Cost shows `$0.0000` for an interrupted turn; that is what the CLI reports.
- The four v1 capability chips (model, posture, effort, style) are gone — the same actions are
  `/model`, `Shift+Tab`/`/permissions`, `/effort`, `/output-style` now.
