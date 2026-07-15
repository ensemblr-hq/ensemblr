# 0038. Migrate the Package Manager From Bun to npm and Enforce It

Date: 2026-07-15

## Status

Accepted

Sibling to [0031](0031-strip-launch-context-env-and-single-instance-lock.md) and
[0032](0032-channel-scoped-bundle-identity.md), which the same migration commit
introduced for the launch-environment half of the work. This ADR records the
package-manager half, which had no dedicated record.

## Context

The project used Bun for JavaScript/TypeScript package management and test
running. The migration commit that hardened the build and launch environment
also switched the package manager, but only the launch-env decisions were
captured as ADRs (0031, 0032). The package-manager change is a repo-wide,
hook-enforced constraint and deserves its own record, even retroactively.

## Decision

Standardize on npm for all JavaScript/TypeScript package management and drop
Bun.

- Remove `bun.lock`; add `package-lock.json` and `.npmrc`; set `package.json`
  `packageManager` to an npm version.
- Pin Node 24 (`scripts/require-node-version.mjs`, `mise.toml`) and package the
  `node-pty` native module against the pinned Electron ABI.
- Swap Bun test scripts to Vitest for renderer and shared tests.
- Enforce the policy with `.claude/hooks/enforce-npm.sh` and
  `.codex/hooks/enforce-npm-package-manager.sh`, which block direct `bun`,
  `bunx`, `pnpm`, `pnpx`, `yarn`, `yarnpkg`, and matching `corepack`
  package-manager calls.

## Consequences

- All tooling, CI, and agent workflows use npm; the lockfile of record is
  `package-lock.json`.
- Native modules must be explicitly packaged for the pinned Node/Electron ABI.
- Documentation and tooling references that still say `bun …` (for example the
  Pi fixture generator command and any `~/.bun/...` install paths) are stale and
  should be rewritten to their `npx tsx …` / npm-global equivalents.
- This is largely a retroactive record of an already-shipped, already
  policy-documented decision (see the Package Manager Policy in `CLAUDE.md`).
