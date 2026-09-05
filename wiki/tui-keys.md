# TUI keys — the default binding table, read out of the binary

**Build:** `claude` **2.1.261**, author PC, 2026-09-05 (re-verified; was 2.1.260 on 2026-09-04).
**Source:** `persian-claude-gui/extract_tui_vocab.py` (free; reads `claude.exe`, spawns nothing).
**Regenerate:** `C:\Python314\python.exe persian-claude-gui\extract_tui_vocab.py`
**Gate:** `persian-claude-gui/test_tui_vocab.py` fails when this file and the binary disagree.

V2-PLAN.md §3.6: *"Lift the defaults from the binary, not from memory."* This is that table.
206 bindings across 25 contexts. The «کلید v2» column is what the window binds — empty means
**out of scope for v2**, with the reason in the last column.

> The binary updated itself from 2.1.259 to 2.1.260 overnight on 2026-09-04, between V2-PLAN.md
> being written and this branch being cut, and again to **2.1.261** overnight on 2026-09-05.
> Nothing announced either one. That is the argument for a generated table: re-run the
> extractor, re-run the gate, and a moved default is a test failure instead of a bug report
> from the colleague.
>
> **What 2.1.261 moved:** nothing about the keys — still 206 bindings across 25 contexts, every
> load-bearing chord unchanged. What moved was **minifier output**: the mode-cycle temporary was
> renamed `V` → `q`, and the paste chip's interpolations `#${e} +${n}` → `#${e} +${t}`. Both had
> been pinned by name and both reported drift that was not drift. The extractor now matches
> their *shape* and reports computed chords by the **action** they serve, so a rename is
> invisible and a real change is not.

## How to read a chord

The TUI's own display function (`H()` in the bundle) renders keys as: `escape` → `Esc`,
`" "` → `space`, `up`/`down`/`left`/`right` → `↑ ↓ ← →`, and `meta+` is `alt+` on Windows.
A chord with a space in it is a **two-stroke sequence**, not two keys at once:
`ctrl+x ctrl+e` means ctrl+x, release, then ctrl+e.

Two chords are platform-computed, resolved here for Windows:

| Variable (2.1.261) | Windows | Other | Used by |
|---|---|---|---|
| `de` | **`alt+v`** | `ctrl+v` | `chat:imagePaste` |
| `q` (was `V` on 2.1.260) | **`shift+tab`** | `meta+m` | `chat:cycleMode`, `confirm:cycleMode` |

The variable names are minifier output and change between builds. Nothing downstream keys on
them: the extractor reports `computed_uses`, so a chord is looked up by the action it serves.

`ctrl+v` → `chat:imagePaste` exists in the bundle but only under a `wsl` branch. It is **not**
a Windows default. The window should still accept ctrl+v for paste because that is what a
browser does and what the colleague will press — a deliberate deviation, noted in §"Deviations".

## Global — active everywhere

| Chord | Action | کلید v2 | وضعیت |
|---|---|---|---|
| `ctrl+c` | `app:interrupt` | — | مرورگر خودش کپی می‌کند؛ توقف با `Esc` است |
| `ctrl+d` | `app:exit` | — | پنجره با دکمهٔ بستن بسته می‌شود |
| `ctrl+t` | `app:toggleTodos` | `ctrl+t` | فهرست کارها باز/بسته |
| `ctrl+o` | `app:toggleTranscript` | `ctrl+o` | باز کردن همهٔ نتیجه‌های ابزار (V2-PLAN §3.1) |
| `ctrl+shift+b` | `app:toggleBrief` | — | `/brief` در §4 بیرون است |
| `ctrl+r` | `history:search` | `ctrl+r` | جست‌وجوی تاریخچه (V2-PLAN §3.2) |
| `ctrl+up` / `meta+up` | `app:diffFileListUp` | — | پنل diff ساخته نمی‌شود |
| `ctrl+down` / `meta+down` | `app:diffFileListDown` | — | پنل diff ساخته نمی‌شود |
| `ctrl+]` | `app:openArtifact` | — | آرتیفکت روی لوله نمی‌آید |

