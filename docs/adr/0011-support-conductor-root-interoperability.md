# 0011. Support Conductor Root Interoperability

Date: 2026-06-04

## Status

Accepted

## Context

Ensemble targets Conductor feature parity and should make migration or switching between Conductor and Ensemble low-friction. The aspirational goal is that a user can point both apps at the same managed root directory, start work in one app, and continue the same filesystem/git work in the other.

Conductor stores repositories and workspaces under a user-configurable root directory with `repos/` and `workspaces/` subdirectories. Conductor also stores private app metadata in a local SQLite database under its macOS application support directory. That private app database includes repositories, workspaces, sessions, messages, terminal sessions, settings, diff comments, attachments, and related metadata.

Ensemble cannot safely rely on or mutate Conductor's private database without an explicit public compatibility contract. The shared compatibility surface should therefore be the filesystem, git worktrees, repository config files, scripts, environment compatibility, and externally visible integrations.

## Decision

Ensemble will support Conductor root interoperability at the filesystem/worktree/config level.

If the user sets Ensemble's root directory to the same root directory used by Conductor, Ensemble will:

- Use the same root subdirectory shape: `repos/`, `workspaces/`, and `archived-contexts/`.
- Discover existing repositories and workspaces from the shared root.
- Adopt existing git worktree workspaces when possible by inspecting git metadata, branch, root path, and repository relationship.
- Read the committed `.ensemble/settings.toml` repository config and the `.worktreeinclude` files-to-copy list (see [0030](0030-use-ensemble-settings-toml-as-sole-repository-config.md)).
- Expose `ENSEMBLE_*` workspace environment variables to scripts; the `CONDUCTOR_*` mirrors are removed.
- Leave unknown files, directories, and metadata alone.
- Store Ensemble-specific app metadata in Ensemble's own SQLite database, not Conductor's database.

Ensemble will not treat Conductor's private SQLite database as a shared source of truth. It may read public filesystem state from a Conductor-managed root, but it must not require Conductor DB access for interoperability.

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

### Ensemble-Specific Continuity

These are stored in Ensemble's database and may not appear in Conductor:

- Pi session mapping and timeline.
- Pi RPC event history.
- Ensemble UI layout and tabs.
- Ensemble-local comments not pushed to GitHub.
- Ensemble terminal session rehydration.

### Conductor-Specific Continuity

These may exist in Conductor but should not be assumed readable or writable by Ensemble:

- Claude/Codex session history.
- Conductor checkpoints and private refs unless discovered through git and explicitly supported.
- Conductor terminal rehydration state.
- Conductor app-local diff comments not represented in GitHub or files.
- Conductor private settings and local UI state.

## Alternatives Considered

### Share Conductor's app database

Ensemble could try to read and write Conductor's SQLite database. This is rejected because it relies on private implementation details, risks data corruption, and could break whenever Conductor changes schema or semantics.

### Separate roots only

Ensemble could require its own root directory. This would simplify ownership but would undermine the goal of switching between Conductor and Ensemble.

### Full live shared state

Ensemble could try to mirror every Conductor state concept. This is rejected as a v1 requirement because agent runtimes differ and not all Conductor state has a public cross-app representation.

## Consequences

- Ensemble can coexist with Conductor in the same managed root without intentionally corrupting Conductor-managed data.
- The interoperability layer must reconcile Ensemble's SQLite records with filesystem/git reality on startup and when the root changes.
- Ensemble should warn users when the same workspace appears to be actively running in both apps.
- Ensemble should prefer external shared state, such as GitHub PR comments and git refs, over private app-local state when crossing app boundaries.
- Documentation must be explicit that shared-root interoperability means filesystem/git/config continuity, not guaranteed chat/session/checkpoint continuity across different agent runtimes.
