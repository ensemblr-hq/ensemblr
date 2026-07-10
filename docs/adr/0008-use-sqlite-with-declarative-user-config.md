# 0008. Use SQLite with Declarative User Configuration

Date: 2026-06-04

## Status

Accepted

## Context

Ensemblr targets Conductor feature parity. Conductor stores local app metadata in an app-support SQLite database with tables for repositories, workspaces, sessions, session messages, terminal sessions, settings, environment variables, attachments, diff comments, port forwards, and cleanup state.

Ensemblr needs the same class of durable local metadata: projects, workspaces, Pi sessions, session events, terminal panes, repository settings overrides, UI state, comments, checks, PR metadata, checkpoints, port allocation, and process state.

At the same time, Ensemblr should support declarative user-managed settings so users can configure the app with dotfiles or managed machine configuration.

## Decision

Ensemblr will use a local SQLite database as the primary store for mutable app metadata, matching Conductor's storage shape.

Ensemblr will also support declarative user configuration under `~/.config/ensemblr/`.

Initial paths:

- SQLite app database: `~/Library/Application Support/dev.ensemblr.app/ensemblr.db` on macOS.
- Declarative user config directory: `~/.config/ensemblr/`.
- Primary declarative config file: `~/.config/ensemblr/config.json`.

Responsibility split:

- Git/worktrees are the source of truth for repository files, branches, and diffs.
- `~/.pi/agent` is the source of truth for Pi auth, models, settings, packages, extensions, skills, prompts, themes, and Pi sessions.
- Ensemblr SQLite is the source of truth for mutable Ensemblr app metadata and UI/review state.
- `~/.config/ensemblr` is the source of truth for declarative user preferences and policy-like settings.

Declarative config may define:

- Global app preferences.
- Default repository settings.
- Repository matching rules.
- Default script compatibility behavior.
- Environment variable policy.
- Privacy/security preferences.
- UI defaults and keybinding overrides.
- Optional managed/locked settings.

Declarative config must not be the primary store for high-churn runtime state such as live sessions, terminal buffers, worktree lifecycle records, comments, checkpoint refs, or process histories.

## Alternatives Considered

### SQLite only

Using only SQLite would match Conductor closely and simplify implementation, but it would make dotfile management and managed declarative setup harder.

### Declarative config only

Using only files under `~/.config/ensemblr` would be attractive for inspectability, but it is a poor fit for high-churn mutable state such as session events, terminal records, comments, and workspace lifecycle metadata.

### Store everything in project files

Keeping all state inside repositories would make state portable, but it would pollute projects with app metadata and conflict with the need for local personal settings, hidden review state, and private runtime history.

## Consequences

- Ensemblr can match Conductor's local metadata model while supporting dotfile-managed configuration.
- The implementation needs a configuration resolution layer that merges declarative config, personal SQLite settings, repository files, and defaults.
- The app must show which config source won for debuggability.
- The declarative config schema should be versioned and validated.
- Runtime state remains local and mutable without requiring config-file rewrites.
