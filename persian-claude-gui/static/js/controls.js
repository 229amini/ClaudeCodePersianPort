/* ============================================================================
   The two live CLI controls in the composer row: the model picker and the
   approval pill (plus the auto-approval audit counter).

   CAPABILITY MIRROR. Nothing here is hardcoded about the CLI. The model list,
   its display names, descriptions and effort support all arrive in the
   `initialize` reply (wiki/control-protocol.md §1) and are account- and
   plan-specific — a hardcoded list would ship a wrong picker to every user on
   a different plan. If `initialize` says nothing, the chip stays hidden.

   A LEAF-ish module: imports api.js only. render.js drives it; keeping the
   arrow one-way avoids a third import cycle.
   ========================================================================= */
"use strict";

import { api } from "./api.js";

const FA = window.STRINGS;

/* Levels the CLI advertised and then refused. Learned rather than hardcoded:
   "max" is in every model's supportedEffortLevels on 2.1.223 and is not in the
   settings schema, but that is the CLI's bug to fix, and a hardcoded exclusion
   here would still be excluding it long after it starts working. The user meets
   the dead end once. MODULE level on purpose, and the one thing here that is:
   a level the CLI's own settings schema rejects is a fact about the build, not
   about a conversation, so every cell learns it once. */
const refused = new Set();

/* The wrapper's three postures. The server maps each to a CLI permission mode
   plus its own auto-approve flag (server.py POSTURES) — the UI only names
   them, in plain Persian, so the user can tell what they are agreeing to.
   Module level: it is a label table, not conversation state. */
/* The popup's own geometry, in one place because positionMenu() reads all three
   and `.menu-popup`'s CSS carries the first: the gap it is anchored above the
   prompt with, the breathing room it keeps at the column's edge, and the
   shortest list still worth opening (about three rows). */
const MENU_GAP = 8;
const MENU_EDGE = 8;
const MENU_MIN = 140;

const POSTURES = [
  { key: "plan", title: FA.posturePlan, note: FA.posturePlanNote },
  { key: "ask", title: FA.postureAsk, note: FA.postureAskNote },
  { key: "acceptEdits", title: FA.postureAcceptEdits, note: FA.postureAcceptEditsNote },
  { key: "autoApprove", title: FA.postureAutoApprove, note: FA.postureAutoApproveNote },
];

/* --- one control set per cell ----------------------------------------------

   Every value below belongs to ONE conversation — the model it runs on, its
   effort, its output style, its posture and what that posture approved without
   asking. As module state that was already the project's oldest defect family
   («state that belongs to one session surviving into the next»), held off only
   by the snapshot/restore pair below. With a second cell on screen the pair
   cannot help: two conversations are visible at once. So each cell gets its own,
   looked up inside its own `root` (MA4-T1); snapshot/restore stay, because a
   BACKGROUND tab still has no cell to live in.

   `cell` is read at CALL time, never cached: `cell.tab` changes under this
   closure every time the view is switched, and every session-scoped POST below
   has to carry the CURRENT one.

   spec-test.html passes `root = document.body`: the harness IS the cell. */
