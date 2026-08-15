# Handoff — 2026-08-15 (evening)

## Where we are

Branch `rework/phases-0-3`, everything still **uncommitted**: the tabs/multi-session rework,
the idle-hint feature, and — new this session — **all 10 review defects fixed and their beads
closed** (`pcg-14c` epic + `.1`–`.10`, `bd list --tree`). Every gate is green:

- `test_units.py` — PASS (incl. ~25 new checks: close_tab deny-before-drop, in-flight counter,
  tab-less `/api/projects`, MAX_TABS race over real HTTP)
- `run_spec_test.py` — **PASS — 103/103** (94 → +3 agents-history, +6 tab-lifecycle guards)
- `test_transcript_path.py`, `test_no_console.py` — PASS
- `smoke_test.py` — **PASS 15/15** (the one paid turn; run 2026-08-15 after the fixes)

## DONE this session

Three parallel agents off the specs in `TASKS.md` §"2026-08-15 batch" (R1/R2/R3):

1. **R1 server** — `PermissionBroker.deny_all()` + close_tab order (deny → stop → `wrapper/closed`
   → `hub.drop`); busy boolean → in-flight counter (increment before `_write_line`, clamp at 0,
   hard reset on start/cli-exit/interrupt); `/api/projects` serves tab-less; `_SESSIONS_LOCK`
   with the MAX_TABS cap inside `open_tab` (slot reserved under lock, spawn outside).
2. **R2 frontend** — `renderInTab(tab, fn)` seam: replay/resume render into the tab they belong
   to, never the global `#log`; `wrapper/closed` clears that tab's permission queue/dialog;
   blank view disables the composer with an explanatory placeholder («برای شروع، گفتگویی باز
   کنید»); `/api/tabs` snapshots add-never-delete (prune only on `wrapper/closed`);
   Persian rename via `<bdi dir="auto">` `.tab-proj`, not `pathEl`; `clearPulse(scope)` at the
   tab-drop choke point. Negative-tested (fixes reverted in batches → exactly the new guards fail).
3. **R3 agents strip** — «عامل‌های پیشین (N)» toggle: finished agents reachable again, strip
   stays running-only by default.
4. Wiki updated: `frontend-modules.md` §"Tab lifecycle rules" (renderInTab, add-never-delete,
   drop choke point, `.tab-proj` is a name) and `permission-transport.md` §"Closing a tab denies
   its pending requests" (incl. the deliberate AskUserQuestion deny-on-close deviation).

## REMAINING — in order

1. **Commit — user approval required** (conservative profile). Suggested shape: one commit for
   the idle hint, one for the tabs rework + review fixes (or split rework/fixes if preferred).
2. M8 acceptance on the colleague's PC (see CLAUDE.md — cannot be done from this machine).

## Hard-won facts not written anywhere else

- Known accepted trade (recorded in wiki too): a tab the server forgets **without** emitting
  `wrapper/closed` (server restart under the same window) lingers in the sidebar until reload.
- The MAX_TABS race only reproduces through real HTTP (~60% per run against the old code) — the
  GIL hides it when calling `open_tab` directly; probe at
  `scratchpad\race_probe.py` (session temp dir, may not survive).
- R1's spec run can show `FAIL — 100/103` if run against a half-landed static/ tree — the three
  client-half guards need R2's files; a re-run on the full tree passes.
