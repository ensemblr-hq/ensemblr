# Renderer Agent Instructions

These instructions apply to everything under `src/renderer/`.

## Organization

- Organize renderer code by file type first, then by concern.
- Keep `main.tsx` as the only root-level renderer source file unless a build tool explicitly requires another root file.
- Use the established top-level buckets:
  - `api/` for TanStack Query clients, query options, and preload-backed data access.
  - `components/` for React components and UI composition.
  - `hooks/` for renderer hooks that are not durable shared app state.
  - `lib/` for runtime helpers, grouped by concern.
  - `mocks/` for mock, fixture, demo, and placeholder data.
  - `routing/` for TanStack Router route trees and route helpers.
  - `state/` for durable renderer UI state.
  - `styles/` for renderer CSS entrypoints and style assets.
  - `types/` for shared exported renderer types and ambient declarations.
- Do not create concern folders directly under `src/renderer/`, for example `src/renderer/workbench/`. Put the concern inside the right type bucket, for example `lib/workbench/`, `mocks/workbench/`, `state/workspace/`, or `types/workbench.ts`.

## Components

- Keep shadcn and shared UI primitives under `components/ui/`.
- Keep composed product components under `components/<concern>.tsx` plus private sibling folders, for example `components/workbench-shell.tsx` and `components/workbench-shell/`.
- Do not define shared exported renderer types in component folders. Import them from `types/`.
- Do not keep mock or fixture data inside components. Import it from `mocks/<concern>/`.

## State

- Use Jotai for shared renderer state.
- Place durable state under `state/<concern>/`.
- Each state concern must expose its public surface through `state/<concern>/index.ts`.
- Keep atoms in `state/<concern>/atoms.ts`; keep larger state hooks in sibling files such as `navigation.ts` or `session-tabs.ts`.
- Outside the concern folder, import from `@/renderer/state/<concern>`, not from private state files.

## Runtime Helpers And Types

- Put runtime helpers under `lib/<concern>/`.
- If a helper concern has multiple files, add `lib/<concern>/index.ts` as a runtime-value barrel.
- Do not export shared types from `lib/` barrels. Shared exported renderer types belong in `types/`.
- Put ambient renderer declarations, such as `Window` bridge types, under `types/`.

## Mock Data

- Put mock, fixture, demo, and placeholder data under `mocks/<concern>/`.
- Mock selectors and mock-specific builders belong with the mock data.
- Production components and runtime helpers may import mock data only while the feature is fixture-backed; keep that dependency explicit with `@/renderer/mocks/<concern>`.

## Verification

- For changes touching renderer JavaScript, TypeScript, JSX, TSX, CSS, or JSON, run `bun run check`.
- Run `bun run typecheck` after moving renderer files or changing imports.
- Run `bun run test:renderer` after changing renderer behavior, component structure, state, routing, or mocks.
