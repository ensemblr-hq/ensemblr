## Ensemblr v0.1.0-beta.19

**Ensemblr runs on Linux.** This is the first release with a second platform: an x86-64 `.AppImage` built beside the macOS `.dmg`, with parity on every surface that used to branch on darwin. Signed, notarized and stapled on macOS; unsigned on Linux, because there is no equivalent to do.

### What's Changed

#### Features

* **Linux x86-64 ships as a first-class target, not a port**: Ensemblr was macOS-arm64 only. Nine main-process modules branched on `process.platform === 'darwin'` and three of them returned nothing anywhere else, so a Linux build would have launched with no secret store, no "Open in…" targets and a bare OS titlebar. Every one of those surfaces now has a Linux implementation declared per platform rather than branched inline. (#381)

  * **Packaging**: `@reforged/maker-appimage` scoped to linux, plus `APP_LINUX_APP_IDS` as the launcher-id counterpart of `APP_BUNDLE_IDS`, so a canary build cannot overwrite the release's desktop entry.
  * **Secrets**: Electron `safeStorage` ciphertext stored in the `secret_metadata` row (migration 023 widens the backend `CHECK`), rather than a keyring call the platform does not have. A Linux-only setup check warns when the keyring degrades to `basic_text`.
  * **"Open in…"**: the registry gains a per-platform behaviour map, so a cross-platform editor stays one entry; Linux resolves a launcher command or a `.desktop` entry and spawns it detached.
  * **Battery**: a sysfs reader, so the power-save blocker releases on a draining Linux laptop.
  * **Updates**: split into a capability — darwin installs, Linux reports the newer version and links to the release page, because the file is one you placed yourself and often lives somewhere read-only.
  * **Window chrome**: an `appearance.titleBar` setting choosing Ensemblr's own title bar or the desktop's, resolved once in `src/shared/window-chrome.ts` and read by both processes so they cannot disagree. Window minimums drop to 720×480 so a 1280×800 panel at 150% scaling still fits, and the x/y restore is skipped under Wayland, which forbids a client reading its own position.
  * **Shortcut labels**: a new `formatChord` replaces ~24 literal ⌘ glyphs, four of them re-authored out of translated strings into interpolation, so a machine with no Command key reads `Ctrl`. Off darwin the File menu gains Settings, Check for Updates and Quit, and Help gains About.
  * **CI**: `check`, `typecheck` and `test` now run on `ubuntu-latest` as well as `macos-latest`, which is what makes a darwin-only assumption fail there rather than in a user's AppImage. Both release workflows gain a `build-linux` job.

  `make:linux` refuses to run off Linux. `node-pty` publishes no linux-x64 prebuild, so cross-building from macOS silently packages the host's Mach-O `pty.node` — Forge reports `Preparing native dependencies: 1 / 1` and the resulting AppImage launches with every terminal dead. Ships with `ru` and `el` at 100%. See [ADR 0056](https://github.com/ensemblr-hq/ensemblr/blob/master/docs/adr/0056-ship-a-linux-amd64-appimage.md).

#### Fixes

* **The Linux window has a title bar of its own, and its controls work**: the app-drawn window controls shipped as a fixed overlay in the top-right corner, with a 7rem trailing inset every `.native-toolbar` reserved for them. That was wrong twice. It crowded whichever toolbar reached the trailing edge — on a review sidebar, the pull-request header put a PR number, a preview pill, a status label and a primary action in one row with three buttons. And the buttons did not work at all: Chromium reports draggable regions in document order and Electron unions them in that order, so a `-webkit-app-region: drag` toolbar painted after the cluster re-covered the `no-drag` holes its own buttons had punched, and every click dragged the window instead. The overlay is replaced by a real 2.25rem title bar across the window's top edge carrying the wordmark and the control cluster, with `body` padded by the same inset so the shell is sized to what is left rather than covered at the top. `WindowChromeInsets` swaps `end` for `top`, a new `--ensemblr-shell-height` replaces `100svh` in the shell, settings and onboarding insets, and the dead trailing-inset machinery is gone. (#382)

* **The Linux About panel knows its own name, version and icon**: Electron's About panel on Linux is GTK's, and it reads nothing on its own. `installApplicationMenu` set only `copyright`, so the dialog fell back to `g_get_application_name()` — which under an AppImage is the executable's file name, titling the panel `Ensemblr-0.1.0-beta.18-x64.AppImage` — and with no `iconPath` it looked the icon up in the desktop's theme by a name an unintegrated AppImage never installs, drawing GTK's broken-image glyph. A new `src/main/menu/about-panel.ts` returns the full option set: `applicationName`, `applicationVersion`, `authors`, `copyright`, `website`, and `iconPath` from the same PNG a Linux window already carries. The icon path is omitted off Linux, where macOS reads it off the bundle. (#382)

#### Documentation

* **The docs learned about the second platform**: the guide, the requirements page and the install page were written when macOS was the only target and still described the Keychain, the `.dmg` and Gatekeeper as the whole story. Platform coverage, the AppImage install path, the Linux secret store and the report-only updater are now documented alongside their macOS counterparts.

* **Version pins and structural counts refreshed**: `docs/README.md` and the guide were pinned two releases back at `0.1.0-beta.16`. The ADR count moves 54 → 55 (`0001`–`0056`, `0007` withdrawn), shared-root modules 32 → 34, and the test-suite counts 202/317/38 → 212/327/38.

* **A missing changelog entry backfilled**: `CHANGELOG.md` skipped `0.1.0-beta.18` entirely, jumping from Unreleased to `0.1.0-beta.17`. Both it and this release are now recorded.

---

*Full changelog*: https://github.com/ensemblr-hq/ensemblr/compare/v0.1.0-beta.18...v0.1.0-beta.19
