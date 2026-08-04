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
- [ ] Confirm the colleague's Claude account credentials are available — **login cannot be
      automated** and is the one manual step.

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

Two more the plan's probe does not ask, both of which silently break things:

- [ ] **Does the Windows username contain a space?** (`echo %USERNAME%`)
      → `%LOCALAPPDATA%` gets a space → the permission hook depends on an 8.3 short name existing.
      Setup warns if it does not. If you see that warning, **tool approvals will not work** —
      stop and re-plan the install location.
- [ ] **Is the username non-ASCII (e.g. Persian)?**
      → `run.vbs` paths. It is written UTF-16LE for exactly this reason; verify the shortcut
      actually launches rather than assuming.

---

## 2. Install — `setup.bat` only

The whole point is that nothing else is needed.

- [ ] Copy `persian-claude-gui/` to the machine. Double-click **`setup.bat`**. Nothing else.
- [ ] Watch for Persian text rendering correctly in the console. Mojibake here means the
      UTF-8 BOM was lost from `setup.ps1` (see `wiki/packaging.md`).
- [ ] Python install branch runs — **first execution ever**. Note any prompt or failure.
- [ ] Claude Code install branch, if `claude` is absent — **first execution ever**.
- [ ] If not logged in: setup prints Persian instructions. Run `claude` once, log in, re-run
      `setup.bat`.
- [ ] Smoke test reports success (`آزمایش موفق بود`).
- [ ] Desktop shortcut «کلود» exists, with the blue speech-bubble icon.
- [ ] Read `setup-log.txt`. **Check specifically for the 8.3 warning.**
- [ ] Re-run `setup.bat` once more — must be clean and idempotent.

If downloads are blocked: `setup.ps1 -Payload <usb-folder>` — **also a first-ever execution**.

---

## 3. Launch

- [ ] Double-click «کلود». A chrome-less window opens.
- [ ] **No console window appears at any point.**
- [ ] The window shows the Persian UI, right-aligned, with joined letterforms.
- [ ] Close the window. Within ~15 s: no `pythonw` and no wrapper-spawned `claude` process
      remains (Task Manager, or `Get-Process pythonw,claude`).

---

## 4. Spec test cases 1–8 — **in both live view and history replay**

Plan §B-10 item 1. The automated harness covers the mechanics; this is the human check on a real
machine with the colleague's own fonts and display scaling.

- [ ] Open `/static/spec-test.html?t=<token>` (token from the address bar). Verdict bar reads
      `PASS — 11/11`.
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

- [ ] **Now replay the same conversation from the sessions list and check all 8 again.** This is
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

---

## 6. Feature pass (plan §B-10 item 3)

- [ ] Persian prompt → reply streams in token by token.
- [ ] **Reply comes back in Persian.** If it does not, that is the colleague's `~/.claude` config,
      not a wrapper bug — the wrapper inherits their real settings and hooks (found in M4). Fix
      their `CLAUDE.md` / output style.
- [ ] Trigger a tool that needs approval → Persian dialog appears with a readable path.
- [ ] **Approve** → the action happens.
- [ ] **Deny** → the action does not happen, and the reply says so calmly.
- [ ] Tick "تا پایان این نشست … دوباره نپرس" → the next same-tool call does not prompt.
- [ ] Press Escape on a dialog → treated as **deny**, never as approve.
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
      (`wiki/permission-broker.md`).
- [ ] Hand over `راهنما` (the Persian guide) — it opens from the «راهنما» button in the app.

## Known differences from the real CLI — tell them up front

Not defects; deliberately not built (plan §B-7):

- No mid-session permission-mode switching (no plan-mode toggle).
- No `!` shell passthrough.
- `Esc` does not interrupt — the «توقف» button does.
- Cost shows `$0.0000` for an interrupted turn; that is what the CLI reports.
