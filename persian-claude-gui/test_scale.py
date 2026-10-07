"""The design scale, measured on the rendered page: DESIGN.md's steps or a finding.

    python persian-claude-gui/test_scale.py [scene ...]        (PCG_UI=web|terminal)

Source CSS cannot answer "what size is this text": `.85em` inside a `.9em` box inside
the 13px chrome is 9.9px, and no grep sees that. So this loads shots.py's scenes in
Playwright Chromium and reads computed values off every visible element:

- font:    a text owner's font-size is one of FONT_STEPS
- space:   padding / margin / gap is one of SPACE_STEPS (or above LAYOUT_FLOOR,
           which is layout - a centred column's gutter - not rhythm)
- radius:  a corner is one of RADIUS_STEPS, or fully round
- control: a button with its own box (fill or border) is CONTROL_STEPS tall
- icon:    an inline <svg> is one of ICON_STEPS square

An element opts out with `data-scale-exempt` on itself or an ancestor (vendored
markdown output, the spec-test fixtures). The scale is DESIGN.md's frontmatter;
change both together. Free, no CLI, no login. Exit code = distinct offenders.
"""

from __future__ import annotations

import sys
import threading
import time
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import shots  # noqa: E402
from test_layout import boot_server, hold_sse  # noqa: E402

FONT_STEPS = (11, 12, 13, 14, 16, 20)
SPACE_STEPS = (0, 2, 4, 8, 12, 16, 20, 24, 32)
LAYOUT_FLOOR = 32
RADIUS_STEPS = (0, 4, 6, 8)
CONTROL_STEPS = (24, 28, 32)
ICON_STEPS = (14, 16)
SIZES = ((1280, 800), (1052, 711))

SCALE_JS = r"""
(steps) => {
  const px = (v) => parseFloat(v) || 0;
  const on = (v, list) => list.some((s) => Math.abs(Math.abs(v) - s) < 0.3);
  const visible = (el) => { const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false;
    for (let n = el; n; n = n.parentElement) { const cs = getComputedStyle(n);
      if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity === 0) return false; }
    return true; };
  const who = (el) => {
    const cls = (typeof el.className === "string" ? el.className : el.className?.baseVal || "")
      .trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".");
    const host = el.parentElement?.closest("[class]");
    const hc = host ? String(host.className.baseVal ?? host.className).trim().split(/\s+/)[0] : "";
    return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}${cls ? "" : hc ? " in ." + hc : ""}`;
  };
  const out = [];
  const add = (kind, el, prop, v) => out.push(`${kind}\t${who(el)}\t${prop}=${Math.round(v * 10) / 10}`);
  for (const el of document.body.querySelectorAll("*")) {
    if (el.closest("[data-scale-exempt]") || !visible(el)) continue;
    const cs = getComputedStyle(el);
    const ownsText = [...el.childNodes].some((n) => n.nodeType === 3 && n.data.trim());
    if (ownsText && px(cs.fontSize) && !on(px(cs.fontSize), steps.font)) add("font", el, "font-size", px(cs.fontSize));
    const typed = el.computedStyleMap?.();
    for (const k of ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
                     "marginTop", "marginRight", "marginBottom", "marginLeft"]) {
      // An `auto` margin is placement, not rhythm; getComputedStyle reports its used px.
      const css = k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
      if (k.startsWith("margin") && String(typed?.get(css)) === "auto") continue;
      const v = px(cs[k]);
      if (Math.abs(v) <= steps.layout && !on(v, steps.space)
          && !(v === -1 && k.startsWith("margin"))) add("space", el, k, v);
    }
    if (/flex|grid/.test(cs.display)) for (const k of ["rowGap", "columnGap"]) {
      const v = px(cs[k]);
      if (cs[k] !== "normal" && v <= steps.layout && !on(v, steps.space)) add("space", el, k, v);
    }
    const r = px(cs.borderTopLeftRadius), box = el.getBoundingClientRect();
    const round = r >= Math.min(box.width, box.height) / 2 - 0.5;
    if (r && !round && !on(r, steps.radius)) add("radius", el, "radius", r);
    if (el.tagName === "BUTTON") {
      const boxed = cs.backgroundColor !== "rgba(0, 0, 0, 0)" || px(cs.borderTopWidth) > 0;
      if (boxed && box.height < 40 && !on(box.height, steps.control)) add("control", el, "height", box.height);
    }
    if (el.tagName === "svg" && box.width <= 20 && !on(box.width, steps.icon) && !on(box.width, [12, 20]))
      add("icon", el, "size", box.width);
  }
  return out;
}
"""


def main() -> int:
    from playwright.sync_api import sync_playwright

    terminal_only = {"newsession", "newsession-pair", "bell", "changes", "layout"}
    scenes = sys.argv[1:] or [s for s in shots.SCENES
                              if shots.EDITION == "terminal" or s not in terminal_only]
    steps = {"font": FONT_STEPS, "space": SPACE_STEPS, "layout": LAYOUT_FLOOR,
             "radius": RADIUS_STEPS, "control": CONTROL_STEPS, "icon": ICON_STEPS}
    shots.write_probe(time.time())
    proc, base, token = boot_server(edition=shots.EDITION)
    stop = threading.Event()
    threading.Thread(target=hold_sse, args=(base, token, stop), daemon=True).start()
    found: dict[str, set[str]] = defaultdict(set)
    errors = 0
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            for scene in scenes:
                for width, height in SIZES:
                    page = browser.new_page(viewport={"width": width, "height": height})
                    page.goto(f"{base}/static/{shots.PROBE.name}?t={token}&scene={scene}")
                    page.wait_for_function("document.documentElement.dataset.sceneDone === '1'",
                                           timeout=30000)
                    if page.title().startswith("SCENE ERROR"):
                        print(f"[{shots.EDITION}] {scene} {width}x{height}: {page.title()}")
                        errors += 1
                    else:
                        for line in page.evaluate(SCALE_JS, steps):
                            found[line].add(scene)
                    page.close()
            browser.close()
    finally:
        stop.set()
        proc.terminate()
        shots.PROBE.unlink(missing_ok=True)
    by_kind: dict[str, list[str]] = defaultdict(list)
    for line, where in sorted(found.items()):
        kind, el, val = line.split("\t")
        by_kind[kind].append(f"    {el:52} {val:22} {','.join(sorted(where))[:60]}")
    for kind in ("font", "space", "radius", "control", "icon"):
        if by_kind[kind]:
            print(f"{kind}: {len(by_kind[kind])}")
            print("\n".join(by_kind[kind]))
    total = len(found) + errors
    print(("PASS" if not total else "FAIL") + f" - {total} off-scale ({shots.EDITION} edition)")
    return min(total, 100)


if __name__ == "__main__":
    sys.exit(main())
