# Shared Agent Instructions

These instructions apply to everything under `src/shared/`.

## Organization

- Shared code is for cross-process contracts and pure helpers used by main, preload, renderer, and tests.
- Keep public concern entrypoints at the shared root, for example `permissions.ts` and `agent-provider.ts`.
- If a shared concern grows past one file, move implementation into a same-named folder and keep the root file as the public entrypoint — `agent-control.ts` + `agent-control/`, and the same pair for `plan-mode`, `scripts`, and `terminal`. Prefer this form over a bare `<concern>/index.ts`: `electron --test` runs through the Node ESM loader, which cannot resolve a directory specifier.
- `ipc/`, `keymap/`, and `pi-rpc/` use the `<concern>/index.ts` form instead. Leave them as they are.
- Group IPC constants and contract types under `ipc/`: channel names in `ipc/channels.ts`, request and response types in one module per concern under `ipc/contracts/`.
- Register a new multi-file concern entrypoint in `.fallowrc.jsonc` `entry` or fallow reports its re-exports as dead code. Single-file concerns stay off that list on purpose, so a genuinely unused export still surfaces.

## Boundaries

- Do not import Electron, React, renderer state, main services, filesystem APIs, shell APIs, or process-specific runtime objects from shared modules.
- Shared modules must be safe to import from main, preload, renderer, and Node tests.
- Keep runtime values minimal and deterministic; prefer exported types for cross-process snapshots.

## Verification

- After moving shared files or imports, run `npm run typecheck`.
- Run the relevant main or renderer tests for any shared contract changed by behavior, not just by location.
- Run `npm run check` before finishing JavaScript, TypeScript, CSS, or JSON changes.