export function makeControls(root, cell) {

  // Cell-local elements (MA4-T0): `id` -> `class` inside the cell's own root
  // (and in spec-test.html's stub, which keeps its ids too).
  const $ = (cls) => root.querySelector("." + cls);

  const ui = {
    menu: $("menu-popup"),
    modelChip: $("model-chip"),
    modelName: $("model-chip-name"),
    postureChip: $("posture-chip"),
    postureName: $("posture-chip-name"),
    autoChip: $("auto-chip"),
    effortChip: $("effort-chip"),
    effortName: $("effort-chip-name"),
    styleChip: $("style-chip"),
    styleName: $("style-chip-name"),
  };

  let models = [];
  let chosen = null;     // the value we asked for, until a turn confirms it
  let resolved = null;   // system/init.model — what the CLI actually ran
  /* null until the server's posture event names one, which is also what keeps the
     pill hidden on a conversation that has not answered yet. It used to default
     to "ask" and rely on the chip's `hidden` attribute for that, which no longer
     works: with concurrent tabs the chip is restored per conversation, and a
     default would show a posture that nothing had confirmed. */
  let posture = null;

  /* --- model chip ------------------------------------------------------------ */

  /* From `initialize`, on every spawn. */
  function applyInitInfo(info) {
    models = Array.isArray(info?.models) ? info.models : [];
    styles = Array.isArray(info?.available_output_styles) ? info.available_output_styles : [];
    if (typeof info?.output_style === "string") style = info.output_style;
    paintModel();
    paintStyle();
  }

  /* system/init reports the model the turn actually ran on. That is the only
     real confirmation available: `set_model` answers "success" with an empty
     body and would ack a model it never applied. So a confirmed turn drops our
     optimistic choice and the label falls back to the measured truth. */
  function setModelResolved(id) {
    if (!id) return;
    resolved = id;
    if (models.some((m) => m.resolvedModel === id)) chosen = null;
    paintModel();
  }

  /* A new session inherits no picker state. `chosen` is an optimistic value
     waiting for a turn that will never come now, and `resolved` describes a
     process that no longer exists — both survived a restart and pinned the chips
     to the previous session's model. The worst shape of that: picking Haiku in
     one session hid the effort chip in every session after it, because Haiku is
     the one model that does not advertise supportsEffort. The new process
     re-announces both within a few hundred ms.

     `effort` is deliberately NOT cleared: it lives in the settings overlay, not
     in the session, and survives the restart in the CLI too. */
  function resetControls() {
    chosen = null;
    resolved = null;
    // A style picked here lives in the settings overlay `apply_flag_settings`
    // creates, and that overlay dies with the process — so the new session is
    // back to whatever the machine's own settings say, and the init_info landing
    // a moment from now names it. `effort` is deliberately NOT cleared for the
    // same reason read the other way: its chip reads the merged value, which the
    // CLI recomputes identically on the next spawn.
    style = null;
    paintModel();
    paintStyle();
  }

  function modelEntry() {
    return models.find((m) => m.value === chosen)
        ?? models.find((m) => m.resolvedModel === resolved)
        ?? models[0] ?? null;
  }

  function paintModel() {
    if (!ui.modelChip) return;
    ui.modelChip.hidden = !models.length;
    const entry = modelEntry();
    ui.modelName.textContent = entry?.displayName ?? resolved ?? FA.modelDefault;
    ui.modelChip.title = entry?.description ?? "";
    // The effort chip belongs to the model: switching to Haiku must retire it.
    paintEffort();
  }

  async function pickModel(item) {
    closeMenu();
    const previous = chosen;
    chosen = item.key;
    paintModel();
    try {
      const res = await api("/api/control",
        { subtype: "set_model", params: { model: item.key }, tab: cell.tab });
      if (!res.ok) throw new Error(res.error || "set_model refused");
    } catch (err) {
      chosen = previous;
      paintModel();
      console.error("set_model failed", err);
      openMenu("model", [{ title: FA.modelFailed }]);
    }
  }

  /* --- reasoning effort ------------------------------------------------------

     Mirrored like the model list: the levels come from the CURRENT model's
     `supportedEffortLevels`, and a model that does not advertise `supportsEffort`
     (Haiku) hides the chip entirely.

     The write path is the one that needed measuring. There is no set_effort
     control subtype; the only route is apply_flag_settings, and its ack is an
     empty object that reports success for a level the CLI then ignores. So the
     server applies and reads back, and this repaints from what came back rather
     than from what was asked for. The two lists genuinely disagree — models
     advertise "max", the settings schema does not accept it — so the refusal
     path here is a real path, not defensive padding. */

  let effort = null;

  function setEffortState(level) {
    if (level) effort = level;
    paintEffort();
  }

  function effortLevels() {
    const entry = modelEntry();
    const levels = entry?.supportsEffort && Array.isArray(entry.supportedEffortLevels)
      ? entry.supportedEffortLevels : [];
    return levels.filter((level) => !refused.has(level));
  }

  function effortLabel(level) {
    return FA.effortLevels?.[level] ?? level;
  }

  function paintEffort() {
    if (!ui.effortChip) return;
    const levels = effortLevels();
    ui.effortChip.hidden = !levels.length || !effort;
    if (ui.effortChip.hidden) return;
    ui.effortName.textContent = effortLabel(effort);
    ui.effortChip.title = FA.effortTitle;
  }

  async function pickEffort(item) {
    closeMenu();
    try {
      const res = await api("/api/effort", { level: item.key, tab: cell.tab });
      // `effort` is what is really in force. A refused level comes back as the
      // PREVIOUS one with ok:false — repaint to the truth and say so, rather
      // than leaving a chip that claims a setting the CLI dropped.
      if (res.effort) setEffortState(res.effort);
      if (!res.ok) {
        refused.add(item.key);
        openMenu("effort", [{ title: FA.effortRefused }]);
      }
    } catch (err) {
      console.error("set effort failed", err);
      openMenu("effort", [{ title: FA.effortRefused }]);
    }
  }

  /* --- output style ----------------------------------------------------------

     Mirrored like everything else here: the set arrives as
     `initialize.available_output_styles` and the current one as `output_style`.
     A machine can add its own style file, so the list is never enumerated in
     strings.fa.js — a name with no Persian label falls back to itself.

     Unlike effort there is no refusal path, because there is nothing to refuse:
     apply_flag_settings has no schema behind `outputStyle` and echoes any string
     straight back through both read-backs (measured 2026-08-08). The server
     rejects a name the CLI never offered; this only ever sends one of those, so
     a failure here is a transport failure. */

  let styles = [];
  let style = null;

  function setOutputStyle(name) {
    if (name) style = name;
    paintStyle();
  }

  function paintStyle() {
    if (!ui.styleChip) return;
    // One entry is not a choice — and every build has at least "default".
    ui.styleChip.hidden = styles.length < 2 || !style;
    if (ui.styleChip.hidden) return;
    ui.styleName.textContent = FA.styleNames?.[style] ?? style;
    ui.styleChip.title = FA.styleTitle;
  }

  async function pickStyle(item) {
    closeMenu();
    try {
      const res = await api("/api/output-style", { style: item.key, tab: cell.tab });
      // What is in force, read back out of get_settings — never the ack, which
      // is an empty object for a style the CLI may have dropped.
      if (res.style) setOutputStyle(res.style);
      if (!res.ok) throw new Error(res.error || "output style refused");
    } catch (err) {
      console.error("set output style failed", err);
      openMenu("style", [{ title: FA.styleFailed }]);
    }
  }

  /* --- approval pill --------------------------------------------------------- */

  /* Driven ONLY by the server's `posture` event, which is published after the
     CLI acknowledged the permission mode. Never by our own click: a pill that
     moves on click while the engine refused the change is exactly the silent
     lie this project exists to avoid. */
  function setPostureState(name, count) {
    if (name) posture = name;
    paintPosture();
    setAutoCount(count);
  }

  function paintPosture() {
    if (!ui.postureChip) return;
    ui.postureChip.hidden = !posture;
    if (!posture) return;
    const entry = POSTURES.find((p) => p.key === posture) ?? POSTURES[0];
    ui.postureName.textContent = entry.title;
    ui.postureChip.title = entry.note;
    ui.postureChip.dataset.posture = posture;
  }

  /* What was approved without asking, so the counter can be opened and read.
     Fed by permission_resolved events, which the SSE hub replays to a reloading
     window — so the list survives a refresh exactly as far as the count does. */
  const autoActions = [];   // [{tool, why}]
  let autoCount = 0;

  function noteAutoAction(toolName, why) {
    autoActions.push({ tool: toolName || "?", why });
  }

  /* Persian digits: this is prose chrome, not a technical value (spec rule 5). */
  function setAutoCount(count) {
    autoCount = Number(count) || 0;
    if (!ui.autoChip) return;
    ui.autoChip.hidden = autoCount === 0;
    ui.autoChip.textContent = autoCount.toLocaleString("fa-IR") + " " + FA.autoActions;
    ui.autoChip.title = FA.autoActionsTitle;
  }

  /* --- one window, N conversations -------------------------------------------

     Every value in this module belongs to ONE session: the model it runs on, the
     effort it was given, its output style, its permission posture and what that
     posture approved without asking. The chips are single elements, so switching
     tabs has to carry all of it across at once — a partial restore is the
     project's oldest defect family («state that belongs to one session surviving
     into the next»), and here it would mean approving in one conversation under a
     pill describing another.

     `refused` is deliberately NOT in the snapshot: an effort level the CLI's own
     settings schema rejects is a fact about the build, not about a session. */
  function snapshot() {
    return { models, chosen, resolved, styles, style, effort, posture, autoCount,
             autoActions: autoActions.slice() };
  }

  /* A tab that has never been looked at has no snapshot — hence the defaults on
     every field rather than "keep what is there". */
  function restore(saved) {
    const s = saved ?? {};
    models = s.models ?? [];
    chosen = s.chosen ?? null;
    resolved = s.resolved ?? null;
    styles = s.styles ?? [];
    style = s.style ?? null;
    effort = s.effort ?? null;
    posture = s.posture ?? null;
    autoActions.length = 0;
    if (s.autoActions) autoActions.push(...s.autoActions);
    paintModel();   // paints the effort chip too
    paintStyle();
    paintPosture();
    setAutoCount(s.autoCount ?? 0);
  }

  /* Shift+Tab in the composer, the way the TUI cycles it (composer.js binds the
     key; this owns the order). Deliberately NOT a second implementation: it picks
     the next entry of the SAME list the pill's menu is built from and hands it to
     the SAME pickPosture(), so both of the pill's load-bearing properties are
     inherited by construction — the chip still moves only when the server's
     `wrapper/posture` event arrives, and `plan` still exits on its own when the
     engine leaves it (wiki/approval-postures.md).

     No posture confirmed yet means the conversation has not answered; there is
     nothing to cycle FROM, and starting at POSTURES[0] would be this window
     asserting a permission level nothing has agreed to. The boolean says whether
     the key did anything, so the caller can decide whether to swallow it. */
  function cyclePosture() {
    if (!posture) return false;
    const at = POSTURES.findIndex((p) => p.key === posture);
    pickPosture(POSTURES[(at + 1) % POSTURES.length]);
    return true;
  }

  async function pickPosture(item) {
    closeMenu();
    try {
      const res = await api("/api/posture", { posture: item.key, tab: cell.tab });
      if (!res.ok) throw new Error(res.error || "posture refused");
      // Deliberately no repaint here — see setPostureState().
    } catch (err) {
      console.error("posture change failed", err);
      openMenu("posture", [{ title: FA.postureFailed }]);
    }
  }

  /* --- the shared popup ------------------------------------------------------ */

  /* The popup is pinned to the composer's start edge in CSS, which was fine while
     two chips shared it and merely odd with three: every picker opened in the
     same place, nowhere near the chip that was pressed. Line its start edge up
     with the chip's instead. Physical `right` on purpose — the CSS `inset`
     shorthand it overrides is physical too, and the shell is dir="rtl". */
  function positionMenu(anchor) {
    const parent = ui.menu.offsetParent;
    if (!anchor || !parent) return;
    // Measure at the CSS anchor: the popup is shrink-to-fit, so whatever `right`
    // and `bottom` the last open left behind are part of what is read below.
    ui.menu.style.right = "";
    ui.menu.style.bottom = "";
    const box = parent.getBoundingClientRect();
    const chip = anchor.getBoundingClientRect();
    /* THE CELL, not the window (MA4-T1). `.comp-box` is still the offsetParent
       — it is `position: relative` and the popup is absolute inside it — but
       the ROOM the popup has is the cell's, and `.cell` is `position: relative`
       so that box is a real containing block rather than the viewport. With one
       cell the two are the same rectangle; with four, a bottom-row menu sized
       against the window would open straight through the column above it. */
    const bounds = (root instanceof Element ? root : document.body)
      .getBoundingClientRect();

    /* It opens UPWARD (CSS inset-block-end), and 46vh of room is not the same as
       46vh of cell: in the home state the composer sits mid-column, so a full
       menu was clipped by the TOP rather than scrolled — measured at 1280x800,
       the first posture row sat at y = -64, off screen.

       The 140px FLOOR under that cap is the same defect one size down, and a
       4-way split is where it shows: a quarter of a 1000x700 window leaves ~92px
       above the prompt, the floor asked for 140, and the menu drew 48px through
       the top of its own column onto the one above it (MA4-T2, measured). A
       floor is still right — a 40px menu is not a menu — so what gives instead
       is the ANCHOR: whatever the cap cannot buy above the prompt, the popup
       takes back by sliding down OVER the prompt, which keeps every row of it
       inside the column it belongs to. */
    const roomAbove = box.top - bounds.top - MENU_GAP - MENU_EDGE;
    const roomCell = bounds.height - 2 * MENU_EDGE;
    ui.menu.style.maxHeight =
      Math.max(0, Math.min(roomCell, Math.max(MENU_MIN, roomAbove))) + "px";
    const over = Math.round(ui.menu.offsetHeight - roomAbove);
    if (over > 0) ui.menu.style.bottom = `calc(100% + ${MENU_GAP - over}px)`;

    // Shrink-to-fit again: the width left for the popup is the distance from its
    // start edge to the box, so an offset larger than the slack does not move the
    // menu, it squeezes it into a column. The posture chip is the last one on the
    // row, which is why THAT menu was the one that came back 201px wide in a
    // 760px window and wrapped its notes to three words a line. Capped by the
    // CELL's width too, so a `right` bigger than the column's own slack can
    // never be written.
    const room = Math.min(box.width, bounds.width);
    const slack = Math.max(0, room - ui.menu.offsetWidth);
    const offset = box.right - chip.right;
    ui.menu.style.right = Math.min(Math.max(0, offset), slack) + "px";
  }

  function openMenu(owner, items, onPick, anchor) {
    if (!ui.menu) return;
    ui.menu.replaceChildren();
    for (const item of items) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "menu-row";
      if (onPick) {
        row.setAttribute("role", "menuitemradio");
        row.setAttribute("aria-checked", String(!!item.selected));
        row.addEventListener("click", () => onPick(item));
      }
      const title = document.createElement("span");
      title.className = "menu-title";
      title.setAttribute("dir", "auto");   // model names are Latin, postures Persian
      title.textContent = item.title;
      row.append(title);
      if (item.note) {
        const note = document.createElement("span");
        note.className = "menu-note";
        note.setAttribute("dir", "auto");
        note.textContent = item.note;
        row.append(note);
      }
      ui.menu.append(row);
    }
    ui.menu.dataset.owner = owner;
    ui.menu.hidden = false;
    positionMenu(anchor ?? $(owner + "-chip"));
  }

  function closeMenu() {
    if (ui.menu) ui.menu.hidden = true;
  }

  function toggleMenu(owner, items, onPick, anchor) {
    if (!ui.menu.hidden && ui.menu.dataset.owner === owner) {
      closeMenu();
      return;
    }
    openMenu(owner, items, onPick, anchor);
  }

  /* --- init ------------------------------------------------------------------ */

  function initControls() {
    if (!ui.menu) return;   // spec-test.html carries no composer chrome

    ui.modelChip.addEventListener("click", (e) => {
      e.stopPropagation();
      const current = modelEntry();
      toggleMenu("model", models.map((m) => ({
        key: m.value,
        title: m.displayName || m.value,
        note: m.description || "",
        selected: m === current,
      })), pickModel);
    });

    ui.effortChip.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleMenu("effort", effortLevels().map((level) => ({
        key: level,
        title: effortLabel(level),
        selected: level === effort,
      })), pickEffort);
    });

    ui.styleChip.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleMenu("style", styles.map((name) => ({
        key: name,
        title: FA.styleNames?.[name] ?? name,
        selected: name === style,
      })), pickStyle);
    });

    ui.postureChip.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleMenu("posture", POSTURES.map((p) => ({
        key: p.key, title: p.title, note: p.note, selected: p.key === posture,
      })), pickPosture);
    });

    /* The count alone is a number with nothing behind it. Opening it is the
       audit trail that makes «خودکار» — and a remembered tool — defensible.
       No endpoint: the events that produced the count carry the tool name. */
    ui.autoChip.addEventListener("click", (e) => {
      e.stopPropagation();
      const rows = autoActions.length
        ? autoActions.map((a) => ({
            title: a.tool,
            note: a.why === "remembered" ? FA.autoWhyRemembered : FA.autoWhyPosture,
          }))
        : [{ title: FA.autoActionsEmpty }];
      toggleMenu("auto", rows);
    });

    /* Click-anywhere and Escape close it — the popup is a menu, not a dialog.
       On the DOCUMENT, one registration per cell, and that is right rather than
       sloppy: each closes only its OWN menu, so a click in one column dismisses
       the picker hanging open in the next one too. */
    document.addEventListener("click", (e) => {
      if (!ui.menu.hidden && !ui.menu.contains(e.target)) closeMenu();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeMenu();
    });
  }

  initControls();

  /* The verbs the rest of the window used to import by name. */
  return {
    applyInitInfo, setModelResolved, resetControls,
    setPostureState, setEffortState, setOutputStyle,
    setAutoCount, noteAutoAction,
    snapshot, restore, cyclePosture, closeMenu,
  };
}
