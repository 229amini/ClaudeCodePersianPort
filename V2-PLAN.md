# V2-PLAN.md — the terminal, drawn with the DOM

> **What "v2" names** (settled 2026-09-04, after a tag went out under the wrong meaning and was
> withdrawn). **v2 is this rewrite and nothing else:** the terminal-shaped shell *replacing* the
> current web shell — not a large release of the web shell, not a marketing number. The tag
> **`v2.0.0` is reserved** until phase **v2.7** closes and the TUI-shaped window is what ships;
> nobody spends it earlier. Until then the web shell releases as **`1.x`** (`v1.1.0`, 2026-09-04,
> is the current one) and `APP_VERSION` in `server.py` stays on `1.x`. The `v2.0`–`v2.7` labels in
> §6 are **phase names, not release tags** — meeting a phase's exit criteria is not a shipped
> version.

**Date:** 2026-09-03. Pinned to `claude` **2.1.259** (`probe_queue.py` 8/8 on that build, same day).
Tracked as bead `pcg-qmy` (`bd list --tree`); phases are `pcg-qmy.1`–`.8`, v2.0 = `.1`.

> **2026-09-04, branch `v2`.** The binary self-updated to **2.1.260** overnight. `probe_queue.py`
> re-run: **8/8** — the engine contract in §0/§1 holds unchanged on the new build. v2.0 is done
> (`wiki/tui-keys.md`, `wiki/tui-strings.md`, gated by `test_tui_vocab.py` 72/72); its measured
> numbers below are restated against 2.1.260. The overnight update is itself the argument for
> §3.6's "lift from the binary": a hand-written key table would already have been stale.

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
| TUI strings are greppable in the native exe. **Superseded 2026-09-04 by `extract_tui_vocab.py`**, which does this reproducibly and is gated: 21 strings and 12 glyphs, each verified present in the installed build. | v2 Persian text is a translation of the TUI's own strings, pulled from the binary, one table, reviewed once. Nobody authors copy. Table: `wiki/tui-strings.md`. |
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
| `GET /api/history` | Up/Down, Ctrl+R | Read the tail of `history.jsonl` filtered by `project`; one line per sent prompt is appended in the TUI's exact shape, so the real TUI sees it too — from inside `/api/message`, not from a POST route (v2.3 decision 1). **Take `history.jsonl.lock` first** — the CLI runs a retention prune that rewrites the whole file (§5.8). |
| `GET /api/files?q=` | `@` completion | **Proxy the CLI's own `file_suggestions` control request** (§5.11) and inherit its ranking; `os.walk` only as the fallback while the index is cold. The first query after a spawn returns nothing, so the menu re-asks. |
| `POST /api/shell` | `!` bash mode | `subprocess` in the session cwd, output streamed on the hub. **Measured (§5.1): the CLI will not run it, and the TUI's own bash output DOES enter context** — send it back as a user message tagged `<bash-input>`/`<bash-stdout>`/`<bash-stderr>`, which is what the transcript reader expects. |
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
| Clear the composer | local | Empty the prompt box — this is what the binary binds Ctrl+L to (`chat:clearInput`), corrected §8.6 | Ctrl+L | build |
| Clear screen | local | Scroll the column so the prompt sits at the top. **No chord:** the TUI binds it to `cmd+k`, which has no Windows binding (§8.6) | — | build |
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

Lift the defaults from the binary, not from memory. **Done (2026-09-04):**
`persian-claude-gui/extract_tui_vocab.py` parses the binding table out of `claude.exe` — it is a
single-file Node SEA, so the bundled JS sits verbatim inside it and the table is findable as its
own source text. 206 bindings, 25 contexts, written up in `wiki/tui-keys.md` with a «کلید v2»
column and five deliberate deviations (ctrl+v, shift+Enter, digit-picked dialog options, ctrl+o
for expand, and the seven "cannot be rebound" keys that are terminal facts a browser does not
share). `~/.claude/keybindings.json`, when present, overrides it. Keys the browser
owns (Ctrl+W, Ctrl+T, Ctrl+N) stay with the browser; Edge `--app` intercepts them anyway.

## 4. Known differences, will not build

`/vim`, `/voice`, `/radio`, `/tui`, `/teleport`, `/desktop`, `/mobile`, `/remote-control`,
`/ide`, `/chrome`, `/plugin` screens, `/update`, `/focus`, `/brief`, `#` memory
shortcut, `auto` posture (measured: zero `can_use_tool`, `wiki/approval-postures.md`), `ultracode`
(`wiki/control-protocol.md` §8), `ctrl+s` `chat:stash` (decided §8.7).
`help.html` lists these under «تفاوت با ترمینال».

**Two names left this list on 2026-09-05, because §5 measured them reachable:**

- **`/tasks` and `/background`** — background tasks emit a full event family on the pipe
  (§5.10). In scope.
- **Esc-Esc rewind** — the plan said it "stays out unless the §5 probe finds a control
  subtype". The probe found two (§5.6). The exclusion is lifted; whether v2 *spends* a phase on
  it is the one scope question left open in §8.

## 5. Measure first — ANSWERED 2026-09-05 on 2.1.261 (`pcg-qmy.2`)

Full write-up with evidence: `wiki/cli-stream-json-findings.md`, §"2.1.261 — V2-PLAN §5".
`persian-claude-gui/probe_v21.py` re-runs the live half for free (**25/25**). Total spend for
the whole phase: **$0.107**, from one probe that turned out to be paid and is now pinned so
nobody pays for it twice.

The method the plan did not anticipate: **six of the ten were answered by reading the bundle**,
not by running it. `extract_tui_vocab.py` already proved the SEA carries its JS verbatim, so
"what shape does this event have" is answerable at the construction site — exactly, for free,
and without a login. A black-box turn is the weaker measurement *and* the expensive one.

| # | Question | Answer | Consequence |
|---|---|---|---|
| 1 | `!ls` over the pipe | **The model sees literal text.** `!` is a TUI *input mode* (`mode:"bash"`), stripped in the input-state constructor; a stream-json frame has no `mode` | `/api/shell` runs the command itself. **Not display-only:** the TUI feeds output back as a user message tagged `<bash-input>`/`<bash-stdout>`/`<bash-stderr>`, so it enters context and v2 must do the same |
| 2 | `@README.md` over the pipe | **The CLI attaches it.** At-mention extraction is a pure text scan with no interactive gate | v2 sends `@path` as text; `/api/files` never sends file content |
| 3 | `#note` over the pipe | Plain turn, as expected (`#` is the `<user-memory-input>` mode) | `#` stays out, now measured |
| 4 | `side_question` | Routed. `{question, history?}` → `{response, synthetic, refusal_fallback?}`. **It costs a turn** — no malformed payload gets refused before the model sees it | `/btw` is buildable and renders as a side answer, not a turn. It is a paid action and the window should not pretend otherwise |
| 5 | `--fork-session` | **New session id, same project folder, both transcripts on disk** | `/branch` is a respawn. The sidebar already lists both — no new code |
| 6 | rewind subtype | **Two of them.** `rewind_conversation {target_message_uuid, interrupt_if_running?}` → `{rewound, prefillText, precedingAssistantUuid, error}`, routed. `rewind_files {user_message_id, dry_run?}`, routed but feature-gated off on this PC | §4's exclusion is **lifted**. Now a scope question, not a capability one — see §8 |
| 7 | `/export`, `/copy` | Refused locally, free, with a full uuid lifecycle. So is any unknown command | Window-local, confirmed. And the spinner ends on the event, not on the silence watchdog |
| 8 | `history.jsonl` | Shape confirmed (`display`, `pastedContents`, `timestamp` ms, `project`, `sessionId`). **But the CLI rewrites the file** under a `history.jsonl.lock` retention prune | **v2 takes the lock before appending.** A blind append can be dropped by a concurrent prune. The other half — press Up in the real TUI — needs a human at a terminal |
| 9 | `/compact` shape | `system/compact_boundary` with `compact_metadata{trigger, pre_tokens, post_tokens?, …}`; TUI content string `Conversation compacted` | §3.1's divider renders from data. No paid compaction needed |
| 10 | background tasks | **They emit.** `background_tasks_changed`, `task_started`, `task_progress`, `task_notification`, `task_summary`, plus a `stop_task` control request | **`/tasks` is IN.** §4's "out if not" does not apply, and the paid turn this probe budgeted was never needed |
| **11** | *(not in the plan)* `file_suggestions` | **The CLI's own fuzzy file index is a control subtype.** `{query}` → `{suggestions:[{path, score}]}` | §2's "in-process and unreachable" is measurably wrong. `/api/files` proxies it and inherits the CLI's ranking |

