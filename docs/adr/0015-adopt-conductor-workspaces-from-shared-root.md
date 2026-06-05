# 0015. Adopt Conductor Workspaces from a Shared Root

Date: 2026-06-04

## Status

Accepted

## Context

Ensemble should support pointing at the same root directory as Conductor. Users should be able to start filesystem/git work in one app and continue it in the other where practical.

Conductor's documented and observable shared surface includes root subdirectories, git worktrees, `conductor.json`, `.worktreeinclude`, scripts, branches, and GitHub state. Conductor also has private app-local state in its own SQLite database, which Ensemble should not treat as a compatibility contract.

The user mentioned a possible `.conductor` folder, but no `.conductor` repository folder is currently part of the established public compatibility surface.

## Decision

Ensemble will adopt existing Conductor-created repositories and workspaces from a shared root using filesystem and git metadata.

Discovery inputs:

- `<root>/repos/<repo-slug>` directories.
- `<root>/workspaces/<repo-slug>/<workspace-slug>` directories.
- Git metadata from `git rev-parse`, `git status`, and `git worktree list --porcelain`.
- `conductor.json`, `ensemble.json`, and `.worktreeinclude` at repository roots.
- Remote URL, default branch, current branch, and PR state from git/`gh`.

Adoption behavior:

- Reconcile SQLite records with filesystem/git reality on startup and after root changes.
- Auto-detect valid workspaces and add Ensemble records for missing ones.
- Mark adopted workspaces as discovered/adopted so the UI can explain their origin.
- Do not read or write Conductor's private SQLite database.
- Do not require a `.conductor` folder for v1.
- If a `.conductor` folder exists, leave it untouched unless a later documented/public contract justifies reading it.

## Alternatives Considered

### Read Conductor private database

Rejected because it is private implementation detail and risks corruption or breakage when Conductor changes schema.

### Require manual import of every workspace

Rejected because shared-root interoperability should feel natural and support switching between tools.

### Depend on `.conductor` metadata

Deferred because it is not currently part of the documented compatibility surface. Git/worktree metadata is sufficient for v1 adoption.

## Consequences

- Ensemble can discover Conductor-created worktrees without depending on private app state.
- Some Conductor-only metadata, such as Claude/Codex sessions or local comments, will not transfer.
- The UI needs clear labels for adopted workspaces and warnings for active workspace collisions.
- Adoption must be conservative: never delete, rewrite, or rename unknown shared-root content automatically.
