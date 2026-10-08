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
  // The five-hour usage wall (render.js resumeRow, server.py AUTO_RESUME_*).
  usageWall: "به سقف مصرف رسیدید.",
  autoResumeArmed: "ساعت {t} سقف آزاد می‌شود و کار خودش ادامه پیدا می‌کند.",
  autoResumeCancel: "ادامه نده",
  autoResumeFired: "سقف مصرف آزاد شد؛ کار ادامه پیدا کرد.",
  autoResumeCancelled: "ادامهٔ خودکار لغو شد. بعد از آزاد شدن سقف، خودتان پیامی بفرستید.",
  autoResumeStale: "سقف مصرف آزاد شده، ولی رایانه در این مدت خواب بود و کار خودش ادامه پیدا نکرد.",
  autoResumeNow: "ادامه بده",
  removeAttachment: "حذف",
  slashHint: "برای دیدن دستورها / را بزنید",
  hintZwnj: "نیم‌فاصله: Shift+Space",
  hintPosture: "سطح اجازه: Shift+Tab",

  thinking: "فکر",

  /* The working line, after claude.ai/code's
     «3m 51s · 117.6k tokens · 1 running task · Almost done thinking…»: what
     it is doing, and the chip for the background helpers still going. */
  pulseStart: "در حال کار…",
  pulseTasks: "{n} کار در حال اجرا",
  pulsePhases: {
    thinking: "در حال فکر کردن…",
    writing: "در حال نوشتن…",
    tools: "در حال اجرای ابزار…",
    waiting: "منتظر اجازهٔ شما…",
  },
  /* The TUI's own «esc to interrupt», the working line's tooltip. */
  spinnerInterrupt: "Esc برای توقف",
  /* The working line while ONE tool runs: present tense, and the call's own
     target follows it (js/render.js toolLine). A tool with no entry falls back
     to pulsePhases.tools; `mcp` is every `mcp__server__tool`. */
  pulseTools: {
    Bash: "در حال اجرای فرمان",
    BashOutput: "در حال خواندن خروجی فرمان",
    Read: "در حال خواندن",
    Write: "در حال نوشتن فایل",
    Edit: "در حال ویرایش",
    MultiEdit: "در حال ویرایش",
    NotebookEdit: "در حال ویرایش",
    Glob: "در حال جست‌وجوی فایل",
    Grep: "در حال جست‌وجو در متن",
    WebFetch: "در حال دریافت از وب",
    WebSearch: "در حال جست‌وجوی وب",
    Task: "در حال اجرای عامل",
    Agent: "در حال اجرای عامل",
    Skill: "در حال استفاده از مهارت",
    mcp: "در حال استفاده از MCP",
  },
  pulseTokens: "↓ {n} توکن",
  thousands: "{n} هزار",
  elapsedMinSec: "{m} دقیقه و {s} ثانیه",

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
    // `Agent` dispatches a helper that keeps working in the background. The row
    // is normally named by the model's own description of the work; this is the
    // fallback for a launch that arrived without one.
    Agent: "عامل پس‌زمینه",
  },

  /* A run of steps is ONE line, in the site's own
     vocabulary (wiki/claude-ai-code-reference.md §"Tool line vocabulary"):
     one part per kind in order of first use, past tense, one file named and
     several counted, «(N failed)» when a step failed. */
  actShellOne: "یک فرمان اجرا شد",
  actShellMany: "{n} فرمان اجرا شد",
  actReadOne: "{name} خوانده شد",
  actReadMany: "{n} فایل خوانده شد",
  actEditOne: "{name} ویرایش شد",
  actEditMany: "{n} فایل ویرایش شد",
  actWriteOne: "{name} ساخته شد",
  actWriteMany: "{n} فایل ساخته شد",
  actSearchOne: "یک جست‌وجو انجام شد",
  actSearchMany: "{n} جست‌وجو انجام شد",
  actFetchOne: "یک صفحهٔ وب خوانده شد",
  actFetchMany: "{n} صفحهٔ وب خوانده شد",
  actWebSearchOne: "در وب جست‌وجو شد",
  actWebSearchMany: "{n} جست‌وجو در وب انجام شد",
  actAgentOne: "یک عامل اجرا شد",
  actAgentMany: "{n} عامل اجرا شد",
  actBgDoneOne: "یک کار پس‌زمینه تمام شد",
  actBgDoneMany: "{n} کار پس‌زمینه تمام شد",
  actOtherOne: "از یک ابزار استفاده شد",
  actOtherMany: "از {n} ابزار استفاده شد",
  actThought: "فکر کرد",
  actJoin: "، ",
  actFailed: "({n} ناموفق)",

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
  agentClose: "بستن",
  agentEmpty: "هنوز چیزی از این عامل ثبت نشده است",
  agentsWaiting: "در انتظار {n} عامل پس‌زمینه…",
  /* The Background tasks panel, after claude.ai/code's. */
  tasksTitle: "کارهای پس‌زمینه",
  tasksRunning: "در حال اجرا",
  tasksNone: "کاری در حال اجرا نیست",
  tasksFinished: "پایان‌یافته {n}",
  tasksClear: "پاک کردن فهرست پایان‌یافته‌ها",
  tasksView: "دیدن گزارش",
  tasksStop: "توقف این کار",
  tasksKindAgent: "عامل",
  tasksKindCommand: "فرمان",
  tasksTokens: "{n} توکن",
  tasksToolUses: "{n} بار ابزار",
  tasksNow: {
    Bash: "در حال اجرای فرمان",
    PowerShell: "در حال اجرای فرمان",
    Read: "در حال خواندن فایل",
    Edit: "در حال ویرایش فایل",
    Write: "در حال نوشتن فایل",
    Grep: "در حال جست‌وجو",
    Glob: "در حال جست‌وجو",
    WebFetch: "در حال خواندن وب",
    WebSearch: "در حال جست‌وجوی وب",
    other: "در حال استفاده از ابزار",
  },

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
  renameSession: "تغییر نام",
  copySessionId: "کپی شناسهٔ گفتگو",
  sessionIdCopied: "شناسهٔ گفتگو کپی شد. برای ادامهٔ همین گفتگو در ترمینال:",
  sessionIdCopyFailed: "کپی ممکن نشد. برای ادامهٔ همین گفتگو در ترمینال:",
  searchSessions: "جستجوی گفتگوها",
  searchResults: "نتیجه‌ها",
  searchEmpty: "گفتگویی پیدا نشد",
  confirmDelete: "مطمئنید؟",
  deleteFailed: "حذف ناموفق بود",
  replaying: "نمایش تاریخچه — برای ادامه دکمه «ادامه» را بزنید",
  resumed: "گفتگو از سر گرفته شد",

  newChat: "گفتگوی جدید",
  /* A conversation in a git worktree of its own: the same repository, checked
     out a second time under .claude/worktrees/, so two conversations can edit
     it at once without overwriting each other. «شاخه» is the word for a git
     branch, which is what the CLI actually makes; the audience never has to
     name one, and never sees the path. */
  newChatWorktree: "گفتگوی جدید در شاخهٔ جدا",
  worktreeOf: "این گفتگو در شاخهٔ جدای «{name}» کار می‌کند",
  notGitRepo: "این پوشه مخزن گیت نیست، پس شاخهٔ جدا ندارد",
  projects: "پروژه‌ها",

  /* Concurrent conversations. Each open session is a separate running Claude —
     «نشست» is the same word the statusline already uses for it. `tabFresh` is
     what a conversation is called before it has said anything: it has no title
     yet because the title is made from the first message. */
  openSessions: "نشست‌های باز",
  tabFresh: "گفتگوی تازه",
  closeSession: "بستن این نشست",
  sessionLive: "این گفتگو باز است",
  /* Per-conversation status, painted on the dot in the tab strip and on the
     matching session row. Four words, one per state: the CLI is answering, a
     dialog is sitting on the person, the last turn failed, or nothing is
     happening. «آماده» rather than «بی‌کار» — the conversation is waiting for
     the user, not idle in the sense of neglected. */
  tabStatus: {
    running: "در حال کار",
    waiting: "منتظر تأیید",
    error: "خطا در آخرین پاسخ",
    idle: "آماده",
  },
  /* The one chip over the open-conversations list. Waiting wins over working:
     it is the one that needs a person. */
  tabsRunning: "{n} در حال کار",
  tabsWaiting: "{n} منتظر تأیید",
  // The count next to a parked conversation's dot: turns that finished while
  // you were reading another one.
  tabUnread: "{n} پاسخ تازه",
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
  askTabN: "پرسش {n}",
  askOther: "پاسخ دیگر",
  askOtherPlaceholder: "پاسخ خودتان را بنویسید…",
  askSubmit: "ارسال پاسخ",
  askSkip: "رد کردن",
  askMulti: "می‌توانید چند مورد را انتخاب کنید",
  askAnswered: "پاسخ داده شد",
  askSkipped: "بدون پاسخ رد شد",
  askNoAnswer: "—",
  questionsRow: "پرسش‌ها",
  markFork: "گفتگوی تازه از اینجا",
  markForkBefore: "گفتگوی تازه از پیش از این پیام، با همین متن در جای نوشتن",
  forkDone: "گفتگوی تازه از همان نقطه — گفتگوی قبلی دست نخورده ماند",
  forkFailed: "ساختن گفتگوی تازه از اینجا نشد",
  focusSteps: "{n} مرحله",
  focusOn: "نمای متمرکز روشن شد: مراحل کار هر نوبت پشت یک سطر رفت. همین دستور یا Ctrl+Alt+F برش می‌گرداند.",
  focusOff: "نمای متمرکز خاموش شد: همهٔ مراحل کار دوباره دیده می‌شوند.",
  permCount: "{i} از {n}",

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
  postureAutoApprove: "تأیید همه",
  postureAutoApproveNote: "همه‌چیز را بدون پرسش انجام می‌دهد و شمار اقدام‌ها را نشان می‌دهد",
  postureFailed: "تغییر سطح اجازه ممکن نشد",
  autoActions: "اقدام خودکار",
  autoActionsTitle: "کارهایی که بدون پرسش انجام شدند",
  autoActionsEmpty: "هنوز چیزی بدون پرسش انجام نشده",
  autoWhyRemembered: "چون گفتید دوباره نپرس",
  autoWhyPosture: "سطح اجازه: تأیید همه",

  /* --- the CLI features the terminal edition already had (E3) ---------------
     Every string below belongs to something the real `claude` does in a
     terminal and this window did not: walking the prompt history, `@` file
     mentions, `!` shell lines, the external editor, /export and /branch. The
     wording is the window's own — the CLI says none of this in Persian. */

  /* Ctrl+R, the reverse search over ~/.claude/history.jsonl. */
  searchNone: "چیزی پیدا نشد",
  searchHint: "جست‌وجو در پیام‌های پیشین — Enter برای برداشتن، Esc برای بستن",

  /* `@` completion, from the CLI's own file index. */
  fileNone: "فایلی پیدا نشد",

  /* `!` shell mode. The chip says WHAT the box will do, because a line that
     starts with «!» is the one case where Enter does not send a message. */
  bashChip: "دستور سیستمی",
  shellExit: "کد خروج {n}",
  shellNoOutput: "بدون خروجی",
  shellFailed: "اجرای دستور ناموفق بود",

  /* Ctrl+G, the external editor. The box is shut while the editor is open, so
     the placeholder is the only thing telling the user why. */
  editorWaiting: "در ویرایشگر بیرونی باز است؛ ذخیره کنید تا برگردد",
  editorFailed: "باز کردن ویرایشگر ناموفق بود",
  hintEditor: "ویرایشگر بیرونی: Ctrl+G",

  /* /export — the window writes what it drew, so these two labels are what a
     reader of the saved file sees instead of the bubbles. */
  exportYou: "شما:",
  exportClaude: "کلاد:",
  cmdExportDesc: "ذخیرهٔ این گفتگو در یک فایل متنی",
  cmdExported: "گفتگو در این فایل ذخیره شد:",
  cmdExportEmpty: "هنوز گفتگویی برای ذخیره نیست",
  cmdExportFailed: "ذخیرهٔ گفتگو ممکن نشد",

  /* /branch — a copy of this conversation in a new tab; the original is left
     exactly as it was, which is the whole point of saying so out loud. */
  cmdBranchDesc: "ادامهٔ یک کپی از این گفتگو در گفتگوی تازه",
  cmdBranchDone: "شاخهٔ جدید: کپی این گفتگو باز شد؛ گفتگوی اصلی سر جای خودش است",
  cmdBranchFailed: "شاخه‌زدن از این گفتگو ممکن نشد",

  /* The split (MA4): how many conversations are on screen at once. The numbers
     are the whole vocabulary — «۱ / ۲ / ۴» — so the refusal names them rather
     than describing them. The window bar's three buttons and `/split` say the
     same thing; each column carries its own digit, and the badge's tooltip is
     what says what that digit is for. */
  splitLabel: "چند گفتگو کنار هم",
  splitOptionTitle: "نمایش {n} گفتگو در یک پنجره",
  cmdSplitDesc: "چند گفتگو کنار هم: ۱ یا ۲ یا ۴",
  cmdFocusDesc: "فقط پیام‌ها و پاسخ‌ها؛ مراحل کار هر نوبت پشت یک سطر — Ctrl+Alt+F",
  cmdSplitUsage: "این دستور فقط ۱ یا ۲ یا ۴ را می‌پذیرد",
  cmdSplitDone: "چیدمان به {n} ستون تغییر کرد",
  /* ۴ is NOT four columns — it is a 2×2 grid, and the terminal edition's own
     notice said «۴ ستون» over a layout with two of them (MA3-T4 defect 4). */
  cmdSplitDoneGrid: "چیدمان به چهار گفتگو در دو ستون و دو ردیف تغییر کرد",
  cellBadgeTitle: "ستون {n} — با Alt+{n} به اینجا بیایید",
  /* Message marks (js/marks.js, pcg-8ip — the same keys in both editions). */
  markJustNow: "همین حالا",
  markMinutesAgo: "{n} دقیقهٔ پیش",
  markHoursAgo: "{n} ساعت پیش",
  markYesterday: "دیروز",
  markCopy: "رونوشت متن",
  markCopied: "رونوشت شد",
  markPin: "سنجاق کردن این پیام",
  markUnpin: "برداشتن سنجاق",
  markPinsTitle: "پیام‌های سنجاق‌شده",
  markSessionStart: "شروع گفتگو",
  markPinned: "پیام سنجاق‌شده",
  markEdited: "{n} فایل ویرایش شد",
  // pcg-lw0: a user turn's image (alt text) and the diff side panel's close.
  markImage: "تصویر پیوست",
  diffClose: "بستن",
  // A long message of yours, clipped (marks.js foldLong).
  foldMore: "بیشتر",
  foldLess: "کمتر",
  /* The composer bar (COMPOSER-BAR.md, js/bar.js — the same keys in both
     editions). */
  barMode: "حالت",
  barModel: "مدل",
  barEffort: "تلاش",
  barFaster: "سریع‌تر",
  barSmarter: "باهوش‌تر",
  barUsage: "زمینه و مصرف",
  barUsageTitle: "زمینه و مصرف — {n}٪ از پنجرهٔ زمینه پر است",
  barContext: "پنجرهٔ زمینه",
  barBaseline: "هنوز پیامی فرستاده نشده. این عدد پایهٔ هر گفتگوی تازه است (دستورها، ابزارها و حافظه) و چیزی از سهمیه مصرف نشده.",
  barOf: "{used} از {max}",
  barThousand: "{n} هزار",
  barMillion: "{n} میلیون",
  barUntilCompact: "{n} مانده تا فشرده‌سازی خودکار",
  barCompact: "فشرده کردن گفتگو",
  barDetails: "جزئیات",
  barLimits: "سقف مصرف",
  barLimit5h: "سهمیهٔ ۵ ساعته",
  barLimitWeek: "هفتگی · همهٔ مدل‌ها",
  barLimitWeekModel: "هفتگی · {name}",
  barResetsIn: "بازنشانی تا {t}",
  barResetsAt: "بازنشانی {t}",
  barInHoursMinutes: "{h} ساعت و {m} دقیقهٔ دیگر",
  barInMinutes: "{m} دقیقهٔ دیگر",
  barNoLimits: "این ورود سقف مصرفی گزارش نمی‌کند",
  barLoading: "در حال خواندن…",
  barPlus: "افزودن",
  barFiles: "پیوست فایل یا عکس",
  barConnectors: "اتصال‌ها (سرورهای MCP)",
  barConnectorsNote: "روشن یا خاموش کردن یک سرور برای همین پوشه ذخیره می‌شود.",
  barNoServers: "هیچ سرور MCP‌ای تعریف نشده است.",
  barMoreModels: "مدل‌های دیگر",
  barMention: "اشاره به فایلی از پروژه",
  barPalette: "فرمان‌ها",
  barPaletteFilter: "جستجوی فرمان…",
  barPaletteEmpty: "فرمانی با این نام نیست.",
  barCache: "کش گفتگو",
  barCacheMinutes: "{n} دقیقه",
  barCacheWarm: "کش گفتگو گرم است؛ حدود {n} دقیقهٔ دیگر. پیامی که تا آن موقع بفرستید سریع‌تر و ارزان‌تر است.",
  barCacheCold: "کش گفتگو احتمالاً سرد شده است (بی‌کار {t}).",
  barCacheRecache: "پیام بعدی حدود {n} توکن را دوباره در کش می‌نویسد.",
  barCacheCompacted: "گفتگو فشرده شد؛ پیام بعدی آن را دوباره در کش می‌نویسد.",
  barIdleMinutes: "{m} دقیقه",
  barIdleHours: "{h} ساعت و {m} دقیقه",
  barIdleDays: "{d} روز",
  // The «/» palette: its groups, and a Persian name for the commands a person
  // reaches for. A command not named here shows its own name and the CLI's
  // description, in the last group.
  paletteGroups: {
    chat: "گفتگو",
    model: "مدل و حالت",
    project: "پروژه",
    other: "فرمان‌ها و مهارت‌های دیگر",
  },
  paletteNames: {
    clear: "پاک کردن گفتگو",
    compact: "فشرده کردن گفتگو",
    export: "خروجی گرفتن از گفتگو",
    resume: "ادامهٔ یک گفتگوی قبلی",
    rewind: "برگشتن به نقطه‌ای قبل‌تر",
    branch: "شاخهٔ تازه از همین گفتگو",
    rename: "تغییر نام گفتگو",
    context: "پنجرهٔ زمینه",
    cost: "هزینهٔ این گفتگو",
    usage: "مصرف و سقف‌ها",
    model: "انتخاب مدل",
    effort: "میزان تلاش",
    "output-style": "سبک پاسخ",
    permissions: "اجازه‌ها",
    fast: "حالت سریع",
    init: "ساختن فایل راهنمای پروژه",
    memory: "ویرایش حافظه",
    "add-dir": "افزودن پوشهٔ دیگر",
    agents: "عامل‌ها",
    hooks: "هوک‌ها",
    mcp: "سرورهای MCP",
    review: "بازبینی کد",
    "security-review": "بازبینی امنیتی",
    status: "وضعیت",
    help: "راهنما",
  },
  barServerStatus: {
    connected: "وصل",
    pending: "در حال اتصال",
    failed: "وصل نشد",
    disabled: "خاموش",
    "needs-auth": "نیاز به ورود",
  },
  contextCategories: {
    "System prompt": "دستور سیستم",
    "System tools": "ابزارهای سیستم",
    "System tools (deferred)": "ابزارهای سیستم (بعداً)",
    "MCP tools": "ابزارهای MCP",
    "Custom agents": "دستیارهای سفارشی",
    "Memory files": "فایل‌های حافظه",
    "Skills": "مهارت‌ها",
    "Messages": "پیام‌ها",
    "Autocompact buffer": "ذخیرهٔ فشرده‌سازی",
    "Free space": "جای خالی",
  },

};

window.STRINGS = window.FA;