## Chat — when the prompt has focus

This is the context v2.3 implements. Everything else in this file is reference.

| Chord | Action | کلید v2 | وضعیت |
|---|---|---|---|
| `escape` | `chat:cancel` | `Esc` | قطع نوبت؛ همین حالا هست |
| `ctrl+l` | `chat:clearInput` | `ctrl+l` | **توجه:** پاک‌کردن نوشتهٔ جعبه است، نه پاک‌کردن صفحه |
| `cmd+k` | `chat:clearScreen` | — | روی ویندوز هیچ کلیدی ندارد؛ پس v2 هم کلیدی نمی‌سازد (V2-PLAN §8.6) |
| `ctrl+x ctrl+k` | `chat:killAgents` | — | بستن عامل‌های پس‌زمینه؛ با فاز `/tasks` می‌آید (V2-PLAN §5.10) |
| `shift+tab` | `chat:cycleMode` | `shift+tab` | چرخش حالت اجازه؛ همین حالا هست |
| `meta+p` | `chat:modelPicker` | `alt+p` | انتخاب مدل (V2-PLAN §3.3) |
| `meta+o` | `chat:fastMode` | — | `fast_mode` روی لوله تأیید نشده — کاوش v2.1 |
| `meta+t` | `chat:thinkingToggle` | `alt+t` | نمایش/نهفتن «در حال فکر» |
| `meta+w` | `chat:workflowKeywordToggle` | — | کاوش‌نشده |
| `enter` | `chat:submit` | `Enter` | همین حالا هست |
| `ctrl+x enter` | `chat:queueSubmit` | `ctrl+x Enter` | فرستادن به صف؛ موتور صف را دارد |
| `ctrl+j` | `chat:newline` | `shift+Enter` و `ctrl+j` | `shift+Enter` عادت مرورگر است و می‌ماند |
| `up` | `history:previous` | `↑` در سطر اول | V2-PLAN §3.2 |
| `down` | `history:next` | `↓` در سطر آخر | V2-PLAN §3.2 |
| `ctrl+_` `ctrl+-` `ctrl+shift+-` `ctrl+shift+_` | `chat:undo` | `ctrl+z` | مرورگر خودش `ctrl+z` را در `textarea` دارد |
| `ctrl+x ctrl+e` | `chat:externalEditor` | `ctrl+g` | یک کلید بس است |
| `ctrl+g` | `chat:externalEditor` | `ctrl+g` | ویرایش پیش‌نویس در ویرایشگر بیرونی، از راه `/api/editor` (V2-PLAN §2) |
| `ctrl+s` | `chat:stash` | — | کنارگذاشتن پیش‌نویس؛ در مرورگر `ctrl+s` مال خود مرورگر است (V2-PLAN §8.7) |
| `ctrl+x ctrl+a` | `abovePrompt:toggle` | — | افزونه‌ها ساخته نمی‌شوند |
| `ctrl+x tab` | `abovePrompt:focus` | — | افزونه‌ها ساخته نمی‌شوند |
| `alt+v` | `chat:imagePaste` | `ctrl+v` | انحراف عمدی؛ §«انحراف‌ها» |
| `space` | `voice:pushToTalk` | — | `/voice` در §4 بیرون است |

## Confirmation — permission and plan dialogs

v2.4 builds this. The TUI numbers the options; the digits are **not** in the binding table —
they come from the select component, one digit per row.

