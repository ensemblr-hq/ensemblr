# 0056. Ship A Linux amd64 AppImage

Date: 2026-08-30

## Status

Accepted

Extends [ADR 0032](0032-channel-scoped-bundle-identity.md): the per-channel
identity it established gets a Linux counterpart, `APP_LINUX_APP_IDS`, for the
same reason — a canary must not overwrite the release's launcher entry.
Constrains [ADR 0055](0055-resolve-updates-in-app-against-the-github-releases-api.md):
the feed resolver it built now answers on a platform that may read it but must
not act on it.

## Context

Ensemblr shipped macOS-arm64 only. `package.json` called it "A macOS workbench",
`npm run make` hardcoded `--arch=arm64`, and the two makers were `MakerDMG` and
`MakerZIP` scoped to `['darwin']`.

The port was not a matter of adding a maker. Nine main-process modules branched
on `process.platform === 'darwin'`, and three of them returned *nothing* off
darwin — so a Linux build would have launched and come up with no secret store
at all (no Linear, no Infisical, no dictation key, no secret workspace
environment variables), no "Open in…" targets beyond "Copy path", and a bare OS
title bar where macOS gets `hiddenInset` chrome. A build that starts and then
silently drops half the app is worse than no build.

The target host driving the decisions below is a Steam Deck in Desktop Mode: a
Wayland session under KDE Plasma, an immutable root with no working package
manager, a 1280×800 panel commonly run at fractional scaling, and a battery.

## Decision

Ship a Linux x86-64 AppImage as a first-class target, with parity on every
surface a darwin branch previously owned.

### AppImage, not deb / rpm / flatpak

One file the user makes executable and runs. It needs no root, no package
manager, and no repository — which is the whole point on an immutable distro
like SteamOS, where `pacman` is not a usable install path and adding one is the
user's problem, not ours. A `.deb` would cover one family, an `.rpm` another,
and a Flatpak would put the app inside a sandbox it then has to punch holes in:
Ensemblr spawns the user's own `git`, `gh`, `pi`, `claude` and login shell, and
reads and writes worktrees anywhere on disk. That is the opposite of what a
Flatpak manifest is for.

`@reforged/maker-appimage` is the maintained AppImage maker for Forge — there is
no `@electron-forge/maker-appimage`. It declares `mksquashfs` as a required
external binary, so CI installs `squashfs-tools`; the type2 runtime it downloads
at make time is statically linked and no longer requires libfuse2 on the target,
with `--appimage-extract-and-run` as the documented fallback for a host with no
FUSE at all.

The maker's `bin` option is set to the *product* name rather than the launcher
id, because it names the executable Forge's packager actually produced and the
maker throws when that file is absent. `name` stays the lowercase launcher id.

### `safeStorage`, not `secret-tool`

Linux has no Keychain to shell out to. Electron's `safeStorage` already wraps
whatever the session provides — gnome-libsecret, KWallet 5 or 6 — behind one
API, with no new dependency and no subprocess.

It hands back opaque bytes with nowhere to put them, so the ciphertext goes in
the `secret_metadata` row beside the entry it belongs to (migration
`023_secret_value_blob`). That makes a Linux row not purely non-sensitive, which
is why the column is a BLOB: `encryptString` returns bytes that are not valid
UTF-8. It stays NULL for every Keychain-backed row.

Shelling out to `secret-tool` was the alternative. It would have meant a
runtime dependency the user has to install, one that exists only in the
libsecret world and answers nothing on a KWallet session — precisely the Deck's
configuration.

**A missing keyring is a warning, not a crash.** That fallback is opt-in:
`safeStorage.setUsePlainTextEncryption(true)` is called on Linux before the
first store, or `isEncryptionAvailable()` stays false on a session with no
daemon and every read and write throws — taking Linear, Infisical, dictation
and secret workspace environment variables down with it. With it,
`getSelectedStorageBackend()` returns `basic_text` and values are obfuscated
with a hardcoded key rather than encrypted. A Linux-only setup check reports
that, so the user learns it from the diagnostics screen instead of from a
breach.

**A decrypt failure degrades per secret.** The row records which keyring
encrypted it (migration `024_secret_keyring_backend`), so a value written under
one backend and read under another says so by name instead of guessing, and the
environment assembly reports it as one `secret-value-undecryptable` diagnostic
rather than rejecting the whole layer and leaving the workspace with no
terminal.

### One `~/.config/ensemblr`, with Electron's state nested inside it

Electron derives `userData` from the product name, so on Linux its default is
`~/.config/Ensemblr` — sitting beside the `~/.config/ensemblr` that already
holds `config.json` and `ensemblr.db`. Two directories one capital letter apart
is indistinguishable from a bug, and neither name tells the user which one is
theirs.

