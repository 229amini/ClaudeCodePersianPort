/* ============================================================================
   Window-local commands — V2-PLAN §3.5.

   The TUI has these and the pipe does not, so the window answers them itself.
   Sending one to the CLI as text buys nothing: measured (§5.7), an unknown
   command is refused locally, for free, with a full uuid lifecycle — which is
   a refusal row in the transcript where the user asked for an action.

   NOT here, on purpose:
     /model /effort /output-style /permissions /clear   composer.js
        LIFECYCLE_VERBS — they change wrapper state and v2.4 built them.
     /bash                                              composer.js runBash()
        it IS the `!` path (§3.2); a second copy would drift from it.
     /help /theme                                       neither, deliberately —
        see V2-PLAN §8.12. They fall through to the CLI, which refuses them
        locally and free.

   Every entry is SYNCHRONOUS and answers true/false: false means "not mine",
   and the caller then sends the line to the CLI as ordinary text, exactly as
   a lifecycle verb with nothing to offer does. Work that needs the network is
   started and left to finish on its own — a command that awaited its own
   answer would hold the composer shut while the CLI thinks.

   Imports: this module is imported BY composer.js and imports nothing that
   imports it back, so it adds no edge to the render↔chrome↔composer cycle
   app.js documents.
   ========================================================================= */
"use strict";

import { api } from "./api.js";
import { pathEl } from "./bidi.js";
import { bubble, label, glyph, state, postureText } from "./render.js";
import { focusSessions, chooseProject, switchToTab } from "./chrome.js";
import { openPicker, effortLabel, styleLabel } from "./controls.js";
import { unfoldAgents } from "./agents.js";

const FA = window.STRINGS;
const log = document.getElementById("log");

/* A local answer is a `meta` row: the same shape «متوقف شد» and the permission
   notes already use. It is not an assistant message and must never look like
   one — nothing here reached the model. */
function note(text) {
  return bubble("meta", text);
}

function notePath(text, path) {
  const el = bubble("meta", "");
  el.append(label(text + " "), pathEl(String(path ?? "")));
  return el;
}

/* --- /copy, /export --------------------------------------------------------

   Both read the column. The window already HAS the conversation as text (it
   drew it), so neither command reads a transcript file: a second reader would
   be a second answer to "what was said", and the two would disagree the first
   time the renderer changed. */

function lastAnswer() {
  const rows = [...log.querySelectorAll(".msg.assistant:not(.meta)")];
  return rows[rows.length - 1] ?? null;
}

function textOf(el) {
  return (el.innerText || el.textContent || "").trim();
}

function copyLast() {
  const el = lastAnswer();
  if (!el) { note(FA.cmdCopyEmpty); return true; }
  // Secure context: the window is served from 127.0.0.1, which counts as one.
  // It can still be refused (no user gesture, no focus), and a silent failure
  // on a copy is the worst kind — the user pastes the previous clipboard.
  navigator.clipboard?.writeText(textOf(el))
    .then(() => note(FA.cmdCopied))
    .catch(() => bubble("error", FA.cmdCopyFailed));
  return true;
}

/* Plain text, in the order it was said. Tool cards go in whole — a card is
   what the window showed, and an export that silently dropped the work is not
   a record of the session. */
function transcriptText() {
  const out = [];
  for (const node of log.children) {
    if (node.hidden) continue;
    const text = textOf(node);
    if (!text) continue;
    if (node.classList.contains("msg") && node.classList.contains("user")) {
      out.push(FA.exportYou + "\n" + text);
    } else if (node.classList.contains("msg")
               && node.classList.contains("assistant")
               && !node.classList.contains("meta")) {
      out.push(FA.exportClaude + "\n" + text);
    } else {
      out.push(text);
    }
  }
  return out.join("\n\n");
}

function exportTranscript() {
  const text = transcriptText();
  if (!text) { note(FA.cmdExportEmpty); return true; }
  api("/api/export", { text })
    .then((data) => notePath(FA.cmdExported, data.path))
    .catch(() => bubble("error", FA.cmdExportFailed));
  return true;
}

/* --- /status ---------------------------------------------------------------

   The TUI's status block (§3.3). Every value on it is already in this tab's
   own status object — the status line under the prompt paints from the same
   place — so this asks nothing of the CLI and works while a turn is running.
   The version comes off the welcome box, which the server stamped. */
function statusBlock() {
  const s = state.status;
  const version = document.querySelector(".wel-ver")?.textContent?.trim();
  const rows = [
    [FA.statusVersion, version],
    [FA.slModel, s.model],
    [FA.slFolder, s.cwd],
    [FA.slSession, s.sessionId],
    [FA.slMode, postureText(s.posture ?? s.mode)],
    [FA.slEffort, s.effort && effortLabel(s.effort)],
    [FA.slStyle, s.style && styleLabel(s.style)],
  ].filter(([, value]) => value);
  return openPicker("status", FA.statusTitle,
                    rows.map(([name, value]) => ({ key: "", title: name,
                                                   note: String(value) })),
                    null);
}

