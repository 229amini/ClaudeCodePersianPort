"""The Windows measurements the BridgeMind port waits on (BRIDGEMIND-PORT.md §D13).

    python persian-claude-gui\\probe_edge.py            random port, like the app
    python persian-claude-gui\\probe_edge.py --port 8765 a fixed port (M2's control)
    python persian-claude-gui\\probe_edge.py --font "C:\\...\\Vazirmatn[wght].woff2"

Opens a probe page in Edge app-mode exactly the way server.py's launch_window()
does (`msedge --app=URL`, the user's default profile), from a tiny stdlib HTTP
server on 127.0.0.1 - so the origin has the same shape as the real window's.
Free: no claude process, no login. Nothing here is part of the app.

Every key the page sees is POSTed back and printed HERE, before the page calls
preventDefault(), so a chord that closes or navigates the window still leaves
a line in this terminal. Close the window (or Ctrl+C) to stop; the last lines
are a summary to paste back.

M1  chords: press each one listed on the page; its row says whether the page
    saw it and whether preventDefault() held (the page is still here).
M2  per-origin state: the page shows a launch counter kept in localStorage,
    Notification.permission and the current zoom (devicePixelRatio). Run it
    twice on a random port (zoom with Ctrl+= and allow notifications on the
    first run), then twice with --port 8765, and compare.
M3  the font: the three vendored static weights, and - with --font - a
    variable build at 400/450/500/550/650/700, side by side at 13 and 15 px.
M4  root CSS zoom: a button sets `:root { zoom: 1.25 }` and opens a hand-
    positioned menu under its anchor, the way kebabMenu() does; the page prints
    the anchor's and the menu's rects.
M6  Alt alone: press and release Alt; the page reports where focus went.
"""

from __future__ import annotations

import argparse
import json
import secrets
import socket
import subprocess
import sys
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
FONTS = HERE / "static-terminal" / "fonts"
EDGE_CANDIDATES = (
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
)

# The chords the design's PANE_KEYS table and the zoom fallback might use, plus
# the ones known to be browser-owned, so the table is complete either way.
CHORDS = [
    "ctrl+w", "ctrl+t", "ctrl+n", "ctrl+d", "ctrl+tab", "ctrl+shift+tab",
    "ctrl+pageup", "ctrl+pagedown", "alt+arrowleft", "alt+arrowright",
    "alt+arrowup", "alt+arrowdown", "ctrl+alt+arrowleft", "ctrl+alt+arrowright",
    "alt+enter", "ctrl+shift+enter", "alt+n", "ctrl+alt+n", "alt+b", "alt+=",
    "alt+[", "alt+]", "alt+1", "alt+5", "alt+6", "ctrl+=", "ctrl+-", "ctrl+0", "f11",
]

