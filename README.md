# Ensemblr

**A macOS workbench for isolated, multi-agent coding workflows.**

Ensemblr is a native macOS desktop app (Electron) for running coding-agent work in isolated project
workspaces. Isolation is the product: every stream of work gets its own worktree, branch, and review path.
**Pi** and **Claude Code** are its two first-class agent runtimes, driven on the app's own chat surface;
third-party CLIs (Codex, Vibe, and the `claude` TUI) also run as terminal harnesses, and a
permission-gated control surface — **Ensemblr Control** — lets agents drive the app itself.

- **Version:** `0.1.0` (pre-1.0, polish stage)
- **Platform:** macOS
- **License:** MIT
- **Bundle ID:** `dev.ensemblr.app`

---

## What is Ensemblr?

Ensemblr gives each stream of work its own isolated copy of a project — a **workspace** — with its own
git branch, working tree, agent sessions, and review path. You start work from a branch, a GitHub PR, or a
Linear issue; drive it with Pi or Claude Code agent sessions; review the resulting changes; then open a
pull request, merge, or archive.

The core vocabulary (see [`CONTEXT.md`](./CONTEXT.md)):

| Term | Meaning |
| --- | --- |
| **Project** | A tracked codebase Ensemblr can open, configure, and use as the source for workspaces. |
| **Workspace** | An isolated project copy for one stream of work — its own branch, working tree, agent sessions, run state, and review path. |
| **Workspace Task** | The unit of work assigned to a workspace: a feature, bug fix, experiment, PR, GitHub issue, or Linear issue. |
| **Agent Runtime** | A coding agent Ensemblr drives on its own chat surface — **Pi** (CLI RPC) or **Claude Code** (Agent SDK). Selected per conversation. |
| **Agent Session** | A saved agent conversation associated with a project or workspace. (`CONTEXT.md` still calls this a *Pi Session*.) |
| **Harness** | A coding-agent CLI (Codex, Vibe, or the `claude` TUI) launched in a workspace terminal tab as its native TUI, rather than on the chat surface. |
| **Session Branch** | A branch within an agent's tree-structured session history, to continue from an earlier point without losing the rest. |
| **Ensemblr Control** | The permission-gated control surface that lets an agent drive the app itself — spawn conversations, launch harnesses, run terminals, focus panels, move the board — via `ensemblr_*` tools. |
| **Orchestrator / Sub-agent** | Roles in multi-agent work: a root orchestrator delegates; a spawned sub-agent does its unit of work itself and never delegates onward. |
| **Review Flow** | Inspect changes, run checks, create a PR, merge accepted work, or archive rejected work. |
| **Ensemblr Root Directory** | The user-visible directory where Ensemblr stores managed repositories, workspaces, and archived workspace context. |
| **Attachment** | Anything the user pins into a composer draft as a chip — a file, a pasted image or text block, an issue, a review-comment thread — carried to the agent in the order it was attached. |
| **Linked Directory** | A read grant over a directory outside the workspace, held per chat and passed to the runtime at session open. |
| **Follow-Up Queue** | The per-tab list of messages sent while a turn is running, visible and editable until it drains. |

The scope rests on **five commitments**: isolation is the product; the agent runtime is pluggable and
never privileged; the agent can drive the app under permission; review is local-first and ends in
GitHub; configuration is committed, legible, and ours.

---

## Status

Ensemblr is **pre-1.0 (v0.1.0), in the polish stage**. The core workflows — isolated workspaces, Pi and
Claude Code agent sessions, the review + PR flow, and the GitHub / Linear / git integrations — are
implemented and wired to real services. Active work is refinement toward a v1 release. See
[`CHANGELOG.md`](./CHANGELOG.md) for recent changes.

---

## Features

### Workspaces

- Create workspaces from an existing branch, a GitHub PR, or a Linear issue, with live source data in the
  create dialog.
- Each workspace is an isolated git worktree with its own branch and working tree.
- A workspace either **adopts** an existing branch — checking it out rather than forking a copy — or
  **cuts** a fresh one from the base ref.
- Auto-generated branch names derived from the first agent turn (kebab-case, optional username/custom
  prefix), for workspaces that cut a branch.
- Target (merge) branch is selectable per workspace and can be changed afterwards; merge conflicts against
  it are surfaced in the workspace's git status.
- Continue a finished workspace onto a numbered continuation branch without leaving the workspace.
- Copy configured files into new workspaces on creation.
- Base branch is fetched and fast-forwarded before a workspace is created, so new work starts from the
  latest `master`/`main` when online (best-effort — offline creation still works).
