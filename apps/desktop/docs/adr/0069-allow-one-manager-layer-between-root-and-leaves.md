# 0069. Allow One Manager Layer Between Root and Leaves

Date: 2026-09-10

## Status

Accepted. Supersedes only the one-edge delegation-depth limit described in
[0059](./0059-let-agents-reach-sideways-and-upwards.md); its peer and upward
communication decisions remain unchanged.

## Context

A root could split work once, but every resulting sub-agent had to perform its
whole workstream serially. That made delegation awkward for a substantial
subsystem whose owner could identify independent implementation or investigation
units only after reading it. Treating every descendant as either a root or a
leaf also made a missing lineage record dangerously close to authority.

## Decision

- Delegation has two edges: root (depth 0) → manager (depth 1) → leaf (depth 2).
  A manager remains a sub-agent responsible for one workstream; it integrates its
  leaves and reports to its immediate parent. A leaf cannot delegate.
- A manager receives only five additional Ensemblr operations:
  `startConversation`, `listModels`, `waitForAgents`, `sendFollowUp`, and
  `closeTab`. It may use them only for fresh immediate leaves it owns. Reused
  tabs, peers, Review, sideways/upward steering, workspace authority, terminals,
  harnesses, and user dialogs remain unavailable.
- Persisted validated lineage is authoritative. Provable legacy tab ancestry is
  promoted into the versioned record; missing, malformed, or unprovable legacy
  ancestry is treated as depth 2, never as a root or manager.
- The lifetime spawn count and rolling rate are charged to the root tree. Closing
  or stopping a child does not refund budget. Ancestor and cross-branch waits or
  steering remain refused.
- Plan Mode and AFK Mode are inherited down both edges. A planning manager may
  open read-only leaves; it still cannot submit the plan or question the user.
- Descendant Claude sessions are pinned to Ensemblr delegation and denied native
  `Agent`/`Task`, regardless of the root's saved mechanism. Pi applies its
  delegate → wait barrier to roots and managers and restores owned-child state
  after reload.
- Awareness, MCP discovery, Pi registration, session briefs, and context-pressure
  guidance select the same manager or leaf audience from validated depth.

## Consequences

A substantial delegated workstream can fan out once without turning a leaf into
an independent orchestrator. The hierarchy remains bounded and visible in the
app, while reports and attention signals move one edge upward at a time.

The control surface now depends on both durable role and depth. Every caller that
constructs a `ControlAudience` or dispatches role/Plan Mode policy must pass
validated depth; compatibility omissions deliberately lose delegation authority.
Root-tree accounting and child ownership require more lineage bookkeeping, but
prevent budget laundering by closing children or restarting the app.
