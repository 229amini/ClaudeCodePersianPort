"""Measure the rendered UI instead of eyeballing it: shots.py's scenes, numbers out.

    python persian-claude-gui/audit_ui.py [scene ...]        (PCG_UI=web|terminal)

Per scene and window size it reports, from the live DOM in Playwright Chromium:
- contrast: text below WCAG AA (4.5:1, 3:1 for large/bold-large text)
- tiny:     rendered text under 12 px
- cut:      a text box whose content is wider/taller than the box with overflow hidden
            (an ellipsis or a hard clip - text the user cannot read)
- target:   a clickable control smaller than 24x24 px (WCAG 2.5.8)
- noname:   a button/link with no text, aria-label or title
- nofocus:  a focusable control in a dialog that shows no outline/shadow when focused
- offgrid:  padding/margin/gap inside a dialog that is not a multiple of 2 px

Nothing here gates a release; it is the checklist a "looks fine" was standing in for.
Exit code is the number of contrast + cut + target + noname + nofocus findings, capped.
"""

from __future__ import annotations

import os
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import shots  # noqa: E402
from test_layout import boot_server, hold_sse  # noqa: E402

AUDIT_JS = r"""
() => {
  const px = (v) => parseFloat(v) || 0;
  const rgba = (s) => { const m = s.match(/[\d.]+/g); if (!m) return null;
    return [+m[0], +m[1], +m[2], m.length > 3 ? +m[3] : 1]; };
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const over = (top, under) => { const a = top[3];
    return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1); };
  function bgOf(el) {           // composite every translucent layer down to the page
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage !== "none" && !cs.backgroundImage.startsWith("url")) return null;
      const c = rgba(cs.backgroundColor);
      if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
    }
    let out = [0, 0, 0, 1];
    for (let i = layers.length - 1; i >= 0; i--) out = over(layers[i], out);
    return out;
  }
  const visible = (el) => { const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false;
    for (let n = el; n; n = n.parentElement) { const cs = getComputedStyle(n);
      if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity === 0) return false; }
    return true; };
  const label = (el) => {
    const t = (el.innerText || el.value || el.getAttribute("aria-label") || el.title || "")
      .replace(/\s+/g, " ").trim();
    const cls = typeof el.className === "string" ? el.className.split(" ")[0] : "";
    return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""} «${t.slice(0, 40)}»`;
  };
  const out = {contrast: [], tiny: [], cut: [], target: [], noname: [], nofocus: [], offgrid: []};

  // Text: every element that directly owns a non-blank text node.
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (!t.data.trim()) continue;
    const el = t.parentElement;
    if (!el || seen.has(el) || !visible(el)) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    const size = px(cs.fontSize), weight = +cs.fontWeight || 400;
    if (size < 12) out.tiny.push(`${label(el)} ${size}px`);
    const fg = rgba(cs.color), bg = bgOf(el);
    if (fg && bg) {
      const f = over([fg[0], fg[1], fg[2], fg[3] * +cs.opacity], bg);
      const a = lum(f), b = lum(bg);
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      if (ratio < (large ? 3 : 4.5)) out.contrast.push(`${label(el)} ${ratio.toFixed(2)}:1 @${size}px`);
    }
  }
  // Cut text: the box or one of its two nearest clipping ancestors hides part of it.
  for (const el of seen) {
    const cs = getComputedStyle(el);
    const clipX = cs.overflowX !== "visible", clipY = cs.overflowY !== "visible";
    const scrolls = /auto|scroll/.test(cs.overflowX + cs.overflowY);
    if (scrolls) continue;
    if ((clipX && el.scrollWidth > el.clientWidth + 1) || (clipY && el.scrollHeight > el.clientHeight + 1))
      out.cut.push(`${label(el)} ${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight}`);
  }
  // Dialog content partly or wholly outside the box that clips it.
  for (const el of document.querySelectorAll(".perm li, .perm button, .perm input, .perm label, .perm p, .perm h3, .perm pre")) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    for (let n = el.parentElement; n; n = n.parentElement) {
      if (getComputedStyle(n).overflowY === "visible") continue;
      const c = n.getBoundingClientRect();
      if (r.bottom > c.bottom + 1 || r.top < c.top - 1)
        out.cut.push(`${label(el)} outside ${label(n).slice(0, 30)} by ${Math.round(Math.max(r.bottom - c.bottom, c.top - r.top))}px`);
      break;
    }
  }
  // Dialog content hidden below a scroll box with no visible cue.
  for (const box of document.querySelectorAll(".perm, .perm *")) {
    const cs = getComputedStyle(box);
    if (!/auto|scroll/.test(cs.overflowY) || box.scrollHeight <= box.clientHeight + 1 || !visible(box)) continue;
    out.cut.push(`${label(box)} scrolls ${box.scrollHeight - box.clientHeight}px hidden (scrollbar ${box.offsetWidth - box.clientWidth}px)`);
  }
  // Controls.
  const ctrls = document.querySelectorAll("button, a[href], input, select, textarea, [role=button], [role=tab], [role=radio], [role=option], [tabindex]:not([tabindex='-1'])");
  for (const el of ctrls) {
    if (!visible(el) || el.disabled) continue;
    const r = el.getBoundingClientRect();
    const type = el.type || "";
    // A radio/checkbox inside its <label> shares the label's hit target.
    const hit = el.tagName === "INPUT" && el.closest("label") ? el.closest("label").getBoundingClientRect() : r;
    if (!(el.tagName === "INPUT" && /text|search/.test(type)) && el.tagName !== "TEXTAREA"
        && (hit.width < 24 || hit.height < 24))
      out.target.push(`${label(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    if (/BUTTON|A/.test(el.tagName) && el.tagName.length <= 6
        && !((el.innerText || "").trim() || el.getAttribute("aria-label") || el.title
             || el.getAttribute("aria-labelledby")))
      out.noname.push(label(el) + " " + el.outerHTML.slice(0, 80));
  }
  // Focus rings, inside dialogs only (focusing everything would scroll the page).
  const before = document.activeElement;
  for (const el of document.querySelectorAll(".perm button, .perm input, .perm [tabindex]:not([tabindex='-1']), .perm [role=tab], .perm [role=radio]")) {
    if (!visible(el) || el.disabled) continue;
    document.activeElement?.blur?.();
    const box = el.closest(".perm"), rest = box && getComputedStyle(box).borderColor;
    el.focus({focusVisible: true, preventScroll: true});
    if (document.activeElement !== el) continue;
    const cs = getComputedStyle(el);
    // Own ring, the row it sits in (a radio's label), or the dialog's edge.
    const row = el.closest("label") && getComputedStyle(el.closest("label"));
    const ring = (cs.outlineStyle !== "none" && px(cs.outlineWidth) > 0) || cs.boxShadow !== "none"
      || (row && row.boxShadow !== "none") || (box && getComputedStyle(box).borderColor !== rest);
    if (!ring) out.nofocus.push(label(el));
  }
  if (before && before.focus) before.focus({preventScroll: true});
  // Spacing scale inside dialogs.
  for (const el of document.querySelectorAll(".perm, .perm *")) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    const vals = ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
                  "marginTop", "marginBottom", "rowGap", "columnGap"].map((k) => [k, px(cs[k])]);
    const odd = vals.filter(([, v]) => v && Math.abs(v - Math.round(v / 2) * 2) > 0.25);
    if (odd.length) out.offgrid.push(`${label(el)} ${odd.map(([k, v]) => k + "=" + v).join(" ")}`);
  }
  return out;
}
"""

