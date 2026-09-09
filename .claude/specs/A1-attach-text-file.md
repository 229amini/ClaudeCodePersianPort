# A1 — attach a non-image file (pcg-qmy.11)

User decision 2026-09-09: widen `/api/attach/paste` rather than document the workaround. Design from
an architect pass the same day, read out of the CLI 2.1.263 bundle and this PC's transcripts. The
route is settled; this spec is the how.

## What the gap is

TP1 removed the paperclip from the terminal edition to match the TUI's bare prompt, which removed the
only entry to the native file picker. Ctrl+V paste and TP1's drag-and-drop are **images only**
(`/api/attach/paste` accepts images only), and `@` covers text files already inside the project tree.
So an arbitrary text file from outside the project — one on the desktop — cannot be attached at all in
that edition.

## Measured facts this design rests on (do not re-derive, do not doubt)

- **A non-image attachment is already an `@path` mention**, not a content block (`server.py:1400-1430`,
  `wiki/parity-chrome.md:88`). The CLI resolves at-mentions in its own attachment pass: `Cps` → `a8e`
  → the Read implementation called directly, injected as an `isMeta` «Called the Read tool…» message.
  **Nothing rides `can_use_tool`** — no tool call the user must approve, no permission prompt — and
  the file enters `readFileState`, so a later Edit needs no Read first.
- **Absolute paths outside the cwd work.** This machine's own `~/.claude/projects/*.jsonl` carry
  `attachment/file` records for paths under `%TEMP%` and for a path containing a space.
- **The CLI's own limit is 256 KiB** (`the = 262144`, compared with `<=`), `.pdf` routes elsewhere
  (`HYe = {"pdf"}`), and **every CLI-side failure is silent** — `return null` plus telemetry. Too big,
  a `permissions.deny` Read rule, any read error: all indistinguishable from success at our layer.
  **The wrapper's door is therefore the only place a refusal can speak to the user.**
- **An unquoted `@path` dies on a space** (`@([^\s]+)\b`). `PASTE_DIR` is under `%TEMP%`, i.e.
  `C:\Users\<name>\…`, and `M8-acceptance.md` explicitly lists a username-with-a-space machine.
  `@"…"` is the CLI's own quoted form (mention regex `@"([^"]+)"`, and `Wps` splits on `#`).

## The change

1. `save_pasted_image` (`server.py:1377`) becomes `save_pasted_file(media_type, data, name)`. The
   image branch is **untouched**. Anything else must decode as text — `utf-8-sig`, or UTF-16 with a
   BOM re-encoded to UTF-8; a NUL byte means refuse — be **≤ 256 KiB**, and land at
   `PASTE_DIR/paste-<uuid8>-<safe stem><suffix>`.
2. The stored basename is sanitised: strip `"`, `#`, and any path separator. Nothing else from the
   client-supplied name is trusted, and `media_type` is ignored for text (Windows reports `""` for a
   `.log`). A suffix in `IMAGE_SUFFIXES` or `.pdf` on text content becomes `.txt`, or the CLI routes
   it to the wrong decoder.
3. `build_message_blocks` (`server.py:1425`) emits the mention **quoted**: `@"<path>"`. This also
   fixes the web edition's existing space-path bug — see Blast radius.
4. `_read_body` (`server.py:3452`) gains `MAX_BODY_BYTES = 8 MiB` answering **413**. It has no cap at
   all today; the client's `image/*` filter was the only thing bounding it.
5. Terminal client (`static-terminal/js/composer.js:1384-1437`): drop and paste stop filtering
   `image/*`, send `name`, and **pre-check `file.size` before base64** so a huge file is never encoded
   in the tab. One new Persian string in `static-terminal/strings.fa.js` — `pasteFailed`, stating the
   rule («… فقط عکس یا فایل متنی تا ۲۵۶ کیلوبایت»). Leave `keyPaste` alone, it is a wiki row.
6. `static-terminal/help.html:442-447` gains the one line the colleague will actually read.

## Blast radius on the web edition

`static/` is **not** edited. The only behaviour change there is item 3: the paperclip's echo becomes
`@"C:\…"` instead of `@C:\…`, which fixes attaching any file whose path contains a space. Do not
touch the image block, `/api/attach/pick`, or anything else in the web tree.

## Acceptance

- `test_units.py`: a text payload named «گزارش ماهانه.txt» lands under `PASTE_DIR` with identical
  bytes and a basename free of `"`, `#`, `\`, `/`; `x.png` and `x.pdf` carrying text become `.txt`;
  `PK\x03\x04…\x00…` returns None; 256 KiB + 1 returns None; a UTF-16-BOM file is stored as UTF-8;
  `..\..\x.txt` stays inside `PASTE_DIR`. The five existing image checks are unchanged.
- `test_units.py`, the one regression line that matters: `build_message_blocks("hi", [p])` produces
  `hi @"<p>"`. **Negative-test it by reverting the quote** — this is the assertion that protects the
  space-path fix in both editions.
- `test_shell.py` (fetch stub at :93): dropping `new File(["salam"], "note.txt", {type:"text/plain"})`
  on `.composer` posts `/api/attach/paste` with `name:"note.txt"` and `data` = base64("salam"), and
  shows one chip in `.attachments`; a 300 KiB File makes **no call** and shows one error bubble; a
  stubbed 400 shows the same bubble; an `image/png` File still posts as it does today. Today the text
  drop makes no call at all — that is the assertion that fails before the fix.
- `static/` byte-identical apart from item 3's effect: prove it with `git diff --stat`.
- Gates: `run_spec_test.py` **212/212** web and **179/179** terminal (these are today's numbers — the
  architect's skeleton quotes 202/174, which is stale), `test_units.py`, `test_shell.py` 33+,
  `test_strings.py`, `test_layout.py` both editions, `test_reload.py` both, `test_split.py` both.
- **No smoke run required.** Say so explicitly in the report rather than spending a turn.

## The one honest gap

`@` over the stream-json pipe is **bundle-read, never paid-proven** (`wiki/cli-stream-json-findings.md`
§5.2). v2.3's `@` menu already stands on it, so this adds no new risk, but it is not proven either.
Record it in that wiki section along with `Cps`/`a8e`, the 256 KiB limit and the silent-null
behaviour. Fold an `@"<temp>.txt"` plus a token word into the next scheduled smoke turn; do not spend
one here.

Also record: no `PASTE_DIR` cleanup exists (it does not for images either), and the file's content
lands in the transcript jsonl regardless, so the temp copy adds no exposure. A boot-time sweep of
files older than seven days is optional and explicitly **not** part of this task.
