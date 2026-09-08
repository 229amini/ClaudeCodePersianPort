/* ============================================================================
   The permission dialog (plan §B-5), as a FACTORY: one dialog per cell.

   Cut verbatim out of chrome.js (MA4-T1). Nothing about the transport changed
   — read wiki/permission-transport.md before touching any of it: the
   AskUserQuestion path travels the same `can_use_tool` pipe and is not a
   permission at all, the allow reply carries `updatedInput` and nothing else,
   and a reply needs no tab because respond_permission scans every broker by
   request_id (server.py).

   WHAT IS PER CELL and what is per WINDOW. The dialog, its queue and its
   current request belong to the cell that draws them. The two routing questions
   do not: "which cell should this request open in?" and "has this window been
   asked about that tab yet?" are asked of the window, so `PERMS` and `permSeen`
   live here at module level. Neither holds DOM.
   ========================================================================= */
"use strict";

import { token } from "./api.js";
/* Cyclic with render.js, exactly as chrome.js is and for the same reason: the
   dialog renders the tool's own parameters through the shipping builders (plan
   §B-4, one implementation of the BiDi contract). Nothing here runs at
   module-evaluation time — makePerm() is called from app.js once every module
   is live. */
import {
  label, renderToolDetail, questionProse, questionOption,
} from "./render.js";
/* The sidebar owns the open-conversations list and its dots; this owns the
   requests those dots are painted from. One arrow each way, neither at
   evaluation time. */
import {
  repaintTabs, openTabEntry, activeTabId, tabTitle, projectChip,
} from "./chrome.js";

const FA = window.STRINGS;

/* Every dialog in the window — one per cell. A Set rather than a per-cell
   lookup because all three window-level verbs below are "ask every one of
   them": who is waiting on this tab, drop this request, drop this tab. */
const PERMS = new Set();

/* Tabs this window has itself been asked to approve something for. Until a tab
   is in here the server's `pending_permission` is the only thing that knows —
   a window that reconnects mid-dialog paints «منتظر تأیید» off the snapshot
   rather than waiting for the SSE backlog to replay the request. After that
   the queues below are the truth, and a stale snapshot cannot resurrect a
   dialog this window has already answered. */
const permSeen = new Set();

/* AskUserQuestion travels over the permission pipe but is NOT a permission: the
   model is asking the user something and the answer rides back in the allow
   reply's `updatedInput.answers` (server.py ASK_TOOL). So the dialog has two
   modes, and the difference is not cosmetic — in ask mode there is nothing to
   "allow", the remember checkbox is meaningless, and dismissing must skip the
   question rather than refuse a tool call. */
const ASK_TOOL = "AskUserQuestion";

function askQuestions(req) {
  const list = req?.tool_name === ASK_TOOL && req.tool_input?.questions;
  return Array.isArray(list) && list.length ? list : null;
}

/* --- the window-level verbs ------------------------------------------------ */

/* Is any dialog in this window asking about that conversation? chrome.js paints
   the tab's dot from it (tabStatus → isWaiting) — the only status of the four
   that will never resolve itself. */
export function permAsking(tab) {
  if (!tab) return false;
  for (const one of PERMS) {
    if (one.asking(tab)) return true;
  }
  return false;
}

export function permSeenTab(tab) {
  return permSeen.has(tab);
}

/* Which column the keyboard is in, handed in by app.js (which owns focus)
   rather than imported — app.js is the entry module and its body runs last.
   Null in spec-test.html, which has no grid: the first dialog registered is the
   answer there, which is the single-cell behaviour this replaces. */
let getFocusedCell = null;

export function setPermFocus(fn) {
  getFocusedCell = fn;
}

/* ONE dialog per cell, N conversations: the request opens in the cell already
   showing that conversation, and otherwise in the FOCUSED cell — which then
   says «از نشست دیگر» itself (paintPermSource below). NEVER
   deferred: a background conversation waiting on an answer is exactly the case
   the dialog has to name, and leaving it unshown blocks that CLI until its
   timeout with nothing on screen. */
export function showPermission(req) {
  const list = [...PERMS];
  const focused = getFocusedCell?.();
  const target = list.find((one) => req?.tab && one.cell.tab === req.tab)
              ?? list.find((one) => one.cell === focused)
              ?? list[0];
  target?.show(req);
}