### 5a. What the probes settled

Decided here, on the measurements above, so no later phase re-opens them:

- **`/api/files` proxies `file_suggestions`**, keeping `os.walk` only as the fallback for the
  cold-index window. Measured quirks the `@` menu has to handle: the **first query after spawn
  returns zero** (the index warms on demand); results come back cwd-relative first and then as
  **absolute** paths from `~/.claude/skills` and `~/.claude/agents`, which the menu filters;
  matching is on filename substrings, so `src/` is not a query.
- **`/api/shell` executes locally and injects the TUI's tags.** Display-only was the other
  option and it is now measurably the wrong one.
- **`/api/history` takes `history.jsonl.lock`** before appending. Non-negotiable: the CLI
  rewrites that file under it.
- **`/tasks`, `/branch` and `/btw` are in scope**, all three moved out of §4 or off "measure".

### 5b. Still open, and only a human can close it

- **§5.8's second half.** Append a line to `history.jsonl`, open the real TUI, press Up. Needs
  an interactive terminal and a person watching it. Everything up to it is measured.

## 6. Phases

Each phase ends with every gate in §7 green and a shippable window. Beads: `pcg-qmy.1` (v2.0) through `pcg-qmy.8` (v2.7).

| Phase | Deliverable | Exit criterion |
|---|---|---|
| **v2.0** Vocabulary ✅ | `wiki/tui-keys.md`, `wiki/tui-strings.md`: every keystroke, glyph and prompt string pulled from the 2.1.260 binary by `extract_tui_vocab.py` | **Done 2026-09-04**, except the user's one review of the Persian column (`wiki/tui-strings.md` §7 lists the six rows that need it). Gated by `test_tui_vocab.py` — 72/72 |
| **v2.1** Probes ✅ | §5 answered in the wiki | **Done 2026-09-05.** Eleven entries (ten asked, one found), each with the command or the bundle site that produced it, in `wiki/cli-stream-json-findings.md`. `probe_v21.py` re-runs the live half free — 25/25. Only §5.8's "press Up in the real TUI" is left, and it needs a human |
| **v2.2** Column ✅ | `render.js` + `style.css`: §3.1 rows, Ctrl+O, paste collapse, mono/prose typography | **Done 2026-09-05.** spec **174/174** unchanged, `test_layout.py` 3/3 widths, `test_units.py`, `test_transcript_path.py`, `test_no_console.py` green, `test_tui_vocab.py` **79/79**. New gate `test_column.py` — **22/22**, headless, no `claude` process. Decisions below |
| **v2.3** Prompt ✅ | `composer.js`: §3.2 keys, history routes, `@`, `!`, Ctrl+G | **Done 2026-09-05.** spec **174/174** unchanged, `test_units.py` (+26 over the four new routes), `test_layout.py`, `test_transcript_path.py`, `test_no_console.py`, `test_tui_vocab.py` **79/79**, `test_column.py` **22/22**. New gate `test_keys.py` — **40/40**, headless, no `claude` process, its chords read out of `wiki/tui-keys.md`. The one half left is §5b's: pressing Up in the REAL terminal, which needs a human at one. Decisions below |
| **v2.4** Dialogs ✅ | §3.3 as numbered inline lists; chips removed; pickers behind commands | **Done 2026-09-05.** spec **174/174** unchanged, `test_units.py` (+4 over the refusal note), `test_layout.py` 3/3 widths — now measuring the picker in the flow, `test_transcript_path.py`, `test_no_console.py`, `test_tui_vocab.py` **79/79**, `test_column.py` **22/22**, `test_keys.py` **60/60** (+20, the whole `Confirmation` context). New gate `test_dialogs.py` — **31/31**, free, no browser: the shape the keys are dispatched at. §3.3's `/resume`, `/help` and `/status` rows are not built — see 8.11. Decisions below |
| **v2.5** Shell ✅ | status line §3.4, window-local commands §3.5, home state replaced by the TUI's welcome box; sidebar and tabs untouched | **Done 2026-09-05.** spec **174/174** unchanged, `test_units.py` (+14 over the four new routes), `test_layout.py` 3/3 widths — now measuring the welcome box, `test_transcript_path.py`, `test_no_console.py`, `test_tui_vocab.py` **79/79**, `test_column.py` **22/22**, `test_keys.py` **60/60**, `test_dialogs.py` **31/31**. New gate `test_shell.py` — **29/29**, free, no `claude` process. `smoke_test.py` NOT run: it spends a paid turn and `/api/tabs`, `/api/projects`, `/api/sessions` are untouched in the diff. Decisions below |
| **v2.6** Words ✅ | `strings.fa.js` regenerated from v2.0's table; `help.html` rewritten with the «تفاوت با ترمینال» list | **Done 2026-09-05.** spec **174/174** unchanged, `test_units.py`, `test_layout.py` 3/3 widths, `test_transcript_path.py`, `test_no_console.py`, `test_column.py` **22/22**, `test_keys.py` **60/60**, `test_dialogs.py` **31/31**, `test_shell.py` **29/29**. `test_tui_vocab.py` **82/82** (+3: the five-hour threshold re-derived from the bundle). New gate `test_strings.py` — **24/24**, free, no browser and no `claude` process. `/help` is built (8.11A closed); the authored copy §8.10B parked is listed for one review in `wiki/tui-strings.md` §8. Decisions below |
| **v2.7** Acceptance | `M8-acceptance.md` updated for the TUI-shaped shell; bare-machine run | **docs ✅ 2026-09-05** — `M8-acceptance.md` rewritten end to end for the shell v2.2–v2.6 actually built (§3–§7: welcome box, numbered dialogs with Esc/shift+Tab semantics, status-line stack, slash commands, `/help`), cross-checked against `test_column.py`/`test_keys.py`/`test_dialogs.py`/`test_shell.py`/`test_strings.py` so no control is claimed that no test implements; the stale v1 posture-pill/model-chip claims are corrected. CLAUDE.md's gate table: `test_tui_vocab.py`'s stale count fixed **72 → 82**, and `test_column.py` (22), `test_keys.py` (60), `test_dialogs.py` (31), `test_shell.py` (29) and `test_strings.py` (24) added. Free gates re-run green: units, `run_spec_test.py` **174/174**, layout, transcript_path, no_console, tui_vocab **82/82**, column **22/22**, keys **60/60**, dialogs **31/31**, shell **29/29**, strings **24/24**. **Bare-machine run + colleague task pending (owner)** — needs a physical PC and a human, neither available unattended. |

