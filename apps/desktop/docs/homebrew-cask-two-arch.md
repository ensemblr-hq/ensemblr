# Homebrew cask: two-architecture release contract

The official [`ensemblr-hq/homebrew-tap`](https://github.com/ensemblr-hq/homebrew-tap)
already carries the two-architecture cask. The `Bump the Homebrew cask` step in
[`release.yml`](../../../.github/workflows/release.yml) updates its version and both
DMG SHA-256 values from GitHub's published asset digests after each release.

## Required cask shape

The workflow requires this structure in `Casks/ensemblr.rb`; the version and
digests are release-specific values:

```ruby
cask "ensemblr" do
  arch arm: "arm64", intel: "x64"

  version "<release version>"
  sha256 arm:   "<arm64 DMG SHA-256>",
         intel: "<x64 DMG SHA-256>"

  url "https://github.com/ensemblr-hq/ensemblr/releases/download/v#{version}/Ensemblr-#{version}-#{arch}.dmg"

  depends_on macos: :ventura
  app "Ensemblr.app"
end
```

`x64` is Electron's spelling for Intel macOS artifacts. The `arm:` and `intel:`
keys are Homebrew's architecture selectors, while the interpolated `#{arch}`
keeps each machine on its matching DMG.

## What the workflow checks

Before it writes the cask, the release workflow requires one matching line for
each part of the two-architecture contract:

| Line | Pattern |
| --- | --- |
| architecture stanza | `^  arch arm: "arm64", intel: "x64"$` |
| version | `^  version "[^"]*"$` |
| arm checksum | `^  sha256 arm:   "[0-9a-f]{64}",$` |
| intel checksum | `^         intel: "[0-9a-f]{64}"$` |
| URL | `^  url .*#\{arch\}` |

Whitespace in the checksum lines is part of that contract. The workflow updates
only the version and the two checksum lines, then verifies that all three
changed before it pushes. It copies GitHub's published `digest` values rather
than re-hashing downloads.

## What this does not cover

- **Linux.** The tap is macOS-only; the AppImage is not distributed through it.
- **The canary channel.** Nightlies are never bumped into the cask.
- **In-app updates.** Homebrew-owned installs are updated by Homebrew, not the
  app; see [ADR 0076](./adr/0076-stand-the-in-app-updater-down-on-a-homebrew-owned-install.md).
