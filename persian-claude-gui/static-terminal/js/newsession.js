/* ============================================================================
   The new-session page.

   "Four at once" in one action: which folder, how many conversations, sharing
   the folder or each in a git worktree of its own, an optional task sent to
   every one of them, and a preview of exactly what will launch. It replaces
   the «۱ | ۲ | ۴» control as the way into more than one pane.

   The folder and isolation fields set EVERY conversation at once; with more
   than one, each preview row has its own folder and its own «شاخهٔ جدا», so
   one launch can put a builder in each of two repos. `model.slots`
   is the truth that launches; the two fields only write into it.

   Imports only the two leaf modules. Everything it needs from the grid comes
   through the bridge app.js hands in (`initNewSession`) - app.js is the entry
   module and nothing may import it.

   Every request here is one the window already makes elsewhere: open a
   project, close a tab, set a posture, send a message. No new route.
   ========================================================================= */

import { api } from "./api.js";
import { pathEl } from "./bidi.js";

const MAX_PANES = 6;          // = server.py MAX_TABS

/* Our presets, not BridgeMind's. «جفت» is the one with an idea in it: a
   builder and a reviewer in the SAME folder (the reviewer has to see the
   builder's files), the reviewer in plan mode - the CLI itself then refuses
   its edits - with a brief saying what it is for. */
const PRESETS = {
  solo:  { count: 1, iso: "shared", roles: ["builder"] },
  pair:  { count: 2, iso: "shared", roles: ["builder", "reviewer"], lockShared: true },
  group: { count: 4, iso: "worktree", roles: ["builder", "builder", "builder", "builder"] },
};

let bridge = null;
let root = null;
let ui = null;
let model = null;             // the form's state
let target = null;            // an empty pane asked for exactly one, here
let launching = false;
let openNow = 0;              // conversations open when the page opened

export function initNewSession(b) {
  bridge = b;
  root = document.getElementById("new-session");
  if (!root) return;          // spec-test.html has no page
  build();
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeNewSession();
    } else if (e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();
      launch();
    }
  });
}

export function newSessionOpen() {
  return !!root && !root.hidden;
}

/* `opts.target`: the empty pane whose button asked - one conversation, there. */
export async function openNewSession(opts = {}) {
  if (!root) return false;
  target = opts.target ?? null;
  // The server's own count of open conversations, asked now: the window's
  // copy is refreshed on a debounce and can be a launch behind.
  const [listed, open] = await Promise.all([
    api("/api/projects").catch(() => null),
    api("/api/tabs").catch(() => null),
  ]);
  let projects = listed?.projects ?? [];
  openNow = Array.isArray(open?.tabs) ? open.tabs.length : bridge.openCount();
  projects = projects.filter((p) => !p.archived);
  const cwd = bridge.currentCwd() || projects[0]?.path || "";
  if (cwd && !projects.some((p) => p.path.toLowerCase() === cwd.toLowerCase())) {
    projects.unshift({ path: cwd, git: false });
  }
  model = { preset: "solo", projects, path: cwd,
            count: 1, iso: "shared", slots: [], task: "", error: "" };
  applyPreset("solo");
  ui.task.value = "";
  root.hidden = false;
  document.getElementById("stage")?.classList.add("ns-open");
  paint();
  ui.folder.focus();
  return true;
}

export function closeNewSession() {
  if (!root || root.hidden) return;
  root.hidden = true;
  document.getElementById("stage")?.classList.remove("ns-open");
  target = null;
  bridge.focusBack();
}

/* --- the form ---------------------------------------------------------------- */

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function field(label, control) {
  const row = el("div", "ns-field");
  const name = el("span", "ns-label", label);
  row.append(name, control);
  return row;
}

function segmented(items, onPick) {
  const seg = el("div", "ns-seg");
  seg.setAttribute("role", "group");
  for (const [key, text] of items) {
    const b = el("button", "ns-opt", text);
    b.type = "button";
    b.dataset.key = key;
    b.addEventListener("click", () => onPick(key));
    seg.append(b);
  }
  return seg;
}

