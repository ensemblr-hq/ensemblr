# Docs Consistency Audit

Date: 2026-06-04

## Summary

The generated planning docs are broadly consistent with the latest accepted ADRs. No duplicate ADR numbers or conflicting active ADR titles were found. The main stale guidance was older v1 runtime wording in superseded ADR 0004, deferred experimental features appearing as v1 polish, and product docs still treating resolved account/root/tab decisions as open.

## Files Reviewed

- `CONTEXT.md`
- `docs/adr/*.md`
- `docs/product/conductor-parity.md`
- `docs/product/mvp-sequencing.md`
- `docs/product/onboarding-flow.md`
- `docs/product/open-decisions.md`
- `docs/product/screen-inventory.md`
- `docs/product/settings-inventory.md`
- `docs/product/ux-parity.md`
- `.context/conductor-screens/README.md`
- `.context/conductor-screens/manifest.json`

## Fixes Applied

- Marked ADR 0004 and ADR 0005 runtime choices as historical/superseded and pointed current guidance to ADR 0025.
- Removed active v1 wording for voice mode, Graphite, cloud/remote SSH, production React profiler, embedded Pi SDK, and direct GitHub token/API paths.
- Aligned Linear guidance with ADR 0024: OAuth and create/read/update/comment/workspace-from-issue are v1 scope; archive/delete remains schema/permission discovery.
- Aligned GitHub guidance with ADR 0013: authenticated `gh` is required; authenticated `gh api` is allowed for REST/GraphQL gaps; app-owned GitHub API/OAuth is not planned.
- Aligned root-change guidance with ADR 0017: switching roots reindexes/adopts by default; migration/delete are explicit separate actions.
- Aligned secret storage wording with ADR 0018: macOS Keychain stores secrets; SQLite stores metadata only.
- Moved unresolved settings/product questions into `docs/product/open-decisions.md`.

## Remaining Ambiguities

- Whether to support the Conductor-style remove/soften AI-certainty phrase setting in Ensemble.
- Which non-deferred experimental settings belong in v1, especially workspace/sidebar visibility and sidebar resource usage.
- Exact Pi CLI/RPC capabilities for permission brokering, session tree navigation/forking, compaction UI, model listing, plan/fast modes, browser control, and context usage.
- Exact `gh` coverage for review comments, deployments, add-all-comments-to-chat, and review-thread resolution.
- Linear archive/delete schema and permission support.
- Safe spotlight-testing behavior without overwriting root changes.

## Implementation Risks

- Pi CLI RPC runtime v1 preserves `~/.pi/agent` compatibility and keeps Pi execution in a subprocess, but Ensemble still launches local tools with the user's account permissions; keep the `PiAgentClient` boundary ready for SDK sidecar migration if RPC lacks needed capabilities.
- Shared-root adoption must never read/write Conductor's private SQLite database and must avoid deleting or renaming unknown filesystem content.
- Checkpoint restore must revert file state without destructively editing Pi session files.
- `gh` output parsing may not expose every PR comment/check/deployment detail needed for full parity.
- Linear OAuth token refresh, pagination, rate limits, and permission failures need explicit handling.

## 2026-06-07 File-Based Routing Alignment

The renderer moved from hand-defined routes and effect-based redirects to
file-based TanStack routing. Docs were realigned to that reality.

### Added

- `docs/adr/0026-use-file-based-tanstack-routing.md` records the file-based
  routing decision, URL contract, loader-driven redirects, pathless
  `_workbench`/`_shell` layouts, and the development-only route/IPC profiler.

### Updated

- `docs/adr/0021-defer-react-profiler-to-development-only.md`: noted the profiler
  is implemented as the dev-gated route/IPC navigation profiler.
- `docs/product/current-shell-inventory.md`: `app.tsx` is now the router outlet
  host; shell composition lives in `workbench-shell/route-layout.tsx`; added the
  routing boundaries; corrected the Settings entry (full-window route outside the
  shell) and the chat-tab row (path param remembered per workspace).
