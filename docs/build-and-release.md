# Build & Release

Ensemblr packages through Electron Forge for two targets: **macOS arm64**, where
a release build is code-signed with a hardened runtime, notarized, and shipped as
both a `.dmg` and a `.zip`; and **Linux x86-64**, shipped as an unsigned
`.AppImage`. This guide covers the build matrix, signing, and the build channels.
The packaging config lives in `forge.config.ts`. See
[ADR 0056](./adr/0056-ship-a-linux-amd64-appimage.md) for why AppImage, and what
changes off darwin.

## Prerequisites

- **macOS on Apple silicon** for the `.dmg`/`.zip`; **Linux x86-64** for the
  `.AppImage`. Neither host cross-builds the other's artifact, which is why CI
  runs them as separate jobs.
- **`mksquashfs`** for the Linux build (`apt install squashfs-tools`). The
  AppImage maker declares it as a required external binary and refuses to run
  without it.
- **Node `>=24 <25`** — enforced by `scripts/require-node-version.mjs`, which
  `package`/`make` run first.
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

```bash
npm run dev            # run the app in development (electron-forge start)

npm run package        # build an unpacked .app under out/ (arm64)
npm run make           # build distributables (.dmg + .zip) under out/make/
npm run verify:signing # assert what make just produced is signed and notarized

npm run package:linux  # build an unpacked linux-x64 directory under out/
npm run make:linux     # build the .AppImage under out/make/

npm run diagnose:linux # report the Linux native-module toolchain and pty.node's linkage
npm run rebuild:native # compile node-pty in a container by hand (dev/make:linux do it themselves)
```

The Linux artifact is never signed, notarized, or stapled — there is no
equivalent to do — so `verify:signing` is not run against it. Its
`scripts/verify-signed-artifacts.mjs` only looks for `*-darwin-arm64` output and
would report the Linux build as missing.

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
launches, and has a dead terminal in every tab — the same shape of silent
breakage `require-node-version.mjs` exists to prevent, discovered a release
later.

Three ways to get one:

1. **CI.** Push the tag; `build-linux` in `release.yml` builds and attaches it.
2. **A container**, to iterate locally. Under emulation on Apple silicon this is
   slow but correct:

   ```bash
   docker run --rm -it --platform=linux/amd64 \
     -v "$PWD":/src -w /src node:24-bookworm \
     bash -c 'apt-get update && apt-get install -y squashfs-tools \
       && npm ci && npm run make:linux'
   ```

   `npm ci` clears `node_modules` itself, and that is the point: the host tree
   holds darwin binaries for every native module, and the reinstall inside the
   container is what compiles the Linux ones. It also means the host repo comes
   back with Linux binaries in `node_modules` — run `npm ci` again on the Mac
   before building there.
3. **`ENSEMBLR_ALLOW_CROSS_PLATFORM_LINUX_BUILD=1`**, which downgrades the
   refusal to a warning. It exercises the packaging plumbing — the maker, the
   `.desktop` file, the icons — on a Mac. It must never ship: terminals in the
   result do not work.

### Developing on Linux

On a Linux desktop that already has a compiler, there is nothing to know: pin
Node and run `npm run dev`. On one that has none — which on Linux is a larger
share than it sounds, since every immutable distribution (SteamOS, Silverblue,
NixOS) ships without one — there is still nothing to know, as long as `podman` or
`docker` is installed. `dev`, `package:linux`, and `make:linux` all run
`require-linux-toolchain.mjs` first, and it builds `node-pty` in a container
itself rather than telling you to. The rest of this section is what it is doing
on your behalf, and what to reach for when it cannot.

```bash
npm run diagnose:linux   # compiler, make, python3, mksquashfs, pty.node + its linkage
npm run rebuild:native   # run that same container build by hand
```

`diagnose:linux` is the read-only view of the same checks — it never builds, so
it always describes the tree as it stands. `ENSEMBLR_SKIP_NATIVE_AUTOBUILD=1`
turns the automatic build back into the old refusal-with-instructions, for an
environment that would rather not have an image pulled on its behalf.

**Pin Node first.** `.nvmrc`, `mise.toml`, and `engines` all say 24, but nothing
on PATH enforces it and distro packages are usually something else:

