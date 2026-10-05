# Launch plan: کلاد فارسی (bead `pcg-coj`)

This file is written **for a Claude session running on the owner's Windows PC** (the Claude
desktop app with Claude in Chrome, or computer use), where the owner is logged in to each site.
It is the whole plan: the order, the rules, and every post's text. The texts in §4 were reviewed
by the owner on 2026-10-04 and rewritten on 2026-10-05 without em dashes or filler. Post them as written; if a site forces a change (a length limit, a
flair, a rule), show the owner the changed text first.

Repository: https://github.com/229amini/ClaudeCodePersianPort
Latest release: `v1.8.0` (web) / `terminal-v0.8.0` (terminal), both live.

---

## 1. Rules for the Claude that runs this

1. **Nothing is posted without the owner's explicit "yes" for that one post.** Before each send,
   show the final text, the exact destination (channel/group/subreddit/site) and any image, then
   wait. A "yes" covers that single post only.
2. **The owner's own accounts only.** Never create an account, never sign in with credentials
   typed into chat. If a page asks for a login, 2FA code or CAPTCHA, stop and hand it to the
   owner.
3. **One post per destination.** No reposting, no cross-posting the same text into many groups,
   no direct messages to strangers, no comment-spam in other threads.
4. **Read each community's rules first** (subreddit sidebar/wiki, group pinned message, HN
   guidelines). If self-promotion is not allowed there, or the rules are unclear, say so and skip
   it. Do not look for a way around the rule.
5. **Never ask anyone for upvotes or stars on Hacker News or Reddit**, and never ask the owner's
   friends to vote. Both sites penalise vote solicitation. (Asking for feedback and a ⭐ on
   Telegram/X/LinkedIn, as the texts do, is fine.)
6. **Steps marked HUMAN are done by the owner by hand.** Claude may open the page and read the
   fields aloud from §4; the owner types or pastes and submits.
7. **Keep a log** in `docs/launch/LOG.md` (date, destination, link to the post, anything
   notable). Commit it at the end of each day with a one-line message. Do not put other people's
   names or messages in it.
8. If something goes wrong (a post is removed, a moderator objects), stop that channel, record it
   in the log, and tell the owner. Do not repost.

## 2. Before day 1

- [ ] `git pull` on `main`, so `docs/launch/` and `docs/screenshots/` are present.
- [ ] **Before/after image** (the single strongest asset). Ask the owner to take one screenshot
      of Persian in a Windows terminal running `claude`, for example by asking it
      «فایل D:\projects\app\style.css را عوض کن و بگو چه کردی», so the broken rendering shows.
      Then put it side by side with `docs/screenshots/terminal-conversation.png` (left: «قبل»,
      right: «بعد»). On Windows this needs no install: PowerShell with `System.Drawing` can
      paste two PNGs onto one canvas. Save as `docs/launch/before-after.png`; show it to the
      owner before using it anywhere.
- [ ] Ask the owner which Telegram destinations to use: their own channel, plus any groups whose
      admins allow project announcements. Write the list into the log before posting.

## 3. Schedule

| Day | Destination | Text (§4) | Image | Who |
|---|---|---|---|---|
| 1 | Owner's Telegram channel + approved groups | 4.1 Persian | before-after.png | Claude, after "yes" |
| 1 | Telegram (English-speaking groups, if any) | 4.2 English | before-after.png | Claude, after "yes" |
| 1 | X, Persian thread | 4.3 | before-after.png on tweet 1 | Claude, after "yes" |
| 1 | LinkedIn | 4.4 | terminal-conversation.png | Claude, after "yes" |
| 2 | Virgool article | 4.5 | cover: terminal-conversation.png; before-after.png after the first paragraph | Claude, after "yes" |
| 3 (weekday, 08:00 to 10:00 US Eastern) | Hacker News, Show HN | 4.6 | none (HN has no images) | **HUMAN submits**; Claude may post the first comment after "yes" |
| 3 | Reddit r/ClaudeAI, then r/ClaudeCode | 4.7 | terminal-conversation.png | Claude, after "yes", only if each sub's rules allow it |
| 5+ | awesome-claude-code | 4.8 | none | **HUMAN only** (the list requires a person to submit; no PRs, no CLI) |

After each post, for the first two hours: check for replies every ~20 minutes, draft answers for
the owner (Persian where the question is Persian), post only the ones the owner approves. Early
replies decide how far a post travels.

Every day after day 1: look at https://github.com/229amini/ClaudeCodePersianPort/issues , and
summarise new issues for the owner (they will be fixed in a coding session).

---

## 4. The texts

### 4.1 Telegram, Persian (fits a 1024-character photo caption)

