"""Guard check for transcript_path — the choke point every by-id transcript
access routes through (read and delete). Deletion made it load-bearing: a
crafted id that escapes the folder would unlink an arbitrary file.

    python test_transcript_path.py
"""
import tempfile
from pathlib import Path

import server


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        cwd = root / "proj"
        cwd.mkdir()
        server.PROJECTS_DIR = root / "projects"
        folder = server.PROJECTS_DIR / str(cwd).replace(":", "-").replace("\\", "-").replace("/", "-")
        folder.mkdir(parents=True)
        (folder / "abc.jsonl").write_text("{}\n", encoding="utf-8")
        outside = root / "projects" / "secret.jsonl"
        outside.write_text("{}\n", encoding="utf-8")

        assert server.transcript_path(cwd, "abc") == (folder / "abc.jsonl").resolve()
        assert server.transcript_path(cwd, "missing") is None
        for escape in ("../secret", "..\\secret", "sub/../../secret"):
            assert server.transcript_path(cwd, escape) is None, escape
        assert outside.is_file(), "guard let an outside file through"

        server.PROJECTS_DIR = root / "nope"
        assert server.transcript_path(cwd, "abc") is None

    print("PASS")


if __name__ == "__main__":
    main()
