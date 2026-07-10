# 0010. Use a Conductor-Style Root Directory

Date: 2026-06-04

## Status

Accepted

## Context

Conductor exposes a configurable root directory where it stores managed repositories and workspaces. The attached screenshot shows Conductor's setting as a user-visible root directory and describes it as the place where Conductor stores repositories and workspaces. On this machine, the configured Conductor root is `/Users/psoldunov/Projects/Conductor`, with managed subdirectories including `repos/`, `workspaces/`, and `archived-contexts/`.

Ensemblr targets Conductor feature parity and should make repository/workspace files easy for users to inspect and open without digging into macOS app support directories.

## Decision

Ensemblr will use a Conductor-style root directory.

Default root directory:

```text
~/Ensemblr
```

Managed directory shape:

```text
~/Ensemblr/
  repos/
    <repo-slug>/
  workspaces/
    <repo-slug>/
      <workspace-slug>/
  archived-contexts/
```

The root directory is user-configurable through settings and declarative config. The app should treat it as a managed directory and warn users not to edit its internal structure manually.

Changing the root directory is a high-impact setting. Ensemblr should require confirmation and clearly explain what happens to existing managed repositories and workspaces before applying the change.

## Alternatives Considered

### App support directory

Storing worktrees under `~/Library/Application Support/dev.ensemblr.app/` would be tidy from an app-internals perspective, but it would make workspaces harder to inspect and less aligned with Conductor's visible root-directory model.

### `~/Projects/Ensemblr`

This matches the current configured Conductor root on this machine if product-renamed, but it may not match Conductor's default. `~/Ensemblr` is simpler and closer to the suspected Conductor default pattern.

### Repository-adjacent workspaces

Creating workspaces next to each original repository would make paths local to the project, but it would fragment Ensemblr-managed state and make cross-repository workspace management harder.

## Consequences

- Users can find Ensemblr-managed repos and workspaces in a predictable visible directory.
- Ensemblr remains close to Conductor's root-directory model while using its own product name.
- The app must persist the configured root directory in SQLite and allow declarative override from `~/.config/ensemblr/config.json`.
- Workspace records in SQLite must store absolute paths so root changes and migrations can be handled explicitly.
- Root-directory changes require careful UX and migration behavior.
