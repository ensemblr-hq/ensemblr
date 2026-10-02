# Ensemblr v0.2.2

Ensemblr 0.2.2 lets you steer an agent past its follow-up queue, resume a stopped sub-agent, and fixes the file tree, checkpoint restores and markdown image previews.

### Added

* **Shift-click Send steers past the follow-up queue.** Holding Shift while pressing Send delivers the message as a steer instead of queuing it behind earlier follow-ups. (#686)
* **Resume a stopped sub-agent.** An orchestrator's follow-up now resumes a sub-agent that has stopped. (#685)

### Fixed

* **File tree rows keep indenting past depth four.** (#684)
* **Restored checkpoint changes stay unstaged.** (#683)
* **SVG and `<picture>` images draw in markdown previews, and QML is highlighted.** (#682)

See the [changelog](https://github.com/ensemblr-hq/ensemblr/blob/v0.2.2/CHANGELOG.md) for every change.

### Install

macOS (Apple silicon and Intel):

```sh
brew install --cask ensemblr-hq/tap/ensemblr
```

Or download the `.dmg` for your Mac: `Ensemblr-0.2.2-arm64.dmg` (Apple silicon) or `Ensemblr-0.2.2-x64.dmg` (Intel).

Linux (x64):

```sh
curl -fsSL https://www.ensemblr.dev/install.sh | sh
```

Both `.dmg` files are signed with a Developer ID certificate, hardened-runtime, notarized by Apple and stapled, so they open without a Gatekeeper prompt and validate offline. The Linux installer needs no root, writes nothing outside `$HOME`, verifies the download against the digest GitHub publishes, and keeps a manifest so `--uninstall` removes exactly what it added. Re-running it is an update.

---

*Full changelog*: <https://github.com/ensemblr-hq/ensemblr/compare/v0.2.1...v0.2.2>