`userData` therefore points at `~/.config/ensemblr/electron`. The user sees one
directory whose top level is only the two files they ever open; everything
Chromium generates — `sessionData` defaults to `userData`, so cookies, Local
Storage and the disk cache come along — is one clearly-named subdirectory they
can ignore. macOS is untouched: `~/Library/Application Support/Ensemblr` is not
a directory anyone browses, and the release-channel pin there exists for a
different reason (a packaged Canary must open the release's recents).

The Linux path needs no such pin — it is derived from the config directory,
which was already channel-independent, so every packaged channel shares one
`userData` and one single-instance lock for free.

Merging the two outright was the alternative: put Electron's `Cache/`,
`GPUCache/` and `Local Storage/` directly beside a `config.json` the user is
expected to hand-edit. One directory either way, but the nested form keeps the
top level readable.

### Bespoke app-drawn window controls, not Window Controls Overlay

In `custom` mode the window is `titleBarStyle: 'hidden'` with **no**
`titleBarOverlay`, so Chromium draws nothing and Ensemblr's three buttons —
minimize, maximize/restore, close — are the only ones. They are drawn in the
app's own visual language, top-right, with no attempt to mimic GNOME's or KDE's
button sets or ordering: imitating one desktop is guaranteed to be wrong on the
other, and a half-right imitation reads as a bug where an honestly different
cluster reads as a choice.

Window Controls Overlay was the alternative. It would have let Chromium draw the
buttons, at the cost of a safe area that changes per desktop and has to be read
through `env(titlebar-area-*)` at runtime. Drawing them ourselves collapses that
to a constant.

Close routes through the window's own `close` event, never `app.quit()`, so the
quit coordinator still runs the "agents are still running" confirmation. The
maximized state comes from a main-process broadcast rather than the button's own
last click, because the compositor's keyboard shortcuts change it too.

**`system` is the escape hatch.** `titleBarStyle` is a constructor option, so
the setting needs a relaunch — which the Appearance row offers through the quit
coordinator, draining running agents on the way out. A compositor that
mishandles a frameless window is therefore one setting and one click away from
an ordinary decorated one.

### Updates notify, they do not install

`checkUpdatePreconditions` now returns a capability rather than a bare failure:
`install` on darwin, `check-only` on Linux, `none` otherwise. A check-only build
resolves the same GitHub-releases feed, reports the newer version, and links to
the release page.

Squirrel is macOS-only, and there is nothing to replace it with here that would
be honest: an AppImage is a single file the user placed themselves, often on a
read-only mount, often owned by a package manager or a launcher that would be
overwritten behind its back. The resolver additionally requires the release to
carry an `.AppImage` asset before offering a Linux user the version, so a
release that shipped nothing for them is not advertised.

### Window minimums, and Wayland

`MAIN_WINDOW_MIN_WIDTH`/`HEIGHT` drop from 960×640 to 720×480. A 1280×800 panel
at 150% scaling reports an 853×533 logical viewport — under the old floor, so
the window could not fit its own minimum and the compositor sized it off-screen.
The shell's narrow-viewport rules already collapse the sidebar well above the
new floor.

Wayland itself needs no configuration: Electron 38 removed
`ELECTRON_OZONE_PLATFORM_HINT` and made native Wayland the default in a Wayland
session, so this Electron 43 gets it automatically. What Wayland forbids is a
client reading or setting its own position, so the persisted `x`/`y` restore is
skipped there — size, maximized and full-screen still restore.

## Consequences

- `npm run make:linux` / `npm run package:linux` build for `--platform=linux
  --arch=x64`. `make`/`package`/`build` stay on `--arch=arm64` and the macOS path
  is unchanged; `notarizationEnabled` already required darwin, so signing and
  stapling no-op.
- CI grows a Linux leg. `checks.yml` runs `check`/`typecheck`/`test` on
  `ubuntu-latest` as well as `macos-latest`, which is what makes a darwin-only
  assumption fail there rather than in a user's AppImage — the keymap suites now
  assert whichever mapping the runner has. `release.yml` and `nightly.yml` each
  grow a separate `build-linux` job that skips `verify:signing`.
- Electron's `userData` is `~/.config/ensemblr/electron` on Linux, so the app
  owns exactly one directory under `~/.config` rather than a case-differing pair.
- Platform differences are declared, not branched inline. The "Open in…"
  registry carries a `platforms` map so adding an editor that exists on both is
  a single-entry edit; the window chrome is one resolver in `src/shared/` that
  main and the renderer both read, so the two can never disagree about who draws
  the title bar.
- Intel macOS and arm64 Linux are still not built, and Windows is not supported.
- The Deck's own checks — the AppImage mounting, KWallet round-tripping a
  secret, resize edges on a frameless Wayland window, `~/.local/bin` executable
  discovery — are physical and cannot be proven in CI.
