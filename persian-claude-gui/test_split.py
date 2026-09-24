"""Split gate (MA3-T2 / MA4-T2): does the window still work with 2 or 4 columns?

BOTH EDITIONS, one file. The grid, the focus rules, the parking and the routing
are the same design in each; what differs is the markup a picker is drawn with
and, in the web edition, that the layout is a control you can press rather than
a command you type. `PCG_UI` picks the edition exactly as test_layout.py does -
unset is the web edition, `PCG_UI=terminal` is the other one.

The shell used to be one cell wide, and every id in it was unique because there
was one of everything. `/split 4` stamps four copies of the same markup out of
index.html's <template id="cell-tpl"> — so the things that can break here are
things no other gate can see: a duplicate id (T0 turned every cell-local id into
a class; ONE that got missed is four elements answering to the same name), a
column that overflows its grid track (the `min-width/min-height: 0` family that
has now bitten this project four times), an event routed into the wrong column,
and a key that acts on a column the keyboard is not in.

Free: no CLI turn is spent. The probe page IS index.html with one measuring
script appended, and it is deleted again on the way out — the same construction
test_layout.py uses, whose measure()/hold_sse() this file imports rather than
copying.

    python persian-claude-gui\\test_split.py                      (web)
    set PCG_UI=terminal && python persian-claude-gui\\test_split.py    (terminal)

It also prints the stream measurement MA3's design asked for (known risk 2):
routing an event for a tab that is NOT the focused one goes through
withRenderTarget(), which copies the whole render scope in and out around every
event. 500 synthetic deltas, three ways - appends per frame, and scope fields
copied per event.
"""

from __future__ import annotations

import json
import os
import sys
import threading

from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from server import EDITIONS                        # noqa: E402
from test_layout import boot_server, find_edge, hold_sse, measure  # noqa: E402

# The edition decides which UI folder this gate reads. PCG_UI picks it; the
# table itself lives in server.py and is never duplicated.
EDITION = os.environ.get("PCG_UI", "web")
STATIC = HERE / EDITIONS[EDITION][0]
PROBE = STATIC / "_split_probe.html"

# Four shapes of window: one with room to spare, one at the sidebar's own
# breakpoint, one SHORT enough that a quarter of it is under the cell's own
# `@container` threshold (the size the user's 2026-09-07 pass reported cell ۱'s
# status rows painting over cell ۳'s topbar), and one where a quarter of the
# window is SHORTER than a column's irreducible chrome (topbar + prompt +
# status line). The flag marks that last one TIGHT: no CSS can fit that chrome
# in 194px, so what is asserted there is only that the column BOXES stay inside
# the window - which is exactly what `.cell { min-height: 0 }` buys and what its
# absence breaks (without it the columns grow to their own content and the
# bottom row leaves the window).
# 1052x711 is the window pcg-6nf.11 was measured in: a quarter of it is 382x337,
# which is where a RESUMED session's status line wrapped to eight rows and left
# the transcript 12%.
SIZES = ((1280, 800, False), (1000, 700, False), (1052, 711, False),
         (1242, 622, False), (760, 480, True))

# The two window sizes whose columns must still be mostly conversation. Not every
# size: a quarter of a 1242x622 window is 247px tall, and no CSS fits a topbar, a
# prompt and a status line into that with 40% left over - that column is the
# TIGHT case one step short of being marked tight.
LOG_SHARE_AT = ((1000, 700), (1052, 711))

# How tall the status STACK may be in a short column, and the rows that buys.
# pcg-6nf.11: a resumed session's fields wrap to six or eight lines in a ~370px
# column - 97px to 120px of a 291px column, measured 2026-09-08 - so the stack is
# clamped to two rows and scrolls. Two rows of its own .74em/1.6 font plus its own
# padding is 46px here; the bar has one row of slack in it so a font-size change
# is not a gate failure, and it is far below the six rows that raised the bead.
STATUS_CAP = 64

# How many synthetic deltas the stream measurement pushes. Large enough that the
# per-event scope copy is measurable at all, small enough to stay free.
DELTAS = 500

# How many lines the "a real conversation is in this column" state pushes into
# cell 1. Long enough that the transcript is scrolling, which is the state the
# chrome around it has to survive.
LONG = 60

# The transcript's share of its own column, in percent, below which the column
# is not showing a conversation any more - it is showing chrome with one or two
# clipped lines wedged between the pieces (defect 3).
# PER EDITION, and only since TERMINAL-REDESIGN.md §2.4/§8: Phase 2's one-row
# identity bar, the prompt's tighter padding in a short column and the re-led
# status stack measure 64% at 1000x700 and 65% at 1052x711 in the TERMINAL
# edition (from 58/59), so its bar goes 40 -> 60 - a bar with room in it rather
# than the measurement itself. Nothing was hidden to get there: the "holds more
# than it shows" assertion below is unchanged and still passes. The web edition
# is untouched by that pass (it measures 53/54%) and keeps the 40 it had.
LOG_SHARE = {"terminal": 60, "web": 40}[EDITION]

# The same measurement, two shells. The v2.4 terminal draws its pickers as
# numbered <dialog class="picker"> lists opened from the keyboard; the web
# edition draws them as a .menu-popup hanging off a composer chip. Only the
# selectors and the two verbs differ - every assertion below is shared.
SHELL = {
    "web": dict(
        parts=["log", "perm", "menu-popup", "composer", "statusline"],
        # Through the chip the user presses, not a back door: positionMenu()
        # measures against the CELL, and that is the code under test.
        open_menu=('const openMenu = (cell) => {'
                   '  cell.controls.setPostureState("ask", 0);'
                   '  cell.root.querySelector(".posture-chip").click();'
                   '};'
                   'const closeMenu = (cell) => cell.controls.closeMenu();'
                   'const menuOpen = (cell) => {'
                   '  const m = cell.root.querySelector(".menu-popup");'
                   '  return !!m && !m.hidden;'
                   '};'),
        menu_name="posture menu"),
    "terminal": dict(
        parts=["log", "perm", "picker", "composer", "statusline"],
        open_menu=('const openMenu = (cell) => cell.controls.openPosturePicker();'
                   'const closeMenu = (cell) => cell.controls.closePicker();'
                   'const menuOpen = (cell) =>'
                   '  !!cell.root.querySelector(".picker")?.open;'),
        menu_name="posture picker"),
}
SH = SHELL[EDITION]

# What check() asserts per window size. Named so the PASS line cannot drift from
# the acceptance bar the MA3 design set (>= 12). BOTH editions now have a visible
# split control (TERMINAL-REDESIGN.md §3), so the two checks it brings with it are
# no longer web-only.
CHECKS = 24

