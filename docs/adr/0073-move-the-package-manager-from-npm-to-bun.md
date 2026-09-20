# 0073. Move the Package Manager From npm to Bun, Keep Node as the Runtime

Date: 2026-09-21

## Status

Accepted

Supersedes [0038](./0038-migrate-package-manager-bun-to-npm.md), which moved the
repository from Bun to npm and enforced it with hooks. The parts of 0038 that are
not about the package manager stand: Node 24 is still pinned by
`scripts/require-node-version.mjs`, `mise.toml`, and `.nvmrc`; renderer and shared
tests still run under Vitest; and `node-pty` is still packaged against Electron's
ABI. What is reversed is the choice of npm, its lockfile, `.npmrc`, and the hook
policy that blocked `bun`.

Builds on [0056](./0056-ship-a-linux-amd64-appimage.md) for the Linux `node-pty`
constraint the trust list below protects, and is shipped in the same release as
[0074](./0074-ship-four-build-targets-and-select-updates-by-architecture.md).

## Context

`.ensemblr/settings.toml` runs the setup script once per workspace, and Ensemblr
makes one git worktree per workspace. Every workspace therefore ran `npm ci` into
a fresh directory: 845 packages extracted into a new ~1.1 GB `node_modules`, at
roughly 26 s warm and 40 s cold. Creating a workspace is the operation Ensemblr
exists to make cheap, and this was the longest step in it.

Bun keeps one global cache and, on APFS, populates a new `node_modules` from it by
clonefile or hardlink. Measured on the development machine:

| Command | Time |
| --- | --- |
| `npm ci` (baseline) | ~26 s warm, ~40 s cold |
| `bun install`, absent `node_modules`, warm global cache | 7.1 s |
| `bun ci`, warm | 0.2 s |

0038 recorded the move to npm retroactively and gave no measurement for it; its
stated concern was that native modules had to be built against the pinned
Node/Electron ABI. That concern is not dismissed here. It is met differently:
Bun is now only the package manager and script runner, Node 24 stays the runtime
for every `node scripts/*.mjs`, Vite, Forge, Vitest, and the `electron --test`
suites, and the one module whose binding depends on an ABI is kept out of Bun's
hands (see *Trust list*).

Bun does **not** shim itself as `node`. Probed on Bun 1.4.2: in `bun run <script>`
and in `preinstall`/`postinstall`, `node` resolves to the real Node on `PATH` and
`process.versions.bun` is `undefined`. Root `preinstall` and `postinstall` both
run under `bun install`, so the Node-version gate still fires at install time.

## Decision

Standardize on Bun 1.4 for package management and script execution. Node 24
remains the runtime.

### The lockfile stays at version 1, and how it was made matters

`bun.lock` (text) replaces `package-lock.json` at **`lockfileVersion: 1`**, and
must stay there. dependabot-core's Bun ecosystem sets
`MAX_SUPPORTED_LOCKFILE_VERSION = 1` and its parser *raises* on anything higher,
so a version-2 lockfile stops dependency PRs arriving with no error anywhere in
this repository. Bun 1.4 raised its own default stamp to 2, so a lockfile
regenerated from scratch under a current Bun is one Dependabot cannot read.
`scripts/check-lockfile-version.mjs` (`bun run check:lockfile`, wired into
`bun run check`) fails on any other version and on a stray binary `bun.lockb`;
`bunfig.toml` sets `saveTextLockfile = true` so the binary form is never written.

A plain `bun install` with no lockfile is the trap: it silently re-resolves the
whole graph. In the migration that moved 211 packages, including `electron`
44.3.0 → 44.4.3 and `lucide-react` 1.43.0 → 1.47.0, and the `lucide-react` move
broke a test. The sequence that preserved the npm graph exactly was:

1. `bun pm migrate` under **Bun 1.4.2**. Bun 1.3.13 fails with
   `InvalidNPMLockfile` on the npm v3 lockfile, so 1.4.2 is the only version that
   can read it.
2. That writes `lockfileVersion: 2`. Stamp it back to `1` by hand.
3. Run `bun install` under **Bun 1.3.13**, which understands only version 1.
   Loading the file successfully is what proves the downgrade valid, and it
   rewrites the file natively in v1.

Result, verified: zero dependency drift — all 1250 packages resolve to the
versions the npm lockfile pinned. The pin is temporary; raise
`SUPPORTED_LOCKFILE_VERSION` in the check script in the same change that
regenerates the lockfile once dependabot-core moves.

### The hoisted linker

