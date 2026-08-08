# Architectural Patterns

The structural rules a change has to respect. `AGENTS.md` and the scoped
`src/*/AGENTS.md` files are normative on organization; this file covers the
recurring *patterns* those rules produce, so a change follows the grain instead
of inventing a parallel path. `docs/architecture-map.md` is the directory-level
index.

## Four runtime boundaries, one direction of trust

`src/main` (Node) → `src/preload` (context-isolated bridge) → `src/renderer`
(React), with `src/shared` as the only code both ends may import.

- Renderer never imports from `src/main`, Electron, or `node:*`.
- `src/shared` never imports renderer UI, main-process services, Electron, or
  filesystem APIs.
- Preload exposes typed, narrow APIs over `contextBridge` — never raw
  `ipcRenderer`, Node APIs, Electron objects, or service instances.
- Trust-boundary validation belongs in the main-process handler, not preload.

Crossing one of these is an architecture bug, not a style preference.

## Two organizing axes, deliberately opposite

- **`src/main` is concern-first.** `agent-control/`, `storage/`, `linear/` — one
  folder per main-process concern, each with an `index.ts`.
- **`src/renderer` is type-first, concern-second.** `state/workspace/`,
  `lib/workbench/`, `types/workbench/` — never `src/renderer/workbench/`.

Do not copy one subtree's layout into the other. This is the single most common
way a change lands in the wrong place.

## Barrels are the public surface

A multi-file concern exposes exactly one entrypoint and keeps its private helpers
in siblings:

- `src/shared/<concern>/` behind `src/shared/<concern>.ts` (preferred — the Node
  ESM loader `electron --test` uses cannot resolve a bare directory specifier) or
  `<concern>/index.ts` (`ipc/`, `keymap/`, `pi-rpc/`)
- `src/renderer/state/<concern>/index.ts`, `src/renderer/lib/<concern>/index.ts`,
  `src/renderer/types/<concern>/index.ts`, `src/renderer/components/**/index.ts`
- `src/main/<concern>/index.ts` — all 30 main concerns have one

Import from the barrel outside the concern; import siblings directly inside it.
The shared and renderer barrels above are registered as entries in
`.fallowrc.jsonc`, because their re-export surface crosses a process boundary the
module graph cannot see; a new one must be added there or fallow reports its
re-exports as dead code. Main-process barrels are **not** listed — they are
reachable from `src/main/main.ts`, so a genuinely unused export in one should
still surface.

## The IPC contract path

Adding a renderer↔main call means four files, in this order, before the bridge
and the caller:

1. `src/shared/ipc/channels.ts` — channel name, always `ensemblr:<kebab-name>`,
   keyed by its camelCase preload handle.
2. `src/shared/ipc/contracts/<concern>.ts` — request and response types.
3. `src/main/ipc/request-schemas/<concern>.ts` — the Zod validator; shared field
   validators live in `request-schemas/primitives.ts`.
4. `src/main/ipc/handlers/<concern>.ts` — the handler, delegating to a service.

Handlers validate and delegate; they do not hold business logic. The modules
under `src/shared/ipc/contracts/` are treated as type-only and are exempt from
the JSDoc requirement — `channels.ts` is not.

The Zod layer is a partial migration: there are fewer `request-schemas/` modules
than `handlers/` modules, and some handlers still validate inline. Read the
JSDoc at the top of `src/main/ipc/request-schemas.ts` before adding one — it
records the two stances the existing modules take (strict `parse`, which throws
on a malformed payload, versus lenient `safeParse`, which coerces to a
known-empty payload and lets the service emit a diagnostic) and warns that
existing semantics must be preserved exactly.

## Ports and adapters in agent control

`src/main/agent-control/` is a permission gate, not a feature. Every op
validates, resolves its origin from an injected per-workspace bearer token,
checks scope and the workspace permission mode, applies fork-bomb guardrails,
then delegates through a **port** (`ports.ts`, `port-adapters.ts`,
`review-ports.ts`) to a service that already exists.