function build() {
  const card = el("div", "ns-card");
  const title = el("h2", "ns-title", FA.nsTitle);
  title.id = "ns-title";
  root.setAttribute("aria-labelledby", "ns-title");

  const presets = segmented([["solo", FA.nsPresetSolo], ["pair", FA.nsPresetPair],
                             ["group", FA.nsPresetGroup], ["custom", FA.nsPresetCustom]],
                            (key) => { if (key !== "custom") applyPreset(key); else model.preset = key; paint(); });

  const folder = el("select", "ns-folder");
  folder.addEventListener("change", () => {
    if (folder.value === "__pick") {
      pickFolder(null);
      return;
    }
    setAllPath(folder.value);
    touched();
  });
  const folderPath = el("bdi", "ns-folder-path");

  const counts = segmented(Array.from({ length: MAX_PANES },
                                      (_, i) => [String(i + 1), (i + 1).toLocaleString("fa-IR")]),
                           (key) => { model.count = Number(key); touched(); });

  const isoShared = radio("shared", FA.nsIsoShared);
  const isoTree = radio("worktree", FA.nsIsoWorktree);
  const iso = el("div", "ns-iso");
  const isoNote = el("p", "ns-note");
  isoNote.setAttribute("dir", "auto");
  iso.append(isoShared.label, isoTree.label, isoNote);

  const task = el("textarea", "ns-task");
  task.rows = 3;
  task.setAttribute("dir", "auto");
  task.placeholder = FA.nsTaskPlaceholder;
  // Shift+Space is ZWNJ here too (spec rule 6): the one field on this page a
  // Persian writer types a sentence into.
  task.addEventListener("keydown", (e) => {
    if (e.key === " " && e.shiftKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      task.setRangeText("‌", task.selectionStart, task.selectionEnd, "end");
    }
  });
  task.addEventListener("input", () => { model.task = task.value; paintPreview(); });

  // The launch list is a row of the same grid as every field above it, so its
  // edges are theirs.
  const previewHint = el("p", "ns-note", FA.nsPreviewHint);
  const preview = el("ul", "ns-preview");
  const previewWrap = el("div", "ns-preview-wrap");
  previewWrap.append(previewHint, preview);
  const previewField = field(FA.nsPreviewTitle, previewWrap);
  previewField.firstChild.classList.add("ns-sub");
  const error = el("p", "ns-error");
  error.setAttribute("role", "alert");
  error.setAttribute("dir", "auto");

  const cancel = el("button", "ns-cancel", FA.nsCancel);
  cancel.type = "button";
  cancel.addEventListener("click", closeNewSession);
  const go = el("button", "ns-go", FA.nsLaunch);
  go.type = "button";
  go.addEventListener("click", launch);
  const actions = el("div", "ns-actions");
  actions.append(cancel, go);

  const folderWrap = el("div", "ns-folder-wrap");
  folderWrap.append(folder, folderPath);
  card.append(title,
              field(FA.nsPreset, presets),
              field(FA.nsFolder, folderWrap),
              field(FA.nsCount, counts),
              field(FA.nsIsolation, iso),
              field(FA.nsTask, task),
              previewField, error, actions);
  root.append(card);
  ui = { presets, folder, folderPath, counts, isoShared, isoTree, isoNote, task,
         previewHint, preview, error, go, cancel };
}

function radio(value, text) {
  const label = el("label", "ns-radio");
  const input = el("input");
  input.type = "radio";
  input.name = "ns-iso";
  input.value = value;
  input.addEventListener("change", () => { setAllIso(value); touched(); });
  label.append(input, el("span", "", text));
  return { label, input };
}

function applyPreset(key) {
  const p = PRESETS[key];
  model.preset = key;
  model.count = p.count;
  model.slots = [];
  setAllIso(p.iso);
}

// Any change by hand makes the preset «دلخواه». «جفت» only holds while both
// sit in one folder, unbranched: the reviewer has to see the builder's files.
function touched() {
  syncSlots();
  const p = PRESETS[model.preset];
  const split = model.slots.some((s) => s.iso === "worktree" || !samePath(s.path, model.slots[0].path));
  if (p && (p.count !== model.count || (p.lockShared && split))) {
    model.preset = "custom";
  }
  paint();
}

function samePath(a, b) {
  return (a || "").toLowerCase() === (b || "").toLowerCase();
}

function gitOf(path) {
  return !!model.projects.find((x) => samePath(x.path, path))?.git;
}

// A branch of its own exists only in a repo: asked for anywhere else, the
// conversation shares its folder, and the note under the field says why.
function isoFor(path, iso) {
  return iso === "worktree" && gitOf(path) ? "worktree" : "shared";
}

// One slot per conversation; a new one starts from the two fields.
function syncSlots() {
  model.slots.length = Math.min(model.slots.length, model.count);
  while (model.slots.length < model.count) {
    model.slots.push({ path: model.path, iso: isoFor(model.path, model.iso) });
  }
}

