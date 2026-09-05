"""Gate for v2.4: the dialogs are numbered lists in the flow, and nothing opens
them by chip any more.

    C:\\Python314\\python.exe persian-claude-gui\\test_dialogs.py

What test_keys.py already covers is the KEYS — a digit answers, Esc refuses,
Tab reaches the note box. Those need a browser and it has one. This file covers
what a browser cannot see: the shape of the thing before it runs. A dialog that
is opened with showModal() still answers every key correctly while floating on
top of the transcript with a backdrop behind it — the exact thing V2-PLAN §3.3
says v2 stops doing — and a chip that is deleted from index.html but still
clicked by controls.js is a picker that works everywhere except the window.

What it asserts:

  1. The chips are gone from index.html and so is the popup they opened, and
     the two dialogs live in #stage, above the prompt. (V2-PLAN §2, §3.3.)
  2. The permission form has no submit button at all. The 2026-08-31 report
     was "Enter in the note field silently refuses the tool", which is what an
     implicit submit does when the first button is the refusal; the fix is
     structural, so the structure is what is checked.
  3. The dialogs are opened with show(), never showModal(), and the CSS that
     made them modal is gone with it.
  4. The pickers are behind the commands: /model, /effort, /output-style and
     /permissions each map to an opener, and controls.js no longer carries the
     hand-positioning the popup needed.
  5. js/choice.js is a leaf — it imports nothing — because three unrelated
     owners (the confirmation, the pickers, the audit trail) share it, and a
     leaf is the only shape that cannot deepen the module cycle
     (wiki/frontend-modules.md).
  6. The digit is never part of a label (§8.2) and the remember scope never
     names a directory (§8.1) — the two wording rules the plan wrote down
     because both are easy to undo by accident while translating.
  7. Every FA.* key the window reads exists in strings.fa.js. A missing one
     renders «undefined» in Persian text, which reads as a bug in the model's
     answer rather than in the window.

Free: reads files, spawns nothing, costs no turn.
"""

from __future__ import annotations

import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
STATIC = HERE / "static"
JS = STATIC / "js"

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


def strip_comments(src: str) -> str:
    """Source without /* */ and // comments.

    Every "the old way is gone" check below is a search for a name that is
    ALSO written in the comments explaining why it went. Without this the
    checks would pass only as long as nobody explained themselves.
    """
    src = re.sub(r"/\*.*?\*/", " ", src, flags=re.S)
    return re.sub(r"(?m)^\s*//.*$", " ", src)


