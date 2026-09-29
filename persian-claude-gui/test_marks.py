r"""Message marks gate (pcg-8ip), BOTH editions.

The user's request, 2026-09-29, after claude.ai/code: under each message on
hover, copy / pin / when it was said; a rail of the pinned messages at the top
of the transcript that jumps to them; and at the end of a turn one card for the
files it edited. What can go wrong is quiet, so each check follows a click to
what it changes:

  - js/marks.js is byte-identical in both editions;
  - a message carries its own uuid and says «۹ دقیقهٔ پیش» from its OWN
    timestamp — and none of that chrome is in its textContent (/export, the
    loop fold and the spec cases read it);
  - the conversation's pins load from /api/pins and mark their messages; the
    rail lists «شروع گفتگو» and each pin; a pin click posts that message and
    the rail follows the server's answer; a rail click jumps and flashes;
  - a settled turn ends in one card, «N فایل ویرایش شد», summed per file from
    the tool calls, whose row opens that file's edit; a replay-shaped user turn
    is marked by ITS uuid;
  - copy writes the message's source text.

Free: no CLI, no login. Every route is stubbed inside the page.

    python persian-claude-gui\test_marks.py            both editions
"""

from __future__ import annotations

import os
import sys
import threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from test_layout import boot_server, find_edge, hold_sse, measure  # noqa: E402

from server import EDITIONS  # noqa: E402

PROBE_NAME = "_marks_probe.html"

