# BRIDGEMIND-PORT.md — what to take from BridgeMind One (analysis, 2026-09-24)

Status: **analysis only, nothing built.** The user has NOT yet picked items. Open decisions are
at the bottom — ask the user before designing or building any of them (CLAUDE.md "New-feature
intake"). When a direction is agreed, this supersedes the design parts of `TERMINAL-REDESIGN.md`.

## Why this exists

The user's verdict on the terminal edition after `TERMINAL-REDESIGN.md` phases 1–3: it looks
nothing like the reference. BridgeMind is clean, scales, nothing is cluttered; ours is not.
The goal is **not** a copy — BridgeMind has much we don't need (other AI engines, API keys,
billing). The goal is every feature/UX idea that would be good in *our* app, in our own design.

Sources: the user's screenshots of the current product (summarised in `wiki/bridgemind-one.md`
§"CORRECTION 2026-09-24"), a hands-on feature survey of the installed app on the author PC
(notes kept locally, not in this repo), and our own terminal edition rendered headlessly at
1852x1044 (home, single, split-4) for comparison. All values below are OUR proposals, to be
tuned by eye — none are copied from BridgeMind.

**Premise correction:** `wiki/bridgemind-one.md` used to say BridgeMind has "no tiling grid,
tabs only". Wrong — it has a grid of framed panes. `TERMINAL-REDESIGN.md` §1 was partly argued
from that wrong fact.

## Why ours looks cluttered (measured against our own render)

1. **No separation.** One flat black sheet, cells butt edge-to-edge with hairlines; four panes
   read as one surface. Reference: sidebar and stage are separate rounded cards on a darker
   ground, every pane is its own card, consistent gutters.
2. **Status line is a key cheat-sheet, not state.** `نیم‌فاصله: Shift+Space · سطح اجازه:
   Shift+Tab · …` repeated in every cell (×4 at split 4). Reference: one line of live state
   (permission mode, running shells/agents).
3. **Empty cells are loud.** Each repeats the full welcome block + hint row + a composer saying
   «برای شروع، گفتگویی باز کنید» + the cheat-sheet. Reference: an empty pane shows only the banner.
4. **Sidebar noise.** A folder icon AND a `‹` chevron on every project row (34 icons carrying
   no information at 17 projects), tall rows, a visible grey scrollbar between sidebar and stage.
5. **Weight.** Assistant reply, cell title and welcome line are all bold white — no hierarchy.
6. Small defects seen: cell 1's title is also its first user row (duplicate); `[۱] [۲]` corner
   badges read as debug labels; the active cell gets a coral top line + full frame (a lighter
   border + tinted header is enough); the rail did not collapse at split 4 after a seeded layout
   restore (may be the probe's seed lacking `rail` — verify).
7. Root process cause: the redesign was gated on numbers (transcript %, px widths, test
   counts), never on a side-by-side look at the reference. Every gate passed; the screen is noisy.
   **Any new design phase must end with a headless screenshot compared by eye against the
   user's reference screenshots** (recipe: `wiki/dev-environment.md`).

## Already have — do not rebuild

Status model idle/running/waiting/error (`tabStatus()`), unread marker, pin, rename, git
worktree per session (MA2, `--worktree`), OS notification on turn end (terminal edition,
`render.js`), per-tab drafts, stop + queue strip, Edit/Write diffs in tool cards, inline
permission dialog (terminal edition). Our per-session state comes straight from stream-json,
which is richer than anything a terminal-based app can scrape — no new status plumbing needed.

## Take — group 1: look & structure (this is the "clean")

- **A small token set, one gutter.** One spacing constant for shell padding and all gaps.
  A short radius scale (panel > card > row > chip). Three dark surface steps (ground darkest,
  pane, composer lightest). Fills and borders as low white-alpha on those surfaces rather than
  new greys. One status palette used identically everywhere: running green (gentle pulse),
  waiting amber (pulse), failed red (static), idle grey; pulses off under
  `prefers-reduced-motion`. **Accent stays coral.**
- **Panes are cards**: rounded, 1px low-contrast border, a gap between panes. Focused pane =
  slightly lighter border + faintly tinted header. No glow, no coral frame.
- **One pane header, one slim row**: status dot + title at the start; `⋯` (menu) · `⤢`
  fullscreen · `✕` close at the end. Under RTL, start = right. **Pane fullscreen** (one pane
  fills the stage, Esc exits) — we have none.
- **One status line of state per pane** (posture, model, running tasks/agents). The shortcut
  list moves to `?` and `help.html`.
- **Sidebar**: small section labels, compact rows, no per-row icons, a count pill,
  hover-revealed actions (pin, delete) + context menu (rename/pin/delete, keyboard reachable),
  trailing state label per row: «در حال کار» / «منتظر شما» / «خطا» / relative time. Pinned
  first. Scrollbars hidden, native scroll kept.
- **Empty states**: one actionable line + one button, never the welcome block ×N.
- **Type**: one body size for transcript, a smaller size for chrome/labels, bold only for
  titles. Menus as a raised plate with a soft shadow and a short scale-in from the anchor edge.

## Take — group 2: multi-session workflow ("4 at once")

- **New-session page** (full-stage form, replaces the split control as the way in): folder,
  **how many** (1–4), **shared folder vs separate worktree** (wires to MA2), optional **task
  sent to every session**, a live **"will launch" preview** (one row per slot), one button
  opens all panes. Presets we'd define ourselves, e.g. «تنها» (1), «جفت» (2: one session told
  to build, one told to review and report without editing), «گروه» (4). Esc cancels,
  Ctrl+Enter launches. All-or-nothing: if the panes can't all open, close what did.
