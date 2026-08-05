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

  connecting: "در حال اتصال…",
  disconnected: "اتصال قطع شد",
  sendFailed: "ارسال ناموفق بود",
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
  postureTitle: "سطح اجازه",
  postureAsk: "محتاط",
  postureAskNote: "پیش از هر تغییری از شما می‌پرسد",
  postureAcceptEdits: "ویرایش آزاد",
  postureAcceptEditsNote: "فایل‌های پروژه را بدون پرسش ویرایش می‌کند؛ برای اجرای دستور باز هم می‌پرسد",
  postureAutoApprove: "خودکار",
  postureAutoApproveNote: "همه‌چیز را بدون پرسش انجام می‌دهد و شمار اقدام‌ها را نشان می‌دهد",
  postureFailed: "تغییر سطح اجازه ممکن نشد",
  autoActions: "اقدام خودکار",
  autoActionsTitle: "کارهایی که بدون پرسش انجام شدند",
};

window.STRINGS = window.FA;
