# Background agents — the measured CLI contract

Measured 2026-08-09 against the real transcript of CLI 2.1.226 session
`18e44a29-e168-402f-b150-c8bc7c3ebfdc` (project `D:\Project\GameNet`), which launched five
background agents. Version-pinned; re-verify after a CLI upgrade. This is the data source for the
GUI's agents panel («عامل‌های پس‌زمینه»), the per-agent transcript view, and the
task-notification card.

## The lifecycle, as recorded on disk

1. **Launch** — an ordinary `assistant` event with a `tool_use` named `Agent`. Input:
   `{description, prompt, subagent_type?, model?, run_in_background?}`. `run_in_background`
   may be absent (background is the default on this build); synchronous agents say `false`
   explicitly.

2. **Launch ack** — the `tool_result` for that id arrives immediately (a `user` event, so it
   *does* stream live — same path every tool card's result takes). Two data sources on it:
   - The transcript event carries a sibling field
     `toolUseResult: {isAsync: true, status: "async_launched", agentId, description,
     resolvedModel, prompt}`.
   - The `tool_result` **text** also contains `agentId: <hex>` and `output_file: <path>` —
     parse this as the fallback; it is what streams.
   A *synchronous* agent's tool_result is simply the final report text — no ack, no agentId.

3. **Completion** — a **`<task-notification>`** block, appearing twice in the main transcript:
   once as a `{"type":"queue-operation","operation":"enqueue","content":"<task-notification>…"}`
   record at the moment the agent finished, then as a real `user` message (bare-string content)
   when the CLI auto-submits it. Tags: `<task-id>`, `<tool-use-id>`, `<output-file>`,
   `<status>completed</status>`, `<summary>Agent "…" finished</summary>`, `<note>`, and
   `<result>…full final text…</result>`. **XML entities are escaped** in the content
   (`&amp;`, `&lt;`, `&gt;`) — unescape before rendering. The `<note>` warns the same task-id
   can notify more than once (the user can resume a finished agent).

4. **Background shell commands notify the same way** — `Bash` with `run_in_background` gets a
   short task-id (e.g. `bee6nhpbd`), and its notification has a `<summary>` like
   `Background command "…" completed (exit code 0)` and **no `<result>`**. No meta.json, no
   subagent transcript — do not offer a transcript view for these.

## Per-agent files on disk

Next to the main transcript, `<transcript-dir>\<session-id>\subagents\` holds, per agent:

- `agent-<agentId>.meta.json` — `{agentType, description, toolUseId, spawnDepth, model,
  worktreePath?, spawnedWithWorktree?, worktreeBranch?}`. `toolUseId` is the join key back to
  the `Agent` tool_use row; `model` is the short name (`"opus"`) while the ack's
  `resolvedModel` is the full id.
- `agent-<agentId>.jsonl` — the agent's full transcript, **same record format as the main
  transcript** (every line has `isSidechain: true` and `agentId`), written live while the agent
  runs. This is what powers the per-agent view; the existing renderer replays it. A *running*
  agent's file just ends mid-work — there is **no terminal record** to detect completion from;
  completion comes only from the main transcript's task-notification.
- Workflow runs are different: they nest under `subagents\workflows\wf_<id>\agent-*.jsonl`
  plus a `journal.jsonl`. Out of scope for the agents panel (Workflow is deliberately not
  surfaced in the GUI — see control-protocol.md §8).

The `output_file` path in the ack (`…\Temp\claude\<proj>\<session>\tasks\<id>.output`) is the
same JSONL content in the scratch tasks dir; prefer the durable `subagents\` copy.

## What is NOT verified about the live stream

**Partially answered 2026-08-09, measured through the wrapper in `-p` mode (2.1.226):** the CLI
**does write the `queue-operation` task-notification to the transcript the moment a background
agent finishes, with no further turn on stdin** — the wrapper's disk-derived registry flipped a
live agent from `running` to `completed` while the CLI sat idle after its `result`. What remains
unmeasured is only whether the notification/`turn_duration` also appear on **stdout**; the
session the original contract came from ran the interactive TUI. Consequence, and the design rule:
**derive all agent state from the main transcript file on disk**, which the CLI demonstrably
writes at launch time and at notification time. The wrapper already knows `transcript_path()`;
tailing that file is deterministic for live *and* replay, and owes nothing to stdout behavior.
The launch ack does stream (it is an ordinary tool_result), but treating the transcript as the
one source keeps a single parser.

## Orphan detection: `live` alone cannot tell a running agent from a dead one

`--resume` keeps `session_id` stable across a kill (see sessions-and-history.md), so a background
agent that died with a killed CLI process — no `<task-notification>` is ever written for it, since
nothing survived to write one — reports `running` forever once `--resume` makes the session `live`
again. Fixed by recording the live process's own spawn time (`ClaudeSession.spawned_at`, set at the
one place a new OS process is actually created — inside `start()`, right after `Popen(...)`, so
`restart()` picks it up too since it calls `stop()` then `start()`) and comparing it against the
agent's own ack timestamp (`startedAt`) in `_agent_status()`: an ack from before the current
process's `spawned_at` belongs to a dead prior incarnation and reports `stopped`, not `running`,
regardless of `live`. An entry with no parseable `startedAt` gets the benefit of the doubt rather
than being assumed orphaned.

## Sort/mtime footgun

The tail-poll reads the transcript the CLI is actively appending to. `_sessions_in` sorts on
content timestamps, not st_mtime (see sessions-and-history.md), so polling does not disturb the
sidebar — but any future code that writes to the transcript folder must not, either.
