"""Gate for v2.6: the words. Every string the window says has one home, and
that home agrees with the table it was translated from.

    C:\\Python314\\python.exe persian-claude-gui\\test_strings.py

V2-PLAN.md §7 asked for exactly one of these — "a strings check that fails when
a key in the binary table has no entry in `strings.fa.js`" — and the phase that
regenerates the file is the phase where the rest of the chain is worth nailing
down too. The chain, and a gate on every arrow:

    claude.exe  ->  wiki/tui-strings.md  ->  static/strings.fa.js  ->  the page
                 test_tui_vocab.py      here                     test_dialogs.py

test_tui_vocab.py already holds the first arrow (the English the wiki quotes is
still in the installed binary) and test_dialogs.py holds the last (every `FA.*`
the modules read exists). This file holds the two in the middle, plus the two
rules that only matter once a phase is *about* the words:

  1. Every row of the wiki's §2-§5 tables names the `strings.fa.js` key it
     ships as, and that key is in the file. A row that ships nothing says `—`
     in BOTH the Persian and the key column, which is the only way to record a
     deliberate drop without it looking like an oversight.
  2. The two texts agree: the wiki's Persian is the shipped string, or a
     fragment of it (some shipped lines join two or three hints into one row).
  3. No English leaks into a Persian string. Key names (`Ctrl+O`, `shift+tab`),
     product names and `{placeholders}` are the whole of the allowlist — and
     the allowlist is a list, so adding to it is a decision somebody made on
     purpose rather than a word that slipped through.
  4. Nothing in `strings.fa.js` is dead: every top-level key is read by a
     module, named by one of the tables the modules resolve at paint time, or
     read out of `index.html`. The other direction is test_dialogs.py's.
  5. `/help` lists every command the window answers, and answers every command
     it lists. The verbs live in two files that cannot import each other
     (composer.js imports commands.js), so the comparison is here rather than
     in either of them.

Free: reads files, spawns nothing, costs no turn. Needs no browser and no
`claude` process.
"""

from __future__ import annotations

import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
STATIC = HERE / "static"
JS = STATIC / "js"
WIKI = HERE.parent / "wiki"
STRINGS_DOC = WIKI / "tui-strings.md"

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


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


# --- reading strings.fa.js ---------------------------------------------------

# `  someKey: "text",` at the top level (two spaces) and `    sub: "text",`
# inside a nested map (four). Indentation is the whole grammar here: the file
# is a flat object with a handful of small maps in it, and it has been formatted
# that way since 2026-08.
TOP_KEY = re.compile(r'^  ([A-Za-z_]\w*):', re.M)
TOP_STRING = re.compile(r'^  ([A-Za-z_]\w*): "((?:[^"\\]|\\.)*)"', re.M)
NESTED_STRING = re.compile(r'^    ([A-Za-z_"\'\-\w]+): "((?:[^"\\]|\\.)*)"', re.M)

PERSIAN = re.compile(r"[\u0600-\u06FF]")
# A run of two or more Latin letters. One letter is never a word — `N`, `x`.
LATIN_RUN = re.compile(r"[A-Za-z][A-Za-z'’\-]+")

# The only English allowed inside a Persian string, and why each one is here.
#   key names   — the chord IS its name; «کنترل+او» would be unreadable and
#                 would not match what is printed on the keyboard.
#   product     — «کلاد فارسی» is the product; Claude Code and Anthropic are
#                 names, and the window is careful to say it is not Anthropic's.
#   file names  — settings.json is a real path on the machine.
ALLOWED_LATIN = {
    # keys and chords
    "ctrl", "shift", "alt", "tab", "esc", "enter", "space", "backspace",
    "o", "r", "g", "l", "t", "p", "v", "j", "x",
    # names
    "claude", "code", "anthropic", "json", "md",
}


def latin_words(text: str) -> list[str]:
    # `{verb}`, `{lines}`, `{tool}` are substitution slots, not words on screen.
    text = re.sub(r"\{[a-zA-Z]+\}", " ", text)
    return [w for w in LATIN_RUN.findall(text)
            if w.lower() not in ALLOWED_LATIN]


# --- reading the wiki table --------------------------------------------------

ROW = re.compile(r"^\|(?P<cells>.*)\|\s*$")
SEPARATOR = re.compile(r"^\|[\s:\-|]+\|\s*$")
CODE = re.compile(r"`([^`]+)`")
QUOTED = re.compile(r"«([^»]*)»")
DASH = ("—", "-", "")


