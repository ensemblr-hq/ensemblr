# Build & Release

Ensemblr packages through Electron Forge as architecture-specific artifacts
rather than a universal binary: **macOS arm64** and **macOS x64**, where a
release build is code-signed with a hardened runtime, notarized, and shipped as
both a `.dmg` and a `.zip`; and **Linux x86-64**, shipped as an unsigned
`.AppImage`. The current release workflow does not build Linux arm64. This guide
covers the build matrix, signing, and the build channels. The packaging config
lives in `forge.config.ts`. See
[ADR 0056](./adr/0056-ship-a-linux-amd64-appimage.md) for why AppImage, and what
changes off darwin, and
[ADR 0074](./adr/0074-ship-four-build-targets-and-select-updates-by-architecture.md)
for the four-target matrix, why it is per-architecture, and how the release
sequence is ordered.

| Target | Artifact | Built on | Status |
| --- | --- | --- | --- |
| macOS arm64 | `.dmg` + `.zip` | `macos-15` (native) | shipping |
| macOS x64 | `.dmg` + `.zip` | `macos-15` (cross-built) | shipping (since 0.1.20) |
| Linux x86-64 | `.AppImage` | `ubuntu-latest` | shipping |
| Linux arm64 | — | — | not built by the current release workflow |

## Prerequisites

- **macOS** for the `.dmg`/`.zip`; **Linux** for the `.AppImage`. Neither host
  cross-builds the other's artifact, which is why CI runs them as separate jobs.
  Within macOS the architecture *is* cross-buildable — an Apple-silicon host
  builds the Intel `.dmg`/`.zip` — because Forge passes the target arch down to
  `@electron/rebuild`, and Xcode's clang targets `x86_64` from an arm64 host.
  Verified: packaging `--arch=x64` on Apple silicon produces an
  `out/Ensemblr-darwin-x64` whose executable *and* whose compiled
  `node-pty/build/Release/pty.node` both report `x86_64` under `lipo -archs`.
  (`node-pty` also ships `prebuilds/darwin-x64`, but that is not what the
  packaged app loads — the rebuilt binding is.)