- **Grid that fits N** instead of fixed 1/2/4, so 3 panes lay out properly; a minimum pane size
  below which the grid refuses to split.
- **Resizable dividers**: wide invisible hit area, 1px visible line; keyboard-operable; an
  "equalize" action.
- **Pane navigation keys**: Alt+Arrow = nearest pane in that direction, cycle next/prev, close
  pane, equalize. Chords are NOT decided — see "measure first".
- **Notification centre**: list of "X finished" / "X needs you", unread marks, mark all read,
  click → jump to that pane and **briefly flash it**; clear copy when the target is gone.
  Don't count unread for the pane the user is looking at.

## Take — group 3: transcript & composer

- **Inline permission card** with four actions: allow once · allow for session · deny ·
  **deny and stop** (deny + interrupt — new). A small eyebrow naming the kind of action (file
  change / command / external), derived from the tool name.
- **Folding**: long user messages behind «بیشتر»; runs of tool calls collapse to
  "+N previous" with the latest visible; very long threads render the recent tail with
  "show earlier"; `content-visibility: auto` per row.
- **Streaming cost**: re-parse only the trailing unfinished markdown block per frame (we
  already rAF-coalesce; we still re-parse the whole message).
- **Composer**: placeholder changes while running (you can still send — it queues — or stop);
  a failed send puts the text back; auto-grow with a max height.

## Group 4: bigger features — each needs a yes from the user

- **Changes panel**: files this session changed + unified diff per file, git repos only. Server
  side is stdlib (`git status --porcelain`, `git diff --no-color`); states: reading / no changes
  / not a git repo / too large to show.
- **App zoom** Ctrl+= / Ctrl+- / Ctrl+0 (for the colleague's eyes).
- **Light theme** — the web edition was user-approved dark-only; ask first.

## Not taking

Other AI engines, credits/billing/sign-in, voice assistant, paid autopilot (same quota-burn
reasoning as `ultracode`, `wiki/control-protocol.md` §8), agent profiles/memory/scheduled
routines, plugin catalog, embedded browser/files/apps panes, custom window controls (Edge
app-mode has native chrome), privacy cover over panes, cross-engine handoff. And nothing that
isolates the CLI from the user's real `~/.claude` (MCP servers, settings) — our rule stands.

## Measure first (before any spec)

1. **Chords in Edge app-mode.** Ctrl+W may close the window; Ctrl+T / Ctrl+D / Ctrl+N may be
   eaten by the browser before the page sees them. Any pane chord must also avoid the TUI keys
   the terminal edition mirrors (`wiki/tui-keys.md`, `test_keys.py`).
2. **Per-origin state.** Our server binds a random port every run, so the origin changes:
   Notification permission and browser zoom are stored per origin and may reset each launch
   (same reason `pcg.layout` uses `sessionStorage`). Zoom/prefs may need server-side storage.
3. **Vazirmatn variable font.** A variable build would allow finer weight steps; we vendor
   three static weights. Check it exists and its license before swapping.

## Open decisions for the user

1. Which items to build — all of groups 1–3? Which of group 4?
2. Does this apply to the terminal edition only, or the web edition too?
3. Then: architect pass for the detailed design (CLAUDE.md "Delegation", Think gate), which
   replaces the design sections of `TERMINAL-REDESIGN.md`.
