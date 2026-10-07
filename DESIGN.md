---
name: Claude Persian
description: A calm, dark, right-to-left workbench for the real Claude Code CLI.
colors:
  claude-orange: "#d97757"
  clay-fill: "#b5552f"
  clay-fill-hover: "#a14a28"
  clay-button: "#c6613f"
  ember-link: "#e8956f"
  ember-chip-text: "#f0a585"
  ember-selection: "#5c3324"
  ember-list-active: "#4a2a1d"
  amber-attention: "#e5a54b"
  editor-ground: "#181818"
  sidebar-ground: "#1f1f1f"
  input-ground: "#313131"
  code-ground: "#2b2b2b"
  hairline: "#2b2b2b"
  control-border: "#454545"
  text-primary: "#cccccc"
  text-secondary: "#9d9d9d"
  text-on-fill: "#ffffff"
  success-green: "#81b88b"
  deletion-red: "#ff7b72"
  error-red: "#f85149"
typography:
  body:
    fontFamily: "Vazirmatn, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.9
  ui:
    fontFamily: "Vazirmatn, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
  small:
    fontFamily: "Vazirmatn, Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
  title:
    fontFamily: "Vazirmatn, Segoe UI, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 700
  display:
    fontFamily: "Vazirmatn, Segoe UI, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 700
  mono:
    fontFamily: "Cascadia Code, Consolas, ui-monospace, monospace"
    fontSize: "13px"
  mono-small:
    fontFamily: "Cascadia Code, Consolas, ui-monospace, monospace"
    fontSize: "11px"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  full: "9999px"
spacing:
  hair: "2px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  gutter: "20px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.clay-fill}"
    textColor: "{colors.text-on-fill}"
    rounded: "{rounded.sm}"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.clay-fill-hover}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
    height: "28px"
  composer-send:
    backgroundColor: "{colors.clay-button}"
    textColor: "{colors.text-on-fill}"
    rounded: "{rounded.md}"
    size: "28px"
  bar-chip:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.sm}"
    height: "28px"
  input-composer:
    backgroundColor: "{colors.input-ground}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
  list-row-active:
    backgroundColor: "{colors.ember-list-active}"
    textColor: "{colors.text-on-fill}"
    rounded: "{rounded.sm}"
  chip-mention:
    textColor: "{colors.ember-chip-text}"
    rounded: "{rounded.sm}"
    height: "24px"
---

# Design System: Claude Persian

## Overview

**Creative North Star: "The Quiet Workbench"**

A tidy desk in a dim room. Everything has a place and stays in it; the surface is grey and still,
and the one warm colour on it — Claude orange — appears only where something needs the person: a
pending permission, the send button, the conversation they are in, a focused control. The
transcript is the work and gets the most light and the most air; the chrome around it is smaller,
quieter and denser, so the eye always lands on the conversation.

The window is a Persian, right-to-left reading of the Claude Code VS Code extension's webview. Its
surfaces, borders, list rows and composer are measured from that extension
(`wiki/vscode-webview-design.md`); what is this product's own is the orange accent instead of
VS Code blue, the Persian type, the one-step-more-open chrome, and the BiDi discipline that keeps
every mixed Persian/English line in order. Someone who knows Claude Code should recognise it at
once; nobody should mistake it for a generic chat app.

Rejected (user, 2026-10-07): a blue (VS Code) accent; a light theme; anything loud.

**Key Characteristics:**
- Dark only, flat tonal layers, hairline borders, almost no shadow.
- One accent, used sparingly: Claude orange.
- Every size comes from one scale; `persian-claude-gui/test_scale.py` fails on anything else.
- Persian body text is generous (14px, line height 1.9); chrome is 13px.
- Paths, code and numbers are always isolated LTR inside RTL text.

## Colors

A cool charcoal ground with a single warm ember accent; status colours are muted and appear only
as small marks.

