# HANDOFF — UI polish pass, 2026-08-07

Written at the end of a long session so the next one can finish the work without
re-deriving anything. Everything below is on branch `rework/phases-0-3`,
**uncommitted**. Tracked in beads: `bd list --status=open`.

Read `CLAUDE.md` first as always. This file only covers what is NOT yet in it.

---

## START HERE (in this order)

0. **Relaunch the app and look at it.** Close the window fully, start it from
   the desktop shortcut, and confirm the seven DONE items below actually
   render. Nothing in this session was seen by a human or a browser — the gate
   is blind to layout. If something is wrong, fix that before starting new work.
1. Then `bd ready` / the REMAINING section below, in the order given.

Everything is **uncommitted** on `rework/phases-0-3` (15 modified, 2 new). The
user has not authorised a commit — ask first.

## Gates as of this handoff

| Check | Result |
|---|---|
| `run_spec_test.py` | **PASS — 24/24** (was 21; three tool-row guards added) |
| `test_units.py` **(new)** | PASS — 19 checks |
| `test_no_console.py` | PASS |
| `test_transcript_path.py` | PASS |
| `smoke_test.py` | **not re-run this session** — costs a subscription turn |

Run everything free with:

```
cd persian-claude-gui
C:\Python314\python.exe run_spec_test.py
C:\Python314\python.exe test_units.py
C:\Python314\python.exe test_no_console.py
C:\Python314\python.exe test_transcript_path.py
```

---

## DONE this session

### 1. The statusline was never running at all (the big one)

`run_statusline` used `subprocess.run(command, shell=True)` → `cmd /c <command>`.
**cmd strips the outer quote pair when the command starts with a quoted exe
path**, which is what every `statusLine` running node/python out of
`"C:\Program Files\…"` looks like. Exit 1, empty stdout, and the function
returns `None` on empty — so §B-7 passthrough was silently dead for the entire
life of the feature, and the bar just looked sparse.

Fixed to `f'{COMSPEC} /s /c "{command}"'` with `shell=False`. Also:

- publishes on `system/init`, not only on `result` (bar was empty for the whole
  first turn)
- **ANSI is parsed, not stripped** — `ansi_segments()` → `[{text, fg?, bg?,
  bold?, dim?, italic?}]`, client builds spans. Supports basic/bright/`38;5;N`/
  `38;2;r;g;b`, drops non-SGR escapes.
- context/quota render as native `<progress>` meters, amber ≥70%, accent ≥90%

Full write-up: `wiki/parity-chrome.md` §"It never actually ran".

### 2. Clipboard paste (Ctrl+V) for images

New `POST /api/attach/paste` → `save_pasted_image()` writes the bytes to
`%TEMP%\persian-claude-gui-paste\` and returns a **path**, so it re-enters the
attachment pipeline that already existed (chip row, `build_message_blocks`,
size cap). Client handler is on `#input`'s `paste` event; a text paste falls
through untouched because the image guard runs before `preventDefault()`.
Validated at the boundary: media type, base64, 5 MB.

### 3. Send button no longer disappears mid-turn

`setBusy()` used to hide send and show stop. Enter has **always** sent mid-turn
and the CLI queues it fine, so the swap only made the button and Enter disagree
based on invisible state. Now stop is *added* next to send. Also
`wrapper/reset` calls `setBusy(false)` — that was how it got stuck after a
project switch.

### 4. Sidebar: the active project can be collapsed again

`renderProjects()` ran `expanded.add(currentCwd)` on **every** redraw, and any
SSE event redraws — so a collapse was undone milliseconds later. Now guarded by
`autoExpanded`, re-arming only when `currentCwd` actually changes.

### 5. Tool cards → quiet rail rows (user item 1)

Bordered panels became one-line steps: icon + Persian verb + **filename**
(not the whole path; full value in `title` and in the params). Surface/border
appear only on `[open]`. Consecutive rows share a continuous rail drawn as two
pseudo-element halves (`:has(+ .card)` for the lower half, `+ .card` for the
upper). Disclosure caret removed — it fought the tool icon and `<details>`
already announces expanded state.

