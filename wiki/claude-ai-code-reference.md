# claude.ai/code — measured reference (2026-09-29)

Source: the shared session `claude.ai/code/session_01LqkkLH1VzN2EszXC2gDBbD`, opened in the
user's Chrome (Claude in Chrome, browser "VIP-PC-01"), read-only: scrolled, expanded, hovered,
opened menus, read `getComputedStyle`. **No message was sent.** Screenshots are in git-ignored
`ref/` (`screenshot-…-N.*`, order below). The page reports viewport 2844x1350 at DPR 0.9, so
lengths below are CSS px as the page computes them; the content column is **768 px** wide.

Tooling gotcha: `javascript_tool` output is blocked ("Cookie/query string data") when it looks
like `key=value; key=value`. Return JSON instead.

## Not measured (needs a live turn)

This session was idle, so these were **not observable**: the working line's phase words and
timer, the «N running task» chip, the Background tasks panel, «View transcript», a queued
message row, a mid-turn send, stop ⊙ ↔ send ↵ and its Send/Queue menu, an AskUserQuestion
prompt, a todo list, interrupt/error rows. Getting them means sending a message in a session
that runs a background agent — **ask the user first** (it costs quota and posts into their
session), or use screenshots from them.

## Tokens (measured)

- Page ground: near-black; text `rgb(240,239,236)`; muted `rgb(137,135,129)` (tool lines, time).
- Base type: `anthropic-sans` **14px / 20px**, weight 400. Mono `anthropic-mono`.
- Small chrome (menus, time, footers): **13px / 19px**.

## 1. User message

- A **bubble**, `bg color(srgb 1 1 1 / .05)`, **padding 8px 12px, radius 10px**, no border,
  14px / **18px** line-height. Max about 653 wide inside the 768 column.
- Sits at the **inline-end** of the column (`ms-auto`): on the **right** in this LTR page, for
  English *and* for a Persian message (the Persian bubble is right-aligned, text RTL inside).
  So the site does not mirror per language; it is always the right side of the column.
- Long message: shown in full here (3 lines); no fold observed.

## 2. Assistant prose

- No marker, no avatar, no left gutter. Plain 14/20 text, full 768 column, colour as above.
- Inline code: `anthropic-mono` **12.6px**, colour **`rgb(236,126,126)`** (reddish), bg
  `rgba(255,255,255,.05)`, padding `0.79px 3.15px`, **radius 5px**, 1.1px border `rgba(255,255,255,.1)`.
- Fenced code: bordered box with a copy icon at the top-right (`git fetch origin …`).
- Lists: bullets indented (`li` padding-left 7px), numbered lists bold lead-in.
- Blockquote (the "Give this prompt" quote): left rule, dimmer text.

## 3. Tool activity — the core of the parity ask

- Consecutive tool calls between two sentences collapse to **ONE muted line** (14/20,
  `rgb(137,135,129)`) with a trailing chevron `>` (4px gap), e.g. **«Ran 6 commands ›»**,
  «Ran a command, finished a background task ›», «Committed P1 ›», «Loaded tools ›»,
  «Pushed the P1 commit to the feature branch ›», «Hook re-prompted Claude, ran a command ›».
  The words are a **model-written summary per run**, not a template of kinds. A run that is a
  single step shows that step's own title.
- The line is a `<button>` (radius 4px, no padding). Hover: not measured as a colour change;
  the chevron flips to `⌄` when open.
- **Expanded (click):** the steps appear as a **bordered box, radius 8px, 768 wide**, one row per
  step. Each row is `padding 8px 10px`, 14/20 muted text of the step's own title («Read the user
  event handling ›»), rows separated by a 1px hairline. **No icons per row.**
- **A step expands again** (click): a monospace panel with the command on top («`$ cd … ; sed …`»,
  shell words tinted) and the output below in a scroll box (fixed height ≈ 220, scrollbar), 11–12px mono.
- **Edits** end a turn in a **file card**: header «Edited 2 files» + `+292 −30` (green / red) and a
  chevron; one row per file (icon, name, `+98 −0`, chevron). Rows expand to the diff.
- A **task/agent title** («Replace the run grouping with one activity line per run ›») shows as the
  same muted collapsed line — an Agent step is the same shape as a tool run.

