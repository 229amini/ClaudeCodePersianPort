# Sessions, history replay, folder picker (M5)

Built and verified 2026-08-04 against `claude` 2.1.221.

## B-9.8 — `--resume` after a kill: PASS

Spiked before building anything on it. Turn 1 told the CLI a codeword and the process was
**killed** (not a clean stdin close). A fresh process with `--resume <session_id>` recalled it:

```
turn 1 session: b784be62-…   result 'OK'
turn 2 session: b784be62-…   result 'ZANBAGH'
context carried across kill+resume : True
session_id preserved by --resume   : True
```

**`--resume` reuses the same `session_id` rather than forking** (forking is what `--fork-session`
is for). Recovery is therefore idempotent — resuming twice cannot fan out into sibling sessions.
Verified again through the wrapper: after `/api/session/resume`, the model correctly listed all
four files from the earlier conversation, including the one whose Write had been denied.

## Where transcripts live

`~/.claude/projects/<sanitized-cwd>/<session_id>.jsonl`

The folder name is the cwd with `:` and `\` both replaced by `-`, so
`C:\Users\ladyg\Desktop\Claude` → `C--Users-ladyg-Desktop-Claude`. That rule is **observed, not
documented**, so `transcript_dir()` falls back to scanning every project folder and matching the
`cwd` field recorded inside the transcripts. Keep the fallback; it is what stops history silently
breaking if the naming scheme changes.

## The transcript is not the event stream

`.jsonl` lines carry more types than the live stream. Measured on a 47-line transcript:

| type | count | replay? |
|---|---|---|
| `assistant` | 13 | yes |
| `attachment` | 12 | no |
| `user` | 10 | yes |
| `queue-operation` | 10 | no |
| `last-prompt` | 2 | no |

`user` and `assistant` lines carry the **same `message` shape as live stream events**, which is
what makes plan §B-4's "one renderer, two sources" actually hold — `read_session()` filters to
those two types and the window feeds them straight into `renderEvent`. Also filter
`isSidechain: true` (subagent turns) or replay interleaves confusingly.

## The seam that bit: replayed user turns

Live, the CLI does **not** echo the user's own prompt back (we do not pass
`--replay-user-messages`), so the wrapper emits its own `wrapper/user_echo`. In a transcript the
user's turns *are* present, as `user` events with `text` parts. The renderer originally handled
only `tool_result` on the `user` channel, so replay showed 6 assistant bubbles and **zero** user
bubbles — the conversation looked like a monologue. `renderEvent`'s `user` case now handles both
part types. Any future change to either path has to keep both working.

## Restart semantics

`ClaudeSession.restart()` backs both "switch project" and "resume session": stop, optionally
change cwd, `hub.reset()`, start with `--resume` if given.

Two things that are easy to get wrong:

- **Generation counter.** The old process's reader threads keep draining a dying pipe after a
  restart. Without the `_generation` check their events leak into the new conversation. Each
  reader captures the generation it was started with and drops anything published after a swap.
- **`hub.reset()` clears replay history and broadcasts `wrapper/reset`.** The Hub replays its
  history to every new SSE client so a reconnecting window is not blank — which means without the
  reset, switching projects would show the previous project's conversation to any reconnect.

## Folder picker

`tkinter.filedialog.askdirectory` runs in a **child process**, not in the server. tkinter wants to
own its thread's event loop and this server is threaded, so running it in-process is a reliable
way to deadlock. A throwaway child cannot take the server down with it. tkinter 8.6 ships with the
python.org 3.12.10 install used here.

`askdirectory` returns **forward slashes even on Windows**; `Path()` normalises them before the
path reaches the UI or the CLI.

Recents live in `persian-claude-gui/recents.json`, capped at 10, most-recent-first,
case-insensitively de-duplicated.

## Deleting a session (added 2026-08-04)

`POST /api/session/delete {session_id}` unlinks the transcript. Three things it must keep doing:

- **Refuse the live session** (409). The running CLI keeps writing its own transcript; deleting it
  underneath leaves a session that exists in memory but not on disk, and `--resume` on it fails.
  The window also just omits the delete button on the current row, but the server check is the
  real guard — the row is stale the moment the id is adopted.
- **Route through `transcript_path()`.** That helper is the single choke point for the traversal
  guard, shared with `read_session()`. Before delete existed a bypass only leaked a file's
  contents; now it would unlink an arbitrary path. `test_transcript_path.py` is the check.
- **Deletion is permanent** — no trash, no undo. Hence the two-click confirm in the dialog
  (`ghost` → `danger` + «مطمئنید؟») instead of a native `confirm()`, which would render LTR in
  browser chrome and sit outside the RTL discipline.

The dialog refreshes by calling `openSessions()` again, so it must stay re-entrant:
`showModal()` on an already-open `<dialog>` throws `InvalidStateError`, which is why the call is
guarded with `if (!ui.dialog.open)`.

## Sidebar endpoints (added with the claude.ai-style shell, 2026-08-05)

- **`GET /api/projects`** — one round-trip for the whole sidebar: every project the CLI has
  transcripts for (real cwd read from inside the transcripts, never un-mangled from the folder
  name) plus recents, each with its sessions inline. Projects whose folder no longer exists are
  dropped. The current cwd is always present, prepended if unknown.
- **`GET /api/session?id=…&cwd=…`** — optional `cwd` lets the sidebar replay sessions from any
  project. A bogus cwd yields an empty event list, not an error.
- **`POST /api/session/resume {session_id, path?}`** — optional `path` switches cwd and resumes
  in ONE `restart()`, not two process spawns. Same-folder path is ignored. Verified end-to-end:
  clicking a session under another project switches cwd, replays, updates chrome.
- **`POST /api/session/delete {session_id, path?}`** — optional `path` for cross-project delete.
  The traversal guard is still `transcript_path()`; the live-session 409 still applies.

"New chat" is not an endpoint — it is `POST /api/project/open` with the current cwd (fresh
process → fresh session id → `wrapper/reset` clears the view → the home state reappears).

Project-level actions (added 2026-08-05):

- **`POST /api/project/archive {path, archived}`** — toggles membership in
  `persian-claude-gui/archived.json`. Transcripts untouched; the sidebar shows archived
  projects under a collapsed «بایگانی» section with an unarchive action. The currently open
  project always renders as active even if flagged.
- **`POST /api/project/remove {path}`** — `shutil.rmtree` on the project's transcript folder
  (always a child of `~/.claude/projects/` by construction) + drops it from recents and
  archived. **Never touches the project folder itself.** Refuses the currently open project
  (409) for the same reason session delete refuses the live session.

## Testing gotcha

The idle watchdog kills the server ~10 s after the last SSE client disconnects. An API-only test
script gets `ConnectionRefusedError` partway through for that reason — it is the shutdown feature
working, not a bug. `m5_api_test.py` holds an SSE connection open in a background thread, which is
also a more faithful simulation of a real window.