# MA5: what the two extra page loads at the foot of main() assert about the
# layout coming back after a reload. Their own loads, not the size loop's: a
# restore happens ONCE per page load, which is the whole point of the flag.
LAYOUT_CHECKS = 7

# ...and what it asserts only where four columns can hold their own chrome at
# all: every descendant inside its own column, in three states, plus the empty
# column's digit badge and the transcript's share of its column.
FIT_CHECKS = 10

PROBE_JS = """
<pre id="probe-out" hidden></pre>
<script type="module">
import * as APP from "/static/js/app.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* NEVER `new Promise(requestAnimationFrame)`: headless Edge under
   --virtual-time-budget has no compositor driving frames on its own, so an
   await on one never resolves and the probe hangs with an empty <pre> — which
   from out here is indistinguishable from a module that failed to load. A
   sleep advances virtual time, and rAF callbacks do run when it does. */
const frame = () => sleep(50);
const box = (el) => { const r = el.getBoundingClientRect();
  return {x: Math.round(r.left), y: Math.round(r.top),
          w: Math.round(r.width), h: Math.round(r.height)}; };

/* Every route this page would call is stubbed and RECORDED: the assertions
   about the two keys (shift+Tab, Alt+N) are about which conversation the
   request carries, and that only exists on the wire. */
const posts = [];
window.fetch = async (url, opts) => {
  const path = String(url).split("?")[0];
  if (opts && opts.body) posts.push({path, body: JSON.parse(opts.body)});
  return {ok: true, status: 200, json: async () => (
    {ok: true, projects: [], agents: [], recents: [], tabs: [], active: ""})};
};

const CELLS = () => [...document.querySelectorAll("#grid > .cell")];
const PARTS = %PARTS%;
%OPENMENU%
const TABS = ["t1", "t2", "t3", "t4"].map((tab, i) => ({
  tab, title: "\\u06af\\u0641\\u062a\\u06af\\u0648\\u06cc " + (i + 1),
  cwd: "D:\\\\projects\\\\p" + (i + 1), session_id: "sess-" + (i + 1), busy: false}));

function key(target, init) {
  target.dispatchEvent(new KeyboardEvent("keydown",
    {bubbles: true, cancelable: true, ...init}));
}

/* --- is every column drawing INSIDE itself? (MA3-T4) -------------------------
   The boxes measured elsewhere in this file are the CELLS against the WINDOW.
   That check is structurally blind to the thing the user reported: a status
   line or a picker that leaves the bottom of its own column is still inside
   the window - it is drawn on top of the column below it. So this walks every
   descendant and measures it against ITS OWN cell.

   A box clipped by something between it and the cell is skipped: a transcript
   row scrolled out of `.log` has a rect way outside the column and is painted
   nowhere at all. The scroller itself is still measured, which is the point -
   the question is whether the SCROLLER fits, not what is inside it. */
function name(el) {
  return el.tagName.toLowerCase()
       + (el.getAttribute("class") ? "." + el.getAttribute("class").split(/\\s+/)[0] : "");
}
function clippedBy(el, root) {
  for (let p = el.parentElement; p && p !== root; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (cs.overflowY !== "visible" || cs.overflowX !== "visible") return true;
  }
  return false;
}
function fitOne(root) {
  const c = root.getBoundingClientRect();
  let n = 0;
  let worst = {sel: "", out: 0, side: ""};
  for (const el of root.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 && r.height < 1) continue;      // display:none, empty spans
    if (clippedBy(el, root)) continue;
    const sides = [["top", c.top - r.top], ["bottom", r.bottom - c.bottom],
                   ["start", c.left - r.left], ["end", r.right - c.right]];
    const [side, px] = sides.reduce((a, b) => (b[1] > a[1] ? b : a));
    if (px > 1) {
      n += 1;
      if (px > worst.out) worst = {sel: name(el), out: Math.round(px), side};
    }
  }
  return {n, worst};
}
const fitAll = () => CELLS().map(fitOne);

/* MA3 known risk 2 is a COST: routing an event for a tab that is not the
   focused one goes through withRenderTarget(), which copies the whole render
   scope in and out around every event. Counting the fields it copies is the
   measurement; a stopwatch is not available here, because --virtual-time-budget
   (which is what stops --dump-dom hanging on the load event) freezes
   performance.now() at a flat 0 for any burst. */
const realAssign = Object.assign;
let fields = 0;
Object.assign = function (target, ...sources) {
  for (const one of sources) if (one) fields += Object.keys(one).length;
  return realAssign(target, ...sources);
};

function place4() {
  APP.setSplit(4);
  APP.applyTabs({tabs: TABS, active: "t1"});       // t1 lands in the focused cell
  for (let i = 1; i < 4; i++) { APP.focusCell(i); APP.applySwitch("t" + (i + 1)); }
  APP.focusCell(0);
}

/* `n` stream deltas dispatched synchronously, the way an SSE backlog arrives,
   then flushed. `paints` counts MutationObserver callbacks on the node the
   bubble lives in — one per coalesced frame (render.js queueStreamText), so
   `n / paints` is appends per frame. `fields` is the scope-copy cost above. */
async function stream(tab, n) {
  APP.routeEvent({type: "wrapper", subtype: "user_echo", tab, text: "\\u0633\\u0644\\u0627\\u0645"});
  await frame();
  const cell = APP.cellOf(tab);
  const node = cell ? cell.log : APP.tabs.get(tab).node;
  let paints = 0;
  const obs = new MutationObserver(() => { paints += 1; });
  obs.observe(node, {subtree: true, childList: true, characterData: true});
  const before = fields;
  for (let i = 0; i < n; i++) {
    APP.routeEvent({type: "stream_event", tab, event: {type: "content_block_delta",
      delta: {type: "text_delta", text: "\\u0648\\u0627\\u0698\\u0647 " + i + " "}}});
  }
  const copied = fields - before;
  await frame(); await frame();
  obs.disconnect();
  return {paints, copied};
}

/* --- MA5: the layout across a reload -----------------------------------------
   sessionStorage is per page load out here (measure() gives every load a fresh
   browser profile), so each case IS a page load: `restore` is a window coming
   back to a saved 4-way split, `fresh` is one with nothing saved - and then, on
   that same load, the reconnect that must not put a layout back a second
   time. */
const CASE = new URLSearchParams(location.search).get("case") || "";

function shot() {
  return {split: document.getElementById("grid").dataset.split,
          cells: APP.cells.map((c) => c.tab),
          blank: APP.cells.map((c) => !!c.root.querySelector("textarea.input")?.disabled),
          seg: [...(document.getElementById("split-seg")?.children ?? [])]
                 .filter((b) => b.getAttribute("aria-pressed") === "true")
                 .map((b) => b.dataset.split)};
}

async function layoutCase(which) {
  if (which === "restore") {
    // Four columns, three conversations in them, one of which the server does
    // not list any more - and none of them in the column today's auto-pick
    // would have used.
    sessionStorage.setItem("pcg.layout", JSON.stringify(
      {split: 4, cells: ["t2", "t-gone", "t4", "t1"]}));
    APP.applyTabs({tabs: TABS, active: "t1"});
    await sleep(300);
    return {restored: shot()};
  }
  sessionStorage.removeItem("pcg.layout");
  APP.applyTabs({tabs: TABS, active: "t1"});
  await sleep(300);
  const fresh = shot();
  // A reconnect, after the user has closed every conversation, with a layout
  // saved in between: restoring here would resurrect what they just closed.
  for (let i = 0; i < 8 && APP.cells.some((c) => c.tab); i++) {
    for (const c of APP.cells) if (c.tab) await APP.closeTab(c.tab);
    await sleep(80);
  }
  const emptied = APP.cells.map((c) => c.tab);
  sessionStorage.setItem("pcg.layout", JSON.stringify(
    {split: 4, cells: ["t1", "t2", "t3", "t4"]}));
  APP.applyTabs({tabs: TABS, active: "t1"});
  await sleep(300);
  return {fresh, emptied, again: shot()};
}

(async () => {
 const out = {};
 try {
  if (CASE) {
    out.layout = await layoutCase(CASE);
    document.getElementById("probe-out").textContent =
      "PROBE" + JSON.stringify(out) + "ENDPROBE";
    return;
  }
  /* --- four EMPTY columns --------------------------------------------------
     Measured before anything is placed, because the welcome box is content a
     column cannot scroll away: `.log` is a scroller and contributes nothing to
     its cell's minimum, so an empty column is the arrangement that finds out
     whether the home state can shrink to its track at all. It could not — see
     `.cell.home`'s first row in style.css. */
  APP.setSplit(4);
  await sleep(250);
  const grid0 = document.getElementById("grid");
  // Per state: a scrollbar that appears in one of them changes the layout
  // viewport, and comparing one state's boxes against the other's window is how
  // a gate invents an off-screen column that is not there.
  const view = () => [document.documentElement.clientWidth,
                      document.documentElement.clientHeight];
  out.homeView = view();
  out.homeGrid = {...box(grid0), over: grid0.scrollHeight - grid0.clientHeight};
  out.homeBoxes = CELLS().map((r) => ({...box(r),
    overW: r.scrollWidth - r.clientWidth,
    home: r.classList.contains("home")}));
  // The digit badge is the cell's, not its conversation's: with nothing open
  // it is the ONLY thing saying which Alt+N reaches this blank column.
  // The digit shows while Alt is held (BRIDGEMIND-PORT.md §D5), so that is
  // the state it is measured in.
  document.body.classList.add("alt-held");
  out.homeBadges = CELLS().map((r) => box(r.querySelector(".cell-badge")));
  document.body.classList.remove("alt-held");

  /* --- four columns, one conversation each -------------------------------- */
  place4();
  await sleep(200);

  out.cells = CELLS().length;
  out.parts = CELLS().map((root) =>
    PARTS.map((cls) => root.querySelectorAll("." + cls).length));
  out.placed = APP.cells.map((c) => c.tab);

  // Four copies of the same markup: an id that survived T0 is now four
  // elements answering to one name. querySelectorAll does not descend into
  // <template>, so a stray id in there is only visible via its clones - which
  // is exactly what this counts.
  const seen = new Map();
  for (const el of document.querySelectorAll("[id]"))
    seen.set(el.id, (seen.get(el.id) ?? 0) + 1);
  out.dupIds = [...seen].filter(([, n]) => n > 1).map(([id, n]) => id + " x" + n);

  /* --- routing: a tagged event paints in ITS column and nowhere else ------- */
  const before = CELLS().map((r) => r.querySelector(".log").childElementCount);
  APP.routeEvent({type: "wrapper", subtype: "user_echo", tab: "t2",
                  text: "\\u067e\\u06cc\\u0627\\u0645 \\u062f\\u0648\\u0645"});
  await sleep(120);
  out.echoDelta = CELLS().map((r, i) =>
    r.querySelector(".log").childElementCount - before[i]);

  /* --- geometry: the grid holds its columns -------------------------------- */
  // Fill every column so a cell that gave up its own min-size overflows the
  // track instead of quietly fitting.
  for (const t of ["t1", "t2", "t3", "t4"]) {
    for (let i = 0; i < 12; i++) {
      APP.routeEvent({type: "wrapper", subtype: "user_echo", tab: t,
        text: "\\u06cc\\u06a9 \\u062e\\u0637 \\u0641\\u0627\\u0631\\u0633\\u06cc "
              + "C:\\\\Users\\\\Lion\\\\Desktop\\\\note-" + i + ".md"});
    }
  }
  await sleep(250);
  const grid = document.getElementById("grid");
  out.view = view();
  out.body = box(document.body);
  out.stage = box(document.getElementById("stage"));
  out.grid = {...box(grid), over: grid.scrollHeight - grid.clientHeight};
  out.boxes = CELLS().map((r) => ({...box(r),
    overW: r.scrollWidth - r.clientWidth,
    home: r.classList.contains("home")}));

  /* --- and every column draws inside itself, in three states --------------- */
  out.fits = {closed: fitAll()};

  // (b) a picker open in cell 1. The widest one, opened the way the window
  //     opens it (`/permissions`, Shift+Tab's own list) rather than by hand.
  openMenu(APP.cells[0]);
  await sleep(250);
  out.pickerOpen = menuOpen(APP.cells[0]);
  out.fits.picker = fitAll();
  closeMenu(APP.cells[0]);
  await sleep(120);

  // (d) a transcript long enough to be scrolling.
  for (let i = 0; i < %LONG%; i++) {
    APP.routeEvent({type: "wrapper", subtype: "user_echo", tab: "t1",
      text: "\\u062e\\u0637 " + i + " \\u0627\\u0632 \\u06cc\\u06a9 "
            + "\\u06af\\u0641\\u062a\\u06af\\u0648\\u06cc \\u0628\\u0644\\u0646\\u062f"});
  }
  await sleep(300);
  out.fits.long = fitAll();
  // What is left for the conversation once the chrome has taken its share.
  out.logShare = CELLS().map((r) => {
    const cell = box(r);
    const log = box(r.querySelector(".log"));
    return cell.h ? Math.round((100 * log.h) / cell.h) : 0;
  });

  /* --- (e) the chrome a RESUMED session carries (pcg-6nf.11) ----------------
     Every state above has an EMPTY status line, which is why the 53% at 366x286
     the density fix was signed off on was never the number the user saw. A
     resumed session names all of it at once - model, folder, mode, context,
     quota, cost, session id AND the machine's own statusLine passthrough - and
     in a ~370px column that one wrapping row was six to eight lines, 97px to
     120px of a 291px column (measured 2026-09-08, before the clamp).

     Its own state, after the share above, because the two are different
     questions: that one is the same empty-status measurement every earlier pass
     was signed off on, this one is the window the user actually reported.
     Terminal edition: the same events also carry its posture row, its effort and
     its output style - the rows the four chips used to be. */
  for (const t of ["t1", "t2", "t3", "t4"]) {
    APP.routeEvent({type: "system", subtype: "init", tab: t,
      model: "claude-opus-4-5-20260101", cwd: "D:\\\\projects\\\\Claude",
      permissionMode: "acceptEdits", output_style: "Explanatory",
      session_id: "0f9c2a71-4b3d-4e51-9a77-2c1e5d80ab3f",
      slash_commands: ["init", "clear", "compact", "resume", "model", "effort",
                       "output-style", "permissions", "status", "memory",
                       "hooks", "help", "cost", "doctor"]});
    APP.routeEvent({type: "wrapper", subtype: "posture", tab: t,
                    posture: "acceptEdits", auto_count: 3});
    APP.routeEvent({type: "wrapper", subtype: "effort", tab: t, effort: "high"});
    APP.routeEvent({type: "wrapper", subtype: "usage", tab: t,
                    context: 42, cost: 1.2345, quota: 61});
    APP.routeEvent({type: "wrapper", subtype: "statusline", tab: t, segments: [
      {text: "PONYTAIL full \u00b7 main \u00b7 D:\\\\projects\\\\Claude \u00b7 opus 42%"}]});
  }
  await sleep(250);
  /* The stack's box AND what it holds: `scroll > h` is the proof that the two
     rows on screen are a window onto every field rather than the only fields
     left. `rows` is that height in lines of its own font, which is the unit the
     bead was reported in. */
  out.slBox = CELLS().map((r) => {
    const sl = r.querySelector(".statusline");
    return {...box(sl), scroll: sl.scrollHeight,
            rows: Math.round(sl.scrollHeight / (parseFloat(getComputedStyle(sl).lineHeight) || 1))};
  });

  out.fits.full = fitAll();
  out.logShareFull = CELLS().map((r) => {
    const cell = box(r);
    const log = box(r.querySelector(".log"));
    return cell.h ? Math.round((100 * log.h) / cell.h) : 0;
  });


  /* --- (f) the slash popup in a SHORT column (pcg-6nf.10) -------------------
     The picker menu was fixed by sliding its anchor down (controls.js
     positionMenu); this list is anchored by composer.js and had only the 140px
     floor under its cap, which in a quarter of a ~1050x710 window asks for more
     room than there is above the prompt. Opened the way the user opens it - «/»
     typed into the real box - in the BOTTOM-LEFT column, which is the one with
     a whole column above it to draw over. */
  const popAt = CELLS().length - 1;
  const popCell = APP.cells[popAt];
  const popInput = popCell.root.querySelector("textarea.input");
  popInput.value = "/";
  popInput.setSelectionRange(1, 1);
  popInput.dispatchEvent(new Event("input", {bubbles: true}));
  await sleep(200);
  const popList = popCell.root.querySelector(".slash-popup");
  out.slash = {at: popAt, open: !!popList && !popList.hidden,
               cell: box(popCell.root), pop: popList ? box(popList) : null,
               // The cap composer.js writes from the column's own rect. Read as
               // an INLINE style on purpose: `[hidden]` is `display: none`, so
               // the cap used to be computed off an element with no
               // offsetParent, the `if (box)` guard swallowed it, and the only
               // cap this list ever had was the 40cqh in style.css. An empty
               // string here is that bug.
               cap: popList ? popList.style.maxHeight : "",
               spill: fitOne(popCell.root)};
  popInput.value = "";
  popInput.dispatchEvent(new Event("input", {bubbles: true}));
  await sleep(120);

  /* --- a permission for a conversation no column is showing ---------------- */
  APP.routeEvent({type: "wrapper", subtype: "permission_request", tab: "t9",
    request_id: "r1", tool_name: "Write",
    tool_input: {file_path: "D:\\\\projects\\\\p9\\\\a.md", content: "x"}});
  await sleep(150);
  out.permOpen = CELLS().map((r) => !!r.querySelector(".perm")?.open);
  const src = CELLS()[0].querySelector(".perm-source");
  out.permSource = {shown: !!src && !src.hidden, text: (src?.textContent ?? "").trim()};
  APP.cells[0].perm.dismiss("r1");
  await sleep(80);

  /* --- Alt+3 moves the keyboard, and the next key follows it --------------- */
  key(document.body, {key: "3", code: "Digit3", altKey: true});
  await sleep(120);
  out.altFocused = CELLS().findIndex((r) => r.classList.contains("focused"));
  out.altActive = CELLS().findIndex((r) => r.contains(document.activeElement));

  APP.cells[2].controls.setPostureState("default", 0);
  await sleep(60);
  posts.length = 0;
  key(document.activeElement ?? document.body, {key: "Tab", shiftKey: true});
  await sleep(150);
  out.posture = posts.filter((p) => p.path === "/api/posture");

  /* --- the idle hint asks ONE column, and honours the agents flag ----------
     `body.agents-running` (agents.js) describes the FOCUSED conversation and
     nothing else, so the window's minute tick may only ask the focused column;
     a background column asked about somebody else's agents is the notice that
     gets read as an error. window.checkIdle IS that tick — same function, with
     the hour fast-forwarded. */
  APP.focusCell(0);
  for (const t of ["t1", "t3"]) {                  // both had a turn end just now
    APP.routeEvent({type: "wrapper", subtype: "user_echo", tab: t, text: "\\u0647\\u0627"});
    APP.routeEvent({type: "result", tab: t, subtype: "success", is_error: false});
  }
  await sleep(150);
  const notices = () => CELLS().map((r) => {
    const n = r.querySelector(".context-notice");
    return !!n && !n.hidden;
  });
  const later = Date.now() + 61 * 60 * 1000;
  document.body.classList.add("agents-running");
  window.checkIdle(later);
  await sleep(80);
  out.idleWithAgents = notices();
  document.body.classList.remove("agents-running");
  window.checkIdle(later);
  await sleep(80);
  out.idleNoAgents = notices();

  /* --- pcg-0o7: a dialog that pulls the keyboard in MID-RENDER --------------
     The permission for column 2's conversation is rendered through
     withRenderTarget, and showPermission() focuses the dialog it opens —
     synchronously, so the focusin listener ran focusCell() while `state` was
     still pointed at column 2's scope. The column being left was stashed with
     the OTHER conversation's ledger, and the render's own restore then put
     the old conversation back into `state` and `log` under the new focus: a
     running turn read idle, and the next line for the focused conversation
     was written into the column the keyboard had just left. */
  APP.focusCell(0);
  const runTab = APP.cells[0].tab, askTab = APP.cells[1].tab;
  APP.routeEvent({type: "wrapper", subtype: "user_echo", tab: runTab,
                  text: "\\u06a9\\u0627\\u0631", uuid: "u-0o7"});
  await sleep(60);
  APP.routeEvent({type: "wrapper", subtype: "permission_request", tab: askTab,
    request_id: "r0o7", tool_name: "Bash", tool_input: {command: "dir"}});
  await sleep(150);
  const rowOf = (t) => document.querySelector(`#open-tabs .tab-row[data-tab="${t}"]`);
  const marker = "pcg-0o7-marker";
  APP.routeEvent({type: "wrapper", subtype: "stderr", tab: askTab, line: marker});
  await sleep(60);
  out.midRender = {
    focused: CELLS().findIndex((r) => r.classList.contains("focused")),
    runStatus: rowOf(runTab)?.dataset.status ?? "",
    markerIn: CELLS().map((r) => r.querySelector(".log")?.textContent.includes(marker)),
  };
  APP.cells[1].perm.dismiss("r0o7");
  APP.routeEvent({type: "result", tab: runTab, subtype: "success", is_error: false});
  APP.routeEvent({type: "command_lifecycle", tab: runTab, command_uuid: "u-0o7",
                  state: "completed"});
  APP.focusCell(0);
  await sleep(80);

  /* --- shrinking parks, it never closes ------------------------------------ */
  APP.routeEvent({type: "wrapper", subtype: "permission_request", tab: "t4",
    request_id: "r2", tool_name: "Bash", tool_input: {command: "dir"}});
  await sleep(120);
  APP.setSplit(1);
  await sleep(220);
  out.afterSplit1 = {
    cells: CELLS().length,
    split: grid.dataset.split,
    sidebar: [...document.querySelectorAll("#open-tabs .tab-row")].map((r) => r.dataset.tab),
    known: APP.tabs.size,
    // The dialog the removed column was asking through is gone; the request it
    // was holding must not have gone with it.
    permOpen: !!CELLS()[0].querySelector(".perm")?.open,
    permTool: (CELLS()[0].querySelector(".perm-tool")?.textContent ?? "").trim(),
  };
  APP.cells[0].perm.dismiss("r2");
  await sleep(80);

  /* --- known risk 2: is the per-frame paint still coalesced with 4 columns? -
     The DOM write for a streaming bubble is rAF-coalesced (render.js
     queueStreamText, 2026-08-18), and `withRenderTarget` swapping `log` around
     it is exactly the kind of change that turns one write per frame back into
     one per token. Same burst, three ways; the cost in ms is the separate
     ?stream=1 load above. */
  out.paints = {one: await stream("t1", %N%)};
  place4();
  await sleep(200);
  out.paints.four = await stream("t1", %N%);       // focused column: renders direct
  out.paints.other = await stream("t3", %N%);      // another column: withRenderTarget
%WEBONLY%
  document.getElementById("probe-out").textContent =
    "PROBE" + JSON.stringify(out) + "ENDPROBE";
 } catch (err) {
  document.getElementById("probe-out").textContent =
    "PROBE" + JSON.stringify({error: String((err && err.stack) || err)}) + "ENDPROBE";
 }
})();
</script>
"""


