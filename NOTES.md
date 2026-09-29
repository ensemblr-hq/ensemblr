# Ensemblr v0.1.24

Ensemblr 0.1.24 keeps Sonnet 5 selectable now that Claude Code's `sonnet` alias resolves to Sonnet 5.5, and gives more file types their own icon.

### Fixed

* **Sonnet 5 stays in the Claude model picker.** Claude Code 2.1.284 resolves the `sonnet` alias to `claude-sonnet-5-5`, the same gap #645 closed for Opus 5. `claude-sonnet-5` is now pinned as "Sonnet 5", so both rows show up on a build whose alias has moved. (#668)

### Changed

* **Lockfiles get their own icon instead of the generic Bun glyph.** Cargo.lock, yarn.lock, deno.lock, poetry.lock, uv.lock, pdm.lock, Pipfile.lock, composer.lock, pubspec.lock, mix.lock and Package.resolved now show the icon of the tool that owns them; bun.lockb keeps the Bun icon. `.desktop` launchers, `.icns` and `.nix` files also get proper icons, and flake.lock is highlighted as JSON. (#668, #667)

See the [changelog](https://github.com/ensemblr-hq/ensemblr/blob/v0.1.24/CHANGELOG.md) for every change.

### Install

macOS (Apple silicon and Intel):

```sh
brew install --cask ensemblr-hq/tap/ensemblr
```

Or download the `.dmg` for your Mac: `Ensemblr-0.1.24-arm64.dmg` (Apple silicon) or `Ensemblr-0.1.24-x64.dmg` (Intel).

Linux (x64):

```sh
curl -fsSL https://www.ensemblr.dev/install.sh | sh
```

Both `.dmg` files are signed with a Developer ID certificate, hardened-runtime, notarized by Apple and stapled, so they open without a Gatekeeper prompt and validate offline. The Linux installer needs no root, writes nothing outside `$HOME`, verifies the download against the digest GitHub publishes, and keeps a manifest so `--uninstall` removes exactly what it added. Re-running it is an update.

---

*Full changelog*: <https://github.com/ensemblr-hq/ensemblr/compare/v0.1.23...v0.1.24>
