"""Render cover.html to docs/screenshots/cover.png (2400x1350) with headless Edge."""

import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[2] / "persian-claude-gui"))

from test_layout import find_edge  # noqa: E402

out = HERE.parent / "cover.png"
subprocess.run([
    find_edge(), "--headless=new", "--disable-gpu", "--hide-scrollbars",
    "--allow-file-access-from-files", "--force-device-scale-factor=1",
    "--window-size=2400,1350", "--virtual-time-budget=3000",
    f"--screenshot={out}", (HERE / "cover.html").as_uri(),
], check=True, timeout=60)
print(out)