WEB_ONLY_JS = """
  /* --- the LEFT-most column's picker (web edition) --------------------------
     positionMenu() writes a PHYSICAL `right` on a shrink-to-fit popup, and the
     offset that lines it up with its chip is also what subtracts from its
     width - the 2026-08-23 defect. dir=rtl puts cell «۱» top-RIGHT, so the
     left-most column is the one with the least room on that side, and the
     bottom-left one also opens its menu upward over the column above it.
     Every box of it has to be inside its own cell. */
  const rowCells = CELLS();
  const xs = rowCells.map((r) => Math.round(r.getBoundingClientRect().left));
  const leftAt = xs.lastIndexOf(Math.min(...xs));
  openMenu(APP.cells[leftAt]);
  await sleep(250);
  const leftMenu = rowCells[leftAt].querySelector(".menu-popup");
  out.leftMenu = {at: leftAt, open: menuOpen(APP.cells[leftAt]),
                  cell: box(rowCells[leftAt]),
                  menu: leftMenu ? box(leftMenu) : null,
                  spill: fitOne(rowCells[leftAt])};
  closeMenu(APP.cells[leftAt]);
  await sleep(120);

"""


SEG_JS = """
  /* --- the sidebar's segmented control (both editions) ---------------------
     How many conversations are on screen is a fact about this WINDOW. The
     server has no concept of the grid, so pressing a segment may only move
     `data-split` and the cells - the one request it is still allowed to make
     is the /api/tab/activate that follows the keyboard, exactly as a click
     inside a column does. */
  posts.length = 0;
  const seg = document.getElementById("split-seg");
  const segBtns = [...(seg ? seg.children : [])];
  out.seg = {labels: segBtns.map((b) => b.textContent.trim())};
  seg.querySelector('[data-split="2"]').click();
  await sleep(250);
  out.seg.two = {split: document.getElementById("grid").dataset.split,
                 cells: CELLS().length,
                 pressed: segBtns.map((b) => b.getAttribute("aria-pressed")),
                 sidebar: [...document.querySelectorAll("#open-tabs .tab-row")]
                            .map((r) => r.dataset.tab)};
  seg.querySelector('[data-split="4"]').click();
  await sleep(300);
  out.seg.four = {split: document.getElementById("grid").dataset.split,
                  cells: CELLS().length,
                  pressed: segBtns.map((b) => b.getAttribute("aria-pressed"))};
  out.seg.posts = posts.map((one) => ({path: one.path,
                                       keys: Object.keys(one.body || {})}));
"""


