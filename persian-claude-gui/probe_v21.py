r"""V2-PLAN.md §5 — the v2.1 probes, the ones a live process can answer for free.

    C:\Python314\python.exe persian-claude-gui\probe_v21.py

Free, and it proves it: every phase asserts `result.total_cost_usd == 0`, and the only
message text ever sent is a slash command the CLI answers or refuses locally. Nothing
here spends a subscription turn. `smoke_test.py` is the project's one paid gate and this
is not it.

§5 has ten probes. Six of them are answered by reading the binary instead of running it
(`extract_tui_vocab.py`'s trick: the SEA carries its own bundle verbatim), because the
question is "what shape does this event have" and the bundle says so at the construction
site — a stronger answer than one black-box turn, and it costs nothing. Those six are
recorded in `wiki/cli-stream-json-findings.md`; this file covers the four that need a
process on the other end of a pipe:

  §5.4  side_question   — is the subtype routed, and does it answer without a turn
  §5.5  --fork-session  — does a fork keep the project, and does it mint a new id
  §5.6  rewind          — are `rewind_conversation` / `rewind_files` routed
  §5.7  /export, /copy  — do they refuse locally (which is what makes them window-local)

plus one the plan did not know to ask, found while reading the bundle:

  §5.11 file_suggestions — the CLI's own fuzzy file index, reachable over the pipe.
        V2-PLAN §2 says it is "in-process and unreachable". That is measurably wrong,
        and it decides whether `/api/files` needs an `os.walk` at all.

Every probe reports what it saw even when the answer is "refused" — a refusal names the
subtype and its parameters, which is itself the measurement.
"""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from probe_queue import Probe, control, user_frame  # noqa: E402
from server import CLAUDE_ARGS, transcript_dir  # noqa: E402

# A tree with enough shape that a fuzzy file index has something to rank.
FIXTURE = {
    "README.md": "# probe fixture\n",
    "src/main.py": "print('probe')\n",
    "src/deep/nested_module.py": "VALUE = 1\n",
    "docs/notes.md": "notes\n",
}

findings: list[dict] = []
checks: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    checks.append((name, ok, detail))
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f"  -- {detail}" if detail else ""))


def record(probe: str, question: str, answer: str, evidence: object) -> None:
    findings.append({"probe": probe, "question": question, "answer": answer,
                     "evidence": evidence})
    print(f"    -> {answer}")


def body(reply: dict) -> dict:
    """A control_response is `{subtype, response:{...}}` on success and
    `{subtype:"error", error:"..."}` on refusal. Both carry the measurement."""
    return reply.get("response") if isinstance(reply.get("response"), dict) else reply


def cost_of(events: list[dict]) -> float:
    """The HIGHEST `total_cost_usd` seen, not the sum.

    Measured here on 2.1.261, the hard way: `result.total_cost_usd` is the SESSION
    total, not the turn's. The first run of this probe billed a `side_question` and
    then reported the charge against the `/export` phase that ran after it, because
    summing cumulative numbers attributes a cost to whoever happens to report next.
    Phases take a delta against this (see `spent_since`).
    """
    return max((e.get("total_cost_usd") or 0 for e in events
                if e.get("type") == "result"), default=0.0)


def spent_since(p: Probe, before: float) -> float:
    """What this phase actually added to the session's bill."""
    return round(max(cost_of(p.events) - before, 0.0), 6)


def session_id_of(p: Probe) -> str | None:
    for e in p.events:
        if e.get("type") == "system" and e.get("subtype") == "init":
            return e.get("session_id")
        if e.get("session_id"):
            return e.get("session_id")
    return None


def make_fixture(root: Path) -> None:
    for rel, text in FIXTURE.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")


def free_turn(p: Probe, text: str, floor: float = 8.0) -> list[dict]:
    """Send a slash command, wait a real floor, then settle.

    The floor is not padding. `Probe.settle()` returns the instant the CLI has been
    quiet for its window — and after a previous phase it ALREADY has been, so a
    command that answers slowly (or never) settles immediately and gets recorded as
    "emitted nothing". That is how the first run of this probe mis-measured /copy.
    Sleep past the settle window first, so silence has to be earned.
    """
    mark = p.mark()
    p.send(user_frame(text, str(uuid.uuid4())))
    time.sleep(floor)
    p.settle()
    return p.since(mark)


def result_text(events: list[dict]) -> str:
    for e in events:
        if e.get("type") == "result":
            return (e.get("result") or "")[:400]
    return ""


