# Ensemblr v0.2.0

Ensemblr 0.2.0 pins each turn's diff to the moment the turn ended, so a chip on the timeline never shows the next turn's edits, and finds pull requests opened inside a fork.

### Fixed

* **A turn's diff locks when the turn ends.** The agent finishing, the user stopping it, or the next prompt, steer or follow-up arriving now closes the turn at its own snapshot, so the diff chips on the timeline no longer show the following turn's changes, and a steer gets its own turn instead of sharing one. A turn whose end snapshot was lost shows no diff rather than a later one, and diff tabs opened from a finished turn stop following the working tree. Turns recorded before this release have no end of their own and fall back to the next checkpoint in their session, or show no diff. (#673)
* **Pull requests opened inside a fork show up.** In a checkout cloned from a fork, `gh` resolves to the parent repository and reported no pull request for one opened from a branch into the fork itself. Ensemblr now retries once against the repository the branch's remote points at, and uses it for deployments, review threads and merges. Single-remote checkouts make no extra `gh` calls. (#672)

See the [changelog](https://github.com/ensemblr-hq/ensemblr/blob/v0.2.0/CHANGELOG.md) for every change.

### Install

macOS (Apple silicon and Intel):

```sh
brew install --cask ensemblr-hq/tap/ensemblr
```

Or download the `.dmg` for your Mac: `Ensemblr-0.2.0-arm64.dmg` (Apple silicon) or `Ensemblr-0.2.0-x64.dmg` (Intel).

Linux (x64):

```sh
curl -fsSL https://www.ensemblr.dev/install.sh | sh
```

Both `.dmg` files are signed with a Developer ID certificate, hardened-runtime, notarized by Apple and stapled, so they open without a Gatekeeper prompt and validate offline. The Linux installer needs no root, writes nothing outside `$HOME`, verifies the download against the digest GitHub publishes, and keeps a manifest so `--uninstall` removes exactly what it added. Re-running it is an update.

---

*Full changelog*: <https://github.com/ensemblr-hq/ensemblr/compare/v0.1.24...v0.2.0>
