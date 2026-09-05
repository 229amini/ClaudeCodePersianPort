# TUI strings and glyphs — what the terminal says, and what v2 says instead

**Build:** `claude` **2.1.261**, author PC, 2026-09-05 (re-verified; was 2.1.260 on 2026-09-04).
**Source:** `persian-claude-gui/extract_tui_vocab.py` (free; reads `claude.exe`, spawns nothing).
**Gate:** `persian-claude-gui/test_tui_vocab.py` fails when a string in the «رشتهٔ TUI» column
is no longer in the binary, or when a row here has no Persian.

V2-PLAN.md §1: *"v2 Persian text is a translation of the TUI's own strings, pulled from the
binary, one table, reviewed once. Nobody authors copy."* This is that table.

**Done 2026-09-05 (v2.6 Words).** Every row now names the key it ships as, in the
`strings.fa.js` column, and `test_strings.py` fails when that key is missing from the file or
when the two texts disagree. A row whose key is `—` is one v2 deliberately does not ship, and
the یادداشت column says why. §8 lists the strings that had no TUI counterpart at all.

**Status of the Persian column: settled, one row excepted.** §7 listed six rows where the
translation was a judgement call. **Five are decided in `V2-PLAN.md` §8.1–8.5** on technical
grounds; the sixth — mirroring `⎿ ⏵ ▸` in an RTL column — has no technical tiebreaker and is
the plan's one open question (§8.9). Nothing below is a draft any more.

## 1. Glyphs

Counted in the binary, both raw UTF-8 and `\uXXXX`-escaped. `raw`/`esc` are occurrence counts —
they prove the glyph is this build's, not a remembered one.

| Glyph | Codepoint | raw / esc | Role in the TUI | v2 |
|---|---|---|---|---|
| `⏺` | U+23FA | 0 / 6 | حاشیهٔ سطر دستیار و سطر ابزار | همان، به‌صورت `::before` |
| `⎿` | U+23BF | 0 / 24 | شاخهٔ نتیجهٔ ابزار، زیر سطر ابزار | همان؛ در RTL باید آینه شود |
| `✳ ✴ ✹ ✻` | U+2733/34/39/3B | 0,1 / 12,6 | قاب‌های چرخندهٔ «در حال فکر» و اسپینر | همان چهار قاب |
| `※` | U+203B | 2 / 3 | یادداشت جمع‌بندی (`/recap`) | همان؛ در v1 هست |
| `⏵` | U+23F5 | 1 / 5 | پیکان حالت اجازه؛ دوتایی: `⏵⏵` | همان؛ در RTL آینه می‌شود |
| `☐` | U+2610 | 2 / 2 | کار انجام‌نشده | همان |
| `☑` | U+2611 | 0 / 6 | کار انجام‌شده | همان |
| `▸` | U+25B8 | 0 / 14 | کار در جریان | همان؛ در RTL `◂` |
| `✓` | U+2713 | 7 / 102 | موفق | همان |
| `✗` | U+2717 | 3 / 44 | ناموفق | همان |
| `●` `○` | U+25CF / U+25CB | 1,2 / 13,5 | نشانگر پر/خالی در فهرست‌ها | همان |
| `─` `│` | U+2500 / U+2502 | 43,19 / 954,62 | خط جداکننده و ستون | با `border` در CSS، نه با نویسه |
| `…` | U+2026 | 22 / 2028 | کوتاه‌شدگی | همان |
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

| id | رشتهٔ TUI | فارسی v2 | strings.fa.js | یادداشت |
|---|---|---|---|---|
| `permission.proceed` | `Would you like to proceed?` | «اجازه می‌دهید ادامه دهد؟» | `permProceed` | تیتر گفت‌وگوی اجازه و طرح |
| `permission.yes_once` | `Yes` | «بله» | `permYes` | برچسب در باینری هم تنها `Yes` است؛ شماره را رندرکننده می‌گذارد (§۸.۲) |
| `permission.yes_remember` | `Yes, and don't ask again for …` | «بله، و دیگر برای {tool} نپرس» | `permYesRemember` | دامنه: همین پروژه، همین نشست — بدون مسیر (§۸.۱) |
| `permission.no_feedback` | `No, and tell Claude what to do differently ` + **`(esc)`** | «نه، و بگو طور دیگری انجام دهد» | `permNoFeedback` | `(Esc)` هم مثل شماره عنصر جداست، نه متن |
| `permission.feedback_hint` | `shift+tab to approve with this feedback` | «shift+tab: تأیید همراه با همین توضیح» | `permHint` | پانوشت گفت‌وگو؛ یک تکه از سطری که سه راهنما را کنار هم می‌گذارد |
| `plan.saved` | `Plan saved!` | «طرح ذخیره شد» | `planSaved` | روی کارت ابزار، پس از پذیرش طرح — طرح اجرا نمی‌شود، نگه داشته می‌شود |

