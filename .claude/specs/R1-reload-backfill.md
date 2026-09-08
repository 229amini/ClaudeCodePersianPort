# R1 — a reloaded window repaints its transcript (pcg-1ug), both editions

## The bug, measured

Open a session, reload the window. The tab is still open (sidebar row present, status line
populated with six rows, CLI process alive) but `.log` has ZERO rows and the home greeting shows
instead of the transcript. Re-selecting the session from the sidebar does not restore it.
Reproduces at split 1 and split 4, and at `036c561` — before the multi-agent epic. Not a grid
regression.

## Root cause (traced, do not re-derive)

**A tab's transcript has two sources and only one of them survives a reload.**

1. Live events go to `Hub.publish` → the per-tab bucket (`server.py:290`, capped `HISTORY_MAX
   = 5000`) → replayed to a fresh window at `after=0`, marked `replayed: true`.
2. A resumed session's transcript is fetched by the CLIENT — `resumeSession` calls
   `/api/session` and hands the events to `renderInto`, which writes them straight into the
   tab's node (`static/js/chrome.js:1089-1096`). **Those rows are never published to the hub.**
   A resumed CLI does not re-emit the conversation either, which is why that fetch exists at all.

So after a reload the new window subscribes at `after=0` and receives only what the hub holds —
status, usage, lifecycle — and nothing that draws a message row. `syncHome()` sees
`cell.log.childElementCount === 0` and shows the greeting. The status line populates from the
same replay because it rides real hub events; that asymmetry is the tell.

Re-selecting the row cannot help: `resumeSession` short-circuits on an already-open session —
`const live = openTabs.find((t) => t.session_id === sessionId)?.tab; if (live) { await
tabBridge?.switchTo(live); return; }` (`chrome.js:1060-1064`) — and `switchTo` only moves an
existing buffer, it never re-fetches.

## The fix

Backfill at the one point every placement routes through, not in the callers. When a tab is
placed into a cell and its transcript is empty, fetch its history and render it through the
**existing** `renderInto` path. No server change: `/api/session` already answers, and
`/api/tabs` already carries the three things the fetch needs (`session_id`, `cwd`, `worktree`).

## Acceptance

1. One backfill helper, called from the shared placement path (`placeIn`, `static/js/app.js:465`
   / `static-terminal/js/app.js:435` region) — not from `applyTabs`, not from `switchTab`, and
   not duplicated per caller. Both editions.
2. It runs only when ALL of these hold: the tab has a `session_id`, its render target has no
   child rows, and it has not already been attempted for that tab this page load (a module-level
   `Set`, so a park/replace cycle cannot re-fetch).
3. It reuses `renderInto`-equivalent rendering through `renderInTab`, so the target is resolved
   AFTER the await — a tab parked or closed while the fetch is out must not paint into whatever
   is on screen. This rule already has a comment on it in `chrome.js`; do not weaken it.
4. `resumedNote` is false: this is a repaint of what the user was already looking at, not a
   fresh resume, and «گفتگو از سر گرفته شد» must not appear on every reload.
5. A fetch that fails, or answers with zero events, leaves the cell exactly as it is today —
   blank view and greeting. No error bubble: this is best-effort chrome on a path the user did
   not ask for.
6. A brand-new conversation with no history is not a special case — it takes the same path and
   paints nothing.
7. `chrome.js:1060`'s already-open short-circuit stays as it is. It is correct; the missing
   backfill was the bug, and fixing it there instead would fix one caller and leave boot broken.

## Verify

- New free gate, or an extension of an existing one — your call, but it must be an END-TO-END
  reload, not a unit stub. Boot the server, open a real existing session from disk with
  `/api/session/resume` (measured free: an idle `--resume` emits no inference-shaped events and
  costs no tokens — `wiki/cli-stream-json-findings.md`), assert the log has rows, then load the
  page a SECOND time against the same server and assert the log has rows again and the greeting
  is hidden. Negative-test it: stub out the backfill and confirm the new assertion fails.
- `python run_spec_test.py` → 207/207, `PCG_UI=terminal python run_spec_test.py` → 174/174.
- `python test_split.py`, `python test_layout.py` and `PCG_UI=terminal python test_layout.py`.
- Report ≤ 20 lines.

## Out of scope

Publishing history into the hub server-side. It would work, but it duplicates the transcript into
memory for every resumed tab and makes the hub the owner of something the disk already owns.
Do not do it here.