GATED = ("contrast", "cut", "target", "noname", "nofocus")


def main() -> int:
    from playwright.sync_api import sync_playwright

    scenes = sys.argv[1:] or ["home", "conversation", "panes4", "panes6", "permission", "question"]
    shots.write_probe(time.time())
    proc, base, token = boot_server(edition=shots.EDITION)
    stop = threading.Event()
    threading.Thread(target=hold_sse, args=(base, token, stop), daemon=True).start()
    total = 0
    show = int(os.environ.get("AUDIT_SHOW", "6"))
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            for scene in scenes:
                for width, height in shots.SIZES:
                    page = browser.new_page(viewport={"width": width, "height": height})
                    page.goto(f"{base}/static/{shots.PROBE.name}?t={token}&scene={scene}")
                    page.wait_for_function("document.documentElement.dataset.sceneDone === '1'",
                                           timeout=30000)
                    if page.title().startswith("SCENE ERROR"):
                        print(f"[{shots.EDITION}] {scene} {width}x{height}: {page.title()}")
                        total += 1
                        page.close()
                        continue
                    res = page.evaluate(AUDIT_JS)
                    page.close()
                    counts = " ".join(f"{k}={len(v)}" for k, v in res.items())
                    print(f"[{shots.EDITION}] {scene} {width}x{height}: {counts}")
                    for k, items in res.items():
                        for item in sorted(set(items))[:show]:
                            print(f"    {k:8} {item}")
                    total += sum(len(res[k]) for k in GATED)
            browser.close()
    finally:
        stop.set()
        proc.terminate()
        shots.PROBE.unlink(missing_ok=True)
    print(f"{total} findings (contrast+cut+target+noname+nofocus)")
    return min(total, 100)


if __name__ == "__main__":
    sys.exit(main())
