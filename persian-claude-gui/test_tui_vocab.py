"""Gate for the v2.0 vocabulary: `wiki/tui-keys.md` and `wiki/tui-strings.md` must agree
with the `claude` binary that is actually installed.

    C:\\Python314\\python.exe persian-claude-gui\\test_tui_vocab.py

Why this is a gate and not a one-off script. V2-PLAN.md §3.6 says the keys come from the
binary, and the binary rewrites itself: 2.1.259 -> 2.1.260 landed overnight on 2026-09-04,
between the plan and this branch. Documentation that was true when written silently stops
being true. This check turns that into a failure with a name.

What it asserts:

  1. The extractor still finds the table. A bundle reshape is a hard failure — an empty
     table would otherwise pass every "is every row translated" check trivially.
  2. The chords v2 actually binds are the ones the binary has. Not all 206: the ones
     V2-PLAN commits to. If `enter` stops meaning submit, this says so.
  3. Every English string quoted in tui-strings.md is present in the binary. This is the
     one that catches wording drift, which is otherwise invisible.
  4. Every row of every table in both documents has a non-empty Persian column — the
     bead's own exit criterion (`pcg-qmy.1`), checked instead of asserted in prose.
  5. The per-context binding counts printed in tui-keys.md match the extractor, so the
     "contexts v2 does not build" table cannot rot into a wrong number.

Free: reads two files and a binary, spawns nothing, costs no turn. Login-independent.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import extract_tui_vocab as vocab

REPO = Path(__file__).resolve().parent.parent
KEYS_DOC = REPO / "wiki" / "tui-keys.md"
STRINGS_DOC = REPO / "wiki" / "tui-strings.md"

# The bindings v2 commits to in V2-PLAN.md §3.2/§3.3. Asserting all 206 would fail on any
# upstream addition, which is noise; these are the ones whose meaning the window depends on.
LOAD_BEARING = [
    ("Chat", "enter", "chat:submit"),
    ("Chat", "escape", "chat:cancel"),
    ("Chat", "shift+tab", "chat:cycleMode"),
    ("Chat", "ctrl+j", "chat:newline"),
    ("Chat", "up", "history:previous"),
    ("Chat", "down", "history:next"),
    ("Chat", "ctrl+g", "chat:externalEditor"),
    ("Chat", "alt+v", "chat:imagePaste"),
    ("Chat", "meta+p", "chat:modelPicker"),
    ("Chat", "ctrl+x enter", "chat:queueSubmit"),
    ("Global", "ctrl+r", "history:search"),
    ("Global", "ctrl+o", "app:toggleTranscript"),
    ("Global", "ctrl+t", "app:toggleTodos"),
    ("Confirmation", "enter", "confirm:yes"),
    ("Confirmation", "escape", "confirm:no"),
    ("Confirmation", "shift+tab", "confirm:cycleMode"),
    ("Autocomplete", "tab", "autocomplete:accept"),
    ("Autocomplete", "escape", "autocomplete:dismiss"),
    ("Transcript", "ctrl+e", "transcript:toggleShowAll"),
    ("HistorySearch", "ctrl+r", "historySearch:next"),
]

# `| a | b | c |` rows, minus the `|---|---|` separators.
ROW = re.compile(r"^\|(?P<cells>.+)\|\s*$")
SEPARATOR = re.compile(r"^\|[\s:|-]+\|\s*$")
PERSIAN = re.compile(r"[\u0600-\u06FF]")
# Inline code spans in a markdown cell: `ctrl+j for newline`
CODE = re.compile(r"`([^`]+)`")

failures: list[str] = []
checks = 0


def check(ok: bool, label: str, detail: str = "") -> None:
    global checks
    checks += 1
    if ok:
        print(f"  OK   {label}")
    else:
        print(f"  FAIL {label}" + (f"  -- {detail}" if detail else ""))
        failures.append(label)


def present(data: bytes, literal: str) -> bool:
    """Is this user-visible string in the bundle?

    Not a plain substring test: the minifier escapes non-ASCII, so «… — Claude will wrap
    up» is stored as `\\u2014` and «esc to close · esc again quits» as `\\xB7`. Searching
    for the literal em dash finds nothing and the check would report drift that is really
    just an encoding. Both escape forms are tried before a string is called missing.
    """
    if literal.encode("utf-8") in data:
        return True
    for esc in (lambda c: "\\u%04x" % ord(c), lambda c: "\\u%04X" % ord(c),
                lambda c: "\\x%02x" % ord(c), lambda c: "\\x%02X" % ord(c)):
        candidate = "".join(c if ord(c) < 0x80 else esc(c) for c in literal)
        if candidate.encode("ascii", "ignore") in data:
            return True
    return False


def tables(doc: str) -> list[tuple[list[str], list[list[str]]]]:
    """Split a markdown document into (header, rows) pairs, one per table."""
    out: list[tuple[list[str], list[list[str]]]] = []
    header: list[str] | None = None
    rows: list[list[str]] = []
    prev: list[str] | None = None
    for line in doc.splitlines():
        m = ROW.match(line)
        if not m:
            if header is not None:
                out.append((header, rows))
            header, rows, prev = None, [], None
            continue
        cells = [c.strip() for c in m.group("cells").split("|")]
        if SEPARATOR.match(line):
            # The line above the separator was the header.
            header, rows = prev or [], []
            continue
        if header is None:
            prev = cells
            continue
        rows.append(cells)
    if header is not None:
        out.append((header, rows))
    return out


def main() -> int:
    print("1. the extractor still finds the table in the installed binary")
    path = vocab.find_binary()
    data = Path(path).read_bytes()
    result = vocab.parse(data)
    by_ctx = {c["context"]: c for c in result["contexts"]}
    total = sum(len(c["bindings"]) for c in result["contexts"])
    check(total > 150, f"the binding table is populated ({total} bindings)", f"total={total}")
    check(len(result["contexts"]) > 20,
          f"every context parsed ({len(result['contexts'])} contexts)")
    unresolved = [
        f"{c['context']}/{b['chord']}"
        for c in result["contexts"] for b in c["bindings"]
        if b["chord"].startswith("<unresolved")
    ]
    check(not unresolved, "no chord was left unresolved", ", ".join(unresolved))

    print("\n2. the chords v2 binds are the ones the binary has")
    for ctx, chord, action in LOAD_BEARING:
        have = by_ctx.get(ctx, {}).get("bindings", [])
        hit = any(b["chord"] == chord and b["action"] == action for b in have)
        check(hit, f"{ctx}: {chord} -> {action}",
              "not in this build's table")

    print("\n3. platform-computed chords resolved for Windows")
    check(result["platform_chords"].get("de") == "alt+v",
          "image paste resolves to alt+v on windows",
          str(result["platform_chords"]))
    check(result["platform_chords"].get("V") == "shift+tab",
          "mode cycle resolves to shift+tab",
          str(result["platform_chords"]))
    check(any(b["action"] == "chat:imagePaste" and b["only_on"] == "wsl"
              for b in result["inactive_on_this_platform"]),
          "the wsl-only ctrl+v spread is kept out of the defaults")

    print("\n4. every string and glyph the docs quote is in this build")
    for s in result["strings"]:
        check(s["found"], f"string {s['id']}", "not in the binary")
    for g in result["glyphs"]:
        check(g["found"], f"glyph {g['codepoint']} {g['char']}", "not in the binary")

    print("\n5. both documents exist")
    check(KEYS_DOC.is_file(), "wiki/tui-keys.md exists")
    check(STRINGS_DOC.is_file(), "wiki/tui-strings.md exists")
    if not (KEYS_DOC.is_file() and STRINGS_DOC.is_file()):
        return report()

    keys_md = KEYS_DOC.read_text(encoding="utf-8")
    strings_md = STRINGS_DOC.read_text(encoding="utf-8")

    print("\n6. every table row carries a Persian column (the bead's exit criterion)")
    for doc_name, md in (("tui-keys.md", keys_md), ("tui-strings.md", strings_md)):
        empty: list[str] = []
        checked = 0
        for header, rows in tables(md):
            # Only tables that promise a Persian column are held to it. The glyph-count
            # and cannot-be-rebound tables are reference data, not copy.
            idx = [i for i, h in enumerate(header) if PERSIAN.search(h)]
            if not idx:
                continue
            for row in rows:
                checked += 1
                if not any(
                    i < len(row) and PERSIAN.search(row[i])
                    # An em dash is an explicit "not translated, on purpose" — §6 of the
                    # strings doc and the «وضعیت» column both rely on it.
                    or (i < len(row) and row[i].strip() in ("—", "-"))
                    for i in idx
                ):
                    empty.append(" | ".join(row)[:70])
        check(not empty, f"{doc_name}: all {checked} rows have a Persian column",
              "; ".join(empty[:3]))

    print("\n7. the English strings quoted in tui-strings.md are in the binary")
    # Every inline code span in the «رشتهٔ TUI» column, checked against the binary.
    drifted: list[str] = []
    quoted = 0
    for header, rows in tables(strings_md):
        cols = [i for i, h in enumerate(header) if "TUI" in h]
        if not cols:
            continue
        for row in rows:
            for i in cols:
                if i >= len(row):
                    continue
                for lit in CODE.findall(row[i]):
                    # Skip placeholder-bearing forms; §3 documents their runtime shape and
                    # the literal text never appears in the bundle.
                    if any(ch in lit for ch in "#N…"):
                        continue
                    lit = lit.strip()
                    if len(lit) < 4:
                        continue
                    quoted += 1
                    if not present(data, lit):
                        drifted.append(lit)
    check(quoted > 10, f"the strings doc quotes {quoted} literals from the binary")
    check(not drifted, "no quoted literal drifted out of this build",
          "; ".join(drifted[:4]))

    print("\n8. the per-context counts printed in tui-keys.md are the real ones")
    wrong: list[str] = []
    seen = 0
    for header, rows in tables(keys_md):
        if not (header and header[0] == "Context" and len(header) > 1
                and header[1] == "Bindings"):
            continue
        for row in rows:
            name = row[0].strip("`").split(" / ")[0]
            if name not in by_ctx:
                continue
            claimed = [int(n) for n in re.findall(r"\d+", row[1])]
            if not claimed:
                continue
            seen += 1
            actual = len(by_ctx[name]["bindings"])
            if actual not in claimed:
                wrong.append(f"{name}: doc says {row[1]}, binary has {actual}")
    check(seen > 5, f"the 'contexts v2 does not build' table was found ({seen} rows)")
    check(not wrong, "every claimed binding count matches the binary", "; ".join(wrong))

    return report()


def report() -> int:
    print()
    if failures:
        print(f"FAIL — {checks - len(failures)}/{checks}")
        for f in failures:
            print(f"    {f}")
        return 1
    print(f"PASS — {checks}/{checks}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
