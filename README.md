# Ensemblr

**A macOS workbench for isolated, multi-agent coding workflows.**

Ensemblr is a native macOS desktop app (Electron) for running coding-agent work in isolated project
workspaces. It borrows the workspace-and-review operating model from [Conductor](https://conductor.build).
**Pi** is its first-party agent runtime; third-party harnesses (Claude Code, Codex, Vibe) run alongside
it, and a permission-gated control surface — **Ensemblr Control** — lets agents drive the app itself.

- **Version:** `0.1.0` (pre-1.0, polish stage)
- **Platform:** macOS
- **License:** MIT
- **Bundle ID:** `dev.ensemblr.app`

---

## What is Ensemblr?

Ensemblr gives each stream of work its own isolated copy of a project — a **workspace** — with its own
git branch, working tree, agent sessions, and review path. You start work from a branch, a GitHub PR, or a
Linear issue; drive it with Pi agent sessions; review the resulting changes; then open a pull request,
merge, or archive.

The core vocabulary (see [`CONTEXT.md`](./CONTEXT.md)):

| Term | Meaning |
| --- | --- |
| **Project** | A tracked codebase Ensemblr can open, configure, and use as the source for workspaces. |
| **Workspace** | An isolated project copy for one stream of work — its own branch, working tree, agent sessions, run state, and review path. |
| **Workspace Task** | The unit of work assigned to a workspace: a feature, bug fix, experiment, PR, GitHub issue, or Linear issue. |
| **Pi Session** | A saved Pi coding-agent conversation associated with a project or workspace. |
| **Harness** | A third-party coding-agent CLI (Claude Code, Codex, Vibe) launched in a workspace terminal tab, alongside first-party Pi. |
| **Session Branch** | A branch within Pi's tree-structured session history, to continue from an earlier point without losing the rest. |
| **Ensemblr Control** | The permission-gated control surface that lets an agent drive the app itself — spawn conversations, launch harnesses, run terminals, focus panels, move the board — via `ensemblr_*` tools. |
| **Orchestrator / Sub-agent** | Roles in multi-agent work: a root orchestrator delegates; a spawned sub-agent does its unit of work itself and never delegates onward. |
| **Review Flow** | Inspect changes, run checks, create a PR, merge accepted work, or archive rejected work. |
| **Ensemblr Root Directory** | The user-visible directory where Ensemblr stores managed repositories, workspaces, and archived workspace context. |

A guiding goal is **Conductor parity** — matching Conductor's publicly observable workflows and
capabilities, except where Pi-specific behavior requires a different implementation.

---

## Status

Ensemblr is **pre-1.0 (v0.1.0), in the polish stage**. The core workflows — isolated workspaces, Pi agent
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
- Base branch is fetched and fast-forwarded before a workspace is created, so new work starts from the
  latest `master`/`main` when online (best-effort — offline creation still works).
- Quick-start: create a brand-new project and publish it to GitHub directly from Ensemblr.
- Dashboard board groups workspaces into Backlog, In progress, In review, Done, and Canceled columns, with drag-and-drop ordering and workspace card action menus.

### Agent runtimes

- **Pi** (first-party): runs the Pi CLI in RPC mode (JSONL over stdio) with executable discovery and
  readiness checks. Per-workspace sessions persisted to SQLite, with tree-structured session branching.
- Streaming conversation timeline with model and extended-thinking controls.
- Composer accepts pasted image attachments and `@`-mention file payloads, resolved through the
  workspace-files service and rendered as attachment chips.
- Git-backed checkpoints capture per-turn state so you can restore an earlier point.
- Activity monitoring drives macOS notifications and power-state handling while the agent works.
- **Third-party harnesses** — Claude Code, OpenAI Codex, and Mistral Vibe launch in workspace terminal
  tabs with auto-approve flags and exact-conversation resume (see [`docs/harnesses.md`](./docs/harnesses.md)).
- Resumable sessions and session tabs: agent sessions and dock terminals restore across restart, tabs
  reorder by drag, and session-tab keyboard shortcuts move between them.

### Ensemblr Control & orchestration

- Agents can **drive the app itself** through a permission-gated, guardrailed control surface — Pi via
  a shipped Pi extension, MCP-client harnesses (Claude Code, Codex) via an embedded MCP server.
- The `ensemblr_*` tools spawn/steer/close conversations, launch harnesses, run terminals, open
  file/diff/comment tabs, focus panels, and move the workspace across the board.
- **Multi-agent orchestration**: a root orchestrator delegates independent workstreams to sub-agents,
  then *delegate → wait → evaluate → integrate*; live sub-agent status surfaces in the dock.
- Control actions follow the workspace permission mode (read-only / approval-required /
  workspace-trusted) and are bounded by fork-bomb guardrails (shallow delegation, spawn quota + rate,
  wait timeout).
- See [`docs/agent-control.md`](./docs/agent-control.md).

### Review flow

- Changed-files panel with add/delete/modify/rename/untracked status and line counts.
- Source-scoped diffs (uncommitted vs. a commit vs. a branch) and per-file discard.
- Rich diff viewer with inline review comments anchored to specific lines.
- Collapsible file tree with live filesystem watch and lazy-loaded ignored directories.
- Local review comments and todos tied to files and lines.

### Pull requests

- Inline PR title/description editor persisted per workspace.
- Commit and push, with first-push upstream setup.
- PR status, a per-check status list, and comments sourced through the GitHub CLI.
- Merge confirmation flow.

### Integrations

- **GitHub** via the `gh` CLI — using your own credentials; Ensemblr stores no GitHub tokens.
- **Linear** via OAuth, with the token stored in the macOS Keychain.
- **git** via the native binary (worktrees, branches, commits, push, log/diff inspection).
- **macOS Launch Services** — open a workspace in Finder, editors, terminals, or source-control apps (only
  installed apps appear).

### Terminal & scripts

- xterm.js terminal backed by a `node-pty` PTY, in a collapsible dock.
- Setup and Run scripts with read-only output panes, plus additional interactive terminal tabs.
- Dock terminals restore across app restart with clean scrollback.
- Workspace processes inherit the user's shell-derived environment, workspace toolchain `PATH`, and `ENSEMBLR_*` variables.
- Bundled JetBrains Mono Nerd Font keeps terminal/code typography stable on first launch.

### History & archive

- Archive a workspace's context (git-backed) and browse it later.
- Global History screen to restore or permanently delete archived workspaces.

### Settings

- App and repository settings are persisted to `~/.config/ensemblr/config.json` (layered user /
  repository / workspace) and apply on a live config reload — no restart.
- Git defaults: branch-prefix source, auto-rename workspace on branch, delete local branch on archive,
  archive after merge, set upstream on push.
- Setup diagnostics with per-check remediation actions.
- Appearance settings for theme, accessible colors, code theme, markdown style, mono/terminal fonts, and terminal font size.

---

## Tech stack

| Area | Choice |
| --- | --- |
| Desktop shell | Electron 43, Electron Forge 7 (Vite plugin, Fuses hardening) |
| UI | React 19, TypeScript 6 (strict) |
| Styling | Tailwind CSS 4, shadcn/ui (`radix-nova`) + Radix UI, Lucide icons |
| Routing | TanStack Router (file-based) |
| Async data | TanStack Query, TanStack Virtual |
| State | Jotai |
| Terminal | xterm.js + `node-pty` |
| Agent runtimes | Pi (first-party, RPC) + Claude Code / Codex / Vibe harnesses |
| Agent control | Loopback HTTP + MCP (`@modelcontextprotocol/sdk`) |
| Validation | Zod |
| Storage | SQLite (`~/Library/Application Support/dev.ensemblr.app/ensemblr.db` on macOS) |
| Build | Vite 8, Electron Forge (DMG + ZIP, hardened runtime, notarized, arm64) |
| Lint / format | Biome 2.5 |
| Package manager | npm |

---

## Prerequisites

- **macOS**
- **[npm](https://www.npmjs.com)** — the enforced package manager, bundled with Node.js (see [`AGENTS.md`](./AGENTS.md)).
- **Pi CLI** — the first-party agent runtime; Ensemblr spawns it in RPC mode
  (see [`docs/pi/rpc-protocol.md`](./docs/pi/rpc-protocol.md)).
- **Third-party harness CLIs** _(optional)_ — install `claude`, `codex`, and/or `vibe` to launch them
  as harnesses; each appears only when its binary is on `PATH` (see [`docs/harnesses.md`](./docs/harnesses.md)).
- **GitHub CLI (`gh`)** — authenticate once with `gh auth login`. Ensemblr reads PR/check data through
  `gh` and does not store GitHub tokens (see [ADR&nbsp;0013](./docs/adr/0013-use-gh-cli-for-v1-github-integration.md)).
- **A Linear account** — for OAuth-based issue integration
  (see [ADR&nbsp;0024](./docs/adr/0024-use-linear-oauth-for-v1-issue-integration.md)).
- **git**

---

## Getting started

```bash
# Install dependencies (postinstall fixes node-pty native-module permissions)
npm install

# Launch the app in development
npm run dev
```

Build outputs (macOS, arm64):

```bash
npm run package    # unpacked .app under out/
npm run make       # signed + notarized .dmg and .zip under out/make/
```

`make` produces a release build; `make:canary` / `make:dev` build dogfood channels, and
`make:unsigned` / `package:unsigned` skip signing. Signing, notarization, and channels are documented
in [`docs/build-and-release.md`](./docs/build-and-release.md).

---

## Project structure

```
src/
├── main/       Electron main process (Node): git, pi-agent, agent-control, github,
│               linear, terminal, storage, config, secrets, setup
├── preload/    Context-isolated IPC bridge between main and renderer
├── renderer/   React UI (components, routing, Jotai state, hooks, styles)
└── shared/     Cross-process contracts (Zod config, IPC contracts, agent-control,
                harness registry, keymap, Pi-RPC)

resources/      Shipped Pi extensions (e.g. `ensemblr-control.mts`)

docs/
├── adr/            Architecture Decision Records (40)
├── agent-control.md · harnesses.md · build-and-release.md — feature & operator guides
├── considerations/ Design records (Ensemblr Control, orchestration playbook, Deno migration)
├── pi/             Pi integration (RPC protocol, event taxonomy)
├── product/        Roadmap, parity notes, shell/settings inventories
└── refactor/       Refactor plans

tests/          main/ · renderer/ · shared/ · fixtures/
scripts/        Build & maintenance scripts (Tailwind check, Pi fixture tooling, node-pty fix,
                app icon + social avatar generation, Dock-flash diagnostics)
```

Each `src` subtree has its own scoped `AGENTS.md` with rules specific to that runtime boundary.

---

## Architecture

Ensemblr is organized around four runtime boundaries:

- **`src/main`** — the Electron main process (Node). Entry: `src/main/main.ts`. Hosts services for
  repository/git operations, the Pi agent (RPC), third-party harness launch, the agent-control layer,
  GitHub (`gh`), Linear, the terminal (PTY), storage (SQLite), config resolution, secrets (Keychain),
  and setup diagnostics.
- **`src/preload`** — a context-isolated IPC bridge (`src/preload/bridge`) exposing a typed API to the
  renderer.
- **`src/renderer`** — the React UI. Entry: `src/renderer/main.tsx` (mounts to `#root`). Navigation is
  **file-based TanStack Router**: route files live under `src/renderer/routing/routes/` and compile to the
  generated `routeTree.gen.ts`, which is never hand-edited
  (see [ADR&nbsp;0026](./docs/adr/0026-use-file-based-tanstack-routing.md)). Durable cross-module state is
  modeled as Jotai atoms under `src/renderer/state/`; async data flows through TanStack Query over the
  preload bridge.
- **`src/shared`** — cross-process contracts: the Zod config schema, ~30 typed IPC contract modules
  (`src/shared/ipc/contracts/`), the agent-control contracts and harness registry, keymap definitions,
  and Pi-RPC parsing.

**Data layer.** State persists to a SQLite database at `~/Library/Application Support/dev.ensemblr.app/ensemblr.db` on macOS (repositories,
workspaces, Pi sessions, Pi events, chat tabs, settings) accessed through a repository layer under
`src/main/storage/`. App settings live in `~/.config/ensemblr/config.json`; per-repo config is a committed,
hand-authored `.ensemblr/settings.toml`. Per-turn checkpoints are git-backed
([ADR&nbsp;0012](./docs/adr/0012-use-git-backed-checkpoints-for-pi-turns.md)), and secrets are stored in
the macOS Keychain ([ADR&nbsp;0018](./docs/adr/0018-use-keychain-for-secrets.md)). The Ensemblr Root
Directory holds managed repositories, workspaces, and archived context.

**Agent Control layer.** Agents drive the app through a loopback HTTP control server
(`src/main/agent-control/`): Pi via `POST /invoke` (a shipped extension), MCP-client harnesses via
`POST /mcp`. One service resolves a per-workspace bearer token, enforces scope and the workspace
permission mode, applies fork-bomb guardrails, and delegates to existing services — no new capability
code ([ADR&nbsp;0040](./docs/adr/0040-use-loopback-control-server-for-agent-app-control.md)).

---

## Development workflow

This repository has explicit contributor policies — see [`AGENTS.md`](./AGENTS.md). In brief:

- **npm only.** Use `npm install`, `npm run <script>`, and `npx`. Do not create `bun.lock`,
  `pnpm-lock.yaml`, or `yarn.lock`.
- **Biome** for lint + format (no ESLint/Prettier):

  ```bash
  npm run check       # biome check + Tailwind class check
  npm run check:fix   # apply safe fixes (format + import organization)
  npm run format      # format only
  npm run lint        # lint only
  npm run typecheck   # tsc --noEmit for the app + scripts/ (tsconfig.scripts.json)
  ```

- **Tailwind scale.** No px-based arbitrary utilities (e.g. `w-[13px]`); `npm run check` enforces this via
  `scripts/check-tailwind-classes.mjs`.
- **State.** Jotai is the only app-level state solution.
- **Docs.** JSDoc is expected on functions, hooks, components, atoms, and IPC contracts.

**CI.** GitHub Actions runs a `react-doctor` scan against `master` on pushes and PRs
(`.github/workflows/checks.yml`).

---

## Testing

Tests run under two runners (npm is the package manager, not a test runner):

- **Vitest** (`npx vitest run`) — shared (`tests/shared/**`) and renderer (`tests/renderer/**`) suites.
  Config in `vitest.config.mts`; default `environment` is `node`, and DOM component tests opt into
  happy-dom per file with a `// @vitest-environment happy-dom` docblock.
- **`electron --test`** (via `ELECTRON_RUN_AS_NODE=1`) — main-process suites (`tests/main/**`) that need Electron/Node APIs.

Run everything with `npm run test`; add coverage with `npm run test:coverage` (native Istanbul →
`coverage/coverage-final.json`). Focused examples:

```bash
npm run test              # full Vitest suite (renderer + shared)
npm run test:coverage     # Vitest with Istanbul coverage
npx vitest run <file>    # a single Vitest file
npm run test:renderer     # renderer suites (Vitest)
npm run test:pi-rpc       # Pi RPC parsing (Vitest)
npm run test:db           # SQLite database (electron --test)
npm run test:workspace    # workspace creation (electron --test)
npm run test:github       # GitHub service (electron --test)
npm run test:linear       # Linear OAuth/API (electron --test)
```

See `package.json` for the full list of `test:*` scripts.

---

## Documentation

- [`docs/`](./docs) — documentation index.
- [`CONTEXT.md`](./CONTEXT.md) — product definition and ubiquitous language.
- [`CHANGELOG.md`](./CHANGELOG.md) — notable changes (Keep a Changelog format).
- [`AGENTS.md`](./AGENTS.md) — contributor policies (package manager, Biome, state, Tailwind, docs).
- [`docs/agent-control.md`](./docs/agent-control.md) — Ensemblr Control & orchestration.
- [`docs/harnesses.md`](./docs/harnesses.md) — third-party agent harnesses.
- [`docs/build-and-release.md`](./docs/build-and-release.md) — packaging, signing, notarization, channels.
- [`docs/adr/`](./docs/adr) — 40 Architecture Decision Records.
- [`docs/considerations/`](./docs/considerations) — design records (Ensemblr Control, orchestration).
- [`docs/pi/`](./docs/pi) — Pi RPC protocol and event taxonomy.
- [`docs/product/`](./docs/product) — roadmap, Conductor parity, shell/settings inventories.
- [`docs/refactor/`](./docs/refactor) — refactor plans.
- [`LICENSE`](./LICENSE) — MIT license.

---

## License

[MIT](./LICENSE) © Philipp Soldunov
