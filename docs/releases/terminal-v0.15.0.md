## کلاد فارسی، نسخهٔ ترمینالی ۰.۱۵.۰: لینک‌ها در مرورگر خودتان، جستجو در متن گفتگوها

دانلودش همان [کلاد فارسی ۱.۱۵.۰](https://github.com/229amini/ClaudeCodePersianPort/releases/tag/v1.15.0) است و نصب، هر دو میان‌بر را می‌سازد. این صفحه شمارهٔ نسخهٔ ترمینالی را ثبت می‌کند.

### تازه‌ها
- **لینک‌ها در مرورگر پیش‌فرض باز می‌شوند.** پیش از این، کلیک روی لینکی در جواب کلاد خود پنجرهٔ برنامه را به آن صفحه می‌برد و راه برگشتی نبود. حالا لینک در مرورگر همیشگی شما باز می‌شود و پنجره سر جایش می‌ماند. لینکی که در زبانهٔ یک سرور باشد هم روی همین کامپیوتر باز می‌شود.
- **جستجو در متن گفتگوها:** جستجوی نوار کناری اول پروژه‌ها را نشان می‌دهد، بعد گفتگوهایی را که نام یا اولین پیامشان می‌خورد، و بعد گفتگوهایی را که فقط جایی در متنشان آن کلمه آمده است، با یک تکه از همان متن در خطی جدا.
- **هر گفتگو پیش‌نویس خودش را دارد:** متنی که نوشته‌اید، فایل‌ها و عکس‌های پیوست و پیام‌های «بعداً بفرست» مال همان گفتگوست. گفتگوی تازه با جعبهٔ خالی باز می‌شود و با برگشتن به گفتگوی قبلی، نوشته‌تان سر جایش است.
- **کارهای پس‌زمینه:** برای هر کار در حال اجرا یک خط جدا می‌آید، با نام، زمانی که ثانیه به ثانیه جلو می‌رود، برای هر عامل مرحلهٔ فعلی‌اش و برای هر دستور اینکه آخرین خروجی‌اش چند وقت پیش بوده است. این خط فقط کارهای قاب جلویی را نشان می‌دهد.
- **بزرگ‌نمایی عمودی یک قاب:** در چیدمان ۴ یا ۶ قابی، بزرگ‌نمایی عمودی فقط همان قاب را از بالا تا پایین ستونش بلند می‌کند و بقیهٔ قاب‌ها اندازهٔ خودشان را نگه می‌دارند.
- **`/btw`** (پرسش جانبی) حالا منتظر جواب مدل می‌ماند و در فهرست «/» و پالت دستورها هم هست.
- **Claude in Chrome:** اگر اتصال به Chrome را در تنظیمات Claude Code روشن کرده باشید، کلاد در این پنجره هم به افزونهٔ Chrome وصل می‌شود.

### رفع اشکال
- «گفتگوی تازه از اینجا» روی اولین پیام یک گفتگو عکس‌های آن پیام را جا می‌انداخت. حالا عکس‌ها همراه متن برمی‌گردند. ✕ روی «بعداً بفرست» هم پیوست‌ها را پس می‌دهد.
- زبانهٔ سرور روی اتصال کند خیلی سریع‌تر باز می‌شود: گفتگوی بلند از آخرش بارگذاری می‌شود و پیام‌های قدیمی‌تر با «نمایش پیام‌های قبلی» می‌آیند. دکمه‌های کپی در زبانهٔ سرور هم حالا کار می‌کنند.
- کاری که از خود Claude Code متوقف شده بود، تا وقتی گفتگو باز بود «در حال اجرا» نشان داده می‌شد. این درست شد.

### نصب در سه قدم
۱. فایل **Source code (zip)** پایین همین صفحه را دانلود کنید و از حالت فشرده خارج کنید.
۲. روی `persian-claude-gui\setup.bat` دوبار کلیک کنید.
۳. میان‌بر «کلاد فارسی» یا «کلاد فارسی — ترمینال» را از دسکتاپ باز کنید.

پیش‌نیاز: ویندوز ۱۰ یا ۱۱ و یک حساب Claude که Claude Code با آن کار کند. اگر پایتون و Claude Code نصب نباشند، نصب‌کننده خودش نصبشان می‌کند.

**مشکلی دیدید یا پیشنهادی دارید؟** [اینجا بنویسید](https://github.com/229amini/ClaudeCodePersianPort/issues/new/choose). فرم‌ها فارسی‌اند. اگر برنامه به کارتان آمد، یک ⭐ بدهید و آن را برای دوستانتان بفرستید.

> این پروژه مستقل است و به Anthropic وابسته نیست.

---
**English:** Terminal edition 0.15.0, from the same download as web 1.15.0. **New:** a link in the window opens in the default browser instead of replacing the app window (a link inside a server tab opens on this PC); sidebar search also finds conversations by their text, with a snippet on its own line; each conversation keeps its own draft (text, attachments, «send later» rows) and a new one opens empty; one background-task line per running task with a live clock, an agent's current step and a command's last-output time, only for the pane in front; vertical zoom at 4-up/6-up grows one pane down its column, not the whole row; `/btw` waits for the model's answer and is listed in the «/» popup and the palette; Claude in Chrome connects when it is enabled in Claude Code's settings (`--chrome`). **Fixed:** a fork from before a conversation's first message dropped that message's images; «send later» ✕ gives its attachments back; server tabs over a slow link load a long history from its end and page back with «show earlier messages», and their copy buttons work; a task stopped from Claude Code's own UI no longer shows as running.