def main() -> int:
    html = read(STATIC / "index.html")
    css = read(STATIC / "style.css")
    chrome = read(JS / "chrome.js")
    controls = read(JS / "controls.js")
    composer = read(JS / "composer.js")
    choice = read(JS / "choice.js")
    strings = read(STATIC / "strings.fa.js")

    # --- 1. the shape of the page --------------------------------------------
    gone = [c for c in ("model-chip", "effort-chip", "style-chip", "posture-chip",
                        "menu-popup") if f'id="{c}"' in html]
    check(not gone, "the capability chips and their popup are out of index.html",
          f"still there: {gone}")
    # The audit counter stays: it reports what already happened, it is not a
    # control, and V2-PLAN §2 keeps it for that reason.
    check('id="auto-chip"' in html, "the audit counter stays — it is a label, not a control")

    stage = html.index('<div id="stage">')
    perm, picker = html.index('<dialog id="perm"'), html.index('<dialog id="picker"')
    comp = html.index('<form id="composer">')
    check(stage < picker < comp and stage < perm < comp,
          "both dialogs sit inside #stage, above the prompt",
          f"stage@{stage} picker@{picker} perm@{perm} composer@{comp}")

    form = html[html.index('<form id="perm-form">'):html.index("</dialog>", perm)]
    buttons = re.findall(r"<button[^>]*>", form)
    check(bool(buttons) and all('type="button"' in b for b in buttons)
          and "method=" not in form,
          "the permission form has no submit button and no dialog method",
          f"{len(buttons)} buttons")

    # --- 2. in the flow, not over it ------------------------------------------
    code = strip_comments(chrome) + strip_comments(controls)
    check("showModal()" not in code and ".show()" in code,
          "the dialogs are opened with show(), never showModal()")
    check("#perm::backdrop" not in css and "#picker::backdrop" not in css,
          "and no backdrop rule survives the move")
    inline = re.search(r"#perm,\s*\n#picker\s*\{(.*?)\}", css, re.S)
    check(inline is not None and "position: static" in inline.group(1)
          and "flex: none" in inline.group(1),
          "#perm and #picker are static, non-shrinking rows of the stage")

    # --- 3. pickers behind commands -------------------------------------------
    verbs = re.search(r"const LIFECYCLE_VERBS = \{(.*?)\n\};", composer, re.S)
    body = verbs.group(1) if verbs else ""
    missing = [v for v in ("model:", "effort:", '"output-style":', "permissions:")
               if v not in body]
    check(not missing, "/model, /effort, /output-style and /permissions open the pickers",
          f"unmapped: {missing}")
    dead = [n for n in ("positionMenu", "openMenu", "closeMenu", "toggleMenu")
            if n in strip_comments(controls)]
    check(not dead, "and the popup's hand-positioning is gone with the popup",
          f"still there: {dead}")
    for name in ("openModelPicker", "openEffortPicker", "openStylePicker",
                 "openPosturePicker", "openAuditList"):
        check(f"export function {name}" in controls, f"controls.js exports {name}()")

    # --- 4. choice.js is a leaf ------------------------------------------------
    check(not re.search(r"^\s*import\b", choice, re.M),
          "js/choice.js imports nothing — the option list is a leaf")
    for owner, name in ((chrome, "chrome.js"), (controls, "controls.js")):
        check('from "./choice.js"' in owner, f"{name} draws its list from choice.js")

    # --- 5. the two wording rules ---------------------------------------------
    labels = {}
    for key in ("permYes", "permYesRemember", "permNoFeedback", "planTitle"):
        m = re.search(rf'^\s{{2}}{key}: "([^"]*)"', strings, re.M)
        labels[key] = m.group(1) if m else None
    check(all(labels.values()), "the option labels are in strings.fa.js",
          f"missing: {[k for k, v in labels.items() if not v]}")
    numbered = [k for k, v in labels.items() if v and re.match(r"^[0-9\u06f0-\u06f9]", v)]
    check(not numbered, "no label carries its own number (V2-PLAN §8.2)", f"{numbered}")
    escaped = [k for k, v in labels.items() if v and ("esc" in v.lower())]
    check(not escaped, "and none of them carries its own «(esc)»", f"{escaped}")
    # The digit and the (esc) are elements, which is the only way they keep
    # their place in an RTL line — and the only way «۲» can be left out when
    # there is no remember scope to offer.
    check('"opt-num"' in choice and '"opt-esc"' in choice,
          "choice.js draws both as their own elements")

    remember = labels["permYesRemember"] or ""
    check("{tool}" in remember, "the remember option names the tool it stops asking about")
    # §8.1: this project, this session. No path, because no path is what the
    # window sends — `remember: true` is scoped by the process it is sent to.
    directory = [w for w in ("\u067e\u0648\u0634\u0647", "\u0645\u0633\u06cc\u0631",
                             "C:\\", "/") if w in remember]
    check(not directory, "and it promises no directory-wide scope (§8.1)", f"{directory}")

    # --- 6. every string the window reads exists ------------------------------
    keys = set(re.findall(r"^\s{2}([A-Za-z_]\w*)\s*:", strings, re.M))
    used: dict[str, set[str]] = {}
    for path in sorted(JS.glob("*.js")):
        for key in re.findall(r"\bFA\.([A-Za-z_]\w*)", read(path)):
            used.setdefault(key, set()).add(path.name)
    absent = {k: sorted(v) for k, v in used.items() if k not in keys}
    check(not absent, f"all {len(used)} FA.* keys the window reads are in strings.fa.js",
          f"{absent}")
    # `keyDialogPick` is named rather than read: the key sheet is a table of
    # [chord, string-name] pairs that composer.js resolves at paint time.
    named = "".join(read(path) for path in sorted(JS.glob("*.js")))
    for key in ("permProceed", "permHint", "permFeedbackMoved", "planBody",
                "askHint", "pickerHint", "keyDialogPick"):
        check(key in keys and (key in used or f'"{key}"' in named),
              f"and the dialog's «{key}» is one of them")

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
