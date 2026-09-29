# How the real TUI draws a transcript (read out of CLI 2.1.284)

Measured 2026-09-29 for `CLAUDE-AI-PARITY.md` (epic `pcg-368`) by reading the binary
`/opt/claude-code/bin/claude` 2.1.284 (a Bun-compiled ELF; the JS bundle sits at roughly
197–243 MB and its strings use `\uXXXX` escapes, so search for `⎿`, not for the glyph).
Byte offsets are file offsets, so each fact can be re-checked. The minified names change with
every build, so follow the string literals, not the names. This is the **CLI's** rendering;
what claude.ai/code draws is recorded separately in `CLAUDE-AI-PARITY.md`.

**Why it matters.** Our transcript drew a row for every thinking block, one card per tool call
and a counter of auto-approved actions. The CLI does none of the three.

## Glyphs (198111560)
`⏺` on macOS and `●` elsewhere (the assistant dot), `✻` (the spinner and the turn-end line),
`∴` (thinking in transcript mode), `⏵⏵` / `⏸` (the mode footer) and `⎿` (the result branch).

## 1. Thinking
- **While streaming, nothing goes in the transcript.** The spinner's bracket carries it and
  escalates with time: "thinking", then "still thinking" (≥10s), "thinking more" (≥20s),
  "thinking some more" (≥30s) and "deep in thought" (≥45s), plus an effort suffix (222268387).
  "thought for Ns" stays in the spinner for 2 s after the thinking ends.
- **Afterwards, in the normal view:** a non-blank thought is pulled into the surrounding
  collapse group as one dim row, `Thought for 5s (ctrl+o to expand)`, with no ⏺
  (`k?"Thinking":"Thought"`, 225314251).
- **In transcript mode (ctrl+o):** `∴` in dim italic, followed by the whole thought as dim
  markdown (225166258).
- **Empty or signature-only thinking draws nothing in any mode.** It is skipped when blank
  (201740152) and does not break a group. In a real session of ours, 620 of 755 thinking
  blocks on disk were empty.
- `redacted_thinking` draws nothing in the normal view. In transcript mode it draws
  `✻ Thinking…` (225146855).

## 2. Collapsing tool calls
- **What collapses:** Read, Glob/Grep (both titled "Search"), MCP calls
  (`called <server> N times`), and Bash/PowerShell when every segment of the command is
  read-only: search `find grep rg…`, read `cat head tail wc jq…`, list `ls tree du`, or neutral
  `echo printf true false` (208871306). Other shell commands collapse only in fullscreen mode.
  Edit, Write and Agent never collapse.
- **What breaks a group:** non-empty assistant text, a tool that does not collapse, a user
  prompt, a queued prompt, or a task notification.
- **The wording** (225314251), joined with ", " and capitalised, with the counts in bold:
  `searched for N patterns`, `read N files` (unique paths), `listed N directories`,
  `edited N files +A −D`, `called <server> N times`, `ran N shell commands`. The present
  tense is used while running: `reading`, `searching for`, `running`.
  Example: "Searched for 2 patterns, read 3 files".
- **The row:**
  - finished: dim text and `(ctrl+o to expand)`, with no glyph;
  - running: a blinking ● and ` · 12s…`, then `  ⎿  <last path | "pattern" | $ cmd>` under it.

## 3. One tool row
- **Header:** `● Name(args)` (225201669). The dot blinks while the call is unresolved, turns
  green when it is done and red on an error. Edit is named "Update" ("Create" when
  `old_string` is empty), and Glob/Grep are named "Search".
- **Result templates**, each under `  ⎿  `:
  - `Read N lines`
  - `Added N lines, removed M lines`
  - `Wrote N lines to path`
  - `Found N files`
  - Bash: three lines, then `… +N lines (ctrl+o to expand)`
  - `(No output)`
  - `Interrupted · What should Claude do instead?`

## 4. Assistant text
Every text block gets its own `●`, drawn in the ordinary text colour (225163104), with one
blank line between rows.

## 5. Auto-approval
- **No counter of auto-approved actions exists anywhere.**
- Under a row, the only per-row mark is `⎿ Allowed by auto mode classifier`, shown only for
  the auto-mode classifier (227278923).
- The mode lives in one footer line: `⏵⏵ accept edits on`, `⏵⏵ auto mode on`,
  `⏸ plan mode on` or `⏵⏵ bypass permissions on` (226509776).

## 6. Spinner and the turn-end line
- **Spinner frames:** `· ✢ * ✶ ✻ ✽`, played forward then back. The label is a task's activeForm
  or a random verb, followed by a dim bracket such as `(12s · ↓ 1.2k tokens · thinking)`. The
  normal spinner has no "esc to interrupt".
- **Turn end:** a dim `✻ <Verb> for 1m 45s · done 3:42 PM` (225338808). The verb is hashed
  from the message uuid, so it does not change on a reload. The line stays in the transcript
  (setting `showTurnDuration`, default true). claude.ai/code draws nothing here.

## 7. Agents
- **While running:** `⏺ Type(description)`, then the last 3 steps, then
  `… +N tool uses (ctrl+o to expand)`.
- **Done:** `⎿ Done (N tool uses · 12.3k tokens · 45s)`.
- **Backgrounded:** `⎿ Backgrounded agent (↓ to manage)`.
- **Several at once:** `Running N agents…`, drawn as a `├─ Type (desc) · N tool uses ·
  X tokens` tree.
- **Waiting:** `✻ Waiting for N background agents to finish` (225338357).

## 8. Todos
TodoWrite, TaskCreate and TaskUpdate draw **no transcript row** (212645399). The checklist
lives in a panel under the spinner, toggled with ctrl+t:

- `✔` done
- `◼` in progress
- `◻` pending
- a header: `N tasks (G done, V in progress, J open)`