| Chord | Action | کلید v2 | وضعیت |
|---|---|---|---|
| `y` | `confirm:yes` | `1` | v2 شماره می‌دهد، چون گزینه‌ها فارسی‌اند و `y`/`n` سرنخ ندارند |
| `n` | `confirm:no` | `3` | همان |
| `enter` | `confirm:yes` | `Enter` | تأیید ردیف انتخاب‌شده |
| `escape` | `confirm:no` | `Esc` | همین حالا هست |
| `up` / `down` | `confirm:previous` / `confirm:next` | `↑` / `↓` | حرکت بین ردیف‌ها |
| `tab` | `confirm:nextField` | `Tab` | رفتن به بخش بعدی گفت‌وگو، وقتی بیش از یک بخش دارد |
| `space` | `confirm:toggle` | `Space` | تغییر وضعیت ردیف انتخاب‌شده، در گفت‌وگوهای چندگزینه‌ای |
| `shift+tab` | `confirm:cycleMode` | `shift+tab` | «تأیید با این بازخورد» (رشتهٔ TUI) |

## Autocomplete — the `/` and `@` menus

| Chord | Action | کلید v2 | وضعیت |
|---|---|---|---|
| `tab` | `autocomplete:accept` | `Tab` | همین حالا هست |
| `escape` | `autocomplete:dismiss` | `Esc` | همین حالا هست |
| `up` / `down` | `autocomplete:previous` / `next` | `↑` / `↓` | همین حالا هست |

## Transcript — `ctrl+o` view

v2 has no separate transcript screen: the column **is** the transcript. `ctrl+e` there maps to
`transcript:toggleShowAll`, which is the behaviour V2-PLAN §3.1 assigns to **`ctrl+o`** in the
window, because `ctrl+o` is what the TUI's own hint string says: «(ctrl+o to expand)».

| Chord | Action | کلید v2 | وضعیت |
|---|---|---|---|
| `ctrl+e` | `transcript:toggleShowAll` | `ctrl+o` | تنها ردیف این جدول که v2 می‌سازد |
| `ctrl+c` / `escape` / `q` | `transcript:exit` | — | صفحهٔ جدایی وجود ندارد |
| `ctrl+u` / `ctrl+d` | `scroll:halfPageUp` / `halfPageDown` | — | پیمایش را مرورگر دارد |
| `ctrl+b` / `ctrl+f` | `scroll:fullPageUp` / `fullPageDown` | — | همان |
| `ctrl+n` / `ctrl+p` | `scroll:lineDown` / `lineUp` | — | همان |
| `j` / `k` | `scroll:lineDown` / `lineUp` | — | کلید تک‌حرفی در جعبهٔ متن معنی ندارد |
| `g` / `shift+g` | `scroll:top` / `bottom` | — | همان |
| `space` / `b` | `scroll:fullPageDown` / `fullPageUp` | — | همان |
| `up` / `down` / `home` / `end` | scroll | — | مرورگر |

## HistorySearch — `ctrl+r`

v2.3 builds this over `/api/history`.

| Chord | Action | کلید v2 | وضعیت |
|---|---|---|---|
| `ctrl+r` | `historySearch:next` | `ctrl+r` | نتیجهٔ بعدی |
| `escape` / `tab` | `historySearch:accept` | `Esc` / `Tab` | متن را در جعبه بگذار |
| `ctrl+c` | `historySearch:cancel` | — | `Esc` کافی است |
| `enter` | `historySearch:execute` | `Enter` | بگذار و بفرست |
| `ctrl+s` | `historySearch:cycleScope` | — | دامنه در v2 همیشه «این پروژه» است |

## Task — while an agent runs in the foreground

| Chord | Action | کلید v2 | وضعیت |
|---|---|---|---|
| `ctrl+x ctrl+b` / `ctrl+b` | `task:background` | — | به کاوش ۱۰ در V2-PLAN §5 گره خورده |

## Contexts v2 does not build

Recorded so the gate can assert the count, and so a future reader does not think they were
missed. Each is a screen the window replaces with something else, or a feature §4 rules out.