New strings live in `strings.fa.js` as `toolVerbs` (the i18n seam — keep
user-visible text out of the modules). An unlisted tool falls back to its raw
name, never to an empty row.

### 6. Kebab (⋯) row menu (user item 3)

`kebabMenu(items)` in `chrome.js`, built on the **native `popover` API** —
top-layer, light-dismiss and Escape for free, so the sidebar's overflow cannot
clip it. Position assigned on open (CSS anchor positioning is newer than the
Edge we are guaranteed on the target PC) and flips above the button near the
viewport bottom.

- project row: archive/unarchive, ─, remove (danger)
- session row: view, ─, delete (danger)

Danger items arm on the first click and fire on the second — the old
`armedDelete()` pattern, which is now **deleted** since the menu subsumed it.
**No new server route**; every action reuses an endpoint that already existed.

### 7. `tool_progress` no longer spams the transcript

Found from a screenshot of the running app, not from any gate. The CLI
heartbeats a long-running tool with
`{type:"tool_progress", heartbeat:true, elapsed_time_seconds, parent_tool_use_id}`.
`renderEvent` had no case for it, so it fell through to `renderRaw` and a slow
`Bash` buried the transcript under grey «رویداد ناشناخته» panels — four deep in
the screenshot. Now consumed as an **elapsed-time chip on the parent card**
(the heartbeat's own id is synthetic, `…-heartbeat-2`, so it resolves
`parent_tool_use_id`). This is the "Worked for 4m 22s" affordance from the
Codex reference, for free.

**Lesson worth keeping:** the "unknown events render as a collapsed raw card"
rule is a crash-guard, not a UX. Any event type that arrives *repeatedly* needs
a real case or it becomes noise. Worth grepping the transcripts for other
frequent types with no case.

### 8. Statusline no longer truncated

Caught from a screenshot of the running app: `#statusline .sl-custom` was
declared *before* `#statusline .path`. Identical specificity, so source order
decided, and `.path`'s `max-width: 46ch` chopped the script's last field to
«claude-op…». Moved after. See the Facts section.

### 9. Also verified working, from the same screenshots

The built-in statusline items all populate on the author PC: مدل، پوشه، حالت،
متن ۲۰٪، هزینه \$11.4481، سهمیه ۵ ساعته ۱۸٪، نشست. The composer chrome
(attach, project chip, model chip, posture pill, auto-approval counter at ۷۴)
all render. So the wrapper's own state plumbing is fine — what is unverified is
purely tonight's *visual* changes.

---

## REMAINING — ordered

### A. `pcg-vnv` — context-expiry notice with /clear + /compact  (user's stated priority)

After ~1 h the CLI says the prompt cache expired and suggests `/clear`. The
user wants that surfaced as an **actionable notice whose two buttons are
`/clear` and `/compact`**, plus dismiss-and-continue if they pick neither.

**Blocking unknown — measure first:** which event carries that notice. Candidates
are a `system` subtype, assistant text, or a field on `result`. Cheapest probe
is grepping the CLI bundle for the English string rather than idling an hour.

Known and already settled:
- `/compact` is **NOT** a control subtype (`wiki/control-protocol.md:123`) — it
  must be sent as **ordinary message text**.
- `/clear` already exists as a composer lifecycle verb (`interceptLifecycle`),
  which `.click()`s the button that owns the job.
- Unknown event types already render as a collapsed raw card, so nothing
  crashes while this is unbuilt.

### B. `pcg-zj1` — AskUserQuestion rendered as a real question  (user: "very important")

Arrives as a `tool_use` named `AskUserQuestion`; today it renders as a generic
param-row card, so the colleague sees JSON instead of a question. Wanted: header,
options as buttons, multiSelect, free-text "other".

