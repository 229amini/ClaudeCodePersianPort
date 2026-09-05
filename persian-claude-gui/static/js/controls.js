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
/* A leaf, like api.js: the numbered list every v2.4 dialog is made of. Sharing
   it with chrome.js costs no import edge in either direction. */
import { optionList, dialogHint } from "./choice.js";

const FA = window.STRINGS;

const ui = {
  /* v2.4: one inline dialog, in the flow above the prompt, for every picker —
     `/model`, `/effort`, `/output-style`, `/permissions` and the audit list.
     The composer chips it replaced are gone (V2-PLAN §2); the state below did
     not move, and v2.5's status line reads the same fields.

     The chip ids are still looked up because spec-test.html keeps a stub for
     them: three of its assertions prove a background tab's model never leaks
     into the visible one, and they read the label this module writes. Every
     paint below is element-optional, so index.html simply has nothing to
     paint. */
  picker: document.getElementById("picker"),
  pickerTitle: document.getElementById("picker-title"),
  pickerBody: document.getElementById("picker-body"),
  modelChip: document.getElementById("model-chip"),
  modelName: document.getElementById("model-chip-name"),
  postureChip: document.getElementById("posture-chip"),
  postureName: document.getElementById("posture-chip-name"),
  autoChip: document.getElementById("auto-chip"),
  effortChip: document.getElementById("effort-chip"),
  effortName: document.getElementById("effort-chip-name"),
  styleChip: document.getElementById("style-chip"),
  styleName: document.getElementById("style-chip-name"),
};

/* The wrapper's three postures. The server maps each to a CLI permission mode
   plus its own auto-approve flag (server.py POSTURES) — the UI only names
   them, in plain Persian, so the user can tell what they are agreeing to. */
