# 0007. Support Conductor-Compatible Repository Configuration

Date: 2026-06-04

## Status

Superseded by [0030](0030-use-ensemble-settings-toml-as-sole-repository-config.md).

Ensemble now uses a single committed `.ensemble/settings.toml` with `ENSEMBLE_*`-only environment variables; the Conductor-compatible multi-file model and `CONDUCTOR_*` mirrors described below are no longer implemented.

## Context

Ensemble targets Conductor feature parity while using Pi as the agent runtime. Users may already have repositories configured for Conductor with `conductor.json`, `.worktreeinclude`, setup/run/archive scripts, and scripts that expect Conductor workspace environment variables.

Supporting these existing files lowers migration cost and lets users switch between Conductor and Ensemble without maintaining duplicate repository setup.

## Decision

Ensemble will support both Ensemble-native and Conductor-compatible repository configuration.

Configuration precedence:

1. Personal repository settings stored by Ensemble on the user's machine.
2. `ensemble.json` at the repository root.
3. `conductor.json` at the repository root.
4. Built-in defaults.

Files-to-copy behavior:

- Ensemble will support `.worktreeinclude` directly.
- `.worktreeinclude` remains the preferred shared file for files-to-copy patterns because it is already a generic worktree concept and is used by Conductor-compatible workflows.
- If `.worktreeinclude` is present, it wins over personal files-to-copy settings for that repository.

Environment variables:

- Ensemble will expose `ENSEMBLE_*` variables as the native names.
- Ensemble will also expose `CONDUCTOR_*` compatibility variables by default for scripts launched from repositories that use `conductor.json` or otherwise opt into Conductor compatibility.
- The compatibility variables must map to the same values as their `ENSEMBLE_*` equivalents.

Shared script fields:

- `scripts.setup`, `scripts.run`, `scripts.archive`, and `runScriptMode` retain the same functional meaning in both `ensemble.json` and `conductor.json`.
- Conductor-specific fields that do not apply to Ensemble should be ignored safely unless Ensemble implements equivalent behavior.

## Alternatives Considered

### Ensemble-only configuration

Using only `ensemble.json` and `ENSEMBLE_*` variables would make product ownership clearer, but it would force users to duplicate existing Conductor setup and make switching between tools harder.

### Conductor-only configuration

Using only `conductor.json` and `CONDUCTOR_*` variables would maximize compatibility, but it would blur product identity and make future Pi-specific settings awkward.

## Consequences

- Existing Conductor repositories can work in Ensemble with little or no setup migration.
- Ensemble can introduce Pi-specific repository settings without overloading `conductor.json`.
- Script execution must define both native and compatibility env vars in some cases.
- Config loading must report which source won so users can debug precedence.
- Documentation must be explicit about precedence and compatibility behavior.
