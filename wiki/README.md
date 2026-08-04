# Wiki index

Project memory for the Persian RTL Claude Code front-end. One topic per file, kebab-case.
Write here when a session learns something a future session would otherwise re-derive —
especially the §B-9 verification answers, which are pinned to a specific `claude` version.

- [cli-stream-json-findings.md](cli-stream-json-findings.md) — **read first.** Measured CLI
  contract on 2.1.221: required flags, every event type seen on the wire, and the permission
  mechanism that actually works (it is not the one in the plan).
- [dev-environment.md](dev-environment.md) — this machine: no winget, Store-stub Python, the
  install that worked, and how to run the wrapper in dev.
- [rtl-rendering-notes.md](rtl-rendering-notes.md) — how to re-run the 8 spec tests, why bare
  paths need a JS pass, and the two traps (subresource auth, global-scope collision) that a
  screenshot cannot catch.
- [permission-broker.md](permission-broker.md) — the approval flow that replaces plan §B-5, and
  the trap that cost the most time: a space in the hook command silently disables it.
- [sessions-and-history.md](sessions-and-history.md) — `--resume` semantics, where transcripts
  live, how they differ from the live stream, and the restart pitfalls (stale readers, replay
  history).
- [parity-chrome.md](parity-chrome.md) — the interrupt control message, slash commands, image
  blocks, statusLine passthrough, and the CLI features deliberately left unbuilt.
- [packaging.md](packaging.md) — `setup.ps1`/`run.vbs`/shortcut, the three encoding rules that
  each silently corrupt Persian, and exactly which install branches are still unproven.
- [log.md](log.md) — running session log: what was verified, decided, or discovered, with dates.

## §B-9 verification: all ten answered

Every item is recorded in the files above, pinned to `claude` 2.1.221. Re-verify after a CLI
upgrade — flags and stream shapes drift between releases, and the permission design in particular
depends on undocumented behaviour.

M7 packaging is built and verified here. What remains is **M8 acceptance on the colleague's PC**,
which cannot be done from this machine — run `M8-acceptance.md` at the repo root.

## Also worth capturing

- Target PC probe results (`claude` version + path, WebView2/Edge, real Python vs. Store stub,
  winget usable, install permissions) and the contents of its `~/.claude/settings.json`.
- Whatever the Option A gate produced — which spec tests failed in the VS Code panel informs
  where the wrapper needs extra care.
