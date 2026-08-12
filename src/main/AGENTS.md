# Main Process Agent Instructions

These instructions apply to everything under `src/main/`.

## Organization

- Keep `main.ts` as the Electron main-process entrypoint.
- Organize implementation by main-process concern, not by renderer file type.
- Use the established concern folders:
  - `agent-runtime/` for the provider-neutral agent surface: adapter contract, `AgentClient`, and the agent session service, persistence, naming, and summaries.
  - `pi-agent/` for the Pi CLI adapter: its RPC wire frames, payload normalizer, and slash commands.
  - `claude-agent/` for the Claude Code adapter, a sibling of `pi-agent/`.
  - `pi-runtime/` for Pi executable discovery and readiness checks.
  - `pi-ipc/` for transport plumbing shared by `pi-runtime/` and `pi-agent/`; pure utilities, no protocol knowledge.
  - `agent-providers/` for the provider-parameterized settings surface: model catalogue, executable overrides, readiness probes.
  - `agents/` for detecting which spawnable harnesses are installed and their trusted launch commands.
  - `agent-control/` for the loopback control server, its MCP endpoint, ports/adapters, guardrails, and origin registry.
  - `plan-mode/` for the per-session plan registry, plan-file writing, and plan submission.
  - `app/` for BrowserWindow creation and app lifecycle helpers.
  - `chat-tabs/` for the chat-tab service, preview slot, and terminal-session persistence.
  - `checkpoints/` for git-backed per-turn checkpoints.
  - `commands/` for local process and shell execution.
  - `config/` for declarative config loading, settings resolution, and repository config.
  - `environment/` for environment variable catalog and assembly.
  - `github/` and `linear/` for the `gh` CLI wrapper and PR sweeper, and Linear OAuth, client, and store.
  - `ipc/` for main-process IPC handler registration and request validation.
  - `linked-directories/` for read grants over directories outside a workspace, and the app-global recents list behind them.
  - `menu/` for the native Electron menu bar: one builder per menu behind `createMenuItemFactory`, composed by `application-menu.ts`, labelled from `menu-strings.ts`, and enabled from the renderer's command report.
  - `open-target/` for external editor and app detection and launch.
  - `repository/` for repository registration, git probing, and lifecycle.
  - `review/` for Ensemblr-local review comments and todos.
  - `root/` for managed root directory resolution and reconciliation.
  - `scripts/` for the named run-script lifecycle, setup/archive hooks, and setup fingerprint and state file.
  - `secrets/` for secret storage backends and metadata.
  - `setup/` for setup diagnostics orchestration.
  - `storage/` for SQLite connections, migrations, and the per-aggregate repository modules.
  - `terminal/` for `node-pty` PTY sessions and scrollback.
  - `workspace-files/` and `workspace-git/` for workspace file watching and listing, the content-addressed composer attachment store, path-safety and image-signature checks, and git status, commits, and worktrees.
- Do not add new root-level files under `src/main/` unless Electron Forge or Vite needs them as entrypoints.
- Main returns locale-neutral codes, never English labels — it cannot reach the renderer's i18n instance, so adding a code here is a user-facing change that owes the renderer mapper a `t()` case with `ru` and `el` filled. `menu/menu-strings.ts` is the one exception: it holds all three languages itself, because the menu bar is built before any renderer exists.
- Adding an agent runtime means a new adapter folder beside `pi-agent/` and `claude-agent/`, a provider id in `src/shared/agent-provider.ts`, and an entry in the client's adapter map. Keep runtime-specific flags, SDK option names, and wire shapes out of `agent-runtime/`.

## Public Surfaces

- Each concern folder should expose its intended public API through `index.ts`.
- Import from concern entrypoints outside the concern, for example `@/main/root`, unless a test intentionally targets a private module.
- Keep private helpers inside the concern module that owns the behavior.
- Put cross-process contracts in `src/shared/`; do not duplicate shared snapshot or IPC types in main modules.

## Boundaries

- Validate renderer-provided input in `ipc/` before passing it to services.
- Keep Electron-specific APIs in `src/main/` or `src/preload/`; never import them from `src/shared/` or `src/renderer/`.
- Main services may depend on `src/shared/` contracts and pure helpers, but not on renderer components, hooks, state, styles, or mocks.

## Verification

- After moving main-process files or imports, run `npm run typecheck`.
- Run the narrow `npm run test:<concern>` script for any changed behavior under a main concern.
- Run `npm run check` before finishing JavaScript, TypeScript, CSS, or JSON changes.
