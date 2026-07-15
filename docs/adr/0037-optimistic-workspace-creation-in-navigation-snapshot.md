# 0037. Show Optimistic Pending Workspace Rows in the Navigation Snapshot

Date: 2026-07-15

## Status

Accepted

## Context

Workspace creation goes through main-process IPC — `git worktree add`, a
database insert, and setup wiring — and takes noticeable time. Until the
authoritative row returned, the sidebar showed nothing, so a freshly requested
workspace felt unresponsive.

## Decision

Insert renderer-only "pending" workspace rows into the otherwise
main-authoritative navigation snapshot, marked with an
`ensemblrPendingCreation` metadata flag
(`src/renderer/lib/workbench/optimistic-workspace.ts`).

Three pure, immutable reconcilers manage the lifecycle:

- `addPendingWorkspaceToNavigationSnapshot` inserts the optimistic row.
- `replacePendingWorkspaceInNavigationSnapshot` swaps the pending row for the
  authoritative one in place once IPC returns.
- `removePendingWorkspaceFromNavigationSnapshot` drops it on failure.

Pending rows carry a temporary slug and an empty `path`, and render disabled and
not-openable.

## Consequences

- Establishes an optimistic-mutation pattern over the navigation snapshot that
  future mutations can reuse.
- The renderer now holds transient rows the main process never issued; every
  consumer of the snapshot must tolerate a row with an empty `path` and pending
  metadata.
- Reconciliation is pure and immutable, so it is unit-testable without IPC.
