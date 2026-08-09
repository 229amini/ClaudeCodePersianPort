# Handoff — 2026-08-09, usage cap hit (resets 07:10 Tehran)

## Where we are

The **background-agents feature is landed and verified** (bead `pcg-70f`, closed) plus the
**isMeta skill-flood fix** (`pcg-e5q`, closed). Everything is in the working tree,
**uncommitted**, on branch `rework/phases-0-3` — the diff also still contains earlier
uncommitted work that predates this session.

Built by two delegated agents (Sonnet: server, Opus: frontend) to the measured contract in
`wiki/background-agents.md` — read that first; it is the whole CLI contract (launch ack,
`<task-notification>`, `subagents/agent-*.jsonl` + meta.json, and why agent state must come
from the transcript file, never the stdout stream).

What exists now:

- `server.py`: `build_agent_registry()` (incremental byte-offset cache + lock),
  `GET /api/agents?id=&cwd=` and `GET /api/agent?id=&agent=&after=&cwd=` (conventions mirror
  `/api/session`; epoch-float timestamps), `agent_file_path()` traversal guard,
  `_normalize_transcript_event()` shared by session and agent replay, `read_session` drops
  `isMeta` and passes `<task-notification>` through (it must jump `user_prompt_text` — the
  envelope regex would eat it).
- `static/js/agents.js` (new): strip above composer, per-agent drawer (popover), 3 s poll while
  running, full teardown on wrapper `reset`. `render.js`: Agent rows named by description,
  «عامل در پس‌زمینه اجرا شد» instead of the internal ack text, task-notification completion
  cards, and the `newRenderScope()`/`withRenderTarget()` seam so the drawer replays through the
  ONE renderer without colliding with `state.toolCards`.

## Verified (all re-run independently, not just agent-claimed)

- `C:\Python314\python.exe persian-claude-gui\test_units.py` → 63/63 PASS
- `C:\Python314\python.exe persian-claude-gui\run_spec_test.py` → **PASS — 64/64**, exit 0
- `C:\Python314\python.exe persian-claude-gui\test_transcript_path.py` → PASS
- Live E2E against real history (`D:\Project\GameNet`, session `18e44a29-…`): 11 background
  tasks listed (8 agents enriched from meta.json + 3 commands), 366-event agent replay with
  stable `after`/`next`, traversal + bogus-session + bad-token all reject. Script:
  scratchpad `e2e_agents.py` of session `05888798-b356-47fc-8f23-ce6a27a58b61` (throwaway;
  boots server, sends no CLI turn, free).

## REMAINING — in order

1. **The final xhigh review pass never ran** (bead `pcg-eja`): all 7 finder agents died on the
   usage cap, so the workflow's "no findings" is meaningless. After reset, either re-run
   `/code-review xhigh` on the diff, or resume the cached workflow:
   `Workflow({scriptPath: "C:\Users\Lion\.claude\projects\D--projects-Claude\05888798-b356-47fc-8f23-ce6a27a58b61\workflows\scripts\code-review-wf_0c9c4a07-a0d.js", resumeFromRunId: "wf_0c9c4a07-a0d"})`
   (same args; completed agents replay from cache). Then call ReportFindings per the host
   instructions in that session.
2. One manual pass of the drawer's **live** polling against a session with a currently-running
   agent (the only path E2E could not exercise — every real agent was already finished). Cheap
   way: open the GUI, ask for a background `ping -n 60 127.0.0.1` Bash task, watch the strip.
3. Commit — user approval required (conservative profile). Suggested: one commit for the
   background-agents feature + isMeta fix; wiki edits ride along
   (`wiki/background-agents.md` new, README index line, appends to `rtl-rendering-notes.md`
   and `sessions-and-history.md`).

## Hard-won facts not written anywhere else

- Session `18e44a29-e168-402f-b150-c8bc7c3ebfdc` under
  `C:\Users\Lion\.claude\projects\D--Project-GameNet\` is the reference fixture: 8 real agents
  + 3 background commands, meta.json for all agents, one agent transcript >1 MB.
- Frontend/server param drift almost shipped: the brief said "mirror /api/session" and one
  agent still wrote `?session=`. The contract is `id=`. Both endpoints take optional `cwd`.
- `popover` gotchas and the isMeta rule are recorded in `wiki/rtl-rendering-notes.md` (tail)
  and `wiki/sessions-and-history.md` (tail).
- Supervisor pattern that worked: brief → mid-flight acceptance-criteria message → agents
  report → verifier re-runs every gate. The one defect found (param drift) was caught because
  the agent was required to state deviations.