def probe_file_suggestions(p: Probe) -> None:
    print("\n5.11  file_suggestions — is the CLI's own file index reachable?")
    # The index warms asynchronously after spawn; querying immediately measures the
    # warm-up, not the index. Give it a moment before deciding a query found nothing.
    time.sleep(3.0)
    for query in ("READ", "main", "notes", "nested_module", "nested", "src/", "main.py"):
        reply = control(p, "file_suggestions", query=query)
        got = body(reply)
        suggestions = got.get("suggestions")
        if suggestions is None:
            record("5.11", f"query={query!r}", f"refused: {json.dumps(got)[:180]}", got)
            check(f"file_suggestions answers {query!r}", False, json.dumps(got)[:120])
            continue
        shown = [s.get("path") if isinstance(s, dict) else s for s in suggestions][:6]
        record("5.11", f"query={query!r}",
               f"{len(suggestions)} suggestions: {shown}", suggestions[:6])
        check(f"file_suggestions answers {query!r}", True, f"{len(suggestions)} hits")


def probe_rewind(p: Probe) -> None:
    print("\n5.6  rewind — is there a control subtype, as §4 asked?")
    # A uuid the session never saw. The point is the ROUTING: a subtype the CLI does
    # not know answers "Unsupported control request subtype"; one it knows answers
    # something about the uuid instead. Those two are distinguishable, and that is
    # the whole measurement.
    reply = control(p, "rewind_conversation", target_message_uuid=str(uuid.uuid4()))
    got = body(reply)
    flat = json.dumps(got, ensure_ascii=False)
    known = "nsupported" not in flat
    record("5.6", "rewind_conversation with an unknown uuid",
           ("routed — " if known else "NOT a subtype on this build — ") + flat[:200], got)
    check("rewind_conversation is a subtype this build routes", known, flat[:140])

    # The validation branch names the parameter, so a wrong type is a free schema read.
    reply = control(p, "rewind_conversation", target_message_uuid=12345)
    got = body(reply)
    flat = json.dumps(got, ensure_ascii=False)
    record("5.6", "rewind_conversation with a non-string uuid", flat[:200], got)
    check("its parameter is named in the refusal",
          "target_message_uuid" in flat, flat[:140])

    reply = control(p, "rewind_files", user_message_id=str(uuid.uuid4()), dry_run=True)
    got = body(reply)
    flat = json.dumps(got, ensure_ascii=False)
    record("5.6", "rewind_files dry_run", flat[:200], got)
    check("rewind_files is routed too", "nsupported" not in flat, flat[:140])


# §5.4, measured once on 2.1.261 and deliberately NOT re-measured. The first run sent
# `side_question` with no `question` field, expecting a schema complaint the way every
# other malformed control request answers one. It did not complain: it asked the MODEL,
# and the model answered «Question empty — no text came through. Ask again with actual
# question.» -- a sentence that is nowhere in the binary, which is how we know it was
# generated rather than canned. That turn cost $0.107.
#
# So the answer to §5.4 is not "what is the schema" but "this is a paid call, with no
# free negative probe available": there is no malformed payload that gets routed and
# refused without reaching the model. Re-running it only spends the money again, so it
# is pinned here and re-measured only behind --paid.
SIDE_QUESTION_MEASURED = {
    "request": {"subtype": "side_question", "question": "<string>",
                "history": "optional, array"},
    "response": {"response": "string | null", "synthetic": "bool",
                 "refusal_fallback": "optional {original_model, fallback_model, content}"},
    "costs_a_turn": True,
    "cost_observed_usd": 0.1073615,
    "writes_main_transcript": False,
    "evidence": "the answer arrives only inside the control_response; no assistant "
                "event carried it on the main stream, and the TUI logs "
                "'[btw] panel mounted' -- it renders in a panel, not the column",
}


def probe_side_question(p: Probe, paid: bool) -> None:
    print("\n5.4  side_question — request and response shape")
    if not paid:
        record("5.4", "side_question (pinned; --paid to re-measure)",
               "a REAL model call: costs a turn, answers on the control_response only, "
               f"does not write the main transcript (${SIDE_QUESTION_MEASURED['cost_observed_usd']} "
               "on 2.1.261)", SIDE_QUESTION_MEASURED)
        check("side_question's shape is on record", True, "not re-sent: it is paid")
        return
    before = cost_of(p.events)
    reply = control(p, "side_question", question="Reply with the single word: ok")
    got = body(reply)
    flat = json.dumps(got, ensure_ascii=False)
    p.settle(quiet=4.0)
    record("5.4", "side_question with a real question",
           f"{flat[:220]}  spent=${spent_since(p, before)}", got)
    check("side_question answers on the control_response", "response" in got, flat[:140])


