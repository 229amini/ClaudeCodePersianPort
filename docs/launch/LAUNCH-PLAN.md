# Launch plan — کلاد فارسی (bead `pcg-coj`)

This file is written **for a Claude session running on the owner's Windows PC** (the Claude
desktop app with Claude in Chrome, or computer use), where the owner is logged in to each site.
It is the whole plan: the order, the rules, and every post's text. The texts in §4 were reviewed
by the owner on 2026-10-04 — post them as written; if a site forces a change (a length limit, a
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
   it — do not look for a way around the rule.
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
      of Persian in a Windows terminal running `claude` — e.g. ask it
      «فایل D:\projects\app\style.css را عوض کن و بگو چه کردی» — so the broken rendering shows.
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
| 1 | X — Persian thread | 4.3 | before-after.png on tweet 1 | Claude, after "yes" |
| 1 | LinkedIn | 4.4 | terminal-conversation.png | Claude, after "yes" |
| 2 | Virgool article | 4.5 | cover: terminal-conversation.png; before-after.png after the first paragraph | Claude, after "yes" |
| 3 (weekday, ~08:00–10:00 US Eastern) | Hacker News — Show HN | 4.6 | none (HN has no images) | **HUMAN submits**; Claude may post the first comment after "yes" |
| 3 | Reddit r/ClaudeAI, then r/ClaudeCode | 4.7 | terminal-conversation.png | Claude, after "yes", only if each sub's rules allow it |
| 5+ | awesome-claude-code | 4.8 | — | **HUMAN only** (the list requires a person to submit; no PRs, no CLI) |

After each post, for the first two hours: check for replies every ~20 minutes, draft answers for
the owner (Persian where the question is Persian), post only the ones the owner approves. Early
replies decide how far a post travels.

Every day after day 1: look at https://github.com/229amini/ClaudeCodePersianPort/issues , and
summarise new issues for the owner (they will be fixed in a coding session).

---

## 4. The texts

### 4.1 Telegram — Persian (fits a 1024-character photo caption)

```
**کلاد فارسی** — Claude Code، بالاخره به فارسیِ درست

اگر با Claude Code در ترمینال ویندوز فارسی نوشته باشید، می‌دانید چه می‌شود: حروف جدا از هم، جمله‌ای که برعکس خوانده می‌شود، اسم فایلی که وسط جمله تکه‌تکه می‌شود، و نیم‌فاصله‌ای که اصلاً تایپ نمی‌شود.

کلاد فارسی همان Claude Code رسمی را اجرا می‌کند، در پنجره‌ای که فارسی را درست نشان می‌دهد:

▫️ همه‌چیز فارسی و راست‌به‌چپ؛ دکمه‌ها، منوها، پرسش اجازه و راهنما
▫️ فارسی و انگلیسی در یک خط، درست و خوانا
▫️ نیم‌فاصله با Shift+Space
▫️ پیش از هر تغییر، به فارسی اجازه می‌گیرد و نشان می‌دهد دقیقاً چه می‌کند
▫️ چند گفتگو کنار هم، جستجوی گفتگوها و نمای متمرکز
▫️ نصب با یک دوبار-کلیک

رایگان و متن‌باز · ویندوز ۱۰ و ۱۱ · با همان حساب Claude خودتان

📥 دانلود و راهنمای نصب:
https://github.com/229amini/ClaudeCodePersianPort

🙏 تازه منتشر شده و بیشتر از هر چیز به نظر شما نیاز دارد. هر جا حرفی به‌هم ریخت یا امکانی کم بود، در گیت‌هاب بگویید؛ فرم‌ها فارسی‌اند. اگر به کارتان آمد، ⭐ بدهید و برای دوستی که با Claude Code کار می‌کند بفرستید.

#کلاد_فارسی #ClaudeCode #برنامه_نویسی
```

### 4.2 Telegram — English (fits a 1024-character photo caption)

```
**Claude Persian** — Claude Code, finally in proper Persian

If you've typed Persian into Claude Code in a Windows terminal, you've seen it: letters that don't join, sentences that read backwards, file names chopped up mid-sentence, and no way to type a half-space (ZWNJ).

Claude Persian runs the official Claude Code CLI, unchanged, inside a window that renders Persian correctly:

▫️ Fully Persian, right-to-left interface: buttons, menus, permission prompts, help
▫️ Persian and English on one line, in the right order
▫️ Half-space with Shift+Space
▫️ Asks permission in Persian before every change, showing the exact edit
▫️ Conversations side by side, search, Focus view
▫️ One double-click to install

Free and open source · Windows 10/11 · your own Claude account

📥 Download and install guide:
https://github.com/229amini/ClaudeCodePersianPort

🙏 It's brand new and feedback matters most: open an issue in English or Persian. If it helps you, a ⭐ and a share go a long way.

#ClaudeCode #Persian #OpenSource
```

### 4.3 X — Persian thread (four tweets, each under 280)

```
۱/ اگر با Claude Code در ترمینال ویندوز فارسی نوشته باشید، این‌ها را دیده‌اید: حروف جدا، جملهٔ برعکس، اسم فایلی که وسط جمله تکه‌تکه می‌شود، و نیم‌فاصله‌ای که تایپ نمی‌شود.

مشکل از شما نیست؛ ترمینال ویندوز برای فارسی ساخته نشده. برای همین «کلاد فارسی» را ساختم 🧵
```
```
۲/ کلاد فارسی همان Claude Code رسمی را اجرا می‌کند، بدون هیچ تغییری، ولی در پنجره‌ای که فارسی را درست نشان می‌دهد.

همان حساب، همان تنظیمات، همان مهارت‌ها. فقط نمایش عوض شده.
```
```
۳/ چه دارد:
▫️ همه‌چیز فارسی و راست‌به‌چپ
▫️ فارسی و انگلیسی در یک خط، درست
▫️ نیم‌فاصله با Shift+Space
▫️ پیش از هر تغییر، به فارسی اجازه می‌گیرد
▫️ چند گفتگو کنار هم و نمای متمرکز
▫️ نصب با یک دوبار-کلیک
```
```
۴/ رایگان و متن‌باز، برای ویندوز ۱۰ و ۱۱:
https://github.com/229amini/ClaudeCodePersianPort

تازه منتشر شده و نظر شما مهم‌ترین چیز است. اگر به کارتان آمد، ریتوییت کنید تا به دست بقیه هم برسد 🙏
```

### 4.4 LinkedIn — Persian

```
یک پروژهٔ متن‌باز منتشر کردم: «کلاد فارسی» 🎉

Claude Code در ترمینال ویندوز فارسی را درست نشان نمی‌دهد: حروف جدا می‌شوند، خطِ فارسی و انگلیسی به‌هم می‌ریزد و نیم‌فاصله تایپ نمی‌شود. «کلاد فارسی» همان Claude Code رسمی را در پنجره‌ای کاملاً فارسی و راست‌به‌چپ اجرا می‌کند؛ با نصب یک‌کلیکی، اجازه گرفتن به فارسی پیش از هر تغییر، و چند گفتگو کنار هم.

رایگان و متن‌باز است و منتظر نظر شما هستم:
https://github.com/229amini/ClaudeCodePersianPort

#هوش_مصنوعی #متن_باز #ClaudeCode
```

### 4.5 Virgool — article

Title: **چرا ترمینال ویندوز فارسی را خراب می‌کند — و چطور Claude Code را فارسی کردم**

```
اگر برنامه‌نویس هستید و با Claude Code کار می‌کنید، احتمالاً یک بار هم که شده در ترمینال ویندوز فارسی نوشته‌اید و نتیجه را دیده‌اید: حروفی که به هم نمی‌چسبند، جمله‌ای که از آخر به اول خوانده می‌شود، اسم فایلی که وسط جمله تکه‌تکه و جابه‌جا می‌شود، و نیم‌فاصله‌ای که اصلاً راهی برای تایپش نیست.

اول بگویم: مشکل از شما نیست، از Claude هم نیست. مشکل از جایی است که متن در آن نمایش داده می‌شود.

## ترمینال برای فارسی ساخته نشده

ترمینال یک شبکه از خانه‌های هم‌اندازه است؛ هر حرف یک خانه. فارسی اما خطی پیوسته است: شکل هر حرف به حروف کناری‌اش بستگی دارد، و جهتش راست‌به‌چپ است. وقتی فارسی و انگلیسی در یک خط کنار هم می‌آیند، باید الگوریتمی به اسم «دوجهته» (BiDi) ترتیب نمایش را درست کند.

ترمینال‌های ویندوز این الگوریتم را ندارند. Claude Code هم رابط ترمینالی‌اش را خودش می‌کشد و مکان‌نما و عرض خانه‌ها را خودش حساب می‌کند. نتیجه این است که حتی ترمینال‌هایی که شکل حروف فارسی را درست می‌کنند، باز هم ترتیب خط را به‌هم می‌ریزند. یعنی این مشکل از داخل ترمینال حل‌شدنی نیست.

## راه‌حل: همان Claude Code، در جای دیگر

تنها موتور متنی در ویندوز که فارسی را بی‌نقص می‌چیند، موتور مرورگر است. پس به‌جای عوض کردن Claude Code، جایی را عوض کردم که نمایش داده می‌شود.

«کلاد فارسی» یک پنجرهٔ بدون نوار آدرس (Edge) است که زیرش همان Claude Code رسمی، بدون هیچ تغییری، اجرا می‌شود. همان حساب، همان تنظیمات، همان مهارت‌ها و هوک‌ها. گفتگوهایی که اینجا شروع می‌کنید با claude --resume در ترمینال هم باز می‌شوند. سرور کوچکی که بینشان پیام جابه‌جا می‌کند فقط با پایتونِ خالص نوشته شده و فقط روی خود کامپیوتر شما کار می‌کند.

## دو درسی که گران تمام شد

اول: «مسیر فایل وسط جملهٔ فارسی». جمله‌ای مثل «فایل D:\projects\app\style.css را عوض کردم» اگر به حال خودش رها شود، بخش‌هایش جابه‌جا می‌شوند. هر مسیر، کد، آدرس و شمارهٔ نسخه باید جداگانه «قرنطینه» شود تا جهت جمله را به‌هم نزند.

دوم: «اولین کلمه تصمیم می‌گیرد». مرورگر جهت یک پاراگراف را از اولین حرفش حدس می‌زند. پاراگراف فارسی‌ای که با یک کلمهٔ انگلیسی شروع شود، کل پاراگراف را چپ‌به‌راست می‌کند. برای همین برنامه حروف فارسی و انگلیسی هر بند را می‌شمارد و بعد تصمیم می‌گیرد.

## چه چیزی می‌گیرید

- همه‌چیز فارسی و راست‌به‌چپ: دکمه‌ها، منوها، پرسش اجازه، راهنما
- نیم‌فاصله با Shift+Space
- پیش از هر تغییر، به فارسی اجازه می‌گیرد و دقیقاً نشان می‌دهد چه می‌کند
- چند گفتگو کنار هم، جستجوی گفتگوها، و «گفتگوی تازه از اینجا» زیر هر پیام
- نصب با یک دوبار-کلیک؛ اگر پایتون یا Claude Code نباشد، خودش نصبشان می‌کند

## نصب

۱. از صفحهٔ پروژه آخرین نسخه را دانلود کنید.
۲. روی persian-claude-gui\setup.bat دوبار کلیک کنید.
۳. از میان‌بر «کلاد فارسی» روی دسکتاپ بازش کنید.

پیش‌نیاز: ویندوز ۱۰ یا ۱۱، و یک حساب Claude که Claude Code با آن کار کند.

https://github.com/229amini/ClaudeCodePersianPort

## نظر شما

پروژه رایگان و متن‌باز است و تازه منتشر شده. هر جا حرفی به‌هم ریخت، دکمه‌ای گم بود یا امکانی کم داشتید، در گیت‌هاب بگویید؛ فرم‌ها فارسی‌اند. اگر به کارتان آمد، برای دوستی که با Claude Code کار می‌کند بفرستید.

این پروژه مستقل است و وابسته به Anthropic نیست.
```

### 4.6 Hacker News — Show HN (HUMAN submits)

- Title: `Show HN: Claude Persian – a right-to-left front-end for Claude Code on Windows`
- URL: `https://github.com/229amini/ClaudeCodePersianPort`
- First comment (the owner's own, right after submitting):

```
I built this for a Persian-speaking colleague who uses Claude Code but shouldn't have to fight a terminal.

The problem: a terminal is a grid of fixed cells. Persian is cursive, joined, and right-to-left, and mixed Persian/English lines need Unicode BiDi reordering. Windows terminals don't do BiDi, and Claude Code's TUI (Ink) does its own cursor and cell-width math, so mixed lines come out scrambled and there's no way to type a ZWNJ (half-space). A BiDi-capable terminal fixes glyph shaping but not the layout, so that doesn't help either.

The fix: don't render in a terminal. A browser engine is the one text renderer on Windows that shapes Persian correctly, so the app is a chrome-less Edge window over the real, unmodified CLI:

- Python stdlib server (no npm, no build step, no CDN), bound to 127.0.0.1 with a per-run token
- one long-lived `claude -p` per conversation, talking stream-json over stdin/stdout
- permission prompts arrive in-band as control requests and are shown as a Persian dialog
- history replay reads the CLI's own transcripts, so `claude --resume` sees the same conversations

The interesting part was BiDi discipline: file paths, code spans and URLs inside Persian sentences each need to be isolated, or they drift and reverse. There's a written spec and a headless test suite that checks direction and layout, not just text content.

Independent project, not affiliated with Anthropic. Happy to answer questions about RTL rendering.
```

### 4.7 Reddit — r/ClaudeAI and r/ClaudeCode (only if each sub's rules allow)

- Title: `I built a right-to-left Persian front-end for Claude Code, because Windows terminals can't render Persian`
- Flair: the sub's showcase / "built with Claude" flair, if it has one.

```
Persian (Farsi) in Claude Code on a Windows terminal is basically unreadable: letters don't join, mixed Persian/English lines come out in the wrong order, and you can't type a half-space. It's not Claude's fault — Windows terminals have no BiDi support.

So I wrapped the official CLI (unchanged — same account, settings, skills, hooks) in a chrome-less Edge window that renders Persian properly:

- fully right-to-left Persian UI, including permission prompts
- mixed Persian/English lines in the correct order
- several conversations side by side, conversation search, fork from any message, Focus view
- one double-click install on Windows

Free, MIT, no telemetry, binds to localhost only: https://github.com/229amini/ClaudeCodePersianPort

If you work in an RTL language (Arabic, Hebrew, Urdu…) I'd love to hear whether the same problems hit you. Not affiliated with Anthropic.
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