```
**کلاد فارسی**: Claude Code به فارسی، روی ویندوز

اگر در ترمینال ویندوز با Claude Code فارسی نوشته باشید، نتیجه را دیده‌اید: حروف از هم جدا می‌شوند، جمله برعکس خوانده می‌شود، اسم فایل وسط جمله تکه‌تکه می‌شود و نیم‌فاصله تایپ نمی‌شود.

کلاد فارسی همان Claude Code رسمی را اجرا می‌کند و خروجی‌اش را در پنجره‌ای نشان می‌دهد که فارسی را درست می‌چیند:

▫️ دکمه‌ها، منوها، پرسش اجازه و راهنما، همه فارسی و راست‌به‌چپ
▫️ فارسی و انگلیسی در یک خط، به ترتیب درست
▫️ نیم‌فاصله با Shift+Space
▫️ پیش از هر تغییر به فارسی اجازه می‌گیرد و خود تغییر را نشان می‌دهد
▫️ چند گفتگو کنار هم، جستجوی گفتگوها و نمای متمرکز
▫️ نصب با دوبار کلیک

رایگان و متن‌باز، برای ویندوز ۱۰ و ۱۱، با همان حساب Claude خودتان.

📥 دانلود و راهنمای نصب:
https://github.com/229amini/ClaudeCodePersianPort

هر جا حرفی به‌هم ریخت یا امکانی کم بود، در گیت‌هاب بنویسید. فرم‌ها فارسی‌اند. اگر به کارتان آمد، ⭐ بدهید و برای کسی بفرستید که با Claude Code کار می‌کند.

#کلاد_فارسی #ClaudeCode #برنامه_نویسی
```

### 4.2 Telegram, English (fits a 1024-character photo caption)

```
**Claude Persian**: Claude Code in Persian, on Windows

Type Persian into Claude Code in a Windows terminal and you get letters that don't join, sentences that read backwards, file names cut up mid-sentence, and no way to type a half-space (ZWNJ).

Claude Persian runs the official Claude Code CLI, unchanged, and shows it in a window that renders Persian correctly:

▫️ Persian, right-to-left interface: buttons, menus, permission prompts, help
▫️ Persian and English on one line, in reading order
▫️ Half-space on Shift+Space
▫️ Asks permission in Persian before each change and shows the exact edit
▫️ Conversations side by side, search, Focus view
▫️ Installs with a double-click

Free and open source. Windows 10 and 11. Uses your own Claude account.

📥 Download and install guide:
https://github.com/229amini/ClaudeCodePersianPort

Bug reports and ideas are welcome on GitHub, in English or Persian. If it helps you, star it and pass it to someone who uses Claude Code.

#ClaudeCode #Persian #OpenSource
```

### 4.3 X, Persian thread (four tweets, each under 280)

```
۱/ اگر در ترمینال ویندوز با Claude Code فارسی نوشته باشید، این‌ها را دیده‌اید: حروف جدا، جملهٔ برعکس، اسم فایلی که وسط جمله تکه‌تکه می‌شود، و نیم‌فاصله‌ای که تایپ نمی‌شود.

علتش ترمینال ویندوز است که متن دوجهته را مرتب نمی‌کند. برای همین «کلاد فارسی» را ساختم 🧵
```
```
۲/ کلاد فارسی همان Claude Code رسمی را بدون تغییر اجرا می‌کند و خروجی‌اش را در پنجره‌ای نشان می‌دهد که فارسی را درست می‌چیند.

حساب، تنظیمات و مهارت‌ها همان‌هایی است که دارید. فقط صفحهٔ نمایش عوض شده.
```
```
۳/ امکاناتش:
▫️ رابط فارسی و راست‌به‌چپ
▫️ فارسی و انگلیسی در یک خط، به ترتیب درست
▫️ نیم‌فاصله با Shift+Space
▫️ پیش از هر تغییر به فارسی اجازه می‌گیرد
▫️ چند گفتگو کنار هم و نمای متمرکز
▫️ نصب با دوبار کلیک
```
```
۴/ رایگان و متن‌باز، برای ویندوز ۱۰ و ۱۱:
https://github.com/229amini/ClaudeCodePersianPort

اگر جایی به‌هم ریخت یا امکانی کم بود، در گیت‌هاب بنویسید. اگر به کارتان آمد، بازنشرش کنید تا به دست بقیه هم برسد.
```

### 4.4 LinkedIn, Persian

