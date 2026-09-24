# BRIDGEMIND-PORT.md — what to take from BridgeMind One (analysis, 2026-09-24)

Status: **analysis + design, nothing built (2026-09-24).** Decisions are recorded in §D0; the
design and the phased build plan are §D1–§D14 at the foot of this file. They **supersede
`TERMINAL-REDESIGN.md` §2.4, §3 and §5** (density, the split control, tokens); its §1 (sidebar on
the right, the rail) and §4 (the status model) stand. Tracked as epic `pcg-bmp` (see §D14).

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

## D0. Decisions (user, 2026-09-24)

1. **Build groups 1, 2 and 3 in full. From group 4: the Changes panel and app zoom. No light
   theme** (the dark-only decision of 2026-08-05 stands).
2. **Terminal edition only** (`static-terminal/`). The web edition is the colleague's daily app
   and stays as it is; a server route added here serves both editions (`wiki/editions.md` rule),
   but nothing in `static/` changes.
3. Every phase ends with a **visual check against the reference screenshots**, not only gates
   (§"Why ours looks cluttered" item 7). A phase is closed when the user has seen its shots.

### Corrections to the analysis above (measured against the code, 2026-09-24)

- **The key cheat-sheet is not the status line.** «نیم‌فاصله: Shift+Space · سطح اجازه: …» is
  `.composer-hint` under the prompt (`composer.js:1485-1490`, four `FA.hint*` keys). The status
  line (`render.js setStatus`) is up to four rows of *facts*: the user's own statusLine script,
  the posture row, a facts row (model, effort, style, folder, context, cost, quota, session id)
  and a quota warning. Both are addressed below (§D5): the hint row goes, the facts are
  re-homed.
- **"We still re-parse the whole message" is not true.** Streaming paints plain text, one write
  per animation frame (`render.js queueStreamText`), and `marked` runs once, when the message
  closes. There is no parse cost to cut. What the reader sees is raw `**` and backticks until
  the message closes, then a snap. §D11 turns the item into what is worth having: completed
  blocks render as they close, at the same per-frame cost.
- **A failed send loses the text.** The submit handler clears the box before `fetch`, and the
  catch branch only prints «ارسال نشد» (`composer.js:1297-1354`). A defect, fixed in §D10.
- **The pane cap is `MAX_TABS = 6`** (`server.py:3294`), not 4. "Grid that fits N" is 1–6.
- **No git subprocess exists** in `server.py`. Git is detected by `(cwd/".git").exists()` only.
  The Changes panel is the first `git` call, and the only new route (§D12).

## D1. Principles that decide the small things

