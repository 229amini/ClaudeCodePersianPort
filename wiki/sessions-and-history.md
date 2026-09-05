# Sessions, history replay, folder picker (M5)

Built and verified 2026-08-04 against `claude` 2.1.221.

## The sidebar cannot sort on st_mtime (2026-08-08)

Clicking a session made it jump to the top of the list before a word was exchanged. Cause: the CLI
rewrites a transcript **at spawn** — `mode`, `attachment` and `file-history-snapshot` lines go in
immediately, and any `SessionStart` hook adds an `isMeta` `user` line on top — so `st_mtime` moves
the instant you open one. Opening was indistinguishable from talking.

`session_meta()` now returns a third value: the timestamp of the last `user`/`assistant` line that
is **not** `isMeta` — the one thing an open cannot fabricate. `_sessions_in` sorts on that and falls
back to mtime only for a transcript with no message in it at all. The «۲ ساعت پیش» label rides the
same field, so it got more honest for free.

Measured here: transcripts whose last real message was 6–12 hours old were carrying an mtime from
minutes ago. Guarded by `test_units.py` (free) with the exact spawn-line shapes.

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

## `user` content has TWO shapes, and one of them is mostly not the user (2026-08-05)

The paragraph above was measured against transcripts the **wrapper** wrote, and it is only half
the story. Measured again while building the sidebar's hover preview:

| written by | `message.content` |
|---|---|
| the wrapper (stream-json in) | `[{"type":"text", ...}]` |
| the interactive CLI (a person typing in the TUI) | a bare **string** |

Both kinds sit side by side in one project folder, because the sidebar lists every transcript the
CLI ever wrote for that cwd — not just ours. The array-only code therefore failed **silently** in
two places at once: `session_meta()` returned no preview (those rows fell back to an 8-char id),
and `renderEvent`'s `for (const part of content)` iterated the string **character by character**,
each character's `.type` undefined, so every one of those sessions replayed as a monologue. No
error, no console warning, in either.

Worse, the bare string is frequently **not a prompt at all**. The interactive CLI injects its own
envelopes as `user` turns — `<local-command-caveat>`, `<command-name>`, `<system-reminder>`. Fixing
only the shape made every such session's title read
`<local-command-caveat>Caveat: The messages below we…`, which is how the screenshot caught it.

Both are handled in **one** place, `user_prompt_text()` in `server.py`, used by `session_meta()`
(titles/previews) and by `read_session()`, which now **normalises** a bare string into the block
shape before it leaves the server and drops the envelopes entirely. That keeps §B-4's "one
renderer, two sources" true — the client still sees exactly one shape — and it means the filter
applies to replay, to the sidebar and to the hover preview from a single edit. Do not re-add a
client-side shape check; there is nothing left for it to catch.

The envelope test is `^\s*<[a-z][a-z-]+>`. A real prompt that opens with an HTML tag would be
skipped in favour of the next one — an acceptable trade for this audience.

## Restart semantics — replaced by tabs (2026-08-14)

`ClaudeSession.restart()` is **gone**. Switching project and resuming a session used to stop the
one CLI and start another in its place; both now open a tab of their own (below) and everything
already running keeps running. Killing the conversation to make room for another one was the
defect, not the mechanism.

One thing that survived and is still easy to get wrong:

- **Generation counter.** A stopped process's reader threads keep draining a dying pipe. Without
  the `_generation` check their events leak into whatever comes next. Each reader captures the
  generation it was started with and drops anything published after a swap.

## N conversations at once: the tab model (2026-08-14)

The server runs up to `MAX_TABS = 6` long-lived `claude` processes. A **tab** is the wrapper's
own `uuid4().hex`, minted at spawn — **not** the CLI's `session_id`, which is `None` until the
first turn completes and therefore cannot route the events of a conversation the user just
opened.

**Every SSE event carries `"tab"`**, `system/*` included: `TabHub` is a two-method view over the
Hub (`publish` stamps, `reset` scopes) held by the `ClaudeSession` and its `PermissionBroker`, so
all ~16 publish sites tag without knowing tabs exist. `Hub._history` is bucketed by tab, capped
per bucket, and a closed tab's bucket is dropped **and** blacklisted — a stopped session's reader
thread publishes `wrapper/cli_exited` milliseconds later and would otherwise re-create the bucket
it just deleted, which then replays to every window for the life of the server.

