# Ensemblr v0.2.5

Ensemblr 0.2.5 adds four bundled Claude Code mods, lets a message you send cut an agent's wait short, keeps the local base branch current after a merge, and lets agents merge pull requests.

### Added

* **Claude sessions load four Ensemblr mods.** They refuse risky git commands, redact workspace secrets before the model reads them, keep key ids through a compaction, and add the linked Linear issue to a conversation's first message. Needs Claude Code 2.1.288 or later. (#734)
* **Agents can merge a pull request** with `ensemblr_merge_pull_request`, under the workspace permission mode. (#737)

### Changed

* **The local base branch is fast-forwarded after a merge**, so the repository root no longer drifts behind `origin`. Switch it in Settings → Git. (#737)
* **A message you send mid-turn ends the wait an agent is blocked in** instead of waiting up to five minutes. (#735)

### Fixed

* **Continue on a merged workspace starts from the latest base**, so the Changes panel no longer lists merged work again. (#736)

See the [changelog](https://github.com/ensemblr-hq/ensemblr/blob/v0.2.5/apps/desktop/CHANGELOG.md) for every change.

### Install

macOS (Apple silicon and Intel):

```sh
brew install --cask ensemblr-hq/tap/ensemblr
```

Or download the `.dmg` for your Mac: `Ensemblr-0.2.5-arm64.dmg` (Apple silicon) or `Ensemblr-0.2.5-x64.dmg` (Intel).

Linux (x64):

```sh
curl -fsSL https://www.ensemblr.dev/install.sh | sh
```

Both `.dmg` files are signed with a Developer ID certificate, hardened-runtime, notarized by Apple and stapled, so they open without a Gatekeeper prompt and validate offline. The Linux installer needs no root, writes nothing outside `$HOME`, verifies the download against the digest GitHub publishes, and keeps a manifest so `--uninstall` removes exactly what it added. Re-running it is an update.

---

*Full changelog*: <https://github.com/ensemblr-hq/ensemblr/compare/v0.2.4...v0.2.5>