- **Calm over complete.** A fact the reader does not need *now* has one home, and that home is
  not every pane. Chrome shows state; facts live one click away (§D5 lists every fact's home).
- **One gutter, three surfaces, one status palette.** If a value is not a token it does not ship.
- **Shape before colour.** Every state keeps the ● ◉ ⊘ ○ glyph family (pcg-973's rule).
- **RTL is the frame, not a mirror.** Start = right. Nothing flips `direction`; geometry
  (dividers, nearest-pane) is computed from rects, never from "left/right" assumptions.
- **One renderer, two sources** (plan §B-4) still holds for everything that folds or pages.
- **Swappable where unmeasured.** Chords live in one table, storage behind one module, weights
  behind tokens (§D13), so the Windows measurements change a value, not a design.

## D2. Tokens — `@layer tokens` in `static-terminal/style.css`

Existing names are kept where the meaning is unchanged (3,289 lines read them); values retune;
new tokens are added. Our values, to be tuned by eye in P1.

```css
:root {
  color-scheme: dark;
  /* three surfaces + the ground */
  --ground: #070707;              /* NEW  window ground, visible only in the gutters     */
  --bg: #0e0e0e;                  /* WAS #0a0a0a  pane + sidebar card surface            */
  --bg-side: var(--bg);
  --raise: #151515;               /* NEW  composer box, permission card, new-session card */
  --bg-elev: #1a1a1a;             /* WAS #161616  anything floating: menus, bell panel    */
  --surface: rgb(255 255 255 / .03);    /* hover fill on --bg                          */
  --surface-2: rgb(255 255 255 / .06);  /* selected / pressed row                      */
  --border: rgb(255 255 255 / .07);     /* card edge, hairlines                        */
  --border-strong: rgb(255 255 255 / .13); /* focused pane edge, inputs, dividers on hover */

  /* text: three steps, all AA on --bg */
  --fg: #ededed;                  /* WAS #fafafa  titles, focused chrome, body text      */
  --fg-muted: #a3a3a3;            /* secondary, unfocused pane title, labels             */
  --fg-faint: #8a8a8a;            /* NEW  meta: times, counts (5.6:1 on --bg)            */

  /* accent stays coral; status is its own palette, used identically everywhere */
  --accent: #d97757; --accent-strong: #c4633f; --accent-soft: rgb(217 119 87 / .13);
  --st-run: #6fbf8a;              /* NEW  running  ●  (breathes)                        */
  --st-wait: #d9a441;             /* NEW  = old --warn; waiting on you  ◉  (breathes)   */
  --st-err: #e5695a;              /* NEW  = old --danger; last turn failed  ⊘ (static)  */
  --st-idle: #6b6b6b;             /* NEW  idle  ○  (a glyph, never text)                */
  --warn: var(--st-wait); --danger: var(--st-err);   /* aliases kept for existing rules */

  /* space: ONE gutter, one inner padding */
  --gap: 8px;                     /* WAS 12px: shell padding, between cards, between panes */
  --pad: 12px;                    /* NEW  inside any card                               */
  --log-gap: 8px;

  /* radius scale: panel > card > row > chip */
  --r-panel: 12px; --r-card: 10px; --r-row: 7px; --r-chip: 5px;
  --radius: var(--r-card); --radius-lg: var(--r-panel);   /* old names, kept */

  /* type: one body size, one chrome size, one meta size; bold only for titles */
  --fs-body: 15px; --fs-ui: 13px; --fs-meta: 12px;
  --wt-body: 400; --wt-title: 500; --wt-strong: 700;   /* swap point, §D13 */
  --lh-fa: 1.9;                   /* spec rule 4 floor — unchanged                     */
  --lh-ui: 1.5;

  /* sizes */
  --side-w: 264px; --rail-w: 48px;
  --row-h: 32px;                  /* sidebar project row; session rows 30px           */
  --pane-head-h: 28px;
  --pane-min-w: 360px; --pane-min-h: 240px;   /* the grid refuses to split below these */

  /* motion */
  --dur-fast: 120ms; --dur: 160ms;
  --ease: cubic-bezier(.22, 1, .36, 1);
  --ease-breathe: cubic-bezier(.4, 0, .6, 1);
  --shadow-float: 0 10px 28px rgb(0 0 0 / .5), 0 0 0 1px var(--border);
}
```

Rules riding with the tokens: no `letter-spacing` on Persian (breaks joining); hover fills only
under `(hover: hover)`; `:active { transform: scale(.97) }` on pressables; menus and the bell
panel scale in from their anchor edge (`transform-origin` = the trigger's side, .96 → 1 over
`--dur-fast`); no transition on layout changes (split, rail, fullscreen — the change is the
feedback); the existing reduced-motion block kills every pulse and scale. Scrollbars: thin,
`--border-strong` thumb; the sidebar's thumb is transparent until `:hover`/`:focus-within`.
The warm `#4a4844` thumb (`style.css:214-217`) goes.

## D3. The shell

```
┌──────────────── ground (--ground), --gap on every side and between cards ────────────────┐
│ ┌───────── pane ─────────┐ ┌───────── pane ─────────┐   ┌──── sidebar card ────┐ │
│ │ head 28px               │ │                         │   │ mark  brand   🔔  ‹ │ │
│ │ transcript              │ │                         │   │ [ + گفتگوی تازه ]    │ │
│ │ ❯ prompt                │ │                         │   │ باز ۳                │ │
│ │ one state line          │ │                         │   │ پروژه‌ها ۱۷           │ │
│ └─────────────────────────┘ └─────────────────────────┘   └──────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────┘
                     (RTL: the sidebar is the RIGHT card, pane ۱ is top-right)
```

- `body.app` gets `padding: var(--gap); gap: var(--gap); background: var(--ground)`. The
  sidebar is a card (`--bg`, `--r-panel`, 1px `--border`); the **stage is not a card** — the
  panes are, directly on the ground. Cards inside a card would be the clutter we are removing.
- `#grid` loses `gap: 1px` on a `--border` background (the hairline-as-divider); panes are
  separated by `--gap` of ground.
- The rail (TERMINAL-REDESIGN §1) stays: same card, 48 px, and it follows the pane count
  (≥ 2 → rail) as it follows the split today.

## D4. The sidebar

Top to bottom, expanded (272 → 264 px):

1. **Head** — mark, brand («کلاد فارسی — ترمینال», `--wt-title`, `--fs-ui`), the **bell**
   (§D9) with its count, the rail toggle. One row, 40 px.
2. **One primary button** — «+ گفتگوی تازه» opens the new-session page (§D8). `--raise` fill,
   `--r-row`. The «۱ | ۲ | ۴» segmented control is **removed** (P3): the new-session page, the
   pane ✕, `/split` and the sidebar's «باز کردن در قاب تازه» cover it.
3. **Section «باز»** (open conversations; today's «نشست‌های باز») — label + count pill. Rows
   30 px: dot · title · project chip · trailing **state label** — «در حال کار» / «منتظر شما» /
   «خطا» / nothing when idle. Unread pill as today. ✕ on hover.
4. **Section «سنجاق‌شده»** — pinned projects, only when there are any.
5. **Section «پروژه‌ها»** — rows 32 px: **no folder icon, no caret**. Name (`--fg-muted`; the
   current project `--fg` + `--surface-2`), trailing session-count pill (`--fs-meta`,
   `--surface-2`). Click toggles the session list; `aria-expanded` stays on the button (the
   caret's job moves to the list appearing and to the state the reader hears). The current
   project is expanded by default.
   Session rows 28 px, indented `--pad`: the live dot only when the session is open, preview
   (one line, ellipsis), trailing **relative time** («۵ دقیقه پیش»,
   `Intl.RelativeTimeFormat("fa", {numeric: "auto", style: "narrow"})` over the timestamp
   `session_meta()` already returns, refreshed by the existing minute tick).
6. **Hover-revealed actions** (`⋯` and «+» on a project, `⋯` on a session) at **0 %** opacity
   → 100 % on row hover/`:focus-within`; never `display: none`, which also took them out of the
   tab order. *(Built in P1 as 0 %, not the 60 % first drawn here: at 60 % they were the same
   two icons per row the pass exists to remove. They stay focusable, so the keyboard reaches
   them, and the pointer always hovers before it clicks.)* **Context menu**: `contextmenu` on any row opens the same
   `kebabMenu()` at the pointer; Shift+F10 / the ContextMenu key on a focused row opens it at
   the row. One menu builder, three ways in.
7. **Footer** — «راهنما», zoom readout (§D13, only when ≠ 100 %), version, and the account's
   **quota meter** (moved out of every pane — it is per account, not per conversation).

Label style: `--fs-meta`, `--fg-faint`, `--wt-title`, 24 px tall, no rule lines.

**Built in P1 (2026-09-24), and one surprise it explained.** Eleven chrome rules asked for
`font-weight: 600`; only 400/500/700 are vendored, so the browser rendered every one of them at
700 — that, not the prose, is the "everything is bold" of the analysis. All of them now take
`--wt-title` (500); 700 is left to markdown headings and the diff marker. At ≤ 820 px the gutter
halves to 4 px: three 8 px gutters beside a 200 px sidebar left the picker 234 px wide, under
`test_layout.py`'s 240 px floor.

## D5. The pane (was "cell")

**Header, 28 px, one row.** Start (right): status dot (`.cell-dot`, `tabStatus()`), title
(`.topbar-title`, `<bdi dir="auto">`, `--wt-title`), project chip (`.topbar-name` kept — the
spec harness reads it — muted, `title` = full path, `.path` rules), worktree chip `⎇ agent-2`
when there is one. End (left): three 22 px icon buttons — `⋯` pane menu, `⤢` fullscreen,
`✕` take off screen. They sit at 60 % opacity, 100 % on pane hover/focus.

- **The digit badge `[۱]` goes** (it read as a debug label). Alt+N stays; the pane carries
  `aria-keyshortcuts="Alt+1"` and the title's tooltip names it, and **while Alt is held** a
  small digit appears at the start of every header (`body.alt-held`; set on `keydown` Alt,
  cleared on `keyup`/`blur`). Measure item M6: if Alt alone moves focus to browser chrome in
  app-mode, drop the reveal and keep the tooltip.
- **Focus**: the focused pane's border becomes `--border-strong` and its header gets
  `--surface`; its title is `--fg`, others `--fg-muted`. No coral ring, no glow, no motion. At
  one pane nothing is drawn.
- **Pane menu `⋯`** (reuses `kebabMenu()` and the `controls.js` openers): «تغییرات فایل‌ها»
  (§D12) · «مدل: {name}…» · «سطح تلاش…» · «لحن پاسخ…» · «سطح اجازه…» · an info row
  «هزینهٔ این گفتگو: $0.42» · «تغییر نام» · «شاخهٔ تازه از این گفتگو» (`/branch`) ·
  «هم‌اندازه کردن قاب‌ها» · «بستن گفتگو» (danger, armed like every delete).
- **`✕` takes the conversation off screen, it does not close it** («برداشتن از صفحه — گفتگو باز
  می‌ماند»): `park()` + the grid refits (§D6). Closing stays in the sidebar ✕ and the menu.
- **Fullscreen `⤢`**: `#grid[data-zoomed]`; every other pane and row gets `hidden` (their logs
  stay in the DOM — parking is not needed). The icon turns `⤡`. Exit: the same button, the
  chord from §D7, or **Esc only when Esc would otherwise do nothing** — no dialog or popup open,
  the turn not running, the prompt empty. Esc on a running turn stays a stop (TUI rule); a
  fullscreen exit must never cost the user their turn.

**One state line** (replaces the four status rows):

```
⏵⏵ ویرایش خودکار (shift+tab برای تغییر) · Opus 5.5 · ۲ عامل · ۱ فرمان در پس‌زمینه · ۳ فایل تغییر کرد · زمینه ۸۲٪
```

In this order, each item present only when it has something to say: posture (the TUI's own row,
kept word for word — BridgeMind's line is the same thing), model short name, background agents
(`agents.js`), background shells, changed files (§D12, clickable → the Changes panel), context
**only at ≥ 60 %** (amber at ≥ 80 %, the existing thresholds), the quota warning at
`QUOTA_WARN_AT`. One line; it ellipsises, never wraps. Above it, **only when the machine has a
statusLine script**, the script's own output as one line (plan B-7: we respect it, so it keeps
a row of its own).

Every fact that leaves the line gets one home — nothing is dropped:

| Fact | Was | Now |
|---|---|---|
| effort, output style | facts row | pane menu `⋯` (current value in the item) and `/status` |
| folder | facts row (`pathEl`) | header project chip (`title` = path) and `/status` |
| cost | facts row | pane menu info row and `/status` |
| quota meter | facts row, ×N panes | sidebar footer, once |
| session id | facts row | `/status` |
| key hints | `.composer-hint` | placeholder (ZWNJ only, §D10), `?` sheet, `help.html` |

This **reverses the 2026-09-08 "nothing is hidden, the stack scrolls" rule on purpose** — the
user's analysis asks for "one line of state". `test_split.py`'s "holds more than it shows"
assertion becomes "one line, and every re-homed fact is present in `/status`" (§D14 gate table).

**Empty states.**
- *No conversation at all* (home): centred, no card — mark, «کلاد فارسی — ترمینال»
  (`--wt-title`), one line «یک گفتگو را از فهرست کنار باز کنید، یا گفتگویی تازه بسازید.», one
  button «گفتگوی تازه» (→ §D8). Tips and version leave (they are in `?` and the footer).
- *A pane holding a conversation with nothing said yet*: the TUI banner stays (`✻` + title +
  cwd), `--fg-muted`, **no tips row**.
- *An empty pane* (`/split 4` with two conversations): header hidden; one line «این قاب خالی
  است» + one button «باز کردن گفتگو اینجا» (→ §D8 with count 1, targeting this pane). **No
  composer and no state line** in an empty pane (`.cell.blank` hides both; the elements stay so
  the "one of each part per cell" count holds).

**Weight.** Assistant prose `--wt-body` `--fg`; pane title `--wt-title`; welcome/home title
`--wt-title`; `--wt-strong` only inside markdown (`strong`, `h1–h3`). Nothing else is bold.

## D6. The grid that fits N

**Model change.** Today: a split count (1/2/4) and conversations placed into it. Now: **the
number of panes is the number of conversations on screen**, 1–6 (`MAX_TABS`). Opening a
conversation from the sidebar still replaces the focused pane's (unchanged); «باز کردن در قاب
تازه» (sidebar row menu) and the new-session page add panes; `✕` removes one. `setSplit(n)`
stays as the internal API (tests call it) and means "N panes"; `/split n` accepts 1–6.

**Algorithm** — pure function, `app.js layoutFor(n, W, H)`, where W×H is `#stage`'s content box
and `g` is `--gap`:

```js
function layoutFor(n, W, H, g = GAP, minW = PANE_MIN_W, minH = PANE_MIN_H) {
  let best = null;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const w = (W - (cols - 1) * g) / cols;
    const h = (H - (rows - 1) * g) / rows;
    if (w < minW || h < minH) continue;
    // A pane reads best around 1.5:1 (text lines want width). Score the side
    // that limits it; strict ">" keeps the FEWER-columns layout on a tie.
    const score = Math.min(w / 1.5, h);
    if (!best || score > best.score) best = { cols, rows, score };
  }
  if (!best) return null;                        // n does not fit this window
  const last = n - best.cols * (best.rows - 1);  // panes in the last row (1..cols)
  return { rows: Array.from({ length: best.rows },
           (_, r) => (r === best.rows - 1 ? last : best.cols)) };
}
```

Worked at the analysis's 1852×1044 (rail on: stage ≈ 1780×1028): n=3 → 2+1 (the third pane is
full width, 1780×510); n=4 → 2+2; n=5 → 3+2; n=6 → 3+3. At 1052×711 with the rail, n ≤ 4 fits
and 5–6 are refused.

**Refusal is never silent and never destructive.** When `layoutFor(n + 1)` is `null`, adding a
pane is refused: the new-session page greys out that count with the reason in its `title`; the
sidebar's «باز کردن در قاب تازه» places the conversation in the focused pane instead and says
so in the pane's own line («جا برای قاب دیگری نیست؛ گفتگوی قبلی در فهرست کنار است»).
**Shrinking the window never parks anything**: minimums apply to *adding* panes only; existing
panes get smaller.

**DOM.** `#grid` becomes a flex column of `.grid-row` (flex row) wrappers; `.cell`s live inside
them in reading order (RTL: pane ۱ top-right). Selectors that say `#grid > .cell` become
`#grid .cell` (tests: §D14). Every pane in a row has `flex: <fraction> 1 0`; every row has
`flex: <fraction> 1 0` in the column. Fractions default to equal.

**Dividers.** A `<div class="divider" role="separator" tabindex="0" aria-orientation=…
aria-valuenow=…>` between neighbouring panes in a row (vertical) and between rows
(horizontal). The divider *is* the gutter: 8 px of ground, widened to a 14 px hit area by
negative margins, drawing a 2 px `--border-strong` bar only on hover, focus and drag
(`cursor: col-resize | row-resize`). Drag uses pointer capture and updates the two neighbours'
fractions (their sum is preserved), clamped so neither goes below `--pane-min-*`; widths come
from `getBoundingClientRect()`, never from "left/right" (RTL-safe). No transition while
dragging. Keyboard on a focused divider: ←/→ (or ↑/↓) move it 24 px, Enter or double-click
equalises that row, the pane menu's «هم‌اندازه کردن قاب‌ها» equalises all.

**Persistence.** `pcg.layout` (sessionStorage, same reasoning as today — §D13 may move it)
becomes `{v: 2, panes: ["<tab>"|"" …], rows: [[f, f], [f]], rowH: [f, f], rail, zoomed}`. A
record whose shape does not match the restored pane count falls back to equal fractions; a
`v: 1` record (`{split, cells, rail}`) is read once and upgraded.

**Pane navigation** (chords are candidates until M1 — §D7): nearest pane in an arrow's
direction = the pane whose centre is closest along that axis among panes whose rect lies past
the focused one's edge on that side (computed from rects, so RTL needs no special case).

## D7. Keys — one table, decided after M1

All window-level chords move into one `PANE_KEYS` table in `app.js`, mirrored by a new
«Window» section in `wiki/tui-keys.md` that `test_keys.py` reads (the same "one copy" rule the
TUI chords already follow). Swapping a chord after measuring = one wiki row + one table entry.

| Action | Candidate | Fallback | Why the candidate might fail |
|---|---|---|---|
| focus pane N | `alt+1`..`alt+6` (extends today's 1–4) | — | measured and shipping for 1–4 |
| nearest pane ←↑→↓ | `alt+arrow` | `ctrl+alt+arrow` | Edge maps Alt+←/→ to Back/Forward — must be preventable in app-mode (M1) |
| next / previous pane | `alt+]` / `alt+[` | `ctrl+alt+pagedown/up` | Ctrl+Tab is browser-owned |
| fullscreen pane | `alt+enter` | `ctrl+shift+enter` | Alt+Enter may be claimed by the window (M1) |
| equalise panes | `alt+=` | — | — |
| take pane off screen | none (the `✕`, the menu) | — | Ctrl+W closes the window (deviation §5) |
| new session page | `alt+n` | `ctrl+alt+n` | Ctrl+N is browser-owned |
| notification centre | `alt+b` | — | — |
| zoom in / out / reset | `ctrl+=` / `ctrl+-` / `ctrl+0` | — | only if §D13 picks CSS zoom (native zoom needs no binding) |

Rules: every chord uses `e.code` (a Persian layout puts «۱» in `e.key`); none collides with
the TUI chords the prompt owns (`wiki/tui-keys.md` Global/Chat/Confirmation/Autocomplete/
HistorySearch — all checked free); every one is listed in the `?` sheet and `help.html`.

## D8. The new-session page

A full-stage view, `section#new-session` in `index.html` (outside the cell template, so an `id`
is allowed). While it is open `#grid` is `hidden` (not destroyed — conversations keep running);
Esc or «انصراف» closes it. Centred card, `--bg`, `--r-panel`, `--pad` × 2, max 640 px wide.

```
 گفتگوی تازه
 ─────────────────────────────────────────────
 پیش‌تنظیم     [ تنها ]  [ جفت ]  [ گروه ]  [ دلخواه ]
 پوشه          ▾ ClaudeCodePersianPort      D:\projects\ClaudeCodePersianPort
               (recent + pinned projects · «انتخاب پوشهٔ دیگر…»)
 چند گفتگو     [۱] [۲] [۳] [۴] [۵] [۶]        (unfit/over-limit counts disabled, reason in title)
 جداسازی       (•) همه در یک پوشه
               ( ) هر کدام در شاخهٔ جدا (git worktree)   — «این پوشه مخزن git نیست» when not
 کار مشترک     ┌─────────────────────────────────────┐  optional; sent to every session
 (اختیاری)     │                                     │  dir="auto", Shift+Space = ZWNJ
               └─────────────────────────────────────┘
 راه‌اندازی می‌شود
   ۱ · ClaudeCodePersianPort · شاخهٔ خودکار · سازنده
   ۲ · ClaudeCodePersianPort · همان پوشه · بازبین (فقط می‌خواند)
                                   [ انصراف (Esc) ]   [ شروع (Ctrl+Enter) ]
```

- **Presets are ours**: «تنها» = 1 · shared. «جفت» = 2 · **shared folder forced** (the reviewer
  must see the builder's files) · slot 2 is a reviewer: its posture is set to **plan**
  (`/api/posture`, the fourth posture — the CLI itself then refuses to edit) and its task is
  prefixed with `FA.presetReviewerBrief` («تو بازبین هستی: هیچ فایلی را تغییر نده. کار گفتگوی
  دیگر را در همین پوشه بخوان و گزارش بده.»). «گروه» = 4 · worktree when git, else shared.
  Touching any field turns the preset into «دلخواه».
- **Folder list** reuses `/api/projects` (pinned first, then recents) and `/api/project/pick`.
  The worktree option reads the project's existing `git` flag.
- **Count** is disabled above `MAX_TABS − open tabs` and above what `layoutFor()` fits, each with
  its reason (`FA.nsTooMany`, `FA.nsNoRoom`).
- **Launch, all-or-nothing** — client-only, existing routes:
  1. For each slot, sequentially: `POST /api/project/open {path, worktree?: "auto"}`. On any
     failure: `POST /api/tab/close` every tab this launch opened, show the reason inline
     (`reportOpenFailure()`'s 400/409 strings), stop.
  2. `setSplit(N)` (N panes), place the tabs in slot order, focus pane ۱.
  3. Reviewer slots: `POST /api/posture {tab, posture: "plan"}`.
  4. If the task is non-empty: `POST /api/message` per slot (role brief + task).
  Steps 3–4 failing is reported in that pane's own line; the sessions exist and are usable.
- **One server fix, no route:** `worktree: "auto"` picks the smallest free `agent-N` by checking
  the folder on disk (`server.py:519`), and the CLI creates the folder *after* spawn — two quick
  opens can get the same name. `next_worktree_name()` also skips names handed out earlier in
  this process (a module-level set under the store lock). Measured in P4 (M5).
- Entry points: sidebar «+ گفتگوی تازه», the home button, an empty pane's button, the chord.
  The project row «+» stays as the one-click path (one shared session, no page).

## D9. The notification centre

- **Model** (`app.js`, window memory, cap 50): `{id, tab, title, kind: "done"|"needs"|"failed",
  at, read}`. Produced in `noteTabEvent()` — which already sees every tagged event — from a
  `result` (not `replayed`; `aborted_streaming` is a stop, never news) and from
  `wrapper/permission_request`. **Not produced** when the tab is in the focused pane and the
  document is visible (the user is looking at it). A notice is marked read when its pane gets
  focus.
- **Bell** in the sidebar head (and in the rail): outline bell icon + count (fa-IR digits);
  the count takes `--st-wait` when any unread notice is "needs", else `--fg-muted`.
- **Panel**: a `[popover]` plate (`--bg-elev`, `--shadow-float`, `--r-card`; the opposite inset
  set to `auto`, per `wiki/editions.md`), opening from the bell toward the stage. Header
  «اعلان‌ها» + «همه خوانده شد». Rows: the state glyph (◉ needs, ⊘ failed, ● done) · title ·
  what happened («پاسخ داد» / «منتظر شماست» / «خطا داد») · relative time. Unread rows
  `--surface-2` and `--wt-title`.
- **Jump**: clicking a row → `switchTab(tab)` (focuses the pane, or places the conversation in
  the focused pane) → **flash** the pane: `.cell.flash` draws a 2 px `--border-strong` ring that
  fades over 700 ms (reduced motion: shown 700 ms, no fade). A notice whose tab is gone is drawn
  disabled with «این گفتگو بسته شده است».
- The existing OS notification (`render.js notifyTurnEnd`) keeps its conditions; its click now
  jumps to the tab the same way instead of only `window.focus()`.

## D10. The permission card and the composer

**Card** — the existing in-flow `.perm` dialog, restyled: `--raise`, `--r-card`, 1px
`--border-strong`, `--pad`. A new **eyebrow** above the title names the kind of action,
`permKind(tool_name)` in `perm.js`:

| Tools | Eyebrow (`FA.permKind.*`) |
|---|---|
| Edit, Write, MultiEdit, NotebookEdit | «تغییر فایل» |
| Bash, PowerShell, KillShell | «اجرای فرمان» |
| WebFetch, WebSearch, any `mcp__*` | «دسترسی بیرونی» |
| Read, Glob, Grep, LS | «خواندن» |
| ExitPlanMode | «طرح» |
| anything else | «ابزار» |

Body unchanged: `renderToolDetail()` (diff for edits, rule 8). **Options** — the TUI's three
plus one:

1. «بله» — allow once
2. «بله، و دیگر برای {tool} در این گفتگو نپرس» — allow for the session (`remember`, unchanged)
3. «نه، و بگو طور دیگری انجام دهد» — deny with the feedback field (the Esc row, unchanged)
4. **«نه، و کار را متوقف کن»** — new: `resolvePermission("deny")`, then `POST /api/interrupt
   {tab}`. Digit 4 binds in the Confirmation context; recorded in `wiki/tui-keys.md` as a
   window-local deviation (the TUI has no fourth option), asserted in `test_keys.py`. Not
   offered for AskUserQuestion (its own inputs and buttons, unchanged).

**Composer.**
- Placeholder by state: idle «پیام خود را بنویسید — نیم‌فاصله: Shift+Space» (`FA.phIdle`);
  running «در حال کار — پیام بعدی در صف می‌ماند · Esc برای توقف» (`FA.phBusy`), switched in
  `setBusy()`. `.composer-hint` and its four `FA.hint*` keys go (their content: placeholder,
  `?` sheet, `help.html`).
- **A failed send puts everything back**: the submit handler snapshots text, pastes and
  attachments before clearing; the catch branch restores them through the existing
  `restoreDraft()` and says «ارسال نشد — متن به جعبهٔ پیام برگشت» (`FA.sendFailedRestored`).
- Auto-grow caps at 35 % of the **pane** (`cell.root.clientHeight`), not of the window.

## D11. Folding and streaming

Every rule is a function of the events, so live and replay fold identically
(`wiki/frontend-modules.md` §"A reload RE-RENDERS every finished turn").

1. **Long user messages**: more than 8 lines or 600 characters (counted on the text, not
   measured — a background pane has no layout) → `.msg.user.fold`: `max-block-size: 6lh`, a
   bottom fade (`mask-image`), and a «بیشتر» / «کمتر» button (`aria-expanded`). The whole text
   stays in the DOM (copy, `/export`, find).
2. **Tool runs show the latest call**: `toolHome()`'s group becomes `.run` — the newest card
   visible as itself, earlier ones behind «+N مورد قبلی» (`<details class="run-earlier">`).
   Built by hand like today's group (never via `card()`); cards move between the two slots as
   nodes, so `state.toolCards` routing is untouched; `isRunnable()` excludes `.run`. The cycle
   fold (three identical pairs → «N بار», newest pair wins) is unchanged — its pair is a lone
   card in the log, which a run never contains.
3. **Long histories render their tail**: a replayed transcript (`backfillTab` / resume) over 400
   events renders the last ~300, **snapped to a user-turn boundary** (so every `tool_result` is
   in the same chunk as its `tool_use`), and keeps the rest on the tab entry. A «نمایش
   پیام‌های قبلی (N)» row at the top renders the previous chunk through the same `renderEvent`
   into a fragment (`withRenderTarget` with a fresh scope) and prepends it, holding the scroll
   position. Live conversations are never truncated.
4. **`content-visibility: auto; contain-intrinsic-size: auto 120px` on `.log > *`** — behind a
   `.log.cv` class, switched on only after the spec harness's exact-pin "stick to bottom" check,
   `/export` and find-in-page are shown to still work with it (P7 exit).
5. **Streaming, progressively** (the corrected group-3 item): while a message streams, text up
   to the last blank line **outside a code fence** is a sequence of completed blocks; each is
   rendered once with `renderMarkdown()` (so it gets `applyDirection` and token isolation) and
   frozen; only the trailing block stays plain text in the existing rAF-coalesced paint. The
   final `assistant` render still replaces the whole bubble — it stays the authority.

## D12. The Changes panel — the one new route

**`GET /api/changes?tab=<id>[&file=<path>]`**, both editions may call it, only the terminal
edition does. The working directory comes from the **tab's session** (`worktree_cwd` when it is
a worktree) — never from the request, the same key-not-path rule as `open_known_file`.

- `git` from `shutil.which`; none → `{state: "no-git"}`. Not a work tree
  (`git rev-parse --is-inside-work-tree`) → `{state: "no-repo"}`.
- List: `git -c core.quotepath=off status --porcelain=v1 -z --untracked-files=all` (the
  `quotepath` flag is what keeps a Persian filename from arriving as octal escapes) plus
  `git diff --numstat -z` for the counts → `{state: "ok", files: [{path, status, add, del}]}`,
  capped at 500 entries.
- One file: `&file=` must be a path **in that list** (validated, never used raw) →
  `git diff --no-color --no-ext-diff -- <path>`; an untracked file is read (≤ 256 KiB, text) and
  returned as an all-added diff. Over 200 KiB of diff → `{state: "too-large", lines}`.
- Every call: 10 s timeout, `CREATE_NO_WINDOW`, UTF-8 with `errors="replace"` (the `run_shell`
  pattern).

**Panel** — inside the pane, replacing the transcript view while open (the log stays in the
DOM). Head: «→ گفتگو» (mirrored arrow glyph), «تغییرات · ۳ فایل», refresh. Two groups:
«تغییرات این گفتگو» — files this session's own Edit/Write/MultiEdit/NotebookEdit calls touched
(`state.touched`, filled in `renderEvent` from `tool_use` inputs, so it replays) — and «تغییرات
دیگر در این پوشه», collapsed. Rows: status chip, path (`.path`), `+N −M` (`.diff-stat`, LTR +
isolate — the "+2 −1" lesson). A row expands its diff, rendered by a new
`renderUnifiedDiff(text)` that builds the **same** `.diff > .dl > .dn + .dt[dir="auto"]` rows as
`renderDiff()`, so rule 8 and spec cases 9–10 cover it. States: «در حال خواندن…», «تغییری نیست»,
«این پوشه مخزن git نیست», «git روی این رایانه نصب نیست», «برای نمایش بزرگ است ({n} خط)».
Opened from the pane menu and from the state line's «N فایل تغییر کرد», whose count comes from a
`&summary=1` call after each `result` of that tab. Esc closes it when focus is inside it.

## D13. App zoom, storage and fonts — built so a measurement swaps a value

- **Zoom**, `ZOOM_MODE` in a new leaf module `prefs.js`:
  - `"native"` (preferred): Edge's own Ctrl+= / Ctrl+- / Ctrl+0. Nothing to build but the
    `?`/help rows — **if M2 shows the level survives a relaunch** (Chromium keeps zoom per
    *host*; our port changes, our host does not).
  - `"css"` (fallback): `:root { zoom: var(--zoom) }`, steps 80/90/100/110/125/150 %, the three
    chords `preventDefault`ed and handled, a readout in the sidebar footer. Needs M4 (our
    hand-positioned popovers under root `zoom`) and persistence (below).
- **Storage**, `PREFS_STORE` in `prefs.js`: `"session"` (today: `pcg.layout` dies with the
  window) or `"local"`. `localStorage` is per *origin*, and the port changes every run, so
  `"local"` only works with a **stable port**: `server.py` first tries the port it used last
  (`port.json` next to `recents.json`), falling back to a random free one. The token stays
  random per run, so this costs no security. One server change, no route, only if M2 says we
  need it — it would also keep the OS-notification permission across launches.
- **Fonts**: weights are used only through `--wt-*`. If M3 finds a variable Vazirmatn
  (OFL-licensed like the static files), the swap is one `@font-face` block and three token values
  (e.g. 400/520/680); nothing else reads a weight.

### Measure first — what the user runs on Windows (P0 ships the probe)

`probe_edge.py` (new, stdlib, free): writes a throwaway probe page, boots the real server,
opens it in Edge **app-mode** like the shortcut does, and shows a table on screen to screenshot.

| # | Question | How the probe answers it |
|---|---|---|
| M1 | Which chords reach the page, and can `preventDefault` stop the browser's action? `ctrl+w/t/n/d`, `ctrl+tab`, `ctrl+shift+tab`, `ctrl+pageup/pagedown`, `alt+←↑→↓`, `ctrl+alt+arrows`, `alt+enter`, `alt+n`, `alt+b`, `alt+=`, `alt+[`/`]`, `ctrl+=`/`-`/`0`, `f11` | a row per chord: seen / prevented / what the window did |
| M2 | Across two launches on different ports: is the zoom level kept? `Notification.permission`? `localStorage`? And with the same port? | run twice (`--port` flag on the probe), compare |
| M3 | Is there a variable Vazirmatn release, its licence, size; does 450/550 render better than 400/500 in Edge at 13/15 px? | downloads nothing; the user checks upstream, drops the file in, the probe renders both side by side |
| M4 | Only if M2 says CSS zoom: do kebab / hover card / picker land under their anchors at 125 %? | opens each at 125 % and prints anchor vs box |
| M5 | Two quick `worktree: "auto"` opens: same name? | runnable here too (real `claude` + git) — done in P4 |
| M6 | Does pressing Alt alone move focus into browser chrome in app-mode? | keyup Alt, then report `document.activeElement` |

## D14. Phased build plan

> **Build status, 2026-09-24.** P0–P9 are built on `claude/sleepy-hypatia-gaj477` and P10's
> docs are written (terminal edition 0.2.0). Every phase's shot set was taken in the Linux
> container with the Chromium 141 workaround, **not yet on Windows Edge**. P0's measurements
> (M1–M4, M6: run `probe_edge.py` on the target PC) are still open. They decide three swappable
> values: the Alt chords in `PANE_KEYS`, and `ZOOM_MODE` and `PREFS_STORE` in `prefs.js`. M5 (the
> worktree name race) was answered in code, by the server's name reservation.
> Deviations from the table below: P5's checks live in a new `test_notices.py` rather than in
> `test_shell.py`. P7's `content-visibility` is written behind `.log.cv` but not switched on,
> because find-in-page cannot be proven headless. P9 built no stable port, since M2 has not said
> one is needed.

Every phase: branch commits, then **exit = the gates below + a shot set**. `shots.py` (P0)
renders the terminal edition headlessly at 1852×1044, 1280×800 and 1052×711 from synthetic
events (the `test_split.py` way) into `shots/<phase>/` (git-ignored). I compare them against the
reference screenshots in `ref/` (git-ignored: BridgeMind is a commercial product and this repo is
public; the user keeps them locally or sends them in chat), post the pairs, and the phase closes
when the user has seen them. On the Linux container `shots.py` applies the measured Chromium 141
workaround (a same-value `style.contain` write on each `.composer`, `wiki/dev-environment.md`)
before capture; on Windows it does nothing.

Scenes (grown per phase): home · new-session page · one conversation (Persian prose, code, a
tool run, a diff) · 3 panes · 4 panes running/waiting/error/idle · permission card · bell open ·
Changes panel · fullscreen · rail.

| Phase | Builds | Reuses | Gates that change | Visual exit |
|---|---|---|---|---|
| **P0** Measure & tools | `shots.py`, `probe_edge.py`, `.gitignore` (`shots/`, `ref/`); M1–M6 run by the user | `test_layout.boot_server()`, the `NO_SSE` stub | none | today's app, all scenes (the "before" set) |
| **P1** Tokens, cards, type, sidebar | §D2 tokens; §D3 ground + cards; §D4 sidebar rows, labels, pills, hover actions, context menu, scrollbars, footer quota; weights (§D5 last para) | `kebabMenu()`, `session_meta()` timestamps, the minute tick | `test_layout` (sidebar card inset by `--gap`: right edge = `clientW − gap`), `test_split` (`#grid` gap), spec terminal (dot/menu assertions if touched) | home, one conversation, rail |
| **P2** The pane | §D5 header (`⋯ ⤢ ✕`, Alt-held digits), focus, one state line + fact homes, `.composer-hint` removed, empty states, fullscreen | `tabStatus()`, `paintCells()`, `setStatus()`, the `controls.js` openers, `park()` | `test_shell` (status rows: [custom?] + state line), `test_split` ("holds more than it shows" → one line + `/status` carries the re-homed facts; badge checks → header checks; `LOG_SHARE` re-measured and raised), `test_strings` (dead `hint*` keys), `test_keys` (fullscreen chord if M1 is in) | 4 panes with four states, empty pane, fullscreen |
| **P3** Grid that fits N | §D6 `layoutFor`, `.grid-row`, dividers, pane-count model, `/split 1..6`, «باز کردن در قاب تازه», `pcg.layout` v2, §D7 `PANE_KEYS` | `setSplit()`, `placeIn()`/`park()`, `saveLayout()`/`restoreLayout()`, `focusCell()` | `test_split` (`#grid .cell`, 3/5/6-pane cases, refusal, divider drag + keys, v1→v2 upgrade), `test_layout` (split4 selector), `test_reload` (fractions survive), `test_keys` (Window section) | 3 and 5 panes, a dragged divider |
| **P4** New-session page | §D8 page, presets, all-or-nothing launch, reviewer = plan posture; `next_worktree_name` reservation (M5) | `/api/project/open`, `/api/tab/close`, `/api/posture`, `/api/message`, `/api/projects`, `reportOpenFailure()`, the ZWNJ handler | new `test_newsession.py` (routes stubbed: order, rollback on a 409, posture before message, disabled counts); `test_units` (name reservation) | the page with each preset; after launch, 2 and 4 panes |
| **P5** Notification centre | §D9 model, bell, panel, jump + flash, OS-notification click jumps | `noteTabEvent()`, `switchTab()`, `tabTitle()`, `notifyTurnEnd()` | `test_shell` (a hidden-pane `result` makes one notice, a focused-visible one none, a replayed one none; click → focus + `.flash`; closed tab → disabled row) | bell panel open with three kinds |
| **P6** Permission card & composer | §D10 eyebrow, option 4 (deny + interrupt), placeholders, failed-send restore, pane-relative auto-grow | `choice.js optionList`, `resolvePermission()`, `/api/interrupt`, `restoreDraft()`, `setBusy()` | `test_keys` (Confirmation digit 4), `test_dialogs` (option list), spec terminal (card structure), `test_shell` (a failed send restores text) | permission card for each eyebrow kind |
| **P7** Folding & streaming | §D11 1–5 | `toolHome()`, `openCycle()/closeCycle()`, `renderInTab()`, `withRenderTarget()`, `queueStreamText()`, `renderMarkdown()` | `test_column` (runs: latest visible, «+N»), spec terminal (`details.card.tool:not(.group)` selectors → `.run`; long-message fold replays identically; progressive stream then final render byte-identical; exact-pin stick with `.log.cv`) | a long thread, a 6-call run, a folded long message, mid-stream frame |
| **P8** Changes panel | §D12 route + panel + state-line count | `renderDiff()` row builders, `.path`, `.diff-stat`, the `run_shell` subprocess pattern, `worktree_cwd` | `test_units` (a temp git repo: states, Persian filename, file-not-in-list refused, untracked, too-large, no-repo), spec terminal (unified diff through rule 8) | panel with a Persian filename and a Persian diff line |
| **P9** App zoom | §D13 per M2/M4; stable port only if needed | `prefs.js`; `server.py` bind | `test_keys` (zoom chords if CSS), `test_units` (port preference falls back when taken) | 125 % shot set |
| **P10** Docs & release | `help.html` (new keys, new-session page, bell, Changes, zoom), `wiki/editions.md` + `wiki/grid.md` rewritten for the pane model, `TERMINAL-REDESIGN.md` note, CLAUDE.md, terminal version bump in `EDITIONS` | — | all terminal gates green on Windows Edge; web gates untouched (no `static/` change) | the full shot set, side by side with `ref/` |

**Beads.** Epic `pcg-bmp`; phase P*n* is `pcg-bmp.`*n+1* (P0 = `pcg-bmp.1` … P10 =
`pcg-bmp.11`), with the dependencies below encoded.

**Order and dependencies.** P0 first (P3's chords, P9 entirely and P1's font choice wait on
it). P1 → P2 → P3 → P4 in order (each restyles what the next builds on). P5, P6, P7, P8 are
independent after P2 and can go in any order. P9 after M2/M4. P10 last.

**Risks.**
- The pane-count model (§D6) changes a rule users of the grid already know («۱|۲|۴» and
  parking on shrink). The segmented control's removal is the most visible single change — shown
  first in P3's shots, easy to restore as a compact «چیدمان» item in the pane menu if missed.
- `content-visibility` interacts with scroll anchoring and `innerText`; it stays behind `.log.cv`
  until P7 proves the three checks.
- Progressive markdown can disagree with the final render on constructs that span blank lines
  (loose lists, reference links); the final render wins, so the worst case is a one-time reflow.
- Linux headless is not the target renderer (Chromium 141 layout bug): gates run in both places,
  but the shot set that closes a phase is taken on Windows Edge when the user can, and in the
  container otherwise with the workaround applied and said so.
