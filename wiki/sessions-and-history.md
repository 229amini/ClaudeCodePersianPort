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

## Testing gotcha

The idle watchdog kills the server ~10 s after the last SSE client disconnects. An API-only test
script gets `ConnectionRefusedError` partway through for that reason — it is the shutdown feature
working, not a bug. `m5_api_test.py` holds an SSE connection open in a background thread, which is
also a more faithful simulation of a real window.
