# Handoff — 2026-09-04

## Where we are

**Branch `v2`**, cut from `main` at `984831f`. v1 is finished and green on `main`; v2.0
(Vocabulary) is built and gated on `v2`. Working tree clean, nothing pushed.

## v1 — release readiness

Every free gate re-run on this machine today, against `claude` **2.1.260**:

| Gate | Result |
|---|---|
| `test_units.py` | PASS |
| `run_spec_test.py` | **PASS — 174/174** |
| `test_layout.py` | PASS — 3 window sizes |
| `test_transcript_path.py` | PASS |
| `test_no_console.py` | PASS (pythonw.exe answered) |
| `probe_queue.py` | **PASS — 8/8**, `total_cost_usd = 0` |

`smoke_test.py` (16 checks, one paid subscription turn) was **not** re-run today — it was last
green on 2026-08-15 at 15/15, before it grew its 16th check. It is the only gate that costs
anything and the only one whose current state is inferred rather than observed.

**Two things are not what earlier notes claim, and both matter for a release:**

1. **There is no `v1.0.1` tag.** `git tag -l` is empty, locally and on `origin`. The version
   lives only in `server.py` (`APP_VERSION = "1.0.1"`) and in the subject line of commit
   `5fc2cea`. Whoever releases has to create the tag; nothing to fix, but nothing to rely on
   either.
2. **`main` is one commit ahead of `origin/main`** (`984831f`, the v2 plan). Unpushed.

The spec gate's number has been **174**, not 103, since the 2026-08-31 pass. The 103 figure in
the old handoff was three passes stale; CLAUDE.md's gate table said 171 and has been corrected.

**Remaining before v1 ships:** `M8-acceptance.md` on the second PC (cannot be done from this
machine), and one `smoke_test.py` run if the release wants that gate observed rather than
assumed.

## DONE this session — v2.0 Vocabulary (`pcg-qmy.1`)

`persian-claude-gui/extract_tui_vocab.py` — reads `claude.exe` as a file (free, spawns nothing)
and parses the TUI's own keybinding table out of it. The binary is a single-file Node SEA, so
the bundled JS is inside it verbatim and the table is findable as source text. 206 bindings
across 25 contexts, plus context descriptions, the "cannot be rebound" list, 21 user-visible
strings and 12 glyphs.

`wiki/tui-keys.md` and `wiki/tui-strings.md` — the two deliverables, each row carrying a Persian
column. `test_tui_vocab.py` (72 checks, free) holds them to the installed binary.

## Hard-won facts not written anywhere else

- **The binary self-updates overnight.** 2.1.259 → 2.1.260 between V2-PLAN.md being written
  (2026-09-03) and this branch being cut (2026-09-04). Nothing announced it. `probe_queue.py`
  still passes 8/8, so the engine contract held — but this is exactly why V2-PLAN §3.6 says to
  generate the key table rather than write it, and why `test_tui_vocab.py` exists.
- **Two chords in the table are computed keys** (`[de]`, `[V]`) resolved from the platform just
  above the table. Keying a lookup by *action* silently loses one of them, because `V` resolves
  both `chat:cycleMode` and `confirm:cycleMode`. Key by variable name. Both are `shift+tab`.
- **Image paste is `alt+v` on Windows, not `ctrl+v`.** `ctrl+v` appears in the bundle only
  inside a `...B==="wsl"&&{…}` spread. A naive grep counts it as a default and gets 207
  bindings instead of 206. v2 binds both anyway — deliberate, recorded in tui-keys.md.
- **The permission dialog's first option is the bare string `Yes`**, not "Yes, allow once".
  Option 3 is `No, and tell Claude what to do differently ` (trailing space) plus a **bold**
  `(esc)` appended as a separate node. Verified at the construction site, not guessed.
- **The bundle escapes non-ASCII**, so «— Claude will wrap up» is stored as `—` and
  «esc to close · esc again quits» as `\xB7`. A plain substring search for the literal reports
  drift that is really an encoding; the gate tries both escape forms.
- **`⎿`, `⏵` and `▸` carry no Unicode mirroring property.** An RTL column has to flip them by
  hand. This is the one place where copying the TUI's glyph verbatim draws the *wrong* picture,
  and the TUI has never run RTL so there is no precedent to copy.
- The TUI has a `MessageSelector` context (15 bindings) described as "the message selector
  (rewind)", and the string `Double-tap esc to rewind the conversation to a previous point in
  time`. V2-PLAN §4 leaves rewind out pending a control-subtype probe (§5.6) — the *feature*
  exists in the TUI, so that probe is worth running rather than assuming.

## REMAINING — in order

1. **User review of the Persian column** — `wiki/tui-strings.md` §7 lists the six rows where the
   translation was a judgement call, not a rendering. That is the rest of `pcg-qmy.1`'s exit
   criterion; the files and the gate are done.
2. **v2.1 Probes** (`pcg-qmy.2`) — V2-PLAN §5's ten measurements, all free but one. §5.6
   (rewind subtype) now has a reason to be run first: see above.
3. M8 acceptance on the colleague's PC, still the only thing standing between v1 and a release.

## Notes for whoever picks this up

- Commits on `v2` are small and sequential; nothing is pushed and `main` is untouched.
- `test_tui_vocab.py` was negative-tested four ways: Persian stripped from a row, a wrong
  per-context count, a quoted string the binary lacks, and a binary with no table. Each
  produces exactly one named failure.
- Re-run `extract_tui_vocab.py` after any CLI upgrade; if the gate fails on a new build, the
  docs are stale, not the binary.
