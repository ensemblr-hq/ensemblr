# 0026. Use File-Based TanStack Routing for the Renderer

Date: 2026-06-07

## Status

Accepted

## Context

ADR 0001 chose an Electron + React renderer, and `docs/product/ux-parity.md`
and `docs/product/linear-milestones.md` already name TanStack Router as the
renderer navigation library. The first implementation defined routes by hand in
`src/renderer/routing/router.tsx` with `createRoute`, rendered a single `App`
component per view, and drove navigation imperatively:

- Workspace and chat identity were partly held in Jotai and partly carried as a
  `?chat=` search parameter.
- Fallback selection, chat selection, and search normalization ran as `useEffect`
  redirects inside `App`, duplicated across views and easy to desync from the URL.

As the shell grew (repository/workspace navigation, dock/review/chat tab state,
setup gating), the imperative redirects and search-encoded identity became hard
to reason about. This ADR records the move from hand-written routes to TanStack
Router's file-based routing and loader model.

## Decision

Adopt TanStack Router file-based routing for the renderer.

### Route generation

- Routes are files under `src/renderer/routing/routes/`, compiled to a generated
  `src/renderer/routing/routeTree.gen.ts` by the `@tanstack/router-plugin` Vite
  plugin (`autoCodeSplitting: true`).
- `routeTree.gen.ts` is committed, treated as generated output (never hand-edited),
  and excluded from Biome.
- `router.tsx` builds the router from the generated tree with `createHashHistory`
  (Electron), `defaultPreload: 'intent'`, a default preload/stale time, and installs
  the development-only navigation profiler.

### Route hierarchy (pathless layouts)

- `_workbench` owns the shared data loader (`loadWorkbenchRouteData` →
  `loadWorkbenchShellData`), pulling health, setup-diagnostics, and
  repository/workspace navigation snapshots through TanStack Query
  (`queryClient.fetchQuery`, cache-served) and mapping repositories to projects.
- `_workbench/_shell` renders the workbench chrome (`WorkbenchShellLayout`) and
  re-exposes the `_workbench` loader data to its descendants through a pass-through
  loader (`loadShellWorkbenchRoute`). This pass-through is required: a loader's
  `parentMatchPromise` resolves only the immediate parent match, so without it the
  project/workspace loaders read `undefined` and their redirects never run.
- `_workbench/settings` is a full-window settings route placed outside `_shell`
  so it does not render the workbench chrome.

### URL contract

The active workspace and chat are path parameters, not search state:

- `/`, `/history`, `/help`, `/settings` — static workbench views.
- `/projects/$projectId/workspaces/$workspaceId/chats/$chatId` — workspace chat.
- `dock` and `review` remain validated search parameters (`normalizeWorkbenchSearch`).
- The legacy `?chat=` search is migrated to the path by a loader redirect.

### Loaders own data and redirects

Route loaders resolve fallback selection when a project/workspace is missing
(using the stored last selection), migrate legacy `?chat=` to the path, normalize
non-canonical search, and redirect the workspace index to the preferred chat.
Pending, error, and not-found boundaries render shared empty-state shells.

Add-project flows such as Quick Start and Open GitHub Project are a special
navigation race: they register/create a repository, create its first workspace,
and then navigate to a project/workspace URL while the `_workbench` parent loader
may still hold the boot-time repository/workspace snapshot. The fix is two-part:

1. `seedFirstWorkspace` force-refreshes `repositoryWorkspaceNavigationQuery` from
   IPC (`invalidateQueries` with no automatic refetch, then `fetchQuery` with
   `staleTime: 0`) before navigating, persists the new project/workspace pair to
   the last-selection atom/localStorage, and navigates directly to the canonical
   chat route.
2. The `/projects/$projectId` loader also receives `queryClient` and checks the
   fresh navigation cache before redirecting. This is required because the
   project layout loader runs before the workspace loader; if it only reads stale
   parent loader data, it redirects to the previous fallback before the workspace
   loader can resolve the newly-created workspace.

### State and composition

- Durable per-workspace UI selection (dock tab, review tab, and last chat tab) is
  persisted in Jotai `atomWithStorage`, resolved against live sessions via
  `getPreferredSession` / `getPreferredChatId`.
- Route components read `_workbench` loader data through
  `getRouteApi('/_workbench')`, not the parent-match chain.
- Shell composition moved out of `app.tsx` (now only `<Outlet />`):
  `components/workbench-shell/route-layout/` hosts the layouts and pages and
  re-exports through `route-layout/index.ts`;
  `components/workbench-shell/frame.tsx` exports `WorkbenchFrame` (chrome) and
  `components/workbench-shell/workspace-content.tsx` exports
  `WorkspaceWorkbenchContent`; `panel-layout.tsx` exports
  `WorkspaceConversationContent`. The no-project shell lives in
  `components/workbench-empty-state.tsx` and the welcome landing in
  `components/welcome.tsx` (mounted from the `_workbench/_shell/`
  index route).

## Alternatives Considered

### Keep manually-defined routes in `router.tsx`

Rejected. Data and redirect logic stayed in component effects, was duplicated
across views, and drifted from the URL. File-based routes colocate loaders,
boundaries, and components per route.

### Encode workspace/chat identity in search params (`?chat=`)

Rejected. Identity belongs in the path so URLs are shareable, restorable, and
preloadable as links. Search is reserved for view options (`dock`, `review`).

### Hold selection only in Jotai/local state

Rejected. Local-only selection is not URL-addressable, cannot preload, and cannot
drive loader-based redirects. Jotai is retained for durable UI preferences, not
for primary navigation identity.

## Consequences

- Navigation, data loading, and redirects are declarative and colocated with
  routes; links preload on intent.
- `routeTree.gen.ts` must never be hand-edited; route changes happen by adding or
  moving files under `routes/` and regenerating via the Vite plugin.
- The `_shell` pass-through loader is load-bearing. Removing it silently breaks
  descendant loader redirects (invalid workspace URLs, legacy `?chat=` migration,
  canonical search). It is documented in code and guarded by a routing test.
- Deep linking, restore-on-launch, and per-workspace dock/review/chat memory all
  work through the URL plus persisted atoms.
- A development-only route/IPC navigation profiler
  (`src/renderer/lib/instrumentation/route-profiler.ts`) instruments loaders, IPC
  calls, and layout remounts. It is gated to `import.meta.env.DEV` and is the
  concrete implementation of the diagnostics allowed by ADR 0021.
