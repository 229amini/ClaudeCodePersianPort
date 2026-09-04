# TUI strings and glyphs — what the terminal says, and what v2 says instead

**Build:** `claude` **2.1.260**, author PC, 2026-09-04.
**Source:** `persian-claude-gui/extract_tui_vocab.py` (free; reads `claude.exe`, spawns nothing).
**Gate:** `persian-claude-gui/test_tui_vocab.py` fails when a string in the «رشتهٔ TUI» column
is no longer in the binary, or when a row here has no Persian.

V2-PLAN.md §1: *"v2 Persian text is a translation of the TUI's own strings, pulled from the
binary, one table, reviewed once. Nobody authors copy."* This is that table. v2.6 regenerates
`static/strings.fa.js` from it.

**Status of the Persian column: DRAFT — not yet reviewed by the user.** The bead's exit
criterion is «reviewed once by the user»; §"نیاز به تصمیم کاربر" at the bottom lists the rows
where a translation was a judgement call rather than a rendering.

## 1. Glyphs

Counted in the binary, both raw UTF-8 and `\uXXXX`-escaped. `raw`/`esc` are occurrence counts —
they prove the glyph is this build's, not a remembered one.

| Glyph | Codepoint | raw / esc | Role in the TUI | v2 |
|---|---|---|---|---|
| `⏺` | U+23FA | 0 / 6 | حاشیهٔ سطر دستیار و سطر ابزار | همان، به‌صورت `::before` |
| `⎿` | U+23BF | 0 / 24 | شاخهٔ نتیجهٔ ابزار، زیر سطر ابزار | همان؛ در RTL باید آینه شود |
| `✳ ✴ ✹ ✻` | U+2733/34/39/3B | — / 6,3,1,0 | قاب‌های چرخندهٔ «در حال فکر» و اسپینر | همان چهار قاب |
| `※` | U+203B | 2 / 3 | یادداشت جمع‌بندی (`/recap`) | همان؛ در v1 هست |
| `⏵` | U+23F5 | 1 / 5 | پیکان حالت اجازه؛ دوتایی: `⏵⏵` | همان؛ در RTL آینه می‌شود |
| `☐` | U+2610 | 2 / 2 | کار انجام‌نشده | همان |
| `☑` | U+2611 | 0 / 6 | کار انجام‌شده | همان |
| `▸` | U+25B8 | 0 / 14 | کار در جریان | همان؛ در RTL `◂` |
| `✓` | U+2713 | 7 / 102 | موفق | همان |
| `✗` | U+2717 | 3 / 44 | ناموفق | همان |
| `●` `○` | U+25CF / U+25CB | 1,2 / 13,5 | نشانگر پر/خالی در فهرست‌ها | همان |
| `─` `│` | U+2500 / U+2502 | 43,19 / 954,62 | خط جداکننده و ستون | با `border` در CSS، نه با نویسه |
| `…` | U+2026 | 22 / 1005 | کوتاه‌شدگی | همان |
| `·` | U+00B7 | 602 / 2 | جداکنندهٔ درون‌سطری | همان |

**RTL note.** `⎿`, `⏵` and `▸` are directional shapes. In an RTL column they must mirror, and
they will not do so on their own — none of them carries a Unicode mirroring property. The
renderer flips them with `transform: scaleX(-1)` or swaps the codepoint. This is the one place
where copying the TUI's glyph verbatim produces a *wrong* picture, and it is why the glyph table
is separate from the string table.

## 2. Dialog strings — permission, plan, AskUserQuestion

Verified against the option-construction site in the bundle: option 1's label is the bare
string `Yes`; option 3 is the text below plus a **bold `(esc)`** appended as a separate node;
option 2 exists only when a "remember" scope applies, and its label is built at runtime.

| id | رشتهٔ TUI | فارسی v2 | یادداشت |
|---|---|---|---|
| `permission.proceed` | `Would you like to proceed?` | «اجازه می‌دهید ادامه دهد؟» | تیتر گفت‌وگوی اجازه و طرح |
| `permission.yes_once` | `Yes` | «۱. بله» | برچسب در باینری تنها `Yes` است |
| `permission.yes_remember` | `Yes, and don't ask again for …` | «۲. بله، و دیگر برای … نپرس» | دامنه در زمان اجرا ساخته می‌شود |
| `permission.no_feedback` | `No, and tell Claude what to do differently ` + **`(esc)`** | «۳. نه، و بگو طور دیگری انجام دهد (Esc)» | فاصلهٔ انتهایی عمدی است |
| `permission.feedback_hint` | `shift+tab to approve with this feedback` | «shift+tab: تأیید همراه با همین توضیح» | پانوشت گفت‌وگو |
| `plan.saved` | `Plan saved!` | «طرح ذخیره شد» | پس از پذیرش طرح |

## 3. Transcript strings

