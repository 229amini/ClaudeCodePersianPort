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
  hintPosture: "سطح اجازه: Shift+Tab",

  thinking: "در حال فکر کردن",

  /* The turn's live line. The CLI answers "is it still working?" with one
     changing sentence — a whimsical gerund, how long, how much it has written —
     and the whimsy is the point: a turn that takes four minutes needs a line
     that is not the same four words for four minutes.

     These are masdars (verbal nouns) because ONE word has to read in both
     frames: «در حال بافتن…» while it runs, «بافتن — ۵ دقیقه و ۳۲ ثانیه» once it
     is done. A conjugated past tense would need a second list. */
  pulseVerbs: [
    "بافتن", "جوشاندن", "سنجیدن", "ورز دادن", "کندوکاو", "چیدن", "تراشیدن",
    "گره زدن", "پختن", "رصد کردن", "صیقل دادن", "ریسیدن", "نقشه کشیدن",
    "پروراندن", "غربال کردن", "کاویدن", "دم کردن", "جوش خوردن",
  ],
  pulseRunning: "در حال {verb}…",
  pulseDone: "{verb} — {time}",
  pulseTokens: "↓ {n} توکن",
  thousands: "{n} هزار",
  elapsedMinSec: "{m} دقیقه و {s} ثانیه",

  tool: "ابزار",
  toolResult: "نتیجه",
  todos: "کارها",
  rawEvent: "رویداد ناشناخته",
  diffTruncated: "{n} خط دیگر نشان داده نشد",

  /* The `⎿` branch under a tool row. The TUI writes «+N lines (ctrl+o to
     expand)» there because it shows the first few lines and hides the rest;
     v2 shows none of them until ctrl+o, so the count is the whole output and
     the «+» would be a lie about what is already on screen
     (wiki/tui-strings.md §3, V2-PLAN §3.1). */
  toolResultLines: "{n} سطر",
  expandHint: "(ctrl+o برای باز کردن)",
  hintExpand: "باز کردن نتیجه‌ها: Ctrl+O",

  /* The CLI compacted the conversation to make room. Its own banner string is
     «Conversation compacted»; the numbers come from compact_metadata
     (wiki/cli-stream-json-findings.md §5.9). */
  compacted: "گفتگو فشرده شد",
  compactedTokens: "{before} ← {after} توکن",

  /* A long paste is parked as one chip instead of filling the box, exactly as
     the TUI does it. `{n}` is the paste's number, `{lines}` the newline count
     the CLI's own `cue()` writes (measured: 800 characters or more than two
     newlines is what triggers it). */
  pastePlaceholder: "[متن چسبانده‌شده #{n} +{lines} سطر]",
  pastePlaceholderShort: "[متن چسبانده‌شده #{n}]",
  pasteDrop: "حذف متن چسبانده‌شده",

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
    // `Agent` dispatches a helper that keeps working in the background. The row
    // is normally named by the model's own description of the work; this is the
    // fallback for a launch that arrived without one.
    Agent: "عامل پس‌زمینه",
  },

  /* Counted form, for the row that collapses a run of consecutive calls:
     «۱ فایل خوانده شد، ۱۱ فرمان اجرا شد». The verbs above read as a label on
     one card; after a number they need their noun back, or «۱۱ اجرا شد» says
     eleven of nothing. Unlisted tools fall back to the verb, then to the name. */
  toolGroupNouns: {
    Read: "فایل خوانده شد",
    Write: "فایل نوشته شد",
    Edit: "ویرایش",
    MultiEdit: "ویرایش",
    NotebookEdit: "ویرایش",
    Bash: "فرمان اجرا شد",
    Glob: "جست‌وجوی فایل",
    Grep: "جست‌وجو در متن",
    WebFetch: "دریافت از وب",
    WebSearch: "جست‌وجوی وب",
    Task: "کار فرعی",
    Skill: "مهارت",
    Agent: "عامل پس‌زمینه اجرا شد",
  },

  /* A polling loop wrote the same sentence and made the same call eight times;
     the transcript keeps one of them and says how many there were. Persian
     digits — this is prose chrome, not a technical value (spec rule 5). */
  cycleRepeat: "{n} بار",

  /* Background agents. The CLI dispatches helpers that keep working after the
     turn ends; the strip above the composer is where they live. Nothing here
     names a specific agent — the set is per-machine, exactly like the MCP
     servers and the subagent list. */
  agentRow: "عامل پس‌زمینه",
  agentLaunched: "عامل در پس‌زمینه اجرا شد",
  agentDone: "عامل پس‌زمینه تمام شد",
  agentEnded: "عامل پس‌زمینه پایان یافت",
  agentRunning: "در حال اجرا",
  agentOpen: "دیدن کاری که این عامل انجام می‌دهد",
  agentClose: "بستن",
  agentEmpty: "هنوز چیزی از این عامل ثبت نشده است",
  agentsWaiting: "در انتظار {n} عامل پس‌زمینه…",
  agentHistory: "عامل‌های پیشین ({n})",

  /* The queue. A message sent while Claude is still answering is not delivered
     — it waits in the CLI's own command queue — so the window says «در صف»
     instead of drawing it as a message that has arrived. */
  queuedTag: "در صف",
  queuedCancel: "حذف از صف",

  connecting: "در حال اتصال…",
  disconnected: "اتصال قطع شد",
  sendFailed: "ارسال ناموفق بود",
  pasteFailed: "چسباندن تصویر ناموفق بود",
  moreActions: "کارهای بیشتر",
  copyCode: "کپی کد",
  copied: "کپی شد",
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

  /* Concurrent conversations. Each open session is a separate running Claude —
     «نشست» is the same word the statusline already uses for it. `tabFresh` is
     what a conversation is called before it has said anything: it has no title
     yet because the title is made from the first message. */
  openSessions: "نشست‌های باز",
  tabFresh: "گفتگوی تازه",
  closeSession: "بستن این نشست",
  sessionLive: "این گفتگو باز است",
  maxTabs: "بیشتر از ۶ گفتگو هم‌زمان باز نمی‌شود؛ اول یکی را ببندید",
  permOtherSession: "این درخواست از گفتگوی دیگری است:",
  // The composer's placeholder while no conversation is open at all: there is
  // nothing to send to, so the box says what to do instead of failing a send.
  composerBlank: "برای شروع، گفتگویی باز کنید",

  removeProject: "حذف پروژه و گفتگوهایش",
  projectOpenNote: "این پروژه باز است؛ برای حذفش اول پروژه‌ی دیگری را باز کنید",
  archiveProject: "بایگانی",
  unarchiveProject: "خروج از بایگانی",
  // Renames the LABEL, never the folder on disk — «نمایشی» would be noise for
  // this audience, so the tooltip keeps showing the real path instead.
  renameProject: "تغییر نام",
  pinProject: "سنجاق به بالای فهرست",
  unpinProject: "برداشتن سنجاق",
  pinnedProject: "سنجاق‌شده",
  // «پوشه», not «فایل‌اکسپلورر»: the audience knows what a folder is and the
  // server opens it through the shell, so the file manager is whatever theirs is.
  openInExplorer: "باز کردن پوشه پروژه",
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
  idleTitle: "مدتی از این گفتگو گذشته",
  idleBody: "اگر سراغ کار تازه‌ای می‌روید، گفتگوی تازه شروع کنید — پاسخ‌ها سریع‌تر و دقیق‌تر می‌مانند.",

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
  /* Output styles. The CLI advertises the set — «default» plus whatever style
     files the machine has — so a name not listed here falls back to itself,
     exactly like the effort levels and the MCP server names. */
  styleTitle: "لحن پاسخ",
  styleNames: {
    default: "پیش‌فرض",
    Proactive: "پیش‌دستانه",
    Explanatory: "توضیحی",
    Learning: "آموزشی",
  },
  styleFailed: "تغییر لحن پاسخ ممکن نشد",

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
