# 0030. Use `.ensemblr/settings.toml` as the Sole Repository Config

Date: 2026-07-08

## Status

Accepted

Supersedes [0007](0007-support-conductor-compatible-repository-config.md).

## Context

ADR 0007 committed Ensemblr to a Conductor-compatible repository configuration model. It layered several on-disk files (`conductor.json`, `.conductor/settings.toml`, `.conductor/settings.local.toml`, and the Ensemblr-native `ensemblr.json`), mirrored every `ENSEMBLR_*` workspace variable as a `CONDUCTOR_*` compatibility variable, and shipped a `conductor.json`→`ensemblr.json` migration path.

In practice that model added cost without a matching payoff:

- Multiple config files with overlapping keys made precedence hard to explain and hard to debug.
- The `CONDUCTOR_*` mirrors and the `conductorCompatibility` setting doubled the environment surface scripts had to reason about.
- The migration module had no UI caller and was never reachable — it was dead code.
- Ensemblr is its own product; anchoring repository config to Conductor's filenames blurred ownership and complicated future Pi-specific settings.

Ensemblr still wants one committed, team-shareable place to declare repository behavior (setup/run/archive scripts, run mode, files-to-copy, preview URL, action preferences), plus personal per-user overrides that never touch the repository.

## Decision

Ensemblr uses a single on-disk repository configuration file: `.ensemblr/settings.toml`.

- **One file, TOML.** `.ensemblr/settings.toml` at the repository root is the only repository config file Ensemblr reads. It is authored by hand, committed to the repository, and read-only to the app — Ensemblr never writes it.
- **Files removed.** `conductor.json`, `.conductor/settings.toml`, `.conductor/settings.local.toml`, and `ensemblr.json` are no longer read. Any left on disk are silently ignored.
- **No migration.** The `conductor.json`→`ensemblr.json` migration feature is removed. Old files are not converted; they are ignored.
- **`ENSEMBLR_*` only.** Workspace scripts, terminals, and Pi sessions receive `ENSEMBLR_WORKSPACE_NAME`, `ENSEMBLR_WORKSPACE_PATH`, `ENSEMBLR_ROOT_PATH`, `ENSEMBLR_DEFAULT_BRANCH`, and `ENSEMBLR_PORT`. All `CONDUCTOR_*` compatibility variables and the `conductorCompatibility` setting are removed.
- **`.worktreeinclude` retained.** `.worktreeinclude` remains a separate, generic files-to-copy list. It is unchanged and still wins for files-to-copy patterns when present.
- **Personal overrides in SQLite.** Per-user repository settings are stored in Ensemblr's SQLite database and edited through the repository Scripts settings screen. This is the editable "local config"; the app writes SQLite, never `.ensemblr/settings.toml`.

Repository settings resolve per key with this precedence, highest to lowest:

1. `.worktreeinclude` — files-to-copy patterns only.
2. `.ensemblr/settings.toml` — the committed repository config.
3. SQLite — personal per-user overrides, edited via the Scripts settings screen.
4. User defaults from `~/.config/ensemblr/config.json`.
5. Built-in defaults.

Note that `.ensemblr/settings.toml` now outranks personal SQLite settings per key. This is the **reverse** of ADR 0007, where personal repository settings overrode the shared config file. Under this decision the committed file is the foremost authority for the keys it defines; keys it omits fall back to SQLite, then user defaults, then built-in defaults. When both the committed file and a SQLite edit define the same key, the committed value wins and the SQLite edit is stored but shadowed.

`runScriptMode` takes the values `concurrent` and `nonconcurrent` (no hyphen).

## Alternatives Considered

### Keep the Conductor-compatible multi-file model (ADR 0007)

Retaining `conductor.json`/`.conductor/*.toml`/`ensemblr.json` plus `CONDUCTOR_*` mirrors would preserve drop-in compatibility for existing Conductor repositories. Rejected: the compatibility surface was large, the precedence was hard to explain, the migration path was dead, and the model diluted Ensemblr's product ownership.

### Keep personal SQLite above the committed file

Leaving SQLite as the top repository authority (the ADR 0007 order) would let each user quietly override committed team settings. Rejected: a committed, hand-authored `.ensemblr/settings.toml` is meant to be the team's shared source of truth, so it should win per key; personal SQLite remains available for keys the committed file does not define.

## Consequences

- Repository configuration is a single committed, hand-authored file, so precedence and provenance are easy to explain and debug.
- Removing `CONDUCTOR_*` is a breaking change for any script that relied on those variables; such scripts must switch to the `ENSEMBLR_*` names.
- Repositories that only ever had `conductor.json` or `ensemblr.json` (and no `.ensemblr/settings.toml` and no personal SQLite edits) resolve to built-in defaults; `.worktreeinclude` still copies files.
- The Scripts settings screen edits personal SQLite values; users cannot edit the committed file from the app, and a SQLite edit is shadowed whenever the committed file defines the same key.
- Docs, ADRs, and planning issues that described the old multi-file model or `CONDUCTOR_*` env must point to this decision.