function setAllPath(path) {
  model.path = path;
  model.slots = [];
  syncSlots();
}

function setAllIso(iso) {
  model.iso = iso;
  syncSlots();
  for (const slot of model.slots) slot.iso = isoFor(slot.path, iso);
}

function roles() {
  const p = PRESETS[model.preset];
  return Array.from({ length: model.count }, (_, i) => p?.roles[i] ?? "builder");
}

/* Why a count cannot be picked, or "" when it can. */
function countBlock(n) {
  if (n > MAX_PANES - openNow) return FA.nsTooMany;
  if (!bridge.fits(n)) return FA.nsNoRoom;
  return "";
}

/* `slot`: the one conversation whose row asked, or null for all of them. */
async function pickFolder(slot) {
  try {
    const got = await api("/api/project/pick", {});
    const picked = got.path;
    if (picked) {
      const known = model.projects.find((p) => samePath(p.path, picked));
      // The server says whether it is a repo; it used to be taken for none,
      // so a picked repo could never get a branch of its own.
      if (known) known.git = known.git || !!got.git;
      else model.projects.unshift({ path: picked, git: !!got.git });
      if (slot === null) setAllPath(picked);
      else model.slots[slot] = { path: picked, iso: isoFor(picked, model.slots[slot].iso) };
    }
  } catch (err) {
    // The dialog failed or was cancelled; the folder stays what it was.
  }
  touched();
}

function folderOptions(select, value) {
  select.replaceChildren();
  for (const p of model.projects) {
    const o = el("option", "", p.name || p.path.split(/[\\/]/).filter(Boolean).pop() || p.path);
    o.value = p.path;
    o.title = p.path;
    select.append(o);
  }
  const other = el("option", "", FA.nsPickOther);
  other.value = "__pick";
  select.append(other);
  select.value = model.projects.find((p) => samePath(p.path, value))?.path ?? value ?? "";
}

function paint() {
  if (!ui || !model) return;
  for (const b of ui.presets.children) {
    b.setAttribute("aria-pressed", String(b.dataset.key === model.preset));
  }
  syncSlots();
  folderOptions(ui.folder, model.path || "");
  ui.folderPath.replaceChildren(model.path ? pathEl(model.path) : "");

  // A count that cannot launch is drawn and disabled, with its reason on it.
  let fits = model.count;
  for (const b of ui.counts.children) {
    const n = Number(b.dataset.key);
    const why = countBlock(n);
    b.disabled = !!why;
    b.title = why;
    b.setAttribute("aria-pressed", String(n === model.count));
    if (why && n === model.count) fits = 0;
  }
  if (!fits) {
    // The chosen count stopped fitting (a folder change, a resize): step down.
    for (let n = model.count - 1; n >= 1; n--) {
      if (!countBlock(n)) { model.count = n; return paint(); }
    }
  }
  // The two radios describe the rows: both unchecked when the rows differ.
  const anyGit = model.slots.some((s) => gitOf(s.path));
  const allGit = model.slots.every((s) => gitOf(s.path));
  const locked = PRESETS[model.preset]?.lockShared;
  ui.isoTree.input.disabled = !anyGit || !!locked;
  ui.isoShared.input.checked = model.slots.every((s) => s.iso === "shared");
  ui.isoTree.input.checked = model.slots.every((s) => s.iso === "worktree");
  ui.isoNote.textContent = !anyGit ? FA.nsNotGit : locked ? FA.nsPairShared
    : !allGit && model.iso === "worktree" ? FA.nsTreeSomeOnly : "";
  ui.isoNote.hidden = !ui.isoNote.textContent;
  ui.error.textContent = model.error;
  ui.error.hidden = !model.error;
  ui.go.disabled = launching || model.slots.some((s) => !s.path) || !!countBlock(model.count);
  paintPreview();
}

function nameOf(path) {
  return model.projects.find((p) => samePath(p.path, path))?.name
    || (path || "").split(/[\\/]/).filter(Boolean).pop() || "—";
}

/* One row per conversation. With more than one, each row IS a small form -
   its own folder and its own branch - rebuilt on every paint, so the control
   that had the keyboard gets it back afterwards. */
