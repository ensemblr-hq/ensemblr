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
- Do not create concern folders directly under `src/renderer/`, for example `src/renderer/workbench/`. Put the concern inside the right type bucket, for example `lib/workbench/`, `fixtures/workbench/`, `state/workspace/`, or `types/workbench/`.
- Do not put mutable app state, fixture data, route files, or feature implementation in `config/`; keep it for stable renderer constants such as route stale times.

## Components

- Keep shadcn and shared UI primitives under `components/ui/`.
- Keep composed product components under `components/<concern>.tsx` plus a private sibling folder when one is needed, for example `components/welcome.tsx` and `components/welcome/`. Larger concerns may live entirely inside the folder with named entrypoints, for example `components/workbench-shell/frame.tsx`, `components/workbench-shell/workspace-content.tsx`, and `components/workbench-shell/route-layout/index.ts`.
- Do not define shared exported renderer types in component folders. Import them from `types/`.
- Do not keep fixture data inside components. Import it from `fixtures/<concern>/`.
- Do not keep hooks inside component folders. Every `use-*.ts` belongs in `hooks/<concern>/`, mirroring the component sub-concern (for example `hooks/workbench-shell/composer/use-autocomplete.ts`). Components import them from there.
- Do not keep runtime utilities inside component folders. Pure helpers belong in `lib/<concern>/`.
- **Lexical stays inside the composer editor.** Every import of `lexical` or `@lexical/react` lives under `components/workbench-shell/conversation-panel/composer/editor/`, behind that folder's `index.ts`. The editor publishes the draft out as plain text plus its runs and chips in document order, so autocomplete, the send pipeline, and the follow-up queue never learn a rich-text editor is involved. A Lexical import outside that folder means the linearizer is missing a case — see [ADR 0047](../../docs/adr/0047-model-composer-attachments-as-one-ordered-list-in-a-lexical-draft.md).

## Routing

- Use TanStack Router file-based routing under `routing/routes/`.
- Define route files with `createFileRoute` and export the route as `Route`. Keep the root route in `routing/routes/__root.tsx` with `createRootRouteWithContext`.
- Use TanStack Router filename conventions in `routing/routes/`: leading `_` for pathless layout routes and `$param` segments for dynamic params.
- Treat `routing/routeTree.gen.ts` as generated output from the Vite TanStack Router plugin. Do not hand-edit it; update route files and let the plugin regenerate the tree.
- Keep router construction, hash history, router context, and module registration in `routing/router.tsx`.
- Keep reusable route loading, redirect, and canonicalization orchestration in `routing/*-route-loaders.ts`. Keep pure domain helpers in `lib/<concern>/`.
- Keep shared route components, layouts, and route boundary UI under `components/<concern>/`; route files should wire routes to those components rather than accumulating large UI implementations.
- Put route params, router context, and exported loader-data types in `types/routing.ts`. Search param domain types belong with the concern they describe, such as `types/workbench/routing.ts`.

## State

- Use Jotai for shared renderer state.
- Place durable state under `state/<concern>/`. Do not leave loose `.ts` files at the `state/` root.
- Each state concern must expose its public surface through `state/<concern>/index.ts`.
- Keep atoms in `state/<concern>/atoms.ts`; keep larger state hooks in sibling files such as `navigation.ts` or `session-tabs.ts`. A concern that outgrows one atom file splits by topic into `<topic>-atoms.ts` siblings — see `state/workspace/` — never into a nested folder.
- Outside the concern folder, import from `@/renderer/state/<concern>`, not from private state files.
- State-only — no plain renderer hooks at the `state/` root. Hooks that wrap TanStack Query for live status (and similar utilities) belong in `hooks/<concern>/`.

## Runtime Helpers And Types

- Put runtime helpers under `lib/<concern>/`.
- If a helper concern has multiple files, add `lib/<concern>/index.ts` as a runtime-value barrel.
- Do not export shared types from `lib/` barrels. Shared exported renderer types belong in `types/`.
- Keep a single-file type concern as `types/<concern>.ts`. A concern that outgrows one file becomes `types/<concern>/` with an `index.ts` barrel — `types/workbench/`, `types/workbench-shell/`, `types/components/` — and callers import `@/renderer/types/<concern>`.
- Put ambient renderer declarations, such as `Window` bridge types, under `types/`.

## User-Facing Strings

- Every user-facing string is a catalogue key, not a literal. Write
  `t('<namespace>:<surface>.<element>', 'Default English')` — English is
  extracted from the call sites by `npm run i18n:extract`, never hand-written
  into `lib/i18n/locales/en/`.
- `i18n.t()` is for `lib/` only. Anything reachable from a component or a hook
  must use `useTranslation()`, or it will not re-render when the language
  changes.
- Never hand-edit `lib/i18n/locales/**`. Run `npm run i18n:extract` and then
  `npm run i18n:types` after adding keys; `npm run i18n:status` reports
  per-locale completion.
- Plurals pass `count` with `defaultValue_one` / `defaultValue_other`. Never
  concatenate a plural — Russian has four categories and changes the verb too.
  One `t()` call pluralises exactly one noun; a sentence with two countable
  nouns needs one call each, composed through placeholders.
- **Memoising a `lib/` function that calls the singleton needs the language in
  its deps.** `useMemo(() => presentToolCall(part), [part])` returns the
  language it was first computed in, forever — the component re-renders on
  `languageChanged` but the memo does not recompute. Add `i18n.language` from
  `useTranslation()` to the deps array. This does not apply to `useCallback`,
  which memoises the function rather than its result.
- **`src/shared/` returns locale-neutral codes, never English labels.** It sits
  on a cross-process boundary and cannot reach the renderer's i18n instance, so
  a label it returns is English forever — and interpolating one into a
  translated sentence yields half-translated output, `aria-label`s included.
  Export the union and translate it renderer-side.
- `npm run check` runs `i18n:lint`, which fails on hardcoded strings and on
  sentences concatenated across translations. Suppress a genuine false positive
  — a brand name, a `⌘↵` glyph, a command example — with an
  `i18next-instrument-ignore` directive, not by widening the config.
- See `docs/i18n-glossary.md` for the product vocabulary in `ru` and `el`. Fix a
  term there before translating, and record any new call you had to make.
- **A key you add ships translated.** `ru` and `el` are filled in the same
  change, and a surface you touch comes out with no empty values left behind.
  `.claude/rules/i18n.md` carries the full contract.

## Fixture Data

- Put fixture, demo, and placeholder data under `fixtures/<concern>/`.
- Fixture selectors and fixture-specific builders belong with the data.
- Production components and runtime helpers may import fixture data only while the feature is fixture-backed; keep that dependency explicit with `@/renderer/fixtures/<concern>`. The folder name communicates that production paths still rely on placeholder data.

## Verification

- For changes touching renderer JavaScript, TypeScript, JSX, TSX, CSS, or JSON, run `npm run check`.
- Run `npm run typecheck` after moving renderer files or changing imports.
- Run `npm run test:renderer` after changing renderer behavior, component structure, state, routing, or fixtures.
