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
  appName: "کلاد فارسی — ترمینال",

  stopped: "متوقف شد",
  removeAttachment: "حذف",

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
  /* The tail of the running line, and the TUI's own («esc to interrupt»,
     wiki/tui-strings.md §4). The stop button says the same thing in its
     tooltip, but a tooltip is not on screen — the line that says the turn is
     still going is where the way out belongs. */
  spinnerInterrupt: "Esc برای توقف",

  tool: "ابزار",
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

  /* `!` bash mode (V2-PLAN §3.2). The command runs in the project folder and
     its output goes into the conversation with the next message — the same
     thing the TUI does with it, so the row says what ran and what came back
     and nothing else. */
  shellExit: "کد خروج {n}",
  shellNoOutput: "بدون خروجی",
  shellFailed: "اجرای دستور ناموفق بود",

  /* Ctrl+R, the history search. The box holds what is being searched for; this
     row shows the match that would land in it. */
  searchLabel: "جست‌وجو در تاریخچه",
  searchNone: "چیزی پیدا نشد",
  searchHint: "Ctrl+R بعدی · Tab گذاشتن در جعبه · Enter فرستادن",

  /* Ctrl+G. The draft goes to a file, Windows opens it with whatever the user
     has chosen for .md, and the window waits for the save. */
  editorWaiting: "در ویرایشگر بیرونی باز است؛ ذخیره کنید تا برگردد",
  editorFailed: "باز کردن ویرایشگر ناموفق بود",

  /* No file matched the `@` query. The CLI's index warms up on demand, so the
     first ask right after a session opens can legitimately answer nothing. */
  fileNone: "فایلی پیدا نشد",

  /* The `?` sheet: every key the window binds, in the TUI's own order of
     importance. One list, two readers — js/composer.js dispatches from it. */
  keysTitle: "کلیدها",
  keysClose: "بستن",
  /* The TUI's own footer under the same table is «esc to close · esc again
     quits». Only the first half survives here: a window is closed from its
     close button, so «خروج دوباره» would name a key that does nothing
     (V2-PLAN §8.5). */
  keysEscHint: "Esc برای بستن",
  keySend: "فرستادن پیام",
  keyNewline: "سطر تازه",
  keyStop: "توقف نوبت در حال اجرا",
  keyHistory: "پیام‌های پیشین همین پروژه",
  keySearch: "جست‌وجو در تاریخچه",
  keySlash: "فهرست دستورها",
  keyFiles: "نام بردن از یک فایل",
  keyBash: "اجرای دستور در پوشهٔ پروژه",
  keyEditor: "ویرایش پیش‌نویس در ویرایشگر بیرونی",
  keyClear: "خالی کردن جعبهٔ نوشتن",
  keyExpand: "باز کردن نتیجه‌های ابزار",
  keyTodos: "باز و بستهٔ فهرست کارها",
  keyThinking: "نمایش «در حال فکر کردن»",
  keyModel: "انتخاب مدل",
  keyPosture: "چرخش سطح اجازه",
  keyZwnj: "نیم‌فاصله",
  keyPaste: "چسباندن تصویر",
  keyQueue: "فرستادن به صف",
  keySheet: "همین فهرست",
  keyDialogPick: "انتخاب گزینه در گفت‌وگوی اجازه",

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
  /* §D11: a tool run shows its newest step; the earlier ones fold behind this. */
  runEarlier: "+{n} مورد قبلی",
  /* §D11: a long message of yours folds to six lines. */
  foldMore: "بیشتر",
  foldLess: "کمتر",
  /* §D11.3: a long history draws its last part; this brings back the rest. */
  historyEarlier: "نمایش پیام‌های قبلی ({n})",
  /* §D13: the app zoom readout, only when the window zooms itself. */
  sideZoom: "بزرگ‌نمایی {n}٪",
  /* The Changes panel (BRIDGEMIND-PORT.md §D12): what git sees different in
     this pane's folder. */
  paneChanges: "تغییرات این پوشه",
  slChanges: "{n} فایل تغییر کرد",
  chBack: "→ گفتگو",
  chTitle: "تغییرات",
  chTitleCount: "تغییرات · {n} فایل",
  chRefresh: "تازه‌سازی",
  chLoading: "در حال خواندن…",
  chNone: "تغییری نیست",
  chNoRepo: "این پوشه مخزن گیت نیست",
  chNoGit: "گیت روی این رایانه نصب نیست",
  chTooLarge: "برای نمایش بزرگ است ({n} خط)",
  chFailed: "خوانده نشد",
  chMine: "تغییرات این گفتگو",
  chOther: "تغییرات دیگر در این پوشه",
  chAll: "تغییرات این پوشه",
  chStatus: {
    M: "تغییر کرده",
    A: "افزوده شده",
    D: "حذف شده",
    R: "نامش عوض شده",
    C: "رونوشت",
    U: "ناسازگاری ادغام",
    "?": "تازه، هنوز در گیت نیست",
  },

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

  disconnected: "اتصال قطع شد",
  sendFailed: "ارسال ناموفق بود",
  sendFailedRestored: "ارسال نشد — متن به جعبهٔ پیام برگشت",
  // A1: this sentence is the whole refusal. Every reason the file could be
  // turned down — too big, not text, unreadable — is one silent null on the
  // CLI's side, so the rule itself has to be in the message.
  pasteFailed: "این فایل ضمیمه نشد — فقط عکس، یا فایل متنی تا ۲۵۶ کیلوبایت",
  moreActions: "کارهای بیشتر",
  copyCode: "کپی کد",
  copied: "کپی شد",
  elapsedSeconds: "{n} ثانیه",
  elapsedMinutes: "{n} دقیقه",
  cliExited: "پردازش کلاد بسته شد",

  help: "راهنما",
  sessionsEmpty: "هنوز گفتگویی در این پوشه نیست",
  continueSession: "ادامه",
  viewSession: "نمایش",
  deleteSession: "حذف",
  confirmDelete: "مطمئنید؟",
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
  openSessions: "گفتگوهای باز",
  // The open row's state in words (BRIDGEMIND-PORT.md §D4). Idle has none:
  // silence is the idle state.
  rowState: { running: "در حال کار", waiting: "منتظر شما", error: "خطا" },
  projSessionCount: "{n} گفتگو",
  justNow: "همین حالا",
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
  // The prompt's placeholder by state (BRIDGEMIND-PORT.md §D10): the only key
  // hint left under the prompt is the one a Persian writer needs every line.
  phIdle: "پیام خود را بنویسید — نیم‌فاصله: Shift+Space",
  phBusy: "در حال کار — پیام بعدی در صف می‌ماند · Esc برای توقف",
  // The pane header and its menu (§D5).
  paneMenu: "کارهای این قاب",
  paneZoom: "تمام‌صفحه",
  paneUnzoom: "خروج از تمام‌صفحه",
  paneClose: "برداشتن از صفحه — گفتگو باز می‌ماند",
  paneModel: "مدل: {name}",
  paneEffort: "میزان تفکر…",
  paneStyle: "لحن پاسخ…",
  panePosture: "سطح اجازه…",
  paneCost: "هزینهٔ این گفتگو: {cost}",
  paneBranch: "شاخهٔ تازه از این گفتگو",
  paneCloseChat: "بستن گفتگو",
  // Empty states (§D5): a pane with nothing in it, and a window with nothing open.
  paneEmpty: "این قاب خالی است.",
  paneEmptyBtn: "باز کردن گفتگو اینجا",
  homeLine: "یک گفتگو را از فهرست کنار باز کنید، یا گفتگویی تازه بسازید.",
  homeBtn: "گفتگوی تازه",
  sideQuota: "سهمیهٔ ۵ ساعته",

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
  /* The empty state is the TUI's welcome box now (V2-PLAN §2): the greeting,
     its four action cards and their strings are gone. What the terminal
     prints is its own name, its version, the folder, and the three hints it
     keeps under an empty prompt (wiki/tui-strings.md §5). */
  welcomeTitle: "خوش آمدید به کلاد فارسی — ترمینال",
  welcomeCwd: "پوشه:",
  welcomeNoProject: "هنوز پروژه‌ای باز نیست",
  welTipCommands: "برای فرمان‌ها",
  welTipMention: "برای اشاره به یک فایل",
  welTipKeys: "برای دیدن کلیدها",

  previewEmpty: "متنی برای پیش‌نمایش نیست",

  permTitle: "درخواست اجازه",
  permBody: "کلاد می‌خواهد این ابزار را اجرا کند:",
  permAllow: "اجازه بده",
  permDeny: "رد کن",
  permRemember: "تا پایان این نشست برای این ابزار دوباره نپرس",
  permAllowed: "اجازه داده شد",
  permDenied: "رد شد",

  /* v2.4: the three numbered options, translated from the TUI's own labels
     (wiki/tui-strings.md §2). NONE of them carries its number — the digit is
     drawn by js/choice.js, because in RTL a digit glued to the front of a
     Persian run is reordered by the bidi algorithm, and because «۲» only
     exists when a remember scope applies (V2-PLAN §8.2). The `(esc)` on the
     third one is drawn the same way, for the same reason.

     «{tool}» and no directory: the remember scope here is THIS PROJECT, THIS
     SESSION, and naming a path would describe a scope the window does not
     implement (§8.1). */
  permProceed: "اجازه می‌دهید ادامه دهد؟",
  permYes: "بله",
  permYesRemember: "بله، و دیگر برای {tool} نپرس",
  permNoFeedback: "نه، و بگو طور دیگری انجام دهد",
  /* Option 4, the window's own (BRIDGEMIND-PORT.md §D10): refuse AND stop the
     turn, for when the answer is "not this, and not anything else either".
     The TUI has three options; wiki/tui-keys.md lists this as a deviation. */
  permNoStop: "نه، و کار را متوقف کن",
  /* The eyebrow over the permission card: what kind of action is asking,
     before the English tool name (js/perm.js permKind). */
  permKind: {
    edit: "تغییر فایل",
    shell: "اجرای فرمان",
    outside: "دسترسی بیرونی",
    read: "خواندن",
    plan: "طرح",
    tool: "ابزار",
  },
  permFeedbackPlaceholder: "بنویسید به‌جای این چه کند…",
  permHint: "۱ تا ۳ یا ↑↓ و Enter · Tab برای نوشتن توضیح · shift+tab: تأیید همراه با همین توضیح",
  /* shift+tab approved the tool; the note had nowhere to ride along on that
     reply, so it is waiting in the message box. Said out loud, because text
     that moves without a word is text the person thinks they lost. */
  permFeedbackMoved: "توضیح شما در جعبهٔ پیام گذاشته شد؛ با Enter بفرستید",

  /* Plan approval. Same pipe, same numbered options, different act: what is on
     screen is a plan to read, not a tool call to allow. */
  planTitle: "طرح کار",
  planBody: "کلاد این طرح را نوشته است:",
  /* What the tool card says once the plan is accepted. «اجازه داده شد» is the
     answer to a request to run something; a plan that was accepted is not run,
     it is kept — which is why the TUI writes «Plan saved!» here and not its
     own approval word (wiki/tui-strings.md §2). */
  planSaved: "طرح ذخیره شد",

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
  askHint: "با شماره یا ↑↓ انتخاب کنید · Space برای چندگزینه · Enter برای فرستادن",

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
  /* The TUI prints this under the prompt when the five-hour window is nearly
     spent, and it is the one status number the person cannot do anything about
     — so it says what happens next instead of asking for an action. The
     threshold is the binary's own default (0.95); gated in test_tui_vocab.py
     so a change upstream shows up as a failure rather than as a window that
     warns at the wrong moment. */
  slQuotaWarn: "نزدیک سقف ۵‌ساعته — کلاد کار را جمع می‌کند",
  slEffort: "تفکر",
  slStyle: "لحن",

  /* The `⏵⏵` posture row (V2-PLAN §3.4), which replaces the pill the composer
     row used to carry. These are the TUI's OWN status-line sentences
     (wiki/tui-strings.md §4 `posture.*`), not the picker's short titles: the
     picker names a choice you are making, this line reports a mode you are
     already in. «محتاط» has no TUI counterpart — the terminal prints nothing
     at all in its default mode — so its sentence is written to the same shape
     as the four that were lifted. */
  slPostureAsk: "حالت محتاط روشن",
  slPosturePlan: "حالت طرح روشن",
  slPostureAcceptEdits: "پذیرش خودکار ویرایش‌ها روشن",
  slPostureAuto: "حالت خودکار روشن",
  slPostureBypass: "دور زدن اجازه‌ها",
  slPostureHint: "shift+tab برای تغییر",

  /* The turn ended while the window was not being looked at. The body is the
     folder, so a person with several conversations open knows which one
     finished before they switch to it. */
  notifyDone: "پاسخ آماده است",

  /* The window-local commands of V2-PLAN §3.5 (js/commands.js). Each one
     answers in the column as a `meta` row: what happened, in one line. None of
     them reached the model, so none of them may look like an answer. */
  cmdCopied: "آخرین پاسخ کپی شد",
  cmdCopyEmpty: "هنوز پاسخی برای کپی نیست",
  cmdCopyFailed: "کپی کردن ممکن نشد",
  // The two speakers, in the exported text file. Not in the window: this is
  // the only place the conversation is read without its own layout.
  exportYou: "شما:",
  exportClaude: "کلاد:",
  cmdExported: "گفتگو در این فایل ذخیره شد:",
  cmdExportEmpty: "هنوز گفتگویی برای ذخیره نیست",
  cmdExportFailed: "ذخیرهٔ گفتگو ممکن نشد",
  statusTitle: "وضعیت این گفتگو",
  statusVersion: "نسخه",
  cmdResumeHint: "با ↑↓ نشست را انتخاب کنید · Enter برای باز کردن · Esc برای بازگشت",
  cmdBranchDone: "شاخه‌ای تازه از این گفتگو باز شد؛ گفتگوی اصلی سر جای خودش است",
  cmdBranchFailed: "شاخه‌زدن از این گفتگو ممکن نشد",
  /* `/btw` is a real request to the model (measured — V2-PLAN §5.4), so the
     window says so before it sends. A side answer that looked free would be
     the one place this window lied about what costs money. */
  cmdBtwCost: "پرسش جانبی مانند یک نوبت معمولی هزینه دارد",
  cmdBtwFailed: "پاسخ به پرسش جانبی گرفته نشد",
  cmdOpened: "این فایل باز شد:",
  cmdOpenFailed: "باز کردن فایل ممکن نشد",
  memoryTitle: "کدام حافظه؟",
  memoryUser: "حافظهٔ شخصی",
  memoryUserNote: "برای همهٔ پروژه‌ها",
  memoryProject: "حافظهٔ این پروژه",
  memoryProjectNote: "فقط برای پوشهٔ همین گفتگو",
  cmdTasksEmpty: "کار پس‌زمینه‌ای در جریان نیست",

  /* `/split` (MA3): how many conversations are on screen at once. The numbers
     are the whole vocabulary — «۱ / ۲ / ۴» — so the refusal names them rather
     than describing them. Each column carries the same digit in its topbar, and
     the badge's tooltip is what says what that digit is for. */
  /* ...and the sidebar's three-segment control, which is the way in for a
     reader who will never type `/split` (TERMINAL-REDESIGN.md §3). Same two
     strings as the web edition's window bar, deliberately: it is the same
     control saying the same thing about the same window. */
  // The grid that fits N (BRIDGEMIND-PORT.md §D6).
  dividerLabel: "جداکنندهٔ قاب‌ها — بکشید، یا با پیکان جابه‌جا کنید؛ دوبار کلیک: هم‌اندازه",
  paneEqualize: "هم‌اندازه کردن قاب‌ها",
  openInNewPane: "باز کردن در قاب تازه",
  noRoomForPane: "جا برای قاب دیگری نیست؛ گفتگو در همین قاب باز شد و قبلی در فهرست کنار است.",

  /* The new-session page (BRIDGEMIND-PORT.md §D8). One action for "N at once":
     which folder, how many, shared or a worktree each, an optional task.
     «جفت» is a builder and a reviewer in the same folder; the reviewer is put
     in plan posture, so the CLI itself refuses its edits, and its task opens
     with `presetReviewerBrief`. */
  nsTitle: "گفتگوی تازه",
  nsPreset: "پیش‌تنظیم",
  nsPresetSolo: "تنها",
  nsPresetPair: "جفت",
  nsPresetGroup: "گروه",
  nsPresetCustom: "دلخواه",
  nsFolder: "پوشه",
  nsPickOther: "انتخاب پوشهٔ دیگر…",
  nsCount: "چند گفتگو",
  nsIsolation: "جداسازی",
  nsIsoShared: "همه در یک پوشه",
  nsIsoWorktree: "هر کدام در شاخهٔ جدای خودش",
  nsNotGit: "این پوشه مخزن گیت نیست، پس شاخهٔ جدا ندارد",
  nsPairShared: "در «جفت» بازبین باید فایل‌های سازنده را ببیند، پس هر دو در یک پوشه‌اند",
  nsTask: "کار مشترک (اختیاری)",
  nsTaskPlaceholder: "اگر بنویسید، برای همهٔ گفتگوها فرستاده می‌شود",
  nsPreviewTitle: "راه‌اندازی می‌شود",
  nsSlotWorktree: "شاخهٔ خودکار",
  nsSlotShared: "همان پوشه",
  nsRoleBuilder: "سازنده",
  nsRoleReviewer: "بازبین (فقط می‌خواند)",
  nsSlotTask: "و کار مشترک برای هر کدام فرستاده می‌شود",
  nsCancel: "انصراف (Esc)",
  nsLaunch: "شروع (Ctrl+Enter)",
  nsLaunching: "در حال راه‌اندازی…",
  nsTooMany: "با گفتگوهای باز فعلی، از شش گفتگو بیشتر می‌شود",
  nsNoRoom: "این پنجره برای این تعداد قاب جا ندارد",
  nsFailed: "راه‌اندازی نشد؛ هیچ گفتگویی باز نماند",
  nsStepFailed: "گفتگو باز شد، ولی کار مشترک یا سطح اجازه‌اش فرستاده نشد",
  presetReviewerBrief: "تو بازبین هستی: هیچ فایلی را تغییر نده. کار گفتگوی دیگر را در همین پوشه بخوان و گزارش بده.",

  /* The notification centre (BRIDGEMIND-PORT.md §D9): what happened in a
     conversation you were not looking at. */
  bellTitle: "اعلان‌ها",
  bellUnread: "اعلان‌ها — {n} خوانده‌نشده",
  noticesAllRead: "همه خوانده شد",
  noticesEmpty: "اعلانی نیست",
  noticeKind: {
    done: "پاسخ داد",
    needs: "منتظر شماست",
    failed: "خطا داد",
  },
  noticeClosed: "این گفتگو بسته شده است",
  /* The rail (TERMINAL-REDESIGN.md §1). One button, two words, and which one it
     says is the ACTION it will take — not the state it is in: a control named
     after its own state is read as a label and pressed by accident. It follows
     the split on its own, so most readers never press it. */
  sidebarCollapse: "جمع کردن نوار کناری",
  sidebarExpand: "باز کردن نوار کناری",
  cmdSplitUsage: "این دستور عددی از ۱ تا ۶ می‌پذیرد",
  cmdSplitDone: "چیدمان به {n} قاب تغییر کرد",
  /* ۴ is NOT four columns — it is a 2×2 grid, and the notice used to say
     «۴ ستون» over a layout with two of them (MA3-T4 defect 4). */
  cellBadgeTitle: "ستون {n} — با Alt+{n} به اینجا بیایید",

  /* `/help` (V2-PLAN §3.3 «the TUI's help text, translated», §8.11A). The
     terminal's own help screen is a page ABOUT a terminal program — how to
     start it, which flags it takes, where its docs live — and none of that is
     true of a window that is already open. What translates is its job: what
     can I ask this window to do, and with which key.

     So the list is generated from the command table in js/commands.js rather
     than written out here, and `cmdHelp` holds one line per verb. A verb with
     no line is a gate failure, and a line with no verb behind it is the same
     failure from the other side (test_strings.py) — the same binary → wiki →
     page discipline the key sheet already lives by. */
  helpTitle: "دستورهای این پنجره",
  cmdHelp: {
    help: "همین فهرست",
    resume: "رفتن به فهرست گفتگوهای این پوشه",
    status: "مدل، پوشه، نشست و سطح اجازهٔ همین گفتگو",
    copy: "کپی آخرین پاسخ",
    export: "ذخیرهٔ متن این گفتگو در یک فایل",
    cd: "باز کردن پوشه‌ای دیگر",
    "add-dir": "همان دستور بالا — هر گفتگو یک پوشه دارد و بس",
    branch: "باز کردن شاخه‌ای تازه از همین گفتگو، بدون دست زدن به اصلش",
    btw: "پرسش کوتاه بیرون از رشتهٔ گفتگو — به اندازهٔ یک نوبت هزینه دارد",
    config: "باز کردن فایل تنظیم‌ها",
    hooks: "همان فایل تنظیم‌ها؛ قلاب‌ها آنجا نوشته می‌شوند",
    keybindings: "باز کردن فایل کلیدها",
    memory: "باز کردن فایل حافظه — شخصی یا این پروژه",
    tasks: "نشان دادن کارهای پس‌زمینه",
    split: "چند گفتگو کنار هم: ۱ یا ۲ یا ۴ ستون",
    bash: "اجرای یک دستور در پوشهٔ پروژه؛ با «!» هم می‌شود",
    model: "انتخاب مدل",
    effort: "میزان تفکر",
    "output-style": "لحن پاسخ",
    permissions: "سطح اجازه",
    clear: "شروع یک گفتگوی تازه",
  },
  /* Three rows that are not commands: the two keys that open the other two
     lists, and the guide written for someone who has never used this window. */
  helpSlash: "فهرست دستورهای خود کلاد روی این کامپیوتر",
  helpKeys: "برگهٔ همهٔ کلیدها",
  helpGuide: "راهنمای کامل",
  helpGuideNote: "در یک برگهٔ تازه باز می‌شود",

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
  /* One line under every picker, because a list nobody told you how to answer
     is a list you answer with the mouse. */
  pickerHint: "با شماره یا ↑↓ و Enter انتخاب کنید · Esc برای بستن",
  postureFailed: "تغییر سطح اجازه ممکن نشد",
  autoActions: "اقدام خودکار",
  autoActionsTitle: "کارهایی که بدون پرسش انجام شدند",
  autoActionsEmpty: "هنوز چیزی بدون پرسش انجام نشده",
  autoWhyRemembered: "چون گفتید دوباره نپرس",
  autoWhyPosture: "سطح اجازه: خودکار",
};

window.STRINGS = window.FA;
