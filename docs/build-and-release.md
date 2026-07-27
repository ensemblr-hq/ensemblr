# Build & Release

Ensemblr packages as a **macOS, arm64** app through Electron Forge. A release
build is code-signed with a hardened runtime and notarized, and ships as both a
`.dmg` and a `.zip`. This guide covers the build matrix, signing, and the build
channels. The packaging config lives in `forge.config.ts`.

## Prerequisites

- **macOS on Apple silicon** (builds are arm64-only).
- **Node `>=24 <25`** — enforced by `scripts/require-node-version.mjs`, which
  `package`/`make` run first.
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
npm run dev          # run the app in development (electron-forge start)

npm run package      # build an unpacked .app under out/ (arm64)
npm run make         # build distributables (.dmg + .zip) under out/make/
```

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
unsigned build instead of failing.

## Signing & notarization

Signing/notarization is gated on `notarizationEnabled` — true only on macOS when
all three Apple credentials are present and signing was not skipped. When it is:

- The packager signs each file with the `entitlements.plist` entitlements and a
  hardened runtime, then notarizes the `.app` (`osxSign` / `osxNotarize`).
- A `postMake` hook notarizes and staples **each `.dmg`** separately (via
  `xcrun notarytool submit --wait` + `xcrun stapler staple`), because the DMG
  container is an artifact Apple never saw during packaging. Stapling lets
  Gatekeeper validate the disk image offline on first open.

Set **`ENSEMBLR_SKIP_SIGN=1`** to force an unsigned, un-notarized build even when
credentials are present — useful for fast local iteration that skips the
signing/notarization cost.

The app is additionally hardened via Electron Fuses (run-as-node disabled, cookie
encryption on, ASAR integrity validation, load-only-from-ASAR).

## Build channels

The **channel** (`ENSEMBLR_BUILD_CHANNEL`, default `release`) scopes both the
bundle id and product name so dogfood builds never collide with the release's
macOS Launch Services registration:

| Channel | Bundle id | Product name |
| --- | --- | --- |
| `release` | `dev.ensemblr.app` | Ensemblr |
| `canary` | `dev.ensemblr.app.canary` | Ensemblr Canary |
| `dev` | `dev.ensemblr.app.dev` | Ensemblr Dev |

Only the shipped release claims the canonical id. Sharing one id across multiple
installed builds is what caused a stray Dock tile to flash during workspace
creation — see [ADR 0032](./adr/0032-channel-scoped-bundle-identity.md) (and
[ADR 0031](./adr/0031-strip-launch-context-env-and-single-instance-lock.md) for
the env-strip + single-instance lock that closed the other path).

## Outputs

`npm run make` writes to `out/make/`:

- **`.dmg`** (ULFO format) — the primary distributable.
- **`.zip`** — a zipped `.app` for auto-update / direct download.

`npm run package` writes the unpacked `.app` to `out/`.

## Troubleshooting

- **Stray Dock icon / duplicate instance.** Run `npm run diagnose:dock-flash`
  (`scripts/diagnose-dock-flash.mjs`): it lists every `dev.ensemblr.app*` Launch
  Services registration and flags id collisions and dangling entries; add
  `--fix` to unregister dangling ones (live sibling builds are left alone).
- **Node version error at build.** `require-node-version.mjs` refuses to build on
  a Node outside `>=24 <25`; switch with `nvm`/`mise` (`.nvmrc` / `mise.toml`).
- **App icon.** Regenerate with `npm run icon:generate`
  (`scripts/generate-app-icon.mjs`).

## See also

- [ADR 0031](./adr/0031-strip-launch-context-env-and-single-instance-lock.md), [ADR 0032](./adr/0032-channel-scoped-bundle-identity.md) — the Dock-flash fixes.
- [`README.md`](../README.md) — tech stack and getting started.