- Quick-start: create a brand-new project and publish it to GitHub directly from Ensemblr.
- Dashboard board groups workspaces into Backlog, In progress, In review, Done, and Canceled columns, with drag-and-drop ordering and workspace card action menus.

### Agent runtimes

Two runtimes share one chat surface — the same timeline, tool cards, checkpoints, permission model, and
`ensemblr_*` control tools. The runtime is chosen per conversation
([ADR&nbsp;0042](./docs/adr/0042-add-claude-code-as-a-second-first-class-agent-runtime.md)).

- **Pi** — runs the Pi CLI in RPC mode (JSONL over stdio) with executable discovery and readiness checks
  (`src/main/pi-agent/`).
- **Claude Code** — driven in-process through `@anthropic-ai/claude-agent-sdk` against *your own* `claude`
  binary, found on `PATH` or set in Providers settings; Ensemblr ships no Claude binary
  (`src/main/claude-agent/`). It contributes its own slash commands, MCP-server roster, model catalogue,
  and thinking levels, discovered live from the installed CLI.
- Sessions persist per workspace to SQLite with tree-structured session branching, session naming, and
  auto-generated summaries — all above the adapter line, in `src/main/agent-runtime/`.
- Streaming conversation timeline with a model picker, thinking-level picker, tool-approval prompts, and a
  context-window gauge. A delegated sub-agent's rows, prose, and reasoning nest inside the call that
  spawned it rather than reading as the main agent's own work.
- **Plan mode**: an agent can be held to read-only tools until it submits a plan, which is written to a
  file and surfaced for review before execution resumes.
- **Composer attachments**: files, pasted images and long text, `@`-mentions, Linear/GitHub issues, and
  review-comment threads all attach as chips *inline in the draft*, in the order the user placed them.
  Payloads are written to a content-addressed store under `.context/attachments/`, and an issue or comment
  thread is serialized to a whole markdown document rather than a summary line
  ([ADR&nbsp;0047](./docs/adr/0047-model-composer-attachments-as-one-ordered-list-in-a-lexical-draft.md)).
- **Linked directories**: grant a chat read access to a directory outside its workspace; the grant is
  per chat, sticky across sends, and reaches the runtime at session open.
- **Follow-up queue**: messages sent mid-turn land in a per-tab queue pinned above the composer — listed,
  reorderable, editable, and removable until they drain, with each row sendable out of turn.
- **Per-chat unread marks**: agent activity marks the individual chat, so the sidebar row, the session tab,
  and a cross-workspace "Last unread" pill all point at the tab that is actually waiting.
- Git-backed checkpoints capture per-turn state so you can restore an earlier point.
- Activity monitoring drives macOS notifications and power-state handling while the agent works.
- **Terminal harnesses** — the `claude` TUI, OpenAI Codex, and Mistral Vibe launch in workspace terminal
  tabs with auto-approve flags and exact-conversation resume. This is a separate path from the native
  Claude chat above (see [`docs/harnesses.md`](./docs/harnesses.md)).
- Resumable sessions and session tabs: agent sessions and dock terminals restore across restart, tabs
  reorder by drag, and session-tab keyboard shortcuts move between them.

### Ensemblr Control & orchestration

- Agents can **drive the app itself** through a permission-gated, guardrailed control surface — Pi via
  a shipped Pi extension, native Claude Code and MCP-client terminal harnesses via an embedded MCP server.
- The `ensemblr_*` tools spawn/steer/close conversations, launch harnesses, run terminals, open
  file/diff/comment tabs, focus panels, read and write Linear issues, and move the workspace across the
  board. Linear writes are withheld from sub-agents, and no op can move an issue to a `completed` or
  `canceled` state — agent work stops at In Review, enforced in the port rather than documented.
- **Multi-agent orchestration**: a root orchestrator delegates independent workstreams to sub-agents,
  then *delegate → wait → evaluate → integrate*; live sub-agent status surfaces in the dock.
- Control actions follow the workspace permission mode (read-only / approval-required /
  workspace-trusted) and are bounded by fork-bomb guardrails (shallow delegation, spawn quota + rate,
  wait timeout).
- See [`docs/agent-control.md`](./docs/agent-control.md).

### Review flow

- One review panel with three tabs — **Files**, **Changes**, **Checks** — remembered per workspace.
- Changed-files panel with add/delete/modify/rename/untracked status and line counts.
- Source-scoped diffs (uncommitted vs. a commit vs. a branch) and per-file discard.
- One shared code surface (`src/renderer/components/code-surface/`) renders the file viewer, the diff
  viewer, and in-timeline tool previews, so highlighting, gutters, and theming stay identical.
