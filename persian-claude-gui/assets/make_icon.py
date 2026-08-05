"""Regenerate assets/icon.ico — the «کلاد فارسی» mark.

    python persian-claude-gui\\assets\\make_icon.py

Stdlib only, like everything else here. Two decisions worth keeping:

* **PNG inside an ICO container** (legal since Vista) rather than a DIB with an
  AND mask — same result on Windows 10/11, a fraction of the code.
* **The geometry below is the SVG mark from static/index.html**, in the same
  24x24 viewBox. Keep them in one file's worth of edit distance: a desktop icon
  that does not match the icon in the window is the kind of thing nobody
  reports and everybody notices.

The mark is a terminal prompt mirrored — the caret points the way Persian
reads, cursor to its left. Original by decision (REWORK-PLAN.md branding option
b): this is an independent front-end, so it must not wear Anthropic's mark.
"""

import math
import struct
import zlib
from pathlib import Path

BG = (0xD9, 0x77, 0x57)    # --accent
INK = (0xF0, 0xEE, 0xE6)   # --fg

# 24x24 viewBox, matching static/index.html.
VIEWBOX = 24.0
STROKE = 2.3
CORNER = 5.3               # ~22% — a Windows tile, not a circle
SEGMENTS = [
    ((17.1, 7.4), (11.9, 12.0)),   # caret, upper arm
    ((11.9, 12.0), (17.1, 16.6)),  # caret, lower arm
    ((6.9, 16.6), (10.9, 16.6)),   # the cursor
]
SIZES = (16, 32, 48, 64, 128, 256)


def seg_dist(px, py, a, b):
    """Distance from a point to a segment — a round-capped stroke is just this
    distance thresholded, which is why no cap geometry appears anywhere."""
    (ax, ay), (bx, by) = a, b
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    span = vx * vx + vy * vy
    t = 0.0 if span == 0 else max(0.0, min(1.0, (wx * vx + wy * vy) / span))
    return math.hypot(wx - t * vx, wy - t * vy)


def rrect_dist(px, py, half, radius):
    qx = abs(px) - half + radius
    qy = abs(py) - half + radius
    return (math.hypot(max(qx, 0.0), max(qy, 0.0))
            + min(max(qx, qy), 0.0) - radius)


def render(size):
    """RGBA rows. Anti-aliasing is analytic — coverage from the signed distance
    in *pixels* — so it costs one sample per pixel instead of a supersample."""
    scale = size / VIEWBOX
    half = VIEWBOX / 2
    rows = []
    for y in range(size):
        row = bytearray()
        vy = (y + 0.5) / scale
        for x in range(size):
            vx = (x + 0.5) / scale
            tile = -rrect_dist(vx - half, vy - half, half, CORNER) * scale
            ink = -(min(seg_dist(vx, vy, a, b) for a, b in SEGMENTS)
                    - STROKE / 2) * scale
            a_tile = min(max(tile + 0.5, 0.0), 1.0)
            a_ink = min(max(ink + 0.5, 0.0), 1.0)
            for channel in range(3):
                row.append(round(BG[channel] * (1 - a_ink) + INK[channel] * a_ink))
            row.append(round(a_tile * 255))
        rows.append(bytes(row))
    return rows


def png(size, rows):
    def chunk(tag, data):
        body = tag + data
        return (struct.pack(">I", len(data)) + body
                + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF))

    raw = b"".join(b"\x00" + row for row in rows)   # filter type 0 per row
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9))
            + chunk(b"IEND", b""))


def ico(images):
    offset = 6 + 16 * len(images)
    entries, blobs = b"", b""
    for size, blob in images:
        # 256 is stored as 0 in the byte-wide width/height fields.
        entries += struct.pack("<BBBBHHII", size & 0xFF, size & 0xFF, 0, 0,
                               1, 32, len(blob), offset)
        offset += len(blob)
        blobs += blob
    return struct.pack("<HHH", 0, 1, len(images)) + entries + blobs


def main():
    images = [(size, png(size, render(size))) for size in SIZES]
    target = Path(__file__).with_name("icon.ico")
    target.write_bytes(ico(images))
    print(f"{target} — {target.stat().st_size} bytes, {len(images)} sizes")


if __name__ == "__main__":
    main()