- **Nix with flakes enabled** (`experimental-features = nix-command flakes`).
  `nix develop` enters the flake's dev shell, which supplies **Bun 1.4**
  (`packageManager` is `bun@1.4.2`), **Node `>=24 <25`**, and on Linux the C++
  toolchain and `mksquashfs` — see [Bun and Node](#bun-and-node) and
  [The dev shell](#the-dev-shell). Every command in this guide runs inside it,
  either in an interactive `nix develop` or as `nix develop -c <command>`. Intel
  Macs get no shell, because nixpkgs 26.11 dropped `x86_64-darwin`.
- **`mksquashfs`** for the Linux build. The dev shell provides it
  (`squashfs-tools`); the AppImage maker declares it as a required external
  binary and refuses to run without it. CI installs it on the runner.
- **An authenticated `gh`** — the whole release ritual is `gh release create`,
  and a nightly is dispatched with `gh workflow run`. The runner ships `gh`
  preinstalled, so the workflow's own `gh api` calls — the Homebrew cask bump
  among them — need no install step.
- For a **signed, notarized** build:
  - A **Developer ID Application** certificate in your login keychain.
  - An **App Store Connect API key**, supplied via environment variables (a
    local `.env` is loaded automatically):
    - `APPLE_API_KEY_PATH` — path to the `.p8` key file
    - `APPLE_API_KEY_ID` — the key id
    - `APPLE_API_ISSUER` — the issuer id

Signing entitlements are in `entitlements.plist` (hardened runtime).

## Commands

These run from `apps/desktop/`, the desktop app's directory in the monorepo; from
the repository root, prefix each with `bun run --cwd apps/desktop`. Paths in this
document are relative to `apps/desktop/` unless they name a repository-root file
(`bun.lock`, `bunfig.toml`, `flake.nix`, `.github/`, `.ensemblr/settings.toml`,
`scripts/check-lockfile-version.mjs`).

```bash
bun run dev            # run the app in development (electron-forge start)

bun run package        # build an unpacked .app under out/ (host architecture)
bun run make           # build distributables (.dmg + .zip) under out/make/
bun run verify:signing # assert what make just produced is signed and notarized

bun run package:linux  # build an unpacked Linux directory under out/ (host architecture)
bun run make:linux     # build the .AppImage under out/make/
```

The Linux artifact is never signed, notarized, or stapled — there is no
equivalent to do — so `verify:signing` is not run against it.
`scripts/verify-signed-artifacts.mjs` looks only for `*-darwin-<arch>` output
and would report the Linux build as missing.

It verifies **one architecture per run**, named by `--arch=` and defaulting to
the host's, because a release leg builds one architecture at a time: a leg that
produced nothing for its own architecture has to fail here rather than pass on
the other leg's leftovers in `out/`. Beyond the signature, notarization and
stapling checks it runs `lipo -archs` over the bundle's executable and every
native binding the app could load, so an Intel leg that packaged an arm64
binding is caught — a signed, notarized, stapled DMG says nothing about what is
inside it. Prebuild directories for other targets ship alongside and are
skipped, since only the binding the app would actually load is evidence.

**No script hardcodes an architecture.** `build`, `package`, `make`,
`make:linux`, and `package:linux` used to carry `--arch=arm64` or `--arch=x64`;
they now omit it, so Forge builds for the **host** architecture. Anything that
needs a specific one passes it explicitly — CI does, for every leg, and a local
cross-build does too:

```bash
bun run make --arch=x64   # Intel .dmg/.zip from an Apple-silicon Mac
```

No `--` separator: unlike npm, Bun appends a run script's arguments directly,
and it appends them to the **last** command in a `&&` chain — which is
`electron-forge` in every one of these scripts, so the flag lands where it is
meant to. A preflight earlier in the same chain does *not* see it, which is why
`scripts/fetch-appimage-runtime.mjs` reads `ENSEMBLR_TARGET_ARCH` instead.

Before this change a bare `npm run make` on an Intel Mac silently produced an
arm64 bundle.

### The AppImage runtime is pinned

`@reforged/maker-appimage` defaults its runtime to `runtime-<arch>` from the
AppImage project's **mutable** `continuous` tag, and accepts whatever comes back
with an HTTP 200 despite a comment in its types claiming the download is
checksum-verified. That put an unreviewed third-party binary at the front of
every AppImage this project shipped.

`scripts/fetch-appimage-runtime.mjs` now runs inside the `make:linux` chain,
downloads the runtime for the target architecture, and checks it against a
SHA-256 pinned in that script — plus its ELF `e_machine`, which names the
failure when a mirror serves the wrong architecture under the right name. It
caches into the gitignored `.appimage-runtime/` and records the verified path in
`.appimage-runtime/resolved.json`, which `forge.config.ts` hands to the maker so
the maker reads the local file instead of reaching for the network. Refreshing a
runtime means downloading it, reviewing what moved upstream, and updating the
digest in the same commit.

### The Linux build has to run on Linux

Both Linux scripts refuse on any other host, through
`scripts/require-linux-host.mjs`. The refusal is not conservatism: Forge
cross-packages nearly everything from macOS — it downloads the linux-x64
Electron, and the shell it produces really is an ELF binary — but it cannot
build a **native module** for a foreign platform. `node-pty` publishes prebuilds
for darwin and win32 only, so Linux compiles it from source, and
`@electron/rebuild` on a Mac has no toolchain to do that with.

It does not fail. It reports `Preparing native dependencies: 1 / 1` and packages
the Mach-O `pty.node` already sitting in `node_modules`. The AppImage builds,
launches, and has a dead terminal in every tab — silent breakage, discovered a
release later.

Three ways to get one:

1. **CI.** Push the tag; `build-linux` in `release.yml` builds and attaches it.
2. **A container**, to iterate locally on a portable build. It runs outside the
   dev shell on purpose: its `node-pty` links the container's glibc, not Nix's.
   Under emulation on Apple silicon this is slow but correct:

   From the repository root, so the container sees the whole monorepo install:

   ```bash
   docker run --rm -it --platform=linux/amd64 \
     -v "$PWD":/src -w /src node:24-bookworm \
     bash -c 'apt-get update && apt-get install -y squashfs-tools unzip \
       && curl -fsSL https://bun.sh/install | bash \
       && export PATH="$HOME/.bun/bin:$PATH" \
       && bun ci && bun run --cwd apps/desktop make:linux'
   ```

   `node:24-bookworm` ships Node and npm but not Bun, so the command installs
   Bun first (the installer needs `unzip`). `bun ci` reinstalls `node_modules`
   from the lockfile, and that is the point: the host tree holds darwin binaries
   for every native module, and the reinstall inside the container replaces them
   with Linux ones. It also means the host repo comes back with Linux binaries in
   `node_modules` — run `bun ci` again on the Mac before building there.
3. **`ENSEMBLR_ALLOW_CROSS_PLATFORM_LINUX_BUILD=1`**, which downgrades the
   refusal to a warning. It exercises the packaging plumbing — the maker, the
   `.desktop` file, the icons — on a Mac. It must never ship: terminals in the
   result do not work.

### Developing on Linux

Enter the dev shell and run `bun run dev`. That is the whole procedure on every
Linux host, NixOS included, and on a host with no compiler at all — which on
Linux is a larger share than it sounds, since every immutable distribution
(SteamOS, Silverblue, NixOS) ships without one. The shell brings its own `gcc`,
`make`, and `python3`, so there is nothing to install on the host but Nix.

```bash
nix develop            # an interactive shell with Node 24, Bun, gcc, make, python3
bun ci
cd apps/desktop
bun run dev
```

`nix develop -c bun run dev` does the same without entering the shell, and it
works from `apps/desktop/` too, because Nix searches upward for `flake.nix`.
Nothing runs ahead of `dev`, `package:linux`, or `make:linux` to check the Node
major or the host's toolchain. Running outside the shell is unsupported rather
than refused, and what you get there is whatever your host happens to have.

**`node-pty` is the only thing that compiles, and Forge compiles it.** It
publishes prebuilds for darwin and win32 only, so on Linux there is nothing to
download. `node-pty` is deliberately **not** in `package.json`'s
`trustedDependencies`, so `bun install` never runs its `install` script — the
`node-gyp rebuild` against *Node's* ABI does not happen at all. That leaves the
one build that matters: Forge rebuilds it against Electron's ABI inside `start`
and `package`, using the shell's compiler. The binding links against Nix's
glibc.

**The shell supplies Electron too, on Linux.** `ELECTRON_OVERRIDE_DIST_PATH`
points at nixpkgs' `electron_44`, because the Electron that Bun installs is a
generic-Linux binary: on NixOS it cannot find its libraries (it dies on
`libglib-2.0.so.0`), and on any Linux it would run against the host's glibc while
`node-pty` was linked against Nix's. nixpkgs' build runs everywhere and loads
that binding. It is a patch release behind the pinned one — 44.3.0 against 44.4.5
at the current `flake.lock` — which does not matter for native modules, since
they are ABI-bound to the major. Packaging and release builds still ship the
pinned Electron. On macOS nothing is overridden and the lazily downloaded
Electron is used as is.

**The shell clears `LD_LIBRARY_PATH`.** A NixOS host can export one for ALSA and
PipeWire's JACK shim, built against a newer glibc than Nix's, and a library from
a newer glibc kills Electron at load with `GLIBC_2.43 not found`. A shell that
leaves it set cannot start the app.

**Keep `flake.lock` no older than your NixOS system.** Electron loads its GPU
drivers from `/run/opengl-driver`, which NixOS builds against the system's
glibc. When the flake's nixpkgs is older, that glibc is too, and the GPU process
dies with `MESA-LOADER: failed to open dri: … version 'GLIBC_2.43' not found`.
The window still opens, but everything renders in software, including the
terminal's WebGL renderer. `nix flake update nixpkgs` fixes it; a newer lock
than the system is fine. On a Linux that is not NixOS, nixpkgs' Electron cannot
see the host's drivers at all and always renders in software.

**A local AppImage is for testing only.** `make:linux` from the shell packs a
`node-pty` linked against Nix's glibc, so the terminals in that AppImage work
only on a machine where that glibc exists. Release AppImages come from CI, which
builds outside Nix (see [The dev shell](#the-dev-shell)). If you need a portable
build by hand, use the container recipe in *The Linux build has to run on Linux*.

**Do not try to run the app in a container.** Electron needs the whole Chromium
runtime — a bare `debian:bookworm` gets as far as
`error while loading shared libraries: libnspr4.so` — plus the session's Wayland
socket and GPU nodes. A container is for the compile only; the app runs on the
host, in the shell.

### Building and verifying on a Steam Deck

The Deck is the reference Linux host: Wayland, KDE Plasma, fractional scaling, a
battery, an immutable root, and no package manager to speak of. Everything below
assumes **Desktop Mode**.

**Toolchain.** One thing is needed: Nix with flakes enabled, installed in a way
that survives a SteamOS update, which restores the read-only root. Everything
else — Node 24, Bun, a compiler, `mksquashfs`, and Electron — comes from the dev
shell, so none of it touches the root filesystem and no sudo password is needed
for it.

**Build.** Budget ~2 GB for `node_modules` plus the Electron closure.

```bash
git clone https://github.com/ensemblr-hq/ensemblr.git && cd ensemblr
nix develop             # Node 24, Bun, gcc, make, python3, squashfs-tools

bun ci                  # installs the tree; node-pty's install script is deliberately not run

cd apps/desktop
bun run dev             # the dev loop; Forge builds node-pty with the shell's gcc

bun run package:linux   # unpacked build — needs no mksquashfs
./out/Ensemblr-linux-x64/Ensemblr
```

Run `package:linux` before `make:linux`. It exercises everything in the
checklist below except the AppImage wrapper itself, needs no `mksquashfs`, and
skips the SquashFS pass on every iteration. Once it behaves:

```bash
bun run make:linux
chmod +x out/make/AppImage/x64/*.AppImage
./out/make/AppImage/x64/*.AppImage
```

That AppImage carries a `node-pty` linked against Nix's glibc, which the Deck
does not have, so its terminals will not work there. Use it to check the
wrapper — the `.desktop` file, the icons, startup — and take the artifact for
terminals from a release or nightly built in CI.

If the app dies at startup with a sandbox error, the kernel is refusing
unprivileged user namespaces — an AppImage is a FUSE mount and cannot carry a
setuid `chrome-sandbox`. Re-run with `--no-sandbox` to confirm that is the
cause. If the runtime refuses to mount at all, `--appimage-extract-and-run`.

**What to check.** These are the things CI structurally cannot prove:

| # | Check | Looking for |
| --- | --- | --- |
| 1 | `echo $XDG_SESSION_TYPE`, then `xlsclients` | `wayland`, and Ensemblr *absent* from the X client list |
| 2 | The three window controls, top right | Minimize, maximize, restore and close each do what they say |
| 3 | Close with an agent mid-turn | The quit confirmation still appears |
| 4 | Drag the toolbar strip; double-click it | Moves the window; toggles maximize |
| 5 | Resize from every edge and corner | If edges are dead, that is the finding — `system` mode is the answer |
| 6 | Maximize from Plasma's own keyboard shortcut | Our icon flips — proves the broadcast, not just the click path |
| 7 | Settings → Appearance → Title bar → System, then Relaunch | A normally decorated window, zero inset. Flip back |
| 8 | Display scaling at 125% and 150% | Window still fits the 1280×800 panel; sidebar collapses; nothing clipped |
| 9 | Save a dictation API key, reopen Settings | Round-trips. Setup check reports `kwallet5`/`kwallet6` |
| 10 | Stop the wallet daemon, retry the check | Degrades to `basic_text` and **warns** rather than crashing |
| 11 | Put `pi` or `claude` in `~/.local/bin` | Executable discovery finds it — the Deck is the sharpest test that discovery is not Homebrew-shaped |
| 12 | Open a terminal tab; run a workspace script | node-pty actually loaded |
| 13 | The "Open in…" menu | Lists only what is installed — Konsole, Dolphin, any editor — and launches it |
| 14 | The menu bar | Carries Settings and Check for Updates, reachable from a frameless window; hints read `Ctrl+…`, never `⌘…` |
| 15 | Settings → General → Check for updates | A packaged stable/canary AppImage in a writable directory offers download and restart; an unpacked build or AppImage in a non-writable directory links to the release instead |
| 16 | Unplug it, run a long agent turn | The power-save blocker releases at the low-battery threshold |
| 17 | `--ozone-platform=x11` | Still starts (the documented XWayland escape hatch) |
| 18 | Let a background chat finish a turn | A desktop notification appears, and the in-app chime plays |
| 19 | Click that notification | The window raises and opens *that* chat, crossing workspaces if needed |

Rows 18 and 19 are separate on purpose. Electron posts Linux notifications over
`org.freedesktop.Notifications`, and every daemon implements the `Notify` call —
so a notification appearing proves very little. The **click** is what varies:
Electron only attaches its default action when the daemon advertises the
`actions` capability, and a daemon that has it still has to bind a mouse button
to invoking it. KDE's daemon, which is what the Deck runs, does both. A
wlroots-compositor daemon like **mako** is the case worth checking separately —
it supports actions, but whether a left click invokes the default one is
configuration (`on-button-left=invoke-default-action`), not a given.

Ask the daemon directly before blaming the app:

```bash
gdbus call --session \
  --dest org.freedesktop.Notifications \
  --object-path /org/freedesktop/Notifications \
  --method org.freedesktop.Notifications.GetCapabilities
```

No `actions` in that list means clicking a notification cannot work, whatever
Ensemblr does. The chime is unaffected either way: it is `new Audio()` in the
renderer, and the notification itself is posted `silent` so no daemon ever
plays a second tone over it.

`bun run build` is an alias for `bun run package`.

`make` and `package` cover the common cases; the channel/skip variants below
wrap them with environment variables:

| Script | Channel | Signed? | Notes |
| --- | --- | --- | --- |
| `bun run make` | release | yes¹ | The shipping build (`dev.ensemblr.app` / "Ensemblr"). |
| `bun run make:canary` | canary | yes¹ | Dogfood build with its own identity. |
| `bun run make:dev` | dev | yes¹ | Dogfood build with its own identity. |
| `bun run make:unsigned` | release | no | `ENSEMBLR_SKIP_SIGN=1` — skip signing/notarization. |
| `bun run package:dev` | dev | — | Unpacked `.app`, dev channel. |
| `bun run package:unsigned` | release | no | Unpacked `.app`, signing skipped. |

¹ Signed and notarized **only** when the Apple credentials above are present and
`ENSEMBLR_SKIP_SIGN` is not set; otherwise the same command produces an
unsigned build instead of failing — set `ENSEMBLR_REQUIRE_SIGN=1` to turn that
into an error (see below).

## Bun and Node

Bun is the package manager and script runner. **Node 24 is still the runtime**:
every `node scripts/*.mjs` in `package.json`, Vite, Forge, Vitest, and the
`electron --test` suites run on it. Bun does **not** shim itself as `node` — in
both `bun run <script>` and `postinstall`, `node` resolves to the real Node on
PATH and `process.versions.bun` is `undefined`. Both come from the dev shell (see
[The dev shell](#the-dev-shell)): `nodejs_24` and nixpkgs' `bun`, at the version
`packageManager` names. The desktop workspace's `postinstall` runs on every
`bun install` and `bun ci`. Bun itself runs a workspace's lifecycle scripts only
when it first installs that workspace, so the root `package.json`'s
`preinstall` and `postinstall` run every workspace's on each install (a first
install runs them twice; both are idempotent). The desktop workspace has no
`preinstall` of its own: nothing checks the Node major at install time any more.

### The monorepo layout

The repository is a Bun workspaces monorepo and this app is the `apps/desktop`
workspace. The root `package.json`, `bun.lock`, and `bunfig.toml` drive the one
install for every workspace, and Bun's hoisted linker puts this app's
dependencies in the **root** `node_modules`. `bun install` and `bun ci` work from
the root or from here.

Two tools refuse to look above this directory. Electron Forge finds Electron at
`apps/desktop/node_modules/electron` — its fallback climbs to an ancestor only
when it finds an npm, yarn or pnpm lockfile, never `bun.lock` — and
`@electron/packager` copies the app directory and nothing above it, so the
`PACKAGE_KEEP_*` packages would be missing from every package. The workspace
`postinstall` runs `scripts/link-hoisted-packages.mjs`, which links Electron and
those packages into `apps/desktop/node_modules`; `forge.config.ts` sets
`derefSymlinks: true` so the package carries the real files, and `prune: false`
because packager's pruning walker climbs two directories at a time and steps
over the root's `node_modules` (it had nothing to remove anyway). A script that
needs an installed package's files goes through `scripts/installed-packages.mjs`
rather than building a `node_modules/<name>` path from here.

Bun reads `trustedDependencies` and `overrides` from the root manifest only, so
both live in the root `package.json`.

### Install behaviour

- **`bun ci`** is the frozen install (`bun install --frozen-lockfile`): it fails
  rather than rewrite `bun.lock`. It is what the workspace setup script and CI
  run. **`bun install`** may update the lockfile.
- **Why it is fast.** `.ensemblr/settings.toml` runs setup once per workspace, and
  every workspace is its own git worktree, so each used to extract 845 packages
  into a fresh ~1.1 GB `node_modules`. Bun's global cache, with APFS clonefile
  and hardlinks, turns that into metadata operations: measured on the
  development machine, `bun install` into an absent `node_modules` with a warm
  cache took **7.1 s** against the ~26–40 s `npm ci` baseline, and `bun ci` warm
  took **0.2 s**.
- **`bun test` is Bun's own test runner, not Vitest.** Use `bun run test` (and
  `bunx vitest run <file>` for one file). See the Testing Policy in `AGENTS.md`.

### `trustedDependencies`

Bun does not run a dependency's lifecycle scripts unless the package is trusted.
The root `package.json` lists `esbuild`, `fs-xattr`, and `macos-alias`. An explicit list
**replaces** Bun's built-in allowlist rather than extending it, so the list is the
complete set of packages whose install scripts run.

**`node-pty` is deliberately excluded.** On macOS it uses the `prebuilds/darwin-arm64`
and `prebuilds/darwin-x64` it ships, and nothing needs to run. On Linux there is no
prebuild, and the binding has to come from Forge's `@electron/rebuild` against
*Electron's* ABI. If Bun ran node-pty's install script on Linux it would compile
against *Node's* ABI instead, and the binding would fail to load in Electron. The
three scripts that stay blocked are `node-pty`, `@swc/core`,
and `core-js-pure`, which are exactly the entries npm's old `allowScripts: false`
listed.

**Never run `bun pm trust --all` in this repository.** It would add `node-pty` and
undo the above. `bun pm untrusted` lists what is currently blocked.

### The lockfile is pinned to version 1

`bun.lock` is at `lockfileVersion: 1` and has to stay there. Dependabot-core's Bun
parser sets `MAX_SUPPORTED_LOCKFILE_VERSION = 1` and *raises* on anything higher,
so a version-2 lockfile stops dependency PRs arriving without any error in this
repository. Bun 1.4 raised its own default stamp to 2, so a lockfile regenerated
from scratch under Bun 1.4 is one Dependabot cannot read.
`bun run check:lockfile` (part of `bun run check`) fails on a wrong version and on
a stray binary `bun.lockb`; `bunfig.toml` sets `saveTextLockfile = true` so the
binary form is never written.

How the current file was produced matters, because the obvious route is a trap.
A plain `bun install` with no lockfile silently re-resolves the whole graph — in
the migration it moved 211 packages, including `electron` 44.3.0 → 44.4.3 and
`lucide-react` 1.43.0 → 1.47.0, and the `lucide-react` move broke a test. The
sequence that preserved the npm graph exactly (all 1250 packages resolve to the
versions `package-lock.json` pinned) was:

1. `bun pm migrate` under **Bun 1.4.2**. Bun 1.3.13 fails with
   `InvalidNPMLockfile` on the npm v3 lockfile, so 1.4.2 is the only version that
   can read it.
2. That writes `lockfileVersion: 2`. Stamp it back to `1` by hand.
3. Run `bun install` under **Bun 1.3.13**, which understands only version 1. It
   loading the file is what proves the downgrade is valid, and it rewrites the
   file natively in v1.

Every later install preserves the version it loaded, under either Bun. The pin is
temporary: raise `SUPPORTED_LOCKFILE_VERSION` in `scripts/check-lockfile-version.mjs`
in the same change that regenerates the lockfile once dependabot-core moves.

### The dev shell

`nix develop` is the only supported development environment, and every setup and
run script in `.ensemblr/settings.toml` goes through `nix develop -c`. The shell
is `devShells.default` in `flake.nix`, defined in `nix/dev-shell.nix`, for
`x86_64-linux`, `aarch64-linux`, and `aarch64-darwin`. It needs Nix with
`nix-command flakes` enabled. Run `nix develop` from anywhere in the tree; Nix
searches upward for `flake.nix`.

What it provides, with every version read from a manifest rather than restated:

- **Node**, `nodejs_<major>`, with the major parsed from the root
  `engines.node` (`>=24 <25`). That is 24.21.0 at the current `flake.lock`.
- **Bun** from nixpkgs (1.4.2, matching `packageManager`), plus `gnumake` and
  `python3`.
- **On Linux:** gcc through `mkShell`'s stdenv; `squashfs-tools` for
  `make:linux`; `ELECTRON_OVERRIDE_DIST_PATH` pointing at nixpkgs'
  `electron_<major>`, the major parsed from the desktop `devDependencies.electron`
  (44.3.0 at the current lock, against the 44.4.5 that packaging and releases
  ship; native modules are ABI-bound to the major alone); and a `shellHook` that
  unsets `LD_LIBRARY_PATH`.
- **On macOS:** `mkShellNoCC`, so the compiler and SDK come from the Xcode
  Command Line Tools. Nix's darwin stdenv exports `SDKROOT` and `DEVELOPER_DIR`,
  which would point `xcrun` at a toolchain without `codesign` or `notarytool`.

**Why a shell and not guards.** The toolchain used to be assembled from three
layers of workarounds — a version gate, a toolchain preflight with a container
fallback, and a wrapper that forced Node 24 to the front of `PATH` — each
repairing what the one before it could not guarantee. On a NixOS host `bun run
dev` still failed under all three, and the shell replaced them. The reasoning is
in [ADR 0083](./adr/0083-develop-inside-a-nix-dev-shell.md).

**Nothing replaces the guards.** There is no Node-version gate and no portability
check on `pty.node` any more. A command run outside the shell is unsupported, and
a `make:linux` built locally is the developer's to vet: its terminals only work
where Nix's glibc exists, so release AppImages come from CI.

**CI splits on purpose.** The `lint`, `typecheck`, and `test` jobs in
`.github/workflows/checks.yml` use the composite `.github/actions/nix-dev-shell`,
which installs Nix and runs `nix develop -c bun ci`; each step then runs as
`nix develop -c …`. The shell's closure substitutes from cache.nixos.org on every
run. There is no Actions cache of `/nix`: `nix-community/cache-nix-action`
checkpoints the store database on restore, and that checkpoint intermittently
failed with "database is locked", failing whole jobs before any check ran
(THE-231). The release and nightly build legs keep
`.github/actions/install-dependencies` and stay outside Nix: `setup-node` reads
`engines.node` through `node-version-file: package.json` and `setup-bun` reads
`packageManager`. They stay outside so the shipped AppImage's `node-pty` links the
runner's glibc and is portable, and so macOS signing finds the runner's Xcode.

**Never set `PATH` in `[environment_variables]`.** Ensemblr resolves a login-shell
`PATH` for a workspace directory only when `!('PATH' in env)` — the presence of
the *key*, not its truthiness — so any `PATH` entry silently switches it off. The
resolver is an app feature for users' repositories; this repository's own scripts
no longer depend on it, because the shell puts the pinned tools first itself.

## Signing & notarization

Signing/notarization is gated on `notarizationEnabled` — true only on macOS when
all three Apple credentials are present and signing was not skipped. When it is:

- The packager signs each file with the `entitlements.plist` entitlements and a
  hardened runtime, then notarizes the `.app` (`osxSign` / `osxNotarize`).
- A `postMake` hook signs, notarizes and staples **each `.dmg`** separately
  (`codesign --sign "$APPLE_SIGNING_IDENTITY" --timestamp`, then
  `xcrun notarytool submit --wait` and `xcrun stapler staple`), because the DMG
  container is an artifact Apple never saw during packaging. Stapling lets
  Gatekeeper validate the disk image offline on first open.

  **The `codesign` step is load-bearing and was missing until `v0.1.0-beta.6`.**
  Stapling a ticket to an *unsigned* disk image leaves Gatekeeper nothing to
  assess: `spctl` reports `no usable signature` on every assessment type no
  matter how many times the image is notarized, and `stapler validate` passes
  anyway, so the gap is invisible without an explicit check. Signed first, the
  same image reports `accepted / source=Notarized Developer ID`.

  `APPLE_SIGNING_IDENTITY` defaults to the prefix `Developer ID Application`,
  which `codesign` resolves by name as long as the keychain holds exactly one
  such certificate. Set it explicitly on a machine holding several.

Set **`ENSEMBLR_SKIP_SIGN=1`** to force an unsigned, un-notarized build even when
credentials are present — useful for fast local iteration that skips the
signing/notarization cost.

Set **`ENSEMBLR_REQUIRE_SIGN=1`** for the opposite: a build that is only worth
producing signed. The gate above fails *open* — a missing credential yields an
unsigned `.app` and exit code 0 — so a release that would ship unsigned is
otherwise indistinguishable from one that would not until someone runs
Gatekeeper against it. With this set, `forge.config.ts` throws before packaging
and names the prerequisite it lacked. Both CI workflows set it.

**`bun run verify:signing`** (`scripts/verify-signed-artifacts.mjs`) is the
matching check on the artifacts themselves: it walks `out/` and asserts every
`.app` carries a *Developer ID Application* signature (not an ad-hoc one),
passes `spctl`, and has a stapled ticket — and the same for each `.dmg`. Each
`.zip` is extracted with `ditto` and the `.app` inside it checked the same way,
rather than assuming the zip maker captured the bundle already verified under
`out/`. An empty `out/` fails, so a skipped build never reads as a pass. Run it
after `bun run make`; both workflows run it before publishing anything.

The `codesign` authority assertion is the load-bearing one, and it is applied to
the `.dmg` as well as the `.app` on purpose: `stapler validate` passes on an
unsigned image (see above) and `spctl --assess` exits 0 on *anything* once
Gatekeeper assessments are disabled, so neither can be the only check standing
between a broken container and a release.

The app is additionally hardened via Electron Fuses (run-as-node disabled, cookie
encryption on, ASAR integrity validation, load-only-from-ASAR).

## Build channels

The **channel** (`ENSEMBLR_BUILD_CHANNEL`, default `release`) scopes both the
bundle id and product name so dogfood builds never collide with the release's
macOS Launch Services registration:

| Channel | Bundle id | Product name | Linux launcher id |
| --- | --- | --- | --- |
| `release` | `dev.ensemblr.app` | Ensemblr | `ensemblr` |
| `canary` | `dev.ensemblr.app.canary` | Ensemblr Canary | `ensemblr-canary` |
| `dev` | `dev.ensemblr.app.dev` | Ensemblr Dev | `ensemblr-dev` |

Only the shipped release claims the canonical id. Sharing one id across multiple
installed builds is what caused a stray Dock tile to flash during workspace
creation — see [ADR 0032](./adr/0032-channel-scoped-bundle-identity.md) (and
[ADR 0031](./adr/0031-strip-launch-context-env-and-single-instance-lock.md) for
the env-strip + single-instance lock that closed the other path).

**A packaged dogfood channel is the same install wearing a different name.** The
identity is per-channel; the *state* is not. All three read one SQLite database
(`~/Library/Application Support/dev.ensemblr.app/ensemblr.db`, keyed on the
bundle id constant rather than the product name) and one
`~/.config/ensemblr/config.json`, and `resolveUserDataDirectory` in
`src/main/app/user-data-location.ts` pins Electron's `userData` to the release's
directory for every packaged build so the localStorage-backed recents, workspace
selection and per-repo overrides come along too. On Linux that pin is implicit:
`userData` is `~/.config/ensemblr/electron`, derived from a config directory
that never carried the channel name in the first place. That also puts the channels behind one single-instance lock, which is
the correct reading given they share a database file — launching Canary while
Ensemblr is running folds into the running instance rather than opening a second
writer. The unpackaged `electron-forge start` build is the exception and keeps
its isolated `Ensemblr (DEV)` state.

### The Linux launcher id is the window's identity

The launcher id above is the basename of the `.desktop` file the AppImage
installs, and Electron turns it into the **XDG application id** on Wayland and
**`WM_CLASS`** on X11. Three places have to agree on it or the desktop cannot
pair a running window with its entry, and draws a generic icon instead:

- `APP_LINUX_APP_IDS` in `src/shared/build-channel.ts` — the table.
- `desktopName` on the AppImage maker in `forge.config.ts` — names the file.
- `app.setDesktopName` via `applyLinuxDesktopIdentity()` in
  `src/main/app/linux-desktop-identity.ts` — claims it before `ready`.

Without the third, Electron guesses a name off the executable —
`Ensemblr Canary`, space and all — which matches no installed entry. It is also
the handle a window manager keys its own rules on, so it stays stable and
per-channel rather than following the product name.

### The icon ladder

`bun run icon:generate` writes `assets/icons/icon-<size>.png` for every size the
freedesktop `hicolor` theme declares in its `index.theme`, and the AppImage
installs each under `usr/share/icons/hicolor/<size>x<size>/apps/`. Two
constraints are easy to get wrong and both end in a generic icon:

- **The size directory has to be one `hicolor` declares.** GTK and Qt only look
  inside the theme's listed sizes, so the obvious `1024x1024` — the macOS master
  — is never read.
- **`.DirIcon` has to be a raster.** `assets/icon.svg` clips its artwork with
  `clipPath`, which Qt's SVG renderer does not implement, so KDE draws the
  scalable icon unclipped or not at all. The maker prefers `scalable` when it is
  offered, so the AppImage icon set deliberately omits it and marks `512x512`
  as the default.

The same directory ships as a packaged resource, and the main process hands the
512px PNG to `BrowserWindow` as its `icon`. That is the only icon an AppImage
the user never integrated into a launcher can show at all — there is no
installed `.desktop` file to look one up in. `tests/main/forge-linux-maker.test.ts`
holds the icon set to both constraints.

## Outputs

`bun run make` writes to `out/make/`:

- **`.dmg`** (ULFO format) — the primary distributable.
- **`.zip`** — a zipped `.app` for auto-update / direct download.

`bun run package` writes the unpacked `.app` to `out/`.

A third artifact exists only on the release, not in `out/`: both workflows write
one **`update-<platform>-<arch>.json`** per target — `update-darwin-arm64.json`
and `update-darwin-x64.json` beside each `.zip`, `update-linux-x64.json` beside
the AppImage — and attach it. See
[The update feed document](#the-update-feed-document) below.

**An empty `out/` has two unrelated causes and they look alike.** The Node-major
one is silent — exit 0, no error. The other is the Electron download: Forge
reaches `@electron/get` **v3** through `@electron/packager`, which fetches
`SHASUMS256.txt` over `got@11` before the zip, and a reset or server-side 5xx on
either request stops the build there. `electron`'s own postinstall is not
affected — it uses `@electron/get` **v5**, which downloads over native `fetch` —
so `bun install` can succeed on a network where `bun run make` does not. It is
transient and the download is cached, so retrying usually clears it. See
[Troubleshooting](./guide/14-troubleshooting.md#make-dies-downloading-electron-shasums256txt-or-http-5xx).

## Releasing

Releases are built by GitHub Actions, not on a laptop: macOS artifacts — both
architectures — on the pinned `macos-15` runner (the Intel build is cross-built
there, with `--arch` passed explicitly) and the Linux AppImage on
`ubuntu-latest`. The local
`bun run make` route above stays the escape hatch when CI is down or you need to
bisect a packaging break.

### Cutting a release

**Merge the version bump, write the notes, then create the release.** The order
is load-bearing: the workflow refuses a tag whose version does not match
`package.json`, and the tag must point at reviewed `master`, not at the release
workspace's unmerged commit.

1. On a branch cut from current `origin/master`, run
   `nix develop -c bun pm version <version> --no-git-tag-version` in `apps/desktop/`,
   replacing `<version>` with the exact version being cut, then
   `nix develop -c bun install` from the repository root (the shell is the only
   supported toolchain, and an agent's own shell does not start inside it).
   Commit `apps/desktop/package.json` and `bun.lock`: the lockfile records every
   workspace's version, so the bump moves that one line and nothing else
   (`bun ci` tolerates the stale line, but the next plain `bun install` would
   rewrite it in somebody else's diff). Because `bun.lock` changed, the
   `nix-deps` check fetches the deps derivation on that PR; the version is not
   part of what it installs, so the pin stays valid. Open
   the version-bump PR, and merge it once the **Checks** workflow is green
   — `master` is unprotected, so GitHub will not stop a merge that is red. Advisory review services are not a release gate.
2. In that same branch, write the final release body in `NOTES.md` and the
   matching `CHANGELOG.md` entry (both tracked, both written from
   `git log <previous-tag>..origin/master`). They ride the version-bump PR so the
   tag carries them: the release body links the changelog at its own tag
   (`blob/v<version>/apps/desktop/CHANGELOG.md`), and that link only resolves if
   the tagged commit already holds the entry. Write the asset links from the
   known naming shape (`Ensemblr-<version>-arm64.dmg`, `-x64.dmg`, `-x64.AppImage`)
   and confirm them against `gh release view` once the build lands.
3. Fetch the merged `master`, resolve it to a commit SHA, confirm that tree
   carries the intended package version, and publish the release against that
   immutable target. Run this one from the repository root:

```bash
version=0.1.20
tag="v${version}"
git fetch origin master
target=$(git rev-parse origin/master)
git show "${target}:apps/desktop/package.json" | grep -F "\"version\": \"${version}\""
gh release create "$tag" --target "$target" --title "Ensemblr ${tag}" --notes-file apps/desktop/NOTES.md
```

`--title` matters: without it GitHub titles the release with the bare tag, and
every earlier release is titled `Ensemblr vX.Y.Z`.

Merging the version-bump PR starts a **Checks** run on the squash-merge commit
itself, and `already-verified` looks for a *green* run on the exact commit the
tag points at. Creating the release while that push run is still going finds
none, so `verify` re-runs the whole suite (about five minutes) before `build`
can start. Wait for the run on `master` to finish first if you want the fast
path — `gh run list --commit "$target"` shows it.

Do not pass the literal `origin/master` as `--target`: GitHub rejects a
remote-tracking ref (`HTTP 422: Release.target_commitish is invalid`). A bare
branch name or full commit SHA is accepted; the SHA above also prevents a later
push to `master` from changing what this release tags.

Add `--prerelease` for an `-alpha` / `-beta` / `-rc` tag; the workflow corrects
the flag from the tag either way.

That creates the tag and fires `release: published`, which triggers
[`.github/workflows/release.yml`](../../../.github/workflows/release.yml): it reuses a
green **Checks** run for that exact `master` commit or runs the suite itself,
builds, signs, notarizes, verifies, then attaches the `.dmg` and `.zip` for each
macOS architecture to the release you just made and corrects the prerelease flag from the tag (`-alpha` /
`-beta` / `-rc` → prerelease, anything else → latest). The Linux job starts only
after the macOS artifacts pass verification.

**Pushing a bare `vX.Y.Z` tag does nothing on purpose** — there would be no notes
to attach to, and every release so far is hand-written prose that
`--generate-notes` would only degrade. If a release run fails, retry its failed
jobs first with `gh run rerun RUN_ID --failed` (using the numeric id from
`gh run list`); this preserves the original
release event and avoids rebuilding artifacts that already passed. If the tag
exists but there is no failed run to retry, or a clean rebuild is required,
dispatch the workflow manually with that tag as its input. A manual dispatch
does not bump Homebrew because that side effect belongs to the original
`release: published` event.

The workflow refuses to build when `apps/desktop/package.json`'s `version` does not match the
tag with `v` stripped, or when the release is still a draft.

**Six version-pinned files stay hand-edited, and the version-bump commit
touches none of them except `NOTES.md` and `CHANGELOG.md`.** The app's README carries three current-release mentions;
three more files live under `docs/` and quietly point at the previous release
until someone edits them. `nix/pins.json` is written by a script rather than by
hand, and `NOTES.md` and `CHANGELOG.md` take the release's own entry:

| File | What is pinned |
| --- | --- |
| `README.md` | version line, status sentence with its release date, both `.dmg` URLs (arm64 and x64) |
| `docs/README.md` | version link, both `.dmg` URLs, `.AppImage` URL |
| `docs/guide/README.md` | the version this guide describes |
| `docs/guide/01-install.md` | current-version examples (`--version <tag>`, the Settings → General version) and every asset URL, both architectures |
| `NOTES.md`, `CHANGELOG.md` | written in the version-bump PR, not here; after the build, check their asset links against the real names |
| `nix/pins.json` | the flake's `release` variant: version, AppImage name, and hash — run `nix/update-pins.sh release` once the AppImage is attached; `nix` lives at `/nix/var/nix/profiles/default/bin` and may be off a non-login `PATH` |

The examples in this file (`v0.1.20` in the commands and the feed document) are
illustrative, so a release does not touch them.

**Never string-replace the old version into the new one** without first
confirming the new names against the release. Asset filenames
change shape between releases — `0.1.0` dropped the `-beta.N` segment, so
`Ensemblr-0.1.0-beta.24-arm64.dmg` became `Ensemblr-0.1.0-arm64.dmg` — and a
substitution produces URLs that 404 while looking right.

Read the real names off the release instead. The job's run summary is not a
readable surface for an agent or for anyone without an authenticated browser
session — `$GITHUB_STEP_SUMMARY` has no API surface, `gh api` on the check run
returns `output.summary: null`, and the raw logs show only the unexpanded
script. Every pinned line above derives from one fact, each asset's `name`:

```bash
gh release view v0.1.20 --json assets -q '.assets[].name'
```

The version string is the tag with `v` stripped; each URL is
`.../releases/download/<tag>/<asset name>`. **The tag lands roughly fifteen
minutes before the artifacts do**, and the Linux `.AppImage` trails the macOS
pair by several minutes more, so a `gh release view` showing the tag with an
empty or partial asset list is not the signal to start editing — poll until every
artifact is there. Then check the URLs actually resolve before opening the PR:

```bash
gh api repos/ensemblr-hq/ensemblr/releases/tags/v0.1.20 \
  --jq '.assets[] | "\(.name)\t\(.digest)"'
gh api repos/ensemblr-hq/ensemblr/releases/tags/v0.1.20 \
  --jq '.assets[].browser_download_url' |
  while IFS= read -r url; do
    curl --fail --location --head --silent --show-error "$url" >/dev/null
  done
```

**The Homebrew cask bumps itself.** The same job's `Bump the Homebrew cask` step
rewrites `Casks/ensemblr.rb` in `ensemblr-hq/homebrew-tap` to the new version and
checksum, so `brew install --cask ensemblr-hq/tap/ensemblr` tracks the release
without a second ritual. It is covered in [The Homebrew tap](#the-homebrew-tap)
below.

**ensemblr.dev is updated by hand too, in its own repository** (`ensemblr-hq/ensemblr-dev`),
by asking an agent there to re-pin after each release. It carries two download
links — the newest `v<semver>` release and the rolling `nightly` — so neither
pin is derived from "whatever is newest". Automating that bump was considered and
dropped (THE-195): the site is re-pinned a handful of times a month, and a
cross-repo token plus an auto-merging bump PR was more machinery than the chore
was worth. See the prompt in that repository's own docs.

### Nightly

[`.github/workflows/nightly.yml`](../../../.github/workflows/nightly.yml) builds
`master` on the **canary** channel and publishes it to a rolling `nightly`
release whose assets are replaced each run (`Ensemblr-Canary-arm64.dmg`,
`Ensemblr-Canary-darwin-arm64.zip`, their `x64` counterparts for Intel Macs,
and `Ensemblr-Canary-x86_64.AppImage`). It is
change-gated: a cheap Linux job
compares `master` against the commit the `nightly` tag already points at and
skips the build entirely when they match, so a quiet week republishes nothing.
The version is stamped as `<major>.<minor>.<patch>-nightly.<YYYYMMDD>.g<short-sha>`
into the build (never committed), so the About box names the commit.

**The base contributes no prerelease tail of its own**, even while
`package.json` sits on `-beta.N`. The in-app updater orders one nightly against
the next with `semver.gt`, and a retained tail makes `9-nightly` and
`10-nightly` adjacent *string* identifiers — the newer build would compare
lower and every canary install would report "up to date" for good. Stripped,
the date is the first identifier that can differ, and dates order numerically.

**It runs on a cron at `0 4 * * *` UTC, and on demand.** A scheduled run always
publishes. A manual `workflow_dispatch` defaults its `publish` input to
**false**, so it exercises the entire signing and notarization path without
touching the release list:

```bash
gh workflow run nightly.yml                  # build and verify only
gh workflow run nightly.yml -f publish=true  # and publish
```

04:00 UTC puts a finished build in the release list before the working day in
Europe, and is far from the top of the hour GitHub's scheduler queues most
heavily.

A published nightly is a prerelease sitting above the newest `v<semver>` in
`/releases`, so anything that reads "the newest release" gets the nightly. That
is why ensemblr.dev pins its two download links explicitly rather than taking
the first entry it finds.

The tag scheme is a cross-repo contract, not an internal detail: `v<semver>` is a
real release, the literal `nightly` is the nightly, and nothing else publishes.
See [ADR 0054](./adr/0054-build-releases-in-ci-and-reserve-the-nightly-tag.md).

### The update feed document

Both workflows attach one feed document per target the release ships, named
**`update-<platform>-<arch>.json`** — `update-darwin-arm64.json`,
`update-darwin-x64.json`, `update-linux-x64.json`. The in-app updater reads the one for the
platform and architecture it is running as. The macOS documents are the
Squirrel.Mac feed:

```json
{
  "url": "https://github.com/ensemblr-hq/ensemblr/releases/download/v0.1.20/Ensemblr-darwin-arm64-0.1.20.zip",
  "name": "0.1.20",
  "notes": "…the release body…",
  "pub_date": "2026-09-18T09:48:54Z"
}
```

`url` points at the **`.zip`** — Squirrel installs a zipped `.app` and cannot
read a DMG. `name` is the exact version, which is what lets an installed build
compare against `app.getVersion()` without parsing a tag or a release body. That
matters most for the nightly: its tag never moves and its asset names are fixed
on purpose, so this document is the only thing that changes from one night to the
next.

**The filename shape is a contract with `updateFeedAssetName`**
(`src/main/updates/release-feed.ts`). Renaming it in one place and not the other
strands every installed build on its current version — the app reports
`update-feed-malformed` rather than claiming to be up to date, so the breakage is
visible, but it is still a breakage.

**`update-darwin-arm64.json` keeps its exact name and shape forever.** It was the
only document early releases carried, and every already-installed Apple-silicon
client reads it by that literal name and cannot be patched. The arch-aware
updater generalizes the name to `update-<platform>-<arch>.json` around it; it
never moves it. The architecture comes from the runtime's `process.arch`, not
from Rosetta detection, so an Intel build running under translation keeps
receiving Intel updates rather than being moved onto arm64 silently. See
[ADR 0074](./adr/0074-ship-four-build-targets-and-select-updates-by-architecture.md).

A build only ever reads the releases for **its own channel** — the rolling
`nightly` for canary, the highest-semver `v*` tag for release — and the two
channels carry different bundle ids, so an update can never cross between them.
See [ADR 0055](./adr/0055-resolve-updates-in-app-against-the-github-releases-api.md).

### The Linux update trust model is GitHub-only, and that is a deliberate gap

On macOS, an update is verified twice: `asset.digest` (below) proves the download
matches what GitHub stored, and Squirrel.Mac separately validates the downloaded
bundle's code signature against the running app's designated requirement, rooted
in a Developer ID key GitHub never holds. That second check is what stops a
compromised release-publishing credential — or a compromised GitHub — from
shipping a malicious update: Squirrel refuses a bundle GitHub could re-sign but
not re-key.

**Linux has no equivalent second check, and there is no plan to add one.** There
is no AppImage signing key (minisign, GPG, or otherwise), so
`src/main/updates/appimage-installer.ts` verifies only that the downloaded bytes
hash to the `sha256:<hex>` digest the GitHub Releases API reports for that asset
— the same API response that supplied the download URL. If the asset is
replaced, GitHub recomputes the digest to match, so both halves move together:
this is *transport* integrity (the bytes are what GitHub currently serves), not
*provenance* (that a legitimate maintainer built them). A Linux user is trusting
GitHub Releases and the accounts that can publish to them, full stop — the same
trust every `apt`/`brew`/`bun install` already asks for, but stated here because
macOS visibly asks for more.

What the app *does* verify, inside that trust model: `release-feed.ts` requires
every asset and feed URL to be `https:` on `github.com`,
`objects.githubusercontent.com`, or `release-assets.githubusercontent.com` before
it is fetched or handed to the installer, so an API-level response that pointed
at another host would be rejected before a single byte downloaded. And
`appimage-installer.ts` re-hashes the staged file against the digest it was
verified with at download time immediately before the rename-over-running-binary
swap, since the staged file can sit on disk for days before the user restarts —
narrowing, not closing, the local-write-access scenario `SECURITY.md` already
places out of scope.

If that changes — a signing key gets provisioned, or `actions/attest-build-provenance`
gets wired into `release.yml` — this section is the place to update, alongside
`SECURITY.md`'s build-integrity bullet.

### The Homebrew tap

`brew install --cask ensemblr-hq/tap/ensemblr` is served by a second repository,
[`ensemblr-hq/homebrew-tap`](https://github.com/ensemblr-hq/homebrew-tap), which
holds one cask and nothing else.

The release job bumps it. It reads each `.dmg` asset's `digest` field (arm64 and
x64) — GitHub's own hash of what it stored, rather than a re-hash of a local
copy — rewrites the `version` stanza and both `sha256` lines, and commits through the Contents API, so the
token never reaches a git remote. The step runs on `release: published` only: a
`workflow_dispatch` rebuild of an older tag must not walk the cask backwards.

The step carries **two tokens and keeps them apart**: the job's own
`GITHUB_TOKEN` reads this repository's release, and `ENSEMBLR_TAP_TOKEN` only
ever touches the tap. That split is what lets the PAT stay scoped to one
repository — widening it to see a release would also make a leak of it able to
rewrite this one.

A missing or expired `ENSEMBLR_TAP_TOKEN` **fails the step**. By then the release
is built, notarized and attached, so the failure is narrow and honest — the
alternative, a warning nobody reads, leaves the tap serving an old version
indefinitely. Re-mint the token, then re-run the job.

Four things about the cask are not free choices, and each will look like a
mistake to anyone who did not hit the underlying constraint:

| Stanza | Why |
| --- | --- |
| `depends_on macos: :ventura` | Electron 44's floor, per the `44-x-y` branch README — Electron 44 removed macOS 12 support, so the `:monterey` this stanza carried under Electron 43 now offers the build to machines that cannot run it. Homebrew deprecated the `">= :ventura"` string form; `brew style` rewrites it. Re-read the branch README on every Electron major: the floor moves without a release note. |
| `auto_updates true` | **Stale; remove it from the tap.** It was added because the in-app updater owned the bundle and a plain `brew upgrade` should skip it. But `--greedy`, a named `brew upgrade --cask ensemblr`, and `brew reinstall` all ignore it, and two updaters writing one bundle left an install that Gatekeeper refused as damaged after a restart. Since [ADR 0076](./adr/0076-stand-the-in-app-updater-down-on-a-homebrew-owned-install.md), the app detects a Homebrew-owned copy and never updates it in-app, so this stanza now just hides Ensemblr from `brew outdated`. |
| a custom `:github_releases` livecheck | The block accepts tagged prereleases but keys off a leading `v`, which excludes the rolling `nightly` tag and keeps the cask on the highest semver release. |
| `zap trash:` without the root directory | The root (`~/Ensemblr` by default) holds cloned repositories and worktrees. A `zap` that took it would delete the user's work. |

The tap's own CI runs `brew style`, `brew audit`, `brew fetch` (which is what
catches a bump that wrote one of the two stanzas and not the other), and a
`brew livecheck` that fails if it resolves nothing. The audit excludes exactly
one check, `github_prerelease_version`, so an intentionally shipped
`-alpha` / `-beta` / `-rc` cask can pass; stable releases do not depend on that
exception.

### The Nix flake

`flake.nix` offers Ensemblr to NixOS as two variants of one app. Both install as
`ensemblr` with the release identity (`APP_LINUX_APP_IDS.release`), so a system
carries one or the other:

```bash
nix run github:ensemblr-hq/ensemblr           # release (the default)
nix run github:ensemblr-hq/ensemblr#master    # compiled from master
```

- **`release`** (`nix/release.nix`) takes the AppImage pinned in
  `nix/pins.json`, unpacks it with `appimageTools.extract`, and hands it to
  `nix/electron-app.nix`. That derivation patches every ELF file against nixpkgs
  libraries, links the host's Vulkan loader, wraps the binary with the GTK
  environment, and installs the desktop entry and icon ladder.
  `appimageTools.wrapType2` is deliberately not used. It runs the app under
  bubblewrap, which sets `no_new_privs`, and `sudo` then fails in every terminal
  Ensemblr opens.
- **`master`** (`nix/master.nix`) compiles the flake's own commit. The flake
  itself stays at the repository root, because that is where
  `github:ensemblr-hq/ensemblr#…` resolves it, and imports `apps/desktop/nix/`;
  the deps derivation installs from the root `package.json`, `bun.lock`,
  `bunfig.toml`, and every workspace manifest the `workspaces` globs match, then
  the build runs `scripts/link-hoisted-packages.mjs` itself (the install skips
  lifecycle scripts) and packages from `apps/desktop/`. The version is
  stamped `<version>-master.<date>.g<rev>`, the same shape as the nightly's.
  The build runs `electron-forge package --platform=linux` exactly as CI does,
  then goes through the same `electron-app.nix`.
- **`overlays.default`** adds `pkgs.ensemblr` (release) and
  `pkgs.ensemblr-master`.
- **`devShells.default`** (`nix/dev-shell.nix`) is the development environment
  for `x86_64-linux`, `aarch64-linux`, and `aarch64-darwin`, entered with
  `nix develop`. It is not part of the packages: see
  [The dev shell](#the-dev-shell).

**The sandbox has no network, so the master build takes everything it would
download from one fixed-output derivation**, `master.deps`. It holds three
things: the `node_modules` tree that `bun install --frozen-lockfile
--ignore-scripts --os=linux --cpu=x64` produces, the Electron zip that
`bun.lock` resolves to, and that Electron's headers. The per-platform
`claude-agent-sdk-*` binaries are removed, because Forge never packages them.

- **Bun is pinned** in `nix/pins.json` to the version `packageManager` names, so
  the hash does not move when a consumer's nixpkgs ships a different Bun.
- **The derivation's name carries a digest of `bun.lock` and the pinned Bun
  version.** A fixed-output path otherwise depends only on its hash, so a stale
  hash would silently reuse the old `node_modules`.
- **`forge.config.ts` points packager at the zip** through
  `ENSEMBLR_ELECTRON_ZIP_DIR`, which is unset everywhere else.
- **`npm_config_nodedir` hands node-gyp the headers.**

**`node-pty` is compiled before Forge runs, not by it.** `@electron/rebuild`
builds it against the pinned headers and writes `build/Release/.forge-meta`.
The build then strips node-gyp's Makefiles and objects, and Forge's own rebuild
skips the module because the meta already matches. Those Makefiles carry paths
to the compiler and to `master.deps`. Left in `app.asar`, they would pull the
dependency derivation into every installed closure. `disallowedReferences`
fails the build if that ever regresses.

**The deps hash goes stale whenever `bun.lock` changes**, which in practice means
the weekly Dependabot batch. The `nix-deps` job in Checks flags that on the PR,
before it reaches master. On every PR whose diff touches `bun.lock`, `bunfig.toml`,
`flake.nix`, `flake.lock`, or `apps/desktop/nix/`, it builds `master.deps` against
`nix/pins.json`. A stale pin fails the job, and with it `verify`, and the job
summary names the hash to pin. A Dependabot PR therefore stays red until someone
re-pins on its branch. Refresh the pins with the script, which needs `git`, `jq`,
`nix`, and for `release` an authenticated `gh`:

```bash
apps/desktop/nix/update-pins.sh deps               # after any bun.lock change
apps/desktop/nix/update-pins.sh release [vX.Y.Z]   # after a release's AppImage is attached
apps/desktop/nix/update-pins.sh bun                # after packageManager moves
```

`release` reads the digest GitHub publishes for the `-x64.AppImage` asset, the
same trust root the in-app updater and the install script use, so nothing is
downloaded to pin it. It defaults to `releases/latest`, which skips
prereleases and with them the rolling `nightly`.

**A copy running from `/nix/store/` never updates itself.** The updater reports
`update-managed-by-nix` instead, and Settings says to update the flake or channel
and rebuild ([ADR 0077](./adr/0077-ship-a-nix-flake-and-stand-the-updater-down-in-the-nix-store.md)).
The `release` variant gets that from the first release that carries it. The
AppImage it wraps runs whatever updater its own release shipped.

### Repository secrets

Both workflows import signing material through
[`.github/actions/apple-signing`](../../../.github/actions/apple-signing/action.yml),
which creates a throwaway keychain and writes the App Store Connect key to
`$RUNNER_TEMP`. Each workflow deletes both in an `if: always()` step, so nothing
survives the job even on failure. All six must exist or the job fails at its
first step naming the ones it lacked:

| Secret | Value |
| --- | --- |
| `APPLE_API_KEY_P8` | base64 of the App Store Connect `.p8` |
| `APPLE_API_KEY_ID` | the key id |
| `APPLE_API_ISSUER` | the issuer id |
| `APPLE_CERT_P12` | base64 of the Developer ID Application `.p12` |
| `APPLE_CERT_PASSWORD` | password the `.p12` was exported with |
| `KEYCHAIN_PASSWORD` | any throwaway string |

`verify:signing` additionally needs one repository **variable** — not a secret:

| Variable | Value |
| --- | --- |
| `APPLE_TEAM_ID` | the 10-character Apple Developer Team ID the Developer ID certificate belongs to |

`codesign -dv` reports `Authority=Developer ID Application: <Name> (<TEAMID>)`
for *any* Developer ID certificate from *any* Apple developer account —
matching only that authority string, which is what `verify:signing` did before,
accepts a build signed by the wrong account. `ENSEMBLR_TEAM_ID`
(`scripts/verify-signed-artifacts.mjs`) pins the parenthesized Team ID against
it, and **fails when it is unset** — a pin that silently does nothing is the
defect it was added to fix.

A variable rather than a secret because a Team ID is not one: it is embedded in
every binary the account signs and printed by `codesign -dv` on any machine that
has a copy. Masking it would only make a mismatch read as `***` in the log that
has to explain the failure. Set it with:

```sh
gh variable set APPLE_TEAM_ID --body <TEAMID>
```

To run `bun run verify:signing` locally, export the same value as
`ENSEMBLR_TEAM_ID`; `security find-identity -v -p codesigning` prints it in
parentheses after your name.

One further secret is read by the release workflow alone, and is not signing
material:

| Secret | Value |
| --- | --- |
| `ENSEMBLR_TAP_TOKEN` | fine-grained PAT, **Contents: read and write on `ensemblr-hq/homebrew-tap` only** |

Mint it at **Settings → Developer settings → Personal access tokens →
Fine-grained tokens** with `ensemblr-hq` as the resource owner and that one
repository selected. Scope it no wider: it is injected as `GH_TOKEN` into a step
that runs `gh`, and a token that could also write to `ensemblr-hq/ensemblr` would
be a release workflow able to rewrite its own source. Fine-grained tokens expire,
so a release failing at `Bump the Homebrew cask` usually means re-minting rather
than debugging.

`checks.yml` doubles as a `workflow_call` reusable workflow so the release path
runs the same verification a PR does rather than a copy of it. Callers pass
`run_scan: false`: react-doctor diffs against `master`, which a release tag
already is.

An `already-verified` job runs ahead of it and checks whether the commit the tag
points at has a green `Checks` run of its own. A tag cut from `master` normally
does — that run was the merge — and re-running the identical suite over the
identical tree proves nothing, so `verify` is skipped and the build starts
several minutes earlier. It fails closed: a lookup that errors, finds nothing,
or finds only failed runs leaves the flag false and the full suite runs, which
is exactly what a tag cut from a commit that never reached `master` gets.
`build` and `build-linux` therefore gate on `always()` plus explicit job
results, because a *skipped* dependency would otherwise skip them too.

## What ships inside the `.app`

The packager's `ignore` filter keeps the Vite output plus an explicit allow-list
(`PACKAGE_KEEP_EXACT` / `PACKAGE_KEEP_PREFIXES` in `forge.config.ts`). Everything
else under `node_modules` is dropped, because Vite bundles it. Two packages are
`external` in `vite.main.config.mts` and therefore **must** be on the keep-list or
the packaged app is broken in a way `bun run dev` never shows:

- **`node-pty`** — a native module resolved from `node_modules` at runtime. Its
  build-time dep `node-addon-api` is kept too (`@electron/rebuild` needs it to
  recompile the addon against Electron's ABI), and `AutoUnpackNativesPlugin`
  unpacks the resulting `.node` out of the asar.
- **`@anthropic-ai/claude-agent-sdk`** — external because it calls
  `createRequire(import.meta.url)` at module load, which Rollup rewrites to
  `{}.url` in the CJS main bundle. `sdk.mjs` has to exist on disk to be required.

The SDK's per-platform `claude-agent-sdk-<platform>` siblings are deliberately
**not** kept — each carries a ~260 MB `claude` binary, and the user has to install
and authenticate the real CLI anyway (`claude /login`). Native Claude Code
therefore runs the user's own binary, found on `PATH` or set as an override in
Settings → Providers
([ADR 0042](./adr/0042-add-claude-code-as-a-second-first-class-agent-runtime.md)).
The trailing slash on the SDK's prefix entry is what excludes those siblings; the
matching exact entries hold the parent directories that prefix would otherwise
drop.

Adding another unbundled or native dependency means updating **both**
`external` in the relevant Vite config and the `PACKAGE_KEEP_*` lists.

**The keep-list depends on Bun's hoisted linker.** The filters match flat
`/node_modules/<pkg>/` paths. Bun's other layout, the isolated linker, builds a
symlinked `node_modules/.bun/` store that those filters would not match, and the
packaged app would ship without `node-pty` and the Claude Agent SDK. The root
`bunfig.toml` therefore pins `linker = "hoisted"` — load-bearing now that the
repository has workspaces, which Bun defaults to the isolated linker. Under the
hoisted layout those packages sit in the repository root's `node_modules`, and
reach this directory through the links `scripts/link-hoisted-packages.mjs` writes
(see [The monorepo layout](#the-monorepo-layout)).

## Troubleshooting

- **Stray Dock icon / duplicate instance.** Run `bun run diagnose:dock-flash`
  (`scripts/diagnose-dock-flash.mjs`): it lists every `dev.ensemblr.app*` Launch
  Services registration and flags id collisions and dangling entries; add
  `--fix` to unregister dangling ones (live sibling builds are left alone).
- **Wrong Node or Bun version, or `node-gyp failed to rebuild '.../node-pty'`.**
  You are outside the dev shell, so you are running whatever Node, Bun, and
  compiler the host has, and nothing checks them. Enter it with `nix develop`,
  or prefix the command with `nix develop -c`, and re-run. In a shell that is
  already entered, `command -v node` should resolve into `/nix/store`. Also
  check that `[environment_variables]` in `.ensemblr/settings.toml` does not set
  `PATH`.
- **`nix develop` reports no `devShells.<system>.default` attribute.** Intel Macs
  (`x86_64-darwin`) get no shell, because nixpkgs 26.11 dropped the platform.
- **Terminals dead in a Linux build that worked locally.** A locally built
  AppImage carries a `node-pty` linked against Nix's glibc, which only exists on
  machines with that store path. Nothing detects it any more. Use the release or
  nightly AppImage, which CI builds outside Nix, or build in a container as
  described in *The Linux build has to run on Linux*.
- **Electron dies with `GLIBC_2.43 not found`.** `LD_LIBRARY_PATH` is set and
  points at libraries built against a newer glibc than Nix's. The dev shell
  unsets it, so you launched Electron from outside the shell, or something after
  `nix develop` exported it again.
- **`MESA-LOADER: failed to open dri: … 'GLIBC_2.43' not found` in `dev`.** The
  flake's nixpkgs is older than your NixOS system, so Electron cannot load the
  system's GPU drivers and renders in software. Run `nix flake update nixpkgs`.
  See *Developing on Linux*.
- **Terminals dead in `dev` after `nix-collect-garbage` or a `flake.lock` bump.**
  `node-pty` was compiled with the shell's gcc and finds `libstdc++` through a
  `/nix/store` path the shell no longer holds. Its `.forge-meta` stamp still
  matches, so Forge does not rebuild it on its own:
  `rm -r node_modules/node-pty/build` at the repository root, then `dev` again.
- **`libglib-2.0.so.0: cannot open shared object file` on NixOS.** Electron is the
  generic-Linux binary Bun installed, not nixpkgs' build. Launch it from inside
  the dev shell, which sets `ELECTRON_OVERRIDE_DIST_PATH`.
- **`libnspr4.so: cannot open shared object file`.** Electron is being launched
  inside a container that has no Chromium runtime libraries. Compile in the
  container; run the app on the host.
- **`hdiutil detach /Volumes/Ensemblr` fails in a release build.** The macOS
  runner occasionally loses the disk image mid-`make` (`hdiutil: detach failed -
  No such file or directory`) and the arm64 or x64 job dies in *Build the signed,
  notarized distributables*. It is a runner flake, not a packaging break: run
  `gh run rerun RUN_ID --failed`, which reruns only the failed job (v0.2.2's
  arm64 leg passed on the first rerun).
- **App icon.** Regenerate with `bun run icon:generate`
  (`scripts/generate-app-icon.mjs`).
- **README wordmark.** `assets/wordmark.gif` is the animated dot-matrix mark at
  the top of the README, generated from the same glyphs as the in-app wordmark —
  a 16s loop at 20fps on GitHub's `#0d1117` page background, so it sits flush in
  the README rather than as a card of the app's own near-black. Regenerate with
  `bun run wordmark:generate` (`scripts/generate-wordmark-gif.mjs`); it needs
  ImageMagick on PATH. `LOOP_MS` and `FRAME_COUNT` move together — the GIF delay
  is a whole centisecond, so keep `LOOP_MS / FRAME_COUNT` at a multiple of 10.

## See also

- [ADR 0054](./adr/0054-build-releases-in-ci-and-reserve-the-nightly-tag.md) — why releases build in CI, the reserved tag namespace, and the shared channel state.
- [ADR 0055](./adr/0055-resolve-updates-in-app-against-the-github-releases-api.md) — why the in-app updater resolves its own feed, and why `update.electronjs.org` cannot serve either channel.
- [ADR 0056](./adr/0056-ship-a-linux-amd64-appimage.md) — why the Linux artifact is an AppImage, and why its window controls are app-drawn. Its updates-never-install rule is amended by ADR 0065 below.
- [ADR 0065](./adr/0065-install-linux-updates-in-app-by-swapping-the-appimage.md) — why a Linux build now stages a checksum-verified AppImage and swaps it in on restart, and when it still only links at the release page.
- [ADR 0076](./adr/0076-stand-the-in-app-updater-down-on-a-homebrew-owned-install.md) — why a copy Homebrew installed is never updated in-app, and how to recover an install macOS calls damaged.
- [ADR 0077](./adr/0077-ship-a-nix-flake-and-stand-the-updater-down-in-the-nix-store.md) — why the flake patches the AppImage instead of sandboxing it, why `master` is a real Forge package, and why a Nix-store copy never updates in-app.
- [ADR 0031](./adr/0031-strip-launch-context-env-and-single-instance-lock.md), [ADR 0032](./adr/0032-channel-scoped-bundle-identity.md) — the Dock-flash fixes.
- [ADR 0042](./adr/0042-add-claude-code-as-a-second-first-class-agent-runtime.md) — why the Claude binary is not packaged.
- [`.claude/rules/stack.md`](../../../.claude/rules/stack.md) — the pinned versions, the two `external` packages, and why there is no `.npmrc`.
- [`README.md`](../README.md) — tech stack and getting started.
- [`onboarding.md`](./onboarding.md) — the contributor runbook the build sits at the end of.
