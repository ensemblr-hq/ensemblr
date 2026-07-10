# 0011. Support Conductor Root Interoperability

Date: 2026-06-04

## Status

Accepted

## Context

Ensemblr targets Conductor feature parity and should make migration or switching between Conductor and Ensemblr low-friction. The aspirational goal is that a user can point both apps at the same managed root directory, start work in one app, and continue the same filesystem/git work in the other.

Conductor stores repositories and workspaces under a user-configurable root directory with `repos/` and `workspaces/` subdirectories. Conductor also stores private app metadata in a local SQLite database under its macOS application support directory. That private app database includes repositories, workspaces, sessions, messages, terminal sessions, settings, diff comments, attachments, and related metadata.

Ensemblr cannot safely rely on or mutate Conductor's private database without an explicit public compatibility contract. The shared compatibility surface should therefore be the filesystem, git worktrees, repository config files, scripts, environment compatibility, and externally visible integrations.

## Decision

Ensemblr will support Conductor root interoperability at the filesystem/worktree/config level.

If the user sets Ensemblr's root directory to the same root directory used by Conductor, Ensemblr will:

- Use the same root subdirectory shape: `repos/`, `workspaces/`, and `archived-contexts/`.
- Discover existing repositories and workspaces from the shared root.
- Adopt existing git worktree workspaces when possible by inspecting git metadata, branch, root path, and repository relationship.
- Read the committed `.ensemblr/settings.toml` repository config and the `.worktreeinclude` files-to-copy list (see [0030](0030-use-ensemblr-settings-toml-as-sole-repository-config.md)).
- Expose `ENSEMBLR_*` workspace environment variables to scripts; the `CONDUCTOR_*` mirrors are removed.
- Leave unknown files, directories, and metadata alone.
- Store Ensemblr-specific app metadata in Ensemblr's own SQLite database, not Conductor's database.

Ensemblr will not treat Conductor's private SQLite database as a shared source of truth. It may read public filesystem state from a Conductor-managed root, but it must not require Conductor DB access for interoperability.

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

These are stored in Ensemblr's database and may not appear in Conductor:

- Pi session mapping and timeline.
- Pi RPC event history.
- Ensemblr UI layout and tabs.
- Ensemblr-local comments not pushed to GitHub.
- Ensemblr terminal session rehydration.

### Conductor-Specific Continuity

These may exist in Conductor but should not be assumed readable or writable by Ensemblr:

- Claude/Codex session history.
- Conductor checkpoints and private refs unless discovered through git and explicitly supported.
- Conductor terminal rehydration state.
- Conductor app-local diff comments not represented in GitHub or files.
- Conductor private settings and local UI state.

## Alternatives Considered

### Share Conductor's app database

Ensemblr could try to read and write Conductor's SQLite database. This is rejected because it relies on private implementation details, risks data corruption, and could break whenever Conductor changes schema or semantics.

### Separate roots only

Ensemblr could require its own root directory. This would simplify ownership but would undermine the goal of switching between Conductor and Ensemblr.

### Full live shared state

Ensemblr could try to mirror every Conductor state concept. This is rejected as a v1 requirement because agent runtimes differ and not all Conductor state has a public cross-app representation.

## Consequences

- Ensemblr can coexist with Conductor in the same managed root without intentionally corrupting Conductor-managed data.
- The interoperability layer must reconcile Ensemblr's SQLite records with filesystem/git reality on startup and when the root changes.
- Ensemblr should warn users when the same workspace appears to be actively running in both apps.
- Ensemblr should prefer external shared state, such as GitHub PR comments and git refs, over private app-local state when crossing app boundaries.
- Documentation must be explicit that shared-root interoperability means filesystem/git/config continuity, not guaranteed chat/session/checkpoint continuity across different agent runtimes.