**Control adds no capability code of its own.** If an operation is not already a
service, build the service first. Both bridges — Pi via `POST /invoke`, MCP
harnesses via `POST /mcp` — funnel into the one service so the two surfaces
cannot drift.

## Policy in `shared/`, enforced over the control server

Plan Mode is the worked example. The classifiers — `src/shared/plan-mode.ts`
behind `src/shared/plan-mode/` (bash guard, shell lexer, tool guard, control-op
denials) — live in `shared/` and are reached over the agent-control server, while
`src/main/plan-mode/` holds the per-session registry, the plan-file writer, and
the submission coordinator.

The shipped Pi extension cannot import from `src/` at runtime, so it asks the app
per intercepted tool call rather than carrying its own copy. Follow that shape
for any security-sensitive classifier: one implementation in `shared/`, queried
across the boundary. A second copy is a parity test waiting to fail.

## Provider-neutral agent runtime

`src/main/agent-runtime/` owns the adapter contract, `AgentClient`, and session
persistence/naming/summaries. `pi-agent/` and `claude-agent/` are **siblings**
implementing that contract; `fake-agent-adapter.ts` is the test double.

A new runtime is a new adapter folder, not a branch inside an existing one, and
nothing runtime-specific belongs above the adapter line — `agent-runtime/` knows
no CLI flags and no SDK option names. Concretely: a provider id in
`src/shared/agent-provider.ts`, a concern folder beside `pi-agent/` and
`claude-agent/`, and an entry in the client's adapter map. `agent-providers/`
carries the matching settings surface (executable discovery and overrides,
readiness probing, model catalogue) so neither runtime is routed through the
other's vocabulary.

## Repository layer over SQLite

`src/main/storage/` holds the connection (`database.ts`), transaction helper
(`tx.ts`), and one repository module per aggregate under `repositories/`. Callers
depend on the repository, not on `DatabaseSync`.

Schema changes are numbered, append-only migrations in `database.ts`. Every id
is asserted in `tests/main/database.test.ts` — add to both, in the same change.

## Deep modules, small interfaces

Before adding a helper, wrapper, hook, component, or service, ask whether it
reduces the number of methods, simplifies parameters, or hides real complexity.
If it mostly passes values through, inline it or fold it into a module that
already owns the concern. Prefer few files with meaningful interfaces over many
thin ones — but keep files focused; 200–400 lines is typical, 800 is the ceiling.

## Types follow their boundary

- Exported types go in the concern's type or contract module.
- Non-exported, single-use types stay co-located.
- React components with **four or fewer props** and no exported prop type: inline
  the shape on the function parameter. Lift to a named `Props` interface only
  when it grows past four, is exported, or is used in more than one place.

## Generated and vendored code

Never hand-edit: `src/renderer/routing/routeTree.gen.ts` (TanStack Router Vite
plugin — change the route files and let it regenerate) and `package-lock.json`.

Treat `src/renderer/components/ui/**` as vendored shadcn: exempt from the JSDoc
policy and quieted per-rule in fallow (`ignoreExports`). An installed primitive
with no consumers should still surface as an unused file, so it is not
blanket-ignored.

Note that Biome does **not** currently skip this tree: `biome.json` excludes
`src/components/ui` and `src/hooks/ui`, neither of which exists — the vendored
primitives live at `src/renderer/components/ui`. Re-vendoring a primitive will
therefore be reformatted to house style.

## Registering new entrypoints

Anything the module graph cannot see statically must be declared, or it will be
reported as dead code:

| New thing | Register in |
| --- | --- |
| Vite/Forge entry, playground entry | `.fallowrc.jsonc` `entry`, and `forge.config.ts` if packaged |
| Shared or renderer concern barrel | `.fallowrc.jsonc` `entry` (main-process barrels are not listed — see above) |
| Pi extension under `resources/pi-extensions/` | already globbed as an entry; loaded at runtime via `pi --mode rpc -e <file>` |
| Dev script under `scripts/` | already globbed; typecheck it via `tsconfig.scripts.json` |
| Pure-logic test under `tests/main/` | the explicit `include` array in `vitest.config.mts` |
