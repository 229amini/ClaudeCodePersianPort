## کلاد فارسی، نسخهٔ ترمینالی ۰.۱۳.۰: طراحی تازه

دانلودش همان [کلاد فارسی ۱.۱۳.۰](https://github.com/229amini/ClaudeCodePersianPort/releases/tag/v1.13.0) است و نصب، هر دو میان‌بر را می‌سازد. این صفحه شمارهٔ نسخهٔ ترمینالی را ثبت می‌کند. همهٔ تغییرهای بعد از ۰.۸.۰ در همین نسخه آمده است.

### طراحی تازه
- ظاهر از روی **افزونهٔ Claude Code برای VS Code**، با رنگ نارنجی کلاد و یک جدول اندازه برای همهٔ قاب‌ها.
- **نوار زیر کادر پیام** مثل نسخهٔ پنجره‌ای: «+» برای پیوست و `@` و سرورهای MCP، «/» برای فهرست فرمان‌ها، منوی حالت و منوی مدل با سطح تلاش در پایینشان، حلقهٔ مصرف و ساعت کش. دکمهٔ ارسال در حین کار به دکمهٔ توقف تبدیل می‌شود.
- برچسب‌های اسکریپت `statusLine` شما (مثل `[BADGES]`) به شکل نشان در سطر وضعیت قاب دیده می‌شوند.
- صفحهٔ «گفتگوی جدید» یک جدول مرتب است و قاب خالی با خط‌چین مشخص می‌شود.

### تازه‌ها
- **لحن پاسخ** پیش از اولین پیام انتخاب می‌شود. **عوض کردن مدل وسط گفتگو** اول از شما می‌پرسد.
- **دکمهٔ ↕** کنار ⤢ قاب را تمام‌قد می‌کند و عرضش را نگه می‌دارد.
- گفتگویی که از نوار کناری باز می‌کنید، اگر قاب خالی باشد، در آن باز می‌شود و جای قاب فعال را نمی‌گیرد. هر چیدمانی که انتخاب کنید، قاب‌های تازه را با گفتگوهای باز پر می‌کند.
- **سقف پنج‌ساعتهٔ مصرف:** بعد از باز شدن سقف، کار خودش ادامه پیدا می‌کند.
- فهرست «بدون پرسش انجام شد» کنار گفتگو، دستورهای پس‌زمینه در پنل کارها، «کپی شناسهٔ گفتگو» در منوی ⋯ قاب، و درخواست اجازه‌ای که منتظر شما می‌ماند.
- ✕ قاب گفتگو را می‌بندد و اگر کلاد مشغول کار باشد، اول می‌پرسد «مطمئنید؟».

### رفع اشکال
- پنل کارها در همان قابی باز می‌شود که آن را خواسته، نه روی قاب کناری.
- عوض کردن چیدمان وسط کار، سطر «در حال کار» را از کار نمی‌اندازد.
- ✕ گفتگوی باز در نوار کناری دوباره دیده می‌شود.
- «متوقف شد» بعد از بارگذاری دوباره سر جایش می‌ماند و گفتگوی قدیمی از آخرین پیامش باز می‌شود.

### نصب در سه قدم
۱. فایل **Source code (zip)** پایین همین صفحه را دانلود کنید و از حالت فشرده خارج کنید.
۲. روی `persian-claude-gui\setup.bat` دوبار کلیک کنید.
۳. میان‌بر «کلاد فارسی» یا «کلاد فارسی — ترمینال» را از دسکتاپ باز کنید.

پیش‌نیاز: ویندوز ۱۰ یا ۱۱ و یک حساب Claude که Claude Code با آن کار کند. اگر پایتون و Claude Code نصب نباشند، نصب‌کننده خودش نصبشان می‌کند.

**مشکلی دیدید یا پیشنهادی دارید؟** [اینجا بنویسید](https://github.com/229amini/ClaudeCodePersianPort/issues/new/choose). فرم‌ها فارسی‌اند. اگر برنامه به کارتان آمد، یک ⭐ بدهید و آن را برای دوستانتان بفرستید.

> این پروژه مستقل است و به Anthropic وابسته نیست.

---
**English:** Terminal edition 0.13.0, from the same download as web 1.13.0. Everything since 0.8.0. **Redesign:** after the Claude Code VS Code extension, in Claude orange, on one design scale; the composer bar (attach / `@` / MCP, command palette, mode and model menus with effort, usage ring, cache clock, send/stop); your `statusLine` script's `[BADGES]` as chips in the pane's state line; a tidier new-session page. **New:** the response style picked before the first message, a confirm before a mid-conversation model switch, the ↕ full-height pane toggle, a sidebar open fills an empty pane first and every layout pick fills new panes, work continuing after the five-hour limit resets, the list of what ran without asking, background commands in the tasks panel, copy a conversation's id, permission requests that wait for you, and the pane ✕ closes the conversation (asking first while it works). **Fixed:** the tasks panel opens in its own pane, a layout change mid-turn no longer breaks the working line, the sidebar ✕ is visible again, «Stopped» survives a reload, old conversations open at their newest message.
