# Agent Instructions

These instructions apply to the whole repository.

## Repository Layout

This is a Bun workspaces monorepo.

| Path | What lives there |
| --- | --- |
| `apps/desktop/` | Ensemblr, the Electron desktop app: its source, tests, scripts, docs, JSON Schemas, assets, Nix packaging, changelog, and release notes. |
| `apps/website/` | The marketing and documentation site. Not started yet. |
| `packages/shared/` | Code the apps share, such as UI pieces lifted out of the desktop app. Not started yet. |

The root holds only what the whole repository shares: the workspace manifest (`package.json`) and lockfile, the toolchain pins (`mise.toml`, `.nvmrc`) and install settings (`bunfig.toml`), the house Biome config, the monorepo-level scripts in `scripts/`, CI (`.github/`), agent tooling (`.claude/`, `.codex/`, `.agents/`, `.mcp.json`), Ensemblr's repository settings (`.ensemblr/`), the Nix flake entrypoint, and the community files. **Keep it that way: anything that belongs to one app or package lives under that workspace's directory.**

- Before working under `apps/desktop/`, read `apps/desktop/AGENTS.md`. Its paths, and those in the scoped `AGENTS.md` files beneath it, are relative to `apps/desktop/`.
- When you write a path in prose, write it from the repository root, workspace prefix included — `apps/desktop/src/main/main.ts`, not `src/main/main.ts`.

## Workspaces

