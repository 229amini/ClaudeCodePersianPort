# MA2 — open a session in its own git worktree (`--worktree`), both editions
Agent: builder
Files: `persian-claude-gui/server.py` (`ClaudeSession.start` ~2128/2171, `open_tab` ~3108,
`/api/project/open` ~3747, `/api/session/resume` ~3839, `/api/projects` + `_sessions_in`
~458, `/api/tabs` ~3171, `transcript_path()`), both editions' sidebar/tab-strip modules and
`strings.fa.js`, `test_units.py`, new `test_worktree.py`.

Measured facts (2026-09-06, CLI 2.1.263, free probe): `claude -p … --worktree <name>` works in
stream-json mode; the worktree is created **at spawn, before `initialize`**, at
`<cwd>/.claude/worktrees/<name>` on branch `worktree-<name>`, git-locked
`claude session <name> (pid N)`; a second spawn with the same name reuses it silently; the
session's transcript lands under `~/.claude/projects/<sanitized WORKTREE path>/`, NOT under the
repo's folder. `--name` echoes nowhere (not on the wire, not on disk) — do not use it.

Spec:
1. Server: `open_tab(cwd, resume_id, fork_id, worktree=None)`. When `worktree` is a non-empty
   name matching `^[A-Za-z0-9_-]{1,40}$`, append `--worktree <name>` to the spawn args; the
   process cwd stays the repo. The session records `worktree_cwd = <cwd>/.claude/worktrees/<name>`
   and every transcript lookup for that tab (`transcript_path`, `session_meta`, title read-back,
   resume) uses `worktree_cwd or cwd`. Refuse (400, Persian message via the existing error path)
   when `<cwd>/.git` does not exist. `/api/project/open` and `/api/session/resume` accept an
   optional `worktree` body field; `/api/tabs` entries gain `worktree: name|null`.
2. `/api/projects`: a project folder whose real path contains `/.claude/worktrees/<name>` is NOT
   a top-level project. Fold its sessions into the parent repo's session list with
   `worktree: name` on each entry (the parent is the path prefix before `/.claude/worktrees/`).
   A worktree whose parent is not itself listed is dropped. Resume of such a session passes its
   `worktree` name back through (`--resume id` + `--worktree name` — measured to reuse).
3. Auto-naming: when the client sends `worktree: "auto"`, the server picks `agent-<n>` with the
   smallest `n ≥ 1` such that `<cwd>/.claude/worktrees/agent-<n>` does not exist. No name prompt
   for the user.
4. UI, both editions, in each edition's own look: wherever a project offers «گفتگوی جدید»
   (sidebar project row / home action card / kebab — find the existing entry points), add one
   sibling action «گفتگوی جدید در شاخهٔ جدا» shown only when the project has `.git`
   (`/api/projects` entries gain `git: bool`). It calls `/api/project/open` with
   `worktree: "auto"`. A tab / sidebar row that belongs to a worktree shows an LTR `<bdi>` chip
   `⎇ agent-2` after the title (`.path` discipline — `wiki/rtl-rendering-notes.md`). No other UI.
5. Strings via each edition's `strings.fa.js`; terminal edition keys must pass `test_strings.py`.
6. `test_units.py`: spawn-arg construction with/without `worktree`; the `/api/projects` folding
   (fixture paths, no CLI); the name regex refusals. New `test_worktree.py` (free,
   login-independent, spawns the real CLI once like `probe_queue.py`): scratch git repo in the
   scratchpad → `POST /api/project/open {cwd, worktree:"auto"}` → `/api/tabs` shows
   `worktree:"agent-1"` → `<repo>/.claude/worktrees/agent-1/.git` exists → `/api/projects` lists
   the repo once and not the worktree path → cleanup (`git worktree remove --force`, delete the
   scratch `~/.claude/projects/*scratchpad*` folders it created). Hold an SSE connection open or
   the idle watchdog kills the server (`wiki/dev-environment.md`).

Context: step 2 of epic `pcg-6nf`. This is what lets 2–4 agents work on one repo without
overwriting each other (the CLI's own mechanism, chosen over anything hand-rolled). Read
`wiki/sessions-and-history.md` (transcript path resolution, `session_meta`, the sort rule) and
`wiki/cli-stream-json-findings.md` before touching spawn args. Worktree removal on close is out
of scope — the CLI owns the lock; note it in the MA5 docs task, not here. Ponytail: no new
module for the folding; a helper next to `_sessions_in` is enough.

Acceptance:
- `python persian-claude-gui\test_units.py` → PASS with the new cases (name them in the report).
- `python persian-claude-gui\test_worktree.py` → PASS, `total_cost_usd` never printed non-zero
  (no paid turn).
- `python persian-claude-gui\test_transcript_path.py` → PASS (traversal guard still holds with
  `worktree_cwd`).
- `run_spec_test.py` web and terminal, `test_layout.py` both, terminal `test_dialogs.py`,
  `test_strings.py`, `test_shell.py`, `test_keys.py` → PASS at their current counts or higher.
- A non-git folder: `POST /api/project/open {worktree:"auto"}` → 400.

Verify: `$env:PYTHONIOENCODING='utf-8'`; commands above from `D:\projects\Claude`.

Report: ≤ 25 lines: outcome, files, verify output lines, deviations.

Out of scope: status dots (MA1, running in parallel — do not touch `.tab-dot`/`.sess-dot`
painting; if you must edit the same row-render function, add your chip in a separate statement
so the merge is trivial), the split grid (MA3/MA4), help.html (MA5).
