# Ensemblr v0.2.6

> **This is the last release of the Electron-based Ensemblr. The project is moving to Rust.**

Ensemblr 0.2.6 moves every dependency to its latest release, Electron 45 and Electron Forge 8 included, and lets Claude Code's Plan Mode run Ensemblr's control tools again.

### Changed

* **Every dependency is at its latest release**, including Electron 45 (up from 44) and Electron Forge 8. The terminal and other native parts are rebuilt for it. (#750)

### Fixed

* **Claude Code's Plan Mode runs Ensemblr's control tools again.** Claude Code 2.1.300 had started refusing them in plan mode, so a planning chat could not name its tab or ask you a question. (#745)

See the [changelog](https://github.com/ensemblr-hq/ensemblr/blob/v0.2.6/apps/desktop/CHANGELOG.md) for every change.

### Install

macOS (Apple silicon and Intel):

```sh
brew install --cask ensemblr-hq/tap/ensemblr
```

Or download the `.dmg` for your Mac: `Ensemblr-0.2.6-arm64.dmg` (Apple silicon) or `Ensemblr-0.2.6-x64.dmg` (Intel).

Linux (x64):

```sh
curl -fsSL https://www.ensemblr.dev/install.sh | sh
```

Both `.dmg` files are signed with a Developer ID certificate, hardened-runtime, notarized by Apple and stapled, so they open without a Gatekeeper prompt and validate offline. The Linux installer needs no root, writes nothing outside `$HOME`, verifies the download against the digest GitHub publishes, and keeps a manifest so `--uninstall` removes exactly what it added. Re-running it is an update.

---

*Full changelog*: <https://github.com/ensemblr-hq/ensemblr/compare/v0.2.5...v0.2.6>
