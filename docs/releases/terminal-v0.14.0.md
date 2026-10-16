## کلاد فارسی، نسخهٔ ترمینالی ۰.۱۴.۰: چند حساب، ورود از داخل پنجره، سرور لینوکسی

دانلودش همان [کلاد فارسی ۱.۱۴.۰](https://github.com/229amini/ClaudeCodePersianPort/releases/tag/v1.14.0) است و نصب، هر دو میان‌بر را می‌سازد. این صفحه شمارهٔ نسخهٔ ترمینالی را ثبت می‌کند.

### تازه‌ها
- **ورود از داخل پنجره:** اگر وارد حساب Claude نشده باشید، کارت ورود خودش باز می‌شود. «Authorize» را در مرورگر بزنید، یا کدی را که صفحهٔ ورود نشان می‌دهد در کارت بچسبانید. `/login` و `/logout` همین کارت را باز می‌کنند.
- **چند حساب Claude:** هر حساب را یک بار با «افزودن حساب دیگر» وارد کنید و بعد با یک کلیک بین آن‌ها جابه‌جا شوید. مهارت‌ها، تنظیمات و گفتگوها برای همه یکی است. همهٔ قاب‌های باز با حساب جدید ادامه می‌دهند. قابی که وسط کار باشد، اول جوابش را تمام می‌کند.
- **سقف مصرف:** زیر پیام سقف برای هر حساب دیگر دکمهٔ «ادامه با …» می‌آید. با زدن آن، همهٔ قاب‌هایی که پشت سقف منتظر مانده‌اند با آن حساب ادامه پیدا می‌کنند.
- **کار روی سرور لینوکسی:** «سرورها» در نوار کناری فهرست سرورهای شما را نشان می‌دهد، با وضعیت اتصال و نسخهٔ برنامه روی هر کدام. برای افزودن سرور، نشانی و نام کاربری را بنویسید. رمز سرور فقط یک بار پرسیده می‌شود تا کلید SSH نصب شود و جایی ذخیره نمی‌شود. «نصب روی سرور» برنامه را آن‌جا نصب می‌کند و «باز کردن» برای هر سرور پنجرهٔ جدایی باز می‌کند. کلاد روی سرور کار می‌کند و اگر اتصال قطع شود، کارش متوقف نمی‌شود. اگر نسخهٔ سرور قدیمی باشد، «به‌روزرسانی» کنارش می‌آید. اگر دو نفر روی یک سرور برنامه را نصب کنند، هر کدام درگاه جدای خودش را می‌گیرد. `connect.bat` و `install-linux.sh` هم مثل قبل کار می‌کنند.
- در پنل مصرف (حلقهٔ ◔)، کنار سقف‌ها نوشته می‌شود این سقف‌ها مال کدام حساب است و دکمهٔ «حساب‌ها» هم همان‌جاست.

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
**English:** Terminal edition 0.14.0, from the same download as web 1.14.0. **New:** sign in from the window (`/login`, `/logout`); several Claude accounts, added once and switched in one click, every open pane carrying on under the new one (a busy pane after its turn); a «continue on …» button per other account at a usage wall, resuming every pane waiting there; the active account and an «Accounts» button in the usage panel; Linux servers over SSH managed from the sidebar («Servers»): add one with its address and user, the password asked once to install this PC's SSH key (never stored), install or update the app on it, open one window per server, Claude keeps running across a dropped connection, each user on a shared server gets their own port; `connect.bat` and `install-linux.sh` still work. **Fixed:** setup updates an Edge older than 114, which drew the window unstyled.