`bunfig.toml` sets `linker = "hoisted"`. Forge's `PACKAGE_KEEP_*` filters in
`forge.config.ts` match flat `/node_modules/<pkg>/` paths; Bun's isolated linker
builds a symlinked `node_modules/.bun/` store those filters would not match, and
the packaged app would ship without `node-pty` and the Claude Agent SDK. Bun
already defaults to hoisted for a project without workspaces, but the setting is
pinned so a future change of default cannot break packaging silently.

### The trust list

`package.json` gains `trustedDependencies: ["esbuild", "fs-xattr", "macos-alias"]`
and drops npm's `allowScripts`. An explicit list **replaces** Bun's built-in
allowlist rather than extending it, so this is the complete set of packages whose
install scripts run.

**`node-pty` is deliberately excluded.** On macOS it uses the shipped
`prebuilds/darwin-arm64` and `prebuilds/darwin-x64` (there is no `build/Release`
in the installed tree). On Linux it has no prebuild, and the binding must come
from Forge's `@electron/rebuild` against *Electron's* ABI. If Bun ran node-pty's
install script on Linux it would compile against *Node's* ABI instead — the
mismatch `scripts/require-linux-toolchain.mjs` exists to catch. The three scripts
that stay blocked, `node-pty`, `@swc/core`, and `core-js-pure`, are exactly the
entries npm's `allowScripts: false` listed. **`bun pm trust --all` must never be
run in this repository.** It also retires "failure one" of the old Linux story,
the `node-gyp rebuild` that fired during `npm ci`.

### No `.npmrc`, no wrapper

`.npmrc` is removed. Its `legacy-peer-deps=true` existed for
`@electron-forge/plugin-fuses@7`'s stale `@electron/fuses@^1` peer range; Bun
tolerates that natively, and exactly one `@electron/fuses@2.1.3` resolves, so no
override replaces it.

`scripts/with-pinned-node.sh` is removed. It predates the app's own fix and is
redundant for everything Ensemblr spawns: `src/main/main.ts` wires
`createToolchainPathResolver`, `src/main/environment/toolchain-path.ts` captures a
**login shell's** `PATH` for the workspace directory (which evaluates that
directory's `mise.toml` and so puts Node 24 and Bun on it), and
`src/main/environment/workspace-environment.ts` injects it into setup scripts, run scripts,
and terminals. The gate is `if (resolveToolchainPath && !('PATH' in env))` — the
presence of a `PATH` **key**, not its truthiness. Setting `PATH` in
`[environment_variables]`, even to an empty string, silently switches the
resolver off and the original wrong-Node bug returns. It must never be set there.

`mise.toml` gains `bun = "1.4"` beside `node = "24"`.

### Scripts and enforcement

`package.json` `packageManager` is `bun@1.4.2`. Self-calling scripts are
`bun run …`, `doctor` is `bunx react-doctor@latest`, and no build script
hardcodes an architecture (see 0074). `bun test` is Bun's own runner, not Vitest,
so the Testing Policy in `AGENTS.md` says to use `bun run test`. The hooks that
blocked `bun` now block `npm`, `npx`, `pnpm`, `pnpx`, `yarn`, and matching
`corepack` calls: `.claude/hooks/enforce-bun.sh` and
`.codex/hooks/enforce-bun-package-manager.sh` replace the `enforce-npm` pair.

## Consequences

- A new workspace's dependency install falls from ~26–40 s to seconds on a warm
  cache, and to a metadata operation on a repeat.
- `bun.lock` is the lockfile of record. `package-lock.json`, `.npmrc`, and
  `scripts/with-pinned-node.sh` are deleted; `AGENTS.md`, `CONTRIBUTING.md`,
  `.claude/rules/stack.md`, and the guides describe Bun.
- **Accepted residual risk:** a plain non-login shell *outside* Ensemblr no longer
  self-corrects to Node 24 the way the wrapper made it. It fails loudly on
  `scripts/require-node-version.mjs` instead of quietly running the wrong Node.
- Regenerating `bun.lock` is a deliberate act with a procedure, not a routine
  `rm` and reinstall. Anyone who does it under Bun 1.4 ships a version-2 file and
  silently stops Dependabot; `bun run check:lockfile` catches that before merge.
- The Linux container recipes that install with `node:24-bookworm` install Bun
  first, because that image ships npm and not Bun. `scripts/rebuild-native-linux.sh`
  runs in that container and keeps its `npx electron-rebuild`, which is correct
  there.
- 0038's `bun`→`npx tsx` rewrite guidance is reversed: the fixtures generator and
  similar one-off commands are `bunx tsx …`.