```bash
./scripts/with-pinned-node.sh npm run dev        # resolves via mise → nvm → brew node@24
export PATH="$(brew --prefix node@24)/bin:$PATH" # or put it on PATH yourself
```

`dev` **warns** on the wrong major rather than refusing, because Forge rebuilds
native modules against Electron's own ABI either way — the mismatch degrades the
dev loop instead of corrupting an artifact. `package`/`make`/`install` still
refuse outright.

**`node-pty` is the only thing that compiles, and it bites twice.** It publishes
prebuilds for darwin and win32 only, so on linux-x64 its `install` script falls
straight through `scripts/prebuild.js` to `node-gyp rebuild` — that is failure
one, during `npm ci`. Forge then rebuilds it again against Electron's ABI inside
`start` and `package`, which is failure two, and it surfaces as nothing more
useful than:

```
Error: node-gyp failed to rebuild '.../node_modules/node-pty'
```

`scripts/require-linux-toolchain.mjs` runs ahead of `dev`, `package:linux`, and
`make:linux` and turns that into a message naming the missing tool. It also
reads `pty.node`'s linkage back with `ldd` and refuses a binding whose libraries
resolve outside `/usr` or `/lib` — see the Deck section below for why a
Homebrew-linked one is worse than no binding at all.

**Without a host compiler, compile in a container and run on the host.** The
container needs to exist only for the compile:

```bash
# Install, when npm ci itself cannot get past node-pty's install script.
podman run --rm -v "$PWD":/src -w /src node:24-bookworm npm ci

# Then the binding, which is what npm run rebuild:native wraps.
npm run rebuild:native
```

Both leave their output in the host's `node_modules`, where Forge finds the
binding already built and skips its own rebuild. Rootless podman maps container
root to you, so the files come back owned correctly; rootful docker does not,
and `rebuild:native` says so with the `chown` to fix it.

**Do not try to run the app in that container.** Electron needs the whole
Chromium runtime — a bare `debian:bookworm` gets as far as
`error while loading shared libraries: libnspr4.so` — plus the session's Wayland
socket and GPU nodes. Installing that set into a container to reach a desktop
you are already sitting in front of is work for no gain, and it puts a second
glibc between the app and the compositor whose behavior you are trying to
verify. The compile is the only part that wants isolation, and it is the only
part that is host-independent.

`debian:bookworm` is also not arbitrary: it links an older glibc than any
desktop host, and old-built-runs-on-new is the safe direction for a binary that
ends up inside a shipped AppImage. Override with
`ENSEMBLR_NATIVE_REBUILD_IMAGE` only toward an *older* base, never a newer one.

### Building and verifying on a Steam Deck

The Deck is the reference Linux host: Wayland, KDE Plasma, fractional scaling, a
battery, an immutable root, and no package manager to speak of. Everything below
assumes **Desktop Mode**.

**Toolchain.** Three things are needed, and they do not all come from the same
place. `npm run diagnose:linux` reports all of them, plus whether `pty.node` is
built and what it links against:

```
node         24.20.0 (electron rebuild target)
compiler     MISSING
make         MISSING
python3      /home/linuxbrew/.linuxbrew/bin/python3
mksquashfs   /home/linuxbrew/.linuxbrew/bin/mksquashfs
pty.node     .../node_modules/node-pty/build/Release/pty.node

linkage
  libstdc++.so.6     /usr/lib/libstdc++.so.6
  libc.so.6          /usr/lib/libc.so.6
```

That output is the steady state on a Deck set up the way this section
describes, and it is worth reading twice: **`compiler MISSING` is fine** once
`pty.node` exists and links under `/usr`. The compiler is needed to produce the
binding, not to use it.

**Node 24 and `mksquashfs`: Homebrew covers both.** Each has an `x86_64_linux`
bottle, so nothing compiles and nothing touches the read-only root. `node@24` is
keg-only, as every versioned formula is, so it has to be put on PATH by hand —
plain `node` is far past 24 and `scripts/require-node-version.mjs` enforces the
major exactly.

```bash
brew install node@24 squashfs
export PATH="$(brew --prefix node@24)/bin:$PATH"
node -v   # must print v24.x
```

`nvm` works just as well for the Node half if you would rather not go through
Homebrew; it also installs entirely under `$HOME`.

