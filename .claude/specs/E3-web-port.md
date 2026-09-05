# E3 — Port the reachable CLI features into the web edition (beads pcg-4ob.3 – .8)

Context: `EDITIONS-PLAN.md`. Branch `v2`. Depends on E1. Work ONLY inside
`persian-claude-gui/static/` (the **web** edition) plus `run_spec_test.py` /
`static/spec-test.html`. Do NOT touch `static-terminal/`, `server.py`, `wiki/`, `*.md`.
The server routes already exist and are shared — reuse them exactly as contracted below; if a
route does not do what you need, report it, do not change it.

Read first: `wiki/frontend-modules.md`, `wiki/rtl-rendering-notes.md` (every new surface that
shows a path or a command uses `.path` / LTR isolation — rule 5 of the spec), `wiki/parity-chrome.md`
§slash. Design: this is the calm web shell — reuse its existing popup, card, chip and drawer
components; no new visual language. Skill for interaction feel: `emil-design-eng` (restraint).
UI text goes in `static/strings.fa.js` under `window.STRINGS` — never a literal in a module.

**Rule: nothing on `main`'s web chrome is removed or restyled.** `git diff main -- static/`
must be additive: new functions, new strings, new CSS rules, new spec cases.

## Contracts (measured on v2, scout 2026-09-05)

| Feature | Route | Shape |
|---|---|---|
| History | `GET /api/history?cwd=<path>` | `{"prompts": [str, ...]}` oldest→newest |
| `@` files | `GET /api/files?q=<query>` | `{"files": [paths], "source": str}` |
| `!` shell | `POST /api/shell` `{command}` | `{ok, stdout, stderr, code}`; result also arrives as a `wrapper` event with subtype `"shell"` |
| Ctrl+G editor | `POST /api/editor` `{text}` | `{text, changed}` |
| `/export` | `POST /api/export` `{text}` | `{ok, path}` |
| `/fork` | `POST /api/session/fork` `{}` | `{ok, tab, forked_from}` |
| Background tasks | assistant text containing `<task-notification>…` ; `GET /api/agents?id=<session>&cwd=<path>` | `{agents: [{id, kind, description, agentType, model, status, startedAt, finishedAt, summary}]}` |

The v2 implementation is the reference for behaviour, not for look:
`git show v2:persian-claude-gui/static-terminal/js/composer.js` (after E1) — `loadHistory`,
`stepHistory`, `openSearch`, `currentFileQuery`/`askFiles`/`acceptFile`, `refreshBashMode`/
`runBash`, `editExternally`; `commands.js` — `exportTranscript`, `branch`; `render.js` —
`renderShell`, `renderTaskNote`, `refreshAgents`.

## Builder A — composer features (composer.js, style.css, strings, spec) — beads .3 .4 .5 .6

**A1 History + Ctrl+R (.3).** Up/Down in an empty or unmodified composer walks
`/api/history` for the current tab's cwd, newest first, keeping the unsent draft
(`historyDraft`) and restoring it when walking past the newest. Ctrl+R opens the existing slash
popup component in "search" mode: type-to-filter over history, newest first, Enter inserts
into the composer (does not send), Esc closes. Load history once per tab open and after each
send. Main's composer has none of this today (scout: no `historyList`, no Up handling).

**A2 `@` completion (.4).** Trigger `/(?:^|\s)@([^\s@]*)$/` on the text before the cursor.
Open the same popup with `/api/files?q=` results (debounce 120 ms; one retry 400 ms after an
empty first answer, as v2 does — the index warms up). Pick inserts `@<path> ` at the cursor as
text; the CLI expands it. Paths render `.path`. Escape closes and leaves the typed text.

**A3 `!` shell mode (.5).** A composer whose text starts with `!` shows a visible bash indicator
on `.comp-box` (a `$`-style chip in the existing chip style, Persian label from strings). Enter
sends `POST /api/shell {command}` instead of a turn. The output renders as a tool-like card in
the transcript (reuse the existing tool card; LTR mono body; exit code in the header) from the
`wrapper/shell` event, so a reload replays it identically (`wiki/frontend-modules.md` §"A reload
RE-RENDERS every finished turn").

**A4 Ctrl+G editor (.6).** Ctrl+G posts the composer text to `/api/editor`, disables the
composer with a Persian placeholder while waiting, and on `{changed: true}` replaces the text;
focus returns either way. Add the chord to the web `?`/help key list if one exists in
`strings.fa.js`.

## Builder B — commands and tasks (commands/chrome/render/agents, strings, spec) — beads .7 .8

**B1 `/export` + `/fork` (.7).** Both are window-local commands. Add them to whatever list the
web slash popup renders window-local verbs from (it is rendered from `initialize.commands`; the
web edition's local verbs, if any, live in `chrome.js`/`commands.js` — find the seam, do not
add a second one). `/export` posts the transcript's text (build it from the DOM the way v2's
`textOf()` does) and shows the returned path as a `.path` toast/notice. `/fork` posts, switches
to the returned tab through the existing tab-switch path, and notes «شاخهٔ جدید» on the new tab.

**B2 Background tasks (.8).** Render an assistant text containing `<task-notification>` as a
compact notice card (the way v2's `renderTaskNote` does), not as raw markdown. The web agents
drawer already exists (`agents.js`) — after a notification, refresh it from `/api/agents`
(`refreshAgents`). `/tasks` stays a CLI command (v2 measured: not window-local).

## Acceptance (both builders)

- Each feature gets ≥ 1 assertion in `run_spec_test.py` / `static/spec-test.html`, negative-tested
  once (comment the assertion out → it must fail). New count reported.
- `PCG_UI=web`: `run_spec_test.py` PASS at the new count; `test_layout.py` PASS at three widths.
- `PCG_UI=terminal`: `run_spec_test.py`, `test_column.py` 22, `test_keys.py` 60 — unchanged, proving
  `static-terminal/` was not touched.
- `git diff main --stat -- persian-claude-gui/static/` shows no deleted lines in `index.html`
  other than the E1 `<title>` change; explain any deletion elsewhere in the report.
- No `smoke_test.py` run.

## Verify

```
cd persian-claude-gui
set PYTHONIOENCODING=utf-8
C:\Python314\python.exe run_spec_test.py
C:\Python314\python.exe test_layout.py
set PCG_UI=terminal
C:\Python314\python.exe run_spec_test.py
C:\Python314\python.exe test_column.py
C:\Python314\python.exe test_keys.py
```

Do not commit. Report ≤ 20 lines per builder: features done, new spec count, the negative test,
any route that did not behave as the table says.
