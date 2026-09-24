# Ensemblr v0.1.22

Ensemblr 0.1.22 fixes Opus 5 disappearing from the Claude model picker.

### Highlights

* **Opus 5 is back in the Claude model picker.** Claude Code 2.1.280 moved the `opus[1m]` alias on to Opus 5.5, so the picker row that used to read "Opus 5" correctly started reading "Opus 5.5" — but `supportedModels()` no longer lists Opus 5 at all, and nothing pinned it, so it vanished from the picker even though the API still serves `claude-opus-5`. `claude-opus-5` is now pinned as "Opus 5"; the existing release-key dedupe keeps that from showing twice on an older binary whose alias still resolves to it. (#645)

See the [changelog](https://github.com/ensemblr-hq/ensemblr/blob/v0.1.22/CHANGELOG.md) for every change.

### Install

macOS (Apple silicon and Intel):

```sh
brew install --cask ensemblr-hq/tap/ensemblr
```

Or download the `.dmg` for your Mac: `Ensemblr-0.1.22-arm64.dmg` (Apple silicon) or `Ensemblr-0.1.22-x64.dmg` (Intel).

Linux (x64):

```sh
curl -fsSL https://www.ensemblr.dev/install.sh | sh
```

Both `.dmg` files are signed with a Developer ID certificate, hardened-runtime, notarized by Apple and stapled, so they open without a Gatekeeper prompt and validate offline. The Linux installer needs no root, writes nothing outside `$HOME`, verifies the download against the digest GitHub publishes, and keeps a manifest so `--uninstall` removes exactly what it added. Re-running it is an update.

---

*Full changelog*: <https://github.com/ensemblr-hq/ensemblr/compare/v0.1.21...v0.1.22>
