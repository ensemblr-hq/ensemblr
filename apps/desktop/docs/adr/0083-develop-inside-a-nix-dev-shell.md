# 0083. Develop Inside a Nix Dev Shell

Date: 2026-10-03

## Status

Accepted

Supersedes the toolchain guards of [0073](./0073-move-the-package-manager-from-npm-to-bun.md):
`scripts/with-pinned-node.sh`, `mise.toml`, `.nvmrc`, and the Node-version gate
`scripts/require-node-version.mjs`. What 0073 decided about the package manager
stands: Bun installs and runs scripts, Node 24 is the runtime, `bun.lock` stays at
`lockfileVersion: 1`, `trustedDependencies` is an explicit list, and the linker is
hoisted.

Also retires the Linux toolchain preflight that
[0056](./0056-ship-a-linux-amd64-appimage.md)'s `node-pty` constraint grew
(`scripts/require-linux-toolchain.mjs`, `scripts/rebuild-native-linux.sh`). The
constraint itself, that `node-pty` has no Linux prebuild and compiles against
Electron's ABI, is unchanged.

Builds on [0077](./0077-ship-a-nix-flake-and-stand-the-updater-down-in-the-nix-store.md),
which put `flake.nix` at the repository root.

## Context

Getting a working Node, Bun, and C++ toolchain in front of every script had grown
into three layers of workaround, each repairing what the one before it could not
guarantee:

1. `scripts/with-pinned-node.sh` forced Node 24 to the front of `PATH`, because
   the login-shell `PATH` Ensemblr captures puts mise's Node *on* the path but not
   necessarily *first* (0073).
2. `scripts/require-node-version.mjs` refused a wrong Node major at `preinstall`,
   `dev`, and every build, because a wrong major fails silently.
3. `scripts/require-linux-toolchain.mjs` checked the host for a compiler, read
   `pty.node`'s linkage back with `ldd`, and fell back to compiling `node-pty` in a
   `node:24-bookworm` container through `scripts/rebuild-native-linux.sh`.

On a NixOS host, `bun run dev` failed under all three:

- The container fallback's image pull failed on a stale registry login.
- With rootful docker as the alternative, the build leaves root-owned output in
  `node_modules` that the next install cannot replace.
- The `ldd` portability check refused every binding, because on NixOS every
  library, libc included, resolves into `/nix/store`. It was then relaxed for
  `dev`, which is a fourth special case on top of three layers.
- npm's Electron is a generic-Linux binary, and on NixOS it could not load
  `libglib-2.0.so.0`.

Each fix was local, and each left the next host different. The common cause is
that the repository asked the host to supply the toolchain and then spent code
checking what it got.

## Decision

`nix develop` is the only supported development environment, and every setup and
run script goes through `nix develop -c`.

`flake.nix` gains `devShells.default` for `x86_64-linux`, `aarch64-linux`, and
`aarch64-darwin`, defined in `apps/desktop/nix/dev-shell.nix`. It reads its
versions from the manifests instead of restating them:

- `nodejs_<major>`, the major parsed from the root `engines.node` (`>=24 <25`);
  24.21.0 at the current `flake.lock`.
- `bun` from nixpkgs, 1.4.2 and so equal to `packageManager`; `gnumake` and
  `python3`.
- **On Linux:** gcc through `mkShell`'s stdenv; `squashfs-tools` for `make:linux`;
  `ELECTRON_OVERRIDE_DIST_PATH` pointing at nixpkgs' `electron_<major>`, the major
  parsed from the desktop `devDependencies.electron`; and a `shellHook` that
  unsets `LD_LIBRARY_PATH`. A NixOS host can export one for ALSA and
  PipeWire-JACK built against a newer glibc, which kills Electron with
  `GLIBC_2.43 not found`.
- **On macOS:** `mkShellNoCC`, so the compiler and SDK come from the Xcode Command
  Line Tools. Nix's darwin stdenv exports `SDKROOT` and `DEVELOPER_DIR`, which
  would send `xcrun` to a toolchain without `codesign` or `notarytool`. npm's
  lazily downloaded Electron is used as is.

Forge compiles `node-pty` inside `start` and `package` with the shell's gcc, make,
and python3. The binding links against Nix's glibc and loads in the nixpkgs
Electron.

Intel Macs (`x86_64-darwin`) get no shell, because nixpkgs 26.11 dropped the
platform.

**The guards are deleted and nothing replaces them.** Gone are
`scripts/with-pinned-node.sh`, `mise.toml`, `.nvmrc`,
`scripts/require-node-version.mjs` (and the desktop `preinstall` that ran it),
`scripts/require-linux-toolchain.mjs`, `scripts/rebuild-native-linux.sh` with its
digest-pin test, the `rebuild:native` and `diagnose:linux` scripts, the
`node-abi` devDependency, and the `ENSEMBLR_SKIP_NATIVE_AUTOBUILD`,
`ENSEMBLR_NATIVE_AUTOBUILD`, and `ENSEMBLR_NATIVE_REBUILD_IMAGE` variables. Running
outside the shell is unsupported rather than refused.