- `docs/product/ux-parity.md`: clarified path vs search route state and
  per-workspace dock/review/chat persistence.
- `docs/product/open-decisions.md`: added renderer routing to resolved decisions.
- `docs/product/dependency-map.md`: noted file-based routing for the shell regions.
- `docs/product/linear-issues.md`: aligned the shell-scaffold (ENS-001) and
  sidebar-navigation (ENS-020) ticket text with the routing reality.

### Not done

- Live Linear tickets were not updated. The connected Linear workspace is
  `boundaryla`, not the Ensemble "The Swiss Cheese" workspace, so `THE-*` issues
  are unreachable from this session. The in-repo `linear-issues.md` mirror is the
  aligned source to sync once the correct workspace is connected.

## 2026-06-07 Workbench Decomposition + Welcome Screen Alignment

The composition refactor landed (commit `6fddcf5 refactor(renderer): decompose
workbench shell modules`) and the welcome screen plus clone dialog landed
(commit `caf02c3 feat(renderer): add welcome screen + clone dialog`). Several
docs still referenced the pre-refactor entrypoints. Docs were realigned to the
shipped structure.

### Path drift fixed

- `src/renderer/components/workbench-shell.tsx` no longer exists. Its public
  exports moved to `src/renderer/components/workbench-shell/frame.tsx`
  (`WorkbenchFrame`) and `src/renderer/components/workbench-shell/workspace-content.tsx`
  (`WorkspaceWorkbenchContent`).
- `src/renderer/components/workbench-shell/route-layout.tsx` is now the
  `route-layout/` folder with `index.ts` as the barrel.
- `src/renderer/types/workbench-shell.ts` is now the
  `src/renderer/types/workbench-shell/` folder with `index.ts` as the barrel.
- Cross-cutting layout / setup-diagnostics / navigation flags moved out of
  prop-drilling into `src/renderer/components/workbench-shell/contexts/`.

### Added structure (no prior docs)

- `src/renderer/components/dashboard-welcome.tsx` + `dashboard-welcome/`:
  welcome wordmark, three add-project cards, and a UI-only
  `CloneGithubDialog`. Mounted at the `_workbench/_shell/` index route.
- `src/renderer/components/workbench-empty-state.tsx`: full shell rendered
  when no workspace is selectable.
- The `_workbench/_shell/dashboard.tsx` route now renders a
  `WorkbenchPlaceholderPage` reserved for the future kanban board (it is no
  longer the implicit landing).

### Updated

- `docs/product/current-shell-inventory.md`: path block, implementation
  boundaries, and a new Welcome landing row added; dashboard row updated to
  reflect the placeholder state.
- `docs/product/ux-parity.md`: shell-contract paths updated.
- `docs/product/screen-inventory.md`: implemented-shell pointer updated.
- `docs/product/implementation-roadmap.md`: scope-baseline shell summary
  updated.
- `docs/product/linear-issues.md`: current-shell-alignment preamble and the
  `ENS-002` shell-split implementation note updated.
- `docs/product/onboarding-flow.md`: 2026-06-07 implementation-status block
  added describing the live welcome view, clone-dialog stub, and add-project
  menu parity.
- `docs/adr/0026-use-file-based-tanstack-routing.md`: shell-composition
  paragraph updated for the new frame / workspace-content split, the
  no-project shell, and the welcome landing.
- `docs/refactor/composition-refactor-plan.md`: marked Landed with the
  shipped outcomes summary.
- `src/renderer/AGENTS.md`: components-section example updated to use
  `dashboard-welcome` for the small case and the workbench-shell named
  entrypoints for the large case.

### Not done

- `AGENTS.md` (repo root) was not edited in this pass; its current language
  references scoped sub-`AGENTS.md` files generically and does not name
  shell paths.
- The connected Linear workspace mismatch noted in the 2026-06-07 routing
  alignment is still unresolved; live `THE-*` tickets were not synced.
