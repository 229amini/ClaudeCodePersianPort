r"""App zoom gate (BRIDGEMIND-PORT.md §D13, phase P9).

`static-terminal/js/prefs.js` carries the zoom as one swappable value,
ZOOM_MODE, waiting on the Windows measurement (probe_edge.py M2/M4). This
gate proves both branches without editing it - `<html data-zoom-mode>` is the
override the module reads:

  - native (the shipped default): Ctrl+= / Ctrl+- / Ctrl+0 are left to Edge -
    not prevented, no class, no readout;
  - css: the three chords are the window's, by `e.code`, stepping through
    80-150%, clamped at both ends, with a readout in the sidebar footer that
    is hidden at 100%, and the level remembered in the prefs store.

Free: no CLI, no login. Two page loads on one server.

    python persian-claude-gui\test_zoom.py
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

EDITION = os.environ.get("PCG_UI", "terminal")
STATIC = HERE / EDITIONS[EDITION][0]
PROBE = STATIC / "_zoom_probe.html"

# Before any module: initZoom() reads the attribute once, at boot.
MODE_JS = ('<script>if (new URLSearchParams(location.search).get("mode") === "css")'
           ' document.documentElement.dataset.zoomMode = "css";</script>')

PROBE_JS = r"""
<pre id="probe-out" hidden></pre>
<script type="module">
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FA = window.STRINGS;
const press = (code) => !document.dispatchEvent(new KeyboardEvent("keydown",
  { code, key: code === "Digit0" ? "0" : code === "Minus" ? "-" : "=",
    ctrlKey: true, bubbles: true, cancelable: true }));
const zoom = () => getComputedStyle(document.documentElement).getPropertyValue("--zoom").trim();
const readout = () => document.getElementById("side-zoom");
(async () => {
 const out = {};
 try {
  await sleep(200);
  out.mode = document.documentElement.dataset.zoomMode || "native";
  out.cls = document.documentElement.classList.contains("css-zoom");
  out.plus1 = press("Equal"); out.z1 = zoom();
  out.plus2 = press("Equal"); out.z2 = zoom();
  out.read2 = readout()?.hidden ? "" : readout()?.textContent;
  out.faRead2 = FA.sideZoom.replace("{n}", (125).toLocaleString("fa-IR"));
  for (let i = 0; i < 6; i++) press("Equal");
  out.top = zoom();
  press("Digit0"); out.reset = zoom(); out.readReset = !!readout()?.hidden;
  for (let i = 0; i < 6; i++) press("Minus");
  out.bottom = zoom();
  let stored = null;
  try { stored = JSON.parse(sessionStorage.getItem("pcg.zoom")); } catch (e) {}
  out.stored = stored;
  out.rootZoom = getComputedStyle(document.documentElement).zoom;
  document.getElementById("probe-out").textContent = "PROBE" + JSON.stringify(out) + "ENDPROBE";
 } catch (err) {
  document.getElementById("probe-out").textContent =
    "PROBE" + JSON.stringify({ error: String(err && err.stack || err) }) + "ENDPROBE";
 }
})();
</script>
"""


def write_probe() -> None:
    page = (STATIC / "index.html").read_text(encoding="utf-8")
    page = page.replace("{{VERSION}}", "9.9.9")
    marker = '<body class="app">'
    if marker not in page:
        sys.exit("index.html no longer opens with " + marker)
    page = page.replace(marker, marker + MODE_JS, 1)
    page = page.replace(marker, '<body class="app" data-render-only>', 1)
    PROBE.write_text(page.replace("</body>", PROBE_JS + "\n</body>", 1), encoding="utf-8")


def checks(native: dict, css: dict) -> list[tuple[str, bool, str]]:
    out: list[tuple[str, bool, str]] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        out.append((name, bool(ok), detail))

    check("native (shipped): the chords are left to Edge, nothing is drawn",
          native.get("mode") == "native" and not native.get("cls")
          and native.get("plus1") is False and native.get("z1") == "",
          f"mode {native.get('mode')}, prevented {native.get('plus1')}, --zoom {native.get('z1')!r}")
    check("css: Ctrl+= is the window's, one step at a time",
          css.get("cls") and css.get("plus1") is True and css.get("z1") == "1.1"
          and css.get("z2") == "1.25",
          f"{css.get('z1')} -> {css.get('z2')}")
    check("css: the footer says the level, in Persian digits",
          css.get("read2") == css.get("faRead2"), f"«{css.get('read2')}»")
    check("css: clamped at 150% and at 80%",
          css.get("top") == "1.5" and css.get("bottom") == "0.8",
          f"top {css.get('top')}, bottom {css.get('bottom')}")
    check("css: Ctrl+0 is 100%, and the readout goes",
          css.get("reset") == "1" and css.get("readReset"),
          f"{css.get('reset')} / hidden {css.get('readReset')}")
    check("css: the level is remembered in the prefs store", css.get("stored") == 0.8,
          repr(css.get("stored")))
    check("css: the root actually scales", css.get("rootZoom") == "0.8",
          repr(css.get("rootZoom")))
    return out


def main() -> int:
    if EDITION != "terminal":
        print("SKIP - app zoom is the terminal edition's (BRIDGEMIND-PORT.md §D0)")
        return 0
    edge = find_edge()
    write_probe()
    try:
        proc, base, token = boot_server(edition=EDITION)
    except Exception as err:                          # noqa: BLE001
        print(f"FAIL - {err}")
        return 1
    try:
        stop = threading.Event()
        threading.Thread(target=hold_sse, args=(base, token, stop), daemon=True).start()
        url = f"{base}/static/_zoom_probe.html?t={token}"
        try:
            native = measure(edge, url, 1280, 800)
            css = measure(edge, url + "&mode=css", 1280, 800)
        except Exception as err:                      # noqa: BLE001
            print(f"FAIL - {err}")
            return 1
    finally:
        proc.terminate()
        PROBE.unlink(missing_ok=True)

    for report in (native, css):
        if report.get("error"):
            print("FAIL - the probe threw: " + str(report["error"]))
            return 1
    results = checks(native, css)
    for name, ok, detail in results:
        print(f"  {'OK  ' if ok else 'FAIL'} {name}" + (f"  -- {detail}" if detail else ""))
    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print(f"{'PASS' if passed == total else 'FAIL'} — {passed}/{total}")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
