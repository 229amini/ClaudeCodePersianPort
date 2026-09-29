/* ============================================================================
   The Changes panel (BRIDGEMIND-PORT.md §D12): what is different in this
   pane's folder, from git itself, one click from the conversation.

   One per pane, built by app.js makeCell() into the pane's own `.changes`
   section. While it is open the transcript is hidden (never removed). The
   folder is the server's to know - the request names the TAB, and a file is
   asked for by a name the listing itself returned.

   The files this conversation's own edit tools touched (`state.touched`,
   filled by the renderer, so a replay fills it too) come first; everything
   else git sees in the folder is below, folded.
   ========================================================================= */

import { api } from "./api.js";
import { pathEl } from "./bidi.js";
import { label, renderUnifiedDiff } from "./render.js";

const FA = window.STRINGS;
// git's own letters; an untracked file is «N», new.
const STATUS = { M: "M", A: "A", D: "D", R: "R", C: "C", U: "U", "?": "N" };

export function makeChanges(cell, { touched }) {
  const root = cell.root.querySelector(".changes");
  if (!root) return { open() {}, close() {}, isOpen: () => false };

  const head = document.createElement("div");
  head.className = "ch-head";
  const back = document.createElement("button");
  back.type = "button";
  back.className = "ch-back";
  back.textContent = FA.chBack;
  back.addEventListener("click", close);
  const title = label("", "ch-title");
  title.setAttribute("dir", "auto");
  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.className = "ch-refresh";
  refresh.textContent = FA.chRefresh;
  refresh.addEventListener("click", load);
  head.append(back, title, refresh);
  const body = document.createElement("div");
  body.className = "ch-body";
  root.append(head, body);
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  });

  function isOpen() {
    return !root.hidden;
  }

  function open() {
    root.hidden = false;
    cell.root.classList.add("changes-open");
    load();
    back.focus();
  }

  function close() {
    if (root.hidden) return;
    root.hidden = true;
    cell.root.classList.remove("changes-open");
    cell.composer?.focus?.();
  }

  function say(text) {
    const p = label(text, "ch-state");
    p.setAttribute("dir", "auto");
    body.replaceChildren(p);
  }

  async function load() {
    title.textContent = FA.chTitle;
    say(FA.chLoading);
    let data;
    try {
      data = await api("/api/changes?tab=" + encodeURIComponent(cell.tab ?? ""));
    } catch (err) {
      say(FA.chFailed);
      return;
    }
    if (data.state === "no-git") return say(FA.chNoGit);
    if (data.state === "no-repo") return say(FA.chNoRepo);
    const files = data.files ?? [];
    title.textContent = FA.chTitleCount.replace("{n}", files.length.toLocaleString("fa-IR"));
    if (!files.length) return say(FA.chNone);
    const mine = mineOf(files, data.root, touched());
    const group = (name, list, openNow) => {
      const box = document.createElement("details");
      box.className = "ch-group";
      box.open = openNow;
      const sum = document.createElement("summary");
      sum.append(label(name, "ch-group-name"),
                 label(list.length.toLocaleString("fa-IR"), "count-pill"));
      box.append(sum, ...list.map(row));
      return box;
    };
    const rest = files.filter((f) => !mine.has(f.path));
    const mineList = files.filter((f) => mine.has(f.path));
    body.replaceChildren();
    if (mineList.length) body.append(group(FA.chMine, mineList, true));
    if (rest.length) body.append(group(mineList.length ? FA.chOther : FA.chAll, rest,
                                       !mineList.length));
  }

  /* A row: status, path, +N −M. The path and the counts are LTR-isolated
     technical tokens (spec rule 2; the "+2 −1" lesson). Opening it fetches
     that one file's diff, once. */
  function row(file) {
    const box = document.createElement("details");
    box.className = "ch-file";
    const sum = document.createElement("summary");
    const chip = label(STATUS[file.status] ?? "M", "ch-status");
    chip.dataset.status = file.status;
    chip.title = FA.chStatus[file.status] ?? "";
    // The tool card's own shape (render.js): two coloured runs in one
    // LTR-isolated box.
    const stat = label("", "diff-stat");
    stat.setAttribute("dir", "ltr");
    stat.append(label(`+${file.add}`, "d-add"), label(`−${file.del}`, "d-del"));
    sum.append(chip, pathEl(file.path), stat);
    box.append(sum);
    let loaded = false;
    box.addEventListener("toggle", async () => {
      if (!box.open || loaded) return;
      loaded = true;
      const wait = label(FA.chLoading, "ch-state");
      box.append(wait);
      let data;
      try {
        data = await api("/api/changes?tab=" + encodeURIComponent(cell.tab ?? "")
                         + "&file=" + encodeURIComponent(file.path));
      } catch (err) {
        wait.textContent = FA.chFailed;
        loaded = false;
        return;
      }
      if (data.state === "too-large") {
        wait.textContent = FA.chTooLarge.replace("{n}", (data.lines ?? 0).toLocaleString("fa-IR"));
        return;
      }
      wait.replaceWith(data.diff ? renderUnifiedDiff(data.diff) : label(FA.chNone, "ch-state"));
    });
    return box;
  }

  return { open, close, isOpen, refresh: load };
}

/* Which listed paths this conversation touched. `touched` holds the paths the
   tools were given - absolute, in whichever slash and case the model wrote -
   and git lists paths relative to the repository root. */
function mineOf(files, root, touched) {
  const norm = (p) => String(p).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const base = norm(root ?? "");
  const want = new Set();
  for (const t of touched) {
    const n = norm(t);
    want.add(base && n.startsWith(base + "/") ? n.slice(base.length + 1) : n);
  }
  return new Set(files.filter((f) => want.has(norm(f.path))).map((f) => f.path));
}
