# 0027. Use a Workspace Archive Lifecycle Distinct From Delete

Date: 2026-06-08

## Status

Accepted

## Context

ADR 0010 fixes a Conductor-style root directory with a top-level
`archived-contexts/` folder, and the Conductor parity matrix in
`docs/product/conductor-parity.md` names archive as a workspace lifecycle
action that runs an archive script first and preserves the per-workspace
`.context/` handoff folder. `ENS-025` (Linear `THE-125`) raises the matching
concrete requirements:

- Archive must never silently delete unknown content.
- The lifecycle must prepare a hook surface that `ENS-038` (Setup/Run/Archive
  Script Lifecycle) and `ENS-060` (Archive-After-Merge and Branch Cleanup) can
  subscribe to without re-modeling archive.
- Archive, remove-from-app, and delete-files must be distinct user intents
  with their own confirmations.

The pre-ENS-025 implementation exposed a single `archiveWorkspace` IPC channel
whose semantics were "permanently delete the worktree folder, drop the local
branch, and remove the SQLite row." The UI dialog used destructive copy. That
collapsed the four required intents into one, gave PID-038 and PID-060 nothing
to hook into, and treated archive as a filesystem shortcut rather than a
lifecycle state.

## Decision

Model archive as a lifecycle state on the workspace and repository rows, and
keep destructive removal as a separate, explicitly-named operation.

### Lifecycle state in SQLite

Migration `004_archive_lifecycle` adds `repositories.archived_at` (the column
already existed on `workspaces`) and a new `archive_records` table that
preserves the snapshot needed by later subscribers:

- `record_type` (`workspace` or `repository`).
- Identifiers and slugs for the workspace and parent repository.
- `source_path`, `archived_context_path`, `branch_name`, `base_branch`.
- `branch_cleanup` (`0` or `1`) recording whether the caller opted in to the
  destructive cleanup variant.
- `archive_reason`, `archived_at`, `metadata_json` for downstream subscribers.

`workspaces.archived_at` and `repositories.archived_at` are the authoritative
"is archived" signal; `archive_records` holds the immutable provenance the
script-runner and after-merge flow need.

### Two services with different intents

`src/main/repository/archive-workspace.ts` and
`src/main/repository/archive-repository.ts` implement the lifecycle archive.
They:

1. Copy the workspace `.context/` directory into
   `<root>/archived-contexts/<repo-slug>/<workspace-slug>-<timestamp>/.context/`
   and write a sibling `archive-metadata.json` snapshot.
2. Run `pre-archive-*` hooks and short-circuit on abort.
3. Stamp `workspaces.archived_at` / `repositories.archived_at` and insert the
   `archive_records` row in a single transaction.
4. Optionally remove the worktree registration and drop the local branch when
   the caller opts in via `branchCleanup: true`. The worktree directory and
   branch otherwise stay in place; the `.context/` files are already preserved
   under `archived-contexts/`.
5. Run `post-archive-*` hooks and collect diagnostics.

`src/main/repository/delete-workspace.ts` and
`src/main/repository/delete-repository.ts` keep the prior destructive flow
under explicit names. They drop worktrees, drop branches, delete rows, and
write the `.ensemble-archived` sentinel so the shared-root reconciler does not
resurrect the folder. They do not run lifecycle hooks; callers reach them only
through the dedicated "Delete…" confirmation dialogs.

### Hook runtime for ENS-038 and ENS-060

`src/main/repository/archive-lifecycle.ts` exposes a hook registry with four
stages — `pre-archive-workspace`, `post-archive-workspace`,
`pre-archive-repository`, `post-archive-repository`. Handlers run in priority
order (lower first); pre-stage handlers may return `{ abort }` to halt the
lifecycle, and any handler may surface diagnostics. The registry is
intentionally generic so `ENS-038` can register an archive-script subscriber
and `ENS-060` can register the archive-after-merge subscriber without further
contract changes.

### IPC surface

Channel name semantics are kept stable: `ensemble:archive-workspace` and
`ensemble:archive-repository` now invoke the lifecycle services. The new
`ensemble:delete-workspace` and `ensemble:delete-repository` channels invoke
the destructive services. `ArchiveWorkspaceRequest` and
`ArchiveRepositoryRequest` accept an opt-in `branchCleanup` flag and an
optional free-text `reason` recorded in `archive_records`. Diagnostic codes
(`archive-aborted-by-hook`, `archived-context-copy-failed`,
`workspace-already-archived`, …) reflect the lifecycle vocabulary.

Reverse + browse channels round out the surface:

- `ensemble:list-archived-workspaces` returns every archived workspace for a
  repository joined with the most recent `archive_records` row. The renderer
  uses it to back the Browse archive dialog.
