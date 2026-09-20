# Homebrew cask: the two-architecture shape

Hand-off artifact. The release workflow's `Bump the Homebrew cask` step (job
`finalize` in [`.github/workflows/release.yml`](../.github/workflows/release.yml))
edits `Casks/ensemblr.rb` in
[`ensemblr-hq/homebrew-tap`](https://github.com/ensemblr-hq/homebrew-tap), a
repository this one cannot read. The step was written against the shape below,
so **the tap must be migrated to it once, by hand, before the first release that
ships an x64 DMG.**

Until then the step fails closed. It refuses any cask that does not carry every
line pattern listed under [What the workflow checks](#what-the-workflow-checks),
because a `sed` that matched nothing would push a commit that changes nothing and
leave the tap on the old version. A failure there happens *after* the prerelease flag is
set and *before* the Linux job starts (Linux waits on `finalize`), so an
unmigrated tap delays the AppImage until the cask is fixed and the job is re-run.

## Intended cask

Only the stanzas that change are spelled out. Everything marked *unchanged* is
carried over from the cask the tap already holds — this file never had the
authority to restate them.

```ruby
cask "ensemblr" do
  arch arm: "arm64", intel: "x64"

  version "0.1.1"
  sha256 arm:   "<sha256 of Ensemblr-0.1.1-arm64.dmg>",
         intel: "<sha256 of Ensemblr-0.1.1-x64.dmg>"

  url "https://github.com/ensemblr-hq/ensemblr/releases/download/v#{version}/Ensemblr-#{version}-#{arch}.dmg"
  # name, desc, homepage: unchanged
  # livecheck (the custom :github_releases block): unchanged
  # auto_updates true: unchanged

  depends_on macos: :ventura
  # `depends_on arch: :arm64`, if the current cask carries it: DELETE. It is what
  # keeps Intel Macs out today, and the two-architecture cask exists to let them in.

  # app "Ensemblr.app": unchanged
  # zap trash: [...] (without the root directory): unchanged
end
```

What the change amounts to, against the single-architecture cask:

| Stanza | Before | After |
| --- | --- | --- |
| `arch` | absent | `arch arm: "arm64", intel: "x64"` |
| `sha256` | one line, `sha256 "<hex>"` | two lines, `arm:` then `intel:`, aligned |
| `url` | names `arm64` literally | interpolates `#{arch}` |
| `depends_on arch: :arm64` | present, if it is | removed |

The DMG names are what Forge's DMG maker emits: `Ensemblr-<version>-arm64.dmg`
and `Ensemblr-<version>-x64.dmg`. `x64` is Electron's spelling of the Intel
architecture, which is why the `intel:` value is `"x64"` and not `"x86_64"`.
Homebrew's `arch` stanza takes whatever string the URL needs; only the keys
`arm:` and `intel:` are Homebrew's.

## What the workflow checks

Each pattern must match at least one line, or the step exits with an error
pointing here:

| Line | Pattern |
| --- | --- |
| architecture stanza | `^  arch arm: "arm64", intel: "x64"$` |
| version | `^  version "[^"]*"$` |
| arm checksum | `^  sha256 arm:   "[0-9a-f]{64}",$` |
| intel checksum | `^         intel: "[0-9a-f]{64}"$` |
| url | `^  url .*#\{arch\}` |

Whitespace is part of the contract. `sha256 arm:` is followed by **three**
spaces and the `intel:` line is indented **nine**, so the two values align the
way `brew style` writes them. The step rewrites the `version` line and the two
checksum lines and nothing else, then asserts all three landed before it pushes.
The checksums come from the `digest` field GitHub computed over each stored DMG,
not from a re-hash.

## Migrating the tap

Do this **before** cutting the first release that ships an x64 DMG.

1. In `ensemblr-hq/homebrew-tap`, edit `Casks/ensemblr.rb` to the shape above,
   keeping the current `version` and the current arm64 checksum.
2. The `intel:` checksum has no DMG to hash yet. Any 64-character lowercase hex
   string satisfies the workflow's pattern — use 64 zeros and expect the next
   bump to overwrite it.
3. Delete `depends_on arch: :arm64` if present.
4. Run `brew style` and `brew audit --cask` in the tap. Do not run `brew fetch`
   for Intel: no x64 DMG exists for the current version, so it can only fail.
5. Merge. From here the release workflow keeps the file current.

The gap between step 5 and the release is real but narrow: an Intel Mac that runs
`brew install --cask ensemblr-hq/tap/ensemblr` in it gets a 404 for an x64 DMG
that does not exist yet, where before it was refused up front. The first release
closes it.

## After the first two-architecture release

Confirm the bump landed correctly, on any machine:

```sh
version=0.1.1   # the release just cut
for arch in arm64 x64; do
  curl -fsSL "https://github.com/ensemblr-hq/ensemblr/releases/download/v${version}/Ensemblr-${version}-${arch}.dmg" | shasum -a 256
done
```

The two digests must equal the `arm:` and `intel:` values in the cask, in that
order. If the tap's CI runs `brew fetch`, it now needs an Intel runner (or to
accept that it only exercises the host architecture) to cover both stanzas.

## What this does not cover

- **Linux.** The tap holds one cask and it is macOS-only; the AppImage is not
  distributed through it.
- **The canary channel.** Nightlies are never bumped into the cask.
- **`docs/build-and-release.md`.** Its "The Homebrew tap" section still describes
  the single-architecture step and needs a follow-up edit to match; that file
  belongs to a different change.