Typography, decided here so v2.2 does not stall: prose in Vazirmatn, tool rows, paths and code in
a mono Persian face. Vendor Vazir Code (OFL) into `static/fonts/` if its glyph coverage passes the
spec cases; otherwise keep the current mono stack. No cell grid, ever.

Structure, decided 2026-09-03: the sidebar and in-window tabs stay. One server, one window, one
process per open project, as today. The sidebar is the one surface v2 leaves alone, so `pcg-p7g`
(its visual pass) stays open and applies to v2 as well.

### v2.2 Column — decisions taken while building it, 2026-09-05

Each of these was decidable without the owner. The one thing that was not is §8.9, still open.

1. **The `⎿` result branch is a chip on the `<summary>` row, not a second line.** `spec-test.html`
   pins `.card-body > .tool-output` as a direct child *and* asserts the summary stays one line, so
   a footer under the result would have to break one of them. §3.1's "+N lines" describes the TUI;
   v2's own column spec is "collapsed by default, Ctrl+O toggles every result at once", and a shut
   `<details>` already is that. What was missing was the toggle and a count of what is hidden.
2. **Ctrl+O opens every card if any is shut, otherwise shuts them all.** One binding, one state,
   matching `app:toggleTranscript`. The TUI's third state (`ctrl+e`, show-all) belongs to a
   Transcript context v2 does not build — §6's "contexts v2 does not build" table.
3. **The `⏺` marker is placed with physical `right`/`padding-right`, not logical insets.** `.msg`
   is `unicode-bidi: plaintext` with `dir="auto"`; a logical property would put the marker of a
   Persian answer and an English one on opposite sides of the same column. The one place in
   `style.css` where physical is correct, and it carries that comment.
4. **Glyphs are lifted from the 2.1.261 bundle, not recalled** (§3.6): the twelve pulse frames and
   the settled `✻`, the `☑ ▸ ☐` checklist marks, `⎿`. The unused `think` icon path was deleted
   rather than left as a second source of truth.
5. **Paste thresholds are the binary's: 800 characters or more than 2 newlines** (`var o9=800`,
   `S.length>o9||T>2`), and both placeholder shapes come from `cue()`. `test_tui_vocab.py` §9
   re-derives all four from the installed build, so they cannot drift into disagreeing with the
   terminal beside the window — the failure mode where nothing looks broken.
6. **A parked paste never reaches the server as a placeholder.** The chip holds the text in the
   page; submit expands `[متن چسبانده‌شده #N]` back before the POST. The wire contract, the
   uuid ledger and `command_lifecycle` are untouched by this phase.
7. **Subagent rows nest inside the `Agent` card by swapping the render target**, the same
   scope-swap shape the agents drawer already uses, and the sidechain guard narrowed from "drop
   every event carrying a `parent_tool_use_id`" to "drop all of it except a `tool_result` for a
   card we know". `wiki/background-agents.md` measured both halves: the phantom English echo the
   old guard existed to kill still carries that key, and the real `tool_result` arrives with
   `parent_tool_use_id: null`, so the narrower guard still cannot eat it. Live runs are
   unaffected — the same file records that a subagent's own events never reach the parent's
   stdout — this is what a replayed transcript now shows instead of a blank card.
8. **Diff rows needed no work.** They have been `+`/`−` tinted lines since 2026-08-07; §3.1's
   "restyle as +/- lines" was already satisfied, and re-doing it would have been churn.
9. **Vazir Code is not vendored.** §6 makes it conditional on glyph coverage passing the spec
   cases, which needs a human looking at rendered text; the sanctioned fallback is the current
   mono stack, where Persian already falls back to Vazirmatn. No cell grid, as ever.
10. **The `!` shell-output row is deferred to v2.3**, which owns `!` in §3.2 — there is no
    `/api/shell` yet, so a row for its output would render nothing.
11. **The compaction divider reads `pre_tokens`/`post_tokens` and nothing else**, because
    `wiki/cli-stream-json-findings.md` §5.9 measured that those are the only fields
    `system/compact_boundary` carries.
12. **One code commit, not three.** The column and the paste chip share `index.html`,
    `style.css` and `strings.fa.js`, and `test_column.py` covers both; splitting them would have
    produced an intermediate commit whose own gate was red, which is worse than a wide one.

### v2.3 Prompt — decisions taken while building it, 2026-09-05

Every one of these was decidable without the owner. What is left for them is at the end.

1. **`/api/history` is GET-only; the append happens inside `/api/message`.** §2's table said
   «GET/POST», and a POST route would have been a second place a prompt can be recorded —
   reachable without sending, and skippable when sending. Written at the one point where a
   message actually goes out, nothing can send without recording and nothing can record without
   sending. §2's «GET/POST» is corrected to that.
2. **The lock is a `mkdir`.** proper-lockfile builds `history.jsonl.lock` as a *directory*, so
   `mkdir` contends for the same object the CLI's prune takes, atomically, with no dependency.
   A lock whose mtime is older than 15 s is stolen: a prune that died holding it would otherwise
   lock the user out of their own history until a reboot.
3. **A lock we cannot take skips the history line, never the send.** The message is the thing the
   person typed; the history entry is a convenience. Failing the send to protect the list would
   be the worse trade in every direction.
4. **`!` output is PARKED, not sent.** §5.1 measured that the TUI's bash output enters the
   conversation — but the TUI does not ask the model anything when it runs one, and the pipe has
   no "add to context" frame. So the tagged text waits and rides in FRONT of the next real
   message as its own text block. Sending it on its own would spend a paid turn per `!ls`, which
   is a thing the terminal this window imitates never does.
5. **`!` runs through `COMSPEC` as `/s /c "<command>"`**, the form `run_statusline()` already
   uses and for the same reason (cmd eats the outer quote pair of anything else). Output is
   clipped at 20k characters, because the parked text goes into the model's context and
   `!type big.log` would otherwise buy a very expensive turn.
6. **Absolute `@` suggestions are dropped on the SERVER, not in the menu.** §5a said the menu
   filters them; the server is the only side that sees both sources, and the CLI index and the
   `os.walk` fallback have to hand the composer one shape. What is dropped is what cannot be
   `@`-mentioned relatively — `~/.claude/skills`, `~/.claude/agents`.
7. **Enter never accepts a completion, in the `@` menu either.** Tab accepts, Enter sends. This
   is the 2026-08-06 rule the slash popup already lives by: Enter doing different things
   depending on invisible state is the trap that handler was fixed for once already.