PROBE_JS = r"""
<pre id="probe-out" hidden></pre>
<script type="module">
import { routeEvent, applyTabs } from "/static/js/app.js";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FA = window.STRINGS;
const calls = [];
let pins = [{ uuid: "u-a1", label: "جوابِ سنجاق‌شده" }];
let copied = null;
Object.defineProperty(navigator, "clipboard", { configurable: true,
  value: { writeText: async (t) => { copied = t; } } });
const json = (o, status = 200) => new Response(JSON.stringify(o), { status,
  headers: { "Content-Type": "application/json" } });
window.fetch = async (url, init) => {
  const u = String(url);
  const body = init?.body ? JSON.parse(init.body) : null;
  calls.push({ url: u.split("?")[0], body, query: u.split("?")[1] ?? "" });
  if (u.startsWith("/api/tabs")) return json({ tabs: [{ tab: "t1", cwd: "C:/kar" }], active: "t1" });
  if (u.startsWith("/api/projects")) return json({ projects: [] });
  if (u.startsWith("/api/agents")) return json({ agents: [] });
  if (u.startsWith("/api/session")) return json({ events: [] });
  if (u.startsWith("/api/pins")) {
    if (body) {
      pins = pins.filter((p) => p.uuid !== body.uuid);
      if (body.pinned) pins.push({ uuid: body.uuid, label: body.label });
    }
    return json({ pins });
  }
  return json({ ok: true });
};
const log = () => document.querySelector("#grid .cell .log, .cell .log");
const byUuid = (u) => log()?.querySelector(`[data-uuid="${u}"]`);
const ev = (e) => routeEvent({ tab: "t1", ...e });
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();

(async () => {
 const out = {};
 try {
  await sleep(200);
  applyTabs({ tabs: [{ tab: "t1", cwd: "C:/kar" }], active: "t1" });
  await sleep(60);
  ev({ type: "wrapper", subtype: "user_echo", uuid: "u-user1", timestamp: iso(NOW - 9 * 60e3),
       text: "این دو فایل را درست کن" });
  ev({ type: "system", subtype: "init", model: "claude-opus-5-5", cwd: "C:/kar",
       permissionMode: "default", session_id: "sess-marks-1" });
  ev({ type: "assistant", uuid: "u-a1", timestamp: iso(NOW - 8 * 60e3),
       message: { content: [{ type: "text", text: "باشه، **درست** می‌کنم." }] } });
  ev({ type: "assistant", uuid: "u-a2", timestamp: iso(NOW - 8 * 60e3), message: { content: [
    { type: "tool_use", id: "e1", name: "Edit", input: { file_path: "C:/kar/a.js",
      old_string: "x\ny", new_string: "x\ny\nz\nw" } },
    { type: "tool_use", id: "e2", name: "Write", input: { file_path: "C:/kar/b.md",
      content: "1\n2\n3" } },
    { type: "tool_use", id: "e3", name: "Edit", input: { file_path: "C:/kar/a.js",
      old_string: "q", new_string: "r" } }] } });
  await sleep(120);

  // The message marks.
  const user = byUuid("u-user1");
  out.userWhen = user?.querySelector(".msg-when")?.dataset.text ?? "";
  out.wantWhen = FA.markMinutesAgo.replace("{n}", "۹");
  out.userTitle = !!user?.querySelector(".msg-when")?.title;
  out.cleanText = !!user && !/⧉|پیش/.test(user.textContent);
  // Pins loaded for this session mark their message and fill the rail.
  out.pinsAsked = calls.some((c) => c.url === "/api/pins" && c.query.includes("session=sess-marks-1"));
  out.a1Pinned = byUuid("u-a1")?.classList.contains("is-pinned");
  const items = () => [...(log()?.querySelectorAll(".pin-rail .pin-item") ?? [])].map((b) => b.dataset.label);
  out.rail1 = items().join("|");
  // Pin the user's message.
  let mark = calls.length;
  user?.querySelector(".msg-pin")?.click(); await sleep(80);
  const post = calls.slice(mark).find((c) => c.url === "/api/pins" && c.body);
  out.pinPost = post ? `${post.body.session}/${post.body.uuid}/${post.body.pinned}` : "none";
  out.userPinned = user?.classList.contains("is-pinned");
  out.rail2 = items().length;
  // Jump from the rail.
  [...(log()?.querySelectorAll(".pin-rail .pin-item") ?? [])].at(-1)?.click();
  await sleep(40);
  out.flashed = user?.classList.contains("is-flash");
  // Copy writes the SOURCE text.
  byUuid("u-a1")?.querySelector(".msg-copy")?.click(); await sleep(30);
  out.copied = copied;

  // The turn settles: one change card, summed per file.
  ev({ type: "result", subtype: "success", is_error: false, duration_ms: 1000 });
  ev({ type: "command_lifecycle", command_uuid: "u-user1", state: "completed" });
  await sleep(80);
  const cards = log()?.querySelectorAll(".change-card") ?? [];
  out.cards = cards.length;
  const card = cards[0];
  out.cardTitle = card?.querySelector(".change-title")?.textContent ?? "";
  out.wantTitle = FA.markEdited.replace("{n}", "۲");
  out.cardRows = [...(card?.querySelectorAll(".change-row") ?? [])]
    .map((r) => r.querySelector(".change-file")?.textContent + ":" + r.querySelector(".change-stat")?.textContent).join(",");
  // Measured, not read: a textContent check is blind to BiDi (rtl-rendering-
  // notes). Every stat must draw «+A» left of «−D», each sign left of its digits.
  const charX = (node, i) => { const r = document.createRange(); r.setStart(node, i);
    r.setEnd(node, i + 1); return r.getBoundingClientRect().left; };
  out.statLtr = [...(card?.querySelectorAll(".change-stat") ?? [])].every((st) => {
    const a = st.querySelector(".d-add"), d = st.querySelector(".d-del");
    return a.getBoundingClientRect().left < d.getBoundingClientRect().left
      && charX(a.firstChild, 0) < charX(a.firstChild, 1)
      && charX(d.firstChild, 0) < charX(d.firstChild, 1);
  }) && (card?.querySelectorAll(".change-stat").length ?? 0) === 3;
  const aCards = [...(log()?.querySelectorAll("details.card") ?? [])];
  aCards.forEach((d) => { d.open = false; });
  card?.querySelector(".change-row")?.click(); await sleep(30);
  out.openedEdit = aCards.filter((d) => d.open).length;

  // A replay-shaped user turn is marked by its own uuid, and starts a new turn.
  ev({ type: "user", uuid: "u-user2", timestamp: iso(NOW - 60e3),
       message: { content: [{ type: "text", text: "یک سؤال دیگر" }] } });
  await sleep(40);
  out.replayMarked = !!byUuid("u-user2")?.querySelector(".msg-acts");
  document.getElementById("probe-out").textContent = "PROBE" + JSON.stringify(out) + "ENDPROBE";
 } catch (err) {
  document.getElementById("probe-out").textContent =
    "PROBE" + JSON.stringify({ error: String(err && err.stack || err), partial: out }) + "ENDPROBE";
 }
})();
</script>
"""