def wiki_rows(doc: str) -> list[tuple[str, str, str, str]]:
    """(id, persian, key, note) for every row of a table that carries a
    `strings.fa.js` column. The column is found by NAME, so a table that grows
    another column does not shift the reader off the data."""
    out: list[tuple[str, str, str, str]] = []
    header: list[str] | None = None
    prev: list[str] | None = None
    for line in doc.splitlines():
        m = ROW.match(line)
        if not m:
            header, prev = None, None
            continue
        cells = [c.strip() for c in m.group("cells").split("|")]
        if SEPARATOR.match(line):
            header, prev = prev or [], None
            continue
        if header is None:
            prev = cells
            continue
        if "strings.fa.js" not in header:
            continue
        col = {name: i for i, name in enumerate(header)}
        want = (col["id"], col["فارسی v2"], col["strings.fa.js"],
                col.get("یادداشت", -1))
        if max(want) >= len(cells):
            continue
        row_id, persian, key, note = (cells[i] if i >= 0 else "" for i in want)
        out.append((row_id.strip("`"), persian.strip(), key.strip("` "),
                    note.strip()))
    return out


def normalise(text: str) -> str:
    """Compare wording, not typography. «…» quotes, placeholder names and the
    space around them are chrome; a translation that differs only there is the
    same translation."""
    text = QUOTED.sub(r"\1", text).strip()
    text = re.sub(r"\{[a-zA-Z]+\}", "{}", text)
    return re.sub(r"\s+", " ", text).strip()