function paintPreview() {
  syncSlots();
  const had = document.activeElement?.closest?.(".ns-slot") ? document.activeElement : null;
  const again = had && { slot: had.dataset.slot, kind: had.dataset.kind };
  ui.preview.replaceChildren();
  const editable = model.count > 1;
  const locked = !!PRESETS[model.preset]?.lockShared;
  ui.previewHint.hidden = !editable;
  roles().forEach((role, i) => {
    const slot = model.slots[i];
    const li = el("li", "ns-slot");
    li.append(el("span", "ns-slot-n", (i + 1).toLocaleString("fa-IR")));
    if (editable) {
      const pick = el("select", "ns-slot-folder");
      pick.dataset.slot = String(i);
      pick.dataset.kind = "folder";
      pick.setAttribute("aria-label", FA.nsSlotFolder.replace("{n}", (i + 1).toLocaleString("fa-IR")));
      folderOptions(pick, slot.path);
      pick.title = slot.path;
      pick.addEventListener("change", () => {
        if (pick.value === "__pick") { pickFolder(i); return; }
        model.slots[i] = { path: pick.value, iso: isoFor(pick.value, slot.iso) };
        touched();
      });
      const branch = el("label", "ns-slot-branch");
      const box = el("input");
      box.type = "checkbox";
      box.dataset.slot = String(i);
      box.dataset.kind = "branch";
      box.checked = slot.iso === "worktree";
      box.disabled = locked || !gitOf(slot.path);
      branch.title = !gitOf(slot.path) ? FA.nsNotGit : locked ? FA.nsPairShared : "";
      box.addEventListener("change", () => {
        model.slots[i].iso = isoFor(slot.path, box.checked ? "worktree" : "shared");
        touched();
      });
      branch.append(box, el("span", "", FA.nsSlotBranch));
      li.append(pick, branch);
    } else {
      const proj = el("bdi", "ns-slot-proj", nameOf(slot.path));
      proj.setAttribute("dir", "auto");
      li.append(proj, el("span", "ns-slot-iso", slot.iso === "worktree" ? FA.nsSlotWorktree : FA.nsSlotShared));
    }
    li.append(el("span", "ns-slot-role" + (role === "reviewer" ? " is-reviewer" : ""),
                 role === "reviewer" ? FA.nsRoleReviewer : FA.nsRoleBuilder));
    ui.preview.append(li);
  });
  if (again) {
    ui.preview.querySelector(`[data-slot="${again.slot}"][data-kind="${again.kind}"]`)?.focus();
  }
  if (model.task.trim()) {
    const li = el("li", "ns-slot ns-slot-task", FA.nsSlotTask);
    li.setAttribute("dir", "auto");
    ui.preview.append(li);
  }
}

/* --- launch: all or nothing ------------------------------------------------- */

async function launch() {
  if (launching || !model || model.slots.some((s) => !s.path) || countBlock(model.count)) return;
  launching = true;
  model.error = "";
  ui.go.textContent = FA.nsLaunching;
  paint();
  const opened = [];
  const who = roles();
  try {
    for (const slot of model.slots) {
      const body = { path: slot.path };
      if (slot.iso === "worktree") body.worktree = "auto";
      const data = await api("/api/project/open", body);
      opened.push(data.tab);
    }
  } catch (err) {
    // All or nothing (§D8): close what did open, say why, stay on the page.
    for (const tab of opened) {
      try { await api("/api/tab/close", { tab }); } catch (e) { /* already gone */ }
    }
    const msg = err?.message ?? "";
    model.error = /-> 409$/.test(msg) ? FA.maxTabs
      : /-> 400$/.test(msg) ? FA.notGitRepo : FA.nsFailed;
    launching = false;
    ui.go.textContent = FA.nsLaunch;
    paint();
    return;
  }
  const task = model.task.trim();
  const into = target;
  launching = false;
  ui.go.textContent = FA.nsLaunch;
  root.hidden = true;
  document.getElementById("stage")?.classList.remove("ns-open");
  target = null;
  await bridge.place(opened, into);
  // After the panes exist, so a failure lands in the pane it belongs to. A
  // reviewer's posture goes BEFORE its task, or its first turn could edit.
  for (const [i, tab] of opened.entries()) {
    try {
      if (who[i] === "reviewer") await api("/api/posture", { tab, posture: "plan" });
      if (task) {
        const text = who[i] === "reviewer" ? FA.presetReviewerBrief + "\n\n" + task : task;
        await api("/api/message", { tab, text });
      }
    } catch (err) {
      bridge.say(tab, FA.nsStepFailed);
    }
  }
}
