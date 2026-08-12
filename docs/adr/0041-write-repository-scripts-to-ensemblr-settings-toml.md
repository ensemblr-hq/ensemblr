# 0041. Write Repository Scripts to `.ensemblr/settings.toml`

Date: 2026-08-05

## Status

Accepted

Supersedes the read-only clauses of
[0030](0030-use-ensemblr-settings-toml-as-sole-repository-config.md) for script
settings. Everything else in 0030 — one committed TOML file, its precedence over
SQLite, `ENSEMBLR_*` only, `.worktreeinclude` retained — still holds.

## Context

ADR 0030 made `.ensemblr/settings.toml` outrank personal SQLite settings per key,
and at the same time kept the file read-only to the app: the repository Scripts
settings screen wrote SQLite rows the committed file then shadowed.

For scripts that combination has no coherent user story. A repository that
commits `[scripts.run.dev]` shows the Scripts screen a list it cannot edit,
labelled "Remove the `[scripts.run]` tables there to edit these locally". A
repository that commits `scripts.setup` shows an editable textarea whose edits
are saved and then ignored, labelled "your edit is saved but shadowed until that
key is removed". Both states ask the user to hand-edit a file the app is
perfectly capable of writing, and the second one silently discards their work.

A settings file the app reads but refuses to write is a half-implementation:
the app already knows the schema, already parses it, and already renders every
key as a form control. The read-only stance was the anomaly.

## Decision

The repository Scripts settings screen reads and writes
`.ensemblr/settings.toml` directly. It is the sole store for script settings.

- **The app writes the file.** Saving on the Scripts screen rewrites the
  repository's committed `.ensemblr/settings.toml`. Every other section of the
  file survives by value; the write is atomic (temp file plus rename).
- **Comments are not preserved.** The rewrite goes through `js-toml`'s `dump`,
  which emits no comments and groups scalars ahead of sub-tables. A file the
  Scripts screen saves loses the hand-written comments and blank-line grouping it
  had. This is the accepted cost of not adding a comment-preserving TOML editor
  dependency; the starter template says so, and other settings screens (Git,
  Misc) still write SQLite and never touch the file.
- **A config that does not parse is never overwritten.** An invalid file makes
  the write fail and surface an error, leaving the user's file byte-for-byte
  intact.
- **Scripts no longer resolve from SQLite.** The repository-scoped rows
  `scripts.setup`, `scripts.archive`, `scripts.run`, `scripts.runScripts`,
  `runScriptMode`, and `autoRunAfterSetup` are migrated into the committed file
  and then deleted. The committed file already outranked them, so the merge
  takes the committed value for any key both sides define and the migration
  cannot change what a repository runs.
- **The migration runs at every launch and carries no "already ran" marker.**
  Draining the rows is what makes it idempotent: a migrated repository has
  nothing left to move, so the next pass skips it. A marker would have to be set
  before knowing every repository succeeded, which would strand the rows of any
  repository that was unwritable — or archived — at that moment behind a flag it
  could never clear.
- **Writes target the repository root clone.** The root is the checkout whose
  branch gets committed and merged, so an edit made here is one the team can
  actually receive. The Scripts screen therefore also *reads* the root, so it
  round-trips its own writes.
- **Running still resolves from the workspace worktree.** The script lifecycle
  service is unchanged: a workspace runs the `.ensemblr/settings.toml` on its own
  branch. When the open workspace's branch resolves different script settings
  than the root, the Scripts screen says so rather than implying it controls that
  workspace.
- **New key: `[scripts] auto_run_after_setup`.** The auto-run-after-setup toggle
  had no TOML spelling and could only live in SQLite. It is now a boolean
  `[scripts]` key, snake_case like the existing `run_mode`. It is Ensemblr-only,
  with no external counterpart.

Keys the screen writes, all under `[scripts]`: `setup`, `archive`, `run_mode`,
`auto_run_after_setup`, and one `[scripts.run.<name>]` table per run script with
`command`, plus `icon`, `default`, and `available_in` when they differ from their
defaults. A blank setup or archive command removes its key rather than writing an
empty string.

## Alternatives Considered

### Keep writing SQLite and make the shadowed state clearer

Better copy on the "your edit is shadowed" hint would explain the behaviour
without changing it. Rejected: the underlying behaviour is the problem. A form
that saves edits it will not honour is worth fixing, not annotating.

### Preserve comments with a round-trip TOML editor

Editing the file through a CST that keeps comments and key order would avoid the
one real cost of this decision. Rejected for now: `js-toml` is already a
dependency and has no such API, and the only npm package built for it,
`toml-patch`, was last published in 2022 and ships CJS only. The starter template
warns that the app rewrites the file.

### Write the open workspace's worktree instead of the root

Writing the worktree would make the screen agree with what the dock runs for that
workspace. Rejected: the edit would land on a feature branch, so sharing it with
the team would depend on that branch merging. The root is where a config change
belongs.

## Consequences

- Editing scripts in the app produces an uncommitted change to a git-tracked
  file. Users commit `.ensemblr/settings.toml` to share the change, and a
  workspace picks it up when its branch has the change.
- The first save of a repository whose `.ensemblr/settings.toml` carries comments
  deletes them. Repositories that never open the Scripts screen keep their file
  untouched.
- The migration writes `.ensemblr/settings.toml` at startup for any repository
  that still has personal script rows. A repository whose checkout cannot be
  written keeps its rows and is logged, and the next launch retries it. Until it
  succeeds that repository keeps resolving its scripts from SQLite, which is
  where they already ranked, so nothing it runs changes in the meantime.
- A failure the user never resolves logs once per launch rather than going
  quiet. That is the intended trade for never stranding a repository's settings.
- The Scripts screen no longer shows per-row provenance badges: every value comes
  from one file, so the badges carried no information.
- `scripts.setup` and friends are no longer settable per user. A user who wants a
  different setup command for themselves has to change the committed file, which
  is the intended trade — the file is the team's shared source of truth.
- Docs describing the file as hand-authored and read-only apply only to the
  non-script sections now.
