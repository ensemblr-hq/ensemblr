# Ensemblr v0.2.1

Ensemblr 0.2.1 cuts rendering stutter in busy workspaces, gives more file types their own icon, and labels an agent's own status read as "this chat".

### Changed

* **Busy workspaces stutter less.** Live agent updates are isolated from the workbench shell and share one agent-session event feed, streaming deltas are coalesced, and the timeline keeps only a bounded live tail. The Changes tree is virtualized, the All Files tree is memoized, and whole-turn diff rendering is capped per file. On Linux, workspace scans are bounded and watcher events are classified so unrelated writes stop rebuilding the file listing. (#679)
* **More file types get their own icon.** `.ini`, `.qml`, `qmldir` and the systemd units `.service`, `.socket` and `.timer` now show their own glyphs, and configure-time templates ending in `.in` (such as `.service.in` or `config.h.in`) take the icon of the file they generate. (#678)

### Fixed

* **An agent reading its own status no longer looks like it checked a sub-agent.** A status read that names no session now shows "Checked this chat" instead of "Checked a sub-agent", in English, Russian and Greek. (#677)

See the [changelog](https://github.com/ensemblr-hq/ensemblr/blob/v0.2.1/CHANGELOG.md) for every change.

### Install

macOS (Apple silicon and Intel):

```sh
brew install --cask ensemblr-hq/tap/ensemblr
```

Or download the `.dmg` for your Mac: `Ensemblr-0.2.1-arm64.dmg` (Apple silicon) or `Ensemblr-0.2.1-x64.dmg` (Intel).

Linux (x64):

```sh
curl -fsSL https://www.ensemblr.dev/install.sh | sh
```

Both `.dmg` files are signed with a Developer ID certificate, hardened-runtime, notarized by Apple and stapled, so they open without a Gatekeeper prompt and validate offline. The Linux installer needs no root, writes nothing outside `$HOME`, verifies the download against the digest GitHub publishes, and keeps a manifest so `--uninstall` removes exactly what it added. Re-running it is an update.

---

*Full changelog*: <https://github.com/ensemblr-hq/ensemblr/compare/v0.2.0...v0.2.1>