**A C++ compiler: Homebrew is the wrong tool.** `npm ci` compiles `node-pty` —
it publishes no linux-x64 prebuild — and node-gyp looks for `g++`/`c++`/`cc` on
PATH. Homebrew's `gcc` formula installs *versioned* binaries (`g++-16`), so
node-gyp will not find it and will fall through to the system compiler, or fail
loudly if there is none. That failure is the good outcome.

Pointing `CXX` at Homebrew's `g++-16` to force it is the bad one: the resulting
`pty.node` links Homebrew's libstdc++ and carries an rpath into
`/home/linuxbrew/.linuxbrew/lib`. It runs on the machine that built it and on no
other — the same shape of silent, ships-anyway breakage
`require-linux-host.mjs` exists to prevent, just one layer down.

So if `g++` is MISSING above, the shortest way through is not to install one at
all — the one module that needs it compiles in a throwaway `node:24-bookworm`
container, and the binding lands in `node_modules` where Forge finds it already
built. The Deck ships `podman`, so this needs no installation and no sudo
password, and `npm run dev` does it unprompted the first time it finds the
binding missing or stamped for the wrong ABI. Run it by hand when you want to
replace a binding without waiting for a preflight to notice:

```bash
npm run rebuild:native   # ~1 GB image pull the first time, seconds after that
```

Reach for a real toolchain only if you want one on the host anyway:

```bash
# Native. Needs a sudo password set (`passwd` — the Deck ships without one),
# and lasts only until the next SteamOS update, which restores the image.
sudo steamos-readonly disable
sudo pacman-key --init && sudo pacman-key --populate archlinux holo
sudo pacman -S --needed base-devel python
```

Or keep a persistent Debian shell, if you would rather have `npm ci` and the
build tools in one place than reach for a one-shot container each time:

```bash
distrobox create --name ensemblr --image debian:bookworm
distrobox enter ensemblr
sudo apt-get update && sudo apt-get install -y git curl python3 build-essential squashfs-tools
```

It shares `$HOME`, so the repo is the same tree from both sides — but note that
it does **not** share `/home/linuxbrew`, so Homebrew's `node@24` is invisible
inside it and Node has to be installed in the container too. Compile there, then
leave: the app itself has to run on the host (see *Developing on Linux* above).

**Whichever route, check what `pty.node` actually linked.** For the tree you are
developing against, `npm run diagnose:linux` does it and the `dev`/`package:linux`
guards do it automatically. After a build, check what actually got packaged:

```bash
ldd out/Ensemblr-linux-x64/resources/app.asar.unpacked/node_modules/node-pty/build/Release/pty.node
```

Every entry should resolve under `/usr/lib` or `/lib`. A `/home/linuxbrew` path
means the artifact only runs on this Deck, and `not found` means it will not run
anywhere.

**Build.** Budget ~2 GB for `node_modules` plus the Electron download.

```bash
git clone https://github.com/ensemblr-hq/ensemblr.git && cd ensemblr
export PATH="$(brew --prefix node@24)/bin:$PATH"

npm ci                  # no compiler? podman run --rm -v "$PWD":/src -w /src node:24-bookworm npm ci

npm run dev             # the dev loop — builds node-pty in a container first if it has to
npm run diagnose:linux  # after that build: confirm pty.node exists and links under /usr

npm run package:linux   # unpacked build — needs no mksquashfs
./out/Ensemblr-linux-x64/Ensemblr
```

Run `package:linux` before `make:linux`. It exercises everything in the
checklist below except the AppImage wrapper itself, needs no `mksquashfs`, and
skips the SquashFS pass on every iteration. Once it behaves:

```bash
npm run make:linux
chmod +x out/make/AppImage/x64/*.AppImage
./out/make/AppImage/x64/*.AppImage
```

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
| 15 | Settings → General → Check for updates | Reports a version with a link; never tries to install |
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

`npm run build` is an alias for `npm run package`. All three of `build`,
`package`, and `make` run `scripts/require-node-version.mjs` first.

`make` and `package` cover the common cases; the channel/skip variants below
wrap them with environment variables:

| Script | Channel | Signed? | Notes |
| --- | --- | --- | --- |
| `npm run make` | release | yes¹ | The shipping build (`dev.ensemblr.app` / "Ensemblr"). |
| `npm run make:canary` | canary | yes¹ | Dogfood build with its own identity. |
| `npm run make:dev` | dev | yes¹ | Dogfood build with its own identity. |
| `npm run make:unsigned` | release | no | `ENSEMBLR_SKIP_SIGN=1` — skip signing/notarization. |
| `npm run package:dev` | dev | — | Unpacked `.app`, dev channel. |
| `npm run package:unsigned` | release | no | Unpacked `.app`, signing skipped. |

