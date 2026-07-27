# Shared Agent Instructions

These instructions apply to everything under `src/shared/`.

## Organization

- Shared code is for cross-process contracts and pure helpers used by main, preload, renderer, and tests.
- Keep public concern entrypoints at the shared root, for example `ipc.ts` and `permissions.ts`.
- If a shared concern grows past one file, move implementation into a same-named folder and keep the root file as the public entrypoint.
- Group IPC constants and contract types under `ipc/`.

## Boundaries

- Do not import Electron, React, renderer state, main services, filesystem APIs, shell APIs, or process-specific runtime objects from shared modules.
- Shared modules must be safe to import from main, preload, renderer, and Node tests.
- Keep runtime values minimal and deterministic; prefer exported types for cross-process snapshots.

## Verification

- After moving shared files or imports, run `npm run typecheck`.
- Run the relevant main or renderer tests for any shared contract changed by behavior, not just by location.
- Run `npm run check` before finishing JavaScript, TypeScript, CSS, or JSON changes.