- Rich diff viewer with inline review comments anchored to specific lines; resolved comments strike
  through and drop out of bulk actions.
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
- **Named run scripts**: a repository declares any number of them as `[scripts.run.<name>]` tables in
  `.ensemblr/settings.toml` (or as personal rows), each with its own command, icon, and optional
  `available_in` list. The dock's Run button offers them by name; one can be flagged as the ⌘R default.
- Single-command **setup** and **archive** scripts run on the same lifecycle; setup is fingerprinted so an
  unchanged workspace skips it, and can chain the default run script when it exits 0.
- Read-only output panes for script sessions, plus additional interactive terminal tabs.
- Dock terminals restore across app restart with clean scrollback.
- Workspace processes inherit the user's shell-derived environment, workspace toolchain `PATH`, and `ENSEMBLR_*` variables.
- Bundled JetBrains Mono Nerd Font keeps terminal/code typography stable on first launch.

### History & archive

- Archive a workspace's context (git-backed) and browse it later.
- Global History screen to restore or permanently delete archived workspaces.

### Settings

- App and repository settings are persisted to `~/.config/ensemblr/config.json` (layered user /
  repository / workspace) and apply on a live config reload — no restart.
- App panes: General, Models, Providers, Environment, Git, Appearance, Integrations, then Diagnostics,
  Shortcuts, and Experimental under "More". Per-repository panes: Environment, Git, Scripts, Actions,
  Security, Misc. There is no catch-all Advanced page — its rows live where they belong (root directory in
  General, terminal scrollback in Appearance, the Pi executable override in Providers).
- **Providers** — per-runtime executable override, readiness checks, account/login command, and a link to
  the runtime's own settings file. **Models** — per-runtime model visibility.
- Git defaults: branch-prefix source, auto-rename workspace on branch, delete local branch on archive,
  archive after merge, set upstream on push.
- Repository run scripts are editable in-app and written back to `.ensemblr/settings.toml`
  ([ADR&nbsp;0041](./docs/adr/0041-write-repository-scripts-to-ensemblr-settings-toml.md)).
- Setup diagnostics with per-check remediation actions.
- Appearance settings for theme, accessible colors, code theme, markdown style, mono/terminal fonts, and terminal font size.
- A read-only **Shortcuts** reference, and a per-repository **Security** page holding the workspace
  permission mode.

### First run & language

- A first launch opens a **setup wizard** instead of the workbench: a welcome moment, a language picker,
  one screen per gate (agent CLI, GitHub CLI, Linear), and a terminal screen naming what is still
  unresolved. The agent-CLI gate is either-or — a machine carrying only Pi *or* only Claude Code reads as
  ready, and both the wizard and the diagnostics rollup resolve it from one table.
- The app ships in **English, Russian, and Greek**. The render language resolves in the main process and is
  seeded through the preload shell snapshot, so the first paint is already in the user's language; the
  native menu bar rebuilds from its own string table on a language change.
- **Agents answer in the app's language too.** `buildLanguageDirective` renders one block naming the
  reader's language, appended to every playbook surface — Pi per turn, Claude in the per-turn preamble, a
  harness in its `AGENTS.md` playbook. English resolves to no directive at all.
- Translation is a completion contract, not a backlog: a key a change adds ships with `ru` and `el` filled
  in the same change. See [`.claude/rules/i18n.md`](./.claude/rules/i18n.md) and
  [`docs/i18n-glossary.md`](./docs/i18n-glossary.md).

### Menus & window

- A native macOS menu bar of 9 menus, driven by a renderer command bus: the renderer reports which commands
  are live and what fills the dynamic submenus, main enables items from that report and rebuilds only when
  the report changes the menu
  ([ADR&nbsp;0046](./docs/adr/0046-drive-the-native-menu-bar-from-a-renderer-command-bus.md)).

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
| Composer editor | Lexical (`lexical` + `@lexical/react`), plain-text mode with decorator-node chips |
| Localization | i18next 26 + react-i18next 17 — `en` / `ru` / `el`, catalogues bundled as JSON |
| Terminal | xterm.js 6 + `node-pty` |
| Markdown | `streamdown` + Shiki |
| Agent runtimes | Pi (CLI RPC) + Claude Code (`@anthropic-ai/claude-agent-sdk`); Codex / Vibe / `claude` TUI as terminal harnesses |
| Agent control | Loopback HTTP + MCP (`@modelcontextprotocol/sdk`) |
| Validation | Zod 4 |
| Storage | SQLite via Node 24's built-in `node:sqlite` (`~/Library/Application Support/dev.ensemblr.app/ensemblr.db` on macOS) |
| Build | Vite 8, Electron Forge (DMG + ZIP, hardened runtime, notarized, arm64) |
| Testing | Vitest 4 (+ happy-dom) and `electron --test` |
| Lint / format | Biome 2.5 |
| Runtime / package manager | Node 24.x (exactly), npm 11 |

