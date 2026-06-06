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
