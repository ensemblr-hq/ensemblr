# 0007. Support Conductor-Compatible Repository Configuration

Date: 2026-06-04

## Status

Superseded by [0030](0030-use-ensemblr-settings-toml-as-sole-repository-config.md).

Ensemblr now uses a single committed `.ensemblr/settings.toml` with `ENSEMBLR_*`-only environment variables; the Conductor-compatible multi-file model and `CONDUCTOR_*` mirrors described below are no longer implemented.

## Context

Ensemblr targets Conductor feature parity while using Pi as the agent runtime. Users may already have repositories configured for Conductor with `conductor.json`, `.worktreeinclude`, setup/run/archive scripts, and scripts that expect Conductor workspace environment variables.

Supporting these existing files lowers migration cost and lets users switch between Conductor and Ensemblr without maintaining duplicate repository setup.

## Decision

Ensemblr will support both Ensemblr-native and Conductor-compatible repository configuration.

Configuration precedence:

1. Personal repository settings stored by Ensemblr on the user's machine.
2. `ensemblr.json` at the repository root.
3. `conductor.json` at the repository root.
4. Built-in defaults.

Files-to-copy behavior:

- Ensemblr will support `.worktreeinclude` directly.
- `.worktreeinclude` remains the preferred shared file for files-to-copy patterns because it is already a generic worktree concept and is used by Conductor-compatible workflows.
- If `.worktreeinclude` is present, it wins over personal files-to-copy settings for that repository.

Environment variables:

- Ensemblr will expose `ENSEMBLR_*` variables as the native names.
- Ensemblr will also expose `CONDUCTOR_*` compatibility variables by default for scripts launched from repositories that use `conductor.json` or otherwise opt into Conductor compatibility.
- The compatibility variables must map to the same values as their `ENSEMBLR_*` equivalents.

Shared script fields:

- `scripts.setup`, `scripts.run`, `scripts.archive`, and `runScriptMode` retain the same functional meaning in both `ensemblr.json` and `conductor.json`.
- Conductor-specific fields that do not apply to Ensemblr should be ignored safely unless Ensemblr implements equivalent behavior.

## Alternatives Considered

### Ensemblr-only configuration

Using only `ensemblr.json` and `ENSEMBLR_*` variables would make product ownership clearer, but it would force users to duplicate existing Conductor setup and make switching between tools harder.

### Conductor-only configuration

Using only `conductor.json` and `CONDUCTOR_*` variables would maximize compatibility, but it would blur product identity and make future Pi-specific settings awkward.

## Consequences

- Existing Conductor repositories can work in Ensemblr with little or no setup migration.
- Ensemblr can introduce Pi-specific repository settings without overloading `conductor.json`.
- Script execution must define both native and compatibility env vars in some cases.
- Config loading must report which source won so users can debug precedence.
- Documentation must be explicit about precedence and compatibility behavior.