/* --- /resume ---------------------------------------------------------------

   §3.3's one row that does not render into the column: the sidebar already
   lists every session, so the command moves the KEYBOARD there rather than
   building a second list beside it (V2-PLAN §8.11B). */
function resumeList() {
  if (!focusSessions()) return false;   // nothing to resume: not our command
  note(FA.cmdResumeHint);
  return true;
}

/* --- /cd, /add-dir ---------------------------------------------------------

   One conversation has exactly one cwd (server.py spawns the CLI in it), so
   both names mean the same thing here: open the folder, which spawns a tab
   the way the sidebar's own folder button does. With no argument the native
   picker asks. */
function changeFolder(arg) {
  chooseProject(arg);
  return true;
}

/* --- /branch ---------------------------------------------------------------

   `--fork-session`: a copy of this conversation in its own session, measured
   in §5.5. The original keeps running in its own tab — that is the whole
   point of a branch — and the sidebar lists both with no new code. */
function branch() {
  api("/api/session/fork", {})
    .then(async (data) => {
      // The note goes in AFTER the switch, so it lands in the branch's own
      // column: switching tabs swaps the render target, and a line written
      // before it would be left behind in the conversation that was forked.
      await switchToTab(data.tab);
      note(FA.cmdBranchDone);
    })
    .catch(() => bubble("error", FA.cmdBranchFailed));
  return true;
}

/* --- /btw ------------------------------------------------------------------

   `side_question` (§5.4): routed, answered out of band, and it COSTS A TURN.
   The window says so before it sends — a question that looks free and is not
   is the one thing this row must not do. The answer is not a turn in the
   conversation either, so it renders as a side row (`※`) rather than as an
   assistant message. */
function sideRow(kind, text) {
  const el = bubble(kind, "");
  el.classList.add("side");
  el.append(glyph("※", { cls: "side-mark" }), label(text));
  return el;
}

function sideQuestion(text) {
  if (!text) return false;            // `/btw` alone is not a question
  sideRow("user", text);
  note(FA.cmdBtwCost);
  api("/api/control", { subtype: "side_question", params: { question: text } })
    .then((data) => {
      const answer = data.ok && (data.response?.response ?? "");
      if (answer) sideRow("assistant", String(answer));
      else bubble("error", FA.cmdBtwFailed);
    })
    .catch(() => bubble("error", FA.cmdBtwFailed));
  return true;
}

/* --- /config, /hooks, /memory, /keybindings --------------------------------

   The CLI edits these in a terminal editor it owns; the window opens the real
   file in whatever this machine edits text with. `what` is a KEY into a fixed
   map on the server (server.py known_files) — never a path from the page. */
function openFile(what) {
  api("/api/open-file", { what })
    .then((data) => notePath(FA.cmdOpened, data.path))
    .catch(() => bubble("error", FA.cmdOpenFailed));
  return true;
}

/* Two memory files, and the CLI asks which one too. */
function memoryPicker() {
  return openPicker("memory", FA.memoryTitle, [
    { key: "memory", title: FA.memoryUser, note: FA.memoryUserNote },
    { key: "project-memory", title: FA.memoryProject, note: FA.memoryProjectNote },
  ], (row) => openFile(row.key));
}

/* --- /tasks ----------------------------------------------------------------

   Background helpers already have a strip above the composer (agents.js), and
   it hides finished rows by default. `/tasks` is the TUI's name for "show me
   what is running", so it unfolds that strip rather than building a second
   list of the same registry. */
function tasks() {
  if (!unfoldAgents()) note(FA.cmdTasksEmpty);
  return true;
}

/* --- the table -------------------------------------------------------------

   `arg` is whatever followed the verb, trimmed. A verb that ignores its
   argument still receives it: `/status now` is not `/status`, and the caller
   decides what to do with a command that answers false. */
export const WINDOW_COMMANDS = {
  resume: resumeList,
  status: statusBlock,
  copy: copyLast,
  export: exportTranscript,
  cd: changeFolder,
  "add-dir": changeFolder,
  branch,
  btw: sideQuestion,
  config: () => openFile("settings"),
  hooks: () => openFile("settings"),
  keybindings: () => openFile("keybindings"),
  memory: memoryPicker,
  tasks,
};

/* Returns false when the verb is not one of ours, or when the one it names had
   nothing to do — both mean "send it to the CLI as text". */
export function runWindowCommand(verb, arg) {
  const run = WINDOW_COMMANDS[verb];
  if (!run) return false;
  return run(arg) !== false;
}