def write_probe() -> None:
    """The probe page IS index.html - anything else would drift away from it."""
    page = (STATIC / "index.html").read_text(encoding="utf-8")
    page = page.replace("{{VERSION}}", "0.0.0").replace("{{TITLE}}", "probe")
    marker = '<body class="app">'
    if marker not in page:
        sys.exit("index.html no longer opens with " + marker)
    page = page.replace(marker, '<body class="app" data-render-only>', 1)
    script = (PROBE_JS.replace("%N%", str(DELTAS)).replace("%LONG%", str(LONG))
              .replace("%PARTS%", json.dumps(SH["parts"]))
              .replace("%OPENMENU%", SH["open_menu"])
              .replace("%WEBONLY%",
                       (WEB_ONLY_JS if EDITION == "web" else "") + SEG_JS))
    PROBE.write_text(page.replace("</body>", script + "\n</body>", 1), encoding="utf-8")


def check(m: dict, where: str, bad: list[str], tight: bool = False,
          size: tuple[int, int] = (0, 0)) -> None:
    """Every assertion the MA3 design lists for the grid, at one window size."""
    say = lambda msg: bad.append(f"{where}: {msg}")   # noqa: E731

    # 1. four columns
    if m["cells"] != 4:
        say(f"/split 4 drew {m['cells']} cells")
    # 2. each one is a whole window
    for at, counts in enumerate(m["parts"], 1):
        if counts != [1, 1, 1, 1, 1]:
            say(f"cell {at} has {'/'.join(SH['parts'])} = {counts}, not one each")
    if m["placed"] != ["t1", "t2", "t3", "t4"]:
        say(f"the four tabs did not land one per column: {m['placed']}")
    # 3. one name, one element
    if m["dupIds"]:
        say(f"duplicate ids across the columns: {m['dupIds'][:6]}")
    # 4. an event goes to its own column and nowhere else. The count is not
    #    asserted (one send draws a bubble AND arms the pulse); which column
    #    grew is the whole question.
    grew = [n > 0 for n in m["echoDelta"]]
    if grew != [False, True, False, False]:
        say(f"a message tagged t2 painted into {m['echoDelta']} (want cell 2 only)")
    # 5. the columns fit their tracks - empty, and then full
    if not all(b["home"] for b in m["homeBoxes"]):
        say(f"/split 4 on an empty window did not draw four welcome columns: "
            f"{[b['home'] for b in m['homeBoxes']]}")
    for state, view, grid, boxes in (("empty", m["homeView"], m["homeGrid"], m["homeBoxes"]),
                                     ("full", m["view"], m["grid"], m["boxes"])):
        view_w, view_h = view
        if grid["over"] > 1 and not tight:
            say(f"#grid ({state}) overflows its own box by {grid['over']}px - "
                "a column is bigger than its track (the min-height: 0 family)")
        for at, b in enumerate(boxes, 1):
            if b["x"] < -1 or b["x"] + b["w"] > view_w + 1:
                say(f"cell {at} ({state}) is off the window "
                    f"(x={b['x']} w={b['w']} of {view_w})")
            if b["y"] < -1 or b["y"] + b["h"] > view_h + 1:
                say(f"cell {at} ({state}) is off the window vertically "
                    f"(y={b['y']} h={b['h']} of {view_h})")
            if b["overW"] > 1:
                say(f"cell {at} ({state}) is wider than its box (+{b['overW']}px) - "
                    "the min-width: 0 family")
    # 5b. MA3-T4: the window-level check above cannot see a column drawing over
    #     its NEIGHBOUR - both are inside the window. Three states, because the
    #     three the user reported were different: nothing open, a picker open,
    #     and a transcript long enough to scroll.
    if not tight:
        for state, label in (("closed", "with nothing open"),
                             ("picker", "with the posture picker open in cell 1"),
                             ("long", f"with a {LONG}-line transcript in cell 1")):
            spill = [(at, f["n"], f["worst"]) for at, f in enumerate(m["fits"][state], 1)
                     if f["n"]]
            if spill:
                at, n, w = spill[0]
                say(f"{label}: {sum(s[1] for s in spill)} boxes are drawn outside "
                    f"their own column (cell {at}: {n}, worst {w['sel']} "
                    f"{w['out']}px past the {w['side']}) - a cell that overflows "
                    "paints over the one beside it")
        if not m["pickerOpen"]:
            say("the posture picker did not open in cell 1")
        # The badge is the only label a blank column carries; `.cell.home` used
        # to hide the whole topbar, so its box was 0x0 and Alt+3 named nothing.
        blank = [at for at, b in enumerate(m["homeBadges"], 1)
                 if b["w"] < 1 or b["h"] < 1]
        if blank:
            say(f"the digit badge of empty cell(s) {blank} has no box - "
                "nothing says which Alt+N reaches a blank column")
        # And the conversation is still the biggest thing in its own column.
        if size in LOG_SHARE_AT:
            thin = [(at, pct) for at, pct in enumerate(m["logShare"], 1)
                    if pct < LOG_SHARE]
            if thin:
                say(f"the transcript is only {thin[0][1]}% of cell {thin[0][0]} "
                    f"(want >= {LOG_SHARE}%) - the column is chrome with a "
                    "sliver of conversation wedged into it")

        # 5b-ii. pcg-6nf.11: the same column with a RESUMED session's status
        #        line in it - every field at once, which is the state the user
        #        reported and the one no gate had ever drawn. The status stack is
        #        clamped and scrolls: it may not be taller than STATUS_CAP, it
        #        must still HOLD more than it shows (nothing is hidden to fit),
        #        and no piece of chrome may leave the column - before the clamp
        #        the status line hung 26px to 42px past the bottom of its own
        #        cell, over the column below it.
        spill = [(at, f["n"], f["worst"]) for at, f in enumerate(m["fits"]["full"], 1)
                 if f["n"]]
        if spill:
            at, n, w = spill[0]
            say(f"with a resumed session's full status line: "
                f"{sum(s[1] for s in spill)} boxes are drawn outside their own "
                f"column (cell {at}: {n}, worst {w['sel']} {w['out']}px past the "
                f"{w['side']})")
        for at, sl in enumerate(m["slBox"], 1):
            if sl["h"] > STATUS_CAP:
                say(f"the status stack of cell {at} is {sl['h']}px tall "
                    f"({sl['rows']} rows, cap {STATUS_CAP}) - a resumed session's "
                    "fields wrap and the transcript pays for every row")
            # BRIDGEMIND-PORT.md §D5 reversed the 2026-09-08 "nothing hidden,
            # the stack scrolls" rule on purpose: the status line is now the
            # machine's own line plus ONE state line, and every fact that left
            # it has a home in /status (asserted in test_shell.py). What stays
            # a defect is that line wrapping - the column would pay for it.
            elif sl["rows"] > 2:
                say(f"the status line of cell {at} runs to {sl['rows']} rows - "
                    "the state line wrapped instead of giving up characters")

        # 5b-iii. pcg-6nf.10: the slash popup is anchored by composer.js, not by
        #        positionMenu, and its 140px floor is more room than a short
        #        column has above its prompt.
        sl = m["slash"]
        if not sl["open"] or not sl["pop"]:
            say(f"typing «/» in cell {sl['at'] + 1} opened no command list "
                f"({sl['open']})")
        else:
            cell, pop = sl["cell"], sl["pop"]
            if (pop["y"] < cell["y"] - 1
                    or pop["y"] + pop["h"] > cell["y"] + cell["h"] + 1
                    or pop["x"] < cell["x"] - 1
                    or pop["x"] + pop["w"] > cell["x"] + cell["w"] + 1):
                say(f"the command list opened in cell {sl['at'] + 1} is outside "
                    f"it ({pop} vs {cell}) - it is drawn over the column above")
            if sl["spill"]["n"]:
                say(f"with the command list open {sl['spill']['n']} boxes are "
                    f"drawn outside cell {sl['at'] + 1} (worst "
                    f"{sl['spill']['worst']['sel']} {sl['spill']['worst']['out']}px "
                    f"past the {sl['spill']['worst']['side']})")
            if not sl["cap"].endswith("px"):
                say(f"the command list in cell {sl['at'] + 1} carries no height "
                    f"cap of its own ({sl['cap']!r}) - composer.js measures one "
                    "off a popup that is still display:none, so the write never "
                    "happens and the CSS cap is the only one there is")

    # 5c. MA4-T2, web only: the picker opened in the LEFT-most column, which is
    #     the one positionMenu() has the least slack in - and the whole of the
    #     2026-08-23 report was a menu that squeezed itself into a column.
    if EDITION == "web" and not tight:
        left = m["leftMenu"]
        if not left["open"] or not left["menu"]:
            say(f"the {SH['menu_name']} did not open in the left-most column "
                f"(cell index {left['at']})")
        else:
            cell, menu = left["cell"], left["menu"]
            if (menu["x"] < cell["x"] - 1
                    or menu["x"] + menu["w"] > cell["x"] + cell["w"] + 1
                    or menu["y"] < cell["y"] - 1
                    or menu["y"] + menu["h"] > cell["y"] + cell["h"] + 1):
                say(f"the {SH['menu_name']} opened in the left-most column is "
                    f"outside it ({menu} vs {cell})")
            if left["spill"]["n"]:
                say(f"with that menu open {left['spill']['n']} boxes are drawn "
                    f"outside the left-most column (worst "
                    f"{left['spill']['worst']['sel']} {left['spill']['worst']['out']}px "
                    f"past the {left['spill']['worst']['side']})")
    # 5d. THE SPLIT CONTROL, both editions. The web edition draws it in the
    #     window bar and the terminal edition in the sidebar (§3), but it is
    #     one control saying one thing: it moves the grid and tells the server
    #     nothing about it. The terminal edition reached the grid through
    #     `/split` alone until 2026-09-10, which is a layout a reader who never
    #     types a command could not find.
    if not tight:
        seg = m["seg"]
        if seg["labels"] != ["\u06f1", "\u06f2", "\u06f4"]:
            say(f"the split control reads {seg['labels']}, not the three "
                "Persian digits")
        for want, got in ((2, seg["two"]), (4, seg["four"])):
            if got["split"] != str(want) or got["cells"] != want:
                say(f"pressing «{want}» left data-split={got['split']!r} with "
                    f"{got['cells']} cells")
            pressed = [b == "true" for b in got["pressed"]]
            if pressed != [want == 1, want == 2, want == 4]:
                say(f"pressing «{want}» marked {got['pressed']} pressed")
        if sorted(seg["two"]["sidebar"]) != ["t1", "t2", "t3", "t4"]:
            say("pressing «2» dropped a conversation from the sidebar: "
                f"{seg['two']['sidebar']}")
        stray = [one for one in seg["posts"]
                 if one["path"] != "/api/tab/activate"
                 or "split" in one["keys"] or "layout" in one["keys"]]
        if stray:
            say(f"the split control sent the server {stray[:3]} - the grid is "
                "this window's business and the server has no concept of it")

    # 6. a request for a conversation nobody is watching
    if m["permOpen"] != [True, False, False, False]:
        say(f"the unplaced tab's permission opened in {m['permOpen']} (want the focused cell)")
    if not m["permSource"]["shown"] or not m["permSource"]["text"]:
        say(f"the «from another session» line did not show: {m['permSource']}")
    # 6b. pcg-0o7: the dialog pulled the keyboard in mid-render; nothing else moves
    mid = m["midRender"]
    if mid["focused"] != 1:
        say(f"the asking column's dialog left cell index {mid['focused']} focused, not 1")
    if mid["runStatus"] != "running":
        say(f"a running turn read {mid['runStatus']!r} once a dialog pulled focus "
            "into another column (pcg-0o7)")
    if mid["markerIn"] != [False, True, False, False]:
        say(f"the focused conversation's next line landed in columns {mid['markerIn']}"
            " - `log` was restored to the column the keyboard had left (pcg-0o7)")
    # 7. Alt+N
    if m["altFocused"] != 2:
        say(f"Alt+3 marked cell index {m['altFocused']} focused, not 2")
    if m["altActive"] != 2:
        say(f"Alt+3 left the keyboard in cell index {m['altActive']}, not 2")
    # 8. and the next key acts on THAT column
    if len(m["posture"]) != 1:
        say(f"shift+Tab sent {len(m['posture'])} posture requests, not 1")
    elif m["posture"][0]["body"].get("tab") != "t3":
        say(f"shift+Tab posted for tab {m['posture'][0]['body'].get('tab')!r}, not 't3'")
    # 9. shrinking parks; it never closes
    after = m["afterSplit1"]
    if after["cells"] != 1 or after["split"] != "1":
        say(f"/split 1 left {after['cells']} cells at data-split={after['split']!r}")
    if sorted(after["sidebar"]) != ["t1", "t2", "t3", "t4"]:
        say(f"the parked conversations left the sidebar: {after['sidebar']}")
    if after["known"] < 4:
        say(f"only {after['known']} tabs survived /split 1")
    if not after["permOpen"] or "Bash" not in after["permTool"]:
        say("the removed column's pending permission was lost "
            f"(open={after['permOpen']} tool={after['permTool']!r})")
    # 10. the idle hint: gated on the agents flag, and only in the focused column
    if any(m["idleWithAgents"]):
        say(f"the idle notice fired over running agents in {m['idleWithAgents']}")
    if m["idleNoAgents"] != [True, False, False, False]:
        say(f"the idle tick painted {m['idleNoAgents']} - only the focused column "
            "may be asked (its agents flag is the only one this window has)")
    # 11. known risk 2: the streaming paint is still one DOM write per frame in
    #     every column, not one per token.
    for name, v in m["paints"].items():
        if v["paints"] < 1:
            say(f"the {name}-column stream never painted at all")
        elif v["paints"] > DELTAS / 20:
            say(f"the {name}-column stream painted {v['paints']} times for {DELTAS} "
                "deltas - the per-frame coalescing is gone")


