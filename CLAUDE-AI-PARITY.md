# claude.ai/code parity — the transcript, the bar, the tasks panel

User request, 2026-09-29, with screenshots of **this very session in claude.ai/code** and of the
terminal edition side by side. The verdict: the transcript is noisy and the composer bar's
popovers look nothing like the site. "At least like the CLI; best like claude.ai/code."
Epic `pcg-368`. Terminal edition first (it is the one in daily use), then the web edition.

## What the reference shows (measured off the user's screenshots, not recalled)

| Surface | claude.ai/code | Ours before |
|---|---|---|
| Tool calls | ONE muted line per run between two sentences: «Ran a command, read 5.png, finished a background command ›». A lone call is a line too: «Used Claude Code Remote: read documentation ›». No icons. | a group row «PowerShell ۲ · +۱۰ مورد قبلی» plus the newest card drawn as itself, name / command / line count spread across the row |
| Thinking | nothing in the transcript; the working line says «Almost done thinking…» | one «✻ در حال فکر کردن» card per thinking block — 620 of this session's 755 are EMPTY (signature only), so most rows said nothing |
| Assistant text | plain prose, no marker | a coral ● in the gutter, far from an LTR paragraph |
| Your message | a gray rounded bubble | a dimmed prompt echo |
| Working | one line under the last message: spark · «3m 51s · 117.6k tokens» · a «1 running task» chip · «Almost done thinking…» | «✻ verb — time · tokens · Esc», left behind as a closing line after every turn |
| After a turn | nothing (the hover strip carries the time) | «✻ تراشیدن — ۴۲ ثانیه» per turn |
| Background tasks | the chip opens a side panel: Running cards (title, «Agent 1m 33s», model · tokens · tool uses · current step, «View transcript», stop) and «Finished 103 ›» | a strip above the composer and a drawer |
| Bar | «+ 🎤 ⌄ Auto» … «Opus 5.5 High ◔». Nothing under it. | mode + a «۳۰ اقدام خودکار» chip, then a SECOND row repeating the mode and the model |
| Model menu | four current models, «More models ›» flyout for the rest, ✓ or digit at the end, no descriptions | nine two-line rows |
| Mode menu | «Mode» header, name + one-line description, ✓ + digit at the end, tight rows | bold names, two-line descriptions, wide |
| Effort | «Effort High» together at the start, «Faster … Smarter», a gray pill track with dots and a white thumb | label and value at opposite ends, a coral fill on the wrong side of the thumb |

## Phases

- **P1 — the bar.** Drop the audit chip (the count moves into the mode menu as its footer, still
  opening the audit list — the list is «خودکار»'s only defence, so it stays reachable). Drop the
  state line's posture and model (the bar says both); the line keeps only what the bar cannot
  say (quota warning, changed files) and is absent when that is nothing. Menus, model flyout and
  slider restyled against the screenshots. `bar.js` stays one file in both editions.
- **P2 — the transcript.** Every tool call joins a run; a run is one `details.run` whose summary
  is the activity sentence; opening it lists the steps, each still its own card. Thinking with
  text is a step inside the run; empty thinking draws nothing. No ● marker. User messages are
  bubbles. The live line stays under the last message and is REMOVED when the turn ends.
- **P3 — the tasks panel.** The live line's «N کار در حال اجرا» chip opens a side panel over the
  pane (Running cards, a folded Finished list); «دیدن گزارش» opens the existing per-agent drawer.
- **P4 — the web edition** gets P2 and P3.

Each phase: spec cases updated where they pinned the old design (the invariant each one guarded
is kept — one live line, O(1) paint per frame, replay = live), a shot set looked at, gates green.

## Step 1 result (2026-09-29)

Measured in `wiki/claude-ai-code-reference.md` (idle shared session; live items 4, 6, 7, 9-11 not
observed). Settled by measurement: user bubble at the inline-end (right), 8x12 pad, 10px radius,
`rgba(255,255,255,.05)`; no assistant marker or gutter; a run of tools = ONE muted
`Ran N commands ›` line, expand = bordered step list without icons, step expands to command +
output; turn-end file-edit card; menu check is blue. P2 plan stands with these targets; P3
(Background tasks panel) and the stop/send button wait for a live capture.

## Status (2026-09-29, end of day) — built

P1–P4 and the composer button (`pcg-368.6`) are built and gated. Web 1.6.0, terminal 0.6.0.
The live-only items that the idle measured pass could not observe were built from the user's
screenshots:

- the working line with the running-task chip;
- the Background tasks panel;
- stop ⊙ ↔ send ↵ with «Send / Queue for later».

Details are in `wiki/parity-chrome.md` §"claude.ai/code parity".

Still to settle with the user, from the measured list:

- the action row under a turn's last message, which the site draws **always**; ours is on
  hover;
- the right-hand diff panel that a file-card row opens;
- image thumbnails above the user bubble;
- «Show more» at about 15 lines.
