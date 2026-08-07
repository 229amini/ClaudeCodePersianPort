/* Persian UI labels. Flat key -> string, no i18n framework (plan §B-8).
   Digits stay Latin wherever they abut a technical value (spec rule 5).

   The modules read window.STRINGS, aliased at the bottom of this file. That
   alias IS the i18n seam: a second language is one more strings.<lang>.js and
   one swapped <script> tag in index.html — no module changes. No English file
   ships until someone asks for one. */
window.FA = {
  /* Product name. «کلاد» is the transliteration used everywhere in the UI —
     never «کلود», and never Anthropic's mark: this is an independent front-end
     (REWORK-PLAN.md "Two judgment calls", option b). */
  appName: "کلاد فارسی",
  appTagline: "رابط فارسی برای Claude Code",
  independence: "این پروژه مستقل است و وابسته به Anthropic نیست.",

  stopped: "متوقف شد",
  removeAttachment: "حذف",
  slashHint: "برای دیدن دستورها / را بزنید",
  hintZwnj: "نیم‌فاصله: Shift+Space",

  thinking: "در حال فکر کردن",
  tool: "ابزار",
  toolResult: "نتیجه",
  todos: "کارها",
  rawEvent: "رویداد ناشناخته",
  diffTruncated: "{n} خط دیگر نشان داده نشد",

  /* What each CLI tool is called in the transcript. The audience is
     non-technical: «Edit» means nothing to them, «ویرایش شد» does. A tool that
     is not listed falls back to its own name rather than to a wrong guess —
     the CLI's tool set changes between versions. */
  toolVerbs: {
    Read: "خوانده شد",
    Write: "نوشته شد",
    Edit: "ویرایش شد",
    MultiEdit: "ویرایش شد",
    NotebookEdit: "ویرایش شد",
    Bash: "اجرا شد",
    BashOutput: "خروجی فرمان",
    KillShell: "توقف فرمان",
    Glob: "جست‌وجوی فایل",
    Grep: "جست‌وجو در متن",
    WebFetch: "دریافت از وب",
    WebSearch: "جست‌وجوی وب",
    Task: "کار فرعی",
    Skill: "مهارت",
    AskUserQuestion: "پرسش",
    ExitPlanMode: "طرح کار",
  },

  connecting: "در حال اتصال…",
  disconnected: "اتصال قطع شد",
  sendFailed: "ارسال ناموفق بود",
  pasteFailed: "چسباندن تصویر ناموفق بود",
  moreActions: "کارهای بیشتر",
  elapsedSeconds: "{n} ثانیه",
  elapsedMinutes: "{n} دقیقه",
  cliExited: "پردازش کلاد بسته شد",
  waiting: "در انتظار…",

  help: "راهنما",
  sessionsEmpty: "هنوز گفتگویی در این پوشه نیست",
  continueSession: "ادامه",
  viewSession: "نمایش",
  deleteSession: "حذف",
  confirmDelete: "مطمئنید؟",
  deleteFailed: "حذف ناموفق بود",
  replaying: "نمایش تاریخچه — برای ادامه دکمه «ادامه» را بزنید",
  resumed: "گفتگو از سر گرفته شد",

  newChat: "گفتگوی جدید",
  projects: "پروژه‌ها",
  removeProject: "حذف پروژه و گفتگوهایش",
  projectOpenNote: "این پروژه باز است؛ برای حذفش اول پروژه‌ی دیگری را باز کنید",
  archiveProject: "بایگانی",
  unarchiveProject: "خروج از بایگانی",
  archiveSection: "بایگانی",
  chooseProject: "انتخاب پروژه",
  greetMorning: "صبح بخیر! امروز چه کنیم؟",
  greetDay: "سلام! چه کاری انجام دهیم؟",
  greetEvening: "عصر بخیر! چه کاری انجام دهیم؟",
  greetNight: "شب‌زنده‌داری؟",

  /* Home action cards. `homeExplain` is both the card's label and the text it
     puts in the composer, so the user sees exactly what they are about to
     send — no hidden prompt. */
  homeResume: "ادامه آخرین گفتگو",
  homeResumeNote: "همان‌جا که رهایش کردید",
  homeOpen: "باز کردن پوشه",
  homeOpenNote: "روی پروژه دیگری کار کنید",
  homeExplain: "این پوشه را برایم توضیح بده",
  homeExplainNote: "شروع سریع در همین پروژه",
  homeHelp: "راهنما",
  homeHelpNote: "چطور با این برنامه کار کنم؟",

  previewEmpty: "متنی برای پیش‌نمایش نیست",

  permTitle: "درخواست اجازه",
  permBody: "کلاد می‌خواهد این ابزار را اجرا کند:",
  permAllow: "اجازه بده",
  permDeny: "رد کن",
  permRemember: "تا پایان این نشست برای این ابزار دوباره نپرس",
  permAllowed: "اجازه داده شد",
  permDenied: "رد شد",

  /* AskUserQuestion. Not an approval — the model is asking something and waits
     for the answer, so the wording never says «اجازه». «رد کردن» skips the
     question, which is what the CLI's own Skip button does. */
  askTitle: "کلاد یک پرسش دارد",
  askBody: "برای ادامه، پاسخ خود را انتخاب کنید.",
  askOther: "پاسخ دیگر",
  askOtherPlaceholder: "پاسخ خودتان را بنویسید…",
  askSubmit: "ارسال پاسخ",
  askSkip: "رد کردن",
  askMulti: "می‌توانید چند مورد را انتخاب کنید",
  askAnswered: "پاسخ داده شد",
  askSkipped: "بدون پاسخ رد شد",
  askNoAnswer: "—",

  /* The conversation is filling up. Two actions, because the CLI's own advice
     is «/compact or /clear» and they mean different things: compact keeps the
     thread, clear starts over. The percentage is prose, so Persian digits. */
  ctxTitle: "گفتگو دارد پر می‌شود",
  ctxBody: "{n}٪ از حافظه گفتگو استفاده شده است.",
  ctxTitleFull: "حافظه گفتگو پر شد",
  ctxBodyFull: "برای ادامه، گفتگو را فشرده کنید یا یکی تازه شروع کنید.",
  ctxCompact: "فشرده کردن گفتگو",
  ctxCompactNote: "خلاصه می‌شود و همین گفتگو ادامه پیدا می‌کند",
  ctxClear: "گفتگوی تازه",
  ctxClearNote: "از نو شروع می‌شود",
  ctxDismiss: "بعداً",

  slModel: "مدل",
  slFolder: "پوشه",
  slCost: "هزینه",
  slMode: "حالت",
  slSession: "نشست",
  slContext: "متن",
  slQuota: "سهمیه ۵ ساعته",
  slNone: "—",

  /* model picker + approval posture — every label the CLI itself supplies
     (model names, descriptions) is rendered as it arrives, never translated:
     they are product names, and a wrong Persian guess would be worse. */
  modelTitle: "مدل",
  modelDefault: "مدل پیش‌فرض",
  modelFailed: "تغییر مدل ممکن نشد",
  /* Reasoning effort. The CLI names the levels; these are their Persian
     labels. A level not listed here falls back to its own name — the CLI's set
     changes between versions and a wrong guess is worse than English. */
  effortTitle: "میزان تفکر",
  effortLevels: {
    low: "کم",
    medium: "متوسط",
    high: "زیاد",
    xhigh: "خیلی زیاد",
    max: "بیشینه",
  },
  effortRefused: "این میزان روی این نسخه اعمال نمی‌شود",

  postureTitle: "سطح اجازه",
  posturePlan: "طرح‌ریزی",
  posturePlanNote: "فقط بررسی می‌کند و طرح کار را می‌نویسد؛ تا وقتی طرح را نپذیرید چیزی را تغییر نمی‌دهد",
  postureAsk: "محتاط",
  postureAskNote: "پیش از هر تغییری از شما می‌پرسد",
  postureAcceptEdits: "ویرایش آزاد",
  postureAcceptEditsNote: "فایل‌های پروژه را بدون پرسش ویرایش می‌کند؛ برای اجرای دستور باز هم می‌پرسد",
  postureAutoApprove: "خودکار",
  postureAutoApproveNote: "همه‌چیز را بدون پرسش انجام می‌دهد و شمار اقدام‌ها را نشان می‌دهد",
  postureFailed: "تغییر سطح اجازه ممکن نشد",
  autoActions: "اقدام خودکار",
  autoActionsTitle: "کارهایی که بدون پرسش انجام شدند",
  autoActionsEmpty: "هنوز چیزی بدون پرسش انجام نشده",
  autoWhyRemembered: "چون گفتید دوباره نپرس",
  autoWhyPosture: "سطح اجازه: خودکار",
};

window.STRINGS = window.FA;