/* The server resolved it without us (timeout, or another window answered). */
export function dismissPermission(requestId) {
  for (const one of PERMS) one.dismiss(requestId);
}

/* That conversation is gone (app.js dropTab, off a tagged `wrapper/closed`).
   The server denies whatever was pending before it drops the tab, so the
   resolved event normally clears these first — this is the belt for the race
   where it does not, because a dialog still asking on behalf of a dead CLI can
   only be answered into nothing. */
export function dismissTabPermissions(tab) {
  if (!tab) return;
  // The id dies with the conversation, so its entry in permSeen would only ever
  // grow the set. Dropping it also puts a REUSED id back on the server's own
  // answer, which is the right default for a tab this window knows nothing
  // about yet.
  permSeen.delete(tab);
  for (const one of PERMS) one.dismissTab(tab);
}

/* --- one dialog ------------------------------------------------------------ */

export function makePerm(root, cell) {
  // Cell-local elements (MA4-T0): `id` -> `class`, looked up inside this cell's
  // own root. spec-test.html passes `document.body` and keeps its ids as well.
  const $ = (cls) => root.querySelector("." + cls);

  const perm = {
    dialog: $("perm"),
    form: $("perm-form"),
    tool: $("perm-tool"),
    params: $("perm-params"),
    ask: $("perm-ask"),
    remember: $("perm-remember"),
    title: $("perm-title"),
    text: $("perm-body"),
    source: $("perm-source"),
    allow: $("perm-allow"),
    deny: $("perm-deny"),
    queue: [],
    current: null,
  };

  function show(req) {
    perm.queue.push(req);
    // From here on this window's own queue is the truth about that tab, not the
    // /api/tabs snapshot (see permSeen above).
    if (req.tab) permSeen.add(req.tab);
    if (!perm.current) nextPermission();
    else repaintTabs();   // a second tab is waiting behind the open dialog
  }

  function nextPermission() {
    perm.current = perm.queue.shift() ?? null;
    // Whichever tab was waiting is not any more, and another one may be now.
    repaintTabs();
    if (!perm.current) return;

    /* Optional chaining throughout: spec-test.html carries this markup as a copy,
       and a missing element must degrade, not take the whole renderer down with
       it — which is exactly what an unguarded replaceChildren() did once. */
    const questions = askQuestions(perm.current);
    paintPermSource(perm.current.tab);
    perm.dialog.classList.toggle("asking", !!questions);
    if (perm.title) perm.title.textContent = questions ? FA.askTitle : FA.permTitle;
    if (perm.text) perm.text.textContent = questions ? FA.askBody : FA.permBody;
    if (perm.allow) perm.allow.textContent = questions ? FA.askSubmit : FA.permAllow;
    if (perm.deny) perm.deny.textContent = questions ? FA.askSkip : FA.permDeny;

    if (questions) {
      perm.tool?.replaceChildren();
      perm.params?.replaceChildren();
      perm.ask?.replaceChildren(renderQuestions(questions));
    } else {
      perm.ask?.replaceChildren();
      perm.tool?.replaceChildren(label(perm.current.tool_name ?? "?", "mono"));
      renderParams(perm.current.tool_name, perm.current.tool_input ?? {});
    }
    if (perm.remember) perm.remember.checked = false;
    /* show(), not showModal() (MA4-T0): the dialog sits IN THE FLOW above the
       composer, like the terminal edition's .perm (static-terminal/js/perm.js).
       `open` still reads true and the CSS is unchanged; what is given up is the
       backdrop and the focus trap, and with them the native `cancel` event on
       Escape — re-created below on the dialog's own keydown. */
    if (!perm.dialog.open) perm.dialog.show();
    // A permission defaults to the safe answer (deny). A question has no unsafe
    // answer, so focus goes to the first option instead of to Skip.
    (questions ? perm.ask?.querySelector("input") : perm.deny)?.focus();
  }

  /* ONE dialog serves every open conversation, so when the asking one is not the
     one on screen it has to say WHICH — «اجازه بده» to a tool you cannot see
     running, in a project you are not looking at, is exactly the consent this
     window exists to make legible. Silent for the visible tab: naming the
     conversation you are already reading is noise. */
  function paintPermSource(tab) {
    if (!perm.source) return;
    // `activeTabId()` is empty until /api/tabs has answered — before that this
    // window does not know which conversation it is showing, and guessing
    // "another one" would be a false alarm on the very first request.
    const active = activeTabId();
    const other = !!tab && !!active && tab !== active;
    perm.source.hidden = !other;
    if (!other) return;
    // A tab that spawned a moment ago may not be in the list yet. It is still not
    // the one on screen, and saying so unnamed beats saying nothing at all.
    const entry = openTabEntry(tab);
    const name = document.createElement("bdi");
    name.setAttribute("dir", "auto");   // the user's own words, either script
    name.textContent = entry ? tabTitle(entry) : FA.tabFresh;
    perm.source.replaceChildren(document.createTextNode(FA.permOtherSession + " "), name);
    if (entry?.cwd) perm.source.append(projectChip(entry.cwd));
  }

  /* Built from the tool's own payload, so a question the model invents at runtime
     renders without any list here to keep in sync. Radio for a single choice,
     checkbox for multiSelect — the native controls carry keyboard support, group
     semantics and the checked state for free. */
  function renderQuestions(questions) {
    const frag = document.createDocumentFragment();
    questions.forEach((q, index) => {
      const set = document.createElement("fieldset");
      set.className = "ask-q";
      set.dataset.question = q.question ?? "";

      /* The prose — header, question, and each option below — goes through
         render.js's builders, which are the ONE implementation of the BiDi
         contract for this tool. This is the place the user has to READ the
         question to answer it, and as textContent an inline `code` span kept its
         backticks and its neutral characters («/price-photo/») reordered against
         the Persian around them: the scrambled question that was reported. This
         file keeps the chrome — the fieldset, the inputs, the free-text box. */
      if (q.header) {
        set.append(questionProse(document.createElement("legend"), q.header));
      }
      const text = document.createElement("p");
      text.className = "ask-text";
      set.append(questionProse(text, q.question));
      if (q.multiSelect) set.append(label(FA.askMulti, "ask-hint"));

      for (const option of q.options ?? []) {
        const row = document.createElement("label");
        row.className = "ask-opt";
        const box = document.createElement("input");
        box.type = q.multiSelect ? "checkbox" : "radio";
        box.name = "ask-" + index;
        // The RAW label, never the rendered one: this value is the wire format
        // the CLI matches the answer against (wiki/permission-transport.md).
        box.value = option.label ?? "";
        row.append(box);
        const stack = document.createElement("span");
        stack.className = "ask-opt-text";
        row.append(questionOption(stack, option, "ask-label", "ask-desc"));
        set.append(row);
      }

      /* The tool always offers a free-text answer, so the dialog must too —
         otherwise a question whose real answer is none of the options can only be
         skipped. Typing here does not clear the boxes: the CLI accepts both. */
      const other = document.createElement("label");
      other.className = "ask-other";
      other.append(label(FA.askOther, "ask-label"));
      const field = document.createElement("input");
      field.type = "text";
      field.className = "ask-free";
      field.setAttribute("dir", "auto");
      field.placeholder = FA.askOtherPlaceholder;
      other.append(field);
      set.append(other);

      frag.append(set);
    });
    return frag;
  }

  /* Keyed by the question TEXT and valued with option labels — the CLI's own
     validator reads it that way (measured; wiki/permission-transport.md). A
     multiSelect answer may be an array, a single choice must be a string. */
  function collectAnswers() {
    const answers = {};
    for (const set of perm.ask.querySelectorAll(".ask-q")) {
      const key = set.dataset.question;
      if (!key) continue;
      const picked = [...set.querySelectorAll("input:checked")].map((i) => i.value);
      const free = set.querySelector(".ask-free")?.value.trim();
      if (free) picked.push(free);
      if (!picked.length) continue;
      const multi = set.querySelector('input[type="checkbox"]');
      answers[key] = multi ? picked : picked[0];
    }
    return answers;
  }

  /* The dialog and the tool card render parameters with the SAME function
     (render.js). They used to differ, and the dialog's version forced every
     string LTR through pathEl — so a Persian Write.content or Edit.new_string
     was unreadable exactly at the moment of consent. Spec rule 8. */
  function renderParams(toolName, toolInput) {
    if (!Object.keys(toolInput ?? {}).length) {
      perm.params?.replaceChildren("—");
      return;
    }
    // renderToolDetail, not renderParamRows: an Edit shows as a real diff here
    // too. This is the moment of consent — making the reader diff old_string
    // against new_string by eye is the worst possible place to do it.
    perm.params?.replaceChildren(renderToolDetail(toolName, toolInput));
  }

  async function resolvePermission(decision) {
    const req = perm.current;
    const asking = !!askQuestions(req);
    // Read the form before anything closes or the queue moves on.
    const answers = asking && decision === "allow" && perm.ask ? collectAnswers() : {};
    perm.current = null;
    if (perm.dialog.open) perm.dialog.close();
    if (!req) return;

    try {
      await fetch("/api/permission/respond?t=" + encodeURIComponent(token), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Skipping a question is still an "allow" with an empty answer set —
          // the CLI reads that as "the user did not answer", where a deny would
          // reach the model as a tool failure.
          request_id: req.request_id,
          decision: asking ? "allow" : decision,
          remember: !asking && perm.remember.checked,
          tool_name: req.tool_name,
          ...(asking ? { answers } : {}),
        }),
      });
    } catch (err) {
      console.error("permission respond failed", err);
    }
    nextPermission();
  }

  /* Requests that can no longer be answered: they leave the queue, and the dialog
     goes with them if it was the one asking. */
  function dropPermissions(match) {
    perm.queue = perm.queue.filter((req) => !match(req));
    if (perm.current && match(perm.current)) {
      perm.current = null;
      if (perm.dialog?.open) perm.dialog.close();
      nextPermission();   // repaints
      return;
    }
    repaintTabs();        // a QUEUED request left; the dialog did not move
  }

  /* --- init ------------------------------------------------------------------ */

  if (perm.dialog) {
    // Title, body and both button labels are set per request instead: they
    // differ between an approval and a question (nextPermission).
    const rememberLabel = $("perm-remember-label");
    if (rememberLabel) rememberLabel.textContent = FA.permRemember;

    /* Escape must resolve as deny wherever focus is inside the dialog. show()
       (MA4-T0) makes the dialog non-modal, so it fires no `cancel` event any
       more — this keydown handler is what replaces it (same idiom as the
       terminal edition's perm.js). Dismissing must never be mistaken for
       approval, and leaving it unanswered would block the CLI until the
       timeout; in ask mode resolvePermission turns the same deny into a skip. */
    perm.dialog.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      resolvePermission("deny");
    });

    perm.form.addEventListener("submit", (e) => {
      // <form method="dialog"> closes natively; capture which button was used.
      resolvePermission(e.submitter?.value === "allow" ? "allow" : "deny");
    });

    // Enter inside the question area ANSWERS, never skips. Implicit form
    // submission "clicks" the form's default button — the tree-first submit
    // button, which is .perm-deny — so typing a free-text answer (or picking a
    // radio, where focus starts) and pressing Enter submitted the skip: the
    // CLI reported "the user did not answer" with the form fully filled in
    // (reported 2026-08-31). Only ask mode populates .perm-ask, so a plain
    // permission never reaches this handler.
    perm.ask?.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      resolvePermission("allow");
    });
  }

  const self = {
    cell,
    show,
    dismiss: (requestId) => dropPermissions((req) => req.request_id === requestId),
    dismissTab: (tab) => dropPermissions((req) => req.tab === tab),
    asking: (tab) => perm.current?.tab === tab
                  || perm.queue.some((req) => req.tab === tab),
    /* The cell is going away — `/split 1` removed the column this dialog was
       drawn in (MA4-T2). Whatever it was asking is NOT answered here: a
       pending request holds a real CLI open until its timeout, so it is handed
       to whichever dialog is left. Never denied on the user's behalf; that is
       an answer nobody gave. */
    retire() {
      PERMS.delete(self);
      const pending = [perm.current, ...perm.queue].filter(Boolean);
      perm.current = null;
      perm.queue.length = 0;
      if (perm.dialog?.open) perm.dialog.close();
      for (const req of pending) showPermission(req);
      repaintTabs();
    },
  };
  PERMS.add(self);
  return self;
}
