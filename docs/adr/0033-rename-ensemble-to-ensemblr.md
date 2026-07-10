# 0033. Rename Ensemblr to Ensemblr

Date: 2026-07-10

## Status

Accepted

Supersedes the bundle-identity scheme of
[0032](0032-channel-scoped-bundle-identity.md) (channel-scoped bundle identity),
whose per-channel table was rooted at `dev.ensemblr.app`. The channel-scoping
mechanism is unchanged; only the identity root moves.

## Context

The product name changed from **Ensemblr** to **Ensemblr** to match the newly
secured **ensemblr.dev** domain. The rename is about identifiers and on-disk
paths, not links: no product domain or URL was wired anywhere before, so there
was nothing to swap — `ensemblr.dev` is net-new.

The rename landed cheaply because the app is pre-release: `version 0.1.0`,
`private`, no signing/notarization, no auto-updater or publisher, and the
`ensemblr://` scheme was parsed but never OS-registered. Orphaning existing
on-disk state on rename therefore costs nothing a re-init cannot recover.

Earlier project memory described an "Electrobun migration"; that belongs to a
different branch (`accra-v1`). Ground truth on this branch is **Electron Forge**
(`forge.config.ts`) — macOS bundle metadata is synthesized by Forge at package
time, with no in-tree `Info.plist` / `*.entitlements` / `build.json`.

## Decision

Rename every identifier, path, and brand surface from `Ensemblr` to `Ensemblr`
(case-preserving) with **no migration shims** — a clean break. Bundle
identifiers switch to the **reverse-DNS of the new domain**.

| concern | old | new |
| --- | --- | --- |
| product / display name | `Ensemblr` / `Ensemblr Canary` / `Ensemblr Dev` | `Ensemblr` / `Ensemblr Canary` / `Ensemblr Dev` |
| package name | `ensemblr` | `ensemblr` |
| bundle id (per channel) | `dev.ensemblr.app[.canary\|.dev]` | `dev.ensemblr.app[.canary\|.dev]` |
| keychain service | `dev.ensemblr.app.secret-store[.dev]` | `dev.ensemblr.app.secret-store[.dev]` |
| App Support segment | `dev.ensemblr.app` | `dev.ensemblr.app` |
| config dir / DB | `~/.config/ensemblr`, `ensemblr.db` | `~/.config/ensemblr`, `ensemblr.db` |
| root dir | `~/Ensemblr` / `~/Ensemblr Dev` | `~/Ensemblr` / `~/Ensemblr Dev` |
| repo config dir | `.ensemblr/settings.toml` | `.ensemblr/settings.toml` |
| env prefix | `ENSEMBLR_*` (incl. `ENSEMBLR_BUILD_CHANNEL`) | `ENSEMBLR_*` (incl. `ENSEMBLR_BUILD_CHANNEL`) |
| deep-link scheme | `ensemblr://` | `ensemblr://` |
| JS global | `window.ensemblr`, `ensemblrInitialShellSnapshot` | `window.ensemblr`, `ensemblrInitialShellSnapshot` |
| checkpoint ref namespace | `refs/ensemblr/checkpoints/` | `refs/ensemblr/checkpoints/` |
| internal identifiers | `EnsemblrApi`, `EnsemblrDatabaseService`, … | `Ensemblr*` equivalents |
| CSS tokens / keyframe | `--ensemblr-*`, `ensemblr-wordmark-flicker` | `--ensemblr-*`, `ensemblr-wordmark-flicker` |
| query key / IPC prefix | `['ensemblr']`, `'ensemblr:'` | `['ensemblr']`, `'ensemblr:'` |

- The welcome wordmark renders `ENSEMBLR`: a new 5×7 dot-matrix `R` glyph was
  added and the trailing `E` dropped. The app-icon `E` monogram stays valid
  (Ensemblr still starts with E); `assets/icon.{svg,icns,png}` were regenerated.
- The `src/renderer/api/ensemblr/` directory and the `ensemblr-queries` /
  `ensemblr-api` barrels were renamed to their `ensemblr` equivalents.

### Scope explicitly excluded

- **Historical ADRs are immutable**: filenames and bodies (including 0032's
  `dev.ensemblr.app` table and `ENSEMBLR_BUILD_CHANNEL`) are left as-is; they
  record decisions at their point in time. Cross-links from
  `docs/product/**` stay valid.
- **The Linear project of record stays named `Ensemblr`** — it is an external
  system, renamed (if ever) as a separate manual step. `AGENTS.md` preserves
  that reference.
- Registering `ensemblr://` with the OS, standing up an ensemblr.dev site,
  signing/notarization, auto-update, and renaming the GitHub repo are all
  out of scope (none exist today; note as manual follow-ups).

## Consequences

- **Existing on-disk state is orphaned** and must be re-initialized once:
  `~/Library/Application Support/Ensemblr` + `.../dev.ensemblr.app`,
  `~/.config/ensemblr`, and keychain `dev.ensemblr.app.secret-store` secrets
  (including the Linear OAuth token → re-auth).
- **Configured dogfood repos** carry a committed `.ensemblr/settings.toml`;
  after rename the app reads `.ensemblr/settings.toml`. Each repo must have that
  directory renamed or be re-configured. **Manual step.**
- **LaunchServices** still holds registrations for the old `dev.ensemblr.app*`
  ids. Per 0032, stale/dangling registrations cause the Dock-flash regression.
  Clear them before/after the first new-id launch:
  `lsregister -u <old .app>`, remove old `Ensemblr*.app` copies, and confirm
  `lsregister -dump | grep -i ensemblr` is empty. `npm run diagnose:dock-flash`
  now targets `dev.ensemblr.app*`.
- Checkpoint refs under the old `refs/ensemblr/checkpoints/` namespace are
  orphaned; new checkpoints write under `refs/ensemblr/checkpoints/`.