```
یک پروژهٔ متن‌باز منتشر کردم: «کلاد فارسی».

Claude Code در ترمینال ویندوز فارسی را درست نشان نمی‌دهد. حروف از هم جدا می‌شوند، خطی که فارسی و انگلیسی دارد به‌هم می‌ریزد و نیم‌فاصله تایپ نمی‌شود. «کلاد فارسی» همان Claude Code رسمی را در پنجره‌ای فارسی و راست‌به‌چپ اجرا می‌کند. با دوبار کلیک نصب می‌شود، پیش از هر تغییر به فارسی اجازه می‌گیرد و چند گفتگو را کنار هم نشان می‌دهد.

رایگان و متن‌باز است. اگر با Claude Code کار می‌کنید، امتحانش کنید و نظرتان را بگویید:
https://github.com/229amini/ClaudeCodePersianPort

#هوش_مصنوعی #متن_باز #ClaudeCode
```

### 4.5 Virgool, article

Title: **ترمینال ویندوز و فارسی: چطور Claude Code را فارسی کردم**

```
اگر با Claude Code کار می‌کنید و یک بار در ترمینال ویندوز فارسی نوشته باشید، نتیجه را دیده‌اید: حروفی که به هم نمی‌چسبند، جمله‌ای که از آخر به اول خوانده می‌شود، اسم فایلی که وسط جمله تکه‌تکه و جابه‌جا می‌شود، و نیم‌فاصله‌ای که راهی برای تایپش نیست.

علت این خرابی جایی است که متن در آن نمایش داده می‌شود، یعنی خود ترمینال.

## ترمینال برای فارسی ساخته نشده

ترمینال شبکه‌ای از خانه‌های هم‌اندازه است و هر حرف یک خانه می‌گیرد. خط فارسی پیوسته است: شکل هر حرف به حروف کناری‌اش بستگی دارد و جهتش راست‌به‌چپ است. وقتی فارسی و انگلیسی در یک خط کنار هم می‌آیند، الگوریتمی به اسم «دوجهته» (BiDi) باید ترتیب نمایش را درست کند.

ترمینال‌های ویندوز این الگوریتم را ندارند. Claude Code هم رابط ترمینالی‌اش را خودش می‌کشد و جای مکان‌نما و عرض خانه‌ها را خودش حساب می‌کند. برای همین ترمینال‌هایی که شکل حروف فارسی را درست می‌کنند، باز هم ترتیب خط را به‌هم می‌ریزند. این مشکل از داخل ترمینال حل نمی‌شود.

## همان Claude Code، در جای دیگر

در ویندوز، موتور مرورگر تنها موتور متنی است که فارسی را درست می‌چیند. پس به‌جای عوض کردن Claude Code، جایی را عوض کردم که خروجی‌اش نمایش داده می‌شود.

«کلاد فارسی» یک پنجرهٔ Edge بدون نوار آدرس است که زیرش همان Claude Code رسمی، بدون هیچ تغییری، اجرا می‌شود. حساب، تنظیمات، مهارت‌ها و هوک‌ها همان‌هایی است که دارید، و گفتگویی که اینجا شروع کنید با claude --resume در ترمینال هم باز می‌شود. سرور کوچکی که بین این دو پیام جابه‌جا می‌کند با پایتون خالص نوشته شده و فقط روی کامپیوتر خودتان کار می‌کند.

## دو چیزی که در ساختنش یاد گرفتم

اول، مسیر فایل وسط جملهٔ فارسی. جمله‌ای مثل «فایل D:\projects\app\style.css را عوض کردم» اگر به حال خودش رها شود، بخش‌هایش جابه‌جا می‌شوند. هر مسیر، کد، آدرس و شمارهٔ نسخه باید جداگانه از بقیهٔ جمله جدا (isolate) شود تا جهت جمله را به‌هم نزند.

دوم، اولین حرف. مرورگر جهت یک پاراگراف را از اولین حرفش حدس می‌زند، پس پاراگراف فارسی‌ای که با یک کلمهٔ انگلیسی شروع شود چپ‌به‌راست نمایش داده می‌شود. برنامه به‌جای این حدس، حروف فارسی و انگلیسی هر بند را می‌شمارد و بعد جهت را تعیین می‌کند.

## امکانات

- دکمه‌ها، منوها، پرسش اجازه و راهنما، همه فارسی و راست‌به‌چپ
- نیم‌فاصله با Shift+Space
- پیش از هر تغییر به فارسی اجازه می‌گیرد و خود تغییر را نشان می‌دهد
- چند گفتگو کنار هم، جستجوی گفتگوها، و «گفتگوی تازه از اینجا» زیر هر پیام
- نصب با دوبار کلیک؛ اگر پایتون یا Claude Code نصب نباشد، نصب‌کننده نصبشان می‌کند

## نصب

۱. از صفحهٔ پروژه آخرین نسخه را دانلود کنید.
۲. روی persian-claude-gui\setup.bat دوبار کلیک کنید.
۳. میان‌بر «کلاد فارسی» را از دسکتاپ باز کنید.

پیش‌نیاز: ویندوز ۱۰ یا ۱۱، و یک حساب Claude که Claude Code با آن کار کند.

https://github.com/229amini/ClaudeCodePersianPort

## بازخورد

پروژه رایگان و متن‌باز است. هر جا حرفی به‌هم ریخت، دکمه‌ای پیدا نشد یا امکانی کم بود، در گیت‌هاب بنویسید. فرم‌ها فارسی‌اند. اگر به کارتان آمد، برای کسی بفرستید که با Claude Code کار می‌کند.

این پروژه مستقل است و به Anthropic وابسته نیست.
```

