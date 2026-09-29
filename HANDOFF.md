> **Superseded 2026-09-29 (end of day):** Steps 1–3 are done. The visual pass is in
> `wiki/claude-ai-code-reference.md`. P1–P4 and the composer button are built and merged. See
> `CLAUDE-AI-PARITY.md` §Status for what is left to settle with the user. The rest of this file
> is the history of how it was planned.

# HANDOFF — 2026-09-29, claude.ai/code parity (epic `pcg-368`), paused after P1

## What the user wants

- **Terminal edition first.** The user works in the terminal edition, «کلاد فارسی — ترمینال».
  They say its transcript and its chrome look and feel bad next to claude.ai/code.
- **The noise.** It prints «در حال فکر کردن» over and over. Tool rows are scattered across the
  width. The mode and the model appear twice under the prompt. The popovers look nothing like
  the site's.
- **The words they used:** *make all of it like claude.ai/code. At least the UX. Redesign or
  restructure from scratch if needed.* Failing that, match the CLI.
- **They asked for a visual check first.** Open a real claude.ai/code session, interact with
  it, look at how it draws things, then plan. The last session could not do that (see below).
  **This handoff exists so the next session does it first.**

## Step 1 — look at claude.ai/code yourself (before touching code)

**Why the last session could not.** It ran in a cloud container. Every request from there to
claude.ai returns **403**, whether or not the link is public, and the session had no browser.
A fresh *cloud* session hits the same wall. The work has to run where a browser with the
user's claude.ai login exists:

- the **Claude Desktop app** (its built-in browser pane),
- **Claude in Chrome** on the user's PC,
- or `claude remote-control` started in the repo on that PC.

If none of those tools is available, stop and say so. Do not plan from memory. As a fallback,
ask the user for screenshots of each item below.

**What to open.** Any claude.ai/code session with tool runs, a background agent, a mid-turn
message and a finished turn. This session is ideal:
`https://claude.ai/code/session_01LqkkLH1VzN2EszXC2gDBbD`. The user may send a fresh share
link instead. **Interact with it; do not just screenshot the top.** Scroll, expand, hover and
open things. Where the browser tool can run JS, read `getComputedStyle` for font-size,
line-height, colours, padding, radius and gap. Measured tokens beat eyeballed ones.

**Checklist.** Record each item as text in a new `wiki/claude-ai-code-reference.md`. Screenshots
go in a git-ignored `ref/` folder: the repo is public and this is a commercial product (the
same rule `shots.py` follows).

1. **Your message.** Bubble colour, radius, padding, max width, and which side it sits on.
   Persian text inside it. A long message: does it fold?
2. **Assistant prose.** Font, size, line-height, paragraph gap. Headings, lists, inline code
   (the site's is reddish on a dark chip), code blocks with a copy button, tables, links.
   Does a turn have any marker?
3. **Tool activity.** The collapsed line's exact wording per kind (singular and plural, a file
   name shown when there is one file, «Used <server>: <tool>» for MCP, «finished a background
   command»). Its colour and size, the chevron, and the hover state. **Expanded:** what each
   step row looks like (icon? command? output?), how Bash output shows, how an Edit diff shows,
   and whether a step expands again.
4. **While a run is in progress.** Does the line change (present tense, spinner, «Running…»)?
5. **Thinking.** Is anything shown for a thought with text? (This session has some.)
6. **The working line** under the last message. The spark and its animation, «3m 51s ·
   117.6k tokens», the «N running task» chip, and the phase words («Almost done thinking…»,
   «Waiting for Claude…» — collect them all). What is left once the turn ends? (It looked
   like nothing.)
7. **Background tasks panel** (click the chip). Its width, the header with expand and close,
   the «Running» cards (title, «Agent 1m 33s», model · tokens · tool uses · current step,
   «View transcript», the stop square), and «Finished N ›» with the trash icon. What
   «View transcript» opens.
8. **An Agent/Task step in the transcript,** and what a finished background task adds.
9. **Composer while working.** Empty shows **stop ⊙** inside the box. Typed text shows **send ↵**,
   and hovering it opens a small menu: «Send ⏎» / «Queue for later Ctrl ⏎». What does each do
   mid-turn? The placeholder «Type / for commands», attachment thumbnails, and the bar row
   «+ 🎤 ⌄ Auto … Opus 5.5 High ◔».
