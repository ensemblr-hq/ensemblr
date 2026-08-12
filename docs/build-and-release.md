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

- [ADR 0031](./adr/0031-strip-launch-context-env-and-single-instance-lock.md), [ADR 0032](./adr/0032-channel-scoped-bundle-identity.md) — the Dock-flash fixes.
- [ADR 0042](./adr/0042-add-claude-code-as-a-second-first-class-agent-runtime.md) — why the Claude binary is not packaged.
- [`../.claude/rules/stack.md`](../.claude/rules/stack.md) — the pinned versions, the two `external` packages, and the `legacy-peer-deps` constraint.
- [`README.md`](../README.md) — tech stack and getting started.
- [`onboarding.md`](./onboarding.md) — the contributor runbook the build sits at the end of.