**CI splits.** The `lint`, `typecheck`, and `test` jobs in
`.github/workflows/checks.yml` use the new composite `.github/actions/nix-dev-shell`
(install Nix, run `nix develop -c bun ci`) and run each step as `nix develop -c …`.
The action restores `/nix` from the Actions cache through
`nix-community/cache-nix-action`, keyed on the dev shell's derivation hash, so a
warm run skips substituting the roughly 1.8 GiB Linux closure from
cache.nixos.org. Only shard 1 of each OS's `test` leg saves, and nothing purges:
purging needs `actions: write`, which `release.yml`'s call into `checks.yml` does
not grant, so a superseded key expires after seven days unused.
The release and nightly build legs keep `.github/actions/install-dependencies`,
whose `setup-node` now reads `node-version-file: package.json` and whose `setup-bun`
reads `packageManager`. They stay outside Nix so the shipped AppImage's `node-pty`
links the runner's glibc and is portable, and so macOS signing has the runner's
Xcode.

**Unchanged:** `scripts/require-linux-host.mjs`, which refuses `make:linux` off
Linux; `scripts/link-hoisted-packages.mjs` and
`scripts/fix-node-pty-permissions.mjs`; the flake's `packages`, `master`,
`release`, and `overlays`. The rule that `[environment_variables]` never sets
`PATH` also stands, because Ensemblr's login-shell `PATH` resolver is an app
feature for users' repositories and is still switched off by the presence of the
key.

## Alternatives Considered

### Keep the guards

Fix each failure where it showed: refresh the registry login, support rootful
docker, widen the portability check for Nix. Rejected because the failures were not
independent. Every guard encoded an assumption about the host, and the next host
broke a different one. The guards also only *detected* a bad toolchain; none of
them supplied a good one.

### A nix-ld library set with npm's Electron

Leave the toolchain as it was and make npm's Electron run on NixOS by adding the
libraries it needs to `programs.nix-ld.libraries`. Rejected: it fixes NixOS only,
and it needs host configuration that a contributor has to find, apply, and keep in
step with the list `apps/desktop/nix/electron-app.nix` patches the packaged app
against. A new contributor's first `bun run dev` would fail until they edited
their system configuration.

### nixpkgs' Electron, despite the patch skew

The shell points `ELECTRON_OVERRIDE_DIST_PATH` at nixpkgs' Electron rather than the
one Bun installs. nixpkgs' build runs on every Linux and loads the `node-pty`
binding the shell compiled, which npm's does not. The cost is a patch release of
skew, 44.3.0 against the 44.4.5 the lockfile pins at the current `flake.lock`.
Native modules are ABI-bound to the Electron major alone, so the binding is
unaffected, and packaging and release builds still ship the pinned Electron. Chosen
because the skew costs a little fidelity in development and the alternative costs
a working `bun run dev`.

## Consequences

- **Nix is required for development**, with `nix-command flakes` enabled. The
  prerequisites in `README.md`, `CONTRIBUTING.md`, `AGENTS.md`, and the build and
  install guides now start there, and `nix develop -c` is the form every script
  uses.
- **Intel Macs are unsupported for development.** They still receive the shipped
  darwin-x64 build, which CI cross-builds on `macos-15`.
- **CI checks and releases run in different environments.** A check that passes in
  the shell can in principle fail on a release leg's plain runner, and a release
  leg is not covered by the shell's Node and Bun pins beyond `engines.node` and
  `packageManager`, which both actions read.
- **No guard remains.** Nothing refuses a wrong Node major, and nothing inspects
  `pty.node`'s linkage. A local `make:linux` from the shell packs a binding linked
  against Nix's glibc, so that AppImage's terminals work only where the glibc
  exists. Release AppImages come from CI, and the person running a local
  `make:linux` is responsible for knowing what they built.
- **The development Electron trails the pinned one by a patch release** until
  nixpkgs catches up, and `flake.lock` has to move before the shell can follow a
  new Electron major. The shell throws a clear message when nixpkgs has no
  `electron_<major>`.
- **`flake.lock` must keep pace with the NixOS hosts it runs on.** nixpkgs'
  Electron loads GPU drivers from `/run/opengl-driver`, and NixOS builds those
  against the system's glibc. Before the lock was bumped from 2026-09-26 to
  2026-10-01, `dev` printed `MESA-LOADER: … 'GLIBC_2.43' not found` and rendered in
  software on a 2026-10-01 system. A lock newer than the host is fine, one older
  is not. On a Linux that is not NixOS, the host's drivers are not visible to
  nixpkgs' Electron at all, and development renders in software.
- **The dev loop on an immutable-root host is the same as anywhere else**, and
  needs no container, registry login, or `chown`.
