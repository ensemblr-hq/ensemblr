# 0081. Keep the Pull-Request Observation Stamp Beside the Navigation Tree

Date: 2026-10-03

## Status

Accepted

Refines how the sidebar consumes the snapshots that
[0035](0035-sync-workspace-pull-request-state.md)'s background sweeper keeps
fresh.

## Context

A workspace's pull-request status reaches the UI down two paths, each on its
own timing:

- **The live snapshot.** The workspace's own `gh`-backed query refreshes only
  while something is mounted on the workspace.
- **The compact presentation.** The sweeper persists it for every workspace,
  and the 15s navigation poll reads it back.

Either path can hold the older of the two observations at any moment. So the
two are ordered by when each observed GitHub: `isFresherPrObservation` in
`src/shared/github-pr-presentation.ts`. Choosing by which one is loaded is what
walked a row from ready-to-merge back to checks-running on navigation.

The sweeper re-stamps a snapshot on every write, including the ones that find
nothing changed. While that stamp lived on each navigation row's presentation,
the navigation poll never came back deep-equal. React Query's structural
sharing then handed out a new `repositories` array on every poll, the
renderer re-mapped the whole tree, and every sidebar row got a new model.

A content signature that left the stamp out was tried and reverted (#627). It
froze the model *and its stamp* across observations with the same content. That
stamp was then compared against a live snapshot read taken between those
observations:

1. The sweeper writes `checking` at T1.
2. The live query reads `ready` at T2.
3. The sweeper writes `checking` again at T3.

The frozen T1 lost to T2, and the row showed a status the store had already
contradicted.

## Decision

The observation stamp travels **beside** the navigation tree, never inside it,
and the renderer reads it at the one place that compares stamps.

- **The contract.** `WorkspacePrPresentation` carries no `syncedAt`.
  `RepositoryWorkspaceNavigationSnapshot.pullRequestSyncedAt` maps each
  workspace id to the stamp of the snapshot its presentation came from. Main
  fills both from the same row read. A poll that only re-stamps leaves
  `repositories` deep-equal, so structural sharing keeps it by reference, and
  with it the mapped projects and every row model.
- **The renderer model.** The shell PR model carries no stamp either. A stamp
  that is half-populated, or frozen, is exactly what the next reader compares
  against the wrong observation.
- **The reader.** `useLivePullRequestModel` reads the workspace's cached
  presentation together with its stamp, through a disabled, selecting observer
  on the navigation query (`workspacePrObservationQuery`). That stamp is always
  the newest, and no prop has to be threaded past the project tree.
- **The pairing rule.** The stamp is lent to the fallback model only while the
  fallback still states the cached verdict (`statesPresentationVerdict`). The
  shell can render a project list held from an older snapshot while a fetch is
  in flight. A model from that list is known to be superseded, so it competes
  unstamped rather than wearing a newer observation's stamp.

## Consequences

- A navigation poll that changes nothing re-maps nothing. A stamp that moves on
  its own re-renders only the rows whose own observation moved, and it re-runs
  their freshness choice without rebuilding their live PR model.
- Anything that needs to know *when* a presentation was observed reads
  `pullRequestSyncedAt`; the tree answers only *what* it says.
- The pairing rule depends on `statesPresentationVerdict` mapping every
  presentation status onto a distinct model verdict.
  `tests/renderer/states-presentation-verdict.test.ts` pins that. A new status
  that collides with an existing one would silently strip stamps from ordinary
  rows.
- `tests/renderer/use-live-pull-request-model.test.tsx` replays the T1/T2/T3
  sequence and the held-snapshot mismatch. A change that freezes the stamp or
  drops the pairing rule fails it.
- Sidebar rows still re-render whenever the workbench shell does, because
  nothing between the shell and a row is memoized. This decision makes their
  inputs stable; it does not add that boundary.
