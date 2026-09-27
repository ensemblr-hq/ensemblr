# 0077. Ship a Nix Flake and Stand the Updater Down in the Nix Store

Date: 2026-09-27

## Status

Accepted

Extends [ADR 0076](0076-stand-the-in-app-updater-down-on-a-homebrew-owned-install.md):
a copy Nix installed gets the same treatment as one Homebrew installed. It never
reads the feed, and Settings names how it does update. The feed, the channels,
and the state machine from [ADR 0055](0055-resolve-updates-in-app-against-the-github-releases-api.md)
are unchanged.

## Context

Ensemblr ships a Linux AppImage ([ADR 0056](0056-ship-a-linux-amd64-appimage.md)).
On NixOS it does not run as a loose file, so users wrapped it themselves. The
usual wrapper, `appimageTools.wrapType2`, runs the image inside a bubblewrap FHS
environment. Bubblewrap sets `no_new_privs`, so every process under it inherits
that flag, and those processes include each terminal Ensemblr opens. `sudo` in an
integrated terminal then fails with `The "no new privileges" flag is set`. For a
coding workbench, that rules the wrapper out.

Two further facts shape a Nix package:

- **The source build has to be a real Forge package.** nixpkgs usually runs an
  Electron app's `app.asar` on its shared `electron`. Ensemblr cannot run that
  way. It locates the Pi extensions, the bundled skills, and the window icon
  through `app.isPackaged` and `process.resourcesPath`. Both are wrong under a
  shared `electron`. The Forge fuses would also be missing, because they are
  flipped into the packaged binary.
- **The build sandbox has no network.** Forge downloads the Electron zip.
  `@electron/rebuild` downloads Electron's headers to compile `node-pty`, the one
  native module.

The Nix store is also read-only, and a new version arrives as a new store path.
The in-app updater cannot swap anything there. A check-only offer would show an
"update available" link that points away from how the copy actually updates.

## Decision

**The repository ships a flake with two variants of one app.** Both install as
`ensemblr` with the release identity, so a system carries one or the other:

- **`release` (the default)** is the AppImage a GitHub release ships. Nix unpacks
  it with `appimageTools.extract`, patches every ELF file against nixpkgs
  libraries with `autoPatchelfHook`, and wraps it with the GTK environment. No FHS
  sandbox is involved, so `sudo` works in its terminals.
- **`master`** is compiled from the flake's own commit. It is packaged by
  `electron-forge package` the way CI packages it, then patched the same way. The
  About panel shows `<version>-master.<date>.g<rev>`.

Everything the master build would download comes from one fixed-output
derivation:

- `node_modules`, as `bun install --frozen-lockfile` lays them out;
- the Electron zip and headers that `bun.lock` resolves to.

That derivation has three safeguards:

- **Bun is pinned** to the version `packageManager` names, so the hash does not
  depend on the consumer's nixpkgs.
- **Its name carries a digest of `bun.lock`.** A lockfile change therefore forces
  a fetch and a hash mismatch, and can never silently reuse the old
  `node_modules`.
- **`node-pty` is compiled against Electron's headers before Forge runs.** Its
  build intermediates are then stripped. The `.forge-meta` the compile writes
  makes Forge's own rebuild skip the module. Without that, node-gyp's Makefiles
  would land in `app.asar`, and the paths in them would pull the dependency
  derivation into the installed closure.

`forge.config.ts` passes `ENSEMBLR_ELECTRON_ZIP_DIR` to packager as
`electronZipDir`. It is unset everywhere but the Nix build.

**A copy running from the Nix store is updated by Nix only.** At launch the
updater checks whether the packaged executable lives under `/nix/store/`. If it
does, the copy gets capability `none` with the coded failure
`update-managed-by-nix`, and Settings says to update the flake or channel and
rebuild. The check comes right after the unpackaged-build check and ahead of
every other reason, on any platform, because it is the one that says how this
copy does update.

## Consequences

- **The deps hash goes stale on every `bun.lock` change**, which in practice
  means the weekly Dependabot batch. `nix/update-pins.sh deps` recomputes it. A
  stale hash fails the master build loudly and prints the right one.
- **The release pin moves with each release.** `nix/update-pins.sh release`
  reads the asset digest GitHub publishes and runs in the same PR that re-pins
  the install docs. `nix/pins.json` is one of the version-pinned files.
- **The two variants conflict by design.** Both claim `bin/ensemblr` and
  `ensemblr.desktop`, because both carry the release identity. They share one
  database, as every channel does.
- **The release variant gets the stand-down from the next release on.** The
  AppImage it wraps carries whatever updater that release shipped. For
  0.1.22, that is a check-only updater.
- **Only x86-64 Linux is packaged**, matching the only Linux artifact CI builds.
  An arm64 variant needs a second deps hash and the arm64 AppImage.
- **Runtime libraries follow the consumer's nixpkgs** when the flake input
  `follows` it. Bun is pinned for exactly that reason. The library list mirrors
  `electronLibPath` in nixpkgs' Electron derivation and has to follow it when
  Electron grows a dependency.
