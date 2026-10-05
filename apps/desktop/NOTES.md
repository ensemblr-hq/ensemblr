# Ensemblr v0.2.4

Ensemblr 0.2.4 moves the Concierge from a floating button to a slim toggle row.

### Changed

* **The Concierge opens from a slim toggle row.** In a workspace it sits under the terminal dock in the review rail; everywhere else it runs along the foot of the content area. It carries the unread count and its mark orbits while a turn is running. The panel still floats, drags and resizes as before. (#729, #731)
* **The guide's screenshots show the new toggle row.** (#730)

See the [changelog](https://github.com/ensemblr-hq/ensemblr/blob/v0.2.4/apps/desktop/CHANGELOG.md) for every change.

### Install

macOS (Apple silicon and Intel):

```sh
brew install --cask ensemblr-hq/tap/ensemblr
```

Or download the `.dmg` for your Mac: `Ensemblr-0.2.4-arm64.dmg` (Apple silicon) or `Ensemblr-0.2.4-x64.dmg` (Intel).

Linux (x64):

```sh
curl -fsSL https://www.ensemblr.dev/install.sh | sh
```

Both `.dmg` files are signed with a Developer ID certificate, hardened-runtime, notarized by Apple and stapled, so they open without a Gatekeeper prompt and validate offline. The Linux installer needs no root, writes nothing outside `$HOME`, verifies the download against the digest GitHub publishes, and keeps a manifest so `--uninstall` removes exactly what it added. Re-running it is an update.

---

*Full changelog*: <https://github.com/ensemblr-hq/ensemblr/compare/v0.2.3...v0.2.4>
