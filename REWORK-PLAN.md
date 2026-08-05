# REWORK-PLAN.md — ClaudeCode Persian Port: rework to a premium open-source product

**Date:** 2026-08-05. Pinned to `claude` 2.1.221. Every phase ends shippable with all gates green.

**Ground truth:** `wiki/permission-hook-broken.md` and `wiki/control-protocol.md` (both measured
2026-08-05) override anything older. `claude-persian-rtl-spec.md` stays the binding rendering
contract. Stdlib only, SSE+POST, Edge `--app`, no respawn for state changes, unknown events →
collapsed raw card.

**Pre-flight (before Phase 0):** the working tree is dirty on top of commit `43a0567` — the entire
2026-08-05 shell redesign is uncommitted. Commit it as-is first. Nothing below starts on an
uncommitted baseline; bisectability is the one asset a restructure can silently destroy.

---

## Phase 0 — Permission transport spike ✅ DONE 2026-08-05

**Result: hypothesis 1 confirmed on the first try.** `--permission-prompt-tool stdio` (hidden from
`--help`, present in the parser) routes approvals to inbound `can_use_tool` control requests.
Verified **allow and deny** end to end, including a Persian denial message round-tripping.
Full shapes and implementation notes in **[wiki/permission-transport.md](wiki/permission-transport.md)**.

Consequences for the phases below: no fallback needed (F1/F2 are dead letters), the approval pill
is buildable as designed, and Phase 1 additionally **deletes** `permission_hook.py`, `space_safe()`
(server.py:98–124), the `_write_settings()` hook wiring (server.py:603–645), the
`/api/permission/request` HTTP callback, and the `PCG_ENDPOINT`/`PCG_TOKEN` env plumbing. The
payload also hands us `permission_suggestions`, `display_name` and `description` — use them instead
of the wrapper's hand-rolled equivalents.

The original spike brief is kept below for the record.

---

### (historical) the blocker as it stood

Nothing about the approval pill can be designed until `can_use_tool` is working or ruled out.
Hooks via `--settings` are dead on this build (verified in every mode, both hook events, file and
inline). The current gate is inert: unattended writes under `defaultMode: auto`, silent denial
under `default`.

**Probes, in order (stop at first success):**

1. **Hidden spawn flag `--permission-prompt-tool stdio`.** The binary gates the inbound path near a
   `Jpe() !== "stdio"` check, and the Agent SDK's `canUseTool` is enabled by exactly this flag
   value. "Absent from `--help`" does not mean absent from the arg parser. Spawn with it, send
   `initialize` with `{"capabilities":{"canUseTool":true}}`, request a `Write`, watch for an
   inbound `{"type":"control_request","request":{"subtype":"can_use_tool",...}}` on stdout.
2. Same flag without the capability field; capability field with other spellings (`can_use_tool`,
   top-level `canUseTool`); `initialize` carrying a `hooks` key (the SDK passes hook config there).
3. Strings-grep the installed binary around `Jpe(` / `can_use_tool` / `permission-prompt-tool` for
   accepted flag values and the initialize schema (read-only, free).
4. Env-var variants (`CLAUDE_CODE_*PERMISSION*`) found in step 3.

**Deliverables:** `persian-claude-gui/probe_control.py` (drives a raw `claude -p` child; free
section: `initialize`, unsupported-subtype feature detection; paid section behind `--paid`) and
`wiki/permission-transport.md` with the verdict matrix.

**If `can_use_tool` works (expected):** the reply is a `control_response` with
`{behavior:"allow"|"deny"}`; `PermissionBroker` keeps its exact shape — only the transport changes
(in-band instead of hook→HTTP). `permission_hook.py`, `space_safe()` (server.py:98), the 8.3 hack,
the `_write_settings()` hook wiring (server.py:603–645), and the "username with a space kills
approvals" failure mode all get **deleted**. That deletion is the single biggest reliability win
available.

**Fallback if not found (decide in this order):**

- **F1 (default): wrapper-owned posture at spawn + honest UI.** Map the pill to state the CLI does
  honor: `--permission-mode` + `--allowedTools`/`--disallowedTools` at spawn, `set_permission_mode`
  live (measured working; bind to the `system/status` echo). Three postures: read-only (allow only
  `AUTO_ALLOW`, server.py:51), edits-in-project, full-auto-with-audit. The UI **says plainly** that
  per-call approval dialogs are unavailable on this CLI build; render `permission_denials[]` from
  `result` and the auto-deny events honestly. Never show a dialog that does nothing.
- **F2 (opt-in only): user-settings hook.** Hooks from the real `~/.claude/settings.json` DO fire
  (`SessionStart` proves it every run). Offer an explicit, consented, reversible edit adding the
  PreToolUse hook there — restores the true per-call dialog at the cost of touching the user's
  config. Gate behind a settings screen with backup + one-click removal. Never default.

