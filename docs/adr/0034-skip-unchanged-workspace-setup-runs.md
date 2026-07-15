# 0034. Skip Setup Runs Whose Dependency Fingerprint Is Unchanged

Date: 2026-07-15

## Status

Accepted

Extends [0014](0014-use-conductor-style-setup-gate.md) (Conductor-style setup
gate), which re-ran the setup script on every workspace open.

## Context

The setup gate from 0014 runs a repository's setup script whenever a workspace
is opened so dependencies are installed before the agent or terminals start.
Re-running unconditionally reinstalls dependencies on every cold open and app
restart even when nothing the setup step depends on has changed, which wastes
time and churns the terminal dock on each launch.

## Decision

Gate the setup run on a declarative dependency fingerprint rather than on "has
this workspace been opened before".

- `computeSetupFingerprint` (`src/main/scripts/setup-fingerprint.ts`)
  SHA-256-hashes the resolved setup command together with the raw bytes of every
  dependency lockfile present in the worktree. The lockfile set is a fixed
  cross-ecosystem candidate list (`LOCKFILE_CANDIDATES`) covering
  npm/yarn/pnpm/bun, Cargo, poetry, `go.sum`, Gemfile, composer, and peers.
  Lockfiles are read as bytes so binary lockfiles such as `bun.lockb`
  fingerprint faithfully.
- The result is persisted in `workspaces.metadata_json` under a `setup` key as
  `{command, completedAt, fingerprint}` (`src/shared/scripts/setup-state.ts`) —
  workspace metadata, not a dedicated table.
- On open, `script-lifecycle-service.ts` skips setup when the recomputed
  fingerprint matches the persisted one, and runs it otherwise.

The fingerprint deliberately tracks *declared* dependencies (lockfiles), not
*installed* state. Deleting `node_modules` without touching a lockfile does not
re-trigger setup; a manual reinstall must be explicit.

## Consequences

- Cold opens and restarts skip redundant installs; setup runs only when the
  command or a lockfile actually changes.
- Setup state lives in `workspaces.metadata_json`; adding a new ecosystem means
  extending `LOCKFILE_CANDIDATES`.
- A stale install behind an unchanged lockfile is a known, accepted gap that
  requires an explicit reinstall from the user.
