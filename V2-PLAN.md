# V2-PLAN.md — the terminal, drawn with the DOM

**Date:** 2026-09-03. Pinned to `claude` **2.1.259** (`probe_queue.py` 8/8 on that build, same day).
Tracked as bead `pcg-qmy` (`bd list --tree`); phases are `pcg-qmy.1`–`.8`, v2.0 = `.1`.

**What changes:** the shell. **What stays:** everything under it. v1 reached behaviour parity with
the CLI through `server.py` and then dressed it as a chat app (the 2026-08-05 claude.ai-style
shell in `REWORK-PLAN.md` Phases 3 and 5). v2 reverses that one decision. The window becomes a
faithful DOM rendition of the Ink TUI: one column, the TUI's glyphs, the TUI's keys, the TUI's
dialogs, the TUI's wording translated to Persian. The one thing the window adds that the TUI
lacks is the sidebar, projects then sessions. It stays as it is (user decision, 2026-09-03).

## 0. Locked decisions, carried over unchanged

- Runtime B2: Python stdlib server + Edge `--app`. SSE + POST. One long-lived `claude -p`
  process per session, `--resume` after a kill. Unknown events render as a raw-JSON card.
- `claude-persian-rtl-spec.md` rules 1–7 with the dated autoDir amendment. `bidi.js` is untouched.
- No real terminal, no Ink in a browser, no xterm.js. Ink lays text out by cell width with no
  BiDi step, and no terminal emulator on Windows or the web reorders Persian. The DOM is the
  only renderer that shapes Persian for free. This plan is a rendering target, not a runtime.
- `permissions.defaultMode`, `statusLine`, hooks, skills, MCP servers come from the real
  `~/.claude`. Nothing about the CLI is hardcoded; the window mirrors `initialize`.

## 1. Measured on 2026-09-03, all free