8. **The `ctrl+x` prefix arms only on an empty selection**, and expires after three seconds.
   With a selection, ctrl+x is cut and has to stay cut; with none it does nothing, which is
   exactly the room a two-stroke prefix needs. `test_keys.py` asserts both halves.
9. **`ctrl+x Enter` is an ordinary submit.** The CLI's own queue already folds a mid-turn send
   (`wiki/cli-stream-json-findings.md` «The message queue»), so a separate queue path would be a
   second implementation of something the engine does better than the window could.
10. **`ctrl+x ctrl+k` is not bound.** `chat:killAgents` needs `stop_task` and the rest of the
    background-task family (§5.10), which has no phase yet. The wiki row is blanked with that
    reason rather than left describing a key that does nothing — and because `test_keys.py`
    reads that column, a promise with nothing behind it is now a failing gate.
11. **History is dropped on a tab switch, not snapshotted.** It is per project and one GET away;
    a snapshot that survived the switch would offer another project's prompts under Up, which is
    the same class of defect as the statusline and the model picker that shipped it twice.
12. **The `?` sheet and the dispatcher read one list.** The sheet is built from `KEY_SHEET` in
    `composer.js`, so it cannot advertise a key the page does not bind; `test_keys.py` then
    compares the page against `wiki/tui-keys.md`, which `test_tui_vocab.py` compares against the
    binary. Binary → wiki → page, with a gate on each arrow.
13. **`ctrl+t` is bound even though Edge `--app` eats it.** §3.6's standing rule is that keys the
    browser owns stay with the browser — that is about not fighting it, not about refusing to
    bind. In a normal tab the checklist toggle works; under `--app` the browser wins, silently
    and correctly.
14. **Ctrl+G blocks until the file stops changing.** `os.startfile` hands the path to the shell
    and returns, so there is no "the editor closed" event to wait for; the first save wins, with
    a one-second settle for editors that write in two passes. The box says it is waiting, and the
    draft is in the file the whole time.
15. **Esc accepts the history search.** That is what the binary binds (`historySearch:accept`,
    on `escape` and `tab` alike), so the search has no destructive exit at all — which is also
    why Esc there does not fall through to the interrupt.

**Left for the owner** (product taste, not engineering): §8.9's glyph mirroring is still the
open one. Two more arrived with this phase and are listed there.

### v2.4 Dialogs — decisions taken while building it, 2026-09-05

Every one of these was decidable without the owner. What is left for them is at the end and in 8.11.

1. **The dialogs stay `<dialog>` elements, opened with `show()`.** The phase is about where they
   sit, not what they are made of: `show()` leaves the element in the flow, and `position: static`
   plus `flex: none` undoes the UA's modal geometry. Rebuilding them as `<div>`s would have
   rewritten every `#perm-*` id the 174 spec assertions read, for a result the browser already
   offers.
2. **One numbered list, three owners — `static/js/choice.js`, a leaf.** The confirmation, the
   pickers and the audit trail draw the same rows; a leaf module can be shared by `chrome.js`
   (inside the render cycle) and `controls.js` (outside it) without adding an edge to either.
3. **The list is one tab stop with a moving highlight, not a radio group.** That is what the TUI
   is, and it is also the only shape where a digit can answer outright: a radio group would make
   «۲» mean *move the focus*, then need a second key to commit.
4. **`#perm-form` has no submit button at all.** The 2026-08-31 defect («Enter in the note field
   silently refuses the tool») was an implicit submit finding the first button, which was the
   refusal. Every button is `type="button"`, the form has no `method="dialog"`, and every key is
   bound explicitly. `test_dialogs.py` gates the structure, because the behaviour is invisible
   until someone adds a `<button>` back.
5. **Esc refuses a permission and skips a question.** Dismissing is never consent — but a question
   is not a request for consent, so Esc there sends an allow with no answers, which is what the
   TUI's skip does. Both halves are in `test_keys.py`.
6. **A refusal carries what to do instead; an approval cannot.** `can_use_tool`'s deny reply has a
   `message` field and the allow reply has only `updatedInput`
   (`wiki/cli-stream-json-findings.md`). So option 3 sends the typed note as the model's reason
   instead of «user decision» (`server.py`, `test_units.py`), and shift+Tab — approve *and* say
   this — approves the tool and hands the note to the composer through `restoreDraft()`, saying
   so out loud. Text that moves without a word is text the person thinks they lost.
7. **A plan approval draws two options, not three.** There is no next call to stop asking about,
   so «۲» is simply not drawn and the refusal is «۳» → «۲». This is §8.2's rule paying off: the
   digit is chrome the renderer places, so a missing option renumbers the list instead of lying.
8. **The remember checkbox stays in the markup, hidden.** The scope is option 2 now, but
   `#perm-remember-row` is what the spec harness's «a question offers no remember» case reads,
   and `chrome.js` still honours it if something ticks it. Deleting it would have cost three
   assertions to say nothing new.
9. **The pickers are the commands, by import.** `composer.js` calls `openModelPicker()` and the
   other three directly instead of `.click()`-ing a chip that no longer exists. `controls.js`
   imports nothing from the render cycle, so the new edge points one way. An opener with nothing
   to offer returns `false` and the verb falls through to the CLI as ordinary text — exactly what
   a hidden chip used to do.
10. **The audit counter stays on the composer row; the four capability chips go.** It is a label
    for something that already happened, not a control (`.chip-btn.is-info`, no hover, no
    pointer), and clicking it opens the list of what was auto-approved. §2 deletes controls, not
    reporting.
11. **A question keeps its own inputs and its two buttons.** «Send the answers» and «skip» are not
    rows in a list — they are what happens to whatever the inputs hold. The options are still
    numbered and digits still pick, but the toggling is implemented explicitly rather than left to
    the browser: synthetic `KeyboardEvent`s run no default action, so a native checkbox toggle
    cannot be gated headlessly and would have been the one keyboard path nothing checks.
12. **A digit typed into the free-text answer is a digit.** The handler skips any event whose
    target is `.ask-free`. Otherwise the one field on screen for writing an answer could not hold
    «۱ فنجان».
13. **`test_layout.py` now measures the picker instead of the popup, and by width alone.** The
    gate existed because a hand-positioned menu came back 201px wide; a row in the flow cannot
    reproduce that, so what is left to assert is that it never comes back narrow anyway. Its
    margins repeat the composer's centred-column formula, so the list sits over the box it
    answers for.
14. **`spec-test.html` keeps `#model-chip` after `index.html` dropped it.** Three assertions about
    a background tab's model not leaking into the visible one read that label, `controls.js`
    paints it wherever it exists, and `initControls()` binds nothing without `#picker`. The
    harness is a fixture, not a copy of the page.

**Left for the owner** (product taste, not engineering): 8.9's glyph mirroring and 8.10's two are
still open; 8.11 adds what this phase deliberately did not build.

### v2.5 Shell — decisions taken while building it, 2026-09-05

Every one of these was decidable without the owner. What is left for them is at the end and in 8.12.

1. **The status line is a stack of three rows, in §3.4's own order.** The machine's `statusLine`
   output first, the `⏵⏵` posture row second, the muted facts row third. §3.4 lists four sources and
   v2.4 deleted the pill and the chips that carried two of them; a stack is the only shape where a
   line that is absent (no custom command, no posture yet) costs no space.
