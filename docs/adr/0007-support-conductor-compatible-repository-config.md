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

Named run scripts (superseding the single `scripts.run` command):

- A repository declares any number of run scripts as `[scripts.run.<name>]` tables, each carrying `command`, an optional `icon` from Ensemblr's curated set, an optional `default = true`, and an optional `available_in`.
- A bare `run = "..."` string is still accepted and resolves to one implicit script named `run`, so pre-existing repositories and personal SQLite overrides keep working with no migration. A named list beats the legacy string when both resolve.
- `available_in` gates on the launching environment. Ensemblr runs workspaces locally only, so an entry that declares environments without `local` is filtered out rather than offered and failed.
- An unrecognised `icon` falls back to the default icon with a warning diagnostic; a table without a usable `command` is dropped with one. A blank table key, an unrecognised field, and a second `default = true` each diagnose as well, the last of which is demoted so exactly one script stays the ⌘R target.
- One normaliser (`src/shared/scripts/run-scripts.ts`) owns every field rule and reports what it rejected, so the config loader and the settings resolver cannot judge a committed table and a personal SQLite row differently.
- Only one run script runs per workspace at a time: starting a second refuses with `script-already-running` unless the request asks for a restart.
- `runScriptMode` governs concurrency *across* workspaces, not inside one. `nonconcurrent` stops run scripts in the repository's other workspaces before starting; `concurrent` leaves them running, which per-workspace `ENSEMBLR_PORT` allocation makes safe.

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