def probe_local_commands(p: Probe) -> None:
    print("\n5.7  /export, /copy, /resume — do they refuse locally?")
    for cmd in ("/export", "/copy", "/resume", "/nonesuch-probe"):
        before = cost_of(p.events)
        seen = free_turn(p, cmd)
        spent = spent_since(p, before)
        text = result_text(seen)
        kinds = sorted({e.get("type") for e in seen})
        # Whether the uuid ledger ever closes decides whether the window's spinner
        # ends on its own or has to wait for the silence watchdog.
        states = [e.get("state") for e in seen if e.get("type") == "command_lifecycle"]
        record("5.7", f"{cmd} as user text",
               f"spent=${spent} types={kinds} lifecycle={states} result={text[:160]!r}",
               {"spent": spent, "types": kinds, "lifecycle": states, "result": text})
        check(f"{cmd} is refused locally, for free", spent == 0, f"spent=${spent}")
        check(f"{cmd} closes its uuid rather than stranding the ledger",
              any(s in ("completed", "cancelled", "discarded", "refused") for s in states),
              f"lifecycle={states}")


def probe_fork(base: Path) -> None:
    """§5.5 — spawn with --resume <id> --fork-session and see what the fork keeps."""
    print("\n5.5  --fork-session — new id, same project?")
    parent = Probe(base)
    try:
        seen = free_turn(parent, "/recap")
        parent_id = session_id_of(parent)
        cost = cost_of(seen)
        check("the parent session minted an id for free", bool(parent_id) and cost == 0,
              f"id={parent_id} cost={cost}")
        if not parent_id:
            record("5.5", "parent session id", "none — the CLI never announced one", None)
            return
    finally:
        parent.proc.stdin.close()
        parent.proc.terminate()
        try:
            parent.proc.wait(timeout=10)
        except Exception:
            pass

    fork = Probe(base, ["--resume", parent_id, "--fork-session"])
    try:
        seen = free_turn(fork, "/recap")
        fork_id = session_id_of(fork)
        cost = cost_of(seen)
        same = fork_id == parent_id
        record("5.5", "--fork-session --resume <id>",
               f"parent={parent_id} fork={fork_id} "
               f"{'SAME id' if same else 'NEW id'} cost={cost}",
               {"parent": parent_id, "fork": fork_id, "same": same})
        check("the fork started and answered", bool(fork_id), f"id={fork_id}")
        check("the fork cost nothing", cost == 0, f"total_cost_usd={cost}")
        check("a fork mints a NEW session id (so the sidebar sees two sessions)",
              bool(fork_id) and not same, f"parent={parent_id} fork={fork_id}")

        tdir = transcript_dir(base)
        files = sorted(f.name for f in tdir.glob("*.jsonl")) if tdir else []
        record("5.5", "transcripts on disk after the fork",
               f"{len(files)} file(s) under {tdir}: {files}", files)
        check("both sessions have a transcript in the SAME project folder",
              len(files) >= 2, f"{files}")
    finally:
        try:
            fork.proc.stdin.close()
        except Exception:
            pass
        fork.proc.terminate()
        try:
            fork.proc.wait(timeout=10)
        except Exception:
            pass


def main() -> int:
    paid = "--paid" in sys.argv
    base = Path(tempfile.mkdtemp(prefix="pcg-v21-"))
    make_fixture(base)
    print(f"cwd:   {base}\nspawn: {' '.join(CLAUDE_ARGS)}\n")

    p = Probe(base)
    try:
        init = body(control(p, "initialize"))
        print(f"initialize: {len(init.get('commands') or [])} commands, "
              f"mode={init.get('current_permission_mode')}")
        probe_file_suggestions(p)
        probe_side_question(p, paid)
        probe_rewind(p)
        probe_local_commands(p)
        total = cost_of(p.events)
        check("the whole live phase stayed free",
              total == 0 or paid, f"total_cost_usd={total}")
    finally:
        try:
            p.proc.stdin.close()
        except Exception:
            pass
        p.proc.terminate()
        try:
            p.proc.wait(timeout=10)
        except Exception:
            pass

    try:
        probe_fork(base)
    finally:
        # Leave no project behind: a stray probe cwd shows up in the sidebar forever
        # (the lesson of v1.0.1's ghost projects).
        tdir = transcript_dir(base)
        for _ in range(20):
            shutil.rmtree(base, ignore_errors=True)
            if not base.exists():
                break
            time.sleep(0.25)
        if tdir:
            shutil.rmtree(tdir, ignore_errors=True)

    out = Path(__file__).with_name("probe_v21_findings.json")
    out.write_text(json.dumps(findings, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nfindings written to {out.name}")

    failed = [n for n, ok, _ in checks if not ok]
    print(f"\n{'FAIL' if failed else 'PASS'} -- {len(checks) - len(failed)}/{len(checks)}")
    for n in failed:
        print(f"  failed: {n}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
