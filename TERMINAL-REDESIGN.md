# TERMINAL-REDESIGN.md — the terminal edition, redrawn (design + phased build plan)

> **Superseded in part, 2026-09-24.** `BRIDGEMIND-PORT.md` §D is the current design for the
> terminal edition (epic `pcg-bmp`). It replaces §2.4 (density and the "nothing hidden" status
> stack), §3 (the «۱ | ۲ | ۴» control) and §5 (tokens). §1 (sidebar on the right, the rail) and
> §4 (the status model) still stand. The rest is history: read it for the why, not the what.
> **Built 2026-09-24** (P1–P9, terminal edition 0.2.0): the «۱ | ۲ | ۴» control this document
> designed is gone, replaced by the pane-count model of `BRIDGEMIND-PORT.md` §D6.

Bead `pcg-qdj`. Architect pass, 2026-09-10. Design only — no code. Skill: `ui-ux-pro-max`
(stack: plain HTML/CSS, no framework) under the calm `emil-design-eng` direction;
`gpt-taste` / `high-end-visual-design` deliberately not used.

Fixed by the user this session, not re-opened here: reference = BridgeMind One
(`wiki/bridgemind-one.md`); keep the tiling grid and give it a VISIBLE control; a full pass,
not targeted fixes; the sidebar moves to the RIGHT; the accent stays coral
(`assets/make_icon.py`).

## 0. Corrections to the brief (measured against the code)

1. **"No status dots, no per-session busy/waiting/failed signal anywhere" — wrong.** The
   `idle|running|waiting|error` model already exists as one function,
   `static-terminal/js/chrome.js:149 tabStatus()`, painted on the sidebar's open-tab rows
   (`.tab-dot`), on the matching history rows (`.sess-dot`) and as the
   «N در حال کار / N منتظر تأیید» chip over the group (`style.css:356-418`,
   `strings.fa.js:246-258`). What is missing is only the per-CELL paint site. §4 reuses it;
   nothing new is computed and no server event is added.
2. **Topbar "same path twice"** — settled by the coordinator: a probe artifact (`\p`, `\C` eaten
   by a JS string literal). By construction the bar is basename (`.topbar-name`) + full path
   (`.topbar-cwd`, mono), and the session title appears nowhere. A composition question; §2.
3. **"Vendored fonts: Vazirmatn + a mono"** — no mono is vendored (`static-terminal/fonts/`
   holds three Vazirmatn weights). The mono stack is `Cascadia Code, Consolas`; both are system
   fonts on every Windows 10/11 image, so offline is fine. Nothing to vendor.
4. **The 40–45 % figure.** In the gate's own 4-up cell (382x337, `test_split.py:63`) the chrome
   is topbar 30 + prompt 50 + status stack (two-row clamp) 46 = **126 px = 37 %**, transcript
   63 %; the composer+status pair alone is 28 %. Right in spirit — and the floor is closer than
   it looks (§2.4).
5. The rest of the brief matches the code: no window bar; `/split` is the only way in;
   `help.html:377` names it in passing; the sidebar is 288 px of brand + one button + an empty
   label at 4-up; the focused cell is a 1 px inset ring and nothing else.

## 1. The shell

**Recommendation.** One grid: sidebar in grid column 1 (= RIGHT under `dir="rtl"`), stage in
column 2, and the sidebar has TWO widths — expanded (272 px, the tree) and a **rail** (48 px):
brand mark, «+», the split control stacked, one status dot per open conversation with its
unread count, the running/waiting count as a ring, help, and the expand toggle. That is
BridgeMind's rail (`wiki/bridgemind-one.md`: "an unread badge and a running-count badge on the
rail") drawn from elements this sidebar already paints. The width FOLLOWS THE SPLIT — `/split
2|4` (or the control) collapses to the rail, `/split 1` expands — and the toggle in the sidebar
head overrides that until the next split change; both facts ride in the existing
`sessionStorage` record `pcg.layout` (`app.js:650`), so a reload restores them and a relaunch
forgets them, exactly like the split itself.

Arithmetic that earns the rail: at 1052 px a 4-up cell is (1052−288)/2 = 382 px wide today and
(1052−48−1)/2 = **501 px** with the rail — 31 % wider, and above the 496 px `wiki/grid.md`
records as the width that first broke the shell.

**No tab strip.** The «نشست‌های باز» group in the sidebar IS the tab list — title, project
chip, dot, unread, ✕ (`chrome.js:202-275`). A strip above the grid would duplicate it and take
~36 px off four transcripts at once. BridgeMind's tabs are its ONLY multi-agent surface; we
have a tiling grid plus this group, which together cover the same job.

**Rejected.** (a) A narrower fixed sidebar (240 px) — buys 24 px per cell, keeps the dead
space. (b) Auto-hiding the sidebar at 4-up — loses the one overview of "which of the four needs
me" that the rail exists to keep on screen. (c) A window bar holding the control (the web
edition's `#window-bar`) — 36 px of height off every cell; the sidebar head costs the grid
nothing.

