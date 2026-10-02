# 0048. Retire Feature Parity as the Product Target

Date: 2026-08-12

## Status

Accepted

Supersedes [0006](0006-target-a-complete-parallel-workspace-workbench.md).

## Context

ADR 0006 set the product target by reference: match another product's capability
surface, differing only where Pi or the locked stack forced it. That was the
right call in June. Ensemblr had no users, no shipped surface, and no evidence of
its own, and a known-good product in the category was the cheapest available
specification — "does the other one do this?" settled scope questions that would
otherwise have cost a week each.

Two months and forty-one decisions later, the target has stopped paying. Three
things changed.

**The decisions diverged on purpose.**
[0030](0030-use-ensemblr-settings-toml-as-sole-repository-config.md) replaced the
externally-compatible multi-file repository config with a single
`.ensemblr/settings.toml`. [0039](0039-remove-open-chat-tab-limit.md) removed a
five-tab cap that existed only to match an observation.
[0041](0041-write-repository-scripts-to-ensemblr-settings-toml.md) made the
Scripts screen write that file.
[0042](0042-add-claude-code-as-a-second-first-class-agent-runtime.md) put a
second agent runtime behind a provider-neutral adapter. Each was argued on its
own merits, and each moved away from parity — so the parity clause in 0006 had to
be explained away every time it came up.

**What Ensemblr ships is no longer a subset.** Ensemblr Control
([0040](0040-use-loopback-control-server-for-agent-app-control.md)), multi-agent
orchestration, plan mode enforced at the control channel
([0044](0044-enforce-plan-mode-fail-closed-at-the-control-channel.md)), per-chat
unread marks, the follow-up queue, ordered composer attachments
([0047](0047-model-composer-attachments-as-one-ordered-list-in-a-lexical-draft.md)),
a renderer-driven native menu
([0046](0046-drive-the-native-menu-bar-from-a-renderer-command-bus.md)), and
three app languages have nothing to be at parity with. A target phrased as
"match X" cannot express any of them, which is why the roadmap quietly stopped
using it.

**A parity matrix is a bad backlog.** It ranks work by what someone else built
rather than by what a user is blocked on, and it reads every gap as a debt even
when the gap is a decision that was taken deliberately.

What is worth keeping from 0006 is not the reference. It is the shape of the
product the reference stood in for.

## Decision

Ensemblr's scope is stated in its own terms. Feature parity with another product
is not a goal, not a ranking criterion, and not a reason to accept or reject a
change.

### 1. What Ensemblr is

Ensemblr is a macOS desktop workbench for running coding-agent work in isolated
project workspaces. Each stream of work gets its own git worktree — its own
branch, working tree, agent sessions, run state, and review path — and the app
carries that stream from first prompt to merge or archive without leaving it.

### 2. The scope, as five commitments

**Isolation is the product.** One workspace per shippable stream of work, backed
by a git worktree under a user-visible managed root
([0010](0010-use-a-user-visible-managed-root-directory.md)). Parallel workspaces,
and several sessions inside one workspace, are the normal case rather than an
advanced mode.

**The agent runtime is pluggable and never privileged.** Pi and Claude Code are
peers behind one adapter ([0042]); a third runtime implements the interface and
routes through neither of them. Terminal harnesses stay available for CLIs that
do not earn a native surface.

**The agent can drive the app, under permission.** Ensemblr Control ([0040]) is a
first-class surface rather than an integration: agents spawn conversations,
launch harnesses, run terminals, open tabs, move the board, and read and write
issues — gated per origin, and fail-closed wherever a mistake is irreversible
([0044]).

**Review is local-first and ends in GitHub.** Diff review, line comments, checks,
PR actions, and a two-step merge
([0023](0023-use-a-two-step-merge-confirmation.md)) run through `gh` against the
user's own authentication
([0013](0013-use-gh-cli-for-v1-github-integration.md)). No part of review depends
on an Ensemblr account ([0019](0019-defer-ensemblr-account-for-v1.md)).

**Configuration is committed, legible, and ours.** One `.ensemblr/settings.toml`
per repository ([0030], [0041]), `ENSEMBLR_*` workspace variables, personal
overrides in SQLite, and declarative user config on disk
([0008](0008-use-sqlite-with-declarative-user-config.md),
[0009](0009-use-json-for-declarative-config.md)).

### 3. What replaces the parity matrix

Roadmap items are justified by user-visible outcome and by the decision record.
`docs/product/implementation-roadmap.md` carries sequencing; the ADRs carry the
reasons. A proposal whose only argument is that another tool has the feature
needs a different argument.

### 4. Interoperability survives; parity does not

Sharing a managed root with another workspace manager
([0011](0011-scope-shared-root-interoperability-to-filesystem-and-git.md),
[0015](0015-adopt-existing-workspaces-from-a-shared-root.md)) is a user-facing
convenience and stays. It is a filesystem and git contract — a worktree is a
worktree — and it never implied matching that tool's features.

## Alternatives Considered

### Keep parity as the target and enumerate the exceptions

0006 already permitted divergence "where Pi or the chosen stack require them", so
the exceptions could simply have been listed. Rejected: the exceptions had grown
past the matches, and a target that must be qualified at every use is not
steering anything. [0039] is the clearest case — it removed a limit whose only
justification was parity, and had to argue against 0006 to do it.

### Retire the target and state nothing in its place

0006 could have been marked superseded with no replacement. Rejected: the
capability list inside it is the only written statement of what this product
covers. Removing the reference without restating the scope would leave new work
with no scope test at all, which is worse than a borrowed one.

### Narrow the product to a Pi session browser

The alternative 0006 itself rejected. Two runtimes, a control surface, and an
orchestration model argue against it more strongly now than in June. Rejected
again: the isolation-and-review model is the product, and a session browser is
one feature inside it.

## Consequences

- **0006 is superseded, not deleted.** It records why the product looked the way
  it did in June 2026, and several ADRs still cite it as the origin of their
  motivation.
- **"For parity" is no longer an argument.** Any ADR, issue, or review comment
  resting on it has to restate the user-facing reason or drop the point.
  Existing ADRs keep their historical wording; they are records, not policy.
- **The parity documentation is retired with the target.** The parity matrix and
  the screen inventory it was scored against are removed from `docs/product/`,
  and the roadmap carries sequencing without them.
- **Comparison as evidence is still allowed.** Reading how another tool solved a
  problem is legitimate research. What is retired is comparison as
  *justification*.
- **Scope questions get a test.** "Does this serve one of the five commitments?"
  replaces "does the other product have it?" A proposal that serves none of them
  is out of scope however good it is.
- **Changing a commitment is an ADR, not a doc edit.** The five are load-bearing
  for that test, so adding, dropping, or rewording one supersedes this decision.
