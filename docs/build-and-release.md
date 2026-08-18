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
npm run dev            # run the app in development (electron-forge start)

npm run package        # build an unpacked .app under out/ (arm64)
npm run make           # build distributables (.dmg + .zip) under out/make/
npm run verify:signing # assert what make just produced is signed and notarized
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

**A packaged dogfood channel is the same install wearing a different name.** The
identity is per-channel; the *state* is not. All three read one SQLite database
(`~/Library/Application Support/dev.ensemblr.app/ensemblr.db`, keyed on the
bundle id constant rather than the product name) and one
`~/.config/ensemblr/config.json`, and `src/main/main.ts` pins Electron's
`userData` to the release's directory for every packaged build so the
localStorage-backed recents, workspace selection and per-repo overrides come
along too. That also puts the channels behind one single-instance lock, which is
the correct reading given they share a database file — launching Canary while
Ensemblr is running folds into the running instance rather than opening a second
writer. The unpackaged `electron-forge start` build is the exception and keeps
its isolated `Ensemblr (DEV)` state.

## Outputs

`npm run make` writes to `out/make/`:

- **`.dmg`** (ULFO format) — the primary distributable.
- **`.zip`** — a zipped `.app` for auto-update / direct download.

`npm run package` writes the unpacked `.app` to `out/`.

A third artifact exists only on the release, not in `out/`: both workflows write
**`update-darwin-arm64.json`** and attach it beside the `.zip`. See
[The update feed document](#the-update-feed-document) below.

## Releasing

Releases are built by GitHub Actions on a `macos-15` runner, not on a laptop.
The local `npm run make` route above stays the escape hatch when CI is down or
you need to bisect a packaging break.

### Cutting a release

**Write the notes and create the release. That is the whole ritual.**

```bash
gh release create v0.1.0-beta.7 --notes-file NOTES.md --prerelease
```

That creates the tag and fires `release: published`, which triggers
[`.github/workflows/release.yml`](../.github/workflows/release.yml): it runs the
full `checks.yml` suite, builds, signs, notarizes, verifies, then attaches the
`.dmg` and `.zip` to the release you just made and corrects the prerelease flag
from the tag (`-alpha` / `-beta` / `-rc` → prerelease, anything else → latest).

**Pushing a bare `vX.Y.Z` tag does nothing on purpose** — there would be no notes
to attach to, and the six existing releases are hand-written prose that
`--generate-notes` would only degrade. If a tag exists but the build needs
re-running, dispatch the workflow manually with that tag as its input.

The workflow refuses to build when `package.json`'s `version` does not match the
tag with `v` stripped, or when the release is still a draft.

The README's version line and `.dmg` download URL stay hand-edited; the job
prints the exact two replacement lines to its run summary.

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
`Ensemblr-Canary-darwin-arm64.zip`). It is change-gated: a cheap Linux job
compares `master` against the commit the `nightly` tag already points at and
skips the build entirely when they match, so a quiet week republishes nothing.
The version is stamped as `<version>-nightly.<YYYYMMDD>.g<short-sha>` into the
build (never committed), so the About box names the commit.

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
  "url": "https://github.com/ensemblr-hq/ensemblr/releases/download/v0.1.0-beta.8/Ensemblr-darwin-arm64-0.1.0-beta.8.zip",
  "name": "0.1.0-beta.8",
  "notes": "…the release body…",
  "pub_date": "2026-08-18T04:00:00Z"
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

`checks.yml` doubles as a `workflow_call` reusable workflow so the release path
runs the same verification a PR does rather than a copy of it. Callers pass
`run_scan: false`: react-doctor diffs against `master`, which a release tag
already is.

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

- [ADR 0054](./adr/0054-build-releases-in-ci-and-reserve-the-nightly-tag.md) — why releases build in CI, the reserved tag namespace, and the shared channel state.
- [ADR 0055](./adr/0055-resolve-updates-in-app-against-the-github-releases-api.md) — why the in-app updater resolves its own feed, and why `update.electronjs.org` cannot serve either channel.
- [ADR 0031](./adr/0031-strip-launch-context-env-and-single-instance-lock.md), [ADR 0032](./adr/0032-channel-scoped-bundle-identity.md) — the Dock-flash fixes.
- [ADR 0042](./adr/0042-add-claude-code-as-a-second-first-class-agent-runtime.md) — why the Claude binary is not packaged.
- [`../.claude/rules/stack.md`](../.claude/rules/stack.md) — the pinned versions, the two `external` packages, and the `legacy-peer-deps` constraint.
- [`README.md`](../README.md) — tech stack and getting started.
- [`onboarding.md`](./onboarding.md) — the contributor runbook the build sits at the end of.