| Fact | Consequence |
|---|---|
| The binary updated itself to 2.1.259 that morning. `probe_queue.py` passes 8/8. | The engine contract holds. `smoke_test.py` was not re-run (paid); run it once at the start of Phase 2. |
| `initialize.commands` lists 64 entries on this PC (skills included, so the count is per machine). Each carries only `name`, `description`, `argumentHint`, sometimes `aliases`. | Everything in the list is free parity: the `/` menu mirrors it. |
| The binary's own command registry holds about 40 more names that never reach the pipe: `resume`, `help`, `status`, `export`, `copy`, `cd`, `add-dir`, `branch`, `fork`, `btw`, `bash`, `tasks`, `plan`, `permissions`, `hooks`, `memory`, `config`, `theme`, `keybindings`, `vim`, `voice`, `radio`, `tui`, `teleport`, `desktop`, `mobile`, `remote-control`, `ide`, `chrome`, `plugin`, `update`, `focus`, `brief`, `background`. | That is the honest gap list. §4 says which the window re-provides and which stay out. |
| TUI strings are greppable in the native exe: `LC_ALL=C grep -a -o -E '...' claude.exe`. Keystroke hints (`ctrl+o to expand`, `ctrl+x to stop`, `shift+tab to approve with this feedback`), prompt wording («Would you like to proceed», «don't ask again», «tell Claude what to do differently»), «Pasted text», «※». | v2 Persian text is a translation of the TUI's own strings, pulled from the binary, one table, reviewed once. Nobody authors copy. |
| `~/.claude/history.jsonl`: one JSON object per line, keys `display`, `pastedContents`, `timestamp`, `project`, `sessionId`. The TUI appends to it. | Up/Down and Ctrl+R can share history with the real TUI in both directions. |
| `side_question` is a control subtype (bundle list, `wiki/control-protocol.md` §6). | `/btw` is reachable even though it is not in the 64. |
| `--fork-session` is a spawn flag. | `/branch` is buildable as a respawn. Measure whether the fork keeps the session id family. |
| `~/.claude.json` has no `theme` on this PC; `~/.claude/keybindings.json` does not exist. | Defaults apply. The window reads both when present. |

## 2. Keep, rewrite, delete

**Keep, byte for byte:** `server.py` engine (spawn flags, permission broker, uuid ledger,
`idle_sync`, SSE `seq` cursor, `read_session`, `session_meta`, `transcript_path`, statusLine
passthrough, `/api/control`, `/api/posture`, `/api/effort`, `/api/output-style`, recap),
`bidi.js`, the `window.STRINGS` seam, `setup.ps1`/`setup.bat`, `assets/make_icon.py`, every test,
and the sidebar: `/api/projects`, `/api/sessions`, `/api/tabs`, and the projects→sessions list in
`chrome.js` with its hover preview and kebab menu.

**Rewrite:** `index.html`, `style.css`, `render.js`, `composer.js`, `chrome.js` minus its sidebar, `controls.js`,
`agents.js`, `strings.fa.js`, `help.html`. About 5k of the 11k lines. `app.js` and `api.js`
mostly survive.

**Delete:** home greeting and its four action cards (the empty state shows the TUI's welcome box
instead), the model/effort/style/posture chips, the queue strip as a separate surface (the queue renders as dim
rows in the column, which is what the TUI does), the context notice card.

**Server additions, each one route, stdlib only:**

| Route | For | Notes |
|---|---|---|
| `GET/POST /api/history` | Up/Down, Ctrl+R | Read the tail of `history.jsonl` filtered by `project`; append one line per sent prompt in the TUI's exact shape so the real TUI sees it too. |
| `GET /api/files?q=` | `@` completion | `os.walk` under the session cwd, prefix match, capped. The TUI's own fuzzy list is in-process and unreachable. |
| `POST /api/shell` | `!` bash mode | `subprocess` in the session cwd, output streamed on the hub. Whether it enters the model's context depends on the §5 probe. |
| `POST /api/editor` | Ctrl+G | Write the draft to a temp file, `os.startfile`, poll mtime, hand the text back. The TUI does the same with `$EDITOR`. |
| `POST /api/control` subtype `side_question` | `/btw` | Already routed; needs the reply rendered as a side answer, not a turn. |
| `POST /api/open-file` | `/permissions`, `/hooks`, `/memory`, `/config`, `/keybindings` | `os.startfile` on the real file. The TUI opens an editor for most of these too. |

## 3. Parity matrix

This is the spec for the shell. Columns: the TUI element, where its data comes from, how v2 draws
it, the key, and status (**have** in v1 engine, **build**, **measure** first).

### 3.1 Transcript column

| TUI | Source | v2 | Status |
|---|---|---|---|
| `> prompt` echo, dimmed | `wrapper/user_echo` with uuid | One row, `.path` on any Windows path inside | have |
| Queued prompt, dim, below the running turn | `command_lifecycle` `queued`/`started` | Same row, dimmer, until `started` | have |
| `⏺` assistant text | `assistant` + `stream_event` deltas, rAF-coalesced | Prose through the existing builders, `⏺` as a pseudo-element | have |
| `⏺ Tool(args)` | `tool_use` | One line: Persian verb from `strings.fa.js`, args LTR-isolated, MCP names split as today | have |
| `⎿ result`, collapsed to a few lines, «… +N lines (ctrl+o to expand)» | `tool_result` | Collapsed by default, Ctrl+O toggles every result in the column at once (the TUI's transcript mode) | build |
| `⎿ Error` in red | `tool_result.is_error` | Same row, error colour | have |
| Diff blocks for Edit/Write/MultiEdit | `tool_use.input` | Keep `renderToolDetail()`; restyle as `+`/`-` lines | have |
| `✻ Thinking…` dimmed, collapsible | `thinking` deltas | Keep; restyle | have |
| Todo list with `☐ ☒ ▸` | `TodoWrite` | Keep; restyle to the TUI's checklist | have |
| `Task` row with agent name and nested progress | `tool_use` Task + `initialize.agents` | Keep the label; render child tool rows indented under it | have (indent: build) |
| «※ recap: …» | `/recap` local command on `isAway()` | Keep | have |
| Compact summary banner | `system/compact_boundary` or the summary `user` line | Measure the live shape; render as the TUI's «Conversation compacted» divider | measure |
| Spinner line: verb, elapsed, tokens, «esc to interrupt» | ledger non-empty + `stream_event` usage | One line pinned above the prompt; verb hashed from the prompt as today | have |
| Closing line with cost and time | `result` | Keep the hashed verb and settled time rule (`wiki/frontend-modules.md`) | have |
| Unknown event | anything else | Collapsed raw-JSON card | have |
| «[Pasted text #1 +N lines]» | composer paste | Collapse in the composer, expand on hover, send full text | build |
| `!` output row | `/api/shell` | `$ cmd` line and its output, mono, LTR | build |

### 3.2 Prompt box

| TUI | Source | v2 | Key | Status |
|---|---|---|---|---|
| `>` prompt, grows with content | composer | Mirrored prompt mark (the product mark already is one), `linesAuto()` | | have |
| Newline | | | Shift+Enter, and `\`+Enter | have / build |
| Send | | | Enter | have |
| Interrupt | `interrupt` control with `cancel_queued:false` | | Esc | have |
| ZWNJ | | `U+200C` | Shift+Space | have |
| History | `/api/history` | Walk the project's prompts; unsent draft restored on return | Up/Down at column 0 / last line | build |
| History search | `/api/history` | Incremental filter over the same list | Ctrl+R | build |
| `/` menu | `initialize.commands` + §4 window-local set | Keep the popup; restyle as the TUI's list with descriptions and `argumentHint` | `/`, Up/Down, Tab, Enter | have |
| `@` file mention | `/api/files` | Inline list; sends `@path` as text, the CLI expands it (§5 probe) | `@`, Tab | build |
| `!` bash mode | `/api/shell` | Prompt bar turns to the TUI's bash colour while the line starts with `!` | `!` | build |
| `#` memory | none over the pipe | Out (§4) | | — |
| Image paste / attach | `image` content block | Keep | Ctrl+V, drop | have |
| External editor | `/api/editor` | | Ctrl+G | build |
| Posture cycle | `set_permission_mode` | Keep `pickPosture()` | Shift+Tab | have |
| Clear screen | local | Scroll the column so the prompt sits at the top | Ctrl+L | build |
| Line editing | native `textarea` | Nothing to build; Ctrl+A/E/U/K/W are the browser's | | native |
| Vim mode | TUI-only | Out (§4) | | — |
| Shortcuts overlay | binary strings | The TUI's `?` table, translated | `?` on an empty prompt | build |

### 3.3 Dialogs, all inline in the column, all numbered

| TUI | Source | v2 | Keys | Status |
|---|---|---|---|---|
| Permission: tool preview, then `1. Yes  2. Yes, and don't ask again  3. No, and tell Claude what to do differently (esc)` | `can_use_tool` | Preview through `renderToolDetail()`, then the three options as a list. «don't ask again» keeps the 2026-08-06 scope rule (this project only, this session only) | 1/2/3, Up/Down+Enter, Esc, Shift+Tab approve with feedback | have (keys: build) |
| Plan approval: the plan as markdown, then «Would you like to proceed?» | `ExitPlanMode` over `can_use_tool` | Keep the markdown render; options as above | same | have |
| AskUserQuestion: question, options, «Other» free text | `can_use_tool` AskUserQuestion | Keep the prose builders and the Enter fix; options numbered | digits, Enter | have |
| `/model` picker | `initialize.models` | List with the same descriptions the TUI shows | Up/Down, Enter | have (as chip: move) |
| `/effort`, `/output-style` | `apply_flag_settings`, read back per `wiki/control-protocol.md` §6–7 | Same list shape | same | have (as chips: move) |
| `/resume` | the sidebar | Moves focus into the sidebar's session list; the sidebar itself stays as it is | Up/Down, Enter, Esc back to the prompt | build |
| `/help` | binary strings | The TUI's help text, translated | | build |
| `/status` | `initialize`, `system/init`, `/api/usage` | The TUI's status block: version, model, cwd, session id, posture | | build |
| `/context` | `get_context_usage` | The 64 already includes it; render the CLI's own answer | | have |

### 3.4 Status line, under the prompt

| TUI | Source | v2 | Status |
|---|---|---|---|
| User's `statusLine` command output | passthrough | Keep, first line | have |
| `⏵⏵ accept edits on (shift+tab to cycle)` | `system/status.permissionMode` | Same wording, translated; replaces the pill | build |
| Model, effort, output style | `initialize` + read-backs | Muted, one line, replaces the chips | build |
| Context percent and cost | `wrapper/usage` (two separate patches) | Muted; the «گفتگو پر شده» notice becomes the TUI's inline warning row | build |
| Window title = session title | `session_meta` title | Keep | have |
| Notification on turn end while hidden | `result` + `document.hidden` | `Notification` API, no sound | build |

### 3.5 Commands

- **From the pipe:** every entry of `initialize.commands`, as text, with `argumentHint`. Nothing
  filtered, nothing added to `strings.fa.js` for skills.
- **Window-local, because the TUI has them and the pipe does not:** `/resume`, `/help`,
  `/status`, `/export` (the transcript reader already has the text), `/copy` (last answer to the
  clipboard), `/cd` and `/add-dir` (respawn with the new cwd, same as opening a project),
  `/branch` (respawn with `--fork-session`, §5 probe), `/btw` (`side_question`), `/bash` (same as
  `!`), `/permissions`, `/hooks`, `/memory`, `/config`, `/keybindings` (open the file),
  `/theme` (dark and light from the CLI's own palette, read `~/.claude.json`), `/tasks` (measure
  whether background tasks emit events on the pipe; out if not).

### 3.6 Keys

Lift the defaults from the binary, not from memory. The grep in §1 already found the hint strings;
the builder extracts the default binding table the same way and writes it to `wiki/tui-keys.md`
before Phase 3 starts. `~/.claude/keybindings.json`, when present, overrides it. Keys the browser
owns (Ctrl+W, Ctrl+T, Ctrl+N) stay with the browser; Edge `--app` intercepts them anyway.

## 4. Known differences, will not build

`/vim`, `/voice`, `/radio`, `/tui`, `/teleport`, `/desktop`, `/mobile`, `/remote-control`,
`/ide`, `/chrome`, `/plugin` screens, `/update`, `/focus`, `/brief`, `/background`, `#` memory
shortcut, `auto` posture (measured: zero `can_use_tool`, `wiki/approval-postures.md`), `ultracode`
(`wiki/control-protocol.md` §8). Esc-Esc rewind stays out unless the §5 probe finds a control
subtype. `help.html` lists these under «تفاوت با ترمینال».

## 5. Measure first, free

Each probe reuses `probe_queue.py`'s `Probe`/`control` in an isolated cwd. Record every answer in
`wiki/cli-stream-json-findings.md` under a 2.1.259 heading before writing a line of shell.

1. `!ls` as user text over the pipe: does the CLI run it locally, does it enter context, or does
   the model see a literal `!ls`? Decides whether `/api/shell` is display-only.
2. `@README.md` as user text: does the CLI attach the file? Decides whether `/api/files` sends
   `@path` or the file content as a block.
3. `#note` as user text: expect a plain turn. Confirms `#` stays out.
4. `side_question` control: request shape, response shape, whether it writes the transcript.
5. `--fork-session` spawn with `--resume <id>`: new session id, same project, transcript on disk.
6. Any `rewind`/`checkpoint` subtype: grep the binary's control-subtype list on 2.1.259.
7. `/export` and `/copy` as text: expect refusal in `-p`; confirms window-local.
8. Append one line to `history.jsonl` in the TUI's shape, open the real TUI, press Up. Confirms
   shared history is bidirectional.
9. `/compact` live event shape, so §3.1's divider renders from data.
10. Background tasks: run a `run_in_background` Bash in one paid turn if nothing free reveals the
    event shape. Decides `/tasks`.

## 6. Phases

Each phase ends with every gate in §7 green and a shippable window. Beads: `pcg-qmy.1` (v2.0) through `pcg-qmy.8` (v2.7).

| Phase | Deliverable | Exit criterion |
|---|---|---|
| **v2.0** Vocabulary | `wiki/tui-keys.md`, `wiki/tui-strings.md`: every keystroke, glyph and prompt string pulled from the 2.1.259 binary with the grep in §1 | Both files exist; each string has a Persian column; reviewed once by the user |
| **v2.1** Probes | §5 answered in the wiki | Ten entries, each with the command that produced it |
| **v2.2** Column | `render.js` + `style.css`: §3.1 rows, Ctrl+O, paste collapse, mono/prose typography | spec **174/174** unchanged; `test_layout.py` at three widths; the browser sweep of `M8-acceptance.md` §4 |
| **v2.3** Prompt | `composer.js`: §3.2 keys, history routes, `@`, `!`, Ctrl+G | `test_keys.py` (new, §7); shared history proven against the real TUI |
| **v2.4** Dialogs | §3.3 as numbered inline lists; chips removed; pickers behind commands | `M8-acceptance.md` §6 permission and plan cases pass by keyboard alone |
| **v2.5** Shell | status line §3.4, window-local commands §3.5, home state replaced by the TUI's welcome box; sidebar and tabs untouched | `smoke_test.py` **16/16**; `/api/tabs`, `/api/projects`, `/api/sessions` unchanged |
| **v2.6** Words | `strings.fa.js` regenerated from v2.0's table; `help.html` rewritten with the «تفاوت با ترمینال» list | Every string in the binary table has a translation; `stop-slop` pass on `help.html` |
| **v2.7** Acceptance | `M8-acceptance.md` updated for the TUI-shaped shell; bare-machine run | The colleague completes one task by keyboard without a hint |

Typography, decided here so v2.2 does not stall: prose in Vazirmatn, tool rows, paths and code in
a mono Persian face. Vendor Vazir Code (OFL) into `static/fonts/` if its glyph coverage passes the
spec cases; otherwise keep the current mono stack. No cell grid, ever.

Structure, decided 2026-09-03: the sidebar and in-window tabs stay. One server, one window, one
process per open project, as today. The sidebar is the one surface v2 leaves alone, so `pcg-p7g`
(its visual pass) stays open and applies to v2 as well.

## 7. Gates

Existing, unchanged: `run_spec_test.py` (174), `test_units.py`, `test_layout.py`,
`test_transcript_path.py`, `test_no_console.py`, `probe_queue.py` (free), `smoke_test.py` (one
paid turn). New in v2.3: `test_keys.py`, headless like the spec gate, dispatches each binding from
`wiki/tui-keys.md` at the composer and asserts the action it maps to fired. New in v2.6: a strings
check that fails when a key in the binary table has no entry in `strings.fa.js`.
