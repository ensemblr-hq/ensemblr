# 0059. Let Agents Reach Sideways and Upwards

Date: 2026-09-05

## Status

Accepted

## Context

The agent topology only pointed one way: down. The Concierge briefed an
orchestrator, an orchestrator fanned out sub-agents, and every edge in that graph
carried instructions from a parent to a child. Three things were missing, and
each of them was a place where work stalled with nobody able to say so.

**An orchestrator could not parallelise inside its own workspace.** The standing
rule is one orchestrator per workspace, because two orchestrators on one worktree
are two writers on one checkout. The only escape was to cut another workspace,
which forks the branch and splits the work across two diffs — the wrong shape
when the two halves belong to one change.

**An orchestrator could not talk to the Concierge.** Its report existed only as
text in its own tab, and the Concierge never reads a workspace on its own
initiative. A blocked dependency, a wrong assumption in the brief, work that
belonged in another repository: all of it sat there.

**Nothing could file a ticket.** The Concierge is told it can move the tracker,
but its Linear surface was read-plus-amend. Asked for an issue it had to hand the
text back to the user to paste, or cut a workspace and put an agent in it to make
one API call.

## Decision

Three ops, each shipped on its own and each answering the questions its half of
the topology raised.

### An orchestrator may open a peer, and the user authorizes it

`startConversation` with `peer: true` opens a second root orchestrator in the
caller's own workspace.

**The peer records no `parentSessionId`.** That is what makes it a root on every
axis rather than only in the spawn path: the origin registry resolves depth from
lineage, and `resolveDelegation` reads any parent at all as proof of a spawned
child and pins it to the `ensemblr` mechanism. Absent lineage, it registers at
depth 0 with its own delegation budget, it is not among the children
`waitForAgents` defaults to, and it outlives the turn that opened it.
`spawnedChildRole` — the one function both role axes read — gains the peer case
beside the Concierge one, so the durable chat-tab marker and the registry cannot
disagree about what a peer is.

**The user authorizes it, not the model.** "The user explicitly asked for this"
is not something an agent can establish about its own prompt, so it is not asked
to: passing `peer` states an intent, and a `ConfirmPort` prompt turns that into
authority. It is raised whatever the permission mode, unlike every other
confirmation on this surface — `workspace-trusted` is the user trusting an agent
with its own workspace, which is not the same as trusting it to add a second
writer to it.

**Two agents writing one checkout, and that is what bounds the recursion.** A
peer is a root and looks like one to every gate, so "peers may not open peers" is
not a rule the app could check; a second peer is refused because the workspace
already holds its allowance.

The count comes from two places, because the two kinds of writer are recorded in
different ones. Conversations are control origins in the workspace whose species
drives a chat tab, minus the ones carrying the durable sub-agent marker — so a
child resumed after a restart, which re-registers at depth 0, is not miscounted
as a root. Harness terminals are counted from the live terminal list instead, as
sessions of kind `agent` that are still running. Their control origin is no use
for this: a terminal launch of *any* kind mints one workspace-scoped `harness`
origin so a CLI the user starts by hand can reach the control server, it is
minted once per workspace, and nothing releases it — counting that would spend
the allowance on a `npm run dev` opened an hour ago and go on doing so after the
terminal exited.

A spawn that has cleared the cap and has not opened yet holds a reservation. The
count is read before a confirmation prompt that blocks with no time limit, and a
peer registers nothing until it is running, so without one two spawns issued in
a single parallel tool block would both read the same count and both pass.

**The shared checkout is a contract, not a lock.** Nothing in the app arbitrates
two agents writing one worktree: writes go through each agent's own runtime and
neither can see the other's uncommitted edits. Rather than pretend otherwise, the
spawn prepends `buildPeerBriefDirective` to the peer's first prompt — the spawner
is the designated committer, the peer stays inside the files its brief names, it
checks the workspace diff before assuming a file is free, and it raises a
collision with `sendFollowUp` against the spawner rather than resolving it
itself.