## 4–6, 7–11

Unmeasured (see above). Seen only: an **orange spark** (`✳`-like, animated) sits alone under the
last message while the session is live, with the hover row **below the last assistant message:
copy · pin · speak · «9 minutes ago»** (13px muted). The row appears on hover for every message.

## 12. Menus (P1 built these; this confirms them)

- Model menu (opens upward from «Opus 5.5»): **Opus 5.5 ✓ 1 / Fable 5.1 2 / Sonnet 5.5 3 /
  Haiku 4.5 4 / «More models ›»** flyout. Check mark is **blue**, right-aligned, digits muted
  right-aligned.
- Mode menu: header «Mode»; rows **Auto — «Claude handles permission decisions» ✓ 1**, **Accept
  edits — «Automatically accept all file edits» 2**, **Plan — «Create a plan before making
  changes» 3**. Two-line rows: title 13px, description 12px muted.
- «+» menu: **Add files or photos (Ctrl+U)**, **Slash commands**, **Connectors ›** (flyout).
- Menu surface: `bg rgb(32,32,31)`, **radius 10px**, border 1px `rgba(255,255,255,.1)`, item
  **13px/19px, padding 2.5px 8px, radius 6px**.
- Bar row under the input: `+ 🎤 ⌄  Auto … Opus 5.5  Extra ◔` — mode is plain text, model and
  effort right, ◔ at the far end. Placeholder in the box: «Type / for commands», send `↵` inside
  the box at the right.

## 13–15

- Header: session title with chevron menu («Open in / Rename R / Copy link C / Transcript view /
  Edit cloud environment / Archive A / Delete D»), a «Default · repo» chip, a banner «Shared
  session. Visible to anyone with the link. [Manage]» pinned at the top of the column.
