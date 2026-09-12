# 0070. Publish Shared Repository Settings onto a Workspace Branch

Date: 2026-09-12

## Status

Accepted

Supersedes the root-write clauses of
[0041](0041-write-repository-scripts-to-ensemblr-settings-toml.md) — "Writes
target the repository root clone", its rejection of writing a worktree, and the
launch-time migration that wrote the root. Everything else in 0041 still holds:
`.ensemblr/settings.toml` is the sole store for script settings, the app writes
it, the write is atomic, and comments do not survive the rewrite.

## Context

0041 chose the root clone because a root edit is not stuck behind a feature
branch merging. What it did not account for is that the root clone is the one
checkout Ensemblr never shows anybody.

A workspace is a git worktree with its own branch, a Changes panel, a diff, and
a pull request. The root clone has none of that. So every Scripts save, every
Infisical link, and the launch-time script migration produced an edit to a
tracked file that sat on no branch, appeared in no diff, was reviewed by nobody,
and was committed only if the user happened to run `git status` in a directory
the app otherwise manages for them. In practice they did not: the edits
accumulated in the root indefinitely.

That has a second consequence the app itself trips over. `src/main/repository/`
refuses to advance a dirty checked-out base, so a root the app had dirtied on
the user's behalf silently stopped new workspaces from forking current code.
The app's own writes were aging the codebase every workspace started from.

The rejected alternative in 0041 — "the edit would land on a feature branch, so
sharing it with the team would depend on that branch merging" — describes a cost
that is real but ordinary. Depending on a branch merging is how every other
change in the repository is shared. The root path avoided that cost by avoiding
review entirely, which is not the same as being cheaper.

## Decision

Shared repository config is written to a **live workspace the user names**, and
never to the root clone.

- **Scripts saves target an explicit workspace.** The Scripts screen shows which
  workspace receives the write and lets the user change it; it also reads that
  workspace, so the values on screen are the values that workspace runs. A
  repository with no live workspace refuses the save and says why rather than
  falling back to the root.
- **Infisical links target that same workspace.** Linking or unlinking an
  Infisical project writes the committed `[infisical]` block to a live
  workspace the user names and reads it back from there, so the project on
  screen is the project that workspace's branch declares. The per-machine half
  of the link — the account choice, the value cache — is untouched and still
  saves when the committed write is refused. A repository with no live
  workspace is refused the same way a Scripts save is.
- **Nothing writes the root at launch.** The pass that folded pre-0041 SQLite
  script rows into the root's committed file is gone. The rows stay where they
  are — usable, since the resolver still ranks them — until they are consciously
  published.
- **Edits already stranded in the root get a way out.** A Settings file screen
  previews a three-way merge of the root's pending `.ensemblr/settings.toml`
  into a chosen workspace using `git merge-file`, publishes a clean one onto
  that workspace's branch, and — as a separately confirmed step — restores the
  root's copy to its committed HEAD state.
- **Every step is guarded and reversible.** A preview is one-shot and is refused
  once HEAD, the staged entry, the porcelain status, or either file's bytes have
  moved. A conflict leaves both copies untouched and is resolved by hand. A
  recovery snapshot is captured outside the repository before each write, so
  either side can be put back. Cleanup is refused outright when the root's file
  is staged or conflicted.
- **The app never runs git for the user.** No automatic commit, stash, reset,
  rebase, or push. Publishing produces an ordinary uncommitted change on a
  workspace branch, and the user commits it like any other.
- **Retained SQLite rows drain only after a verified write.** The publication
  folds them into the file it writes, hash-verifies what landed, and drops the
  rows only then — the same ordering the retired migration used.

## Rejected alternatives

### Keep writing the root, and commit it for the user

Committing on the user's behalf puts the app in charge of their history, and the
root clone is shared by every workspace of the repository. A bad automatic
commit there is felt everywhere at once. Ensemblr does not move HEAD for anyone.

### Merge the two copies by TOML key rather than by line

A key-level merge conflicts less: two edits to the same table merge cleanly
instead of colliding on adjacent lines. Rejected because the round-trip through
`js-toml`'s `dump` would rewrite the whole file, destroying comments and key
order in a file the merge is supposed to be conservative about. `git merge-file`
preserves both sides byte-for-byte and reports a conflict the user can read.

### Create a dedicated settings workspace automatically

A workspace the user did not ask for, holding one file, is a workspace they have
to notice, name, review, and archive. Publishing into a workspace they already
have keeps the change where their attention already is.

## Consequences

- A shared config change reaches the team the way every other change does: on a
  branch, in a diff, through review. That is slower than an invisible root edit
  and is the point.
- The root clone stops accumulating uncommitted changes, so a new workspace
  forks current code again instead of a base the app itself had dirtied.
- A repository with no live workspace cannot edit its scripts in the app. The
  screen says so; it does not invent a workspace.
- The Scripts screen no longer warns that the open workspace diverges from the
  root, because it no longer reads the root to compare against.
- The environment layer still *reads* the root clone's committed `[infisical]`
  block when it resolves a repository-scoped link at launch, because a terminal
  or agent names no workspace to read instead. Reading is safe — nothing writes
  there any more — and it means a block that exists only on a workspace branch
  reaches everyone's runs once that branch merges, like any other change. The
  user's own machine is unaffected either way: their link's local half resolves
  from SQLite.
- Recovery snapshots live in `userData`, not in the repository, and are not
  pruned. They hold settings bytes, so they are written user-only (`0o600`).
- The publication preview is the only way to learn whether the root holds
  anything pending, so opening the screen runs one. Previews are bounded and the
  oldest are dropped.
