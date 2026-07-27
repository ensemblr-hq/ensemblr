# 0039. Adopt nub as the Required Toolchain, Keeping the npm Lockfile Format

Date: 2026-07-27

## Status

Accepted

Supersedes the package-manager half of
[0038](0038-migrate-package-manager-bun-to-npm.md). The lockfile format that ADR
established is unchanged; only the CLI that drives it changes.

## Context

[nub](https://nubjs.com/docs) is a Rust CLI that augments stock Node.js: a script
runner, a full-TypeScript runtime, an npx replacement, a package manager, and a
Node version manager. It ships no runtime of its own, adds no globals, and adds
no `package.json` field — code keeps running on plain Node if nub is removed.

Three problems in this repo motivated the switch:

1. **Node-version drift silently broke builds.** `engines.node` is `>=24 <25`
   because Electron Forge produces *zero artifacts, with exit code 0*, under
   Node 26 — the reason `scripts/require-node-version.mjs` exists. Contributors
   whose default Node had moved on hit a build that refused to start. nub reads
   `.nvmrc` and provisions Node 24 itself, so the guard passes regardless of
   `PATH`. On the machine where this ADR was written, `npm run make` failed the
   guard on Node 26.5.0 while `nub run make:unsigned` produced a signed-skipped
   DMG.
2. **Script dispatch was the slowest part of the inner loop** across 68 scripts.
3. **`npx tsx scripts/*.ts`** needed a separate loader for the three TypeScript
   dev scripts.

## Decision

Require nub. Keep the npm on-disk format.

- `nub install` / `nub ci`, `nub run <script>`, `nubx <pkg>`, `nub add` /
  `nub remove`, and `nub <file>.ts` replace their npm equivalents.
- `package-lock.json` remains the only lockfile. `packageManager` stays on an npm
  version — counterintuitive but load-bearing: it is what makes nub treat npm as
  the *incumbent* and keep reading and writing `package-lock.json` rather than
  switching to nub identity and `nub.lock`. Electron Forge and the vendored
  shadcn skill also read that field.
- The enforcement hooks are renamed to `.claude/hooks/enforce-nub.sh` and
  `.codex/hooks/enforce-nub-package-manager.sh`, and now block `npm` and `npx`
  alongside `bun`, `pnpm`, and `yarn`.

Four repo changes were required to make nub work, each verified before adoption:

- **`legacy-peer-deps` had to go.** nub refuses it outright
  (`ERR_NUB_UNSUPPORTED_CONFIG`) because it always resolves peers. The setting
  existed for exactly one stale edge: `@electron-forge/plugin-fuses@7.11.2` peers
  on `@electron/fuses@^1.0.0` against the pinned `^2.1.3`, and it was the only
  such edge in 1492 packages. It is now pinned narrowly in `overrides` instead.
  npm resolves cleanly without the repo-wide escape hatch; the lockfile delta was
  four lines, all `dev` → `devOptional`.
- **`node-linker=hoisted` is mandatory.** `forge.config.ts` keeps the literal
  path prefixes `/node_modules/node-pty` and `/node_modules/node-addon-api`, and
  `scripts/fix-node-pty-permissions.mjs` globs `node_modules/node-pty/prebuilds/*`.
  Under nub's default isolated layout `node-addon-api` — a *transitive*
  dependency — is absent from the top level, and `nub run make` fails outright
  (observed: Rolldown could not resolve `@tanstack/query-core` from
  `@tanstack/react-query`). npm does not recognise the key and warns on every
  invocation; that noise is the accepted cost of one layout for both tools.
- **`allowBuilds` was added alongside `allowScripts`.** The existing
  `allowScripts` block is *not* dead Bun-era config — npm 12 reads it and gates
  install scripts with it. `allowBuilds` is nub's neutral equivalent. Both are
  kept so the deny of `core-js-pure` and `node-pty` is explicit under either tool
  rather than resting on nub's default-trust floor.
- **`tsconfig.json` `lib` moved `ES2022` → `ES2023`.** This was a latent bug nub
  merely exposed. The source uses `Array.prototype.findLast` (ES2023), and
  typecheck passed only because npm hoisted `type-fest@0.13.1` — which carries
  `/// <reference lib="esnext" />` — into the top-level slot. nub hoists
  `type-fest@5.8.0`, which does not, and typecheck failed. Any dedupe or
  dependency bump could have flipped that slot under npm too.

## Consequences

- Contributors must install nub (`brew install nub`). Fresh-workspace bootstrap
  (`.conductor/settings.toml`, `.ensemblr/settings.toml`) now runs `nub ci` and
  assumes nub is present.
- `mise.toml` was removed; `.nvmrc` stays. nub does not read `mise.toml` — a
  project pinned only by it falls back to the ambient Node (verified: `mise.toml`
  pinning 22 resolved to the PATH's 26.5.0, while `.nvmrc` pinning 22 provisioned
  22.23.1). `.nvmrc` is now the single Node pin, read by both nub and
  `scripts/require-node-version.mjs`, which removes a drift risk that previously
  spanned three files.
- The Conductor sandbox flag `--allow-remote=all` was dropped from the bootstrap
  command: npm absorbs unknown flags as config, nub rejects them
  (`unexpected argument '--allow-remote'`). If a sandboxed workspace needs
  network permission for the install, that has to be granted another way.
- CI is unaffected — `.github/workflows/checks.yml` has no `setup-node` and no
  install step.
- `tsx` stays in `devDependencies`. It is no longer a script runner here, but it
  is an optional peer of Vite (`vite -> tsx@^4.8.1`) used to load the `.mts`
  config files, and the root is the only other requirer. Removing it is not safe.
- **`nub rebuild` is now part of `build` / `package` / `make`.** nub compiles
  dependency build scripts against the *ambient* Node but runs scripts under the
  *pinned* Node, so on any machine whose default Node is not 24 the two diverge:
  `macos-alias` (raw V8 API, unlike the N-API `fs-xattr`) is built as
  `NODE_MODULE_VERSION 147` and then fails to load under 137, taking down the DMG
  maker. `nub rebuild` recompiles under the pin. This looks like an upstream nub
  bug — install-time and run-time Node should agree — and is worth reporting.
- `nub add` / `nub update` re-resolve the whole graph and can trip nub's
  supply-chain trust gate (`ERR_NUB_TRUST_DOWNGRADE`, observed on
  `@hono/node-server@1.19.15`). `nub install` and `nub ci` skip resolution
  against a current lockfile and are unaffected.
- **`minimumReleaseAgeStrict=false` was set.** nub holds a 24-hour cooling window
  over registry resolutions and by default *fails hard* when the only matching
  version is younger. That broke `nub run doctor` (`nubx react-doctor@latest`),
  which the code-review policy mandates, within a day of any react-doctor
  release. The documented per-package escape hatch
  (`minimumReleaseAgeExclude`) is read by `nub config` but is not honored on the
  `nubx`/`dlx` path in 0.6.0, so the graceful-degradation switch is used instead:
  resolution falls back to the newest *mature* version rather than erroring, and
  the cooling protection itself is retained.
- **`nubx` fails closed without a TTY.** Unlike `npx`, a registry fetch prompts
  for consent, so non-interactive callers (agents, CI) must pass `-y`. The
  `doctor` script does.
- Two upstream nub bugs are known and currently benign here:
  [nubjs/nub#570](https://github.com/nubjs/nub/issues/570) (hoisted layout does
  not link bins of hoisted transitive dependencies — `node_modules/.bin/node-gyp`
  is absent, but the native builds still succeed) and
  [#568](https://github.com/nubjs/nub/issues/568) (absolute symlinks in
  `node_modules/.bin`, which do not reach the packaged app — the built `.app`
  contains zero symlinks).
- nub is young: v0.6.0, first published 2026-05-27. The rollback is
  `git revert` of this change plus `npm ci`; nothing in `src/` depends on nub, so
  there is no application-code surface to unwind.

## Verification

Recorded at adoption, against nub 0.6.0 on macOS arm64:

- Dependency graph identical to npm's — 1263 unique `pkg@version` in both trees,
  zero missing, zero extra.
- `nub run check`, `nub run typecheck` green.
- `nub run test` — 147 files, 1085 tests passing.
- `nub run test:db`, `nub run test:terminal` — the
  `ELECTRON_RUN_AS_NODE=1 electron --test` path, including a real-PTY integration
  test, 33/33.
- `nub run dev` — Electron launches and stays up;
  [nubjs/nub#246](https://github.com/nubjs/nub/issues/246) (`EXC_BREAKPOINT` in
  `node::CreateEnvironment`) does not reproduce, having been fixed 2026-06-30.
- `nub run make:unsigned` — 140 MB DMG plus `.app`, native deps rebuilt,
  `spawn-helper` present at mode 0755 in the package.
