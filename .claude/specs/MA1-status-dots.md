# MA1 — per-tab status (running / waiting / idle / error), unread count, running badge — both editions
Agent: builder
Files: `persian-claude-gui/static/js/chrome.js`, `static/js/app.js`, `static/js/render.js`,
`static/style.css`, `static/strings.fa.js`; the terminal edition's equivalents under
`persian-claude-gui/static-terminal/` (find them — the module split is documented in
`wiki/editions.md` + `wiki/frontend-modules.md`); `server.py` ONLY for one added field on
`/api/tabs`; `run_spec_test.py` (web assertions) and `test_shell.py` (terminal assertions).

Spec:
1. Derive a per-tab `status` on the client, one of `running | waiting | idle | error`:
   - `running`: that tab's render scope has `state.outstanding.size > 0` (render.js ~1870/1916 is
     where it settles; the scope is per tab, `app.js:87–100`).
   - `waiting`: `perm.queue` (chrome.js ~936) holds a request whose `req.tab === tab` — a
     `can_use_tool` / AskUserQuestion waiting on a human. Wins over `running`.
   - `error`: the tab's last `result` had `is_error` with `terminal_reason !== "aborted_streaming"`
     (render.js ~1830/1865), or `wrapper/cli_exited` arrived for it. Cleared by the next send on
     that tab.
   - `idle` otherwise. Compute it in ONE function (e.g. `tabStatus(tab)`) and paint from it — no
     second source of truth.
2. Paint it on the tab strip row's existing `.tab-dot` (chrome.js ~114–151; today it only knows
   `data.busy`) and on the sidebar's `.sess-dot` for live tabs (`sessionRow()` chrome.js ~519) as
   `data-status="…"`. Colours: reuse each edition's existing tokens (the busy pulse colour for
   running, the existing warning/amber token for waiting, the coral used by the delete confirm for
   error, muted for idle). Terminal edition: the dot is the binary's `●` glyph in those colours, no
   new shapes. A `title` attribute carries the Persian word for the state.
3. Unread: for a BACKGROUND tab, count `result` events (non-aborted) since the tab was last
   active; show it as a small number on the tab row next to the dot; reset to 0 in `applySwitch()`
   (app.js ~182–209) when that tab becomes visible. Persian digits like every other count here.
4. Running badge: next to the open-tabs header (web) / the tab strip (terminal), «N در حال کار»
   when N ≥ 1 and «N منتظر تأیید» when any tab is `waiting`; hidden at 0. Waiting text takes
   precedence if both; one small chip, not two.
5. Server: add `pending_permission: bool` to each entry of `/api/tabs` (server.py ~3171–3181,
   next to `busy`) so a fresh window that reconnects can paint `waiting` before the queue is
   replayed. Keep it read-only; no new endpoint.
6. All user-visible words come from `strings.fa.js` of the edition (`window.STRINGS` seam);
   terminal edition keys follow `wiki/tui-strings.md` conventions and must satisfy `test_strings.py`
   (no un-allowlisted English, no unread keys).
7. Assertions, negative-tested (make the assertion fail against the old behaviour first, then fix):
   web → `run_spec_test.py`; terminal → `test_shell.py`. At least: (a) an outstanding uuid on a
   background scope paints `data-status="running"` on its tab row; (b) a `can_use_tool` event with
   a background `tab` paints `waiting` on that row and the badge says «منتظر تأیید»; (c) a `result`
   on a background tab increments its unread count and `applySwitch` to it clears the count;
   (d) `is_error` with `terminal_reason: "aborted_streaming"` does NOT paint `error`.

Context: this is step 1 of epic `pcg-6nf` (multi-agent view, terminal edition first but this
task is both editions since the shape is identical). `render.js:1989–1994` documents that ONE
modal queue serves every open tab and `paintPermSource()` already names the waiting tab — reuse
that, do not add a second queue. Read `wiki/frontend-modules.md` §"A reload RE-RENDERS every
finished turn" before counting anything from `result` events: SSE backlog replay carries
`replayed: true` — a replayed result must not count as unread. Read `wiki/rtl-rendering-notes.md`
before adding any chip text that mixes digits and Persian (use the existing `.path`/`<bdi>`
patterns for anything LTR). Ponytail: smallest diff, no new modules unless a file would exceed
its edition's documented split.

Acceptance:
- `python persian-claude-gui\run_spec_test.py` → `PASS — N/N` with N ≥ 206 (was 202).
- `PCG_UI=terminal python persian-claude-gui\test_shell.py` → PASS with ≥ 33 checks (was 29).
- `PCG_UI=terminal python persian-claude-gui\run_spec_test.py` → `PASS — 174/174` (unchanged).
- `python persian-claude-gui\test_layout.py` (web) and `PCG_UI=terminal …` → PASS.
- `PCG_UI=terminal`: `test_dialogs.py`, `test_strings.py`, `test_keys.py` → PASS.
- `python persian-claude-gui\test_units.py` → PASS (the `/api/tabs` field).
- Each of the four new assertions was shown to FAIL before the fix (state which commit/stash you
  used to prove it, one line each).

Verify: `$env:PYTHONIOENCODING='utf-8'`; the commands above from `D:\projects\Claude`; `python`
resolves via `(Get-Command python).Source` — see `wiki/dev-environment.md`.

Report: ≤ 25 lines: outcome, files touched, the verify lines' final output, the four negative-test
proofs, deviations.

Out of scope: `--name`/`--worktree` (MA2), the split grid (MA3/MA4), document.title changes,
any new endpoint, help.html (MA5 updates docs once).
