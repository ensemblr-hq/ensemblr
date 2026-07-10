# 0032. Scope the Bundle Identity to a Build Channel

Date: 2026-07-10

## Status

Accepted

Extends [0031](0031-strip-launch-context-env-and-single-instance-lock.md)
(strip launch-context env + hold a single-instance lock), which closed the
env-inheritance and direct-exec relaunch paths but left the underlying
bundle-id collision open.

## Context

After 0031 shipped, the packaged app still flashed a stray Ensemblr Dock tile
during new-workspace creation: a second process appeared and immediately quit.
0031 verified every child spawn strips the launch-context env, so no child
relaunches the app through an inherited `__CFBundleIdentifier`. The residual
flash has a different, ambient cause.

Every packaged build shared one bundle id, hardcoded in `forge.config.ts`:

```
appBundleId: 'dev.ensemblr.app'
```

On this dogfooding machine, `lsregister -dump` showed **four** packaged bundles
registered under that single id — the release-style build in one workspace's
`out/`, an `Ensemblr-canary.app` and an `Ensemblr-dev.app` from another, and a
**dangling** registration whose bundle had already been deleted:

```
dev.ensemblr.app  ⚠︎ COLLISION (>1 live bundle)
    [DANGLING] .../san-juan/out/.../Ensemblr.app
    [on-disk ] .../accra-v1/build/canary-macos-arm64/Ensemblr-canary.app
    [on-disk ] .../zurich/out/.../Ensemblr.app
    [on-disk ] .../accra-v1/build/dev-macos-arm64/Ensemblr-dev.app
```

To macOS Launch Services these are interchangeable registrations of one app.
When something resolves `dev.ensemblr.app` — a child touching Launch Services
while `git worktree add` runs, a re-open/activate event, or Launch Services
reconciling a stale entry — macOS can launch a *different* registered copy than
the one already running. That second process boots, hits the running instance's
single-instance lock (0031), and quits. The lock makes it brief; it does not
prevent it. The flash *is* the lock rejecting a sibling launch.

An end user with a single install never has a collision and never sees the
flash. This is a dogfooding artifact — but the fix must stop dogfood builds from
poisoning the release identity.

## Decision

Scope the bundle identity to a **build channel** using Electron Forge's own
`buildIdentifier` + `fromBuildIdentifier` mechanism (the documented way to vary
`appBundleId` per build). `forge.config.ts` reads `ENSEMBLR_BUILD_CHANNEL`
(default `release`) and resolves both the bundle id and product name per
channel:

| channel   | bundle id                    | product name     |
| --------- | ---------------------------- | ---------------- |
| `release` | `dev.ensemblr.app`           | `Ensemblr`       |
| `canary`  | `dev.ensemblr.app.canary`    | `Ensemblr Canary`|
| `dev`     | `dev.ensemblr.app.dev`       | `Ensemblr Dev`   |

- **Only the shipped release claims `dev.ensemblr.app`.** `npm run make` /
  `package` still default to `release`, so the store build is unchanged.
- **Dogfood builds get their own id**: `npm run make:dev` / `make:canary` set the
  env var. They can never masquerade as, or collide with, the release.
- **`main.ts` no longer clobbers the packaged product name.** It only applies the
  `(DEV)` suffix to the *unpackaged* `electron-forge start` build; a packaged
  build keeps the channel name forge baked in. Electron derives `userData` — and
  thus the single-instance lock — from that name, so each channel is a distinct
  app at runtime.
- **A diagnostic/remediation script** (`npm run diagnose:dock-flash`) lists every
  `dev.ensemblr.app*` registration, flags collisions and dangling entries, and
  (`--fix`) unregisters dangling ones. It does not touch live sibling builds in
  other workspaces — removing those is a deliberate choice.

`isDev = !app.isPackaged` and the renderer's `import.meta.env.DEV` amber tint
stay in lockstep as before (both mean "unpackaged Vite dev"). A packaged
dev/canary channel is a third, orthogonal concept — a release-shaped build with
a non-release identity — and legitimately carries no amber tint.

## Consequences

- Dogfood builds packaged with `make:dev` / `make:canary` register under a
  distinct id, so resolving `dev.ensemblr.app` can only ever find the release —
  eliminating the sibling-relaunch flash for the release build.
- Existing poisoning is cleared operationally with `diagnose:dock-flash --fix`
  (dangling) plus, for live siblings, rebuilding them on their channel or
  unregistering the stale `out/` bundle.
- `resolveDefaultDatabasePath()` still hardcodes the `dev.ensemblr.app` path
  segment, so a packaged `dev`/`canary` build isolates its `userData`/lock (name
  derived) but not yet its SQLite DB or config dir. That is a latent data-sharing
  issue for packaged dogfood channels, not a Dock-flash cause; isolating those
  paths per channel is deferred follow-up.
- The Electrobun builds on `accra-v1` have their own `electrobun.config.ts` and
  still emit `dev.ensemblr.app` for canary/dev; they need the same per-channel id
  treatment on that branch to stop poisoning from that source.
