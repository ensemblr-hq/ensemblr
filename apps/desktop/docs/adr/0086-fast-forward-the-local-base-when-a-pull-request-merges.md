# 0086. Fast-Forward the Local Base When a Pull Request Merges

Date: 2026-10-08

## Status

Accepted

Extends the merge close-out of
[0082](0082-close-out-a-workspace-when-its-pull-request-merges.md) with a
fourth step, and adds an agent-control op that merges through the same path as
the Merge button.

## Context

Merging a workspace's pull request lands the work on GitHub's copy of the base
branch. The user's own copy does not move. The repository root checkout, which
Ensemblr clones once and cuts every workspace from, stays wherever it was. On
the machine this change was written on, the root's `master` was 76 commits
behind `origin/master`. Anything the user ran from the root, such as a build, a
`git log`, or a new branch cut by hand, ran against stale code until they ran
`git pull` themselves.

New workspaces were fine. `resolveFreshForkRef` fetches the base before forking
and deliberately leaves the local branch where it is. Only the checkout the user
works in fell behind.

Agents had a second problem. Asked to merge, an agent ran `gh pr merge` itself.
The close-out still happened, but only when the PR sweeper next read the pull
request as merged, which can take up to two minutes. The agent had no way to
find out what the close-out did.

## Decision

### The close-out fast-forwards the local base

`createMergeCloseOutService` takes a `syncLocalBase` step and runs it next to
the linked-issue close. A failure in one does not stop the other. The step
(`src/main/merge-close-out/local-base-sync.ts`) reads the workspace's
repository and stored base branch, checks the `updateBaseAfterMerge` setting,
and calls `fastForwardLocalBase` (`src/main/repository/base-fast-forward.ts`).
That function:

1. Maps the stored base to a local branch: `origin/master` becomes `master`
   when `origin` is a configured remote.
2. Reads the branch's upstream, falling back to `origin/<branch>`, and fetches
   it.
3. Stops at `up-to-date` when the two commits match, and at `diverged` when the
   local branch has commits the upstream does not. A diverged branch is never
   touched.
4. Moves the branch only by fast-forward, choosing how by where it is checked
   out:
   - Not checked out anywhere: `git update-ref` with the old commit as the
     expected value, so a concurrent move fails instead of being overwritten.
   - Checked out in the repository root: `git merge --ff-only`. Git refuses
     when the move would overwrite an uncommitted edit or an untracked file,
     the same way `git pull --ff-only` does, and the step reports `blocked`
     with git's error line.
   - Checked out in any other worktree, such as an Ensemblr workspace:
     `checked-out-elsewhere`. Its files would change under whoever works
     there, so it is left alone.
   - When git cannot list the worktrees, the step reports `unavailable` and
     does nothing. Moving a ref that might be checked out would leave that
     checkout's index out of step with its branch.

Every outcome is typed (`LocalBaseSyncOutcome` in
`src/shared/workspace-merge.ts`). Outcomes other than `fast-forwarded`,
`up-to-date` and `disabled` are logged.

`closeOut` now keeps the promise for each merged pull request and hands it to
any repeat call, where it used to return null. That lets a caller who merged the
pull request await the close-out that the merge listener already started,
without running it twice.

### A setting, on by default

`updateBaseAfterMerge` sits next to `archiveAfterMerge`: an app-level Git
setting, with a per-repository override (`update_base_after_merge` in
`.ensemblr/settings.toml`). It defaults to on because a stale root is the
problem being solved, and the step only ever fast-forwards.

### Agents merge through `ensemblr_merge_pull_request`

`GithubService` is now built in `main.ts`, not inside the IPC handler
registration, so agent control can share it. `mergeWorkspacePullRequest`
(`src/main/merge-close-out/workspace-merge.ts`) runs the same
`mergePullRequest` the button runs. If the refreshed snapshot reads merged, it
awaits the close-out and returns its report: the issue outcome and the
base-sync outcome. `mergePullRequest` now also returns the merged pull
request's number, or null when a merge queue only enqueued it.

The op follows the workspace permission mode as an ordinary control write.
Trusted workspaces proceed, approval-required asks, and read-only blocks. It
does not use the `pull-request-merge` permission kind, which always asks: the
user has already asked the agent to merge. It is refused in AFK, in Plan Mode,
for sub-agents, and for the Concierge. The op never archives the workspace,
because that would end the session that called it.

### Alternatives rejected

- **Pull in the repository root unconditionally** (`git pull` in the root). A
  root on another branch would get the wrong branch updated, and a pull can
  create a merge commit. The fast-forward-only path covers every case `pull
  --ff-only` does and also moves a branch that is not checked out.
- **Move the branch with `git fetch origin master:master`.** Git refuses this
  for a branch checked out in any worktree, which is the common case for the
  root. The only fix would be a second code path anyway.
- **A standalone sync tool for agents.** The close-out already syncs on every
  observed merge, including an agent's own `gh pr merge` once the sweeper sees
  it. A merge tool also makes the close-out immediate and reports it, which a
  sync tool could not.

## Consequences

- After any merge Ensemblr observes, the local base branch catches up: right
  away for the Merge button and the agent op, and within the sweeper's cadence
  for a merge made elsewhere.
- A root with uncommitted edits in files the merge touches stays behind, and
  the reason is logged. Nothing in the UI shows it yet.
- A base with local commits of its own is never rewritten. The user rebases or
  resets it themselves.
- Repositories that already pull on a schedule see `up-to-date` and nothing
  else.