| Context | Bindings | Why not |
|---|---|---|
| `Settings` | 16 | `/config` فایل واقعی را باز می‌کند (V2-PLAN §2) |
| `Tabs` | 4 | نوارِ تب‌های v1 با ماوس کار می‌کند و دست‌نخورده می‌ماند |
| `ThemePicker` | 2 | `/theme` فقط روشن/تاریک است |
| `Scroll` | 14 | پیمایش و انتخاب متن کار مرورگر است |
| `Help` | 1 | `?` پوشش کلیدها را باز می‌کند؛ بستن با `Esc` |
| `Attachments` | 6 | پیوست‌ها با ماوس مدیریت می‌شوند |
| `Footer` | 11 | نوار پایین در v2 خواندنی است، نه کانونی |
| `AbovePrompt` / `Input` / `Select` | 9 / 6 / 6 | صفحهٔ افزونه‌ها ساخته نمی‌شود (§4) |
| `MessageSelector` | 15 | rewind؛ به کاوش ۶ در §5 گره خورده |
| `DiffDialog` | 17 | پنل diff ساخته نمی‌شود |
| `DiffPanel` | 1 | همان |
| `ModelPicker` | 3 | `←`/`→` برای effort؛ v2 آن را فهرست جدا می‌کند |
| `EffortSlider` | 1 | همان |
| `Select` | 12 | فهرست‌های v2 از `Confirmation` تبعیت می‌کنند |
| `Plugin` | 3 | §4 |
| `Agents` | 2 | نوار عامل‌های v1 دست‌نخورده می‌ماند |

## Cannot be rebound

The binary refuses these, with its own reason. Most are terminal facts that **do not apply to a
browser** — `ctrl+i` is not Tab in the DOM, `ctrl+m` is not Enter, `ctrl+h` is not Backspace. v2
inherits the *list* as documentation, not as a restriction.

| Key | Severity | Binary's reason | Applies to v2? |
|---|---|---|---|
| `ctrl+c` | error | used for interrupt/exit (hardcoded) | no — browser copy |
| `ctrl+d` | error | used for exit (hardcoded) | no |
| `ctrl+m` | error | identical to Enter in terminals (both send CR) | **no** — distinct in the DOM |
| `ctrl+[` | error | identical to Escape in terminals | **no** |
| `ctrl+i` | error | identical to Tab in terminals | **no** |
| `ctrl+h` | error | identical to Backspace in terminals | **no** |
| `capslock` | error | not delivered to terminal applications | **no** |
| `ctrl+z` | warning | Unix process suspend (SIGTSTP) | no — undo in a `textarea` |
| `ctrl+\` | error | terminal quit signal (SIGQUIT) | no |
| `cmd+c` `cmd+v` `cmd+x` `cmd+q` `cmd+w` `cmd+tab` `cmd+space` | error | macOS system shortcuts | n/a — Windows only |

## Deviations — where v2 knowingly differs

These are choices, not oversights. `help.html` §«تفاوت با ترمینال» lists them for the colleague.

1. **`ctrl+v` pastes an image.** The TUI's Windows default is `alt+v`; `ctrl+v` is its wsl
   branch. In a browser `ctrl+v` is paste and nothing else will be pressed. Both are bound.
2. **`shift+Enter` inserts a newline**, alongside the TUI's `ctrl+j`. Terminals cannot see
   `shift+Enter`; the DOM can, and every chat app the colleague has used binds it.
3. **Digits pick a dialog option**, where the TUI uses `y`/`n`. Persian option text gives no
   letter to hint at, and the TUI already numbers the rows on screen.
4. **`ctrl+o` expands tool results**, where the TUI uses `ctrl+e` inside a transcript screen it
   opens with `ctrl+o`. The window has no second screen, and the TUI's own hint string says
   «(ctrl+o to expand)» — so `ctrl+o` is the key the user has already been told about.
5. **Keys the browser owns stay with the browser:** `ctrl+w`, `ctrl+t`, `ctrl+n`, `ctrl+shift+i`.
   Edge `--app` intercepts them before the page sees them (V2-PLAN §3.6).

## `~/.claude/keybindings.json`

Does not exist on this PC. When present, its shape is `{"bindings":[{"context":…,"bindings":
{chord: action}}]}`, where an action may also be `"command:<name>"` (run a slash command) or
`null` (unbind a default). v2 reads it if present and applies it over this table — same file,
same shape, so a user who has customised the TUI gets the same keys in the window.