- Above the composer: a **PR strip** («#5 repo branch  Merged ✕»), purple, radius like the box.
- Sidebar (left): New, Artifacts, Customize, More; Recents; footer account row.
- A small `⌄` jump-to-bottom button appears centred above the composer when scrolled up.

## Decisions this settles (proposals, for the user)

1. User bubble on the **inline-end (right)** for both editions, regardless of language.
2. Tool activity = one muted `Ran N commands ›` line per run; expand = bordered step list; no
   glyphs (`⎿ ⏺ ✻`) in the transcript. A file-edit card at the turn's end.
3. Check colour in menus: the site's **blue**.
4. Assistant text has **no marker** and no gutter.
5. Open: «Queue for later», the working line, Background tasks panel — need a live capture.

---

# Full-session pass (2026-09-29, same day, second sweep)

Whole 33 000 px transcript walked (virtualised list; ~45 turns), every kind of row opened.
Screenshots `ref/screenshot-…-9` to `-18`. **Corrects §3 above.**

## Vertical rhythm (measured)

- An assistant turn is ONE flex column, **`row-gap 10px`**. Children: text block, tool line, text
  block, tool line, … then a 24px **action row** (copy · pin · speak · «N minutes ago», 13px muted).
  So text→tool line→text = 10 + 20 (line) + 10. Nothing else separates them: no rules, no margin.
- **The action row is always drawn under the last message of a turn** (not hover-only), muted.
  A live turn shows the orange animated **spark** alone under the last text instead.
- Between turns: the user turn has ~30px air above the bubble (sr-only H2 «You said:» / «Claude
  responded:» for a11y).
- Markdown inside text: block margin-top **10.5px** (0.75em) on `p`, `ul`, `ol`, table wrapper,
  pre; `ul` padding-left **28px**, **`li` margin-top 3.5px + padding-left 7px**, disc marker
  colour `rgb(195,194,183)`, nested list same rule. Numbered lists start with a **bold lead-in**
  («1. **Get the work.**»), sub-bullets nested under it. Section "headings" in summaries are
  **bold paragraphs** («**Files changed**», «**Gates not run — please run on the Windows PC**»),
  not `h2/h3`. Bullets often lead with bold: «**pcg-0o7 case:** …».
- Table: wrapper radius **6px**, 1px border `rgba(255,255,255,.1)`, `overflow auto`; header cells
  bg `rgba(255,255,255,.05)`, weight 500; cells `padding 6px 10.5px`, 14px; row hairlines; inline
  code inside cells. Full column width.
- Inline code appears everywhere (file names, functions, commands) — that is where the reddish
  chip earns its keep. Links: blue.

## Tool line vocabulary — it IS templated, from the tool KINDS (correction)

One line per run between two texts, kinds merged, in **order of first use**, comma-joined,
sentence-cased, past tense (present while running: not seen):

`Ran N commands` · `Ran a command, read F` · `Ran N commands, edited F +A -D` · `Edited F, ran N
commands +A -D` · `Created F, ran a command, used a tool +A -D` · `Created and read F, compacted
the session, ran N commands +A -D` · `Read N files` · `Ran an agent, read N files` · `Ran a
command, used N tools` · `Ran a command, finished a background task|command` · `Finished N
background tasks, ran N commands (N failed)` (**"Finished" in coral** when something failed) ·
`Hook re-prompted Claude[, ran a command]` · `Initialized session` · `Loaded tools` ·
`Message from subagent` · `Background task completed · Agent "X" finished · took 5m 30s`.
Rules: a single file → its **name** is shown («read term-home.png», «edited server.py»), several →
«N files»; `+A −D` (green/red) at the line's end when it edited; unknown tool → «used a tool /
used N tools»; a lone step with a model-written title («Committed P1», «Pushed the P1 commit to
the feature branch», «Found where init fetch and resume prefill run») shows that title.
Muted `rgb(137,135,129)` 14/20, chevron `›` closed / `⌄` open.

## Expanded run

- Bordered box radius 8px, 768 wide; **row per step**, `padding 8px 10px`, hairline between.
- Row text: **muted verb + white object**: «Read» (muted) «TERMINAL-REDESIGN.md» (white) `›`; an
  Agent step's own row is its subject («Map terminal edition code ›»), then its reads under it.
- A step opens again: command in mono (`$ cd …; sed …`) on top, output in a fixed-height scroll
  box below (≈ 220px, own scrollbar).

## File edits (change summary)

- Turn-end **card**: header row «Edited 2 files» + `+292 −30` + `›`; one row per file (icon,
  name, `+98 −0`, `›`). Radius 6px, hairline border, 768 wide.
- **Clicking a file row opens a right-hand panel** (≈ 50 % of the window; the transcript column
  reflows narrower): breadcrumb `main · branch ⌄`, tab «tui-transcript.md  wiki +98 −0», toolbar
  (search, ⋯, expand, ✕), then the diff — line numbers, `+` lines on a green ground for a new file,
  whole file scrollable. This is the site's answer to «changes»: no inline diff in the transcript.
- One-file runs put the file and `+A −D` on the tool line itself (`Edited server.py +142 −0 ›`).

## User turn variants

- **Images / attachments:** thumbnails sit in a row **above the bubble**, aligned to the inline
  end, **each 160px tall** (width from aspect, ≤ 480 wide when alone), `object-fit contain`,
  **radius 9px, 1px border `rgba(255,255,255,.1)`**, small gap between; the text bubble under them
  with ~8px gap. Click → lightbox (not opened). Bubble shrinks to its text.
- **Persian text** in the bubble: right-aligned bubble, text RTL and right-aligned inside.
- **Long message:** clipped to ~15 lines with a fade and a **«Show more»** chip (12/17px,
  `padding 0 6px`, radius 5px) inside the bubble at the bottom.
- **A pasted/queued message from a hook** shows as the same bubble.

## AskUserQuestion, after answering

A compact **bordered box, ~335 wide, radius 6px**: question in muted 13px, the chosen answer
below it in white, one pair per question, pairs separated by a gap. Not full width.

## Sidebar / chrome extras

Header title menu (Open in, Rename R, Copy link C, Transcript view, Edit cloud environment,
Archive A, Delete D); a purple PR strip above the composer («#5 repo branch Merged ✕»); the
message action row uses «N minutes/days ago».

## Still not observable

Working line phase words, timers, «N running task» chip, Background tasks panel, «View
transcript», queued message row, stop ↔ send, todo list, interrupt/error rows — the session is
finished. Needs a live turn (ask the user).