- `ensemble:unarchive-workspace` NULLs `workspaces.archived_at` and restores
  the preserved `.context/` snapshot into the worktree. When the original
  archive ran with `branch_cleanup = 1`, the service recreates the worktree
  via `git worktree add -b <branch_name> <path> <base_branch>` from the
  recorded base branch before copying context back. `pre-/post-unarchive-
  workspace` hook stages frame the operation.
- `ensemble:delete-archived-workspace` permanently purges an archive entry:
  removes the preserved `archived-contexts/.../` directory, cleans up the
  worktree + branch if still present, deletes the workspace's
  `archive_records` rows, and drops the workspace row.

The destructive `ensemble:delete-repository` flow cascades into the archive
tree. After the repository + child workspace rows are gone, the service
removes `<root>/archived-contexts/<repo-slug>/` recursively so no orphaned
`.context/` snapshots survive a destructive delete. `archive_records` rows
cascade via the existing `repository_id` foreign key.

### Dialogs and intent separation

`ArchiveWorkspaceDialog` / `ArchiveRepositoryDialog` describe the lifecycle
behavior (`.context/` preservation, opt-in branch cleanup) and gate branch
cleanup behind a second checkbox so a misclick never drops a stray local
branch. New `DeleteWorkspaceDialog` / `DeleteRepositoryDialog` host the
destructive copy. Sidebar context menus and project headers expose both
"Archive" and "Delete…" entries.

`BrowseArchiveDialog` is the repository-scoped entry point users open from
the "Browse archive…" context menu. It lists archived workspaces with their
archive time, recorded branch, and branch-cleanup status, and offers per-row
**Unarchive** and **Delete permanently** actions. The list is backed by the
TanStack Query options exported from `archivedWorkspacesQuery`, so cache
invalidation after any archive lifecycle mutation propagates immediately.

## Alternatives Considered

### Keep `archiveWorkspace` as destructive and add a new "lifecycle" channel

Rejected. Channel names would lie: an action labelled "Archive" in the UI and
the IPC layer would mean two different things depending on which call site
the renderer reached. Reviewers would have no way to know which semantics a
new caller picked up. Renaming the destructive flow to `delete*` keeps the
vocabulary aligned with the user-visible intent.

### Persist only `workspaces.archived_at`, no `archive_records` table

Rejected. `ENS-038` needs the archive script's working directory and the
snapshot of the workspace identifier at archive time; `ENS-060` needs the
branch-cleanup intent and the timestamp. Holding that state on the workspace
row alone would force later subscribers to either parse `metadata_json` for a
non-trivial schema or replay file-system inspection. A dedicated table lets
the hook stages stay simple and lets the renderer surface archive history.

### Implement remove-from-app in this ADR

Deferred. "Remove-from-app" reduces to the existing destructive delete with the
on-disk files left alone, and can be layered on top of the lifecycle + delete
split without revisiting this ADR. The three-way distinction in `ENS-025`
(archive, remove-from-app, delete-files) is honored at the contract level by
the new `archive` vs `delete` channels; product UI for remove-from-app is out
of scope here.

## Consequences

- `workspaces.archived_at` and `repositories.archived_at` are the authoritative
  archive state. Any new caller that needs to enumerate live workspaces must
  filter on `archived_at IS NULL`.
- `archive_records` is append-only and is the source of truth for downstream
  subscribers. Schemas added by `ENS-038` / `ENS-060` should land as columns or
  additional rows here, not as ad-hoc files on disk.
- `<root>/archived-contexts/<repo-slug>/<workspace-slug>-<timestamp>/`
  contains both the copied `.context/` directory and `archive-metadata.json`.
  The directory is never reused; archiving the same workspace twice is
  rejected with `workspace-already-archived`.
- The hook registry is in-process and unsubscribed handlers do not survive
  app restart. `ENS-038` will register its subscriber from `main.ts`
  alongside the existing service composition.
- Destructive delete keeps writing the `.ensemble-archived` sentinel; the
  shared-root reconciler logic from ADR 0015 still applies unchanged.
- Destructive repository delete also removes the repository's slice of
  `<root>/archived-contexts/<repo-slug>/`. Archive history disappears with
  the repository — users who want to keep a snapshot must export it before
  calling delete.
- Unarchive reuses the archive's recorded branch cleanup flag to decide
  whether to recreate the worktree or just restore `.context/`. If
  `branchCleanup = 1` but `base_branch` or `branch_name` was never recorded,
  unarchive fails fast with a `base-branch-missing` diagnostic rather than
  guessing.
- The renderer can light up archived state on existing rows without further
  IPC work because the navigation snapshot already carries `archived_at`.