**Blocking unknown — measure first:** how the answer gets *back* in `-p`
stream-json mode. Does it surface via `can_use_tool` (the permission transport
we already own), does the CLI expect a `tool_result` on stdin, or does it
auto-answer? Do not design the UI before this is measured — `wiki/permission-transport.md`
is the precedent for how wrong a guess here can go.

### C. `pcg-52j` — effort picker chip (user item 2)

Reference: Claude web puts it in the model chip — `Opus 5  High ⌄`.

The **data is already there**: `initialize` returns `supportsEffort` and
`supportedEffortLevels` per model (`wiki/control-protocol.md:46`), Haiku alone
reports none. Render it as a capability mirror next to the model name in
`controls.js`, exactly like the model list.

**The write path is the unknown.** `apply_flag_settings` acks garbage as
`success` (its ack means nothing), and `--effort` is documented as a *spawn*
flag. So live switching may need respawn-with-resume. Note `~/.claude/settings.json`
has an `effortLevel` key — worth checking whether the CLI reads it live.
Measure with one real turn before building the chip; never ship a control whose
ack lies (the posture pill was bitten by exactly this).

### D. `pcg-2jy` — real diffs in Edit/Write tool cards

The rail rows landed; the **expanded** state still shows raw param rows. The
reference screenshots want a real diff: line numbers, green/red gutters, and a
`+12 -3` count on the collapsed row. `.diff` already exists in the CSS and in
the spec base block (LTR + isolate) — use it, don't invent a new container.

---

## Facts worth not rediscovering

- **`cmd /s /c "<command>"` is the only safe way to run a user-supplied command
  string on Windows.** `shell=True` eats quotes. Third instance of the same
  class in this repo: a helper that returns `None` on failure with no caller
  that logs is indistinguishable from "not configured".
- The author PC's statusline is
  `"C:\Program Files\nodejs\node.exe" "C:/Users/Lion/.claude/statusline-command.js"`
  and it emits `cwd | [MODE] | model` with SGR colour, including `38;5;172`.
- `:has()` and `popover` are both fine to use — this is Edge/Chromium only.
  **CSS anchor positioning is not** — too new for the target machine.
- The spec gate is structurally blind to layout. Three defects reached the user
  through a green gate before; that is why this session added three tool-row
  guards (verb present, target is a filename, row is one line).
- **`#statusline .sl-custom` must stay AFTER `#statusline .path`.** Same
  specificity (1,1,0), so source order is the only thing deciding whose
  `max-width` wins. Put first, the `.path` 46 ch cap chopped the machine's own
  statusline to «claude-op…». Confirmed from a screenshot of the running app,
  fixed 2026-08-07.
- **To see a code change you must relaunch the app, not reload the page.** The
  server is a long-lived Python process on a random port with a single-use
  token; restarting it invalidates the open window, and an open window keeps
  its already-evaluated modules. `Cache-Control: no-store` is set on every
  response (`_send`), so this is never a cache problem — it is a process
  lifetime one. Two rounds of screenshots this session showed the old build for
  exactly this reason.
- **Nothing in this session was visually verified** — the Claude-in-Chrome MCP
  disconnected mid-session. The tool rail, the kebab menu and the statusline
  meters have passed the headless gate but **no human or browser has looked at
  them**. Driving the app is step one of the next session; see
  `wiki/dev-environment.md` §5–8 (hold an SSE connection open or the idle
  watchdog kills the server before the browser arrives).

## References the user supplied (2026-08-07)

Codex and Claude-web screenshots, kept as the *visual* grammar only — the user
was explicit that **the CLI's structure is the primary reference**, and that web
features with no CLI equivalent (Pin, Mark as unread, Move to group, quick task)
should not be copied.

- transcript = flowing prose with quiet one-line tool steps on a rail, no panels
- collapsed file-edit row: `✎ Edited MainActivity.kt  +51 -5`
- kebab menu: grouped, separators, shortcut letters on the right, destructive in red
- composer: `+ | Chat/Cowork | Opus 5 High ⌄ | mic | send`
