# Installing Ensemblr

Ensemblr runs on **macOS with Apple silicon only**. The app is packaged as an
arm64 `.app`, keeps its secrets in the macOS Keychain, and reads battery state
through macOS APIs. There is no Intel build, no Linux build, and no Windows
build.

## Homebrew

```bash
brew install --cask ensemblr-hq/tap/ensemblr
```

The [tap](https://github.com/ensemblr-hq/homebrew-tap) carries the stable
channel only. It declares Apple silicon and macOS Monterey as requirements, so
`brew` refuses on a machine that cannot run the app rather than installing
something that will not open.

The cask is marked `auto_updates true` because Ensemblr updates itself (see
[Staying up to date](#staying-up-to-date)), so a plain `brew upgrade` leaves it
alone — two updaters writing the same bundle is how an install gets corrupted.
To hand the job to Homebrew instead, turn **Settings → General → Update Ensemblr
automatically** off and upgrade explicitly:

```bash
brew upgrade --cask --greedy ensemblr
```

## Download

The current build is **`0.1.0-beta.10`**:

- [**`Ensemblr-0.1.0-beta.10-arm64.dmg`**](https://github.com/ensemblr-hq/ensemblr/releases/download/v0.1.0-beta.10/Ensemblr-0.1.0-beta.10-arm64.dmg)
  — the disk image. Open it and drag Ensemblr to `/Applications`.
- [`Ensemblr-darwin-arm64-0.1.0-beta.10.zip`](https://github.com/ensemblr-hq/ensemblr/releases/download/v0.1.0-beta.10/Ensemblr-darwin-arm64-0.1.0-beta.10.zip)
  — the same `.app`, zipped, if you would rather not mount an image.

There is also a **nightly** build of `master` under the rolling
[`nightly`](https://github.com/ensemblr-hq/ensemblr/releases/tag/nightly) tag —
[`Ensemblr-Canary-arm64.dmg`](https://github.com/ensemblr-hq/ensemblr/releases/download/nightly/Ensemblr-Canary-arm64.dmg).
It is signed and notarized the same way, but it is untested: it installs as
"Ensemblr Canary" **alongside** a release rather than replacing it, and its
assets are overwritten each night.

Every build is on the Releases page:

<https://github.com/ensemblr-hq/ensemblr/releases>

The released build is code-signed with a Developer ID certificate, runs under the
hardened runtime, and is notarized by Apple and stapled — both the `.app` and the
`.dmg` carry their own ticket, so Gatekeeper clears them on first open without a
network round-trip and without the right-click dance below. It is a **beta**: pre-1.0,
with breaking changes expected before 1.0.

The app reports the full version, suffix included — `0.1.0-beta.10` in
**Settings → General** and in the bundle's `CFBundleShortVersionString`. It
matches the release tag, so a bug report only has to quote one string.

## Staying up to date

**Ensemblr updates itself.** An installed copy checks GitHub a couple of minutes
after launch and every four hours after that, downloads a newer build in the
background, and then offers to restart into it — you choose when. **Settings →
General** shows the running version and the updater's state, and
**Ensemblr → Check for Updates…** runs a check on the spot.

Restarting goes through the same confirmation that guards ⌘Q: if agents are still
working, Ensemblr asks before interrupting them, and declining leaves the
downloaded update staged for whenever you are ready.

Two things it deliberately will not do:

- **Cross channels.** A release build only ever updates to another `v<semver>`
  release, and Ensemblr Canary only ever to a newer nightly. They are separate
  apps with separate bundle ids, so neither can replace the other.
- **Update from anywhere but `/Applications`.** Replacing the bundle in place
  needs a writable location, so a copy run straight from the mounted `.dmg`
  reports that rather than failing quietly. Drag it to `/Applications` first.

A build you compiled yourself does not update — rebuild it instead.

If a package manager owns your copy, turn **Settings → General → Update Ensemblr
automatically** off. Ensemblr then never checks, downloads, or installs, and
leaves the upgrading to whatever installed it.

Building from source is the other path, and the rest of this page covers it.

## Building it yourself

### Prerequisites

| Requirement | Version | Check |
| --- | --- | --- |
| macOS | Apple silicon (arm64) | `uname -m` reports `arm64` |
| Node | **exactly 24.x** | `node -v` |
| npm | 11.17.0 | `npm -v` |
| git | any recent | `git --version` |

The Node pin is enforced, not advisory. `package.json` declares
`engines: ">=24 <25"`, and `.nvmrc` and `mise.toml` both pin 24. A version gate
runs at two points: on `npm install` (as `preinstall`) and again before
`package`, `build`, and `make`. If you use `mise`, the pin applies
automatically; otherwise `nvm use` reads `.nvmrc`.

Ignoring the pin fails in ways that do not look like a Node problem — see
[Troubleshooting](./14-troubleshooting.md) for the two symptoms.

### Build

```bash
git clone https://github.com/ensemblr-hq/ensemblr.git
cd ensemblr
npm install
npm run make
open out/make/
```

`npm install` does two things worth knowing about beyond fetching packages: it
runs the Node-version gate first, and afterwards it marks `node-pty`'s prebuilt
`spawn-helper` binaries executable. They ship without the exec bit, and skipping
that step surfaces much later as a terminal that will not open.

`npm run make` writes distributables to `out/make/`:

- a **`.dmg`** (ULFO format) — the primary distributable
- a **`.zip`** — a zipped `.app` for direct download

Drag the `.app` out of the `.dmg` into `/Applications` as usual.

If you only want to run the app and not distribute it, `npm run package` writes
an unpacked `.app` straight to `out/` and skips the disk-image step.

### Signing, notarization, and Gatekeeper

A build **of your own** is code-signed and notarized only when all three App
Store Connect credentials are present in the environment (the published release
above already is):

| Variable | What it holds |
| --- | --- |
| `APPLE_API_KEY_PATH` | Path to the `.p8` key file |
| `APPLE_API_KEY_ID` | The key id |
| `APPLE_API_ISSUER` | The issuer id |

Miss any one of them and the same `npm run make` produces an **unsigned** build
instead of failing. If you have no Apple developer credentials, be explicit
about it:

```bash
npm run make:unsigned
```

An unsigned app has a consequence you will hit on first launch: macOS
Gatekeeper refuses to open it, usually reporting that Ensemblr "is damaged and
can't be opened" or that it "cannot be opened because the developer cannot be
verified". Nothing is damaged — the app simply carries no notarization ticket.

To open it anyway:

1. In Finder, locate `Ensemblr.app`.
2. **Right-click** (or Control-click) it and choose **Open**.
3. Confirm **Open** in the dialog.

macOS remembers the exception, so subsequent launches work from the Dock or
Spotlight. Double-clicking it the first time does *not* offer that choice — the
right-click path is the one that works.

### Build channels

`ENSEMBLR_BUILD_CHANNEL` scopes both the bundle id and the product name:

| Channel | Command | Bundle id | Product name |
| --- | --- | --- | --- |
| `release` (default) | `npm run make` | `dev.ensemblr.app` | Ensemblr |
| `canary` | `npm run make:canary` | `dev.ensemblr.app.canary` | Ensemblr Canary |
| `dev` | `npm run make:dev` | `dev.ensemblr.app.dev` | Ensemblr Dev |

This matters to you, not just to the packager. A bundle id is what macOS Launch
Services uses to tell one installed app from another, and what Electron uses to
pick the userData directory. Because the channels do not share an id, you can
keep a canary build beside a release build without the two fighting over which
one macOS opens, and each keeps its own database, settings, and secrets. Two
builds sharing one id is what previously made a stray Dock tile flash during
workspace creation.

[`../build-and-release.md`](../build-and-release.md) has the full packaging
matrix, the entitlements, and the notarization detail.

## Where Ensemblr keeps things on disk

Five locations, and nothing outside them:

| What | Where |
| --- | --- |
| App settings | `~/.config/ensemblr/config.json` |
| Projects, workspaces, agent sessions, board state | `~/Library/Application Support/dev.ensemblr.app/ensemblr.db` |
| Window state, recents, per-repository overrides, Electron's own caches | `~/Library/Application Support/Ensemblr` |
| Secrets (Linear OAuth tokens, Infisical client secrets) | macOS Keychain, service `dev.ensemblr.app.secret-store` |
| Your repositories, worktrees, and archived context | The root directory you pick during setup — `~/Ensemblr` unless you change it |

The two Application Support directories split along a real seam. The
bundle-id-scoped one is Ensemblr's own SQLite store; the product-name one is
Electron's `userData`, which every packaged channel is deliberately pinned to so
a canary build opens the release's recents rather than a blank window. The dev
build — `electron-forge start`, not a packaged app — keeps both under a `(DEV)`
suffix instead, so dogfooding never writes over an installed copy's state.

The root directory is the only one that holds your own work. See
[First run](./03-first-run.md) for what Ensemblr creates inside it.

## Uninstalling

If Homebrew installed it, Homebrew removes it — `--zap` takes the application
data with it:

```bash
brew uninstall --zap --cask ensemblr
security delete-generic-password -s dev.ensemblr.app.secret-store
```

The Keychain entry needs its own line because `zap` cannot reach the Keychain at
all. It removes one entry at a time, so run it repeatedly if Ensemblr stored
several; they are also findable in Keychain Access by searching for
`dev.ensemblr.app.secret-store`.

Otherwise there is no uninstaller, and removing it is five deletions in whatever
order suits you:

```bash
# 1. The app itself
rm -rf /Applications/Ensemblr.app

# 2. App settings
rm -rf ~/.config/ensemblr

# 3. Local state — projects, workspaces, sessions, board
rm -rf ~/Library/Application\ Support/dev.ensemblr.app

# 4. Window state, recents, Electron's caches
rm -rf ~/Library/Application\ Support/Ensemblr

# 5. Keychain secrets
security delete-generic-password -s dev.ensemblr.app.secret-store
```

Your **root directory is deliberately not on that list**, and `brew zap` does not
touch it either. It holds the cloned repositories and git worktrees your work
actually lives in. Delete it only once you have confirmed everything you care
about is pushed. Ensemblr also preserves each archived workspace's handoff files
under `archived-contexts/` inside it.

Uninstalling does not touch anything the agent runtimes own — your `~/.claude`
directory, your Pi configuration, and your `gh` credentials all belong to those
tools and survive.

## Next

- [Requirements](./02-requirements.md) — what has to be on the machine before
  Ensemblr will open a workspace, expressed as the app's own setup checks.
- [First run](./03-first-run.md) — the setup wizard, the root directory, and
  your first workspace.
- [Troubleshooting](./14-troubleshooting.md) — if the build or the first launch
  went wrong.
