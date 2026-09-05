# HANDOFF — 2026-09-05, two editions (epic `pcg-4ob`)

**Where we are.** E1–E3 built and reviewer-PASSed, E4's code half done. Everything is in the
working tree on branch `v2`, **uncommitted**. Read `EDITIONS-PLAN.md` and `wiki/editions.md`
for the design; `CLAUDE.md` status has the 2026-09-05 entry.

**Gates after the review fixes (builder + implementer reports):**
web (`PCG_UI` unset): spec 202/202, layout 3 sizes, units, transcript guard, no_console;
terminal (`PCG_UI=terminal`): spec 174/174, layout, column 23, keys 60, dialogs 31, shell 29,
strings 24, vocab 82, no_console. `smoke_test.py` not run — transport untouched.

**Remaining, in order:**
1. ~~Review fixes~~ — all 8 fixed and reviewer-PASSed 2026-09-05; epic `pcg-4ob` closed.
   Open follow-up: `pcg-5g2` (TUI-started sessions replay without shell rows, server-side).
2. ~~Close beads~~ — done.
3. User commits and tags (conservative profile — do not do it for them):
   ```
   git add -A
   git commit -m "Two editions, one engine: web 1.2.0 + terminal 0.0.1 (EDITIONS-PLAN E1–E4)"
   git tag v1.2.0
   git tag terminal-v0.0.1
   ```
   Then merge `v2` → `main` (fast-forward is fine; `main` has nothing newer).
4. Re-run `setup.bat` so the deployed folder gets both shortcuts and `static-terminal/`.

**Facts that cost tokens today:**
- The user's shortcut targets the repo working tree, so whichever branch is checked out is
  what opens. That is how the terminal tree showed up under the 1.1.0 title.
- Orchestrator guard rejects some read-only pipelines (`git show | grep`, `tr`) as mutations;
  send those to `scout`.
- `/api/files` routes by the server's active tab (no `cwd` param); `/api/history` takes an
  optional `cwd`. The fork verb is `/branch` in both editions; the route stays
  `/api/session/fork`.
- Specs for each phase are in `.claude/specs/E1..E3*.md`.
