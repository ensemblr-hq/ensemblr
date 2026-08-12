# 0043. Let a Workspace Adopt an Existing Branch Instead of Always Forking

Date: 2026-08-08

## Status

Accepted

Relates to [0035](0035-sync-workspace-pull-request-state.md) (workspace
pull-request state), [0013](0013-use-gh-cli-for-v1-github-integration.md) (`gh`
CLI for GitHub integration) and
[0027](0027-use-workspace-archive-lifecycle.md) (an archive lifecycle distinct
from delete).

## Context

Creating a workspace from a branch or a pull request forked a new branch off the
source tip and stored that same tip as the base branch. Each half was defensible
on its own; together they produced a workspace that could not show the work it
existed for. The review panel diffs the workspace branch against the base
branch, the base branch was the source tip, and the new branch started at the
source tip — so the panel diffed the branch against itself and showed nothing.
Open a workspace on a pull request with twenty commits and the Changes panel was
empty.

The fork was wrong on its own terms too. A workspace made from a pull request
exists to work *on* that pull request, and commits pushed from a forked copy land
on a branch GitHub does not associate with the PR.

Underneath both symptoms, one field was carrying two meanings. `baseBranch` was
doing duty as **where the branch was cut from** and as **what the branch is
measured against**. Those coincide only in the one case the app happened to
support — a fresh branch cut off `master`, reviewed against `master` — and
diverge in every other. A workspace taking over a PR branch is measured against
the PR's base, and its fork point is somewhere in history nobody needs to name.

