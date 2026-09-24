/* ============================================================================
   The permission dialog (plan §B-5), as a FACTORY: one dialog per cell.

   Cut verbatim out of chrome.js (MA3 §1). Nothing about the transport changed
   — read wiki/permission-transport.md before touching any of it: the
   AskUserQuestion path travels the same `can_use_tool` pipe and is not a
   permission at all, the allow reply carries `updatedInput` and nothing else,
   and a reply needs no tab because respond_permission scans every broker by
   request_id (server.py).

   WHAT IS PER CELL and what is per WINDOW. The dialog, its queue, its current
   request and its option list belong to the cell that draws them. The two
   routing questions do not: "which cell should this request open in?" and
   "has this window been asked about that tab yet?" are asked of the window,
   so `PERMS` and `permSeen` live here at module level. Neither holds DOM.
   ========================================================================= */
"use strict";

import { token } from "./api.js";
/* Cyclic with render.js, exactly as chrome.js is and for the same reason: the
   dialog renders the tool's own parameters through the shipping builders (plan
   §B-4, one implementation of the BiDi contract). Nothing here runs at
   module-evaluation time — makePerm() is called from app.js once every module
   is live. */
import {
  bubble, label, renderToolDetail, questionProse, questionOption,
} from "./render.js";
/* The numbered list every v2.4 dialog is made of. A leaf: it imports nothing. */
import { optionList, digitIndex } from "./choice.js";
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
   the queues above are the truth, and a stale snapshot cannot resurrect a
   dialog this window has already answered. */
const permSeen = new Set();

/* AskUserQuestion travels over the permission pipe but is NOT a permission: the
   model is asking the user something and the answer rides back in the allow
   reply's `updatedInput.answers` (server.py ASK_TOOL). So the dialog has two
   modes, and the difference is not cosmetic — in ask mode there is nothing to
   "allow", the remember checkbox is meaningless, and dismissing must skip the
   question rather than refuse a tool call. */
const ASK_TOOL = "AskUserQuestion";
/* The plan approval of V2-PLAN §3.3. It travels the same pipe and renders with
   the same numbered options; what it does not get is «don't ask again». */
const PLAN_TOOL = "ExitPlanMode";

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

/* Which cell the keyboard is in. app.js sets it (MA3-T2); until it does — and
   in spec-test.html, which never does — the first dialog registered is the
   answer, which is the single-cell behaviour this replaces. */
let getFocusedCell = null;

export function setPermFocus(fn) {
  getFocusedCell = fn;
}

/* ONE dialog per cell, N conversations: the request opens in the cell already
   showing that conversation, and otherwise in the FOCUSED cell — which then
   says «از نشست دیگر» itself (paintPermSource below). NEVER deferred: a
   background conversation waiting on an answer is exactly the case the dialog
   has to name, and leaving it unshown blocks that CLI until its timeout with
   nothing on screen. */
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

/* The eyebrow's category (BRIDGEMIND-PORT.md §D10). By tool name, because
   that is all a `can_use_tool` request says about what it will do. */
const KIND = {
  Edit: "edit", Write: "edit", MultiEdit: "edit", NotebookEdit: "edit",
  Bash: "shell", PowerShell: "shell", KillShell: "shell",
  WebFetch: "outside", WebSearch: "outside",
  Read: "read", Glob: "read", Grep: "read", LS: "read",
  ExitPlanMode: "plan",
};

export function permKind(tool) {
  if (KIND[tool]) return KIND[tool];
  return String(tool ?? "").startsWith("mcp__") ? "outside" : "tool";
}