**Exit criterion:** written verdict in `wiki/permission-transport.md`; approval-pill design selected.

---

## Phase 1 — Control plumbing in `server.py` (capability-mirror foundation)

`server.py` stays **one module** (`test_transcript_path.py` imports it and monkeypatches
`PROJECTS_DIR`; the seams are already `Hub`/`PermissionBroker`/`ClaudeSession`). No event bus.

- `ClaudeSession`: generic `control(subtype, timeout=10, **params)` — write
  `{"type":"control_request","request_id":f"pcg-{n}",...}` via `_write_line` (server.py:748), park a
  `threading.Event` in a pending map, return the matched response. Refactor `interrupt()`
  (server.py:764) onto it.
- `_read_stdout` (server.py:695): new branch for `type == "control_response"` → resolve the pending
  waiter; unmatched responses are dropped (never rendered).
- `start()` (server.py:647): after spawning readers, fire `initialize` on a thread; cache as
  `self.init_info` and `hub.publish({"type":"wrapper","subtype":"init_info",...})` so it lands in
  Hub history and reaches reconnecting windows. Re-fires on every `restart()`.
- New route `POST /api/control` in `Handler.do_POST` (server.py:913): whitelist
  `{set_model, set_permission_mode, set_max_thinking_tokens, compact, rename_session,
  get_context_usage, get_usage}`, synchronous reply. One chokepoint, no per-feature endpoints.
- Extend `/api/status` (server.py:1067) with `init_info`.
- **Free probes to fold in:** does `rename_session` persist a title anywhere readable (transcript
  line? sessions index?) — decides how the sidebar consumes it. Does `apply_flag_settings` accept
  `--effort` — decides whether effort is a live control or spawn-only.

**Feature detection rule:** branch on `"Unsupported control request subtype"` errors, never on
version strings.

**Gates:** `test_transcript_path.py` (free), `probe_control.py` free section, `smoke_test.py` (1 paid turn).
**Exit:** `initialize` data served on `/api/status`; `set_model haiku` mid-session verified via the
next turn's `system/init.model`.

---

## Phase 2 — Migration gate: module split (LOW end) + CSS layers

Pure refactor. **Zero behavior change; spec-test assertions byte-identical.**

**The gate, first commit:** `static/spec-test.html` loads app.js as a classic script and its inline
classic block reads `window.renderEvent`. Modules defer — with a module app.js, all 11 assertions
fail in a way that looks exactly like a BiDi regression. **In the same commit** that converts
app.js, change spec-test.html's inline harness block to `<script type="module">` (modules execute
in document order after the app module, so `window.renderEvent` exists). Assertion code
byte-identical.

**Module layout (5 files, `static/js/`):**

| file | from | contents |
|---|---|---|
| `bidi.js` | app.js:33–115 | `TECHNICAL`, `isolateTechnicalTokens`, `applyDirection`, `renderMarkdown`, `pathEl` |
| `render.js` | app.js:117–423 | `renderEvent`, renderer `state`, bubble/card/label/block builders, todos, raw, statusline |
| `chrome.js` | app.js:425–887 | sidebar/projects/sessions/replay/home + permission dialog |
| `composer.js` | app.js:918–1095 | input, ZWNJ, attachments, slash |
| `app.js` | rest | entry: SSE transport, wiring, `window.renderEvent`/`window.renderMarkdown` exports (kept — spec-test depends on them) |

`strings.fa.js` and `vendor/marked.min.js` stay classic scripts (they set `window` globals and
finish before any module runs). Module subresources are same-origin and carry the host-only cookie.

**CSS:** `style.css` stays ONE file, reorganized under `@layer tokens, base, layout, components,
state`. The binding spec block (style.css:69–91) moves intact — byte-identical rules. Layering can
flip previously order-resolved conflicts (known traps: style.css:97 `[hidden]`, the `button:hover`
leak at style.css:626) — the spec-test computed-style assertions plus a visual pass are the gate.

**Gates (every extraction step):** spec-test 11/11 + `smoke_test.py` + `test_transcript_path.py`.
One extraction per commit.

---

## Phase 3 — Spec rule 8 + test cases 9–12 (BiDi at the moment of consent)

**The real gap:** `.tool-output`/`.path` force `direction:ltr` (style.css:79–90 — correct for
*containers*), but `renderParams()` (app.js:837) routes EVERY string param through `pathEl`, and
app.js:315 dumps `JSON.stringify(part.input)` into `.tool-output`. Persian file content and a
Persian `Edit.new_string` therefore render with LTR base direction exactly when the user is
deciding whether to approve.

**Fix — per-line `dir="auto"` wrapper inside the LTR container** (NOT run-level `<bdi>`, which
strands adjacent digits outside the isolate):