| endpoint | shape |
|---|---|
| `GET /api/tabs` | `{active, tabs:[{tab, session_id, cwd, busy, spawned_at}]}`, spawn order |
| `POST /api/tab/activate {tab}` | `{ok, active}` or 404 |
| `POST /api/tab/close {tab}` | `{ok, active}` — `""` when none is left |
| `POST /api/project/open {path}` | `{cwd, tab, recents}`; **409** `{"error":"too many tabs","max_tabs":6}` at the cap |
| `POST /api/session/resume {session_id, path?}` | `{ok, tab, adopted, session_id}` |

`adopted: true` means that session was **already live in a tab** — resuming it a second time
would leave two CLI processes appending to one `.jsonl`, which is corruption, so the server just
makes that tab active and the window only has to switch to it. Every session-scoped endpoint
takes an optional `tab` (body key or query param) and defaults to the **active** one, which is
what keeps `smoke_test.py` and every tab-less caller working unchanged.

Closing a tab publishes `wrapper/cli_exited` then `wrapper/closed`, both tagged.

**`wrapper/reset` no longer has a production publisher.** Clearing is structural: each tab owns
its own detached transcript node, and a new chat is a new tab, so there is nothing to clear. The
render path stays (the event is still in the protocol, and the spec harness drives it) and is
scoped to the tab it names. Do not re-introduce a client-side "reset means new session" rule —
the session swap now IS the tab swap.

### The window half (static/js/app.js)

`tabs: Map(tab → {node, scope, chrome})` plus `activeTab`. An event whose `tab` is missing or is
the active one renders exactly as before; anything else goes through
`withRenderTarget(entry.node, entry.scope, …)` — the same seam the agents drawer replays through.
Entries are created **lazily** by the first event that names them: `/api/tabs` cannot answer
before the stream starts, and dropping those events would lose the opening of a conversation.

The one rule that makes it safe: a background scope carries `background: true`, and every call in
`render.js` that repaints the **window** rather than the transcript is gated on it —
`setChrome`, `refreshProjects`, `refreshAgents`, the statusline paint, `setBusy`, the model /
effort / output-style / posture chips, the auto-approve counter, the context notice. Their values
are parked in `scope.chrome` (last-write-wins per key; the auto-approval list is the one thing
that accumulates) and applied by `applySwitch()` when the user switches to that tab. What is NOT
gated: `showPermission` / `dismissPermission` — one modal FIFO serves every tab, and the dialog
names the asking conversation when it is not the visible one.

A switch is: `POST /api/tab/activate` → park the outgoing tab (its `#log` children move into its
node, its scope and a controls+composer snapshot are taken) → restore the incoming one
(children into `#log`, scope into the render state, snapshot into the chips, then the parked
deltas on top). The restore is deliberately **total** — every chip is painted from that
conversation's own data or from nothing. Partial restore is this project's oldest defect family
(«state that belongs to one session surviving into the next»), and with six live conversations it
would be the norm rather than the exception.

The composer's **draft text and attachments stay global**: there is one box, and a half-typed
message belongs to the person, not to the session.

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

"New chat" is not an endpoint — it is `POST /api/project/open` with the current cwd. Since the
tabs work (below) that **spawns one more conversation** instead of restarting the only one, and
the response carries the new `tab`.

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

## Pin, and «باز کردن پوشه پروژه» (2026-08-08)

Two items the user asked for after comparing the sidebar against Claude Code desktop's project menu.

**Pin is `archived.json` again.** `pinned.json` is the same path-list file, written through the same
`toggle_in_list()` both toggles now share, and the only thing that knows the difference is the sort
in `list_projects()`: `(not pinned, -modified)` — one key, because `modified` is a float and
negating it reverses only that half. `drop_project_from_lists()` sweeps all three files; it named
two before, so a removed project would have come back pinned the next time it was opened. Guarded
in `test_units.py`, which is where the case-insensitive matching is actually checked — every one of
these paths arrives from Windows in whatever case Windows felt like.