**The flip itself** (undo E2's swap, `wiki/editions.md` §"The terminal edition's left sidebar"):
- `style.css:162-176` → `body.app { grid-template-columns: var(--side-w) minmax(0,1fr) }`,
  `#sidebar { grid-column: 1 }`, `#stage { grid-column: 2 }`, keep both `grid-row: 1` pins (the
  comment at :166 explains the 958x0 stage they prevent). `--side-w` is 272 px, 48 px under
  `body.rail`; the two `@media` blocks at :2851-2857 set the EXPANDED width only (244 / 200) by
  overriding `--side-w`, never the shorthand.
- `#sidebar` border: `border-inline-start` → `border-inline-end` (its inner edge now faces the
  stage on its left).
- `#agent-drawer` (`style.css:2634-2636`): `inset-inline-end: 28px; inset-inline-start: auto` —
  physical left, away from the right sidebar. The OPPOSITE inset must be `auto` (the popover UA
  sheet's `inset: 0` over-constrains the box; measured in `wiki/editions.md`).
  `test_layout.py:488-496` already asserts drawer ∩ sidebar = ∅ and catches the one-property version.
- `chrome.js:947-979 showPreview()`: the card opens off `pane.left − card.offsetWidth − 10`,
  clamped ≥ 8, instead of `pane.right + 10`.
- `chrome.js:1065-1082 kebabMenu()`: correct as is — `left` is clamped to the window and
  `right: auto` already frees it. Polish only, BOTH editions (flag, do not assume): anchor the
  menu's right edge to the button's right edge (`rect.right − menu.offsetWidth`) so it opens into
  the sidebar instead of being clamped against the window edge.
- `test_layout.py:480-487`: assert `side.x + side.w == clientW` and `stage.x == 0` (today
  `side.x == 0`). Same measurement, other edge — not a weaker gate.

## 2. The cell

**2.1 Identity row (the topbar).** Under RTL, reading right → left:
`[۱]  ●  عنوان گفتگو …  نام‌پروژه` — the digit badge (kept: Alt+N needs a visible name), a
status dot (`●` U+25CF, the binary's own bullet, recoloured by `tabStatus(cell.tab)`), the
SESSION TITLE as `<bdi dir="auto">` from the same `sessionTitles` map the sidebar and
`document.title` already draw from (`chrome.js:186 tabTitle()`; «گفتگوی تازه» until the wrapper
names it), then the project's display NAME as a muted `<bdi dir="auto">` chip capped at 12ch
(the `.tab-proj` shape, `chrome.js:314 projectChip()`) carrying the full path in its `title`.
The mono full-path chip leaves the bar: the path is already the «پوشه» item of the status line
(`render.js:1764`, rendered through `pathEl`) and stays in the chip's tooltip, so plan §B-10
item 2 loses no path site and every remaining one is still `.path`/`<bdi>`. KEEP the
`.topbar-name` element and what `setChrome()` writes into it (`chrome.js:396`) — the terminal
`spec-test.html` reads `#topbar-name` in three background-tab assertions (`:1798-1832`); it
simply becomes the chip. One row, 26 px; the title ellipsises, everything else is `flex: none`.

Paint site: `repaintTabs()` (`chrome.js:120`) gains `paintCells()` — for each cell in
`tabBridge.cells()`, write `.cell-dot[data-status]` plus `aria-label`/`title` from
`FA.tabStatus[...]`, and `.topbar-title` from `tabTitle(openTabEntry(cell.tab))`. It already
runs on every `result`, `command_lifecycle`, permission change and `/api/tabs` answer
(`app.js:295-321`), so the cell dot cannot disagree with the sidebar dot. Guard on
`cui(cell).topbarTitle` being null — the harness has no cells. An empty column keeps the badge
and hides the rest (the existing `.cell.home .topbar-*` rule, `style.css:775`).

**2.2 Focus.** Keep the 1 px inset coral ring (`style.css:704`) and add two quiet cues: the
focused cell's identity row is `--fg` while unfocused rows are `--fg-muted`, and its badge fills
coral (already `:722`). No background change on the whole cell, no animation — a keyboard action
repeated hundreds of times a day does not animate (emil). At `data-split="1"` nothing is drawn.

**2.3 Waiting.** The dot goes `--warn` and breathes (`ag-pulse`, the strip's own keyframes,
stopped by the reduced-motion rule), and the inline dialog is right there in the cell. No ring
recolour: colour-only signalling is the a11y anti-pattern; the dot carries the word.

**2.4 Density — the honest arithmetic.** Per-cell chrome floor after this pass: identity 26 +
prompt 40 (`.comp-box .input` `min-height` 36 → 32, `.comp-box` padding 8/4 → 5/3) + status
stack two rows at a tighter leading (46 → 37: `.statusline` `line-height` 1.6 → 1.45, font
`.74em` → `.72em`, clamp recomputed) = **103 px**. In the gate's 337 px cell that is 69 %
transcript (was 63 %); in a 1280x800 4-up (~399 px cells) 74 %. **Nothing is hidden and the
stack still scrolls**: `test_split.py:741-749` asserts the stack is ≤ `STATUS_CAP` (64) AND
`scrollHeight > h + 2` ("it fits, so a field was dropped") — that assertion IS the 2026-09-08
decision in `wiki/grid.md`, and it stays. The only lever above ~70 % is a one-row stack at short
cells, which that assertion forbids and the user already rejected; so the number to demand is
**≥ 65 %, gate raised from 40** (`LOG_SHARE` 40 → 60 at both `LOG_SHARE_AT` sizes: 65 the
target, 60 the bar so a one-pixel font change is not a red gate).

**Rejected.** (a) Facts row as one ellipsised line with a «…» that opens the existing `/status`
block — a visible affordance, but it trips the "holds more than it shows" assertion and reopens
the hidden-field argument. (b) Title in the status line instead of a topbar — identity belongs
at the top edge, which is where a reader scanning four cells looks (and where BridgeMind's
tabs sit). (c) Dropping the digit badge now that titles exist — Alt+N would name nothing.

## 3. The split control

**Recommendation.** A three-segment «۱ | ۲ | ۴» control (`aria-pressed`, fa-IR digits) in the
sidebar under «گفتگوی جدید», on a row labelled «چند گفتگو کنار هم»; in the rail the same three
buttons stack vertically and the label hides. It is the web edition's control ported verbatim
(`static/js/app.js:219-240 paintSplitControl()`, `static/style.css:605-645`): same `setSplit()`,
same `data-split`, `/split` and Alt+N untouched, POSTs nothing. Declared departure from V2-PLAN
§2 «no chips»: this is chrome about the WINDOW, not a mirror of a CLI capability, and the user
decided it. `help.html` §«چند گفتگو هم‌زمان» leads with the control and keeps `/split` as the
typed way; the `?` sheet is unchanged (no new chord).

**Rejected.** (a) One per cell topbar — four copies of a window-level control in the narrowest
bar of the app. (b) Behind a menu — "readable at a glance from across the room" is the whole
reason the web edition chose a segmented control (its own comment, `:605-608`).

## 4. Status signalling — existing events only, no server change

| State | Derived from (already in the window) | Event chain on the wire |
|---|---|---|
| running | `scope.outstanding.size > 0` (`app.js:336`) | `wrapper/user_echo` carries the `uuid` that opens the ledger; `command_lifecycle` `completed / cancelled / discarded / refused` closes it; backstops: `wrapper/idle_sync`, the synthetic `discarded` on process exit, a `result` with `terminal_reason: aborted_streaming` |
| waiting | `permAsking(tab)` (`perm.js`), or `/api/tabs` `pending_permission` for a tab this window never saw ask (`chrome.js:157`) | `wrapper/permission_request` → `wrapper/permission_resolved` |
| error | `scope.error` | `result` with `is_error` and not `aborted_streaming`; cleared by the next send |
| idle | none of the above | — |
| unread N | the `unread` map (`app.js:216, 304-307`) | a `result` for a tab in no cell with `replayed !== true` |

Paint sites after this pass: `.tab-dot` (sidebar row / rail dot), `.sess-dot` (history row),
`.tabs-badge` (group chip / rail ring), **`.cell-dot` (new)**. One function, four sites.

## 5. Tokens (`@layer tokens`, `style.css:56-104`) — CSS custom properties

The palette moves from claude.ai's warm graphite to BridgeMind's neutral near-black — which is
also what a default Windows Terminal ground (#0c0c0c) looks like, so for THIS edition it is the
more faithful choice; the web edition keeps warm graphite. Coral stays. Contrast on `#0a0a0a`:
`#fafafa` 19:1, `#a1a1a1` 7.4:1, coral `#d97757` 6.5:1 (text-safe), `#6e6e6e` 3.6:1 → tertiary
and large glyphs only, never body text.

```css
:root {
  --bg: #0a0a0a;  --bg-side: #0a0a0a;           /* one ground; a hairline separates the panes */
  --bg-elev: #161616;                            /* menus, drawer, preview card: OPAQUE, never translucent */
  --surface: rgb(255 255 255 / .04);  --surface-2: rgb(255 255 255 / .07);
  --border: rgb(255 255 255 / .08);   --border-strong: rgb(255 255 255 / .14);
  --fg: #fafafa;  --fg-muted: #a1a1a1;  --fg-faint: #6e6e6e;
  --accent: #d97757; --accent-strong: #c4633f; --accent-soft: rgb(217 119 87 / .14);
  --danger: #e5695a; --danger-bg: rgb(229 105 90 / .12); --warn: #d9a441; --ok: #82c091; --bash: #b072b5;
  --radius-sm: 6px; --radius: 10px; --radius-lg: 16px;   /* ref. 22px is for large cards; the column has no boxes */
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-6: 24px;
  --side-w: 272px; --rail-w: 48px;
  --fs-base: 15px; --fs-ui: .88rem; --fs-meta: .74rem;  /* ref. 13.5px is Latin; Persian at 15 */
  --lh-fa: 1.9;                                          /* spec rule 4 — unchanged, non-negotiable */
  --lh-ltr: 1.5;                                         /* LTR/mono containers only (already 1.55) */
  --wt-title: 500;                                       /* Vazirmatn ships 400/500/700; 600 is not vendored */
  --dur: 160ms; --dur-slow: 240ms;
  --ease: cubic-bezier(.22, 1, .36, 1);                  /* the reference's curve at our duration; never .5s */
}
```
Rules riding with them: no `letter-spacing` on Persian (tracking breaks joining — the
reference's −.01em is Latin-only); the `prefers-reduced-motion` block stays; hover states only
under `(hover: hover) and (pointer: fine)`; `:active { transform: scale(.97) }` on every
pressable (the split control already has it); popovers scale from their trigger, the drawer from
centre; NO transition on the rail toggle or on the split — the layout change is the feedback and
both are keyboard-repeatable. Mono stays system `Cascadia Code, Consolas` (§0.3).

**Cheap to retune from the screenshot when it arrives (token-level):** every value above; dot
size and shape; row heights; the rail width; hover tints; radii; whether the sidebar carries a
tint. **Expensive (structural — decided here):** the sidebar side; rail-vs-tree; the grid; the
cell topbar's contents and order; the control's home; the status stack's DOM order (gated by
`test_shell.py:463-469`); the `.msg` line-height floor.

## 6. Where this knowingly departs from TUI fidelity

1. A per-cell identity row — the TUI has the terminal's title bar, one per window; four
   conversations in one window need four. 2. Status dots and the rail — the TUI has a spinner
   and knows nothing about other sessions; this is the user-approved "sidebar + tabs" addition,
   no wider. 3. A clickable split control — a terminal has no layout at all. 4. Nothing else:
   the column, the prompt, the inline numbered dialogs, the status stack's rows and order, the
   glyphs and the keys are untouched.

## 7. Phased build plan — the user sees both asks after Phase 1

**Phase 1 — Shell: sidebar right, visible split, new tokens.** Files: `style.css` (tokens
layer; `body.app` grid; `#sidebar` border; `#agent-drawer` insets; `@media` widths;
`#sess-card`), `index.html` (split row in the sidebar:
`<div class="side-split"><span class="side-split-label"></span><div id="split-seg" role="group"></div></div>`),
`js/app.js` (`paintSplitControl()` ported from the web edition, called from `setSplit()` and at
boot), `js/chrome.js` (`showPreview` x-anchor; the label text), `strings.fa.js` (`splitLabel`,
`splitOptionTitle` — copy from `static/strings.fa.js:359-360`), `help.html`
§«چند گفتگو هم‌زمان», `test_layout.py:480-487`, `test_split.py` (the web-only split-control
checks become both editions: `CHECKS` +2, `LAYOUT_CHECKS` +1). Exit: headless shots (recipe:
`wiki/dev-environment.md` §"Headless --screenshot") at 1280x800 and 1052x711, split 1 and 4,
sidebar on the right; clicking «۴» draws four cells; `test_layout`, `test_split`,
`test_strings`, `test_dialogs`, `test_reload` PASS under `PCG_UI=terminal`.

**Phase 2 — Cell: identity, focus, density.** Files: `index.html` (cell template topbar:
`.cell-badge`, `.cell-dot`, `.topbar-title`, `.topbar-name` as the chip; `.topbar-cwd` removed —
keep the `.comp-mark` SVG byte-identical, `test_column.py:311-316` re-reads it), `js/chrome.js`
(`paintCells()` inside `repaintTabs()`; `cui()` fields; `setChrome()` writes the chip's
`title`), `style.css` (topbar; `.cell.focused`; composer/status density; the
`@container (max-height: 460px)` block), `test_split.py` (`LOG_SHARE` 40 → 60). Exit: a 4-up
shot with one cell each running / waiting / error / idle (synthetic events, as
`test_split.py:429-439` already drives) with readable titles; `test_split` PASS at the raised
bar; `run_spec_test.py` terminal 179/179 (the `#topbar-name` cases untouched); `test_shell`,
`test_column`, `test_keys` PASS.

**Phase 3 — Rail.** Files: `index.html` (toggle button in `.side-head`), `js/app.js`
(`body.rail`; `pcg.layout.rail`; the follow-the-split rule; apply the class inside
`restoreLayout()` BEFORE `setSplit()` so a restored 4-up lays out once), `js/chrome.js`
(`open.title` = «title · project», so a rail dot has a name), `style.css` (`body.rail #sidebar`,
≈60 lines: hide text and tree, stack the segments, dots column, badge as a ring),
`strings.fa.js` (`sidebarCollapse`, `sidebarExpand`), `test_layout.py` (a rail pass at
1280x800: sidebar ≤ 56 px, every `.tab-dot` and the toggle have a box inside the window),
`test_reload.py` (+1: the rail survives a reload), `help.html`. Exit: 1052x711 split 4 with the
rail — each cell ≥ 490 px wide, measured; the toggle expands; a reload keeps the choice.

**Phase 4 — Polish, docs, acceptance.** Kebab right-anchoring (both editions, flagged in §1);
hover preview by eye; the emil Before/After table over every `transition` in `style.css`;
`wiki/editions.md` §E2 rewritten for the right sidebar; `wiki/grid.md` §"Web edition" gains the
terminal control; the terminal line in `EDITIONS` bumped to the next minor; the four acceptance
shots; and — when the BridgeMind screenshot arrives — a token-only retune. Exit: all eleven
gates green under `PCG_UI=terminal`; the web gates re-run only if `kebabMenu()` was touched.

## 8. Gates — what changes, and why none of it is a weaker gate

| Gate (`PCG_UI=terminal`) | Assertion that changes | Why the change is correct |
|---|---|---|
| `test_layout.py:482-487` | sidebar at the RIGHT edge (`side.x + side.w == clientW`), stage at `x == 0` | same measurement, other edge — the decision itself |
| `test_split.py:95` | `LOG_SHARE` 40 → 60 at both `LOG_SHARE_AT` sizes | tightened; 69 % measured after Phase 2 |
| `test_split.py:129,134` | the terminal edition gains the two split-control checks | more checks, not fewer |
| `test_layout.py` (Phase 3) | a new rail pass | additive |
| `test_reload.py` (Phase 3) | rail state survives a second page load | additive |

Unchanged and must stay green: `run_spec_test.py` (179; `#topbar-name` kept for its three
background-tab cases), `test_shell.py` (status-stack DOM order and classes untouched),
`test_column.py` (the `.comp-mark` SVG is re-read out of `index.html` — do not touch it),
`test_keys.py`, `test_dialogs.py` (the picker/perm dialogs stay inside `#stage` above the
prompt; no `id` inside the cell template), `test_strings.py` (every new key is read as `FA.*`;
`Alt` is already allow-listed), `test_tui_vocab.py`, `test_no_console.py`.

## 9. Risks / unknowns

- The BridgeMind screenshot may show a plain tree with no rail. The rail is still right for a
  tiling window (§1 arithmetic), but its default-on-split rule is the first thing to revisit.
- `body.rail` on a restored layout must be applied before `setSplit()` runs, or the four cells
  lay out twice on load (`restoreLayout()`, `app.js:667`).
- Translucent `--surface` is right on the ground and wrong on anything floating over content —
  hence `--bg-elev` for `.kebab-menu`, `#agent-drawer`, `#sess-card`, the popups.
- `wiki/editions.md` §E2 and `wiki/grid.md` describe the LEFT sidebar; both go stale at Phase 1
  and are rewritten in Phase 4 — say so in the Phase 1 commit so nobody "fixes" the flip back.
- Not built, on purpose: a per-cell close/park control (the sidebar row's ✕ and `/split` down
  cover it), drag-between-cells, a tab strip, BridgeMind's blue, a vendored mono face.
