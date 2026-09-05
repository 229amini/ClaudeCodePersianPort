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
  6. The paste thresholds v2.2 hardcodes in composer.js are the ones the binary gates on.
     A drifted limit is invisible: the window would still work, it would just disagree
     with the terminal running beside it.

Free: reads two files and a binary, spawns nothing, costs no turn. Login-independent.
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import extract_tui_vocab as vocab
from server import EDITIONS  # noqa: E402

# The edition decides which UI folder this gate reads. PCG_UI picks it;
# the table itself lives in server.py and is never duplicated.
EDITION = os.environ.get("PCG_UI", "terminal")
STATIC = HERE / EDITIONS[EDITION][0]

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

    def computed_for(action: str) -> str | None:
        """What a computed key resolves to, looked up by the action it serves.

        NOT by the variable's name. The minifier renames it every build — the mode-cycle
        temporary was `V` on 2.1.260 and `q` on 2.1.261, and a gate keyed on the letter
        reported drift that was only a rename. The action id is the stable identity.
        """
        for var, actions in result["computed_uses"].items():
            if action in actions:
                return result["platform_chords"].get(var)
        return None

    check(computed_for("chat:imagePaste") == "alt+v",
          "image paste resolves to alt+v on windows",
          str(result["platform_chords"]))
    check(computed_for("chat:cycleMode") == "shift+tab",
          "mode cycle resolves to shift+tab",
          str(result["platform_chords"]))
    check(computed_for("confirm:cycleMode") == "shift+tab",
          "the dialog's mode cycle is the same computed chord",
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

    print("\n9. the paste thresholds composer.js hardcodes are still the binary's")
    # v2.2 parks a long paste behind a `[Pasted text #N +M lines]` chip. Both numbers and
    # both placeholder shapes were lifted from this bundle, so they are drift-prone in
    # exactly the way §3.6 warns about: nothing in the window would look wrong if the CLI
    # moved to 1200 characters, it would just disagree with the terminal beside it.
    composer = (STATIC / "js" / "composer.js").read_text(
        encoding="utf-8")
    strings_js = (STATIC / "strings.fa.js").read_text(
        encoding="utf-8")

    # `let T=BY(S);if(w&&(S.length>o9||T>2))` — the whole decision, in one expression.
    gate = re.search(rb"\(([A-Za-z_$][\w$]*)\.length>([A-Za-z_$][\w$]*)"
                     rb"\|\|[A-Za-z_$][\w$]*>(\d+)\)", data)
    check(gate is not None, "the paste gate is still one length-or-newlines expression",
          "the bundle reshaped; re-read the paste path before trusting the constants")
    if gate:
        var = gate.group(2).decode()
        decl = re.search(rb"var " + re.escape(gate.group(2)) + rb"=(\d+)", data)
        chars = int(decl.group(1)) if decl else None
        newlines = int(gate.group(3))
        ours = re.search(r"PASTE_MAX_CHARS = (\d+)", composer)
        ours_nl = re.search(r"PASTE_MAX_NEWLINES = (\d+)", composer)
        check(chars is not None and ours is not None and int(ours.group(1)) == chars,
              f"PASTE_MAX_CHARS is the binary's {var} ({chars})",
              f"composer.js says {ours and ours.group(1)}")
        check(ours_nl is not None and int(ours_nl.group(1)) == newlines,
              f"PASTE_MAX_NEWLINES is the binary's newline gate ({newlines})",
              f"composer.js says {ours_nl and ours_nl.group(1)}")

    # `function BY(e){return(e.match(/\r\n|\r|\n/g)||[]).length}` — CR, LF and CRLF each
    # count as one line, which is why the window cannot just split on "\n".
    check(rb"/\r\n|\r|\n/g" in data and r"/\r\n|\r|\n/g" in composer,
          "the newline count uses the binary's own CR/LF/CRLF regex")

    # `cue(e,t)`: two shapes, and the zero-newline one drops the ` +N lines` tail.
    check(b"return`[Pasted text #${e}]`" in data
          and b"return`[Pasted text #${e} +${t} lines]`" in data,
          "cue() still mints two placeholder shapes")
    print("\n10. the five-hour warning fires where the binary's own does")
    # v2.6 gave the status line the TUI's «Approaching your 5-hour usage limit»
    # row. The threshold is the binary's default, not a number picked here:
    #   var Obo=0.95, Kwn="Approaching your 5-hour usage limit — ..."
    #   function Dbo(e){switch(e){case"default_claude_max_5x":return 0.99; ...
    #                            default:return Obo}}
    # The richer plans raise their own bar, but which plan this account is on
    # never reaches the wrapper, so the window warns at the conservative one.
    warn = re.search(rb'(?P<var>\w+)=(?P<pct>0\.\d+),\w+="Approaching your 5-hour',
                     data)
    check(warn is not None,
          "the default threshold still sits beside the warning string",
          "the bundle reshaped; re-read it before trusting the constant")
    if warn:
        binary_pct = round(float(warn.group("pct")) * 100)
        render = (STATIC / "js" / "render.js").read_text(encoding="utf-8")
        ours = re.search(r"const QUOTA_WARN_AT = (\d+);", render)
        check(ours is not None and int(ours.group(1)) == binary_pct,
              f"QUOTA_WARN_AT is the binary's default ({binary_pct}%)",
              f"render.js says {ours and ours.group(1)}")
        # The per-plan branches, recorded so a future reader knows the window is
        # choosing the low one on purpose rather than missing them.
        plans = re.findall(rb'case"default_claude_max_\d+x":return (0\.\d+)', data)
        check(len(plans) >= 2,
              f"the two per-plan thresholds are still there ({[p.decode() for p in plans]})",
              "the plan table changed shape")

    short = re.search(r"pastePlaceholderShort: \"([^\"]+)\"", strings_js)
    long = re.search(r"pastePlaceholder: \"([^\"]+)\"", strings_js)
    check(short is not None and "{n}" in short.group(1) and "{lines}" not in short.group(1)
          and long is not None and "{n}" in long.group(1) and "{lines}" in long.group(1),
          "strings.fa.js mirrors both shapes: #N alone, and #N with a line count")

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
