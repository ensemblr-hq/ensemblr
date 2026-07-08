# Ensemble

**A Pi-native macOS workbench for isolated coding-agent workflows.**

Ensemble is a native macOS desktop app (Electron) for running coding-agent work in isolated project
workspaces. It borrows the workspace-and-review operating model from [Conductor](https://conductor.build)
while using **Pi** as the agent runtime.

- **Version:** `0.1.0` (pre-1.0, polish stage)
- **Platform:** macOS
- **License:** MIT
- **Bundle ID:** `com.ensemble.app`

---

## What is Ensemble?

Ensemble gives each stream of work its own isolated copy of a project — a **workspace** — with its own
git branch, working tree, agent sessions, and review path. You start work from a branch, a GitHub PR, or a
Linear issue; drive it with Pi agent sessions; review the resulting changes; then open a pull request,
merge, or archive.

The core vocabulary (see [`CONTEXT.md`](./CONTEXT.md)):

| Term | Meaning |
| --- | --- |
| **Project** | A tracked codebase Ensemble can open, configure, and use as the source for workspaces. |
| **Workspace** | An isolated project copy for one stream of work — its own branch, working tree, agent sessions, run state, and review path. |
| **Workspace Task** | The unit of work assigned to a workspace: a feature, bug fix, experiment, PR, GitHub issue, or Linear issue. |
| **Pi Session** | A saved Pi coding-agent conversation associated with a project or workspace. |
| **Session Branch** | A branch within Pi's tree-structured session history, to continue from an earlier point without losing the rest. |
| **Review Flow** | Inspect changes, run checks, create a PR, merge accepted work, or archive rejected work. |
| **Ensemble Root Directory** | The user-visible directory where Ensemble stores managed repositories, workspaces, and archived workspace context. |

A guiding goal is **Conductor parity** — matching Conductor's publicly observable workflows and
capabilities, except where Pi-specific behavior requires a different implementation.

---

## Status

Ensemble is **pre-1.0 (v0.1.0), in the polish stage**. The core workflows — isolated workspaces, Pi agent
sessions, the review + PR flow, and the GitHub / Linear / git integrations — are implemented and wired to
real services. Active work is refinement toward a v1 release. See [`CHANGELOG.md`](./CHANGELOG.md) for
recent changes.

---

## Features

### Workspaces
- Create workspaces from an existing branch, a GitHub PR, or a Linear issue, with live source data in the
  create dialog.
- Each workspace is an isolated git worktree with its own branch and working tree.
- Auto-generated branch names derived from the first Pi turn (kebab-case, optional username/custom prefix).
- Copy configured files into new workspaces on creation.
- Quick-start: create a brand-new project and publish it to GitHub directly from Ensemble.

### Pi agent runtime
- Runs the Pi CLI in RPC mode (JSONL over stdio) with executable discovery and readiness checks.
- Per-workspace Pi sessions persisted to SQLite, with tree-structured session branching.
- Streaming conversation timeline with model and extended-thinking controls.
- Git-backed checkpoints capture per-turn state so you can restore an earlier point.
- Activity monitoring drives macOS notifications and power-state handling while the agent works.

### Review flow
- Changed-files panel with add/delete/modify/rename/untracked status and line counts.
- Source-scoped diffs (uncommitted vs. a commit vs. a branch) and per-file discard.
- Collapsible file tree with live filesystem watch and lazy-loaded ignored directories.
- Local review comments and todos tied to files and lines.

### Pull requests
- Inline PR title/description editor persisted per workspace.
- Commit and push, with first-push upstream setup.
- PR status, checks, and comments sourced through the GitHub CLI.
- Merge confirmation flow.

### Integrations
- **GitHub** via the `gh` CLI — using your own credentials; Ensemble stores no GitHub tokens.
- **Linear** via OAuth, with the token stored in the macOS Keychain.
- **git** via the native binary (worktrees, branches, commits, push, log/diff inspection).
- **macOS Launch Services** — open a workspace in Finder, editors, terminals, or source-control apps (only
  installed apps appear).

### Terminal & scripts
- xterm.js terminal backed by a `node-pty` PTY, in a collapsible dock.
- Setup and Run scripts with read-only output panes, plus additional interactive terminal tabs.
- `ENSEMBLE_*` environment variables injected into workspace processes.

### History & archive
- Archive a workspace's context (git-backed) and browse it later.
- Global History screen to restore or permanently delete archived workspaces.

### Settings
- Layered configuration (user / repository / workspace) stored in `~/.config/ensemble/config.json`.
- Git defaults: branch-prefix source, auto-rename workspace on branch, delete local branch on archive,
  archive after merge, set upstream on push.
- Setup diagnostics with per-check remediation actions.

---

## Tech stack

| Area | Choice |
| --- | --- |
| Desktop shell | Electron 42, Electron Forge 7 (Vite plugin, Fuses hardening) |
| UI | React 19, TypeScript 6 (strict) |
| Styling | Tailwind CSS 4, shadcn/ui (`radix-nova`) + Radix UI, Lucide icons |
| Routing | TanStack Router (file-based) |
| Async data | TanStack Query, TanStack Virtual |
| State | Jotai |
| Terminal | xterm.js + `node-pty` |
| Validation | Zod |
| Storage | SQLite (`~/.config/ensemble/ensemble.db`) |
| Build | Vite 8 |
| Lint / format | Biome 2.4 |
| Package manager | Bun 1.3.14 |

---

## Prerequisites

- **macOS**
- **[Bun](https://bun.sh) 1.3.14** — the enforced package manager (see [`AGENTS.md`](./AGENTS.md)).
- **Pi CLI** — the agent runtime; Ensemble spawns it in RPC mode
  (see [`docs/pi/rpc-protocol.md`](./docs/pi/rpc-protocol.md)).
- **GitHub CLI (`gh`)** — authenticate once with `gh auth login`. Ensemble reads PR/check data through
  `gh` and does not store GitHub tokens (see [ADR&nbsp;0013](./docs/adr/0013-use-gh-cli-for-v1-github-integration.md)).
- **A Linear account** — for OAuth-based issue integration
  (see [ADR&nbsp;0024](./docs/adr/0024-use-linear-oauth-for-v1-issue-integration.md)).
- **git**

---

## Getting started

```bash
# Install dependencies (postinstall fixes node-pty native-module permissions)
bun install

# Launch the app in development
bun run dev
```

Build outputs:

```bash
# Package the app bundle
bun run package

# Produce a macOS distributable (.zip)
bun run make
```

---

## Project structure

```
src/
├── main/       Electron main process (Node): git, pi-agent, github, linear,
│               terminal, storage, config, secrets, setup
├── preload/    Context-isolated IPC bridge between main and renderer
├── renderer/   React UI (components, routing, Jotai state, hooks, styles)
└── shared/     Cross-process contracts (Zod config, IPC contracts, keymap, Pi-RPC)

docs/
├── adr/        Architecture Decision Records (30)
├── pi/         Pi integration (RPC protocol, event taxonomy)
├── product/    Roadmap, parity notes, shell/settings inventories
└── refactor/   Refactor plans

tests/          main/ · renderer/ · shared/ · fixtures/
scripts/        Build & maintenance scripts (Tailwind check, Pi fixture tooling, node-pty fix)
```

Each `src` subtree has its own scoped `AGENTS.md` with rules specific to that runtime boundary.

---

## Architecture

Ensemble is organized around four runtime boundaries:

- **`src/main`** — the Electron main process (Node). Entry: `src/main/main.ts`. Hosts services for
  repository/git operations, the Pi agent (RPC), GitHub (`gh`), Linear, the terminal (PTY), storage
  (SQLite), config resolution, secrets (Keychain), and setup diagnostics.
- **`src/preload`** — a context-isolated IPC bridge (`src/preload/bridge`) exposing a typed API to the
  renderer.
- **`src/renderer`** — the React UI. Entry: `src/renderer/main.tsx` (mounts to `#root`). Navigation is
  **file-based TanStack Router**: route files live under `src/renderer/routing/routes/` and compile to the
  generated `routeTree.gen.ts`, which is never hand-edited
  (see [ADR&nbsp;0026](./docs/adr/0026-use-file-based-tanstack-routing.md)). Durable cross-module state is
  modeled as Jotai atoms under `src/renderer/state/`; async data flows through TanStack Query over the
  preload bridge.
- **`src/shared`** — cross-process contracts: the Zod config schema, ~30 typed IPC contract modules
  (`src/shared/ipc/contracts/`), keymap definitions, and Pi-RPC parsing.

**Data layer.** State persists to a SQLite database at `~/.config/ensemble/ensemble.db` (repositories,
workspaces, Pi sessions, Pi events, chat tabs, settings) accessed through a repository layer under
`src/main/storage/`. App settings live in `~/.config/ensemble/config.json`; per-repo config is a committed,
hand-authored `.ensemble/settings.toml`. Per-turn checkpoints are git-backed
([ADR&nbsp;0012](./docs/adr/0012-use-git-backed-checkpoints-for-pi-turns.md)), and secrets are stored in
the macOS Keychain ([ADR&nbsp;0018](./docs/adr/0018-use-keychain-for-secrets.md)). The Ensemble Root
Directory holds managed repositories, workspaces, and archived context.

---

## Development workflow

This repository has explicit contributor policies — see [`AGENTS.md`](./AGENTS.md). In brief:

- **Bun only.** Use `bun install`, `bun run <script>`, and `bunx`. Do not create `package-lock.json`,
  `pnpm-lock.yaml`, or `yarn.lock`.
- **Biome** for lint + format (no ESLint/Prettier):

  ```bash
  bun run check       # biome check + Tailwind class check
  bun run check:fix   # apply safe fixes (format + import organization)
  bun run format      # format only
  bun run lint        # lint only
  bun run typecheck   # tsc --noEmit
  ```

- **Tailwind scale.** No px-based arbitrary utilities (e.g. `w-[13px]`); `bun run check` enforces this via
  `scripts/check-tailwind-classes.mjs`.
- **State.** Jotai is the only app-level state solution.
- **Docs.** JSDoc is expected on functions, hooks, components, atoms, and IPC contracts.

**CI.** GitHub Actions runs a `react-doctor` scan against `master` on pushes and PRs
(`.github/workflows/checks.yml`).

---

## Testing

Tests run under two runners (Bun is the package manager only — never the test runner):

- **Vitest** (`bunx vitest run`) — shared (`tests/shared/**`) and renderer (`tests/renderer/**`) suites.
  Config in `vitest.config.mts`; default `environment` is `node`, and DOM component tests opt into
  happy-dom per file with a `// @vitest-environment happy-dom` docblock.
- **`electron --test`** (via `ELECTRON_RUN_AS_NODE=1`) — main-process suites (`tests/main/**`) that need Electron/Node APIs.

Run everything with `bun run test`; add coverage with `bun run test:coverage` (native Istanbul →
`coverage/coverage-final.json`). Focused examples:

```bash
bun run test              # full Vitest suite (renderer + shared)
bun run test:coverage     # Vitest with Istanbul coverage
bunx vitest run <file>    # a single Vitest file
bun run test:renderer     # renderer suites (Vitest)
bun run test:pi-rpc       # Pi RPC parsing (Vitest)
bun run test:db           # SQLite database (electron --test)
bun run test:workspace    # workspace creation (electron --test)
bun run test:github       # GitHub service (electron --test)
bun run test:linear       # Linear OAuth/API (electron --test)
```

See `package.json` for the full list of `test:*` scripts.

---

## Documentation

- [`CONTEXT.md`](./CONTEXT.md) — product definition and ubiquitous language.
- [`CHANGELOG.md`](./CHANGELOG.md) — notable changes (Keep a Changelog format).
- [`AGENTS.md`](./AGENTS.md) — contributor policies (package manager, Biome, state, Tailwind, docs).
- [`docs/adr/`](./docs/adr) — 30 Architecture Decision Records.
- [`docs/product/`](./docs/product) — roadmap, Conductor parity, shell/settings inventories.
- [`docs/pi/`](./docs/pi) — Pi RPC protocol and event taxonomy.

---

## License

MIT © Philipp Soldunov