2. **The posture row follows the WRAPPER's posture, with the CLI's `permissionMode` as the
   fallback.** «محتاط» and «خودکار» are BOTH `default` down the pipe — the difference is the
   wrapper's own auto-approve flag (`server.py POSTURES`) — while a mode nobody here set
   (`bypassPermissions`, `auto`) only ever arrives as a mode. The fallback is what keeps §8.4's
   display-only names on screen.
3. **`posture`, `effort` and `style` live in `state.status`, the per-tab render scope.** That is
   already the object `applySwitch()` repaints a tab from, so a background conversation records its
   own style without painting it — and `controls.js` needs no new edge back into the render cycle.
4. **The turn-end notification is gated on `!ev.replayed`, threaded through
   `endBatch(settled, live)`.** An SSE backlog runs every finished turn through the same settle; a
   refresh at 3 a.m. would otherwise fire one notification per turn ever taken.
5. **Notification permission is asked at the moment there is something to say, never at load.** A
   permission prompt on startup is the one everybody denies for ever.
6. **The home state is the binary's own welcome box.** `✻` + title + dim version, the folder, and
   the three hints the TUI keeps under an empty prompt — read out of `claude.exe`, not remembered.
   The greeting, the four action cards and the resume card are deleted: the sidebar and `/resume`
   already answer «which conversation», and §2 deletes controls the terminal does not have.
7. **The window title is the session title plus the app name, and falls back to the app name
   alone.** §3.4's «Window title = session title» row was «Keep» against a title that was never
   actually set; `syncWindowTitle()` is called from the two places a title can arrive.
8. **`#context-notice` is a restyle, not a rewrite.** The «گفتگو پر شده» notice becomes the TUI's
   one-line warning row in CSS only: its `.ctx-*` elements and its 2-or-3 button counts are read by
   the 174 spec assertions, and the per-button note moved to a `title` attribute rather than out of
   the DOM.
9. **The window-local commands are their own module, `static/js/commands.js`.** It is imported BY
   `composer.js` and imports nothing that imports it back, so the `render ↔ chrome ↔ composer` cycle
   `app.js` documents is still the only one.
10. **Every command answers true/false synchronously; false sends the line to the CLI as text.**
    The same contract v2.4 gave the pickers — a verb with nothing to do falls through — and the
    network half is started and left to finish, so no command holds the composer shut.
11. **`/bash` stays in `composer.js` and `/permissions` stays on the posture picker.** `!` is a
    composer mode, so `/bash ls` is the same call the `!` line makes rather than a second copy of
    it; the picker is the surface that names the four levels and changes the LIVE posture, which is
    what the TUI's screen does first. The real file is reachable as `/config`.
12. **`/cd` and `/add-dir` are the same command.** One conversation has exactly one cwd —
    `server.py` spawns the CLI in it — so «add a directory» has no second meaning here, and both
    open the folder the way the sidebar's own button does.
13. **`/copy` and `/export` read the column, not a transcript file.** The window already has the
    conversation as text because it drew it; a second reader would be a second answer to «what was
    said», and the two would disagree the first time the renderer changed.
14. **`/branch` switches to the fork, and says so in the fork's own column.** Switching tabs swaps
    the render target, so a note written before the switch is left behind in the conversation that
    was forked.
15. **`/btw` says it costs a turn BEFORE it sends, and its answer is a side row.** Measured
    (§5.4): `side_question` is routed and paid. The `※` rows are dimmed, sit against a rule and
    give up the transcript's `⏺` — the mark of a turn this conversation actually took, which this
    is not: the CLI answers out of band and neither row enters the context.
16. **`/tasks` unfolds the agents strip rather than building a second list.** The strip is already
    the registry of background helpers and already hides finished rows behind a toggle. The pipe's
    own task event family (§5.10) is NOT subscribed to: `background_tasks_changed` and its four
    siblings are renderer work — new row shapes, a `stop_task` control — and this phase's subject
    is the shell. Deferred to whichever phase takes the renderer next.
17. **`/status` renders through the same numbered list every other dialog uses.** Its digits do
    nothing, exactly as on the audit list; one list shape is worth more than a read-only variant of
    it. Every value comes from this tab's own status object, so the block answers while a turn runs.
18. **`/resume` is a roving tabindex on the session rows, and nothing else.** §8.11B asked for
    focus in the sidebar: exactly one row is in the tab order at a time (so Tab still leaves the
    list in one press), Up/Down move it, Esc goes back to the prompt, and Enter is left alone —
    the rows are `<button>`s and already activate on it. Focus now survives a sidebar repaint, the
    way `agents.js` already handed it back.
19. **`/help` is still v2.6's, per 8.11A, and `/theme` is the owner's, per 8.12.** Both fall
    through to the CLI, which refuses them locally and free.
20. **Rewind (8.8, 8.11C) was not built here either.** It is a renderer change — its own dialog
    plus a truncation path in the column — and this phase's diff is the shell. Still the owner's
    call whether it ships in v2 at all.
21. **`test_layout.py` now measures `.welcome` where it measured `.greeting`.** The element it was
    named for is gone; the gate's question — does the empty state stay on the window at 500px — is
    unchanged.

**Left for the owner** (product taste, not engineering): 8.9's glyph mirroring, 8.10's two, 8.11's
`/help` scheduling and rewind, and the two 8.12 adds.

### v2.6 Words — decisions taken while building it, 2026-09-05

Every one of these was decidable without the owner. The words themselves are not: the review list
is at the end and in `wiki/tui-strings.md` §8.

1. **`/help` is generated from the command tables, not lifted from the binary.** §3.3 says «the
   TUI's help text, translated», and §3.6's standing rule is to lift rather than remember — but
   the help screen is a `local-jsx` component in a lazily loaded chunk and its prose is not
   findable in the SEA as source text, unlike the binding table and the status strings, which
   are. What is findable says «Show help and available commands» and nothing more. And the screen
   itself is a page *about a terminal program*: how to launch it, which flags it takes, where its
   docs live. A window that is already open answers none of those. What translates is its **job**
   — what can I ask this window to do — so the list is built from `WINDOW_COMMANDS`,
   `LIFECYCLE_VERBS` and `ARG_VERBS`, and `test_strings.py` fails in both directions: a verb the
   window answers and the list does not name, and a row with nothing behind it.
2. **`COMPOSER_VERBS` in `commands.js` is a copy, and the gate is what makes it safe.**
   `composer.js` imports `commands.js`, so its six verbs cannot be imported back without closing
   a second cycle. Same shape as v2.3's key sheet: binary → wiki → page, one arrow, one gate.
3. **The `strings.fa.js` key lives in the wiki table, not in a map inside the test.** The table
   is where a translator looks; a mapping hidden in a Python file would be a second table, and
   the second one always rots. `test_strings.py` reads the column.
4. **Three rows had a translation and no key at all**, and each needed a line of renderer to have
   somewhere to live: the running turn's line now ends with «Esc برای توقف» (§3.1 always listed
   it), an accepted plan says «طرح ذخیره شد» rather than «اجازه داده شد» — nothing was run, a
   plan was kept, which is why the TUI has its own word for it — and the status line grows a
   warning row when the five-hour window is nearly spent (§3.4 row 4). A translation with no
   surface is not a shipped string.
