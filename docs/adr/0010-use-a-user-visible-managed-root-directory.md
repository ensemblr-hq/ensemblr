# 0010. Use a User-Visible Managed Root Directory

Date: 2026-06-04

## Status

Accepted

## Context

Ensemblr manages repositories and workspaces on disk, and needs one configurable place to put them, with managed subdirectories for `repos/`, `workspaces/`, and `archived-contexts/`.

Those files should be easy for users to inspect and open without digging into macOS app support directories.

## Decision

Ensemblr will use a user-visible managed root directory.

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

Storing worktrees under `~/Library/Application Support/dev.ensemblr.app/` would be tidy from an app-internals perspective, but it would make workspaces harder for users to find and inspect.

### `~/Projects/Ensemblr`

Nesting the root inside a generic `~/Projects` folder mixes Ensemblr-managed state with whatever else the user keeps there. `~/Ensemblr` is simpler and unambiguous about ownership.

### Repository-adjacent workspaces

Creating workspaces next to each original repository would make paths local to the project, but it would fragment Ensemblr-managed state and make cross-repository workspace management harder.

## Consequences

- Users can find Ensemblr-managed repos and workspaces in a predictable visible directory.
- The root is named for the product, so its ownership is obvious from the path alone.
- The app must persist the configured root directory in SQLite and allow declarative override from `~/.config/ensemblr/config.json`.
- Workspace records in SQLite must store absolute paths so root changes and migrations can be handled explicitly.
- Root-directory changes require careful UX and migration behavior.