def write_probe(static: Path) -> Path:
    """The probe page IS index.html — anything else would drift away from it."""
    page = (static / "index.html").read_text(encoding="utf-8").replace("{{VERSION}}", "9.9.9")
    marker = '<body class="app">'
    if marker not in page:
        sys.exit("index.html no longer opens with " + marker)
    page = page.replace(marker, '<body class="app" data-render-only>', 1)
    probe = static / PROBE_NAME
    probe.write_text(page.replace("</body>", PROBE_JS + "\n</body>", 1), encoding="utf-8")
    return probe


def checks(m: dict) -> list[tuple[str, bool, str]]:
    out: list[tuple[str, bool, str]] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        out.append((name, bool(ok), detail))

    check("a message says when it was said, from its own timestamp",
          m.get("userWhen") == m.get("wantWhen") and m.get("userTitle"),
          f"«{m.get('userWhen')}» vs «{m.get('wantWhen')}», exact title {m.get('userTitle')}")
    check("none of the marks' chrome is in the message's text", m.get("cleanText"))
    check("the conversation's pins are asked for by its session id", m.get("pinsAsked"))
    check("a loaded pin marks its message", m.get("a1Pinned"))
    check("the rail lists «شروع گفتگو» then each pin",
          m.get("rail1") == "شروع گفتگو|جوابِ سنجاق‌شده", str(m.get("rail1")))
    check("the pin button posts THIS message in THIS conversation",
          m.get("pinPost") == "sess-marks-1/u-user1/true", str(m.get("pinPost")))
    check("...and the message and the rail follow the server's answer",
          m.get("userPinned") and m.get("rail2") == 3, f"{m.get('userPinned')} / {m.get('rail2')}")
    check("a rail click jumps to the message and flashes it", m.get("flashed"))
    check("copy writes the message's source text",
          m.get("copied") == "باشه، **درست** می‌کنم.", repr(m.get("copied")))
    check("a settled turn ends in ONE change card",
          m.get("cards") == 1 and m.get("cardTitle") == m.get("wantTitle"),
          f"{m.get('cards')} / «{m.get('cardTitle')}»")
    check("summed per file from the tool calls (two edits of a.js, one write)",
          m.get("cardRows") == "a.js:+3−1,b.md:+3−0", str(m.get("cardRows")))
    check("every «+A −D» draws left to right, sign before digits", m.get("statLtr"))
    check("a row opens that file's edit", (m.get("openedEdit") or 0) >= 1, str(m.get("openedEdit")))
    check("a replay-shaped user turn is marked by its own uuid", m.get("replayMarked"))
    return out


def run(edition: str, edge: str) -> list[tuple[str, bool, str]]:
    static = HERE / EDITIONS[edition][0]
    probe = write_probe(static)
    proc, base, token = boot_server(edition=edition)
    try:
        stop = threading.Event()
        threading.Thread(target=hold_sse, args=(base, token, stop), daemon=True).start()
        report = measure(edge, f"{base}/static/{PROBE_NAME}?t={token}", 1280, 900)
    finally:
        proc.terminate()
        probe.unlink(missing_ok=True)
    if report.get("error"):
        return [("the probe ran", False, str(report["error"]) + " / " + str(report.get("partial")))]
    return checks(report)


def main() -> int:
    edge = find_edge()
    a = (HERE / "static" / "js" / "marks.js").read_bytes()
    b = (HERE / "static-terminal" / "js" / "marks.js").read_bytes()
    results = [("js/marks.js is the same file in both editions", a == b, "")]
    wanted = os.environ.get("PCG_UI")
    for edition in ([wanted] if wanted else ["terminal", "web"]):
        results += [(f"[{edition}] {n}", ok, d) for n, ok, d in run(edition, edge)]
    for name, ok, detail in results:
        print(f"  {'OK  ' if ok else 'FAIL'} {name}" + (f"  -- {detail}" if detail else ""))
    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print(f"{'PASS' if passed == total else 'FAIL'} \u2014 {passed}/{total}")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