The Concierge needed no new capability to see a peer: `listTabs` lists every chat
tab with its session id, and `outOfScope` already exempts the Concierge from the
own-workspace rule. Its playbook now says a workspace may hold two, and that
opening the second is the user's call rather than its own.

### A workspace agent may message the Concierge, and the session is resolved late

`messageConcierge` carries a reason and prose upward. The four reasons
`notifyOrchestrator` uses, plus `brief_wrong`, which only the agent that wrote the
brief can act on.

**It takes no session id.** The Concierge conversation is cleared and restarted
routinely, so any id an agent could hold was captured at spawn time and names a
session that is gone. The port resolves the live one at delivery, which is the
only moment the answer is true — and an agent that holds no id cannot hold a
stale one.

**A missing conversation is a loud refusal.** Not a queue, because a message
delivered hours later into a conversation that has since been cleared is context
nobody can place; and not a revive, because that starts a Concierge turn nobody
is watching. The refusal names the agent's own last message as where to put it
instead.

That refusal is a separate path through the session service rather than a check
in front of the ordinary one. `submitPrompt` revives on purpose — a user whose
Concierge child died still gets an answer — so a guard that only asked "is one
attached?" would still fall through to a revive whenever the child had died but
its shutdown event had not landed yet. `deliverAgentMessage` takes the other
branch at the same fork: it reports `no-session` where `submitPrompt` would
reopen, and it never holds the prompt for replay into a conversation that does
not exist yet.

**The user sees every one.** It arrives as an ordinary turn in the Concierge
panel, headed `MESSAGE FROM AN AGENT` and naming the sending workspace, tab, and
session id — every field resolved from the caller's control token rather than
from anything it passed, because the Concierge acts on other workspaces on the
strength of it. The loop Concierge → orchestrator → Concierge is bounded by
guardrail counters (10 per session, 3/min) beside the existing spawn ones.

It is a **write**, unlike `notifyOrchestrator`: that one sets a flag an
orchestrator polls, while this submits a prompt that starts a turn, and starting
another agent's turn is acting.

### Agents may file Linear issues, after searching

`linearCreateIssue` fronts the `createIssue` the Linear service already had.
`teamId` is required and never inferred; an `accountId` naming a different
account than the team's is refused rather than reconciled; and an opening
`stateId` must be `backlog`, `triage`, or `unstarted`, because a ticket nobody
has read is not in progress.

**A search is a precondition, not advice.** Every other guard is about the
ticket's shape, and none of them can see that the issue already exists under
somebody else's wording. Only a search can, nothing on this surface deletes a
filed issue, and "search first" left to the prompt is what a model skips exactly
when the backlog is large enough for the duplicate to be likely. So the service
refuses the first create in a session until `linearListIssues` has run.

Available to orchestrators as well as the Concierge — an orchestrator filing the
follow-up it found and was told not to fix is the case that motivates the op —
but denied to sub-agents, on the same grounds as the other Linear writes plus
duplication, and blocked in Plan Mode: a plan the user has not approved should
not have left rows on their board.

## Consequences

- The peer path is the first spawn that deliberately drops lineage. Anything that
  comes to depend on "every spawned conversation has a parent" is wrong from now
  on, and `asPeer` is required on the port rather than optional so a second spawn
  route cannot forget it.
- Two orchestrators can still collide on a file. The directive makes that
  unlikely and legible rather than impossible; if it proves insufficient in
  practice, a per-path lease is the next step, and it needs a real locking
  surface rather than more prose.
- A workspace agent can now start the Concierge's turn. The caps bound that, but
  the Concierge's own context is the shared resource — several workspaces
  messaging at once spends it, and the panel is one conversation.
- `ensemblr_linear_create_issue` can file a duplicate the search did not surface.
  The precondition raises the cost of that, not the possibility.
- **Not done:** a created issue cannot be linked to a workspace, so the
  "auto-move to In Progress / In Review" behaviour that a workspace's originating
  issue gets does not apply to one an agent filed. That needs
  `createWorkspace` to accept a linked issue, which is its own change.