---

## Prerequisites

- **macOS** on Apple silicon — builds are arm64-only.
- **Node 24.x, exactly** (`>=24 <25`). Pinned by `.nvmrc`, `mise.toml`, and `package.json#engines`, and
  enforced by `scripts/require-node-version.mjs` at both `preinstall` and `package`/`make`.
- **[npm](https://www.npmjs.com)** — the enforced package manager, bundled with Node.js (see [`AGENTS.md`](./AGENTS.md)).
- **Pi CLI** — an agent runtime; Ensemblr spawns it in RPC mode
  (see [`docs/pi/rpc-protocol.md`](./docs/pi/rpc-protocol.md)).
- **Claude Code CLI (`claude`)** — the other agent runtime. Ensemblr drives *your* installed binary
  through the Agent SDK and ships none itself; point at it in Providers settings or leave it on `PATH`
  (see [ADR&nbsp;0042](./docs/adr/0042-add-claude-code-as-a-second-first-class-agent-runtime.md)).
- **Terminal harness CLIs** _(optional)_ — install `codex` and/or `vibe` to launch them as terminal
  harnesses; each appears only when its binary is on `PATH` (see [`docs/harnesses.md`](./docs/harnesses.md)).
- **GitHub CLI (`gh`)** — authenticate once with `gh auth login`. Ensemblr reads PR/check data through
  `gh` and does not store GitHub tokens (see [ADR&nbsp;0013](./docs/adr/0013-use-gh-cli-for-v1-github-integration.md)).
- **A Linear account** — for OAuth-based issue integration
  (see [ADR&nbsp;0024](./docs/adr/0024-use-linear-oauth-for-v1-issue-integration.md)).
- **git**

---

## Getting started

```bash
# Node 24.x is required; preinstall refuses anything else
node -v

# Install dependencies (postinstall fixes node-pty native-module permissions)
npm install

# Launch the app in development
npm run dev

# Or just the component playground — Vite only, no Electron
npm run dev:playground
```

Build outputs (macOS, arm64):

```bash
npm run package    # unpacked .app under out/
npm run make       # signed + notarized .dmg and .zip under out/make/
```

`make` produces a release build; `make:canary` / `make:dev` build dogfood channels, and
`make:unsigned` / `package:unsigned` / `package:dev` are the unsigned and dev-channel variants. Signing,
notarization, and channels are documented in [`docs/build-and-release.md`](./docs/build-and-release.md).

---

## Project structure

```
src/
├── main/       Electron main process (Node), organized concern-first — one folder per
│               concern, each behind an index.ts. Entry: main.ts.
│                 agent-runtime · pi-agent · claude-agent · agent-providers · agents
│                 agent-control · plan-mode · chat-tabs · checkpoints · commands
│                 repository · workspace-git · workspace-files · review · github · linear
│                 terminal · scripts · storage · config · environment · secrets · setup
│                 ipc · app · menu · open-target · root · pi-ipc · pi-runtime
│                 linked-directories
├── preload/    Context-isolated IPC bridge (bridge/ensemblr-api.ts). Entry: preload.ts.
├── renderer/   React UI, organized type-first: api · components · config · fixtures ·
│               hooks · lib · routing · state · styles · types. Entry: main.tsx.
└── shared/     Cross-process contracts: Zod config, ipc/ (channels + 35 contract modules),
                agent-control, harness registry (agents.ts), scripts, plan-mode, keymap,
                terminal, pi-rpc, menu-commands

resources/      Shipped Pi extensions (`pi-extensions/ensemblr-control.mts`)
playground/     Vite-only component preview harness (`npm run dev:playground`)

docs/
├── adr/            Architecture Decision Records (47, `0001`–`0047`)
├── onboarding.md · architecture-map.md — clone-to-first-PR runbook & directory index
├── agent-control.md · harnesses.md · build-and-release.md — feature & operator guides
├── i18n-glossary.md — the ru/el product vocabulary translations are held to
├── considerations/ Design records (Ensemblr Control, orchestration playbook, Deno migration)
├── pi/             Pi integration (RPC protocol, event taxonomy)
├── claude/         Claude Code runtime guide and SDK surface reference
├── product/        Roadmap, parity notes, shell/settings inventories
└── refactor/       Refactor plans

tests/          main/ · renderer/ · shared/ · fixtures/
scripts/        Build & maintenance scripts (Node-version gate + `with-pinned-node.sh`, Tailwind
                class check, node-pty permission fix, Pi fixture tooling, app icon + social
                avatar generation, Dock-flash diagnostics)
```

Each `src` subtree has its own scoped `AGENTS.md` with rules specific to that runtime boundary.
`src/main` is organized **concern-first** and `src/renderer` **type-first** — deliberately opposite axes;
do not copy one layout into the other.

---

## Architecture

Ensemblr is organized around four runtime boundaries:

- **`src/main`** — the Electron main process (Node). Entry: `src/main/main.ts`. Hosts services for
  repository/git operations, the agent runtime layer, terminal harness launch, the agent-control layer,
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
- **`src/shared`** — cross-process contracts: the Zod config schema, 35 typed IPC contract modules
  (`src/shared/ipc/contracts/`), the agent-control contracts and harness registry, run-script parsing,
  plan-mode tool guards, keymap definitions, the menu command table, and Pi-RPC parsing. It returns
  locale-neutral codes rather than English labels — it cannot reach the renderer's i18n instance, so a
  label it returned would be English forever.

**Agent runtime layer.** `src/main/agent-runtime/` owns the adapter contract, the `AgentClient`, and
session persistence, naming, and summaries. `pi-agent/` and `claude-agent/` are *siblings* implementing
that contract (with `fake-agent-adapter.ts` as the test double), so nothing runtime-specific lives above
the adapter line and a third runtime is a new folder rather than a branch inside an existing one
([ADR&nbsp;0042](./docs/adr/0042-add-claude-code-as-a-second-first-class-agent-runtime.md)).

**Data layer.** State persists to a SQLite database (Node 24's built-in `node:sqlite`) at
`~/Library/Application Support/dev.ensemblr.app/ensemblr.db` on macOS (repositories, workspaces, agent
sessions and their events, chat tabs, terminal sessions, checkpoints, review comments, settings) accessed
through a repository layer under `src/main/storage/`. Schema changes are numbered, append-only migrations
in `src/main/storage/database.ts`. App settings live in `~/.config/ensemblr/config.json`; per-repo config
is a committed `.ensemblr/settings.toml`. Per-turn checkpoints are git-backed
([ADR&nbsp;0012](./docs/adr/0012-use-git-backed-checkpoints-for-pi-turns.md)), and secrets are stored in
the macOS Keychain ([ADR&nbsp;0018](./docs/adr/0018-use-keychain-for-secrets.md)). The Ensemblr Root
Directory holds managed repositories, workspaces, and archived context.

**Agent Control layer.** Agents drive the app through a loopback HTTP control server
(`src/main/agent-control/`): Pi via `POST /invoke` (a shipped extension), MCP clients — native Claude Code
and MCP-capable terminal harnesses — via `POST /mcp`. One service resolves a per-workspace bearer token,
enforces scope and the workspace permission mode, applies fork-bomb guardrails, and delegates to existing
services — no new capability code
([ADR&nbsp;0040](./docs/adr/0040-use-loopback-control-server-for-agent-app-control.md)).

---

## Development workflow

This repository has explicit contributor policies — see [`AGENTS.md`](./AGENTS.md). In brief:

- **npm only.** Use `npm install`, `npm run <script>`, and `npx`. Do not create `bun.lock`,
  `pnpm-lock.yaml`, or `yarn.lock`.
- **Biome** for lint + format (no ESLint/Prettier):

  ```bash
  npm run check       # biome check + Tailwind class check + i18n lint + hardcoded-string scan
  npm run check:fix   # apply safe fixes (format + import organization)
  npm run format      # format only
  npm run lint        # lint only
  npm run typecheck   # tsc --noEmit across three projects: tsconfig.json,
                      # tsconfig.scripts.json, tsconfig.tests.json
  npm run doctor      # react-doctor diagnostics (npx react-doctor@latest)
  ```

- **Localization.** A user-facing string is a catalogue key, and a key a change adds ships translated:

  ```bash
  npm run i18n:extract  # regenerate locales/en + empty ru/el skeletons from the t() call sites
  npm run i18n:types    # regenerate src/renderer/types/i18next.d.ts
  npm run i18n:status   # per-locale completion — none of your keys may be listed
  ```

- **Tailwind scale.** No px-based arbitrary utilities (e.g. `w-[13px]`); `npm run check` enforces this via
  `scripts/check-tailwind-classes.mjs`.
- **State.** Jotai is the only app-level state solution.
- **Docs.** JSDoc is expected on functions, hooks, components, atoms, and IPC contracts.
- **Rule files.** [`.claude/rules/stack.md`](./.claude/rules/stack.md) holds the pinned versions and the
  constraints that are not obvious from `package.json`;
  [`.claude/rules/patterns.md`](./.claude/rules/patterns.md) holds the structural patterns a change has to
  follow. `jsdoc.md`, `comments.md`, and `code-review.md` sit alongside them.

**CI.** GitHub Actions runs one job — a `react-doctor` scan diffed against `master`, failing on `error` —
on pushes to `master` and PRs targeting it (`.github/workflows/checks.yml`). It does **not** run
`npm run check`, `npm run typecheck`, or the test suites; those are yours to run locally before pushing.

---

## Testing

Tests run under two runners (npm is the package manager, not a test runner):

- **Vitest** (`npx vitest run`) — shared (`tests/shared/**`), renderer (`tests/renderer/**`), and the
  pure-logic main-process suites. Config in `vitest.config.mts`; default `environment` is `node`, and DOM
  component tests opt into happy-dom per file with a `// @vitest-environment happy-dom` docblock. The
  `tests/main` entries are listed **one by one** in `include` rather than globbed, so the Electron-only
  suites stay out — a new pure-logic test under `tests/main/` must be added to that list.
- **`electron --test`** (via `ELECTRON_RUN_AS_NODE=1`) — main-process suites (`tests/main/**`) that need Electron/Node APIs.

Run everything with `npm run test`; add coverage with `npm run test:coverage` (native Istanbul →
`coverage/coverage-final.json`). Focused examples:

```bash
npm run test              # full Vitest suite (renderer + shared + pure-logic main)
npm run test:coverage     # Vitest with Istanbul coverage
npx vitest run <file>      # a single Vitest file
npm run test:renderer      # renderer suites (Vitest)
npm run test:renderer-dom  # renderer DOM component suites (Vitest + happy-dom)
npm run test:pi-rpc        # Pi RPC parsing (Vitest)
npm run test:agent-runtime # agent adapters incl. Claude normalizer (electron --test)
npm run test:db            # SQLite database (electron --test)
npm run test:workspace     # workspace creation (electron --test)
npm run test:github        # GitHub service (electron --test)
npm run test:linear        # Linear OAuth/API (electron --test)
```

See `package.json` for the full list of `test:*` scripts.

---

## Documentation

- [`docs/`](./docs) — documentation index.
- [`docs/onboarding.md`](./docs/onboarding.md) — clone → run → first change runbook.
- [`docs/architecture-map.md`](./docs/architecture-map.md) — which directory owns which concern.
- [`CONTEXT.md`](./CONTEXT.md) — product definition and ubiquitous language.
- [`CHANGELOG.md`](./CHANGELOG.md) — notable changes (Keep a Changelog format).
- [`AGENTS.md`](./AGENTS.md) — contributor policies (package manager, Biome, state, Tailwind, docs).
- [`docs/agent-control.md`](./docs/agent-control.md) — Ensemblr Control & orchestration.
- [`docs/harnesses.md`](./docs/harnesses.md) — the two first-class runtimes vs. the terminal harnesses.
- [`docs/build-and-release.md`](./docs/build-and-release.md) — packaging, signing, notarization, channels.
- [`docs/adr/`](./docs/adr) — 47 Architecture Decision Records.
- [`docs/i18n-glossary.md`](./docs/i18n-glossary.md) — the Russian and Greek product vocabulary;
  [`.claude/rules/i18n.md`](./.claude/rules/i18n.md) is the completion contract.
- [`docs/considerations/`](./docs/considerations) — design records (Ensemblr Control, orchestration).
- [`docs/pi/`](./docs/pi) — Pi RPC protocol and event taxonomy.
- [`docs/product/`](./docs/product) — roadmap, UX conventions, shell/settings inventories.
- [`docs/refactor/`](./docs/refactor) — refactor plans.
- [`LICENSE`](./LICENSE) — MIT license.

---

## License

[MIT](./LICENSE) © Philipp Soldunov