The sidebar shows a muted pin glyph on a pinned row. Not decoration: without it the sort looks like
a bug the first time a pinned project outranks one used five minutes ago.

**`/api/project/reveal` is the one endpoint that hands a string to the Windows shell.**
`os.startfile()` is deliberate — it is what a double-click does, so the user's own file manager
opens rather than a hardcoded `explorer.exe`. The guard is `is_dir()`, and it is load-bearing:
`startfile` on a FILE runs whatever is associated with it. Refusal of a file, a missing folder and
an empty path is proven, and so is the success branch — this repo has already been bitten twice by
install branches that were never executed anywhere (`wiki/packaging.md`).

**«Create permanent worktree» and «Edit project» were deliberately not built.** The audience is a
non-technical Persian speaker who must never touch a terminal; a git worktree has no meaning for
them, and there is nothing about a project to edit here — the folder IS the project.

**`isMeta: true` means "the CLI talking to itself" — replay drops it wholesale (2026-08-09).**
The sort logic above already treated `isMeta` as not-real-activity; `read_session` now applies the
same flag to replay, because the envelope filter alone was never enough: a skill load injects the
ENTIRE SKILL.md as an `isMeta` user message with **block-shaped** content, which the bare-string
envelope filter never saw, and it replayed as a user bubble the length of a document (bead
pcg-e5q). The CLI's own UI never displays `isMeta` messages — that is what the flag is for. The
one bare-string user message that must survive replay, `<task-notification>` (carries no `isMeta`
key), is special-cased before the envelope filter — see `_normalize_transcript_event()` and
wiki/background-agents.md.

**The live stream spells that flag `isSynthetic`, and sends no `isMeta` at all (2026-08-10).**
The fix above covered replay only, so a `/skill` invocation still dumped the entire SKILL.md into
the LIVE transcript as a user bubble the length of a document — the same defect, on the other
source. Read out of the 2.1.223 binary, every stream-json `user` event is built as:

```js
{type:"user", message, parent_tool_use_id, session_id, uuid, timestamp,
 isSynthetic: y6t(msg), tool_use_result, ...}
function y6t(e){ return e.isMeta || e.isVisibleInTranscriptOnly || e.isCompactSummary || void 0 }
```

So `isSynthetic` is the union of three transcript flags and is the only one of the four names that
ever reaches stdout. `render.js` now drops `ev.isMeta || ev.isSynthetic` at its one `user` case,
which covers both sources through the single renderer (plan §B-4) — do not add a second filter in
`server.py`'s live path. `<task-notification>`, the one injected `user` message that MUST render,
sets none of the three (checked across every transcript on this machine); it carries
`origin: {kind: "task-notification"}` instead. Guarded in the spec harness.

## Shell rows in replay (measured 2026-09-05, code-review F6)

A `!` command produces **two** kinds of `user` record, and only one of them replays.

- The CLI's own two records (`<bash-input>…</bash-input>` and the stdout/stderr pair) have
  **bare-string** content and `user_prompt_text()` drops both through `CLI_ENVELOPE_RE` —
  correct for a chat bubble, wrong for a shell row. A session started in the real TUI
  therefore replays with no shell rows at all. Open bead `pcg-5g2`; the fix is server-side.
- The wrapper's parked block (`bash_message` + `park_context`) is **block-shaped**, so it
  passes the filter and arrives as user text:
  `{"type":"user","message":{"content":"<bash-stdout>ok</bash-stdout><bash-stderr></bash-stderr>"}}`
  Before the fix both editions rendered that literally, tags and all, in the next bubble.
  `splitBashBlocks()` in each `render.js` `user` branch now peels those blocks off and draws
  them through the same `renderShell()` the live `wrapper/shell` event uses; the transcript
  carries no exit code, so a replayed row reads `code: 0`. Guarded in the web spec and
  `test_column.py`.

Live view and replay converge for wrapper-run commands only. Do not "fix" the TUI case by
loosening `CLI_ENVELOPE_RE` — that is what keeps the CLI talking to itself out of the sidebar
(§"user content arrives in two shapes").