¹ Signed and notarized **only** when the Apple credentials above are present and
`ENSEMBLR_SKIP_SIGN` is not set; otherwise the same command produces an
unsigned build instead of failing — set `ENSEMBLR_REQUIRE_SIGN=1` to turn that
into an error (see below).

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

**`npm run verify:signing`** (`scripts/verify-signed-artifacts.mjs`) is the
matching check on the artifacts themselves: it walks `out/` and asserts every
`.app` carries a *Developer ID Application* signature (not an ad-hoc one),
passes `spctl`, and has a stapled ticket — and the same for each `.dmg`. Each
`.zip` is extracted with `ditto` and the `.app` inside it checked the same way,
rather than assuming the zip maker captured the bundle already verified under
`out/`. An empty `out/` fails, so a skipped build never reads as a pass. Run it
after `npm run make`; both workflows run it before publishing anything.

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

`npm run icon:generate` writes `assets/icons/icon-<size>.png` for every size the
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

`npm run make` writes to `out/make/`:

- **`.dmg`** (ULFO format) — the primary distributable.
- **`.zip`** — a zipped `.app` for auto-update / direct download.

`npm run package` writes the unpacked `.app` to `out/`.

A third artifact exists only on the release, not in `out/`: both workflows write
**`update-darwin-arm64.json`** and attach it beside the `.zip`. See
[The update feed document](#the-update-feed-document) below.

**An empty `out/` has two unrelated causes and they look alike.** The Node-major
one is silent — exit 0, no error. The other is the Electron download: Forge
reaches `@electron/get` **v3** through `@electron/packager`, which fetches
`SHASUMS256.txt` over `got@11` before the zip, and a network that resets that
request stops the build there. `electron`'s own postinstall is not affected — it
uses `@electron/get` **v5**, which downloads over native `fetch` — so `npm
install` can succeed on a network where `npm run make` does not. It is transient
and the download is cached, so retrying usually clears it. See
[Troubleshooting](./guide/14-troubleshooting.md#make-dies-fetching-shasums256txt).

## Releasing

Releases are built by GitHub Actions on a `macos-15` runner, not on a laptop.
The local `npm run make` route above stays the escape hatch when CI is down or
you need to bisect a packaging break.

### Cutting a release

**Write the notes and create the release. That is the whole ritual.**

```bash
gh release create v0.1.4 --notes-file NOTES.md
```

Add `--prerelease` for an `-alpha` / `-beta` / `-rc` tag; the workflow corrects
the flag from the tag either way.

That creates the tag and fires `release: published`, which triggers
[`.github/workflows/release.yml`](../.github/workflows/release.yml): it runs the
full `checks.yml` suite, builds, signs, notarizes, verifies, then attaches the
`.dmg` and `.zip` to the release you just made and corrects the prerelease flag
from the tag (`-alpha` / `-beta` / `-rc` → prerelease, anything else → latest).

**Pushing a bare `vX.Y.Z` tag does nothing on purpose** — there would be no notes
to attach to, and every release so far is hand-written prose that
`--generate-notes` would only degrade. If a tag exists but the build needs
re-running, dispatch the workflow manually with that tag as its input.

The workflow refuses to build when `package.json`'s `version` does not match the
tag with `v` stripped, or when the release is still a draft.

**Five version-pinned lines stay hand-edited, and the release commit touches
none of them.** The README's version line and `.dmg` download URL are the two
that get remembered; the other three live under `docs/` and quietly point at the
previous release until someone edits them:

| File | What is pinned |
| --- | --- |
| `README.md` | version line, `.dmg` URL |
| `docs/README.md` | version link, `.dmg` and `.AppImage` URLs |
| `docs/guide/README.md` | the version this guide describes |
| `docs/guide/01-install.md` | version string ×2, all three asset URLs |
| `docs/build-and-release.md` | the `update-darwin-arm64.json` example |

**Never string-replace the old version into the new one.** Asset filenames
change shape between releases — `0.1.0` dropped the `-beta.N` segment, so
`Ensemblr-0.1.0-beta.24-arm64.dmg` became `Ensemblr-0.1.0-arm64.dmg` — and a
substitution produces URLs that 404 while looking right.

Read the real names off the release instead. The job's run summary is not a
readable surface for an agent or for anyone without an authenticated browser
session — `$GITHUB_STEP_SUMMARY` has no API surface, `gh api` on the check run
returns `output.summary: null`, and the raw logs show only the unexpanded
script. Every pinned line above derives from one fact, each asset's `name`:

```bash
gh release view v0.1.4 --json assets -q '.assets[].name'
```

The version string is the tag with `v` stripped; each URL is
`.../releases/download/<tag>/<asset name>`. **The tag lands roughly fifteen
minutes before the artifacts do**, and the Linux `.AppImage` trails the macOS
pair by several minutes more, so a `gh release view` showing the tag with an
empty or partial asset list is not the signal to start editing — poll until all
four are there. Then check the URLs actually resolve before opening the PR:

```bash
gh api repos/ensemblr-hq/ensemblr/releases/tags/v0.1.4 \
  --jq '.assets[] | "\(.name)\t\(.digest)"'
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

[`.github/workflows/nightly.yml`](../.github/workflows/nightly.yml) builds
`master` on the **canary** channel and publishes it to a rolling `nightly`
release whose assets are replaced each run (`Ensemblr-Canary-arm64.dmg`,
`Ensemblr-Canary-darwin-arm64.zip`, `Ensemblr-Canary-x86_64.AppImage`). It is
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

Both workflows attach **`update-darwin-arm64.json`** to every release. It is the
Squirrel.Mac feed the in-app updater reads:

```json
{
  "url": "https://github.com/ensemblr-hq/ensemblr/releases/download/v0.1.4/Ensemblr-darwin-arm64-0.1.4.zip",
  "name": "0.1.4",
  "notes": "…the release body…",
  "pub_date": "2026-09-06T20:50:21Z"
}
```

`url` points at the **`.zip`** — Squirrel installs a zipped `.app` and cannot
read a DMG. `name` is the exact version, which is what lets an installed build
compare against `app.getVersion()` without parsing a tag or a release body. That
matters most for the nightly: its tag never moves and its asset names are fixed
on purpose, so this document is the only thing that changes from one night to the
next.

**The filename is a contract with `UPDATE_FEED_ASSET_NAME`**
(`src/main/updates/release-feed.ts`). Renaming it in one place and not the other
strands every installed build on its current version — the app reports
`update-feed-malformed` rather than claiming to be up to date, so the breakage is
visible, but it is still a breakage.

A build only ever reads the releases for **its own channel** — the rolling
`nightly` for canary, the highest-semver `v*` tag for release — and the two
channels carry different bundle ids, so an update can never cross between them.
See [ADR 0055](./adr/0055-resolve-updates-in-app-against-the-github-releases-api.md).

### The Homebrew tap

`brew install --cask ensemblr-hq/tap/ensemblr` is served by a second repository,
[`ensemblr-hq/homebrew-tap`](https://github.com/ensemblr-hq/homebrew-tap), which
holds one cask and nothing else.

The release job bumps it. It reads the `.dmg` asset's `digest` field — GitHub's
own hash of what it stored, rather than a re-hash of a local copy — rewrites the
`version` and `sha256` stanzas, and commits through the Contents API, so the
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
| `auto_updates true` | The in-app updater owns the bundle. `brew upgrade` therefore skips it, and only `--greedy` overrides that. Two updaters writing one bundle is how an install gets corrupted. |
| a custom `:github_releases` livecheck | Every release is flagged `--prerelease`, so `:github_latest` finds nothing at all. The block accepts prereleases and keys off a leading `v`, which is also what excludes the rolling `nightly` tag. |
| `zap trash:` without the root directory | The root (`~/Ensemblr` by default) holds cloned repositories and worktrees. A `zap` that took it would delete the user's work. |

The tap's own CI runs `brew style`, `brew audit`, `brew fetch` (which is what
catches a bump that wrote one of the two stanzas and not the other), and a
`brew livecheck` that fails if it resolves nothing. The audit excludes exactly
one check, `github_prerelease_version`: it enforces homebrew-cask's policy
against shipping prereleases, which every Ensemblr release is until 1.0.
Submitting to homebrew-cask upstream is out of scope for that same reason.

### Repository secrets

Both workflows import signing material through
[`.github/actions/apple-signing`](../.github/actions/apple-signing/action.yml),
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
the packaged app is broken in a way `npm run dev` never shows:

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

## Troubleshooting

- **Stray Dock icon / duplicate instance.** Run `npm run diagnose:dock-flash`
  (`scripts/diagnose-dock-flash.mjs`): it lists every `dev.ensemblr.app*` Launch
  Services registration and flags id collisions and dangling entries; add
  `--fix` to unregister dangling ones (live sibling builds are left alone).
- **Node version error at build.** `require-node-version.mjs` refuses to build on
  a Node outside `>=24 <25`; switch with `nvm`/`mise` (`.nvmrc` / `mise.toml`).
- **`node-gyp failed to rebuild '.../node-pty'` on Linux.** The host has no C++
  compiler, and node-pty ships no linux-x64 prebuild. Reaching Forge's error at
  all means the preflight did not repair it, and there are two reasons it would
  not: no `podman` or `docker` to build in — install one and re-run — or
  `ENSEMBLR_SKIP_NATIVE_AUTOBUILD` is set, in which case `npm run rebuild:native`
  does that same container build by hand. `npm run diagnose:linux` reports what
  is missing and which of the two you are looking at. See *Developing on Linux*.
- **Terminals dead in a Linux build that worked locally.** `pty.node` was
  compiled against a private prefix — a Homebrew or Nix compiler — and carries
  an rpath no other machine has. `npm run diagnose:linux` names the offending
  libraries; `rm -rf node_modules/node-pty/build && npm run rebuild:native`
  replaces it. The `dev`/`package:linux`/`make:linux` guards refuse it now.
- **`libnspr4.so: cannot open shared object file`.** Electron is being launched
  inside a container that has no Chromium runtime libraries. Compile in the
  container; run the app on the host.
- **Node version error at install.** Non-interactive shells (a workspace's
  `setup`/`run` scripts, CI, hooks) never source the mise/nvm hooks, so they run
  under whatever Node is on PATH. Prefix the command with
  `./scripts/with-pinned-node.sh` — it resolves the `.nvmrc` Node via mise, nvm,
  or Homebrew `node@24` and then execs the command unchanged.
- **App icon.** Regenerate with `npm run icon:generate`
  (`scripts/generate-app-icon.mjs`).
- **README wordmark.** `assets/wordmark.gif` is the animated dot-matrix mark at
  the top of the README, generated from the same glyphs as the in-app wordmark —
  a 16s loop at 20fps on GitHub's `#0d1117` page background, so it sits flush in
  the README rather than as a card of the app's own near-black. Regenerate with
  `npm run wordmark:generate` (`scripts/generate-wordmark-gif.mjs`); it needs
  ImageMagick on PATH. `LOOP_MS` and `FRAME_COUNT` move together — the GIF delay
  is a whole centisecond, so keep `LOOP_MS / FRAME_COUNT` at a multiple of 10.

## See also

- [ADR 0054](./adr/0054-build-releases-in-ci-and-reserve-the-nightly-tag.md) — why releases build in CI, the reserved tag namespace, and the shared channel state.
- [ADR 0055](./adr/0055-resolve-updates-in-app-against-the-github-releases-api.md) — why the in-app updater resolves its own feed, and why `update.electronjs.org` cannot serve either channel.
- [ADR 0056](./adr/0056-ship-a-linux-amd64-appimage.md) — why the Linux artifact is an AppImage, why its window controls are app-drawn, and why it checks for updates but never installs one.
- [ADR 0031](./adr/0031-strip-launch-context-env-and-single-instance-lock.md), [ADR 0032](./adr/0032-channel-scoped-bundle-identity.md) — the Dock-flash fixes.
- [ADR 0042](./adr/0042-add-claude-code-as-a-second-first-class-agent-runtime.md) — why the Claude binary is not packaged.
- [`../.claude/rules/stack.md`](../.claude/rules/stack.md) — the pinned versions, the two `external` packages, and the `legacy-peer-deps` constraint.
- [`README.md`](../README.md) — tech stack and getting started.
- [`onboarding.md`](./onboarding.md) — the contributor runbook the build sits at the end of.
