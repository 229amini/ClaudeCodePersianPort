## کلاد فارسی، نسخهٔ ترمینالی ۰.۱۴.۰: چند حساب، ورود از داخل پنجره، لینوکس

دانلودش همان [کلاد فارسی ۱.۱۴.۰](https://github.com/229amini/ClaudeCodePersianPort/releases/tag/v1.14.0) است و نصب، هر دو میان‌بر را می‌سازد. این صفحه شمارهٔ نسخهٔ ترمینالی را ثبت می‌کند.

### تازه‌ها
- **ورود از داخل پنجره:** اگر وارد حساب Claude نشده باشید، کارت ورود خودش باز می‌شود. «Authorize» را در مرورگر بزنید، یا کدی را که صفحهٔ ورود نشان می‌دهد در کارت بچسبانید. `/login` و `/logout` همین کارت را باز می‌کنند.
- **چند حساب Claude:** هر حساب را یک بار با «افزودن حساب دیگر» وارد کنید و بعد با یک کلیک بین آن‌ها جابه‌جا شوید. مهارت‌ها، تنظیمات و گفتگوها برای همه یکی است. همهٔ قاب‌های باز با حساب جدید ادامه می‌دهند. قابی که وسط کار باشد، اول جوابش را تمام می‌کند.
- **سقف مصرف:** زیر پیام سقف برای هر حساب دیگر دکمهٔ «ادامه با …» می‌آید. با زدن آن، همهٔ قاب‌هایی که پشت سقف منتظر مانده‌اند با آن حساب ادامه پیدا می‌کنند.
- **اجرا روی لینوکس از راه SSH (آزمایشی):** نسخهٔ ترمینالی حالا روی یک سرور لینوکسی هم اجرا می‌شود و از ویندوز با `connect.bat` به آن وصل می‌شوید. کلاد روی سرور کار می‌کند و اگر اتصال قطع شود، کارش متوقف نمی‌شود. برای چند سرور، چند پنجره باز کنید. نصب روی سرور: `install-linux.sh`.

### رفع اشکال
- نصب‌کننده Edge قدیمی‌تر از ۱۱۴ را به‌روز می‌کند. پیش از این، پنجره روی چنین کامپیوتری بی‌ظاهر باز می‌شد.

### نصب در سه قدم
۱. فایل **Source code (zip)** پایین همین صفحه را دانلود کنید و از حالت فشرده خارج کنید.
۲. روی `persian-claude-gui\setup.bat` دوبار کلیک کنید.
۳. میان‌بر «کلاد فارسی» یا «کلاد فارسی — ترمینال» را از دسکتاپ باز کنید.

پیش‌نیاز: ویندوز ۱۰ یا ۱۱ و یک حساب Claude که Claude Code با آن کار کند. اگر پایتون و Claude Code نصب نباشند، نصب‌کننده خودش نصبشان می‌کند.

**مشکلی دیدید یا پیشنهادی دارید؟** [اینجا بنویسید](https://github.com/229amini/ClaudeCodePersianPort/issues/new/choose). فرم‌ها فارسی‌اند. اگر برنامه به کارتان آمد، یک ⭐ بدهید و آن را برای دوستانتان بفرستید.

> این پروژه مستقل است و به Anthropic وابسته نیست.

---
**English:** Terminal edition 0.14.0, from the same download as web 1.14.0. **New:** sign in from the window (`/login`, `/logout`); several Claude accounts, added once and switched in one click, every open pane carrying on under the new one (a busy pane after its turn); a «continue on …» button per other account at a usage wall, resuming every pane waiting there; **experimental** Linux over SSH: `server.py --serve` under systemd (`install-linux.sh`), `connect.bat` opens one tunnel and one window per server, and Claude keeps running across a dropped connection. **Fixed:** setup updates an Edge older than 114, which drew the window unstyled.
