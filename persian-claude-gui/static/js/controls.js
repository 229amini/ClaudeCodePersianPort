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

const ui = {
  menu: document.getElementById("menu-popup"),
  modelChip: document.getElementById("model-chip"),
  modelName: document.getElementById("model-chip-name"),
  postureChip: document.getElementById("posture-chip"),
  postureName: document.getElementById("posture-chip-name"),
  autoChip: document.getElementById("auto-chip"),
  effortChip: document.getElementById("effort-chip"),
  effortName: document.getElementById("effort-chip-name"),
};

/* The wrapper's three postures. The server maps each to a CLI permission mode
   plus its own auto-approve flag (server.py POSTURES) — the UI only names
   them, in plain Persian, so the user can tell what they are agreeing to. */
const POSTURES = [
  { key: "ask", title: FA.postureAsk, note: FA.postureAskNote },
  { key: "acceptEdits", title: FA.postureAcceptEdits, note: FA.postureAcceptEditsNote },
  { key: "autoApprove", title: FA.postureAutoApprove, note: FA.postureAutoApproveNote },
];

let models = [];
let chosen = null;     // the value we asked for, until a turn confirms it
let resolved = null;   // system/init.model — what the CLI actually ran
let posture = "ask";

/* --- model chip ------------------------------------------------------------ */

/* From `initialize`, on every spawn. */
export function applyInitInfo(info) {
  models = Array.isArray(info?.models) ? info.models : [];
  paintModel();
}

/* system/init reports the model the turn actually ran on. That is the only
   real confirmation available: `set_model` answers "success" with an empty
   body and would ack a model it never applied. So a confirmed turn drops our
   optimistic choice and the label falls back to the measured truth. */
export function setModelResolved(id) {
  if (!id) return;
  resolved = id;
  if (models.some((m) => m.resolvedModel === id)) chosen = null;
  paintModel();
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
      { subtype: "set_model", params: { model: item.key } });
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

/* Levels the CLI advertised and then refused. Learned rather than hardcoded:
   "max" is in every model's supportedEffortLevels on 2.1.223 and is not in the
   settings schema, but that is the CLI's bug to fix, and a hardcoded exclusion
   here would still be excluding it long after it starts working. The user meets
   the dead end once. */
const refused = new Set();

export function setEffortState(level) {
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
    const res = await api("/api/effort", { level: item.key });
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

/* --- approval pill --------------------------------------------------------- */

/* Driven ONLY by the server's `posture` event, which is published after the
   CLI acknowledged the permission mode. Never by our own click: a pill that
   moves on click while the engine refused the change is exactly the silent
   lie this project exists to avoid. */
export function setPostureState(name, autoCount) {
  if (name) posture = name;
  if (!ui.postureChip) return;
  const entry = POSTURES.find((p) => p.key === posture) ?? POSTURES[0];
  ui.postureChip.hidden = false;
  ui.postureName.textContent = entry.title;
  ui.postureChip.title = entry.note;
  ui.postureChip.dataset.posture = posture;
  setAutoCount(autoCount);
}

/* What was approved without asking, so the counter can be opened and read.
   Fed by permission_resolved events, which the SSE hub replays to a reloading
   window — so the list survives a refresh exactly as far as the count does. */
const autoActions = [];   // [{tool, why}]

export function noteAutoAction(toolName, why) {
  autoActions.push({ tool: toolName || "?", why });
}

/* Persian digits: this is prose chrome, not a technical value (spec rule 5). */
export function setAutoCount(count) {
  if (!ui.autoChip) return;
  const n = Number(count) || 0;
  ui.autoChip.hidden = n === 0;
  ui.autoChip.textContent = n.toLocaleString("fa-IR") + " " + FA.autoActions;
  ui.autoChip.title = FA.autoActionsTitle;
}

async function pickPosture(item) {
  closeMenu();
  try {
    const res = await api("/api/posture", { posture: item.key });
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
  const box = parent.getBoundingClientRect();
  const chip = anchor.getBoundingClientRect();
  const offset = box.right - chip.right;
  ui.menu.style.right = Math.max(0, Math.min(offset, box.width - 40)) + "px";
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
  positionMenu(anchor ?? document.getElementById(owner + "-chip"));
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

export function initControls() {
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

  // Click-anywhere and Escape close it — the popup is a menu, not a dialog.
  document.addEventListener("click", (e) => {
    if (!ui.menu.hidden && !ui.menu.contains(e.target)) closeMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });
}