PAGE = """<!doctype html>
<html dir="rtl" lang="fa"><head><meta charset="utf-8"><title>probe_edge</title>
<style>
@font-face { font-family: V; src: url(/font/Vazirmatn-Regular.woff2); font-weight: 400; }
@font-face { font-family: V; src: url(/font/Vazirmatn-Medium.woff2); font-weight: 500; }
@font-face { font-family: V; src: url(/font/Vazirmatn-Bold.woff2); font-weight: 700; }
@font-face { font-family: VV; src: url(/font/variable.woff2); font-weight: 100 900; }
body { font-family: V, sans-serif; background: #0e0e0e; color: #ededed; margin: 16px; }
table { border-collapse: collapse; font: 13px/1.5 Consolas, monospace; direction: ltr; }
td, th { border: 1px solid #333; padding: 2px 8px; }
.seen { color: #6fbf8a; } .gone { color: #e5695a; }
section { margin-block: 18px; } h2 { font-size: 15px; font-weight: 500; }
.menu { position: fixed; background: #1a1a1a; border: 1px solid #444; padding: 6px; }
</style></head><body>
<h2>M1 — press each chord (focus stays on this page)</h2>
<table id="keys"><tr><th>chord</th><th>seen by page</th></tr></table>
<section><h2>M2 — per-origin state</h2><pre id="m2" dir="ltr"></pre>
<button id="notif">request notification permission</button></section>
<section><h2>M3 — font</h2><div id="m3"></div></section>
<section><h2>M4 — root CSS zoom + a hand-positioned menu</h2>
<button id="z">zoom 125% and open the menu</button><pre id="m4" dir="ltr"></pre></section>
<section><h2>M6 — press and release Alt alone</h2><pre id="m6" dir="ltr"></pre></section>
<script>
const CHORDS = %CHORDS%;
const log = (kind, data) => fetch("/log", {method: "POST", keepalive: true,
  body: JSON.stringify({kind, data})}).catch(() => {});
const chordOf = (e) => [e.ctrlKey && "ctrl", e.altKey && "alt", e.shiftKey && "shift",
  e.key === "Tab" ? "tab" : e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase()]
  .filter(Boolean).join("+");
const table = document.getElementById("keys");
const rows = {};
for (const c of CHORDS) {
  const tr = table.insertRow(); tr.insertCell().textContent = c;
  rows[c] = tr.insertCell(); rows[c].textContent = "-";
}
addEventListener("keydown", (e) => {
  if (["Control", "Alt", "Shift"].includes(e.key)) return;
  const c = chordOf(e);
  log("key", {chord: c, code: e.code});
  e.preventDefault();
  if (rows[c]) { rows[c].textContent = "seen, page still here"; rows[c].className = "seen"; }
}, true);
addEventListener("pagehide", () => navigator.sendBeacon("/log",
  JSON.stringify({kind: "pagehide", data: {}})));

/* M2 */
let count = 0;
try { count = Number(localStorage.getItem("probe.count") || 0) + 1;
      localStorage.setItem("probe.count", String(count)); } catch (e) { count = -1; }
const m2 = () => {
  const state = {origin: location.origin, launchesSeenByLocalStorage: count,
    notification: window.Notification ? Notification.permission : "none",
    devicePixelRatio: devicePixelRatio,
    zoomEstimate: Math.round(100 * outerWidth / innerWidth) + "%"};
  document.getElementById("m2").textContent = JSON.stringify(state, null, 2);
  return state;
};
log("m2", m2());
addEventListener("resize", () => log("m2-resize", m2()));
document.getElementById("notif").onclick = async () => {
  log("m2-notification", {answer: await Notification.requestPermission()}); m2(); };

/* M3 */
const SAMPLE = "این یک متن آزمایشی است؛ نیم‌فاصله و «گیومه» — Claude Code 2.1.281";
const m3 = document.getElementById("m3");
for (const size of [13, 15]) for (const [fam, weights] of [["V", [400, 500, 700]],
                                                         ["VV", %VARWEIGHTS%]]) {
  for (const w of weights) {
    const p = document.createElement("p");
    p.style.cssText = `font-family:${fam};font-weight:${w};font-size:${size}px;margin:2px 0`;
    p.textContent = `${fam === "V" ? "static" : "variable"} ${w} @${size}px — ${SAMPLE}`;
    m3.append(p);
  }
}

/* M4 */
document.getElementById("z").onclick = (e) => {
  document.documentElement.style.zoom = "1.25";
  const btn = e.currentTarget, menu = document.createElement("div");
  menu.className = "menu"; menu.textContent = "menu under its anchor?";
  document.body.append(menu);
  const r = btn.getBoundingClientRect();
  menu.style.top = r.bottom + 4 + "px"; menu.style.left = r.left + "px";
  const m = menu.getBoundingClientRect();
  const out = {anchor: [r.left, r.bottom].map(Math.round), menu: [m.left, m.top].map(Math.round),
               innerWidth};
  document.getElementById("m4").textContent = JSON.stringify(out);
  log("m4", out);
};

/* M6 */
addEventListener("keyup", (e) => {
  if (e.key !== "Alt") return;
  setTimeout(() => {
    const out = {hasFocus: document.hasFocus(),
                 active: document.activeElement?.tagName || null};
    document.getElementById("m6").textContent = JSON.stringify(out);
    log("m6", out);
  }, 200);
});
</script></body></html>
"""


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--port", type=int, default=0, help="fixed port (M2 control)")
    ap.add_argument("--font", default="", help="a variable Vazirmatn .woff2 (M3)")
    args = ap.parse_args()

    edge = next((c for c in EDGE_CANDIDATES if Path(c).exists()), None)
    if edge is None:
        sys.exit("msedge.exe not found - this probe is for the Windows machine.")
    variable = Path(args.font) if args.font else None
    page = (PAGE.replace("%CHORDS%", json.dumps(CHORDS))
            .replace("%VARWEIGHTS%", "[400, 450, 500, 550, 650, 700]" if variable else "[]"))
    token = secrets.token_urlsafe(16)
    seen: list[dict] = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):             # noqa: D401 - quiet; our own lines below
            pass

        def _send(self, code, body=b"", kind="text/plain"):
            self.send_response(code)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == f"/?t={token}":
                return self._send(HTTPStatus.OK, page.encode("utf-8"), "text/html; charset=utf-8")
            if self.path.startswith("/font/"):
                name = self.path[len("/font/"):]
                src = variable if name == "variable.woff2" else FONTS / name
                if src and src.is_file() and (src == variable or src.parent == FONTS):
                    return self._send(HTTPStatus.OK, src.read_bytes(), "font/woff2")
            return self._send(HTTPStatus.NOT_FOUND)

        def do_POST(self):
            if self.path != "/log":
                return self._send(HTTPStatus.NOT_FOUND)
            size = int(self.headers.get("Content-Length") or 0)
            try:
                item = json.loads(self.rfile.read(min(size, 65536)) or b"{}")
            except ValueError:
                return self._send(HTTPStatus.BAD_REQUEST)
            seen.append(item)
            print(f"  {item.get('kind'):16} {json.dumps(item.get('data'), ensure_ascii=False)}",
                  flush=True)
            return self._send(HTTPStatus.NO_CONTENT)

    port = args.port or free_port()
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{port}/?t={token}"
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    print(f"probe on {url} - press the chords on the page, then close the window "
          "and press Ctrl+C here.", flush=True)
    subprocess.Popen([edge, f"--app={url}"])
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        pass
    httpd.shutdown()
    keys = sorted({i["data"]["chord"] for i in seen if i.get("kind") == "key"})
    print("\nSUMMARY (paste this back)")
    print("  port:", port)
    print("  chords the page saw:", ", ".join(keys) or "none")
    print("  chords never seen:", ", ".join(c for c in CHORDS if c not in keys) or "none")
    for kind in ("m2", "m2-notification", "m4", "m6", "pagehide"):
        last = [i for i in seen if i.get("kind") == kind]
        if last:
            print(f"  {kind}: {json.dumps(last[-1].get('data'), ensure_ascii=False)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
