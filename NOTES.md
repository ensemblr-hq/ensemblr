# Ensemblr v0.1.20

Ensemblr 0.1.20 ships an Intel Mac build alongside Apple silicon, makes the updater pick the download for its own architecture, moves the package manager to Bun, and clears a backlog of fixes across chat scrolling, checkpoints, Linear, and attachments.

### Highlights

* **An Intel Mac build.** macOS now ships one signed, notarized `.dmg` and `.zip` per architecture — `arm64` as before, plus `x64` — rather than a universal binary, so an Apple-silicon Mac still downloads only arm64 code. Linux x64 stays an `.AppImage`; Linux arm64 is planned for the release after this one. ([ADR 0074](https://github.com/ensemblr-hq/ensemblr/blob/v0.1.20/docs/adr/0074-ship-four-build-targets-and-select-updates-by-architecture.md))
* **The updater selects by architecture.** Each release carries one feed document per target, `update-<platform>-<arch>.json`, and a build reads the one for its own platform and `process.arch` — an Intel install never moves to arm64, or the reverse. `update-darwin-arm64.json` keeps its exact name and shape for builds already installed.
* **A chat follows the newest message until you scroll away from it, and only then.** A growing composer no longer slides the newest message under it, reaching for PageUp or the scrollbar mid-stream no longer pulls you back down, and an abandoned scroll position expires after 60 s of inactivity. (#628)
* **Archiving a workspace that adopted an existing branch no longer deletes that branch.** (#627)
* **A turn checkpoint no longer deletes a tracked file that later gained an ignore rule.** (#627)
* **Clearing a Linear assignee, project, or cycle now clears it.** (#627)
* **Terminals no longer spend a delegation spawn.** Long-running orchestrators stop being refused with `Root-tree spawn quota of 20 exhausted`; terminals take their own guard of 8 open per tree and 10 starts per minute. (#626)
* **Oversize text attachments are announced by path instead of failing the send.** (#623)
* **Security:** Plan Mode denies BSD `date`'s bare clock-setting operand (#627), and a Linear disconnect can no longer be raced into keeping its credentials (#627).
* **The package manager is Bun again**, so workspace setup is fast: `bun ci` warm measured 0.2 s. Node 24 remains the runtime. ([ADR 0073](https://github.com/ensemblr-hq/ensemblr/blob/v0.1.20/docs/adr/0073-move-the-package-manager-from-npm-to-bun.md))

See the [changelog](https://github.com/ensemblr-hq/ensemblr/blob/v0.1.20/CHANGELOG.md) for every change.

### Install

macOS (Apple silicon and Intel):

```sh
brew install --cask ensemblr-hq/tap/ensemblr
```

Or download the `.dmg` for your Mac: `Ensemblr-0.1.20-arm64.dmg` (Apple silicon) or `Ensemblr-0.1.20-x64.dmg` (Intel).

Linux (x64):

```sh
curl -fsSL https://www.ensemblr.dev/install.sh | sh
```

Both `.dmg` files are signed with a Developer ID certificate, hardened-runtime, notarized by Apple and stapled, so they open without a Gatekeeper prompt and validate offline. The Linux installer needs no root, writes nothing outside `$HOME`, verifies the download against the digest GitHub publishes, and keeps a manifest so `--uninstall` removes exactly what it added. Re-running it is an update.

---

*Full changelog*: <https://github.com/ensemblr-hq/ensemblr/compare/v0.1.19...v0.1.20>
