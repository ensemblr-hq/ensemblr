# Desktop App Agent Instructions

These instructions apply to everything under `apps/desktop/` — Ensemblr, the Electron desktop app. The repository-wide rules in the root `AGENTS.md` (repository layout, package manager, Biome, test runner, git and tracker workflow) apply here too; this file adds what is specific to the app.

**Paths in this file, and in the scoped `AGENTS.md` files beneath it, are relative to `apps/desktop/`** — `src/main/` means `apps/desktop/src/main/`. A path that names a repository-root file says so. When you write a path in prose for a reader at the repository root, include the `apps/desktop/` prefix.

Run the app's scripts from this directory (`bun run dev`, `bun run test`, `bun run test:db`, …), or from the repository root as `bun run --cwd apps/desktop <script>`. `bun install` and `bun ci` work from either place; Bun installs the whole monorepo.

## Toolchain

- `bun run check` here runs Biome over the app (through `biome.json`, which extends the root's house style), the Tailwind scale check, the hardcoded-string scan, and `i18n:lint`. The root's `bun run check` adds the lockfile check and runs this one.
- Keep `bun run typecheck` as a separate verification step for TypeScript type errors. It checks four projects — the app (`tsconfig.json`), dev scripts (`tsconfig.scripts.json`), tests (`tsconfig.tests.json`), and demo mode (`tsconfig.demo.json`) — so `.ts` files under `scripts/` and `tests/` are type-checked even though `bunx tsx`/`node` and Vitest run them without checking. `scripts/typecheck.mjs` runs the four concurrently and names whichever failed; add a new project there rather than chaining another `tsc` call.
- The monorepo hoists this app's dependencies into the repository root's `node_modules`. Two tools look under `apps/desktop/node_modules` and nowhere else — Electron Forge for Electron itself, and `@electron/packager` for the runtime packages `forge.config.ts` keeps through `PACKAGE_KEEP_*` — so the workspace `postinstall` (`scripts/link-hoisted-packages.mjs`, run on every install through the root's `postinstall`) links exactly those packages here. Keep its list in step with `PACKAGE_KEEP_*`. `forge.config.ts` sets `derefSymlinks: true` so the package ships real files, and `prune: false` because packager's pruning walker cannot see a hoisted root.
- Tooling that reads a config from its working directory runs against this one: shadcn reads `components.json` here (`bunx shadcn@latest add <item> --cwd apps/desktop` from the root), and react-doctor and fallow read `doctor.config.jsonc`, `knip.jsonc`, and `.fallowrc.jsonc` here (`fallow --root apps/desktop`).
- A script that needs an installed package's files resolves them through `scripts/installed-packages.mjs` (`findInstalledPackage`, `findInstalledBinary`) rather than building a `node_modules/<name>` path from this directory, which would miss the hoisted copy.

## Testing Policy

Vitest is the mandated test runner for renderer and shared tests; `bun run test` invokes it through the `test` script.

- Renderer tests (`tests/renderer/**`) and shared tests (`tests/shared/**`) run under Vitest. Do not import from `bun:test`. Do not add Jest, Mocha, or any other runner.
- Bun manages packages: install test tooling with `bun add -d` and run Vitest with `bunx vitest` (for example `bunx vitest run`, or a focused `bunx vitest run <file>`). Do not use `npm`/`npx`/`pnpm`/`yarn`.
- Vitest config lives in `vitest.config.mts`. The default `environment` is `node` so platform-sensitive pure-logic tests (keymap, etc.) keep the real `navigator`/`process`. DOM component tests opt into happy-dom per file with a `// @vitest-environment happy-dom` docblock — never register a DOM globally.
- DOM harness: `tests/renderer/support/dom.tsx` exposes `renderWithProviders` and the `window.ensemblr` stub helpers; jest-dom matchers are registered globally in `tests/renderer/support/vitest.setup.ts`. `@testing-library/react` auto-unmounts after each test because `globals: true`.
- Coverage is native Istanbul: run `bunx vitest run --coverage` (provider `istanbul`) to emit `coverage/coverage-final.json`, which `fallow audit --coverage <file> --coverage_root <apps/desktop>` reads directly. There is no lcov→istanbul bridge; do not reintroduce one.
- Mocks use Vitest: `vi.fn()` for spies, `vi.spyOn()` for method spies, and `vi.mock()` (hoisted; use `vi.hoisted()` for factory-referenced variables) for module mocks. Do not use `mock()`/`mock.module()`.
- Main-process tests (`tests/main/**`) stay on their `electron --test` scripts — they need the Electron runtime and are not run by Vitest.

## State Management Policy

- Use Jotai as the only app-level state management solution.
- Define shared renderer state with Jotai atoms in concern-owned modules under `src/renderer/state/`, for example `src/renderer/state/preferences/atoms.ts`.
- Each state concern should expose a narrow public surface through `src/renderer/state/<concern>/index.ts`; import from that index outside the concern.
- Do not place shared Jotai atoms under `src/renderer/components/`. Component modules may read/write atoms, but durable state definitions belong in `src/renderer/state/`.
- Do not add or use Redux, Zustand, Recoil, Valtio, MobX, Nanostores, XState, Effector, or custom global store implementations.
- React `useState` is allowed for ephemeral state owned by one component. If state crosses feature or component boundaries, model it as Jotai atoms.
- React context is allowed only for structural provider APIs and compound-component wiring, not as an app state store.

## Tailwind Policy

- Use Tailwind built-in scales instead of arbitrary pixel values.
- Never write square-bracket pixel utilities such as `w-[13px]`, `p-[18px]`, or `text-[13px]`.
- For spacing, sizing, radius, and layout values, convert pixels to the Tailwind scale where available: intended pixel value divided by 4 equals the Tailwind spacing token, for example `16px` -> `4`, `14px` -> `3.5`, `2px` -> `0.5`.
- Use canonical Tailwind classes before arbitrary values. For example, use `text-xs` instead of `text-[0.75rem]`, `rounded-2xl` instead of `rounded-[0.375rem]`, and `rounded-sm` instead of `rounded-[0.125rem]`.
- If a value is not available as a canonical Tailwind class, use rem-based arbitrary values instead of px-based arbitrary values, especially for typography: use `text-[0.8125rem]` instead of `text-[13px]`.
- Prefer semantic or existing tokenized utilities over new arbitrary values when the design system already exposes the needed value.
- `bun run check` runs `scripts/check-tailwind-classes.mjs`, which fails on square-bracket pixel utilities and known non-canonical arbitrary classes. It scans `src/renderer` only (`.css`, `.js`, `.jsx`, `.ts`, `.tsx`), so `playground/` is not covered. Update that script when adding another canonical class equivalence that agents should preserve.

## Localization Policy

The app ships in English, Russian, and Greek. A change that adds or edits a user-facing surface is not finished until all three read it in their own language.

- Every user-facing string a change adds ships with `ru` and `el` filled in the same change. No key introduced by a change may be left empty in `src/renderer/lib/i18n/locales/ru/*.json` or `src/renderer/lib/i18n/locales/el/*.json`.
- A surface that is not translated yet becomes the change's responsibility once the change touches it: migrate its hardcoded literals to keys and fill the missing `ru`/`el` values for that file. The obligation is bounded by the files touched — do not add to the backlog, and do not treat unrelated debt as in scope.
- `locales/en/**` is generated from the `t('key', 'Default English')` call sites by `bun run i18n:extract` and is never hand-edited; `locales/ru/**` and `locales/el/**` are hand-filled against that skeleton. Run `bun run i18n:extract`, fill the new empty values, then `bun run i18n:types`, and confirm with `bun run i18n:status`. `bun run check` runs `i18n:lint`.
- Fix the term in `docs/i18n-glossary.md` before translating, and add the row in the same change when a term has none.
- `src/shared/` and `src/main/` return locale-neutral codes rather than English labels, so adding a code there is a user-facing change: the renderer mapper needs its `t()` case and that key needs `ru` and `el`. A surface main draws itself keeps a const table instead — `src/main/menu/menu-strings.ts` for the menu bar, `src/main/agent-runtime/notification-strings.ts` for desktop notifications, `src/main/app/quit-guard-strings.ts` for the quit confirmation, `src/main/linear/linear-callback-page-strings.ts` for the browser page Linear's OAuth redirect lands on, `src/main/menu/about-panel-strings.ts` for the About panel's credit headings, `src/main/agent-control/confirm-dialog-strings.ts` and `src/main/ipc/permission-confirm-strings.ts` for the native approval dialogs, `src/main/ipc/handlers/local-project-picker-strings.ts` for the Open Local Project picker — and a new key adds all three languages there.
- See @../../.claude/rules/i18n.md for the full contract: what counts as a user-facing surface, plural categories per locale, interpolation placeholders, agent-facing prose (which is steered by `buildLanguageDirective`, not translated), and when an `i18next-instrument-ignore` directive is legitimate.

## Config File Schemas

Ensemblr publishes a JSON Schema for each config file it reads: `schemas/config.schema.json` for `~/.config/ensemblr/config.json`, and `schemas/settings.schema.json` for a repository's `.ensemblr/settings.toml`.

- A `.ensemblr/settings.toml` you author opens with Taplo's directive on its first line: `#:schema https://www.ensemblr.dev/schemas/settings.schema.json`. Inside this repository the root `.ensemblr/settings.toml` uses the relative path `../apps/desktop/schemas/settings.schema.json` instead. The Scripts pane restores an existing directive across a rewrite but never adds one, so it has to be written by hand.
- A `config.json` you author by hand carries the matching `$schema` key. Ensemblr writes one into the file it creates itself, so an existing config usually has it already.
- Adding, renaming, or retyping a key either file accepts updates the matching schema in the same change. The loader is the source of truth — the allowed top-level keys in `src/main/config/config-loader.ts`, the field maps in `src/main/config/repository-config.ts`, the repository defaults in `src/main/config/config-resolution.ts` — and the schema mirrors it.
- `tests/main/published-schemas.test.ts` holds each schema to the loader it describes and fails on drift, so a key added to one and not the other is a red test rather than a silent gap.
- See `schemas/README.md` for the canonical URLs and editor wiring.

## Scoped Agent Instructions

- Before editing a subtree, check for the closest scoped `AGENTS.md`; scoped instructions are more specific and override these general rules.
- Current scoped organization guidance lives under `src/renderer/AGENTS.md`, `src/main/AGENTS.md`, `src/preload/AGENTS.md`, and `src/shared/AGENTS.md`.
- Do not copy one subtree's layout into another blindly. Renderer, main process, preload, and shared code have different runtime boundaries and should follow their scoped guidance.
- Keep cross-runtime contracts in `src/shared/`. Do not import renderer UI, main-process services, Electron APIs, filesystem APIs, or process-specific runtime objects across boundaries unless the scoped guidance explicitly allows it.

## Documentation Policy

Every function, hook, React component, Jotai atom, and IPC contract in `src/main`, `src/preload`, `src/shared`, and `src/renderer` carries a JSDoc block. Apply the following rules when adding or modifying code:

- Place a `/** ... */` JSDoc block immediately above every declaration: named functions, arrow functions assigned to `const`/`let`, methods on classes and object literals, React components, and exported `const`s that hold function or atom values. Document internal helpers, not just exports.
- Keep the description concise. One sentence is usually enough; two if the behavior is non-obvious. Describe what the symbol does and why, not how.
- For non-component functions, use `@param name - description` for each parameter and `@returns description` only when the function returns a non-void value. Omit empty `@param` and `@returns` tags entirely when there is nothing useful to say.
- For React components, write a description-only block on the component itself. Do not list props as `@param` tags. Document each prop on the corresponding interface or inline shape field only when the prop name does not already make its purpose obvious.
- For interfaces and type aliases, write a single description block above the declaration. Do not annotate every field with its own JSDoc unless a specific field has non-obvious semantics that the type name cannot convey.
- For Jotai atoms (including derived atoms) and exported plain-data constants, describe the slice of state or the meaning of the value, plus any persistence or scope notes. Skip the JSDoc when the constant's name is self-explanatory.
- For TanStack Router route definitions and loaders, describe the route's purpose, what data it loads, and any params or search params it consumes.
- For IPC channel and contract definitions, describe what the channel does, who sends it, and who receives it.
- Excluded by policy: shadcn UI primitives under `src/renderer/components/ui/`, type-only files (`*.d.ts`, anything under `types/`), the generated `routeTree.gen.ts`, fixture data under `src/renderer/fixtures/`, pure barrel `index.ts` re-export files, and tests. The contract modules under `src/shared/ipc/contracts/` are also treated as type-only; `src/shared/ipc/channels.ts` is not.
- When updating existing code, leave correct JSDoc in place and refresh it when behavior changes. Do not introduce new code without the appropriate JSDoc block.
- See @../../.claude/rules/jsdoc.md for the per-function JSDoc contract: which declarations carry a block, and how to write the description, `@param`, and `@returns` tags.
- Function bodies stay comment-free — clear names and small helpers over prose. See @../../.claude/rules/comments.md for how to remove a comment instead of writing one, plus the single exception (a short comment explaining a non-obvious *why* the code cannot express), what stays outside the rule (JSDoc, tool directives), and what is never allowed (commented-out code, bare `TODO`/`FIXME`).

## Code Review Policy

See @../../.claude/rules/code-review.md — when the `code-review` skill runs, run `react-doctor` and `fallow` as its final step.