5. **The five-hour threshold is the binary's `0.95`, not the per-plan `0.99`/`0.9975`.** The
   bundle raises the bar for `default_claude_max_5x` and `_20x`, but which plan the account is on
   never reaches the wrapper — `get_usage` hands over `rate_limits.five_hour.utilization` and
   nothing else. So the window warns at the conservative default, and `test_tui_vocab.py` §10
   re-derives all three numbers from the installed build so a change upstream is a failing gate
   rather than a window that warns at the wrong moment.
6. **`queue.stop` is dropped the way §8.5 dropped `exit.hint`.** «ctrl+x to stop» describes the
   TUI's running-turn footer; in v2 `ctrl+x` is the queue prefix (v2.3 decision 8) and stopping
   is Esc, which the spinner line now says out loud. Translating it would document a key that
   does nothing — §8.5's rule, applied a second time.
7. **`rewind.hint` keeps its translation in the wiki and ships nothing.** The feature is 8.11C's
   and still unbuilt; a key in `strings.fa.js` with no surface is exactly the dead copy this
   phase deleted eight of. The row stays in the table against the day it is built.
8. **Eight keys nothing reads any more are deleted** — `appTagline`, `connecting`,
   `deleteFailed`, `independence`, `slNone`, `slashHint`, `toolResult`, `waiting`. All were the
   v1 shell's. The visible independence notice is in `help.html` and `README.md`, which is where
   the branding decision put it; the JS copy had no reader.
9. **The orphan check runs in the direction `test_dialogs.py` does not.** That gate asks whether
   every `FA.*` the modules read exists; this one asks whether every key in the file is read. The
   second question is what found the eight, and it is the one a Words phase is for.
10. **`/help` renders through the same numbered picker every other list uses**, digits inert, the
    way `/status` does (v2.5 decision 17). One row is not a command: it opens `help.html`, which
    is the guide for someone who has never used the window and does not know what to ask it.
11. **The «تفاوت با ترمینال» list is grouped by *why*, not alphabetised.** Fifteen slash commands
    in a row tells a non-technical reader nothing; «other places to run Claude» tells them they
    are not missing anything. `test_strings.py` reads the names out of §4 rather than repeating
    them, so a name that leaves the plan — as `/tasks` and `/background` did — stops being
    demanded of the page the same day.
12. **`ultracode` is deliberately not on that page.** §4 lists it, but it is a prompt keyword
    rather than a surface, and naming it to this audience would advertise a one-word way to spend
    the subscription. The gate only checks the `/commands` §4 names, so this is a choice and not
    a hole.
13. **`help.html` was corrected in place, not regenerated.** More than half of it — approvals,
    questions, the context notice, the sidebar, tabs, the queue, attachments, troubleshooting —
    describes surfaces v2 kept and v2.4/v2.5 had already corrected. Rewriting those paragraphs
    would have been churn with a real chance of losing a sentence that was right.

**Left for the owner:** the Persian itself. 8.9's glyph mirroring, 8.10A's shell choice, 8.11C's
rewind and 8.12's two are all still open; 8.10B is closed as a *scheduling* item and reopened as
a reading task — `wiki/tui-strings.md` §8 lists every authored string by key, grouped by the
phase that wrote it.

### v2.7 Acceptance — decisions taken while writing the docs, 2026-09-05

This phase's exit criterion is a human at a physical machine, so only the documentation half was
in scope tonight. What changed and why:

1. **`M8-acceptance.md` was rewritten, not patched.** The old file described a mouse-driven web
   chat — a greeting with four action cards, a clickable model chip, a clickable posture pill,
   composer capability chips — none of which v2.2–v2.6 ship any more. A patch that left the
   structure and corrected sentence by sentence would have missed the controls that were deleted
   outright (the pill, the four chips) rather than reworded. §0–§2 (installer, packaging, probe)
   are untouched: they describe the setup script, which no phase from v2.2 on touched.
2. **Every claimed control was checked against a module or a test, not against memory of the
   plan.** `static/js/composer.js`, `chrome.js`, `commands.js` and `controls.js` were read
   directly for what `/model`, `Shift+Tab`, `/permissions`, `Esc` and `Ctrl+O` actually do today,
   and `static/help.html` — already rewritten for v2.6 — was cross-read as a second source that
   should agree. Where the two disagreed with a decision in this file (e.g. whether the
   attachment chips survived v2.4's chip cleanup — they did; only the four capability chips went)
   the code won.
3. **The Esc/shift+Tab split between a permission dialog and a question is now explicit.** v2.4
   decision 5 made these opposites — Esc refuses a permission but *skips* a question, sending an
   allow with no answers — and the old M8 had one blanket "Escape = deny" line inherited from v1,
   which is simply wrong for half the dialogs v2.4 built. §6 now tests both, in the same session,
   on purpose.
4. **The bare-machine colleague task got a rubric and a recording table**, because "sit on your
   hands and watch" has no pass/fail line to point at afterwards. The five rows (starts without
   help, sends/reads a reply, handles a permission alone, recovers from one wrong move, finishes
   the task) are the ones the transcript of a real session can actually answer without the
   observer's judgement call being the whole test.
5. **CLAUDE.md's `test_tui_vocab.py` count (72) was three phases stale** — v2.2–v2.6 grew it to
   79 and then 82 (§7 of this file already said so), but the gate table nobody reads on every run
   still said 72. Fixed by re-running the file rather than trusting the wiki's own count, in case
   the two had also drifted from each other; they had not. The five new gate files
   (`test_column.py`, `test_keys.py`, `test_dialogs.py`, `test_shell.py`, `test_strings.py`) had
   no row at all — each was run once tonight and its current pass count is what CLAUDE.md now
   quotes, not the number from the phase it shipped in, in case a later phase's fixes moved it.
6. **`APP_VERSION` and the v1.1.0 tag are untouched.** The reservation at the top of this file
   holds until v2.7's bare-machine run and the colleague task both pass — a docs pass is not that.

**Left for the owner:** the bare-machine run itself (§0.5 through §7 of `M8-acceptance.md`) and
the colleague completing one task by keyboard without a hint — neither is answerable without a
physical PC and a human, so v2.7 stays open past tonight.

## 7. Gates

Existing, unchanged: `run_spec_test.py` (174), `test_units.py`, `test_layout.py`,
`test_transcript_path.py`, `test_no_console.py`, `probe_queue.py` (free), `smoke_test.py` (one
paid turn). **New in v2.1: `probe_v21.py` (25), free** — the §5 answers that need a live
process, re-measured against whatever build is installed today.
**New in v2.2: `test_column.py` (22), free** — the §3.1 rows, Ctrl+O, the glyph mirror
switch and the paste chip, driven headless out of the real `index.html`.
**New in v2.0: `test_tui_vocab.py` (82), free** — the two wiki tables against the
installed binary; see CLAUDE.md's gate table. v2.6 added §10: the five-hour warning threshold
and the two per-plan ones, re-derived from the bundle beside the warning string itself.
**New in v2.3: `test_keys.py` (40), free** — every chord the «کلید v2» column binds in the five
contexts the prompt owns, dispatched at the real composer in the real `index.html` with the four
new routes stubbed in the page, plus the `!`, `@`, `\`+Enter and `?` cases that are characters
rather than chords. It fails in both directions: a key the table binds with nothing behind it,
and a case here for a key the table never bound. The strings check this row promised is its own
gate, below.
**New in v2.4: `test_dialogs.py` (31), free** — the *shape* `test_keys.py` dispatches keys at:
the chips and the popup gone from `index.html`, both dialogs inside `#stage` above the prompt, no
submit button in the permission form, `show()` and never `showModal()`, the four verbs mapped to
openers, `choice.js` still a leaf, §8.1's scope wording and §8.2's «the digit is not in the
string», and every `FA.*` key the window reads present in `strings.fa.js`. It reads files and
spawns nothing, so it is the one gate that runs in under a second.