def main() -> int:
    strings_src = read(STATIC / "strings.fa.js")
    doc = read(STRINGS_DOC)
    index = read(STATIC / "index.html")
    commands = read(JS / "commands.js")
    composer = read(JS / "composer.js")

    top = {k: v for k, v in TOP_STRING.findall(strings_src)}
    keys = set(TOP_KEY.findall(strings_src))
    nested = {k.strip("\"'"): v for k, v in NESTED_STRING.findall(strings_src)}

    print("1. the binary's table and the shipped file name each other")
    rows = wiki_rows(doc)
    check(len(rows) > 20, f"wiki/tui-strings.md has {len(rows)} rows with a key column",
          "the «strings.fa.js» column is missing or unreadable")

    missing: list[str] = []
    unpaired: list[str] = []
    for row_id, persian, key, note in rows:
        if key in DASH:
            # A deliberate drop. It has to be dropped in BOTH columns, and it
            # has to say why, or "not translated" is indistinguishable from
            # "nobody got to it".
            if persian not in DASH and not note:
                unpaired.append(row_id)
            continue
        if key not in keys:
            missing.append(f"{row_id} -> {key}")
    check(not missing, f"every translated row's key is in strings.fa.js "
                       f"({len(rows) - len(missing)} of {len(rows)})",
          "; ".join(missing))
    check(not unpaired, "a dropped row says why it was dropped", "; ".join(unpaired))

    print("\n2. and the two texts agree")
    drifted: list[str] = []
    compared = 0
    for row_id, persian, key, _note in rows:
        if key in DASH or key not in top:
            continue
        want, have = normalise(persian), normalise(top[key])
        if not want or want in DASH:
            continue
        compared += 1
        if want != have and want not in have:
            drifted.append(f"{row_id}: doc «{want}» vs file «{have}»")
    check(compared > 15, f"{compared} rows compared word for word")
    check(not drifted, "no row's Persian drifted away from what ships",
          "; ".join(drifted[:3]))

    print("\n3. no English leaked into a Persian string")
    leaked: list[str] = []
    scanned = 0
    for key, value in list(top.items()) + list(nested.items()):
        if not PERSIAN.search(value):
            # Not a sentence: `slNone` is «—», the export labels are prose but
            # a value with no Persian at all is either punctuation or a name,
            # and both are checked by eye once rather than by rule forever.
            continue
        scanned += 1
        words = latin_words(value)
        if words:
            leaked.append(f"{key}: {' '.join(words)}")
    check(scanned > 80, f"{scanned} Persian strings scanned")
    check(not leaked, "every Latin word left in a Persian string is a key or a name",
          "; ".join(leaked[:4]))

    print("\n4. nothing in strings.fa.js is dead")
    # Three ways a key is legitimately read: `FA.thing` in a module, `"thing"`
    # in a table the module resolves at paint time (the key sheet, the label
    # loops in initComposer), and — for nothing yet, but the seam allows it —
    # a data attribute in index.html.
    used = set()
    body = ""
    for path in sorted(JS.glob("*.js")):
        src = read(path)
        body += src
        used |= set(re.findall(r"\bFA\.([A-Za-z_]\w*)", src))
        # `window.STRINGS?.copyCode` — bidi.js reaches the strings through the
        # global rather than through the module's own alias, because it also
        # runs inside the spec harness, where there is no import graph.
        used |= set(re.findall(r"\bSTRINGS\??\.([A-Za-z_]\w*)", src))
    named = set(re.findall(r'"([A-Za-z_]\w*)"', body)) | set(
        re.findall(r'"([A-Za-z_]\w*)"', index))
    orphans = sorted(k for k in keys if k not in used and k not in named)
    check(not orphans, f"all {len(keys)} top-level keys are read somewhere",
          "; ".join(orphans))

    print("\n5. /help lists every command the window answers")
    def entries(body: str, indent: int) -> set[str]:
        """Keys of an object literal at one indent level. `branch,` (shorthand)
        counts as much as `branch: fn` — the table uses both."""
        pattern = rf'^\s{{{indent}}}(?:"([a-z-]+)"|([a-z-]+))\s*[:,]'
        return {a or b for a, b in re.findall(pattern, body, re.M)}

    def table_verbs(src: str, name: str) -> set[str]:
        m = re.search(rf"(?:export )?const {name} = \{{(.*?)\n\}};", src, re.S)
        return entries(m.group(1), 2) if m else set()

    window_verbs = table_verbs(commands, "WINDOW_COMMANDS")
    lifecycle = table_verbs(composer, "LIFECYCLE_VERBS")
    arg_verbs = table_verbs(composer, "ARG_VERBS")
    answered = window_verbs | lifecycle | arg_verbs
    check(len(answered) > 15, f"the window answers {len(answered)} verbs itself",
          f"window={sorted(window_verbs)} lifecycle={sorted(lifecycle)} arg={sorted(arg_verbs)}")
    check("help" in window_verbs, "/help is one of them now (V2-PLAN §8.11A)")

    order = re.search(r"const HELP_ORDER = \[(.*?)\];", commands, re.S)
    listed = set(re.findall(r'"([a-z-]+)"', order.group(1))) if order else set()
    check(listed == answered,
          f"/help lists exactly the {len(answered)} verbs the window answers",
          f"missing from the list: {sorted(answered - listed)}; "
          f"listed with nothing behind them: {sorted(listed - answered)}")

    # composer.js names its two tables to commands.js in a comment-free
    # constant, because the two files cannot import each other. If that copy
    # ever stops matching, the help list is describing another window.
    mirror = re.search(r"const COMPOSER_VERBS = \[(.*?)\];", commands, re.S)
    mirrored = set(re.findall(r'"([a-z-]+)"', mirror.group(1))) if mirror else set()
    check(mirrored == (lifecycle | arg_verbs),
          "commands.js's copy of composer.js's verbs is still the same set",
          f"copy={sorted(mirrored)} real={sorted(lifecycle | arg_verbs)}")

    block = re.search(r"cmdHelp: \{(.*?)\n  \},", strings_src, re.S)
    described = entries(block.group(1), 4) if block else set()
    check(described == answered,
          f"and every one of them has a Persian line in cmdHelp",
          f"undescribed: {sorted(answered - described)}; "
          f"described but unanswered: {sorted(described - answered)}")

    print("\n6. the owner's review list points at real strings")
    # wiki/tui-strings.md §8 is the list V2-PLAN §8.10B asked for: everything v2
    # AUTHORED rather than translated, grouped by the phase that wrote it, so
    # the review is a read-through of one section. A key that has been renamed
    # or dropped since would send that review looking for a string that is not
    # there.
    section = doc.split("## 8.", 1)
    check(len(section) == 2, "the review section exists")
    if len(section) == 2:
        # The table rows only: the prose around them quotes `undefined` to say
        # what a missing key looks like, and that is not a claim about a key.
        listed_keys = set(CODE.findall(
            "\n".join(l for l in section[1].splitlines() if l.startswith("|"))))
        # The section also names the two rows that moved back into §2-§5 and
        # the file itself; only camelCase identifiers are claims about keys.
        listed_keys = {k for k in listed_keys if re.fullmatch(r"[a-z][A-Za-z]+", k)}
        unknown = sorted(k for k in listed_keys if k not in keys and k not in nested)
        check(not unknown, f"all {len(listed_keys)} keys the review list names still exist",
              "; ".join(unknown))

    print("\n7. the surfaces built out of string NAMES still resolve")
    # The key sheet and the label loop in initComposer resolve `FA[name]` at
    # paint time, so a rename shows up as «undefined» on screen rather than as
    # an error. test_dialogs.py checks `FA.x`; these are the other spelling.
    sheet = re.search(r"const KEY_SHEET = \[(.*?)\n\];", composer, re.S)
    sheet_keys = re.findall(r',\s*"(\w+)"\]', sheet.group(1)) if sheet else []
    check(len(sheet_keys) > 15, f"the key sheet names {len(sheet_keys)} strings")
    absent = [k for k in sheet_keys if k not in keys]
    check(not absent, "and every one of them is in strings.fa.js", "; ".join(absent))

    print("\n8. every /help line is a Persian sentence")
    blank = [v for v in described if not nested.get(v, "").strip()]
    check(not blank, "no command is described with an empty string", "; ".join(blank))
    notfa = [v for v in described if not PERSIAN.search(nested.get(v, ""))]
    check(not notfa, "and none of them is described in English", "; ".join(notfa))

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