### 4.6 Hacker News, Show HN (HUMAN submits)

- Title: `Show HN: Claude Persian, a right-to-left front-end for Claude Code on Windows`
- URL: `https://github.com/229amini/ClaudeCodePersianPort`
- First comment (the owner's own, right after submitting):

```
I built this for a Persian-speaking colleague who uses Claude Code every day and should not have to fight a terminal to do it.

A terminal is a grid of fixed cells. Persian is cursive, joined and right-to-left, and a line that mixes Persian with English needs Unicode BiDi reordering. Windows terminals don't reorder, and Claude Code's TUI (Ink) computes its own cursor position and cell widths, so mixed lines come out scrambled and there is no way to type a ZWNJ (the Persian half-space). A BiDi-capable terminal fixes the glyph shapes and leaves the line order broken.

So the app doesn't render in a terminal. A browser engine is the one text renderer on Windows that shapes Persian correctly, and the app is an Edge window with no browser UI on top of the real, unmodified CLI:

- a Python stdlib server (no npm, no build step, no CDN), bound to 127.0.0.1 with a per-run token
- one long-lived `claude -p` per conversation, talking stream-json over stdin/stdout
- permission prompts arrive in-band as control requests and show as a Persian dialog
- history is replayed from the CLI's own transcripts, so `claude --resume` sees the same conversations

Most of the work went into BiDi discipline. File paths, code spans and URLs inside Persian sentences each have to be isolated or they drift and reverse, and a paragraph's direction is decided by counting strong letters rather than trusting the first one. There is a written spec and a headless test suite that checks direction and layout, not only text content.

Independent project, not affiliated with Anthropic. I can answer questions about RTL rendering.
```

### 4.7 Reddit, r/ClaudeAI and r/ClaudeCode (only if each sub's rules allow)

- Title: `I built a right-to-left Persian front-end for Claude Code, because Windows terminals can't render Persian`
- Flair: the sub's showcase / "built with Claude" flair, if it has one.

```
Persian (Farsi) in Claude Code on a Windows terminal is hard to read: letters don't join, mixed Persian/English lines come out in the wrong order, and you can't type a half-space. The cause is the terminal. Windows terminals don't reorder bidirectional text.

So I wrapped the official CLI, unchanged (same account, settings, skills and hooks), in an Edge window with no browser UI that renders Persian properly:

- a fully right-to-left Persian UI, including permission prompts
- mixed Persian/English lines in the correct order
- several conversations side by side, conversation search, fork from any message, Focus view
- a one double-click install on Windows

Free, MIT, no telemetry, binds to localhost only: https://github.com/229amini/ClaudeCodePersianPort

If you work in another RTL language (Arabic, Hebrew, Urdu), I'd like to hear whether the same problems hit you. Not affiliated with Anthropic.
```

### 4.8 awesome-claude-code (HUMAN only)

Form: https://github.com/hesreallyhim/awesome-claude-code/issues/new/choose → "Recommend a
resource". The repo qualifies (created 2026-08-04, commits on 23+ days).

- Display Name: `Claude Persian (کلاد فارسی)`
- Category: `Alternative Clients`
- Link: `https://github.com/229amini/ClaudeCodePersianPort`
- Author Name: `229amini`
- Author Link: `https://github.com/229amini`
- Description:

```
A fully right-to-left Persian (Farsi) front-end for Claude Code on Windows. Windows terminals have no BiDi support, so Persian in the TUI comes out with unjoined letters, reversed mixed-script lines and no ZWNJ input. This runs the official, unmodified CLI (stream-json over stdin/stdout, permission prompts in-band) inside a chrome-less Edge window that renders Persian correctly, with a Persian permission dialog, side-by-side conversations, conversation search and fork-from-message. Python stdlib only, localhost-bound, MIT.
```

- Checklist: tick the required boxes only after doing what they say; **leave the last box
  ("Do not check…") unticked**.

---

## 5. Done when

- Every row of §3 is either posted (with its link in `docs/launch/LOG.md`) or skipped with a
  reason in the log.
- The owner has seen the first two hours of replies on each post.
- `pcg-coj` is closed with a one-line summary (where it was posted, anything removed).