### Primary
- **Claude Orange** (#d97757): the brand accent as a line or a mark — focus rings, the active input
  border, links in prose, the effort slider, the progress bar, an unread dot, the spinner. Never a
  large fill.
- **Clay Fill** (#b5552f): the accent as a fill under white text (4.9:1) — the primary answer in a
  permission dialog, a selected menu row. Hover darkens to Clay Fill Hover (#a14a28).
- **Clay Button** (#c6613f): the composer's send button, the extension's own clay.
- **Ember tints**: Ember Link (#e8956f) for links on dark ground, Ember Chip Text (#f0a585) on the
  translucent orange chip, Ember Selection (#5c3324) for selected text, Ember List Active
  (#4a2a1d) for the conversation you are in.

### Secondary
- **Amber Attention** (#e5a54b): "waiting for you" — a pending permission, a conversation that
  needs an answer, a warning. Distinct from the brand orange so attention never reads as
  decoration.

### Neutral
- **Editor Ground** (#181818): the transcript and the header.
- **Sidebar Ground** (#1f1f1f): the sidebar, tool cards, menus.
- **Input Ground** (#313131): the composer and text fields.
- **Code Ground** (#2b2b2b) and **Hairline** (#2b2b2b): code blocks; the 1px dividers between
  regions.
- **Control Border** (#454545): input, menu and widget outlines.
- **Text Primary** (#cccccc) for content and labels, **Text Secondary** (#9d9d9d) for meta, times
  and hints, **Text on Fill** (#ffffff) only on Clay Fill or Ember List Active.
- Status: **Success Green** (#81b88b, additions), **Deletion Red** (#ff7b72, removals — 5.2:1 on
  every surface it sits on), **Error Red** (#f85149).

### Named Rules
**The One Ember Rule.** Orange marks what needs the person or what they are acting on. If a screen
has orange on something that needs nothing, remove it.

**The No Blue Rule.** No blue accent anywhere — not for focus, links, selection, badges or the
"pending" state. Categorical chart colours in the usage panel are the only exception.

## Typography

**Body Font:** Vazirmatn (with Segoe UI, system-ui)
**Mono Font:** Cascadia Code (with Consolas, ui-monospace)

**Character:** Vazirmatn is a clean, open Persian sans that pairs with the Latin of Segoe UI;
Cascadia carries paths, code and numbers, isolated left-to-right inside the Persian line.

### Hierarchy
- **Display** (700, 20px): the home greeting, nothing else.
- **Title** (700, 16px): a dialog or page title, a message's `h1` (then `h2` 14px, `h3` 13px, all bold — a heading in a reply is a section label, not a page title). The app name in the sidebar is 14px so it fits on one line.
- **Body** (400, 14px, line height 1.9): every message, user and assistant. Measure stays inside
  the 680px column.
- **UI** (400–500, 13px): chrome — sidebar rows, menus, the composer bar, buttons, tool-card
  summaries.
- **Small** (400, 12px): meta — times, counts, hints, the status line. The floor for anything
  Persian.
- **Mono** (13px in messages and diffs; 12px in chrome paths) and **Mono Small** (11px): line
  numbers, `+N −M` counts, version strings.

### Named Rules
**The Twelve Floor Rule.** No Persian text below 12px; Vazirmatn is unreadable there. 11px is for
Latin digits and mono only.

**The Six Steps Rule.** Font sizes are 11, 12, 13, 14, 16, 20 — nothing else, and never
`em` that compounds. Weights are 400, 500 and 700 — the three vendored Vazirmatn files; 600 renders as 700.

## Layout

The window is a sidebar (projects, then conversations; collapsible to a 48px rail in the terminal
edition) and a grid of conversation panes (1, 2 or 4 in the web edition; 1–6 with dividers in the
terminal edition). Each pane is a header, the transcript and the composer. The transcript and the
composer share one centred column, at most 680px wide, with a 20px floor of side gutter — the
extension's own column.

Spacing comes from one scale: 2, 4, 8, 12, 16, 24, 32px, plus the 20px column gutter. Tight inside
a group (2–4px between a row's icon and label, 8px between rows of controls), generous between
groups (12–16px), widest around the transcript (16–24px). Anything above 32px is layout, not rhythm.
A one-line message reserves room under it for its hover actions, so nothing ever overlaps the next
message.

### Named Rules
**The Scale-or-Nothing Rule.** Padding, margin and gap are a scale step. 6, 10 and 14 are not
steps; if a value looks right only off-scale, the element around it is wrong.

## Elevation & Depth

Flat by default. Depth is tonal: the editor ground, the slightly lighter sidebar and card ground,
the lighter input ground, separated by 1px hairlines. Shadows appear only on things that float over
the transcript — menus, popovers, the agent drawer — and always with an offset and a soft blur.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 4px 12px rgb(0 0 0 / .4), 0 0 0 1px #454545`): menus and popovers.
- **Sheet** (`box-shadow: 0 8px 24px rgb(0 0 0 / .4)`): the composer's menus and panels.
- **Drawer** (`box-shadow: 0 18px 50px rgb(0 0 0 / .5)`): the agent drawer and large dialogs.

### Named Rules
**The Flat-at-Rest Rule.** Nothing in the transcript casts a shadow.

## Shapes

Small, consistent corners: 4px for controls, chips, list rows and inline code; 6px for the send
button, cards inside cards and the pane header's inner corner; 8px for panels, the composer, tool
cards, the change card and the user's message bubble; fully round only for pills (the model
chip) and dots. Borders are 1px.

## Components

### Buttons
Quiet, rectangular, and sized from three heights.
- **Shape:** 4px corners.
- **Heights:** 24px for an inline chip or a small text button in a row; 28px for working controls
  (the composer bar's chips, send/stop, menu rows, panel buttons); 32px for a decision (a
  permission answer, the layout panel).
- **Primary:** Clay Fill under white, bold label (the default answer of a permission request).
- **Secondary / Ghost:** transparent with a hairline border or none; hover fills with the
  list-hover grey (#2a2d2e).
- **Focus:** a 1–2px Claude Orange outline, offset 1px.

### Chips
- **Composer bar chips** (model, effort, mode, context ring): 28px, transparent, secondary text;
  hover fills grey. The model chip is a 10% white pill.
- **Mention / running-tasks chip:** translucent orange (#d9775733) with Ember Chip Text.
- **Count badges:** grey (#616161) pill, 12px digits.

### Cards / Containers
- **Tool card:** Sidebar Ground, 1px hairline, 8px corners; summary row 13px, body mono.
- **Change card:** one per settled turn, `+A −D` per file measured left to right.
- **Internal padding:** 8px rows, 12px sides.

### Inputs / Fields
- **Composer:** Input Ground, 1px Control Border, 8px corners; the bar under it holds the chips.
  Focus: the border turns Claude Orange.
- **Search:** same ground, 4px corners, 28px.

### Navigation
- **Sidebar rows:** 13px, 4px 8px padding, 4px corners; hover #2a2d2e; the current conversation
  Ember List Active with white text. Row actions (+, ⋮, ×) are 24px and appear on hover.

### Message action strip
Under every message: time, copy, pin, fork — 14px icons in 22px hit areas, secondary text; drawn
under a turn's last answer, on hover elsewhere, in reserved space.

## Do's and Don'ts

### Do:
- **Do** take every size from the scale: spacing 2/4/8/12/16/24/32 (+20 gutter), type
  11/12/13/14/16/20, corners 4/6/8/full, controls 24/28/32, icons 14/16.
- **Do** run `test_scale.py`, `audit_ui.py` and the layout gates in both editions before calling a
  visual change done.
- **Do** give every path, command, number and code span its own LTR isolate (spec rules 1–7).
- **Do** keep `tokens.css` byte-identical in both editions.

### Don't:
- **Don't** use a blue accent, a light theme, or a gradient.
- **Don't** set Persian text below 12px or use `em` font sizes that compound.
- **Don't** let a hover element cover content; reserve its room.
- **Don't** put orange on anything that does not need the person.
- **Don't** add a shadow to anything inside the transcript.
