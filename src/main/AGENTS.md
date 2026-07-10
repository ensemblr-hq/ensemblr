# Main Process Agent Instructions

These instructions apply to everything under `src/main/`.

## Organization

- Keep `main.ts` as the Electron main-process entrypoint.
- Organize implementation by main-process concern, not by renderer file type.
- Use the established concern folders:
  - `app/` for BrowserWindow creation and app lifecycle helpers.
  - `commands/` for local process and shell execution.
  - `config/` for declarative config loading and settings resolution.
  - `environment/` for environment variable catalog and assembly.
  - `ipc/` for main-process IPC handler registration and request validation.
  - `menu/` for native Electron menus.
  - `pi/` for Pi executable and readiness checks.
  - `pi-agent/` for the `PiAgentClient` runtime boundary and adapters.
  - `repository/` for repository registration, git probing, and lifecycle.
  - `root/` for managed root directory resolution and reconciliation.
  - `secrets/` for secret storage backends and metadata.
  - `setup/` for setup diagnostics orchestration.
  - `storage/` for SQLite connections and migrations.
- Do not add new root-level files under `src/main/` unless Electron Forge or Vite needs them as entrypoints.

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
