# 0082. Close Out a Workspace When Its Pull Request Merges

Date: 2026-10-03

## Status

Accepted

Builds on the pull-request sync of
[0035](0035-sync-workspace-pull-request-state.md) and the multi-account Linear
writes of [0052](0052-support-multiple-linear-accounts.md). Leaves the
agent-control rule that an agent may not complete a Linear issue in place.

## Context

A merged pull request is the point where a workspace's work is finished.
Nothing in the app acted on that. The board card stayed in In Review, a Linear
issue the workspace was created from stayed in In Review, and a linked GitHub
issue stayed open. The user moved all three by hand.

Merges reach the app in two ways:

- **The Merge button.** It runs `gh pr merge` through `GithubService` and then
  refreshes the workspace's cached snapshot.
- **Everything else.** An agent's own `gh pr merge`, the GitHub web UI, or a
  merge queue landing the pull request later. These show up only when a
  snapshot refresh (the 0035 sweeper or a renderer poll) reads the pull request
  as merged.

Both paths write the cached snapshot through `GithubService`, and nothing else
writes it.

## Decision

`GithubService` reports a merge, and a new main-process concern acts on it.

- **Detection lives where the cache is written.** `createGithubService` takes an
  `onPullRequestMerged` listener.
  - A snapshot refresh fires it when `observedMergeNumber` sees the same pull
    request cached unmerged and fetched merged.
  - The Merge button fires it when the snapshot fetched right after
    `gh pr merge` reads merged. A successful `gh pr merge` on its own is not
    enough, because on a repository with a merge queue it only enqueues the
    pull request.
  - A first-ever read of an already-merged pull request is ignored. A fresh
    install, or `gh` signing in again after an outage, must not close out every
    workspace that merged long ago.
- **The close-out is its own concern.** `createMergeCloseOutService` lives in
  `src/main/merge-close-out/` and runs these steps, once per workspace and pull
  request in a session:
  1. Moves the workspace's board card to `done`. It updates the main-process
     mirror and sends the existing board-status broadcast, so the card moves
     the same way it does for an agent's `setWorkspaceStatus`.
  2. If the workspace was created from a Linear issue, moves that issue to its
     team's completed state. It prefers a state named Done and otherwise takes
     the first completed state. An issue that is already completed or canceled
     is left alone.
  3. If the workspace was created from a GitHub issue, runs
     `gh issue close <url> --reason completed`. `gh` treats an issue that is
     already closed as a success.

  A step that fails is logged and does not stop the others.
- **The app moves the ticket, not the agent.** The close-out calls the Linear
  service directly. It does not go through the agent-control port, which still
  refuses `completed` and `canceled` states. The merge is the human decision
  that the work is done. Agent work still stops at In Review, and the
  linked-issue directive now says that the app sets Done on merge.

### Alternatives rejected

- **Close out from the renderer** in the merge mutation's success handler, plus
  an effect that watches the navigation snapshot. The success handler only
  covers the button. The effect only covers what a window happens to render.
  The Linear write would also need a new IPC path around the agent-control
  refusal.
- **Close out from the sweeper alone.** The Merge button writes the merged
  snapshot itself, so the sweeper never sees that transition.

## Consequences

- A merge closes out its workspace whichever way it happened, usually within
  the sweeper's cadence and immediately for the button.
- Board status is still renderer-owned. If no window is open when the merge is
  observed, the broadcast reaches nothing, and the next renderer report
  replaces main's mirror. The Linear and GitHub steps still run. The card stays
  where it was.
- A failed Linear or GitHub step is not retried. The cache already reads merged,
  so no later refresh fires the transition again. The failure is logged, and
  the user moves the issue by hand.
- Teams that also run Linear's own GitHub integration get the same move twice.
  The second one finds the issue already completed and does nothing.