The target-branch selector (#216) had already pulled at the same thread from the
other end, retargeting
`workspaces.base_branch` without touching the worktree on the grounds that "the
fork already happened". That change made the merge-target reading true after
creation. This one makes it true *at* creation, and adds the case where no fork
happens at all.

## Decision

### 1. Creation takes a `branchPlan` — a two-shape union, `adopt` or `create`

`src/shared/ipc/contracts/workspace.ts`:

```ts
export type WorkspaceBranchPlan =
	| { branch: string; kind: 'adopt' }
	| { forkRef?: string; kind: 'create' };
```

`CreateWorkspaceRequest.branchPlan` is optional and defaults to
`{ kind: 'create' }`, so every existing caller keeps forking.

`adopt` checks an existing branch out into the new worktree. The workspace owns
that branch: its commits show up in review, and pushes land on whatever pull
request already tracks it. `create` cuts a fresh branch at `forkRef`, defaulting
to the base branch.

**The fork point is absent from `adopt` and persisted in neither case.** Once the
worktree exists, the branch's own history records where it came from; storing a
fork point would be a second, staler copy of something git already knows, and it
is exactly the value that used to be mistaken for the merge target.

### 2. `baseBranch` means merge target, and nothing else

It is the diff base, the conflict probe's base, and the pull-request base — one
meaning, used by three consumers. A workspace created from a pull request
defaults it to that PR's own base rather than to its head.

`resolveBaseBranch` in `src/main/repository/create-workspace.ts` skips any
candidate that names the branch being adopted, comparing through `bareBranchName`
so `develop` and `origin/develop` are recognised as the same candidate. Without
that skip, a repository configured with `branchFrom: develop` — or an explicit
request base — would land the merge-base on HEAD when the adopted branch *is*
`develop`, reproducing the empty review panel this change exists to remove.

Base refs reach SQLite in both the bare and the `origin/`-qualified shape, so the
merge-base probe retries in the other shape rather than giving up and degrading
the review panel to uncommitted changes.

### 3. `git worktree add` argv moves behind `WorktreeBranchPlacement`

`src/main/repository/git-ops.ts`:

```ts
export type WorktreeBranchPlacement =
	| { forkRef: string; kind: 'create' }
	| { kind: 'checkout' }
	| { kind: 'track'; remoteRef: string };
```

Three cases, not two: the plan says what the *user* asked for, the placement says
what git must be told. `track` is the case a two-shape placement misses — a pull
request head that so far exists only on the remote has no local branch to check
out, and must be created from its origin tracking ref.

`resolveBranchPlacement` in `src/main/repository/worktree-placement.ts` settles
it in order: a fork ref means `create`; otherwise a local `refs/heads/<branch>`
means `checkout`; otherwise the origin tracking ref means `track`; otherwise the
branch exists nowhere and creation fails with `branch-not-found` instead of a raw
git error.

`forkRefOf` defaults a missing fork point to the base branch, because a
`{ kind: 'create' }` plan carries no `forkRef` until the service fills one in and
the placement would otherwise read that absence as an adoption — rejecting a
branch it was asked to cut.

`WorktreeCreated.createdBranch` is `placement.kind !== 'checkout'`, and it is the
single value rollback consults. See §6.

### 4. A branch that is spoken for is refused before git runs

Git allows a branch in one worktree at a time. `planBranchPlacement` checks
`git worktree list --porcelain` up front and fails with
`branch-already-checked-out` — git would reject the add anyway, but only after
three retries and with a message that names neither the holder nor the way out.

`isSamePath` compares through `realpathSync`, because git reports worktree paths
with symlinks resolved and a macOS repository under `/var/...` comes back as
`/private/var/...`.

The diagnostic distinguishes the repository folder from a workspace. The repo
folder is not a workspace, so telling the user to "open that workspace" sends
them nowhere; that case says to duplicate the branch instead.

### 5. The default branch forks; every other source adopts

The repository folder always has the default branch checked out, so adopting
`master` can only ever hit the case in §4. Picking the default branch also *means*
something different: "start something new off master". That row cuts a fresh
branch at `origin/<default>` and targets it, exactly as before adoption existed,
and its action label reads Create rather than Use branch so it does not promise a
takeover that cannot happen.

Every other branch adopts. So does a pull request: a free PR row checks its head
branch out and owns it, where it previously forked off `origin/<headRefName>` and
offered a Create label to match. Issues genuinely have no branch yet and stay on
Create.

Where an active workspace already holds a branch or PR head, the picker offers
Open alongside Duplicate rather than presenting an action that will fail.

### 6. A workspace never destroys a branch its creation did not cut

Three paths could move or delete a workspace's branch, and each one checks.

- **Rollback.** `rollbackWorktree` removes the worktree after a post-worktree
  failure and deletes the branch only when `createdBranch` says this creation cut
  it. An adopted branch predates the workspace and usually backs a pull request;
  a failed creation is not a licence to delete the user's work.
- **Rename.** Adoption is recorded as `adoptedBranch: true` on the workspace's
  metadata blob, read back by `branchWasAdopted` in
  `src/main/repository/rename-workspace.ts`. A *derived* slug is dropped
  silently, because the caller never asked for a branch change. An *explicit*
  branch is refused with a diagnostic naming the pinned branch — reporting
  success while discarding what the user typed would close the rename dialog on a
  change that never happened. `rename-workspace-dialog.tsx` reads the same flag
  as `branchPinned` so the field is visibly pinned before submit.
- **Automatic branch naming.** `src/main/agent-runtime/naming/apply-branch-slug.ts`
  and `branch-name-slug.ts` both skip a workspace whose
  `metadata.adoptedBranch === true`, so an agent naming its work cannot rename a
  branch it did not create.

### 7. Name allocation consults git — but only when a branch is about to be cut

A branch outlives the workspace that cut it. Deleting a workspace removes its
row while `bach` stays behind, so the name read as free right up to the point
`git worktree add -b bach` refused it with `git-worktree-failed`.

Allocation now folds every local branch into the same taken set the composer
surname pool and the slug suffixer already consult. Branch *segments* count too:
callers allocate the slug rather than the whole prefixed branch, so `bach` has to
read as taken when `octocat/bach` exists.

Only a plan that cuts consults that set. Adoption checks an existing branch out,
so letting branches steer the slug there would drop every adopted workspace into
a `-2` folder over the very branch it takes over. The `git for-each-ref` listing
is skipped entirely for an adopting plan, where its result was previously
collected and discarded.

### 8. A source label is sanitised into a legal name, never used raw

Seeding the workspace name from the source's raw label failed before git was ever
reached: a workspace name may contain only `[A-Za-z0-9 ._-]`, branch names carry
`/`, and pull-request titles carry `feat(scope):` and `[WIP]`.

`toWorkspaceDisplayName` in `src/shared/workspace-name.ts` collapses disallowed
runs to a single space, drops the leading dots the service rejects, and truncates
back to the last whole word. A label with nothing usable left yields no name at
all, leaving creation on the existing generated-placeholder path rather than
failing.

The charset lives in `src/shared/` so the rewrite, the service-side validator,
and the rename dialog's inline check cannot drift apart. Only the display name is
rewritten — an adopted branch keeps its real name.

## Consequences

- **Adoption is a metadata flag, not a column.** `adoptedBranch` is written into
  the workspace's metadata JSON blob, and omitted rather than set to `false` when
  the branch was cut. No migration was needed, and no SQL query can filter on it;
  every consumer parses the blob. A fourth code path that moves or deletes a
  workspace's branch must check the flag itself — nothing structural enforces it.
- **The base branch became retargetable and creation-independent.** The same
  redefinition underpins the target-branch selector (#216), which moves only
  `workspaces.base_branch` and leaves the worktree alone. That selector shipped
  first and was coherent only for already-forked workspaces; this ADR removes the
  field's remaining fork-point duty, so the two now agree on one meaning.
- **`git worktree add` failure no longer strands a slug.** Destination existence
  is sampled *before* git runs. A directory that predates the call lost a TOCTOU
  race and belongs to whoever got there first, so it stays and the caller gets
  `destination-exists`; anything else is this attempt's own debris and is cleared.
  Leaving it stranded the slug — every later creation resolved the same path and
  reported a stale "already exists" in place of the real error.
- **`branch-ref` is now shared code.** It moved from
  `src/renderer/lib/workbench/branch-ref.ts` to `src/shared/branch-ref.ts` (its
  test to `tests/shared/`) once the main process needed the same
  `origin/<name>` vs `<name>` rule. It is *not* re-exported through the
  `lib/workbench` barrel — every renderer call site imports
  `@/shared/branch-ref` directly, which is what keeps main and renderer visibly
  on one copy of the rule.
- **Two independent guards stand between a user and an empty review panel.** The
  plan must adopt rather than fork, *and* `resolveBaseBranch` must refuse to
  target the adopted branch. Either alone leaves the original bug reachable
  through a repository whose configured `branchFrom` happens to name the branch
  being adopted, which is why both are recorded here rather than treated as one
  fix.
