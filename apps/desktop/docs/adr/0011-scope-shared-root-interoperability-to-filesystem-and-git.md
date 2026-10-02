# 0011. Scope Shared-Root Interoperability to Filesystem and Git

Date: 2026-06-04

## Status

Accepted

## Context

Users arrive with work already laid out by another workspace manager, and switching to Ensemblr should be low-friction. The aspirational goal is that a user can point both apps at the same managed root directory, start work in one app, and continue the same filesystem/git work in the other.

Another workspace manager typically stores repositories and workspaces under a user-configurable root directory with `repos/` and `workspaces/` subdirectories, and keeps its private app metadata in a local SQLite database under its own macOS application support directory. Such a private app database covers repositories, workspaces, sessions, messages, terminal sessions, settings, diff comments, attachments, and related metadata.

Ensemblr cannot safely rely on or mutate another app's private database without an explicit public compatibility contract. The shared compatibility surface should therefore be the filesystem, git worktrees, repository config files, scripts, environment compatibility, and externally visible integrations.

## Decision

Ensemblr will support shared-root interoperability at the filesystem/worktree/config level.

If the user sets Ensemblr's root directory to a root another workspace manager also uses, Ensemblr will:

- Use the same root subdirectory shape: `repos/`, `workspaces/`, and `archived-contexts/`.
- Discover existing repositories and workspaces from the shared root.
- Adopt existing git worktree workspaces when possible by inspecting git metadata, branch, root path, and repository relationship.
- Read the committed `.ensemblr/settings.toml` repository config and the `.worktreeinclude` files-to-copy list (see [0030](0030-use-ensemblr-settings-toml-as-sole-repository-config.md)).
- Expose `ENSEMBLR_*` workspace environment variables to scripts; the mirrored compatibility variables are removed (see [0030](0030-use-ensemblr-settings-toml-as-sole-repository-config.md)).
- Leave unknown files, directories, and metadata alone.
- Store Ensemblr-specific app metadata in Ensemblr's own SQLite database, never in a foreign app's database.

Ensemblr will not treat a foreign app's private SQLite database as a shared source of truth. It may read public filesystem state from a shared root, but it must not require access to a foreign app database for interoperability.

## Continuity Levels

### Supported Continuity

A user should be able to continue these across apps when both point to the same root:

- Repository checkout.
- Workspace working tree.
- Git branch.
- Uncommitted file changes.
- Committed changes.
- Setup/run/archive scripts from shared repo config.
- Files copied by `.worktreeinclude`.
- Pull request branch state and GitHub-visible review state.

### Ensemblr-Specific Continuity

These are stored in Ensemblr's database and may not appear in another workspace manager:

- Pi session mapping and timeline.
- Pi RPC event history.
- Ensemblr UI layout and tabs.
- Ensemblr-local comments not pushed to GitHub.
- Ensemblr terminal session rehydration.

### External-App Continuity

These may exist in another workspace manager but should not be assumed readable or writable by Ensemblr:

- Claude/Codex session history.
- That app's checkpoints and private refs unless discovered through git and explicitly supported.
- That app's terminal rehydration state.
- That app's app-local diff comments not represented in GitHub or files.
- That app's private settings and local UI state.

## Alternatives Considered

### Share the other app's database

Ensemblr could try to read and write another app's SQLite database. This is rejected because it relies on private implementation details, risks data corruption, and could break whenever that app changes schema or semantics.

### Separate roots only

Ensemblr could require its own root directory. This would simplify ownership but would undermine the goal of moving between another workspace manager and Ensemblr.

### Full live shared state

Ensemblr could try to mirror every state concept another app models. This is rejected as a v1 requirement because agent runtimes differ and not all of that state has a public cross-app representation.

## Consequences

- Ensemblr can coexist with another workspace manager in the same managed root without intentionally corrupting data that app owns.
- The interoperability layer must reconcile Ensemblr's SQLite records with filesystem/git reality on startup and when the root changes.
- Ensemblr should warn users when the same workspace appears to be actively running in both apps.
- Ensemblr should prefer external shared state, such as GitHub PR comments and git refs, over private app-local state when crossing app boundaries.
- Documentation must be explicit that shared-root interoperability means filesystem/git/config continuity, not guaranteed chat/session/checkpoint continuity across different agent runtimes.