- New `bidi.js` helper `linesAuto(text)` → fragment of `<div dir="auto">` per line (empty lines
  preserved).
- New shared `renderParamRows(toolInput)` used by BOTH the tool card and the permission dialog:
  single-line path-ish values → `pathEl`; multi-line strings (`Write.content`,
  `Edit.new_string`/`old_string`) → `.tool-output` block filled by `linesAuto`. Kills the raw JSON
  dump at app.js:315 and unifies with app.js:837–854.
- `tool_result` rendering (app.js:337–343): route string content through `linesAuto` inside
  `.tool-output`.

**Spec amendment:** add rule 8 to `claude-persian-rtl-spec.md` (LTR containers must give each
content line its own `dir="auto"`), and cases 9–12 to spec-test.html:

9. Tool card with Persian `Write.content` — Persian lines right-aligned inside the LTR box.
10. Permission params for an `Edit` with a Persian `new_string`.
11. `tool_result` with mixed Persian/Latin lines, each line correct.
12. Persian line with adjacent Latin digits inside tool output — digits stay attached to their line.

The existing 8 cases are message-shaped and structurally cannot catch this.

**Gate:** spec-test **18/18** — the 4 new cases produce 7 assertions, not 4. This is the number every later phase must hold.

---

## Phase 4 — Capability-mirror composer (the premium core)

The GUI hardcodes nothing: it renders what `initialize` returned and mutates via `/api/control`.

1. **Jalali dates + Persian numerals** (do first — loudest signal per line of diff). `whenLabel`
   (app.js:469–475) → `new Intl.DateTimeFormat('fa-IR', {month:'short', day:'numeric',
   hour:'2-digit', minute:'2-digit'})` — `fa-IR` gives the Persian calendar and Persian digits,
   correct for prose chrome per spec rule 5. Statusline cost/context/session-id stay Latin.
2. **Slash ownership split.** Populate from `init_info.commands` (objects with
   `description`/`argumentHint`; fall back to `init.slash_commands` names at app.js:271). Popup
   rows: LTR monospace name + `dir="auto"` description. Fix the two real bugs:
   (a) `currentSlashQuery` (app.js:1024) — match `^\/(\S*)$` against the **active segment** (text
   from the last `\n` before the cursor to the cursor), not the whole composer;
   (b) **Enter always sends** — delete the `if (slashOpen()) { acceptSlash(); return; }` intercept
   (app.js:943); Tab/click/arrows accept.
   Lifecycle verbs intercepted into native UI, never sent as text: `/model` → picker, `/compact` →
   `/api/control compact`, `/clear` → new chat, approval → pill menu. Everything else passes through.
3. **Inline model+effort picker** in the comp-row (index.html:83–115, next to `proj-chip`):
   rendered purely from `init_info.models` — `displayName`, `description`, per-model
   `supportsEffort`/`supportedEffortLevels` (Haiku reports none; never assume). Switching sends
   `set_model` live. Effort: live only if the Phase-1 `apply_flag_settings` probe passed; otherwise
   shown as spawn-time and greyed with an honest tooltip.
4. **Approval pill, 3 options** (per Phase 0 outcome). Three clearly-explained Persian postures; the
   wrapper-owned `PermissionBroker` stays the single chokepoint with an audit trail (session-scoped
   decision log, surfaced as an «N اقدام خودکار» chip). Pill state binds ONLY to the `system/status`
   `permissionMode` confirmation — never optimistic. Never sends `bypassPermissions` (engine refuses
   it) and never `auto` via control (gated).
5. **Real session titles:** on the first `result` of a fresh session, call `rename_session` with a
   truncated first-prompt title (or let the user rename from the sidebar); sidebar consumes whatever
   store the Phase-1 probe located, replacing the 160-char preview-as-title.
6. **Statusline truth:** `get_context_usage`/`get_usage` on each `result` instead of client-side
   arithmetic (app.js:349–358 stays as fallback).

**Gates:** spec-test 18/18; manual: model switch reflected in the next turn's `system/init`; pill
follows `system/status`.

---

## Phase 5 — Codex-style shell + rebrand

1. **Home state, 4 action cards** above the composer (index.html:60–67 already has the section),
   each wired to existing endpoints only: resume last session (`/api/session/resume`), open folder
   (`/api/project/pick`), a starter prompt («این پوشه را برایم توضیح بده»), help. No new server code.
2. **Sidebar hover preview cards:** on 300 ms hover over a session row, lazy-fetch
   `/api/session?id=…&cwd=…`, cache in a Map, float a card with the first 2–3 exchanges (plain text,
   `dir="auto"`, paths through `pathEl`). Endpoint already exists; zero server change.
3. **Rebrand** per the branding decision: title, `assets/icon.ico` regenerated, brand string in
   `strings.fa.js` / index.html:6,21, shortcut name in setup.ps1:219.