export function makePerm(root, cell) {
  // Cell-local elements (T0): `id` -> `class`, looked up inside this cell's own
  // root. spec-test.html passes `document` and keeps its ids as well.
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
    proceed: $("perm-proceed"),
    opts: $("perm-opts"),
    feedback: $("perm-feedback"),
    hint: $("perm-hint"),
    queue: [],
    current: null,
    list: null,          // the live optionList controller, or null in ask mode
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
    const planning = perm.current.tool_name === PLAN_TOOL;
    const kind = root.querySelector(".perm-kind");
    if (kind) {
      kind.textContent = questions ? "" : FA.permKind?.[permKind(perm.current.tool_name)] ?? "";
      kind.hidden = !kind.textContent;
    }
    if (perm.title) {
      perm.title.textContent = questions ? FA.askTitle
                             : planning ? FA.planTitle : FA.permTitle;
    }
    if (perm.text) {
      perm.text.textContent = questions ? FA.askBody
                            : planning ? FA.planBody : FA.permBody;
    }
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
    paintOptions(questions);
    /* show(), not showModal(): v2.4 puts the dialog IN THE FLOW above the prompt,
       where the Ink TUI draws it (V2-PLAN §3.3). `open` still reads true, the CSS
       is unchanged, and what is given up — the backdrop and the focus trap — is
       exactly what made it a modal rather than a row. */
    if (!perm.dialog.open) perm.dialog.show();
    // A question has no unsafe answer, so focus goes to its first option. A
    // permission focuses the LIST, whose highlight starts on «۱. بله» — the
    // digit, not the highlight, is what actually answers it, and Esc is still
    // one key away from the safe reply.
    (questions ? perm.ask?.querySelector("input") : perm.list?.el)?.focus();
  }

  /* The three options, in the TUI's own order (wiki/tui-strings.md §2). Option 2
     exists ONLY when a remember scope applies, which is why the digit cannot be
     part of the label — «۳.» is the refusal whether or not «۲.» was drawn
     (V2-PLAN §8.2). */
  function permOptions(req) {
    const tool = req?.tool_name ?? "?";
    const rows = [{ key: "allow", title: FA.permYes }];
    if (rememberable(req)) {
      // No directory in the wording: v1's remember scope is THIS PROJECT, THIS
      // SESSION, and naming a path would describe a scope the window does not
      // implement (V2-PLAN §8.1).
      rows.push({ key: "remember", title: FA.permYesRemember.replace("{tool}", tool) });
    }
    rows.push({ key: "deny", title: FA.permNoFeedback, esc: true });
    // The window's fourth row (§D10): refuse, then stop the turn. After the
    // Esc row, so the TUI's three keep their digits.
    rows.push({ key: "stop", title: FA.permNoStop });
    return rows;
  }

  /* «دیگر نپرس» is a standing grant for a TOOL. A plan is approved once —
     ExitPlanMode has no next call to skip — and a question is not an approval at
     all, so neither offers the row. */
  function rememberable(req) {
    return !!req?.tool_name && req.tool_name !== ASK_TOOL
        && req.tool_name !== PLAN_TOOL;
  }

  function paintOptions(questions) {
    if (!perm.opts) return;          // spec-test.html carries a copy of this markup
    perm.list = null;
    perm.opts.replaceChildren();
    if (perm.feedback) {
      perm.feedback.value = "";
      perm.feedback.placeholder = FA.permFeedbackPlaceholder;
    }
    if (perm.proceed) perm.proceed.textContent = FA.permProceed;
    if (perm.hint) perm.hint.textContent = questions ? FA.askHint : FA.permHint;
    if (questions) return;           // ask mode answers with its own inputs
    perm.list = optionList(permOptions(perm.current), {
      onPick: (key) => (key === "stop" ? refuseAndStop()
        : resolvePermission("allow", { remember: key === "remember" })),
      onCancel: () => resolvePermission("deny"),
      onKey: permListKey,
    });
    perm.opts.append(perm.list.el);
  }

  /* The two Confirmation-context keys the list itself does not own
     (wiki/tui-keys.md). Tab is `confirm:nextField` — here there are exactly two
     fields, the options and the note — and shift+tab is the TUI's «approve with
     this feedback». */
  function permListKey(e) {
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      perm.feedback?.focus();
      return;
    }
    if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      approveWithFeedback();
    }
  }

  /* «shift+tab to approve with this feedback», as far as this pipe allows it.
     `can_use_tool`'s ALLOW reply carries `updatedInput` and nothing else
     (wiki/permission-transport.md), so there is no field a note can ride in
     alongside an approval — inventing one would be a sentence the model never
     sees. The tool is approved and the note is handed to the composer instead,
     where the person can read it, edit it and send it as the next message —
     THIS cell's composer, because this cell is where the dialog was answered. */
  function approveWithFeedback() {
    const note = feedbackText();
    resolvePermission("allow");
    if (note) {
      cell.composer.restoreDraft(note);
      bubble("meta", FA.permFeedbackMoved);
    }
  }

  /* «نه، و کار را متوقف کن»: the refusal goes first, so the CLI is not left
     holding an open request while it is being interrupted; then the same
     interrupt the stop button sends, to the conversation that ASKED. */
  async function refuseAndStop() {
    const tab = perm.current?.tab || cell.tab;
    await resolvePermission("deny");
    try {
      await fetch("/api/interrupt?t=" + encodeURIComponent(token), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tab }),
      });
    } catch (err) {
      console.error("interrupt failed", err);
    }
  }

  function feedbackText() {
    return perm.feedback?.value.trim() ?? "";
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

      (q.options ?? []).forEach((option, at) => {
        const row = document.createElement("label");
        row.className = "ask-opt";
        const box = document.createElement("input");
        box.type = q.multiSelect ? "checkbox" : "radio";
        box.name = "ask-" + index;
        // The RAW label, never the rendered one: this value is the wire format
        // the CLI matches the answer against (wiki/permission-transport.md).
        box.value = option.label ?? "";
        row.append(box);
        /* Numbered like every other v2.4 dialog (V2-PLAN §3.3, «options
           numbered»), and for the same reason the permission list is: the digit
           is chrome the renderer places, never text inside the Persian label
           (§8.2). It is aria-hidden because the input beside it already carries
           the row's name and position for a screen reader. */
        const num = document.createElement("span");
        num.className = "opt-num";
        num.setAttribute("dir", "ltr");
        num.setAttribute("aria-hidden", "true");
        num.textContent = (at + 1).toLocaleString("fa-IR") + ".";
        row.append(num);
        const stack = document.createElement("span");
        stack.className = "ask-opt-text";
        row.append(questionOption(stack, option, "ask-label", "ask-desc"));
        set.append(row);
      });

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

  /* AskUserQuestion's own Confirmation keys (wiki/tui-keys.md). The native
     radio/checkbox behaviour would cover the arrows and Space on a real key
     press, but it is a DEFAULT ACTION — it does not run for a synthetic event,
     so a gate could never see it, and «the browser probably does this» is not a
     promise this project keeps anywhere else. Bound explicitly, and
     preventDefault stops the native move from happening twice. */
  function askOptionRows(from) {
    const set = from?.closest?.(".ask-q") ?? perm.ask?.querySelector(".ask-q");
    return [set, [...(set?.querySelectorAll(".ask-opt input") ?? [])]];
  }

  function askKeys(e) {
    const [, inputs] = askOptionRows(e.target);
    if (!inputs.length) return;
    const at = Math.max(0, inputs.indexOf(e.target));

    const digit = digitIndex(e);
    if (digit >= 0 && digit < inputs.length) {
      e.preventDefault();
      askChoose(inputs[digit]);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      inputs[(at + step + inputs.length) % inputs.length].focus();
      return;
    }
    if (e.key === " " || e.key === "Spacebar") {
      // `confirm:toggle`. A checkbox flips; a radio is a choice and cannot be
      // un-chosen, so the same key simply picks the row it is on.
      e.preventDefault();
      askChoose(inputs[at], true);
    }
  }

  function askChoose(box, toggle = false) {
    if (!box) return;
    box.checked = box.type === "checkbox" ? (toggle ? !box.checked : true) : true;
    box.focus();
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

  async function resolvePermission(decision, { remember = false } = {}) {
    const req = perm.current;
    const asking = !!askQuestions(req);
    // Read the form before anything closes or the queue moves on.
    const answers = asking && decision === "allow" && perm.ask ? collectAnswers() : {};
    // Option 3's «tell Claude what to do differently»: the note only means
    // anything on a refusal, which is the one reply that carries a message back
    // to the model (server.py PermissionBroker.respond).
    const feedback = !asking && decision === "deny" ? feedbackText() : "";
    perm.current = null;
    perm.list = null;
    if (perm.dialog.open) perm.dialog.close();
    if (!req) return;

    try {
      // No `tab`: respond_permission scans every broker by request_id
      // (server.py), so the reply finds its own conversation.
      await fetch("/api/permission/respond?t=" + encodeURIComponent(token), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Skipping a question is still an "allow" with an empty answer set —
          // the CLI reads that as "the user did not answer", where a deny would
          // reach the model as a tool failure.
          request_id: req.request_id,
          decision: asking ? "allow" : decision,
          // The checkbox is the harness's copy of this markup; the numbered list
          // is the window's «۲. بله، و دیگر برای … نپرس». Either one is consent
          // given once, and neither exists in ask mode.
          remember: !asking && (remember || !!perm.remember?.checked),
          tool_name: req.tool_name,
          ...(asking ? { answers } : {}),
          ...(feedback ? { feedback } : {}),
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

  /* --- init ---------------------------------------------------------------- */

  if (perm.dialog) {
    // Title, body and both button labels are set per request instead: they
    // differ between an approval and a question (nextPermission).
    const rememberLabel = $("perm-remember-label");
    if (rememberLabel) rememberLabel.textContent = FA.permRemember;

    /* Escape must resolve as deny wherever focus is inside the dialog. A
       non-modal <dialog> fires no `cancel` event, so this replaces the handler
       that used to rely on one — and it is bound on the dialog rather than the
       list so that Escape out of the feedback box means the same thing. In ask
       mode resolvePermission turns the same deny into a skip. */
    perm.dialog.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      resolvePermission("deny");
    });

    /* Two buttons, no submit: the dialog's form has no submit button at all
       any more, which retires by construction the 2026-08-31 defect where
       implicit submission clicked the tree-first one (.perm-deny) and turned a
       typed answer into a skip. The keydown handler below still claims Enter
       inside the question area for the same reason it always did. */
    perm.allow?.addEventListener("click", () => resolvePermission("allow"));
    perm.deny?.addEventListener("click", () => resolvePermission("deny"));

    /* The feedback box is the second of the confirmation's two fields
       (`confirm:nextField`). Tab goes back to the options; shift+tab is the
       TUI's «approve with this feedback». Enter is left alone — a note is
       prose and may need more than one line. */
    perm.feedback?.addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return;
      e.preventDefault();
      if (e.shiftKey) approveWithFeedback();
      else perm.list?.focus();
    });

    // Enter inside the question area ANSWERS, never skips. Implicit form
    // submission "clicks" the form's default button — the tree-first submit
    // button, which is .perm-deny — so typing a free-text answer (or picking a
    // radio, where focus starts) and pressing Enter submitted the skip: the
    // CLI reported "the user did not answer" with the form fully filled in
    // (reported 2026-08-31). Only ask mode populates .perm-ask, so a plain
    // permission never reaches this handler.
    perm.ask?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        resolvePermission("allow");
        return;
      }
      // Inside the free-text box every other key is a character the person is
      // typing — a digit is a digit and a space is a space. Only Enter, above,
      // is claimed there, which is what the 2026-08-31 fix is.
      if (e.target?.classList?.contains("ask-free")) return;
      askKeys(e);
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
       drawn in (MA3-T2). Whatever it was asking is NOT answered here: a
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
