# کلاد فارسی · Claude Persian

**رابط فارسی برای Claude Code** — a fully right-to-left Persian front-end for the
[Claude Code](https://claude.com/claude-code) CLI, for Windows users who should never
have to open a terminal.

> این پروژه مستقل است و وابسته به Anthropic نیست.
> This project is independent and not affiliated with Anthropic.

---

<div dir="rtl">

## این چیست؟

پنجره‌ای فارسی و کاملاً راست‌به‌چپ روی همان «Claude Code» اصلی. خودِ CLI دست‌نخورده زیر آن اجرا
می‌شود؛ همان حساب، همان تنظیمات `~/.claude`، همان مهارت‌ها و هوک‌ها. چیزی بازنویسی نشده — فقط
نمایش عوض شده.

**چرا پنجره و نه ترمینال؟** ترمینال ویندوز شبکه‌ای از خانه‌های هم‌اندازه است و فارسی، خطِ متصل و
راست‌به‌چپ. ترمینال‌های ویندوز مرتب‌سازی دوجهته (BiDi) ندارند، پس خطِ آمیخته فارسی و انگلیسی
به‌هم می‌ریزد و نیم‌فاصله هم اصلاً وارد نمی‌شود. مرورگر تنها موتور متنی است که در ویندوز فارسی را
درست می‌چیند — به همین دلیل این برنامه یک پنجرهٔ بدون نوار آدرس است، نه یک «وب‌اپ».

## چه چیزی دارد

- **تمام محیط فارسی است** — نه فقط پیام‌ها: دکمه‌ها، خطاها، پرسش اجازه، نوار وضعیت.
- **نیم‌فاصله با `Shift+Space`** که تا خود CLI و برگشت سالم می‌ماند.
- **خطوط آمیختهٔ فارسی/انگلیسی** درست می‌نشیند — مسیر فایل، دستور، کد و شمارهٔ نسخه.
- **اجازه گرفتن به فارسی** پیش از هر تغییر فایل یا اجرای دستور، با سه سطح اجازه.
- **نصب بدون ترمینال و بدون اینترنت** (حالت `-Payload`): یک بار دوبار-کلیک.
- تاریخچهٔ گفتگوها، ادامهٔ نشست پس از بسته‌شدن، و انتخاب پوشهٔ پروژه — همه از داخل پنجره.

## دو نسخه، یک موتور

- **«کلاد فارسی»** — پنجرهٔ گفتگو با دکمه و منو. مدل، سطح تلاش و سطح اجازه را با کلیک عوض
  می‌کنید. برای کسی که نمی‌خواهد چیزی حفظ کند.
- **«کلاد فارسی — ترمینال»** — همان ترمینال `claude`، فقط فارسی و خوانا: یک ستون، همان
  علامت‌ها و کلیدها، دستورهای `/` به جای دکمه، و فهرست پروژه‌ها در سمت چپ. برای کسی که به
  ترمینال عادت دارد.

هر دو روی یک `server.py` و یک CLI اجرا می‌شوند؛ نصب هر دو میان‌بر را می‌سازد.

## نصب

۱. پوشهٔ پروژه را روی همان رایانه بگذارید.
۲. روی `persian-claude-gui\setup.bat` دوبار کلیک کنید.
۳. اگر تا به حال وارد حساب Claude نشده‌اید، نصب‌کننده همان‌جا به فارسی می‌گوید چه کنید.

دو میان‌بر روی دسکتاپ ساخته می‌شود: «کلاد فارسی» و «کلاد فارسی — ترمینال». راهنمای کامل فارسی
هر کدام داخل خود برنامه است، دکمهٔ «راهنما» (`static/help.html` و `static-terminal/help.html`).

</div>

---

## For developers

### Architecture

Three processes, one chain — no framework, no build step, no npm, no CDN:

```
Edge --app=http://127.0.0.1:PORT/?t=TOKEN    chrome-less window, static/ UI
   ↓ POST /api/*        ↑ SSE GET /api/events
server.py (Python 3.12, stdlib only)         subprocess mgr, NDJSON parser,
   ↓ stdin stream-json  ↑ stdout stream-json  transcript reader, permission broker
claude -p                                     the real CLI: same ~/.claude,
                                              skills, hooks, subscription auth
```

The CLI is never reimplemented. One long-lived `claude` process per open project; a new
turn is one NDJSON `user` message on stdin, never a respawn. `session_id` from the
`system/init` event is the only recovery path (`--resume <id>` after any crash).

### Requirements

Windows 10/11 · Microsoft Edge · Claude Code CLI, logged in · Python 3.12+
(`setup.ps1` installs Python and the CLI if they are missing).

### Run it

```powershell
# dev, with a console
C:\Python314\python.exe persian-claude-gui\server.py --cwd <project> --no-window

# dev, with the Edge window
C:\Python314\python.exe persian-claude-gui\server.py --cwd <project>

# the terminal edition (static-terminal/); default is --ui web
C:\Python314\python.exe persian-claude-gui\server.py --cwd <project> --ui terminal

# full bootstrap into a throwaway location (does not touch a real install)
.\persian-claude-gui\setup.ps1 -DeployRoot C:\tmp\pcg -ProjectDir C:\tmp\proj `
                              -ShortcutDir C:\tmp\lnk -SkipSmokeTest
```

Set `PYTHONIOENCODING=utf-8` before driving the server from PowerShell, or Persian
mojibakes in the console.

### Checks

| Check | Command | Cost |
|---|---|---|
| Rendering — the 12 spec cases through the shipping renderer, 18 assertions | `python persian-claude-gui\run_spec_test.py` | free |
| Transcript path guard (id resolution + traversal) | `python persian-claude-gui\test_transcript_path.py` | free |
| Transport + capability mirror, 10 checks | `python persian-claude-gui\smoke_test.py` | **one real CLI turn** |

`smoke_test.py` drives the actual CLI, so **it spends a real turn of your Claude
subscription** on every run. Run it at phase exits, not per commit. `run_spec_test.py`
is the gate for anything touching `static/` — `PASS — N/N`, exit 0. Tests pick the
edition from `PCG_UI` (`web` default; `terminal` for `test_column.py`, `test_keys.py`,
`test_dialogs.py`, `test_shell.py`, `test_strings.py`, `test_tui_vocab.py`); the full
table is in the project `CLAUDE.md` and `wiki/editions.md`.

### Security model

- Binds `127.0.0.1` only, on a random free port.
- A `secrets.token_urlsafe(32)` token is passed once in the window URL, then handed to
  the browser as a host-only `HttpOnly; SameSite=Strict` cookie; every later request is
  compared with `secrets.compare_digest`. Any other local process that guesses the port
  still has no token.
- The server's lifetime is tied to the window: last SSE client gone for ~10 s → the
  `claude` subprocess is killed and the process exits. No orphans.
- Nothing is uploaded anywhere. All traffic that leaves the machine is the CLI's own.

### Documentation

`wiki/` holds what cost the most to discover — the measured CLI contract
(`cli-stream-json-findings.md`), the RTL traps (`rtl-rendering-notes.md`), the approval
transport, the packaging encoding rules. Read the relevant one before editing that area;
several document failure modes that produce no error message at all.

`claude-persian-rtl-spec.md` is **binding** for anything that renders text. See
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).

Vazirmatn (SIL OFL) and marked (MIT) are vendored under `persian-claude-gui/static/`
on purpose: the target PC may be offline or locked down.

"Claude" and "Claude Code" are trademarks of Anthropic. This project is an independent
front-end that runs the official CLI; it is not affiliated with, endorsed by, or
supported by Anthropic.