4. `help.html` updated — it is the only doc the end user reads; every behavior change in Phases 3–5
   lands there.

**Gates:** spec 18/18; the chrome-path sweep (M8-acceptance.md §5) run manually — hover cards and
action cards add new path-bearing chrome, exactly the class of regression the spec cases can't catch.

---

## Phase 6 — Open-source scaffolding + release

**Needed (justified):**

- `README.md` — bilingual; the positioning statement below; screenshots; the security model
  (127.0.0.1, random port, single-use token, host-only cookie); a "costs real subscription turns"
  note on `smoke_test.py`.
- `LICENSE` — MIT. Maximum contributability, no copyleft friction for a Windows end-user tool.
- `CONTRIBUTING.md` — short: run commands, the three silent encoding traps from `wiki/packaging.md`,
  "the spec is binding — cite rule numbers", which checks gate what.
- `.gitignore` additions — `recents.json`, `archived.json`, `setup-log.txt`, `__pycache__/`.
- **i18n seam:** one line — the renderer reads `window.STRINGS` (aliased to `window.FA` in
  strings.fa.js). Ship no `strings.en.js` until someone asks.

**YAGNI (explicitly not doing):** CI (the CLI can't run in CI, so only `test_transcript_path.py`
would execute — not worth the scaffolding until a contributor exists), issue/PR templates, a code of
conduct beyond one line, a plugin system, an English UI.

**Exit:** fresh clone → `setup.ps1 -DeployRoot <tmp> -ProjectDir <tmp> -ShortcutDir <tmp>
-SkipSmokeTest` twice, idempotent.

---

## Phase 7 — Bare-machine acceptance (M8′)

`M8-acceptance.md` updated for the new UI (pill postures replace the M4 dialog rows if Phase 0
landed F1; spec table says 12 cases). **Before** the colleague's PC: run the four never-executed
install branches (Python install, claude install, `-Payload`, not-logged-in) in a clean Windows
VM/Sandbox — they have never run anywhere, and a restructure must not meet its first bare machine
and its first install-branch execution on the same day.

---

## Leverage ranking — the 20% that buys the premium feel

1. **Phase 0 + honest approval posture** — a file-editing agent whose safety gate silently does
   nothing is the opposite of premium; trust is the product.
2. **initialize-driven composer** (rich slash popup with descriptions + live model/effort picker) —
   the moment it stops feeling like a wrapper.
3. **Jalali dates + Persian numerals** — near-zero diff, the loudest "a Persian speaker built this"
   signal available.
4. **Per-line `dir="auto"` in tool output** — correctness exactly at the moment of consent.
5. **Home action cards + hover previews** — the Codex feel; last because it's polish on top of the
   above, not a substitute.

## Paid-turn ledger

**Free:** spec-test, `test_transcript_path.py`, `probe_control.py` free section (`initialize`,
feature detection, `get_usage`).
**Paid:** `smoke_test.py` (1/run — phase exits only, never per-commit), Phase 0 permission probes
(2–4), `set_model` verification (1), approval-posture verification (1 per posture), M8 smoke (1).
Budget ≈ 10–12 turns for the whole rework.

---

## Two judgment calls — user decides

**1. Branding / trademark — DECIDED 2026-08-05 by the author: option (b).**

- **Product name:** «کلاد فارسی» with an **original** mark. Not "ClaudeCode Persian Port", and
  **not** Anthropic's Claude Code logo as the app icon.
- **Subtitle / nominative use:** «رابط فارسی برای Claude Code» — "a Persian front-end for Claude
  Code". Saying what it works with is fine and keeps it discoverable.
- **Disclaimer, visible in both README.md and help.html:**
  «این پروژه مستقل است و وابسته به Anthropic نیست.»
- Rationale: the vendor's mark as *our* icon and in *our* product name implies affiliation — the
  textbook trademark-exposure case for a public repo, and a takedown would strand exactly the end
  users this project exists for.

Implementation touch points: `static/index.html:6` (`<title>`), `index.html:21` (brand text),
`strings.fa.js` (new `appName` key — brand text is currently hardcoded), `assets/icon.ico`
(regenerate with the original mark), `setup.ps1:219` (shortcut name), `help.html` (disclaimer),
`README.md` (disclaimer + positioning).

**2. Positioning vs Anthropic's first-party RTL** (shipped July 2026, Code tab only; Chat-tab code
present but disabled). "Chat bubbles render RTL" is now table stakes — do not lead with it. The
first-party gaps that are this project's durable differentiators, and what the README leads with:
full Persian UI **chrome** (every button, dialog, error), ZWNJ on Shift+Space, mixed-line BiDi
discipline (spec cases 3/5/9–12 — first-party has no mixed-line handling), Persian approval
dialogs, and terminal-free offline install for a non-technical user. Plainly: the moat moved from
"renders Persian" to "is a Persian *product*".
