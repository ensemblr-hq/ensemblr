# 0074. Ship Four Build Targets, Select Updates by Architecture, and Bridge the Release Order

Date: 2026-09-21

## Status

Accepted

Amends [0056](./0056-ship-a-linux-amd64-appimage.md): its statements that
`make`/`package`/`build` are pinned to `--arch=arm64`, that Intel macOS and arm64
Linux "are still not built", and that the resolver picks a Linux release asset by
its `.AppImage` suffix no longer hold. Its choice of AppImage, `safeStorage`, and
the rest of the Linux port stand.

Amends [0055](./0055-resolve-updates-in-app-against-the-github-releases-api.md):
the single feed document it reads, `update-darwin-arm64.json`, becomes one
document per target. Its tag scheme, channel isolation, and state machine are
unchanged.

Touches [0065](./0065-install-linux-updates-in-app-by-swapping-the-appimage.md):
the AppImage swap installs whatever asset the feed document names, rather than the
first asset ending in `.appimage`. Everything else about the swap — the `APPIMAGE`
check, the digest verification, the atomic rename — is unchanged.

Ships in the same release as
[0073](./0073-move-the-package-manager-from-npm-to-bun.md).

## Context

Ensemblr shipped two artifacts: a macOS arm64 `.dmg`/`.zip` and a Linux x86-64
`.AppImage`. Two assumptions were baked in, and both had to move together.

**The build assumed one architecture per platform.** `build`, `package`, `make`,
`make:linux`, and `package:linux` each carried a literal `--arch`, so a bare
`make` on an Intel Mac produced an arm64 bundle without saying so.

**The updater assumed one document per platform.** The feed it reads is
`update-darwin-arm64.json`, hardcoded as `UPDATE_FEED_ASSET_NAME`. On Linux the
resolver did not read a feed document at all: it picked the first release asset
whose name ended in `.appimage`, with no architecture check. Adding a second
architecture on either platform therefore meant a client could be handed a build
it cannot run.

Two of those facts cannot be changed retroactively, and they set the order of
everything below:

- Every already-installed Apple-silicon client reads `update-darwin-arm64.json`
  by that exact name.
- Every already-shipped linux-x64 client takes the first asset ending in
  `.appimage` and cannot be patched.

## Decision

### Four targets, one build per architecture

| Target | This release | Artifact |
| --- | --- | --- |
| darwin-arm64 | unchanged | `.dmg` + `.zip` |
| darwin-x64 | **new**, cross-built on `macos-15` | `.dmg` + `.zip` |
| linux-x64 | unchanged | `.AppImage` |
| linux-arm64 | **next release, not this one** | `.appimage.bin` |

macOS is built **per architecture, not as a universal binary**. A universal build
roughly doubles the download for every Apple-silicon user, to carry code they will
never run. It is also not
mechanically safe here: `@electron/universal` throws on a non-Mach-O file that
differs between the two architectures, and `node-pty/build/Release/.forge-meta`
is exactly such a file.

The Intel build is cross-built on the existing `macos-15` runner rather than
requiring an Intel host. That works because the one native module, `node-pty`,
ships prebuilds for both `darwin-arm64` and `darwin-x64`, so nothing has to
compile for the foreign architecture. (Linux is the opposite case and stays a
Linux-host build; see 0056.)

### Host architecture by default, explicit in CI

No `package.json` script hardcodes `--arch` any more. Forge defaults to the host
architecture, and CI passes `--arch` explicitly on every leg, so a workflow reads
as what it builds and a local `bun run make` on any Mac produces a bundle that
runs there. A deliberate cross-build passes `--arch` itself.

### Feed documents per target, selected by architecture

Each release carries one feed document per target it ships, named
`update-<platform>-<arch>.json`, and `updateFeedAssetName(platform, arch)` in
`src/main/updates/release-feed.ts` is the one place the name is built.

