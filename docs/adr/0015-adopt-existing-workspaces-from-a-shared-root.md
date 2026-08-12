# 0015. Adopt Existing Workspaces from a Shared Root

Date: 2026-06-04

## Status

Accepted

## Context

Ensemblr should support pointing at the same root directory another workspace manager already uses. Users should be able to start filesystem/git work in one app and continue it in the other where practical.

The shared surface that is observable from outside such an app is root subdirectories, git worktrees, repository config files, `.worktreeinclude`, scripts, branches, and GitHub state. Its remaining app-local state lives in a private SQLite database, which Ensemblr should not treat as a compatibility contract.

## Decision

Ensemblr will adopt existing repositories and workspaces from a shared root using filesystem and git metadata.

Discovery inputs:

- `<root>/repos/<repo-slug>` directories.
- `<root>/workspaces/<repo-slug>/<workspace-slug>` directories.
- Git metadata from `git rev-parse`, `git status`, and `git worktree list --porcelain`.
- The committed `.ensemblr/settings.toml` and `.worktreeinclude` at repository roots (see [0030](0030-use-ensemblr-settings-toml-as-sole-repository-config.md)).
- Remote URL, default branch, current branch, and PR state from git/`gh`.

Adoption behavior:

- Reconcile SQLite records with filesystem/git reality on startup and after root changes.
- Auto-detect valid workspaces and add Ensemblr records for missing ones.
- Mark adopted workspaces as discovered/adopted so the UI can explain their origin.
- Do not read or write another app's private SQLite database.

## Alternatives Considered

### Read another app's private database

Rejected because it is private implementation detail and risks corruption or breakage when that app changes schema.

### Require manual import of every workspace

Rejected because shared-root interoperability should feel natural and support switching between tools.

### Depend on a foreign metadata folder

Deferred because no such folder is part of any documented compatibility surface. Git/worktree metadata is sufficient for v1 adoption.

## Consequences

- Ensemblr can discover worktrees another app created without depending on private app state.
- Some metadata that exists only in the other app, such as Claude/Codex sessions or local comments, will not transfer.
- The UI needs clear labels for adopted workspaces and warnings for active workspace collisions.
- Adoption must be conservative: never delete, rewrite, or rename unknown shared-root content automatically.