| id | رشتهٔ TUI | فارسی v2 | یادداشت |
|---|---|---|---|
| `tool_result.expand` | `(ctrl+o to expand)` | «(ctrl+o برای باز کردن)» | پانوشت نتیجهٔ جمع‌شده |
| `tool_result.more` | `+N lines` | «+N سطر» | عدد LTR جدا می‌شود |
| `paste.placeholder` | `[Pasted text #N +M lines]` | «[متن چسبانده‌شده #N +M سطر]» | تراشهٔ جعبهٔ نوشتن |
| `compact.banner` | `Conversation compacted` | «گفتگو فشرده شد» | شکل رویدادش هنوز اندازه‌گیری نشده — کاوش ۹ در V2-PLAN §5 |
| `rewind.hint` | `Double-tap esc to rewind the conversation to a previous point in time` | «دو بار Esc: بازگشت گفتگو به نقطه‌ای پیش‌تر» | ویژگی‌اش به کاوش ۶ گره خورده؛ رشته ثبت می‌شود |

## 4. Status line and spinner

| id | رشتهٔ TUI | فارسی v2 | یادداشت |
|---|---|---|---|
| `spinner.interrupt` | `esc to interrupt` | «Esc برای توقف» | پسوند سطر اسپینر |
| `queue.stop` | `ctrl+x to stop` | «ctrl+x برای توقف» | وقتی نوبتی در جریان است |
| `posture.accept_edits` | `accept edits on` | «پذیرش خودکار ویرایش‌ها روشن» | با `⏵⏵` |
| `posture.plan` | `plan mode on` | «حالت طرح روشن» | |
| `posture.auto` | `auto mode on` | «حالت خودکار روشن» | v2 این حالت را نمی‌سازد (§4 طرح) — رشته برای بازتاب `system/status` است |
| `posture.bypass` | `bypass permissions` | «دور زدن اجازه‌ها» | خطر؛ با رنگ هشدار |
| `posture.change_hint` | `shift+tab to change it` | «shift+tab برای تغییر» | |
| `usage.limit` | `Approaching your 5-hour usage limit — Claude will wrap up` | «نزدیک سقف ۵‌ساعته — کلاد کار را جمع می‌کند» | |
| `exit.hint` | `Press Ctrl-C again to exit` | — | پنجره با دکمهٔ بستن بسته می‌شود؛ ترجمه نمی‌شود |

## 5. Composer footer hints

The TUI assembles this footer from a list at runtime; each fragment is its own string.

| id | رشتهٔ TUI | فارسی v2 |
|---|---|---|
| `composer.newline` | `ctrl+j for newline` | «ctrl+j یا shift+Enter: سطر تازه» |
| `composer.mention` | `@ to mention` | «@ برای اشاره به فایل» |
| `composer.commands` | `/ for commands` | «/ برای فرمان‌ها» |
| `composer.paste_images` | `to paste images from your clipboard` | «برای چسباندن تصویر از حافظهٔ موقت» |
| `help.close` | `? to close` | «? برای بستن» |
| `help.esc_quit` | `esc to close · esc again quits` | «Esc برای بستن» — «خروج دوباره» معنی ندارد؛ پنجره است |

## 6. Strings v2 does not translate

Recorded so a future pass does not mistake them for gaps. Each belongs to a screen v2 does not
build (V2-PLAN §4), or is a terminal fact that has no meaning in a window.

`ctrl+x again to delete · esc to keep`, `hold space to speak`, `ctrl+e to set group`,
`ctrl+r to rename`, `shift+↑↓ to reorder`, `alt+1-N to open`, `ctrl+enter to start and open`,
`pin to top` / `unpin`, `no job focused`, `Cannot be rebound — …` (all seven),
`macOS system copy` and its five siblings, every `Diff …` string, every `Plugin …` string.

## 7. نیاز به تصمیم کاربر — rows where the translation was a judgement call

The bead's exit criterion is that the user reviews this column once. These are the rows where
review actually changes something; the rest are literal renderings.

1. **`permission.yes_remember`** — the TUI's scope is «for `<tool>` commands in `<dir>`». v1
   already decided the scope is *this project, this session* (2026-08-06). The Persian says
   «دیگر برای … نپرس» without naming a directory. Confirm that stays.
2. **Numbering the options.** The TUI shows `1. / 2. / 3.` as part of the select component, not
   as part of the label. This table folds the digit into the Persian label. If v2 renders the
   digit as a separate element, the digits must come out of these strings.
3. **`posture.bypass`** — «دور زدن اجازه‌ها» is accurate and alarming. A softer wording would be
   dishonest for a mode that skips every prompt. Confirm the blunt version.
4. **`posture.auto`** — v2 does not build auto mode, but the CLI can still report it in
   `system/status` if the user sets it elsewhere. Kept as a display-only string. Confirm.
5. **`exit.hint` and `help.esc_quit`** — dropped rather than translated, because the window has
   no "press it again to quit". Confirm nothing should replace them.
6. **`⎿` `⏵` `▸` mirroring** — flipping these in RTL is a rendering decision with no precedent
   in the TUI, which never runs RTL. Confirm the mirror is wanted before v2.2 builds it.