def check_layout(restore: dict, fresh: dict, bad: list[str]) -> None:
    """MA5: the grid a window had before a reload, and the two ways it must NOT
    come back - nothing saved, and a reconnect on a load that already restored.
    """
    say = lambda msg: bad.append("layout: " + msg)   # noqa: E731

    got = restore["restored"]
    if got["split"] != "4" or len(got["cells"]) != 4:
        say(f"a saved 4-way split came back as data-split={got['split']!r} with "
            f"{len(got['cells'])} cells")
    # Positional, and the tab the server no longer lists is dropped in place -
    # today's auto-pick would have put t1 in cell 1 and nothing anywhere else.
    if got["cells"] != ["t2", "", "t4", "t1"]:
        say(f"the restored columns hold {got['cells']}, not "
            "['t2', '', 't4', 't1'] - the map is positional and a dead tab "
            "leaves its own column blank")
    if got["blank"] != [False, True, False, False]:
        say(f"the message box of each restored column is disabled={got['blank']} "
            "- the column left blank by a dead tab has nothing to send to")
    if got["seg"] != ["4"]:
        say(f"the split control reads {got['seg']} after a restore, not «4» - "
            "paintSplitControl runs inside setSplit and should need no line")

    if fresh["fresh"]["split"] != "1" or fresh["fresh"]["cells"] != ["t1"]:
        say(f"with nothing saved the window booted to split "
            f"{fresh['fresh']['split']!r} with {fresh['fresh']['cells']} - it "
            "must be byte-identical to the behaviour before this bead")
    if any(fresh["emptied"]):
        say(f"the conversations did not all close: {fresh['emptied']}")
    if fresh["again"]["split"] != "1" or fresh["again"]["cells"] != ["t1"]:
        say(f"a second applyTabs on the same page load restored split "
            f"{fresh['again']['split']!r} with {fresh['again']['cells']} - a "
            "reconnect after the user closed everything must not resurrect a "
            "stale layout")