**New in v2.5: `test_shell.py` (29), free** — §3.4's stack (the three rows in order, the posture
row following the wrapper rather than the CLI, one notification on a live settle and none on a
replayed one) and every window-local command of §3.5: the route each one calls, the body it sends,
and the two that still fall through to the CLI. Driven headlessly out of the real `index.html`
with every route stubbed inside the page, so no `claude` process and no login.

**New in v2.6: `test_strings.py` (24), free** — the two arrows in the middle of the chain
`claude.exe → wiki/tui-strings.md → static/strings.fa.js → the page`. Every row of the wiki's
§2–§5 tables names the key it ships as and that key is in the file; the two texts still agree; a
row that ships nothing says so in both columns and says why. Then the four rules that only matter
in a phase about words: no English in a Persian string outside a named allowlist of chords and
product names, no key in the file that nothing reads (the direction `test_dialogs.py` does not
check, and the one that found eight dead strings), `/help` listing exactly the verbs the window
answers, and `help.html` naming every command V2-PLAN §4 says the window will not build — read
out of §4 rather than repeated. It reads files and spawns nothing.

`test_keys.py` (v2.3) reads its cases from `wiki/tui-keys.md`'s «کلید v2» column rather than
repeating them, so the binding table has exactly one copy and the two gates cannot disagree.
`test_strings.py` (v2.6) does the same with `wiki/tui-strings.md`'s «strings.fa.js» column and
with §4 of this file.

## 8. The decisions v2.0 flagged, settled 2026-09-05

`wiki/tui-strings.md` §7 listed six rows as «نیاز به تصمیم کاربر», and `wiki/tui-keys.md` marked
two more chords the same way. Eight items. **Seven of them turned out to be engineering
questions with a defensible answer, and are decided below.** One is a genuine matter of taste
with no technical tiebreaker, and stays open — §8.9.

A decision is recorded here rather than in the wiki tables so the tables stay generated.

**8.1 `permission.yes_remember` — the scope is not named, and that is correct.**
The TUI's option 2 reads «for `<tool>` commands in `<dir>`». v1's scope has been *this project,
this session* since 2026-08-06 (`respond_permission`'s broker is per tab, and `test_units.py`
asserts «دوباره نپرس» stays in the tab that granted it). Naming a directory would describe a
scope the window does not implement. The Persian stays «دیگر برای … نپرس», with the tool name
in the ellipsis and no path. **Keep.**

**8.2 The option digits are a separate element, not part of the string.**
`wiki/tui-strings.md` folded «۱.» into the label; that has to come back out. Two reasons, both
technical. In RTL a digit glued to the front of a Persian run is reordered by the bidi
algorithm and lands where nobody put it — the numbering has to be chrome the renderer places,
not text the paragraph contains. And the list is keyboard-navigable, so the digit is a property
of the row's position, which changes when option 2 is absent (it only exists when a remember
scope applies). **v2.4 renders the digit; v2.6 took it out of the wiki table too, which is what
`strings.fa.js` had shipped all along. Closed.**

**8.3 `posture.bypass` keeps the blunt wording.** «دور زدن اجازه‌ها» is what
`bypassPermissions` does: every prompt is skipped. A softer phrase would misdescribe the one
mode where the window stops asking before something destructive. **Keep, in the warning colour.**

**8.4 `posture.auto` stays as a display-only string.** v2 does not offer auto mode (§4, and
`wiki/approval-postures.md` measured zero `can_use_tool` in it), but the CLI reports it in
`system/status` if the user set it elsewhere, and `sync_cli_mode()` already handles that
gracefully. A mode the window can receive but not set still needs a name on screen. **Keep.**

**8.5 `exit.hint` and `help.esc_quit` are dropped, not translated.** «Press Ctrl-C again to
exit» and «esc again quits» describe a terminal that closes when you insist. A window closes
from its close button, and Edge `--app` owns Ctrl+C anyway. Translating them would document a
key that does nothing. `help.esc_quit` keeps only its first half, «Esc برای بستن». **Drop.**
**v2.6 shipped that half** as `keysEscHint`, under the `?` sheet where the TUI prints it.

**8.6 `ctrl+l` clears the input, and "clear screen" gets no key.**
`wiki/tui-keys.md` marked this «نیاز به تصمیم» because §3.2 assigned Ctrl+L to *clear screen*
while the binary assigns it to `chat:clearInput` — clearing the composer. The binary wins:
§3.6's rule is "lift the defaults from the binary, not from memory", and the TUI's own
`chat:clearScreen` is bound to `cmd+k`, which **has no Windows binding at all**. So the terminal
this window imitates has no clear-screen key on the platform this window ships to, and inventing
one would be a divergence with nothing to imitate. **`Ctrl+L` = clear the composer.** §3.2's
"Clear screen / Ctrl+L" row is wrong and is corrected. Scrolling the column to put the prompt at
the top remains available as a command if v2.5 wants it, not as a chord.

**8.7 `ctrl+s` `chat:stash` is out.** The TUI parks a half-typed draft under it. In a browser
Ctrl+S is Save Page, and §3.6's standing rule is that keys the browser owns stay with the
browser. The feature also has no home in v2: the draft already survives navigation, because
history Up/Down restores the unsent draft on return (§3.2). **Out, listed in §4.**

**8.8 Rewind: the capability is proven, the scope is not committed.** §5.6 found
`rewind_conversation` routed, returning exactly what a window needs (`prefillText` to refill the
composer, `precedingAssistantUuid` to truncate the column). It is no longer in §4's "will not
build" list. It is **not** scheduled into v2.2–v2.7 either: it is one more dialog plus a
truncation path in the column, and it arrived after the phases were costed. Recommendation:
**build it in v2.4** alongside the other dialogs, where the numbered-list machinery already
exists. Flagged rather than assumed because it moves a phase's size. **It was not built in v2.4 —
the reason and the new recommendation are in 8.11.**

### 8.9 Open — the one that is taste, not engineering

**Do `⎿`, `⏵` and `▸` mirror in an RTL column?**

These three glyphs are directional and carry **no Unicode mirroring property**, so nothing
flips them automatically. The TUI has never run RTL, so there is no precedent to copy and no
"what does Claude Code do" to appeal to. Whatever v2 picks, it picks first.

