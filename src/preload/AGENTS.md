# Preload Agent Instructions

These instructions apply to everything under `src/preload/`.

## Organization

- Keep `preload.ts` as the Electron preload entrypoint.
- Put context bridge API construction under `bridge/`.
- Do not add unrelated app, renderer, or main-process business logic to preload modules.
- Import cross-process contracts from `src/shared/`.

## Boundaries

- Expose only typed, narrow APIs through `contextBridge`.
- Do not expose raw `ipcRenderer`, Node APIs, Electron objects, or mutable service instances to the renderer.
- Keep argument normalization and trust-boundary validation in main-process IPC handlers unless preload can reject obviously invalid calls without changing behavior.

## Verification

- After moving preload files or imports, run `bun run typecheck`.
- Run `bun run check` before finishing JavaScript or TypeScript changes.