def main() -> int:
    edge = find_edge()
    write_probe()
    bad: list[str] = []
    checks = 0
    # ONE server for the whole run - seven headless pages against it. This used
    # to be a server per window size, because the fourth page against one
    # server always wedged (pcg-4hg, 2026-09-07). The cause was the harness,
    # not the browser: nobody drained the server's stdout, so its own [http]
    # request log filled the pipe buffer and the server blocked inside write().
    # boot_server() drains it - see its docstring for the measurement.
    try:
        proc, base, token = boot_server()
    except Exception as err:                          # noqa: BLE001
        print(f"FAIL - {err}")
        PROBE.unlink(missing_ok=True)
        return 1
    stop = threading.Event()
    threading.Thread(target=hold_sse, args=(base, token, stop), daemon=True).start()
    try:
        for width, height, tight in SIZES:
            where = f"{width}x{height}"
            try:
                m = measure(edge, f"{base}/static/{PROBE.name}?t={token}", width, height)
            except Exception as err:                  # noqa: BLE001 - reported, not raised
                bad.append(f"{where}: {err}")
                continue
            check(m, where, bad, tight, (width, height))
            checks += CHECKS + (0 if tight else FIT_CHECKS)
            p = m["paints"]
            print(f"  {where}: stage {m['stage']['w']}x{m['stage']['h']}, "
                  f"4 cells at {m['boxes'][0]['w']}x{m['boxes'][0]['h']}, "
                  f"{len(m['dupIds'])} duplicate ids"
                  + ("" if tight else
                     f", status {m['slBox'][0]['h']}px of "
                     f"{m['slBox'][0]['scroll']}px, log {m['logShare'][0]}% of "
                     f"its column ({m['logShareFull'][0]}% with a resumed "
                     f"session's status line), "
                     + ", ".join(f"{k} {sum(f['n'] for f in v)} outside"
                                 for k, v in m["fits"].items())))
            print(f"    {DELTAS} deltas -> "
                  + ", ".join(f"{name} {DELTAS // max(v['paints'], 1)} appends/frame, "
                              f"{v['copied'] / DELTAS:.0f} scope fields/event"
                              for name, v in (("1 cell:", p["one"]),
                                              ("4 cells, focused:", p["four"]),
                                              ("4 cells, other:", p["other"]))))
        # MA5: the layout across a reload. Two more page loads - each case
        # needs a page that has NOT restored yet, and the flag that guarantees
        # that is per page load. Same probe file, driven by ?case=.
        try:
            pages = {}
            for case in ("restore", "fresh"):
                m = measure(edge, f"{base}/static/{PROBE.name}?t={token}"
                                  f"&case={case}", 1280, 800)
                pages[case] = m["layout"]
            check_layout(pages["restore"], pages["fresh"], bad)
            checks += LAYOUT_CHECKS
            print("  layout: restored "
                  f"{pages['restore']['restored']['cells']} at split "
                  f"{pages['restore']['restored']['split']}, a fresh window "
                  f"{pages['fresh']['fresh']['cells']}, a reconnect "
                  f"{pages['fresh']['again']['cells']}")
        except Exception as err:                      # noqa: BLE001
            bad.append(f"layout: {err}")
    finally:
        stop.set()
        proc.terminate()
        PROBE.unlink(missing_ok=True)

    if bad:
        print(f"FAIL - {len(bad)} problems")
        for item in bad:
            print("  x " + item)
        return 1
    print(f"PASS - {checks}/{checks} ({len(SIZES)} window sizes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