10. **A queued message.** The row with copy / ↺ / ✕ / «Send now».
11. **A message sent mid-turn.** Where it lands in the transcript.
12. **Menus.** Re-check model («More models ›» flyout), mode, effort, «+» (Connectors flyout)
    and the ◔ context panel against what P1 built: spacing, widths, and the check colour
    (the site's is blue).
13. **Hover actions under a message** (copy, pin, speak, time) and the pin rail. We built
    these; compare them.
14. **Stops, errors,** an interrupted turn, an AskUserQuestion prompt, and a todo list, if the
    session has them.
15. **Scrolling.** Jump-to-bottom, sticky elements, and the header (title, repo/branch chips,
    the share banner).

## Step 2 — re-plan

Update `CLAUDE-AI-PARITY.md`: its table of what the reference shows, and its phases. Settle
these with the user where the site does not decide them:

- **The user bubble's side.** The web edition puts it on the right (the start, in RTL). The
  site puts it at the end (left, mirrored). Pick one for both editions.
- **The check colour** in menus: the site's blue, or our neutral one?
- **The whole transcript.** Should the terminal edition fully drop its TUI glyphs (`⎿` `⏺` `✻`)
  for the site's look? The user's words say yes. `test_column.py` and `test_tui_vocab.py` pin
  the glyphs, so change them deliberately, not silently.
- **«Queue for later».** It needs a wrapper-side hold. The CLI's own queue folds a mid-turn
  send into the running turn, which is what the site's «Send» does. Unmeasured.
- **The WIP commit.** Keep `0b23bac` as the base, or `git revert`/reset it. It is our own
  unmerged branch.

## Step 3 — continue

**Done and pushed (branch only, NOT on `main`): P1, commit `df3bde8` (`pcg-368.1`).** The bar
no longer repeats itself:

- The state line under it keeps only the quota warning and changed files, and is absent
  otherwise.
- The mode chip falls back to the CLI's `permissionMode`, so `bypassPermissions` and `auto`
  still have a name on screen.
- The «N اقدام خودکار» chip is gone. Its count is the mode menu's footer, which still opens the
  audit list. The CLI has no such counter (`wiki/tui-transcript.md` §5).
- `bar.js` menus follow the site: tight rows, a Shift+Tab hint, and the newest model of each
  family with «مدل‌های دیگر ›» opening the rest in a flyout. The effort slider is a gray pill
  with dots and a light thumb.
- Gates: `test_bar` 39 (negative-tested), and every terminal and web gate listed below.

**Paused mid-phase: P2, commit `0b23bac` (WIP, do not merge).** `static-terminal/js/render.js`
has the new run model: `isRunnable`, `ACT_KIND`, `activityNodes`, `openRun`, `paintRun`,
`toolHome`, `noteRunError`. Every step between two sentences joins ONE shut `details.run`,
whose summary is the activity sentence. Thinking and background-task notices join it; `.ask`
does not. Still missing:

- the `FA.act*` strings in `strings.fa.js` — 25 keys (`actShellOne` … `actJoin`; run
  `grep -o "FA\.act[A-Za-z]*" render.js`). The page prints "undefined" until they exist;
- `activityNodes`' MCP branch uses a `\u0000` placeholder trick — rewrite it plainly;
- `markResult()` must call `noteRunError(body)` on `is_error`;
- the tool_use branch must set `details.dataset.target` (the file basename) before append, so a
  one-file run reads «5.png خوانده شد»;
- `closeCycle()` still expects a card whose parent is the log. With runs, the polling-loop fold
  never fires (safe, but a regression). Make the pair [sentence][run holding one card];
- **thinking:** build no card until the accumulated text is non-blank; call
  `pulsePhase("thinking")` on every delta; render a non-blank `thinking` part from a replayed
  `assistant` event, unless the streamed card already exists;
- **the working line** (`startPulse`/`paintPulse`/`settlePulse`): spark · time · tokens ·
  [running-tasks chip] · phase. It is REMOVED when the turn ends (the site leaves nothing).
  Drop «Esc برای توقف»;
- **CSS:** drop `.msg.assistant::before` (⏺) and its 35px gutter. `.msg.user` becomes a bubble
  and loses its prompt-mark `::before`. Style the `.run` summary as a muted line with a chevron
  and the `.run-err` span;
- **gates:** `static-terminal/spec-test.html` pins the old shapes (`.group`, `.run-more`,
  thinking cards, the pulse's closing line, about lines 1099–1390). `test_column.py` pins the
  user row's mark. Rewrite those checks to the new design and keep each one's invariant: one
  live line, paint once per frame, replay renders what live rendered.

**Not started:**

- P3 (`pcg-368.3`): the Background tasks side panel. `agents.js` already has the registry
  (`/api/agents`: id, kind, description, agentType, model, status, startedAt, finishedAt,
  summary) and a per-agent drawer. The site also shows tokens, tool uses and the current step,
  which the server does not report yet.
- P4 (`pcg-368.4`): the web edition gets P2 and P3.
- The composer's stop ↔ send button with the Send / Queue-for-later menu (checklist item 9).
  File a bead for it once Step 1 settles what it does.

**Also open:** `pcg-8gk`, the Windows-only runs (Edge gate runs, `test_no_console`,
`test_tui_vocab`, `smoke_test`, `probe_edge.py`). A session on the user's PC can do them too.

## State

- **Git:**
  - `main` = `c7e71c8` (message marks, merged as PR #5). What the user builds.
  - `claude/sleepy-hypatia-gaj477` = `main` + `df3bde8` (P1) + `0b23bac` (WIP).
  - Merge to `main` only once P2 is complete and green. The user's rule: they pull `main`
    and build. Every batch so far went through a PR merged with merge_method "merge".
- **Versions:** web 1.5.0, terminal 0.5.0 (the `EDITIONS` table in `server.py`). Bump on the
  merge.
- **Beads:** epic `pcg-368`.
  - `.5` (P0) is Step 1, the visual check, and blocks every open phase.
  - `.1` is closed; `.2` is in progress with this WIP; `.3`, `.4` and `.6` (the composer's
    stop/send button) are open.
  - Export only the changed lines into `.beads/issues.jsonl` (`bd export
    --include-memories`); never `bd dolt push`.

## Gates

**On Linux:** the headless gates need `PCG_BROWSER=<chromium>`. **On Windows:** Edge is
found by default. Terminal edition: `PCG_UI=terminal`. Web edition: unset. `test_bar` and
`test_marks` run both editions when `PCG_UI` is unset.

```
for t in run_spec_test test_column test_keys test_shell test_dialogs test_strings test_reload \
         test_layout test_split test_newsession test_notices test_changes test_zoom \
         test_arrange test_bar test_marks; do PCG_UI=terminal python persian-claude-gui/$t.py | tail -1; done
python persian-claude-gui/test_units.py; python persian-claude-gui/test_transcript_path.py
```

**Last green, at P1:**
- terminal: spec 196, column 31, keys 61, shell 42, dialogs 31, strings 24, reload 9,
  layout, split 172, newsession 26, notices 17, changes 15, zoom 9, arrange 7;
- both editions: bar 39, marks 29;
- web: spec 214, layout, reload 8, split 167.

**Look at the result, not only the numbers.** `shots.py <label> <scene…>` renders the real app
(scenes include `conversation`, `marks`, `bar-*`, `queue`, `panes4`). Put the shots next to the
claude.ai references from Step 1.

## Facts that cost time this session

- **claude.ai is unreachable from the cloud container** (403), share link or not.
- **The CLI's rendering rules are in `wiki/tui-transcript.md`**, with byte offsets.
- **Thinking on disk is mostly empty:** 620 of 755 thinking blocks in this session had empty
  text (signature only). The live renderer drew a «در حال فکر کردن» card for each; the replay
  path drew none. So live and replay already disagreed.
- **A popover inside a popover:** the model flyout is a `position: fixed` child *inside* the
  menu popover, not a second popover. That way opening it does not light-dismiss the menu, and
  the menu's `overflow-y: auto` does not clip it.
- **Test assumptions:** the mode chip used to be painted only by `wrapper/posture`. When a gate
  stops finding something in the status line, check whether the bar now owns it.
