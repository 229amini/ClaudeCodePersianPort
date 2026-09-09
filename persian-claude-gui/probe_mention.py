r"""Prove `@"<path>"` reaches the CLI's attachment pass over our stdin pipe -- FREE.

`wiki/cli-stream-json-findings.md` §5.2 was read out of the CLI bundle: nothing on
the at-mention path had ever been proven on the wire, and every failure there is a
silent `return null`. Two shipped features stand on it (v2.3's `@` menu, and the
non-image attachment `build_message_blocks` emits).

Free because the spawn pins `--model <bogus>`: the local attachment pass runs while
the turn is assembled, so the `attachment/file` record is written and the request
then dies at the API with `unrecognized_model` before any inference is billed.
`result.total_cost_usd` must print 0 or the probe lies about being free.

One process per send: an `unrecognized_model` result ends the print-mode turn and
the CLI ignores anything sent after it (measured -- a second frame on the same
process produces no events at all), so the unquoted control gets its own spawn.

    C:\Python314\python.exe persian-claude-gui\probe_mention.py
"""
import json
import shutil
import sys
import tempfile
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from server import build_message_blocks, transcript_dir  # noqa: E402
from probe_queue import Probe  # noqa: E402  (same spawn shape, and its cleanup)

BOGUS = "claude-not-a-real-model-99"


def one_send(blocks: list[dict], token: str) -> tuple[list[dict], float, list[dict]]:
    """Spawn, send one user frame, return (transcript records, cost, results).

    The mentioned file lives in a folder with a space in it: the quoted mention is
    the whole point (§5.2), and a space is the case that separates the two forms.
    """
    tmp = Path(tempfile.mkdtemp(prefix="pcg-mention-"))
    holder = tmp / "at tach"
    holder.mkdir()
    (holder / "note.txt").write_text(f"The secret pass phrase is {token}.\n", encoding="utf-8")
    frame = {"type": "user", "message": {"role": "user", "content": blocks(str(holder / "note.txt"))},
             "uuid": str(uuid.uuid4())}
    print(f"  frame: {json.dumps(frame['message']['content'], ensure_ascii=False)[:220]}")

    p = Probe(tmp, ["--model", BOGUS])
    lines: list[str] = []
    try:
        p.send(frame)
        p.settle(quiet=10.0)
        results = [e for e in p.events if e.get("type") == "result"]
        for e in results:
            print(f"  result subtype={e.get('subtype')} is_error={e.get('is_error')} "
                  f"cost=${e.get('total_cost_usd')} text={(e.get('result') or '')[:110]!r}")
        transcripts = transcript_dir(tmp)
        for f in sorted(transcripts.glob("*.jsonl")) if transcripts else []:
            lines += f.read_text(encoding="utf-8", errors="replace").splitlines()
    finally:
        try:
            p.proc.stdin.close()
        except Exception:
            pass
        p.proc.terminate()
        try:
            p.proc.wait(timeout=10)  # Windows won't delete a folder that is a process's cwd
        except Exception:
            pass
        # Leave no project behind: the sidebar lists every ~/.claude/projects entry
        # whose cwd still exists (wiki/dev-environment.md).
        transcripts = transcript_dir(tmp)
        for _ in range(20):
            shutil.rmtree(tmp, ignore_errors=True)
            if not tmp.exists():
                break
            time.sleep(0.25)
        if transcripts:
            shutil.rmtree(transcripts, ignore_errors=True)
        print(f"  cleanup: tmp gone={not tmp.exists()} "
              f"projects entry gone={not (transcripts and transcripts.exists())}")

    records = []
    for line in lines:
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError:
            pass
    cost = sum(e.get("total_cost_usd") or 0 for e in results)
    return records, cost, results


def files_named(records: list[dict], name: str) -> list[dict]:
    return [r for r in records
            if r.get("type") == "attachment"
            and (r.get("attachment") or {}).get("type") == "file"
            and name in json.dumps(r, ensure_ascii=False)]


def main() -> int:
    verdicts: list[tuple[str, bool, str]] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        verdicts.append((name, ok, detail))
        print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f"  -- {detail}" if detail else ""))

    # --- 1. the shipping shape: build_message_blocks quotes the mention -----
    token = "ZORBLAX" + uuid.uuid4().hex[:6].upper()
    print(f"1. quoted mention, via build_message_blocks (token {token})")
    records, cost, results = one_send(
        lambda path: build_message_blocks("what is the pass phrase in this file?", [path]),
        token)
    print("   attachment types: "
          f"{[(r.get('attachment') or {}).get('type') for r in records if r.get('type') == 'attachment']}")
    for r in files_named(records, "note.txt"):
        print("   " + json.dumps(r.get("attachment"), ensure_ascii=False)[:400])
    check("the probe stayed free", cost == 0, f"total_cost_usd={cost}")
    check("the turn died at the model, it did not answer",
          bool(results) and all(r.get("is_error") for r in results),
          f"is_error={[r.get('is_error') for r in results]}")
    check("an `attachment/file` record names the mentioned path",
          bool(files_named(records, "note.txt")))
    check("the file's CONTENT reached the turn (the token is in the record)",
          any(token in json.dumps(r, ensure_ascii=False) for r in files_named(records, "note.txt")))

    # --- 2. the control: the same path, unquoted ----------------------------
    token2 = "ZORBLAX" + uuid.uuid4().hex[:6].upper()
    print(f"\n2. the SAME path mentioned UNQUOTED (control, token {token2})")
    records2, cost2, _ = one_send(
        lambda path: [{"type": "text", "text": f"what is the pass phrase in this file? @{path}"}],
        token2)
    print("   attachment/file records: "
          f"{[(r.get('attachment') or {}).get('filename') for r in records2 if r.get('type') == 'attachment' and (r.get('attachment') or {}).get('type') == 'file']}")
    check("the control stayed free too", cost2 == 0, f"total_cost_usd={cost2}")
    check("unquoted attaches NOTHING for a path with a space "
          "(so the quoting in build_message_blocks is load-bearing)",
          not files_named(records2, "note.txt"))

    failed = [n for n, ok, _ in verdicts if not ok]
    print(f"\n{'FAIL' if failed else 'PASS'} -- {len(verdicts) - len(failed)}/{len(verdicts)}")
    for n in failed:
        print(f"  failed: {n}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
