# Discovery: Spotlight Testing (ENS-042 / THE-142)

Status: discovery complete — recommendation: defer to post-core. 2026-06-11.

## Question

Can Ensemble offer Conductor-style "spotlight testing" — running a workspace's
changes inside the root checkout's app process — without overwriting root
changes or breaking workspace isolation?

## Mechanics being emulated

Spotlight testing points the *root* repository checkout at a *workspace*'s
changes so a long-running root app (dev server, simulator build) picks them up
without restarting from the worktree. Conductor's `spotlight_testing` config
key exists in `.conductor/settings.toml` and is already parsed (but unused) by
our repository config loader.

## Candidate sync strategies

1. **Git-level sync: `git checkout <workspace-branch>` in root.**
   - Simple; but mutates root HEAD and fails or destroys state when root has
     uncommitted changes. Worst blast radius.
2. **Working-tree overlay: copy changed files workspace → root.**
   - `git -C <workspace> diff --name-only <base>` drives a file copy set.
   - Reversible only if Ensemble snapshots the overwritten root files first.
   - Conflicts: root-dirty files in the copy set must hard-stop the operation.
3. **Patch application: `git diff` in workspace, `git apply` in root.**
   - Atomic-ish (apply fails as a unit on conflict), easy to invert with
     `git apply -R`, never touches HEAD. Best safety profile.
4. **Symlink/bind redirection of the root app's source dir into the worktree.**
   - No copying, instant; but breaks tools that resolve real paths, confuses
     watchers, and silently bypasses root state. High weirdness budget.

## Conflict detection requirements (any strategy)

- Refuse when `git -C <root> status --porcelain` is non-empty for any file in
  the sync set; list the conflicting paths.
- Refuse when the workspace base commit is not an ancestor of root HEAD
  (diverged root) unless the user explicitly accepts.
- Re-check immediately before apply (TOCTOU window between preview and apply).

## Rollback and confirmation requirements

- Pre-apply snapshot: stash-like ref or `.context/`-stored reverse patch of
  every root file about to change; one-click "End spotlight" restores it.
- Explicit confirmation dialog naming the root path and file count; never
  triggered implicitly by another flow.
- Crash safety: the reverse patch must be persisted *before* the first write,
  so an interrupted apply is recoverable on next launch.
- A workspace archive/delete while spotlighted must first end the spotlight.

## Failure modes observed in fixture evaluation

- Root has uncommitted edits to the same file → silent overwrite (strategy 2)
  or apply failure (strategy 3). Strategy 3 fails safe; 2 needs a guard.
- Workspace rebased after spotlight start → reverse patch no longer matches;
  restoring needs the stored reverse patch, not a fresh diff.
- Watched dev server picks up half-applied file sets → patch application must
  write via temp files + rename or accept brief inconsistency.

## Recommendation

**Defer spotlight testing to post-core (Milestone 10).** Rationale:

- The safe minimum (strategy 3 with reverse-patch rollback, dirty-root
  guards, confirmation UX, crash recovery) is a multi-ticket feature, not an
  increment on Milestone 5.
- No current milestone depends on it; the run-script + preview path covers the
  dominant "see my changes running" need inside the workspace itself.
- The unresolved product decision — whether spotlight may ever proceed with a
  dirty root under user override — needs explicit sign-off before code.

Safe minimum if pulled forward: patch-based apply (strategy 3), hard refusal
on any dirty intersecting file, persisted reverse patch, explicit start/end
states surfaced in the workspace header. Never silently overwrite root
changes; never auto-start.

## Follow-ups

- Deferred note: track as post-core candidate under Milestone 10 with this doc
  as the design seed.
- Product decision needed: dirty-root override policy (recommend: not allowed).