**`update-darwin-arm64.json` keeps its exact name and shape forever.** The
generalization grows around it; it never renames or reshapes it. That is a
compatibility floor, not a preference: the installed clients that read it cannot
be updated to read anything else.

The architecture is the runtime's `process.arch`, not Rosetta detection. An Intel
build running under translation on an Apple-silicon Mac is still an Intel build,
and moving it to arm64 mid-flight would be a silent architecture change to an app
the user installed on purpose; it keeps receiving Intel updates. A release that
carries a feed document for some other target but none for this one is a healthy
release that shipped nothing for it, and reads as "no update", not as a broken
feed. A release carrying no feed document at all is still a broken feed on macOS.

On Linux the resolver now reads the feed document too, and installs the asset the
document's own `url` names (recovering that asset's GitHub-published digest from
the release's asset list), instead of guessing at a filename suffix.

### The bridge: this release ships the reader, the next ships the second Linux artifact

| Release | Ships |
| --- | --- |
| This one | Bun (0073), the arch-aware updater, **darwin-x64** |
| The next | **linux-arm64**, as `Ensemblr-<version>-linux-arm64.appimage.bin` |

The arm64 AppImage is named so that it does **not** end in `.appimage`. A
shipped linux-x64 client picks the first asset ending in `.appimage` with no
architecture check; an arm64 asset with that suffix would be offered to x64 users
on the next update check, and those clients cannot be patched. Naming it
`.appimage.bin` keeps it invisible to that selection permanently, and the
arch-aware clients find it through their own feed document instead.

The order is the point. The first release that changes the updater must not also
change what a Linux release contains, so that the arch-aware reader is already in
installed clients before there is a second Linux artifact for it to choose
between. darwin-x64 does not need the delay: the only macOS reader that predates
this release reads `update-darwin-arm64.json`, which an Intel-only artifact and
its `update-darwin-x64.json` cannot disturb.

## Consequences

- macOS users on Intel hardware have a supported build starting with the release
  after `0.1.19`; each Mac downloads only its own architecture's code.
- Every feed-name consumer (the updater, both release workflows, the docs) keys
  on `update-<platform>-<arch>.json`. Renaming the shape on one side strands
  clients on their current version, so it is a cross-repo contract in the way
  0054's tag scheme is.
- `scripts/verify-signed-artifacts.mjs`, which used to look only for
  `*-darwin-arm64` output, now takes `--arch=` and verifies exactly that one
  leg — a leg with no artifact of its own fails rather than passing on the other
  leg's output — and additionally asserts with `lipo -archs` that the bundle's
  executable and every loadable native binding are the expected architecture.
  The Homebrew cask has to carry an architecture split so `brew` installs the
  matching build.
- Nothing in Forge or the AppImage maker checks that a packaged native binding
  matches the architecture being packaged, so `forge.config.ts` grew a
  `postPackage` hook that reads each binding's Mach-O `cputype` or ELF
  `e_machine` directly. It reads the header rather than shelling out to `lipo`
  so the same check runs on the Linux legs.
- Adding an architecture to the AppImage means fetching a second AppImage
  runtime, and the maker's default source for one is the mutable `continuous`
  tag with no integrity check at all. `scripts/fetch-appimage-runtime.mjs` pins
  a SHA-256 per architecture and hands the maker a verified local file, so
  growing the target list does not also grow the unreviewed-binary surface.
- The Linux install script and the AppImage updater stay x86-64-only in this
  release; the script still refuses a machine that is not x86-64. Extending them
  to arm64 is part of the next release, together with the `.appimage.bin` asset.
- A future architecture follows the same rules: a target-named feed document, an
  asset name that no shipped client's selection rule can match by accident, and a
  release order in which the reader ships before the artifact it chooses.
- Cost accepted: two macOS artifacts per release instead of one, and a
  cross-build path that has to be verified on the runner, since it cannot be
  exercised natively.
