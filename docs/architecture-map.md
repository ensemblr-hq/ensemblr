# Architecture Map

A "where does this live?" index for the four runtime boundaries. The root
[`README.md`](../README.md#architecture) explains *what* the architecture is;
this file answers *which directory owns a given concern* so a change lands in the
right place on the first try.

Each `src` subtree also carries a scoped `AGENTS.md`
([main](../src/main/AGENTS.md) · [renderer](../src/renderer/AGENTS.md) ·
[preload](../src/preload/AGENTS.md) · [shared](../src/shared/AGENTS.md)) with the
binding rules for that boundary. Those files are normative; this one is a map.

## Entry points

| Runtime | Entry | Bundled by |
| --- | --- | --- |
| Main process (Node) | `src/main/main.ts` | `vite.main.config.mts` |
| Preload (context-isolated) | `src/preload/preload.ts` | `vite.preload.config.mts` |
| Renderer (React) | `src/renderer/main.tsx` → `#root` | `vite.renderer.config.mts` |
| Dev preview harness | `playground/main.tsx` | `vite.playground.config.mts` |

Electron Forge wires the first three in `forge.config.ts` via `VitePlugin`. The
same list is fallow's `entry` surface in `.fallowrc.jsonc` — add a new entry to
both or fallow will report the new tree as dead code.

## `src/main` — Electron main process

Organized by **main-process concern**, never by file type. One folder per concern,
each exposing its public surface through `index.ts`.

| Concern | Folder | Owns |
| --- | --- | --- |
| Agent surface (provider-neutral) | `agent-runtime/` | Adapter contract, `AgentClient`, session service, persistence, naming, summaries |
| Pi adapter | `pi-agent/` | Pi CLI RPC wire frames (`cli-rpc/`), payload normalizer, slash commands |
| Claude adapter | `claude-agent/` | Claude Code adapter, MCP config + roster, model catalogue, readiness |
| Pi runtime discovery | `pi-runtime/` | Pi executable discovery, readiness checks |
| Pi transport plumbing | `pi-ipc/` | JSONL line stream shared by `pi-runtime/` and `pi-agent/`; no protocol knowledge |
| Provider catalogue | `agent-providers/` | Model catalogue, executable overrides, readiness probes across runtimes |
| Harness detection | `agents/` | Which spawnable harnesses are installed on PATH, and their trusted launch commands |
| Agent → app control | `agent-control/` | Loopback control server, MCP endpoint, ports/adapters, guardrails, origin registry |
| Plan mode | `plan-mode/` | Per-session plan registry, plan-file writing, plan submission — the enforcement classifiers live in `src/shared/plan-mode/` |
| App lifecycle | `app/` | `BrowserWindow` creation, window state |
| Chat tabs | `chat-tabs/` | Tab service, preview slot, terminal-session persistence |
| Checkpoints | `checkpoints/` | Git-backed per-turn checkpoints (ADR&nbsp;0012) |
| Process execution | `commands/` | Local process and shell execution |
| Config | `config/` | Declarative config loading, settings resolution, repository config |
| Environment | `environment/` | Environment-variable catalogue and assembly |
| IPC | `ipc/` | Handler registration (`handlers/`, 28 modules), request validation (`request-schemas/`), permission gate |
| Integrations | `github/`, `linear/` | `gh` CLI wrapper, PR snapshots; Linear OAuth + client + store |
| Native menus | `menu/` | Electron application menus |
| Open targets | `open-target/` | External editor/app detection and launch |
| Repositories | `repository/` | Registration, git probing, lifecycle |
| Review | `review/` | Ensemblr-local review comments and todos |
| Root directory | `root/` | Managed root resolution and reconciliation |
| Scripts | `scripts/` | Named run-script lifecycle, setup/archive hooks, setup fingerprint and state file |
| Secrets | `secrets/` | Keychain-backed storage and metadata (ADR&nbsp;0018) |
| Setup | `setup/` | Setup diagnostics orchestration |
| Storage | `storage/` | SQLite connection (`database.ts`), migrations, `repositories/`, `tx.ts` |
| Terminal | `terminal/` | `node-pty` PTY sessions |
| Workspace files / git | `workspace-files/`, `workspace-git/` | File watching and listing; git status, commits, worktrees |

Do not add root-level files under `src/main/` unless Electron Forge or Vite needs
them as an entrypoint.

## `src/preload` — the IPC bridge

Deliberately tiny: `preload.ts` plus `bridge/ensemblr-api.ts` behind
`bridge/index.ts`. `preload.ts` owns every `contextBridge.exposeInMainWorld`
call — `window.ensemblr` for the API, plus a best-effort
`window.ensemblrInitialShellSnapshot` seeded synchronously so the renderer can
skip a first round trip. Nothing else crosses: no raw `ipcRenderer`, no Node
APIs, no Electron objects, no service instances. Argument normalization and
trust-boundary validation belong in the main-process handler, not here.

## `src/renderer` — React UI

Organized **by file type first, then by concern** — the mirror image of `src/main`.
A new feature is split across these buckets, not given a folder of its own.

| Bucket | Holds | Concern folders inside |
| --- | --- | --- |
| `api/` | TanStack Query clients, query options, preload-backed access | `ensemblr/` |
| `components/` | React components and UI composition | `workbench-shell/`, `conversation/`, `diff-viewer/`, `code-surface/`, `settings/`, `setup-diagnostics/`, `git/`, `linear/`, `command-palette/`, `ask-user-question/`, `tool-collapsible/`, `pi-replay/`, `welcome/`, `ui/` (vendored shadcn) |
| `config/` | Stable renderer constants (route stale times, knobs) | — |
| `hooks/` | Renderer hooks that are not durable shared state | `workbench-shell/`, `workspace/`, `conversation/`, `code-surface/`, `settings/`, `setup-diagnostics/`, `preferences/`, `git/`, `linear/`, `ask-user-question/`, `welcome/` |
| `lib/` | Runtime helpers grouped by concern | `workbench/`, `agent-timeline/`, `conversation/`, `diff/`, `code/`, `github/`, `linear/`, `pi/`, `pi-replay/`, `terminal/`, `instrumentation/`, `ask-user-question/`, `welcome/` |
| `fixtures/` | Fixture/demo data production code may still consume | `workbench/` |
| `routing/` | TanStack Router file routes + generated tree | `routes/` |
| `state/` | Durable Jotai state | `workspace/`, `composer/`, `pi/`, `plan-mode/`, `preferences/`, `dialogs/`, `recents/`, `sidebar/`, `settings-ui/`, `tool-approval/`, `ask-user-question/`, `conversation-scroll/`, `close-action/` |
| `styles/` | CSS entrypoint (`index.css`) and font assets | — |
| `types/` | Exported renderer types and ambient declarations | `workbench/`, `workbench-shell/`, `components/` |

Never create a concern folder directly under `src/renderer/` (no
`src/renderer/workbench/`). The concern goes inside the right bucket:
`lib/workbench/`, `state/workspace/`, `types/workbench/`.

**Routing.** File-based TanStack Router under `routing/routes/`
(ADR&nbsp;0026): `__root.tsx` uses `createRootRouteWithContext`, route files use
`createFileRoute` and export `Route`, `_`-prefixed files are pathless layouts,
`$param` segments are dynamic. `routing/routeTree.gen.ts` is generated by the
Vite plugin and is never hand-edited. Router construction, hash history, and
module registration live in `routing/router.tsx`.

**State.** Jotai is the only app-level store. Atoms live in
`state/<concern>/`, and everything outside the concern imports from
`state/<concern>/index.ts` — that barrel is the public surface, which is why
`.fallowrc.jsonc` lists `src/renderer/state/*/index.ts` as an entry. `useState`
is fine for state one component owns; anything crossing a boundary becomes an
atom.

## `src/shared` — cross-process contracts

The only code both processes may import. Two shapes coexist:

- **Single-file concerns** — plain root modules (`config.ts`, `permissions.ts`,
  `github.ts`, `slug.ts`, …); 23 `.ts` files sit at the shared root in total.
- **Multi-file concerns** — an implementation directory behind a stable
  entrypoint, in one of two forms:
  - `<concern>/index.ts` — `ipc/` (34 contract modules under `ipc/contracts/`,
    plus `channels.ts` and `handler-map.ts`), `pi-rpc/`, `keymap/`.
  - `<concern>.ts` + `<concern>/` — `agent-control`, `plan-mode`, `scripts`,
    `terminal`. This is the form `electron --test` can resolve, so prefer it for
    anything the main-process suites import.

Never import renderer UI, main-process services, Electron, or `node:fs` from
here.

## Two request paths

**1. Renderer → main (IPC).** Adding a call touches four files, in order:

1. `src/shared/ipc/channels.ts` — add the channel name (`ensemblr:<kebab-name>`).
2. `src/shared/ipc/contracts/<concern>.ts` — the request/response types.
3. `src/main/ipc/request-schemas/<concern>.ts` — the Zod validator.
4. `src/main/ipc/handlers/<concern>.ts` — the handler, delegating to the service.

Then expose it on `src/preload/bridge/ensemblr-api.ts` and consume it from
`src/renderer/api/`.

**2. Agent → app (Ensemblr Control).** A loopback HTTP server in
`src/main/agent-control/` accepts Pi via `POST /invoke` (through the shipped
extension `resources/pi-extensions/ensemblr-control.mts`) and MCP-capable
harnesses via `POST /mcp`. One service resolves a per-workspace bearer token,
enforces scope and the workspace permission mode, applies fork-bomb guardrails,
then delegates through a **port** (`ports.ts`, `port-adapters.ts`,
`review-ports.ts`) to an existing service. Control adds no capability code of its
own — if an operation does not exist as a service, it does not exist as a control
op. See [`agent-control.md`](./agent-control.md) and ADR&nbsp;0040.

## Where state persists

| Data | Location |
| --- | --- |
| Repositories, workspaces, sessions, events, chat tabs, settings | SQLite at `~/Library/Application Support/dev.ensemblr.app/ensemblr.db` |
| App settings | `~/.config/ensemblr/config.json` (ADR&nbsp;0029) |
| Per-repository config | Committed `.ensemblr/settings.toml` (ADR&nbsp;0030, ADR&nbsp;0041) |
| Secrets | macOS Keychain (ADR&nbsp;0018) |
| Per-turn checkpoints | Git refs in the workspace (ADR&nbsp;0012) |
| Managed repos, workspaces, archived context | The Ensemblr Root Directory (ADR&nbsp;0010) |

Schema changes go through the numbered migration list in
`src/main/storage/database.ts`; `tests/main/database.test.ts` asserts the exact
migration ids, so a new migration must be added to both.

## Tests

| Suite | Runner | Count |
| --- | --- | --- |
| `tests/main/**` | `electron --test` (`ELECTRON_RUN_AS_NODE=1`), plus the pure-logic files listed one-by-one in `vitest.config.mts` — an explicit list, not a glob, so it never drags in the Electron-only suites | 137 files |
| `tests/renderer/**` | Vitest (`node` env; DOM files opt in per file) | 193 files (16 under `dom/`) |
| `tests/shared/**` | Vitest | 28 files |

See [`onboarding.md`](./onboarding.md#6-running-the-tests) for which runner a new
test should use.