- The root `package.json` `workspaces` globs `apps/*` and `packages/*`; a directory becomes a workspace when it gets a `package.json`. Name a new package `@ensemblr/<name>`, mark it `private`, and depend on another workspace with `"workspace:*"`. The desktop app keeps the package name `ensemblr`, which its Electron identity and release tooling read.
- Bun runs a workspace's own `preinstall` and `postinstall` only when it first installs that workspace — not when a dependency changes, and not on an install with nothing to do. The root manifest's `preinstall` and `postinstall` therefore run every workspace's (`bun run --workspaces --if-present`) on every install, the way a single-package root's ran before; on a first install they run twice, so keep them idempotent.
- Each workspace owns its `check`, `typecheck`, and `test` scripts. The root's scripts of the same name run every workspace's (`bun run --workspaces --if-present <script>`); `check` first runs the lockfile check and Biome over the whole tree (each file under its nearest `biome.json`).
- Install from anywhere with `bun install` or `bun ci`; Bun installs every workspace and hoists dependencies into the root `node_modules`. Add a dependency to the workspace that uses it (`bun add <pkg>` inside that workspace's directory, or `bun add <pkg> --cwd apps/desktop`), never to the root manifest.
- A new workspace manifest changes what `bun install` lays out, so it moves the Nix deps hash: re-pin with `apps/desktop/nix/update-pins.sh deps` (the `nix-deps` check reports the new hash on a pull request).

## Project Naming

- This project was previously called `piductor`, then `Ensemble`. If agents find references to `piductor` or `Ensemble` in code, documentation, branches, commits, issues, or planning notes, interpret them as references to `Ensemblr` unless the local context clearly says otherwise. The current product name is `Ensemblr` (domain `ensemblr.dev`).

## App Scaffolding Requires Current Official Docs

When scaffolding an app, project, framework integration, SDK integration, CLI setup, or cloud-service setup, agents must not rely on training data, memory, or recalled commands.

Required workflow:

- Inspect the local repo first so generated files and commands fit the existing project direction.
- Use Context7 MCP before selecting install steps, package names, CLI flags, templates, or generated-file structure.
- Start with `resolve-library-id` for the relevant library, framework, SDK, CLI, or cloud service unless the exact Context7 library ID is already known.
- Call `query-docs` with the selected library ID and the full scaffolding question.
- If Context7 is unavailable, incomplete, or lacks the relevant tool, check the current official documentation online.
- Prefer official install directions, official starter templates, and official CLI tools such as documented `create`, `init`, or generator commands.
- Do not invent or guess package names, versions, CLI flags, templates, config keys, or setup steps.
- If official docs and local repo conventions conflict, preserve local conventions where possible and call out the tradeoff before making a risky change.
- In the final response, mention the documentation source and the exact official command or CLI path used.

Scaffold provenance guardrail:

- Do not hand-author generated app structure from memory when an official generator exists.
- Run the official generator in `.context/` or another disposable directory first, then copy or adapt from that generated output.
- If the generator conflicts with Bun, hooks, existing files, or other repo policy, stop and explain the conflict before choosing a workaround.
- Record scaffold provenance in the final response or a tracked audit note: documentation source, exact generator command, generated files used, and every intentional deviation.
- Treat manually added package names, versions, config keys, templates, or generated-file structure as invalid unless they are directly backed by current official docs, generator output, or an explicit user decision.

## Package Manager Policy

This repository enforces Bun for JavaScript and TypeScript package management. Bun installs packages and runs `package.json` scripts; **Node 24 remains the runtime** (see `.claude/rules/stack.md`; the pin itself is the root `.nvmrc` and `mise.toml`), and Bun does not shim itself as `node`.

- Use `bun install` instead of `npm install`, `pnpm install`, or `yarn install`. Use `bun ci` for a frozen install that must match `bun.lock` exactly — it is what the workspace setup script runs.
- Use `bun run <script>` instead of `npm run <script>`, `pnpm run <script>`, or `yarn run <script>`.
- Use `bunx <package>` instead of `npx`, `pnpx`, or `yarn dlx`.
- Use `bun add <package>` (`bun add -d` for a dev dependency) and `bun remove <package>` for dependency changes.
- Do not create `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, or the binary `bun.lockb`. `bun.lock` (text) is the lockfile of record, and `bunfig.toml` sets `saveTextLockfile = true`.
- `bun.lock` stays at `lockfileVersion: 1`. Dependabot-core's Bun parser raises on a higher version, so dependency PRs would stop arriving. Bun 1.4 stamps 2 on a lockfile regenerated from scratch, so never delete `bun.lock` and reinstall to "refresh" it. `bun run check:lockfile` (part of the root `bun run check`) enforces this; `apps/desktop/docs/build-and-release.md#bun-and-node` records how the current file was produced and why a plain `bun install` without a lockfile silently re-resolves the whole graph.
- The root `package.json` sets `packageManager` to the Bun version (`bun@1.4.2`); workspace manifests do not repeat it.
- `bunfig.toml` pins `linker = "hoisted"` because Forge's `PACKAGE_KEEP_*` filters in `apps/desktop/forge.config.ts` match flat `node_modules/<pkg>/` paths. Do not switch to the isolated linker.
- The root `package.json#trustedDependencies` is the complete list of packages whose install scripts run (an explicit list replaces Bun's built-in allowlist). `node-pty` is deliberately absent — on Linux its binding must be built by Forge against Electron's ABI, not by Bun against Node's. **Never run `bun pm trust --all`.** Bun reads `trustedDependencies` and `overrides` from the root manifest only, so both stay there even though every entry today serves the desktop app.
- The local Codex hook `.codex/hooks/enforce-bun-package-manager.sh` (plus the Claude hook `.claude/hooks/enforce-bun.sh`) block direct `npm`, `npx`, `pnpm`, `pnpx`, `yarn`, `yarnpkg`, and matching `corepack` package-manager calls.
- Never set `PATH` in `.ensemblr/settings.toml`'s `[environment_variables]`. Ensemblr injects the workspace directory's login-shell `PATH` (which activates mise, putting Node 24 and Bun on it) only when no `PATH` key is present, so defining one — even empty — silently disables the resolver.
- Keep every setup and run script behind the root `scripts/with-pinned-node.sh`. The injected `PATH` has mise's Node 24 *on* it but not necessarily *first* — a shell startup that prepends Homebrew after `mise activate` leaves Node 26 in front, and `bun ci` then dies on the preinstall guard. Bun hands lifecycle scripts whichever `node` leads `PATH`, for `bun install` and `bun ci` alike.

## Biome Policy

This repository uses Biome instead of ESLint and Prettier.

- The root `biome.json` holds the house style. A workspace's own `biome.json` sets `"root": false` and `"extends": "//"`, and adds only that workspace's ignores.
- Run `bun run check` before finishing changes that touch JavaScript, TypeScript, JSX, TSX, CSS, or JSON. From the root it runs the lockfile check, Biome over the whole tree, and every workspace's `check`; inside a workspace it runs that workspace's checks.
- Use `bun run check:fix` to apply safe Biome fixes, including formatting and import organization.
- Keep `bun run typecheck` as a separate verification step for TypeScript type errors. From the root it runs every workspace's `typecheck`.
- Do not add ESLint or Prettier configuration unless the user explicitly asks for it.

## Testing Policy

Vitest is the mandated test runner. Bun is the package manager, but **`bun test` is Bun's own test runner, not Vitest** — never run it here. Use `bun run test`, which invokes each workspace's `test` script (Vitest).

- Do not import from `bun:test`. Do not add Jest, Mocha, or any other runner.
- Run Vitest with `bunx vitest` from inside a workspace (for example `bunx vitest run <file>` in `apps/desktop/`).
- The desktop app's suite layout, its `electron --test` main-process suites, and its DOM harness are in `apps/desktop/AGENTS.md`.

## Scoped Agent Instructions

- This root file contains repository-wide defaults. Before editing a workspace or a subtree, check for the closest scoped `AGENTS.md`; scoped instructions are more specific and override these general rules.
- `apps/desktop/AGENTS.md` carries the desktop app's policies — state management, Tailwind, localization, config schemas, documentation coverage, and code review — and points at its own scoped files under `apps/desktop/src/`.

## Module And File Organization

- Check for shallow modules before adding new abstractions. Prefer deep modules: small public interfaces that hide meaningful implementation complexity.
- Avoid shallow modules: large interfaces, many props or methods, or wrappers that mostly pass values through without reducing complexity.
- Before introducing a helper, wrapper, hook, component, or service, ask whether it reduces the number of methods, simplifies parameters, or hides complexity inside the module. If not, inline it or consolidate it with a more appropriate module.
- Preserve required entrypoints such as Electron, Vite, renderer, preload, and framework route files. Move implementation behind them instead of moving paths that tooling expects.
- Organize files by the ownership model that fits the subtree: file type first where the scoped guidance says so, concern first where runtime services own the boundary, and root public entrypoints where a shared contract needs a stable import path.
- Keep broadly reusable primitives in shared locations, and keep feature-specific helpers, components, services, mocks, and fixtures under the feature or concern that owns them.
- When a concern spans multiple files, expose the intended public surface through a stable entrypoint and keep private helpers in sibling implementation files.

## Type Organization

- Put exported types in the concern-owned type or contract module that represents their public boundary.
- Co-locate types with implementation only when they are not exported and are not used elsewhere.
- Prefer inline prop and options types when the shape is small and the inline type remains readable.
- For React components: if the component takes four or fewer props and the prop type is not exported, inline the prop shape directly on the function parameter. Lift it into a named `Props` interface only when it grows beyond four props, is exported, or is referenced from more than one place.
- Avoid creating one-off exported `Props`, `Options`, or domain type names unless they are reused, part of a public module interface, or materially improve readability.

## Documentation And Comments

- Every function carries a JSDoc block, and function bodies stay comment-free apart from a short *why* the code cannot express. See @.claude/rules/jsdoc.md and @.claude/rules/comments.md; they hold for every workspace unless that workspace's `AGENTS.md` narrows them.
- The desktop app's coverage rules (which declarations, which exclusions) are in `apps/desktop/AGENTS.md`.

## Issue Tracker And Pull Request Workflow

- Never mark a tracker issue as `Done` from agent work. When implementation and verification are complete, move it to `In Review` and let a human decide whether it is finished.
- Never create a pull request unless the user explicitly asks for one in the current task. Do not infer PR creation from completed work, tracker-backed work, or branch readiness.
- When a change is backed by a tracker issue, put that issue's identifier in the branch name, the commits, and the PR title.
