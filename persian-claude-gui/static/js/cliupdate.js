/* ============================================================================
   «Claude Code is too old for this model» -> one button that updates it.

   The CLI's own words, in a turn that produced nothing (2.1.259 asked for
   claude-opus-5-5, 2026-10-16):
     API Error: 400 Claude Code 2.1.259 does not support this model; version
     2.1.280 or newer is required. Run 'claude update', ...
   The person here never sees a terminal, so "run claude update" is the
   window's job: POST /api/cli/update (server.py CliUpdate), poll its state,
   say the version it reached. The server respawns every tab on the new
   binary itself, so sending the message again is all that is left.

   ONE FILE, BOTH EDITIONS: static/js/cliupdate.js and static-terminal/js/
   cliupdate.js are byte-identical. It imports only api.js.
   ========================================================================= */
"use strict";

import { api, token } from "./api.js";

const FA = window.STRINGS;
const TOO_OLD = /Claude Code (\d+\.\d+\.\d+) does not support this model; version (\d+\.\d+\.\d+) or newer is required/;
const POLL_MS = 1500;

/* The row to put under the error, or null when the error is something else. */
export function cliUpdateRow(text) {
  const m = TOO_OLD.exec(String(text ?? ""));
  if (!m || !token) return null;
  const row = document.createElement("div");
  row.className = "cli-update";
  row.dir = "rtl";            // window words, Persian (spec rule 1)
  const line = document.createElement("p");
  line.textContent = FA.cliOld.replace("{v}", m[1]).replace("{need}", m[2]);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = FA.cliUpdateBtn;
  const note = document.createElement("p");
  note.className = "meta";
  note.setAttribute("role", "status");
  note.hidden = true;
  btn.addEventListener("click", () => run(btn, note));
  row.append(line, btn, note);
  return row;
}

async function run(btn, note) {
  btn.disabled = true;
  note.hidden = false;
  note.textContent = FA.cliUpdating;
  let r = null;
  try {
    r = await api("/api/cli/update", {});
  } catch (e) {
    // the poll below reports what happened
  }
  while (!r || r.running) {
    await new Promise((done) => setTimeout(done, POLL_MS));
    try {
      r = await api("/api/cli/update/state", {});
    } catch (e) {
      r = null;
    }
  }
  if (r.rc !== 0) {
    note.textContent = FA.cliUpdateFailed + (r.lines?.length ? " " + r.lines[r.lines.length - 1] : "");
    btn.disabled = false;
    return;
  }
  note.textContent = r.after && r.after !== r.before
    ? FA.cliUpdated.replace("{v}", r.after)
    : FA.cliUpdateSame.replace("{v}", r.after ?? r.before ?? "");
  btn.hidden = r.after && r.after !== r.before;
  btn.disabled = false;
}