## 3. Transcript strings

| id | رشتهٔ TUI | فارسی v2 | strings.fa.js | یادداشت |
|---|---|---|---|---|
| `tool_result.expand` | `(ctrl+o to expand)` | «(ctrl+o برای باز کردن)» | `expandHint` | پانوشت نتیجهٔ جمع‌شده |
| `tool_result.more` | `+N lines` | «{n} سطر» | `toolResultLines` | «+» افتاد: در v2 پیش از باز کردن هیچ سطری دیده نشده، پس شمار همهٔ خروجی است |
| `paste.placeholder` | `[Pasted text #N +M lines]` | «[متن چسبانده‌شده #{n} +{lines} سطر]» | `pastePlaceholder` | شکل بدون شمار سطر: `pastePlaceholderShort` |
| `compact.banner` | `Conversation compacted` | «گفتگو فشرده شد» | `compacted` | شمارهای پیش و پس از فشرده‌سازی: `compactedTokens` |
| `rewind.hint` | `Double-tap esc to rewind the conversation to a previous point in time` | «دو بار Esc: بازگشت گفتگو به نقطه‌ای پیش‌تر» | — | ویژگی ساخته نشده (V2-PLAN §8.11ج)؛ رشته ثبت می‌ماند تا روزی که ساخته شود |

## 4. Status line and spinner

| id | رشتهٔ TUI | فارسی v2 | strings.fa.js | یادداشت |
|---|---|---|---|---|
| `spinner.interrupt` | `esc to interrupt` | «Esc برای توقف» | `spinnerInterrupt` | پسوند سطر اسپینر، فقط تا وقتی نوبت در جریان است |
| `queue.stop` | `ctrl+x to stop` | — | — | در v2 `ctrl+x` پیشوند صف است، نه توقف؛ توقف با Esc انجام می‌شود (§۸.۶ و تصمیم ۸ فاز v2.3) |
| `posture.accept_edits` | `accept edits on` | «پذیرش خودکار ویرایش‌ها روشن» | `slPostureAcceptEdits` | با `⏵⏵` |
| `posture.plan` | `plan mode on` | «حالت طرح روشن» | `slPosturePlan` | |
| `posture.auto` | `auto mode on` | «حالت خودکار روشن» | `slPostureAuto` | v2 این حالت را نمی‌سازد (§4 طرح) — رشته برای بازتاب `system/status` است |
| `posture.bypass` | `bypass permissions` | «دور زدن اجازه‌ها» | `slPostureBypass` | خطر؛ با رنگ هشدار |
| `posture.change_hint` | `shift+tab to change it` | «shift+tab برای تغییر» | `slPostureHint` | |
| `usage.limit` | `Approaching your 5-hour usage limit — Claude will wrap up` | «نزدیک سقف ۵‌ساعته — کلاد کار را جمع می‌کند» | `slQuotaWarn` | آستانه‌اش هم از باینری برداشته شده: `0.95` |
| `exit.hint` | `Press Ctrl-C again to exit` | — | — | پنجره با دکمهٔ بستن بسته می‌شود؛ ترجمه نمی‌شود (§۸.۵) |

## 5. Composer footer hints

The TUI assembles this footer from a list at runtime; each fragment is its own string.

In v2 the key is never inside the sentence: the `?` sheet draws it as its own
`<kbd>`, and the welcome box draws it as its own column. Same rule as the option
digits (§8.2) — a Latin chord glued to the front of a Persian run is reordered by
bidi and lands where nobody put it. So every Persian cell below is the sentence
*without* its chord.

| id | رشتهٔ TUI | فارسی v2 | strings.fa.js | یادداشت |
|---|---|---|---|---|
| `composer.newline` | `ctrl+j for newline` | «سطر تازه» | `keyNewline` | برگهٔ کلیدها؛ خود کلیدها در ستون `<kbd>` |
| `composer.mention` | `@ to mention` | «برای اشاره به یک فایل» | `welTipMention` | جعبهٔ خوش‌آمد؛ در برگهٔ کلیدها: `keyFiles` |
| `composer.commands` | `/ for commands` | «برای فرمان‌ها» | `welTipCommands` | جعبهٔ خوش‌آمد؛ راهنمای جعبهٔ نوشتن: `slashHint` |
| `composer.paste_images` | `to paste images from your clipboard` | «چسباندن تصویر» | `keyPaste` | برگهٔ کلیدها |
| `help.close` | `? to close` | «بستن» | `keysClose` | دکمهٔ بستن برگهٔ کلیدها |
| `help.esc_quit` | `esc to close · esc again quits` | «Esc برای بستن» | `keysEscHint` | فقط نیمهٔ اول؛ «خروج دوباره» معنی ندارد، پنجره است (§۸.۵) |

## 6. Strings v2 does not translate

Recorded so a future pass does not mistake them for gaps. Each belongs to a screen v2 does not
build (V2-PLAN §4), or is a terminal fact that has no meaning in a window.

`ctrl+x again to delete · esc to keep`, `hold space to speak`, `ctrl+e to set group`,
`ctrl+r to rename`, `shift+↑↓ to reorder`, `alt+1-N to open`, `ctrl+enter to start and open`,
`pin to top` / `unpin`, `no job focused`, `Cannot be rebound — …` (all seven),
`macOS system copy` and its five siblings, every `Diff …` string, every `Plugin …` string.

## 7. The six judgement calls — five decided, one open

Decided on 2026-09-05. Full reasoning in `V2-PLAN.md` §8; the short version:

| # | Row | Decision |
|---|---|---|
| 1 | `permission.yes_remember` | **Keep** «دیگر برای … نپرس» with no directory. v1's scope is *this project, this session*, not a path — naming a directory would describe a scope the window does not implement (§8.1) |
| 2 | Numbering the options | **The digit comes out of the string.** In RTL a digit glued to a Persian run is reordered by bidi and lands where nobody put it; and option 2 only exists when a remember scope applies, so the number is a property of the row's position. v2.4 renders it; **v2.6 stripped it from the Persian column above**, which is what `strings.fa.js` has always shipped (§8.2) |
| 3 | `posture.bypass` | **Keep the blunt «دور زدن اجازه‌ها».** It is what the mode does (§8.3) |
| 4 | `posture.auto` | **Keep, display-only.** The CLI reports the mode even though v2 cannot set it (§8.4) |
| 5 | `exit.hint`, `help.esc_quit` | **Dropped, not translated.** They describe a terminal that closes when you insist; a window has a close button (§8.5) |
| 6 | `⎿` `⏵` `▸` mirroring | **Open — the plan's one unanswered question.** Three options and a recommendation in `V2-PLAN.md` §8.9. v2.2 builds it as a CSS class so it can be decided by looking at it |

## 8. Strings v2 wrote itself — the owner's review list

The table above is a translation; everything here is **authored**, because the TUI says these
things in a screen v2 does not copy, or does not say them at all. V2-PLAN §8.10B parked them for
one review pass at v2.6; this is that list, so the review is a read-through of one section
rather than a diff of the whole file. **Every key ships with a value** — «open» here means the
owner may reword it, never that the window renders `undefined`.

Grouped by the phase that wrote them. Keys are `static/strings.fa.js`.

| Group | Keys |
|---|---|
| v2.2 — the column | `toolResultLines` `expandHint` `hintExpand` `compacted` `compactedTokens` `pastePlaceholder` `pastePlaceholderShort` `pasteDrop` |
| v2.3 — `!` shell rows | `shellExit` `shellNoOutput` `shellFailed` |
| v2.3 — Ctrl+R history search | `searchLabel` `searchNone` `searchHint` |
| v2.3 — Ctrl+G external editor | `editorWaiting` `editorFailed` |
| v2.3 — the `@` menu | `fileNone` |
| v2.3 — the `?` key sheet | `hintKeys` `keysTitle` `keysClose` `keySend` `keyNewline` `keyStop` `keyHistory` `keySearch` `keySlash` `keyFiles` `keyBash` `keyEditor` `keyClear` `keyExpand` `keyTodos` `keyThinking` `keyModel` `keyPosture` `keyZwnj` `keyPaste` `keyQueue` `keySheet` `keyDialogPick` |
| v2.4 — the numbered dialogs | `permHint` `permFeedbackPlaceholder` `permFeedbackMoved` `askHint` `pickerHint` |
| v2.5 — the welcome box | `welcomeTitle` `welcomeCwd` `welcomeNoProject` `welTipKeys` |
| v2.5 — the status line | `slPostureAsk` `notifyDone` |
| v2.5 — window-local commands | `cmdCopied` `cmdCopyEmpty` `cmdCopyFailed` `exportYou` `exportClaude` `cmdExported` `cmdExportEmpty` `cmdExportFailed` `statusTitle` `statusVersion` `cmdResumeHint` `cmdBranchDone` `cmdBranchFailed` `cmdBtwCost` `cmdBtwFailed` `cmdOpened` `cmdOpenFailed` `memoryTitle` `memoryUser` `memoryUserNote` `memoryProject` `memoryProjectNote` `cmdTasksEmpty` |
| v2.6 — `/help` | `helpTitle` `helpSlash` `helpKeys` `helpGuide` `helpGuideNote`, and the one-line description of every command the window answers, in `cmdHelp` |

Two of these were lifted after all and moved into §2–§5 during v2.6: `spinnerInterrupt` and
`keysEscHint` have TUI counterparts and are listed there instead.

The window also carries the v1 shell's Persian — the sidebar, the session list, the context
notice, the pickers — which has been in daily use since 2026-08 and is not part of this pass.