| | What it looks like | Argument for |
|---|---|---|
| **A. Mirror them** (`⎿`→flipped, `⏵⏵`→`⏴⏴`, `▸`→`◂`) | The result branch hangs off the right edge under its tool row; arrows point the way the text runs | The glyphs are *pointers into the layout*. In an RTL column a branch that hangs left points away from the thing it belongs to. Every other directional affordance in the window already mirrors |
| **B. Leave them** | Same shapes as the terminal, pointing left in a right-to-left column | A screenshot from the window matches a screenshot from the terminal. The colleague who has seen the real CLI recognises the shape |
| **C. Mirror the branch, keep the arrows** | `⎿` flips because it is structural; `⏵⏵` and `▸` stay because they are status markers, not layout | Splits the difference honestly: only the glyph that draws a *connection* has a direction the layout can contradict |

**My recommendation: A, mirror all three.** The window's entire premise is that the DOM shapes
Persian correctly where a terminal cannot — mirroring is the same argument one level up. A
connector pointing away from what it connects is the kind of small wrongness that makes a UI
feel foreign, and it is the only one of the three options that is wrong in *no* direction.
B's benefit is recognition, which the sidebar and the Persian text already spend.

Cheap to defer: the renderer flips with one `transform: scaleX(-1)` on a class, so this can be
a toggle in v2.2 and be decided by looking at it. **v2.2 should build it as a class and ask.**

**Built, 2026-09-05, still open.** It is `data-mirror-glyphs` on `<html>` in `index.html`, and
the class is `.glyph.mirror`. It ships on **A** — the recommendation above — so `⎿` and the
running `▸` flip; `"off"` is the whole of option B, and dropping `mirror: true` from the todo
mark in `render.js` is the whole of option C. `test_column.py` asserts both positions of the
switch, so answering this is a one-word edit, not a rebuild. **The owner still has to look at it.**

### 8.10 Open — the two v2.3 raised, both taste

**A. Which shell does `!` run?** It runs `COMSPEC` — `cmd.exe` — because that is what Windows
means by "the shell" and what `run_statusline()` already uses. But the colleague who has watched
the real CLI work will type `!ls`, and cmd answers «'ls' is not recognized». Git for Windows
ships the `bash.exe` the CLI's own Bash tool runs on, and preferring it when present is a
ten-line change. It is not an engineering question: it decides whether `!` means *this machine's
shell* or *the shell Claude Code speaks*, and both are defensible. **My recommendation: prefer
`bash.exe` when it exists, fall back to cmd** — every command anyone will copy into that box,
from the model or from a README, is POSIX. Not done, because it changes what a `!` line means
and the owner owns that.

**B. Twenty-five strings this phase authored.** The history search row, the editor wait, the `?`
sheet's descriptions and the shell row have no counterpart in `wiki/tui-strings.md`: the TUI
says these things in English in places v2 does not copy, so there was nothing to translate and
the text is written rather than lifted. They belong in the same one review pass §7 of that file
already asks for, at v2.6.

**Done 2026-09-05, and it grew.** v2.4 and v2.5 authored more of the same kind, so the pass is
now **eighty strings, not twenty-five**. `wiki/tui-strings.md` §8 lists every one of them by key,
grouped by the phase that wrote it, and `test_strings.py` fails when that list names a key the
file no longer has — so the review can be a read-through of one section instead of a diff. The
scheduling question is closed; the reading is the owner's and still open.

### 8.11 Open — the three §3.3 rows v2.4 did not build, and rewind

Not taste in the usual sense: each is a scope call about where a piece of §3.3 belongs, and the
phase table's exit criterion («permission and plan cases pass by keyboard alone») is met without
them. Recorded here rather than decided quietly, because each moves a phase's size.

**A. `/help` and `/status` are content, not dialog machinery.** The numbered-list module and the
picker they would render into are built and exported; what is missing is the text. §3.3 asks for
«the TUI's help text, translated» and a status block — and translating the TUI's strings is what
**v2.6 Words** is, phase by phase. Building the text now would mean writing it twice or having
v2.6 skip the one screen that is mostly text. **Recommendation: both in v2.6**, as `openPicker()`
calls over strings that phase authors anyway.

**Half-answered 2026-09-05.** v2.5 built `/status`: every value on that block is data this window
already holds (`state.status`, the same object the status line paints from), so there was no text
to write and nothing for v2.6 to do twice. `/help` is the half that IS prose and stays in v2.6.

**Built 2026-09-05, closed.** v2.6 wrote it — and not as a translation of the TUI's help screen,
which is a page about a terminal program and is not findable in the bundle as source text either.
It is generated from the window's own command tables, so it lists the twenty verbs the window
answers and cannot list a twenty-first. Reasoning in the v2.6 decisions, gated by
`test_strings.py`.

**B. `/resume` needs the sidebar to take focus, and v2.5's row says the sidebar is untouched.**
§3.3 asks for «moves focus into the sidebar's session list; Up/Down, Enter, Esc back to the
prompt». The sidebar's session rows are buttons in a `<nav>` with no roving focus and no Esc
route home; giving them one is sidebar work, not dialog work, and it is the one item in §3.3 that
does not render into the column at all. **Recommendation: v2.5**, with the status line, where the
shell is the subject.

**Built 2026-09-05, closed.** A roving tabindex on the session rows: one row in the tab order at a
time, Up/Down to move, Esc back to the prompt, Enter left to the buttons that already had it. The
sidebar is otherwise untouched, and focus now survives its repaint. Gated in `test_shell.py`.

**C. Rewind (8.8) is still not scheduled.** 8.8 recommended building it in v2.4 «where the
numbered-list machinery already exists». The machinery now exists and is exported, which is the
part that was expensive; what rewind still needs is its own dialog *and* a truncation path in the
column — a renderer change, not a dialog one, in a phase whose renderer was v2.2's. It was left
out to keep this phase's diff to §3.3. **Recommendation: v2.5 or a phase of its own; the owner
owns whether it ships in v2 at all.**

**Not built in v2.5 either, and for the same reason it was not built in v2.4:** it is a renderer
change in a phase whose subject was the shell. Still open, still the owner's.

### 8.12 Open — the two v2.5 raised, both taste

**A. `/theme`, against a decision that is already recorded.** §3.5 lists `/theme` among the
window-local commands, «dark and light from the CLI's own palette». `static/style.css` carries
«Dark-only by user decision 2026-08-04» at the top of its token layer. Those two cannot both stand.
The engineering half is cheap — the whole stylesheet is token-driven, so a light theme is one
`:root` block and a switch — which is exactly why this is not an engineering call: it decides
whether the window has a setting the owner already said it should not have. **My recommendation:
keep dark-only and strike `/theme` from §3.5.** A second palette is a second thing to check on
every future screen, and the terminal this window imitates ships dark. `/theme` currently falls
through to the CLI, which refuses it locally and free, so answering this costs one line either way.

**B. Should the window ever ask for desktop-notification permission?** §3.4's last row asks for a
`Notification` on a turn that ends while the window is hidden, and v2.5 built it: permission is
requested at the first moment there is something to announce, never at load. But the browser's own
prompt is a chrome-coloured box in English, and the audience for this window is a colleague who
does not read English UI — the first thing it ever asks them is the one thing v2 cannot translate.
**My recommendation: keep it.** The alternative is a turn that finishes silently while nobody is
looking, which is the whole problem the row exists for, and the prompt appears once. The other
answers are a one-line edit: drop the `Notification.requestPermission()` branch in `render.js`
`notifyTurnEnd()` and the feature is permission-only, or drop the call and it is gone.
