"""Pull the TUI's vocabulary — keybindings, glyphs, user-visible strings — out of the
`claude` native binary, so `wiki/tui-keys.md` and `wiki/tui-strings.md` are regenerable
rather than transcribed by hand.

Why this exists (V2-PLAN.md §3.6): "Lift the defaults from the binary, not from memory."
v2 draws the TUI with the DOM, so every key and every word it shows has to come from the
same build the engine talks to. A table typed from memory drifts the moment the binary
self-updates — and it does, silently (2.1.259 -> 2.1.260 overnight, 2026-09-04).

The binary is a single-file Node SEA: the bundled JS sits verbatim inside it, so the
keybinding table is findable as its own source text. That is the whole trick.

Usage:
    C:\\Python314\\python.exe persian-claude-gui\\extract_tui_vocab.py            # report
    C:\\Python314\\python.exe persian-claude-gui\\extract_tui_vocab.py --json     # machine-readable

Free: reads a file, spawns nothing, costs no turn.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys

# The bundle stores the binding table as one JS array literal, starting at this anchor.
# Everything v2 needs (contexts, chords, action ids) is inside it.
TABLE_ANCHOR = re.compile(rb'\[\{context:"Global",bindings:\{')

# Immediately before the table, the bundle resolves the two platform-dependent chords as
# single-letter variables, which the table then uses as computed keys (`[de]:`, `[V]:`):
#   le = platform is windows or wsl;  de = le ? "alt+v" : "ctrl+v"      (chat:imagePaste)
#   V  = ge ? "shift+tab" : "meta+m"                                    (chat:cycleMode)
# `ge` is true on Windows with a modern Node, which is every machine this project ships to.
# Both branches are captured so the report can say which one Windows takes and why.
PLATFORM_CHORDS = re.compile(
    rb'(?P<paste_var>\w+)\s*=\s*le\?"(?P<paste_win>[^"]+)":"(?P<paste_other>[^"]+)".{0,400}?'
    rb'(?P<cycle_var>\w+)\s*=\s*ge\?"(?P<cycle_ok>[^"]+)":"(?P<cycle_fallback>[^"]+)"',
    re.S,
)

# `...B==="wsl"&&{"ctrl+v":"chat:imagePaste"}` — a spread the bundler left conditional.
# These bindings are NOT active on the platform this project ships to, so they are pulled
# out of the body before pairs are read and reported separately instead of silently
# inflating the table with a chord Windows never sees.
CONDITIONAL_SPREAD = re.compile(
    rb'\.\.\.\w+===?="?(?P<platform>\w+)"?&&\{(?P<body>[^}]*)\}'
)

CONTEXT_DOCS = re.compile(rb'\{Global:"(?P<first>[^"]+)",(?P<rest>[^}]{0,4000})\}')
UNBINDABLE = re.compile(
    rb'\{key:"(?P<key>[^"]+)",reason:"(?P<reason>[^"]+)",severity:"(?P<sev>[^"]+)"\}'
)

# One `{context:"Name",bindings:{...}}` block. `bindings` may contain `...{}` spreads
# (feature-gated entries the bundler folded away) — those are skipped, not guessed at.
BLOCK = re.compile(rb'\{context:"(?P<ctx>[A-Za-z]+)",bindings:\{(?P<body>.*?)\}\}', re.S)
# key can be bare (`enter:`), quoted (`"ctrl+k":`) or computed (`[V]:`).
PAIR = re.compile(r'(?:"(?P<q>[^"]+)"|\[(?P<computed>[A-Za-z_$][\w$]*)\]|(?P<bare>[a-z]+))'
                  r':"(?P<action>[a-zA-Z]+:[a-zA-Z0-9]+)"')

# User-visible strings worth translating. Each entry is (id, regex, note).
# Kept narrow on purpose: a broad string dump of a 200 MB binary is mostly minified
# identifiers, and a table nobody can review is a table nobody will translate.
STRING_PATTERNS: list[tuple[str, bytes, str]] = [
    ("permission.proceed", rb'Would you like to proceed\?', "permission + plan dialog title"),
    ("permission.yes_once", rb'\{label:"Yes",value:"yes"\}', "option 1 (the label is bare `Yes`)"),
    ("permission.yes_remember", rb"Yes, and don't ask again for ", "option 2 prefix"),
    ("permission.no_feedback", rb'No, and tell Claude what to do differently ',
     "option 3; the TUI appends a bold `(esc)`"),
    ("permission.feedback_hint", rb'shift\+tab to approve with this feedback', "dialog footer"),
    ("tool_result.expand", rb'\(ctrl\+o to expand\)', "collapsed tool result footer"),
    ("spinner.interrupt", rb'esc to interrupt', "spinner suffix"),
    ("paste.placeholder", rb'\[Pasted text #\$\{e\} \+\$\{n\}', "composer paste chip"),
    ("posture.accept_edits", rb'accept edits on', "status line posture"),
    ("posture.plan", rb'plan mode on', "status line posture"),
    ("posture.auto", rb'auto mode on', "status line posture"),
    ("posture.bypass", rb'bypass permissions', "status line posture"),
    ("rewind.hint", rb'Double-tap esc to rewind the conversation to a previous point in time',
     "esc-esc rewind"),
    ("exit.hint", rb'Press Ctrl-C again to exit', "interrupt then quit"),
    ("queue.stop", rb'ctrl\+x to stop', "running-turn footer"),
    ("composer.newline", rb'ctrl\+j for newline', "composer footer"),
    ("composer.mention", rb'@ to mention', "composer footer"),
    ("help.close", rb'\? to close', "help overlay footer"),
]

GLYPHS = [
    ("\u23fa", "assistant / tool row bullet"),
    ("\u23bf", "tool result branch"),
    ("\u2733", "thinking"),
    ("\u203b", "recap note"),
    ("\u23f5", "posture arrow (doubled: accept-edits)"),
    ("\u2610", "todo: pending"),
    ("\u2611", "todo: done"),
    ("\u25b8", "todo: in progress"),
    ("\u2191", "arrow up (key display)"),
    ("\u2193", "arrow down (key display)"),
    ("\u2190", "arrow left (key display)"),
    ("\u2192", "arrow right (key display)"),
]


def find_binary(explicit: str | None = None) -> str:
    """Locate claude.exe. Explicit path wins, then PATH, then the standard install dir."""
    if explicit:
        if not os.path.isfile(explicit):
            raise SystemExit(f"not a file: {explicit}")
        return explicit
    found = shutil.which("claude")
    if found and os.path.isfile(found) and os.path.getsize(found) > 50_000_000:
        # A .cmd shim is a few hundred bytes; the SEA is ~200 MB. Only the SEA has the
        # bundle inside it, so a shim on PATH must not be accepted silently.
        return found
    guess = os.path.join(os.path.expanduser("~"), ".local", "bin", "claude.exe")
    if os.path.isfile(guess):
        return guess
    raise SystemExit(
        "claude.exe not found. Pass --binary <path> — it must be the ~200 MB native "
        "single-file build, not a .cmd shim."
    )


def _decode_body(body: bytes) -> str:
    return body.decode("ascii", "replace")


def parse(data: bytes) -> dict:
    anchor = TABLE_ANCHOR.search(data)
    if not anchor:
        raise SystemExit(
            "keybinding table not found. The bundle's shape changed; re-derive the anchor "
            "before trusting wiki/tui-keys.md against this build."
        )

    # Platform chords are declared in the ~1.5 KB preceding the table.
    head = data[max(0, anchor.start() - 2000):anchor.start()]
    pc = PLATFORM_CHORDS.search(head)
    # Keyed by the *variable name* the table uses, not by action: `V` resolves
    # chat:cycleMode and confirm:cycleMode both, so keying by action loses one of them.
    chords: dict[str, str] = {}
    chord_notes: dict[str, str] = {}
    if pc:
        chords[pc.group("paste_var").decode()] = pc.group("paste_win").decode()
        chords[pc.group("cycle_var").decode()] = pc.group("cycle_ok").decode()
        chord_notes[pc.group("paste_var").decode()] = (
            f'windows/wsl: {pc.group("paste_win").decode()}; '
            f'otherwise {pc.group("paste_other").decode()}'
        )
        chord_notes[pc.group("cycle_var").decode()] = (
            f'modern node: {pc.group("cycle_ok").decode()}; '
            f'otherwise {pc.group("cycle_fallback").decode()}'
        )

    # The table ends at the `];` that closes the array literal.
    tail = data[anchor.start():anchor.start() + 20000]
    end = tail.find(b"}];")
    if end == -1:
        raise SystemExit("keybinding table start found but its end was not")
    table = tail[: end + 2]

    contexts: list[dict] = []
    inactive: list[dict] = []
    for blk in BLOCK.finditer(table):
        ctx = blk.group("ctx").decode()
        body = blk.group("body")

        # Lift platform-conditional spreads out first, so they cannot be mistaken for
        # defaults. Windows is the shipping platform; a wsl-only chord is not a default.
        for cond in CONDITIONAL_SPREAD.finditer(body):
            platform = cond.group("platform").decode()
            for pair in PAIR.finditer(_decode_body(cond.group("body"))):
                inactive.append(
                    {
                        "context": ctx,
                        "chord": pair.group("q") or pair.group("bare"),
                        "action": pair.group("action"),
                        "only_on": platform,
                    }
                )
        body = CONDITIONAL_SPREAD.sub(b"", body)

        bindings = []
        for pair in PAIR.finditer(_decode_body(body)):
            key = pair.group("q") or pair.group("bare")
            if pair.group("computed"):
                # A computed key: resolve it through the platform chord table, or record
                # it as unresolved rather than inventing a chord for it.
                var = pair.group("computed")
                key = chords.get(var, f"<unresolved:{var}>")
            bindings.append({"chord": key, "action": pair.group("action")})
        if bindings:
            contexts.append({"context": ctx, "bindings": bindings})

    docs = {}
    cd = CONTEXT_DOCS.search(data)
    if cd:
        blob = b'{Global:"' + cd.group("first") + b'",' + cd.group("rest") + b"}"
        for m in re.finditer(rb'(\w+):"([^"]+)"', blob):
            docs[m.group(1).decode()] = m.group(2).decode()

    unbindable = []
    seen_keys = set()
    for m in UNBINDABLE.finditer(data):
        key = m.group("key").decode()
        reason = m.group("reason").decode()
        if (key, reason) in seen_keys:
            continue
        seen_keys.add((key, reason))
        unbindable.append(
            {"key": key, "reason": reason, "severity": m.group("sev").decode()}
        )

    strings = []
    for sid, pat, note in STRING_PATTERNS:
        m = re.search(pat, data)
        strings.append(
            {
                "id": sid,
                "found": m is not None,
                "text": m.group().decode("ascii", "replace") if m else None,
                "note": note,
            }
        )

    return {
        "contexts": contexts,
        "context_docs": docs,
        "platform_chords": chords,
        "platform_chord_notes": chord_notes,
        "inactive_on_this_platform": inactive,
        "unbindable": unbindable,
        "strings": strings,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--binary", help="path to claude.exe (default: PATH, then ~/.local/bin)")
    ap.add_argument("--json", action="store_true", help="emit JSON instead of a report")
    args = ap.parse_args(argv)

    path = find_binary(args.binary)
    with open(path, "rb") as fh:
        data = fh.read()
    result = parse(data)
    result["binary"] = path

    if args.json:
        json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
        print()
        return 0

    total = sum(len(c["bindings"]) for c in result["contexts"])
    print(f"binary: {path}")
    print(f"contexts: {len(result['contexts'])}   bindings: {total}")
    for var, chord in result["platform_chords"].items():
        print(f"platform chord [{var}] -> {chord}   ({result['platform_chord_notes'][var]})")
    for b in result["inactive_on_this_platform"]:
        print(f"inactive here: {b['chord']} -> {b['action']} ({b['only_on']} only)")
    print()
    for c in result["contexts"]:
        doc = result["context_docs"].get(c["context"], "")
        print(f"## {c['context']} — {doc}")
        for b in c["bindings"]:
            print(f"    {b['chord']:<18} {b['action']}")
        print()
    print("## cannot be rebound")
    for u in result["unbindable"]:
        print(f"    {u['key']:<12} {u['severity']:<8} {u['reason']}")
    print()
    print("## strings")
    missing = 0
    for s in result["strings"]:
        mark = "ok " if s["found"] else "MISS"
        if not s["found"]:
            missing += 1
        print(f"    [{mark}] {s['id']:<28} {s['text']}")
    if missing:
        print(f"\n{missing} string(s) not found — this build's wording moved.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