const POSTURES = [
  { key: "plan", title: FA.posturePlan, note: FA.posturePlanNote },
  { key: "ask", title: FA.postureAsk, note: FA.postureAskNote },
  { key: "acceptEdits", title: FA.postureAcceptEdits, note: FA.postureAcceptEditsNote },
  { key: "autoApprove", title: FA.postureAutoApprove, note: FA.postureAutoApproveNote },
];

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
export function applyInitInfo(info) {
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
export function setModelResolved(id) {
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
export function resetControls() {
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
    reportPicker("model", FA.modelTitle, FA.modelFailed);
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
  try {
    const res = await api("/api/effort", { level: item.key });
    // `effort` is what is really in force. A refused level comes back as the
    // PREVIOUS one with ok:false — repaint to the truth and say so, rather
    // than leaving a chip that claims a setting the CLI dropped.
    if (res.effort) setEffortState(res.effort);
    if (!res.ok) {
      refused.add(item.key);
      reportPicker("effort", FA.effortTitle, FA.effortRefused);
    }
  } catch (err) {
    console.error("set effort failed", err);
    reportPicker("effort", FA.effortTitle, FA.effortRefused);
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

export function setOutputStyle(name) {
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
  try {
    const res = await api("/api/output-style", { style: item.key });
    // What is in force, read back out of get_settings — never the ack, which
    // is an empty object for a style the CLI may have dropped.
    if (res.style) setOutputStyle(res.style);
    if (!res.ok) throw new Error(res.error || "output style refused");
  } catch (err) {
    console.error("set output style failed", err);
    reportPicker("style", FA.styleTitle, FA.styleFailed);
  }
}

/* --- approval pill --------------------------------------------------------- */

/* Driven ONLY by the server's `posture` event, which is published after the
   CLI acknowledged the permission mode. Never by our own click: a pill that
   moves on click while the engine refused the change is exactly the silent
   lie this project exists to avoid. */
export function setPostureState(name, count) {
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

export function noteAutoAction(toolName, why) {
  autoActions.push({ tool: toolName || "?", why });
}

/* Persian digits: this is prose chrome, not a technical value (spec rule 5). */
export function setAutoCount(count) {
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
export function snapshotControls() {
  return { models, chosen, resolved, styles, style, effort, posture, autoCount,
           autoActions: autoActions.slice() };
}

/* A tab that has never been looked at has no snapshot — hence the defaults on
   every field rather than "keep what is there". */
export function restoreControls(saved) {
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
export function cyclePosture() {
  if (!posture) return false;
  const at = POSTURES.findIndex((p) => p.key === posture);
  pickPosture(POSTURES[(at + 1) % POSTURES.length]);
  return true;
}

async function pickPosture(item) {
  try {
    const res = await api("/api/posture", { posture: item.key });
    if (!res.ok) throw new Error(res.error || "posture refused");
    // Deliberately no repaint here — see setPostureState().
  } catch (err) {
    console.error("posture change failed", err);
    reportPicker("posture", FA.postureTitle, FA.postureFailed);
  }
}

/* --- the inline picker ------------------------------------------------------

   V2-PLAN §3.3 renders every picker as the same numbered list the permission
   dialog uses, in the flow above the prompt rather than as a popup hanging off
   a chip. Three whole classes of defect leave with the popup: it had to be
   positioned by hand against a shrink-to-fit box (the 2026-08-23 "the picker
   menu was sizing itself" report), it opened upward into whatever room the
   home state left it, and it was reachable only by clicking a chip. A row in
   the flow is laid out by the browser and answered by a digit. */

let pickerOwner = "";

export function pickerOpen() {
  return !!ui.picker?.open;
}

export function closePicker() {
  if (ui.picker?.open) ui.picker.close();
  pickerOwner = "";
}

/* Returns false when there is nothing to pick -- the caller uses that to decide
   whether the key was ours at all, the way Alt+P and Shift+Tab both do. */
function openPicker(owner, title, rows, onPick) {
  if (!ui.picker || !ui.pickerBody) return false;
  if (!rows.length) return false;
  if (pickerOwner === owner && ui.picker.open) {   // the same key shuts it again
    closePicker();
    return true;
  }
  const list = optionList(rows, {
    onPick: (key) => { closePicker(); onPick?.(rows.find((r) => r.key === key)); },
    onCancel: closePicker,
  });
  if (ui.pickerTitle) ui.pickerTitle.textContent = title;
  ui.pickerBody.replaceChildren(list.el, dialogHint(FA.pickerHint));
  pickerOwner = owner;
  if (!ui.picker.open) ui.picker.show();
  list.focus();
  return true;
}

/* A picker with nothing to say still has to say it -- a key that silently does
   nothing reads as a broken window. This is the same list with one dead row,
   which is what the popup did too. */
function reportPicker(owner, title, text) {
  openPicker(owner + "-failed", title, [{ key: "", title: text }], null);
}

export function openModelPicker() {
  const current = modelEntry();
  return openPicker("model", FA.modelTitle, models.map((m) => ({
    key: m.value,
    title: m.displayName || m.value,
    note: m.description || "",
    selected: m === current,
  })), pickModel);
}

export function openEffortPicker() {
  return openPicker("effort", FA.effortTitle, effortLevels().map((level) => ({
    key: level, title: effortLabel(level), selected: level === effort,
  })), pickEffort);
}

export function openStylePicker() {
  return openPicker("style", FA.styleTitle, styles.map((name) => ({
    key: name, title: FA.styleNames?.[name] ?? name, selected: name === style,
  })), pickStyle);
}

/* The posture list. Shift+Tab still CYCLES -- that is the TUI's key and it does
   not open anything -- but `/permissions` needs a place to choose from, and
   until v2.5 gives the plan's open-the-real-file route a home this is the only
   surface that names the four levels and what each one allows. */
export function openPosturePicker() {
  return openPicker("posture", FA.postureTitle, POSTURES.map((p) => ({
    key: p.key, title: p.title, note: p.note, selected: p.key === posture,
  })), pickPosture);
}

/* The count alone is a number with nothing behind it. Opening it is the audit
   trail that makes the auto posture -- and a remembered tool -- defensible. No
   endpoint: the events that produced the count carry the tool name. */
export function openAuditList() {
  const rows = autoActions.length
    ? autoActions.map((a) => ({
        key: "", title: a.tool,
        note: a.why === "remembered" ? FA.autoWhyRemembered : FA.autoWhyPosture,
      }))
    : [{ key: "", title: FA.autoActionsEmpty }];
  return openPicker("auto", FA.autoActionsTitle, rows, null);
}

/* --- init ------------------------------------------------------------------ */

export function initControls() {
  if (!ui.picker) return;   // spec-test.html carries no composer chrome

  ui.autoChip?.addEventListener("click", (e) => {
    e.stopPropagation();
    openAuditList();
  });

  /* Escape inside the dialog closes it. Bound here rather than on the document
     so it cannot reach the composer's interrupt handler, which checks
     defaultPrevented -- the picker is dismissible and owns Esc first. The list
     itself already claims Esc; this is the belt for focus sitting on the
     dialog rather than in it. */
  ui.picker.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault();
    closePicker();
  });
}
