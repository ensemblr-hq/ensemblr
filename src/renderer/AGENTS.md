# Renderer Agent Instructions

These instructions apply to everything under `src/renderer/`.

## Organization

- Organize renderer code by file type first, then by concern.
- Keep `main.tsx` as the only root-level renderer source file unless a build tool explicitly requires another root file.
- Use the established top-level buckets:
  - `api/` for TanStack Query clients, query options, and preload-backed data access.
  - `components/` for React components and UI composition.
  - `config/` for renderer-scoped configuration constants and knobs.
  - `hooks/` for renderer hooks that are not durable shared app state.
  - `lib/` for runtime helpers, grouped by concern.
  - `fixtures/` for fixture, demo, and placeholder data that production code may consume while a feature is still fixture-backed.
  - `routing/` for TanStack Router file-based routes, generated route trees, and route helpers.
  - `state/` for durable renderer UI state.
  - `styles/` for renderer CSS entrypoints and style assets.
  - `types/` for shared exported renderer types and ambient declarations.
- Do not create concern folders directly under `src/renderer/`, for example `src/renderer/workbench/`. Put the concern inside the right type bucket, for example `lib/workbench/`, `fixtures/workbench/`, `state/workspace/`, or `types/workbench.ts`.
- Do not put mutable app state, fixture data, route files, or feature implementation in `config/`; keep it for stable renderer constants such as route stale times.

## Components

- Keep shadcn and shared UI primitives under `components/ui/`.
- Keep composed product components under `components/<concern>.tsx` plus a private sibling folder when one is needed, for example `components/welcome.tsx` and `components/welcome/`. Larger concerns may live entirely inside the folder with named entrypoints, for example `components/workbench-shell/frame.tsx`, `components/workbench-shell/workspace-content.tsx`, and `components/workbench-shell/route-layout/index.ts`.
- Do not define shared exported renderer types in component folders. Import them from `types/`.
- Do not keep fixture data inside components. Import it from `fixtures/<concern>/`.
- Do not keep hooks inside component folders. Every `use-*.ts` belongs in `hooks/<concern>/`, mirroring the component sub-concern (for example `hooks/workbench-shell/composer/use-autocomplete.ts`). Components import them from there.
- Do not keep runtime utilities inside component folders. Pure helpers belong in `lib/<concern>/`.

## Routing

- Use TanStack Router file-based routing under `routing/routes/`.
- Define route files with `createFileRoute` and export the route as `Route`. Keep the root route in `routing/routes/__root.tsx` with `createRootRouteWithContext`.
- Use TanStack Router filename conventions in `routing/routes/`: leading `_` for pathless layout routes and `$param` segments for dynamic params.
- Treat `routing/routeTree.gen.ts` as generated output from the Vite TanStack Router plugin. Do not hand-edit it; update route files and let the plugin regenerate the tree.
- Keep router construction, hash history, router context, and module registration in `routing/router.tsx`.
- Keep reusable route loading, redirect, and canonicalization orchestration in `routing/*-route-loaders.ts`. Keep pure domain helpers in `lib/<concern>/`.
- Keep shared route components, layouts, and route boundary UI under `components/<concern>/`; route files should wire routes to those components rather than accumulating large UI implementations.
- Put route params, router context, and exported loader-data types in `types/routing.ts`. Search param domain types belong with the concern they describe, such as `types/workbench.ts`.

## State

- Use Jotai for shared renderer state.
- Place durable state under `state/<concern>/`. Do not leave loose `.ts` files at the `state/` root.
- Each state concern must expose its public surface through `state/<concern>/index.ts`.
- Keep atoms in `state/<concern>/atoms.ts`; keep larger state hooks in sibling files such as `navigation.ts` or `session-tabs.ts`.
- Outside the concern folder, import from `@/renderer/state/<concern>`, not from private state files.
- State-only — no plain renderer hooks at the `state/` root. Hooks that wrap TanStack Query for live status (and similar utilities) belong in `hooks/<concern>/`.

## Runtime Helpers And Types

- Put runtime helpers under `lib/<concern>/`.
- If a helper concern has multiple files, add `lib/<concern>/index.ts` as a runtime-value barrel.
- Do not export shared types from `lib/` barrels. Shared exported renderer types belong in `types/`.
- Put ambient renderer declarations, such as `Window` bridge types, under `types/`.

## Fixture Data

- Put fixture, demo, and placeholder data under `fixtures/<concern>/`.
- Fixture selectors and fixture-specific builders belong with the data.
- Production components and runtime helpers may import fixture data only while the feature is fixture-backed; keep that dependency explicit with `@/renderer/fixtures/<concern>`. The folder name communicates that production paths still rely on placeholder data.

## Verification

- For changes touching renderer JavaScript, TypeScript, JSX, TSX, CSS, or JSON, run `npm run check`.
- Run `npm run typecheck` after moving renderer files or changing imports.
- Run `npm run test:renderer` after changing renderer behavior, component structure, state, routing, or fixtures.
