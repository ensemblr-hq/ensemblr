# 0062. Open an Agent-Requested Review as a Sub-Agent

Date: 2026-09-06

## Status

Accepted

Amends [0061](./0061-run-an-unattended-change-through-plan-review-and-a-pull-request.md),
which introduced `startReview` and opened what it opens as a root orchestrator.
The op, its brief, and its place in the unattended loop are all from that ADR;
this one changes the *shape* of the conversation it opens and the parts of both
that depended on that shape.

## Context

`startReview` opened the Review conversation with `asPeer: true`, behind
`reserveCoTenantSlot`. That made the reviewer a root: no `parentSessionId`, its
own delegation budget, and — because it is a second writer on one checkout — one
of the workspace's two co-tenancy slots for as long as it stayed open.

The reasoning in 0061 was that reviewing a wide change is itself delegable work,
and a reviewer that cannot spawn readers of its own reads a fifty-file diff in
one pass or not at all. That is true, and it is not worth what it costs.

`PEER_ORCHESTRATOR_LIMITS.maxPerWorkspace` is **2**, counted over roots plus
running harness terminals, caller included. So an unattended orchestrator gets
exactly one review, and only if nothing else is in the workspace:

- A `npm run dev` in a harness terminal, a peer the user opened earlier, or a
  second chat the user started themselves each take the slot the review needed —
  and the loop is refused the second reading its entire shape is built around,
  with `denied-quota`, at the point where nobody is awake to free anything.
- The reviewer holds the slot for as long as it is open, and the loop deliberately
  keeps it open across every round. So even in an empty workspace the run spends
  the whole allowance on its first review and cannot open anything else for the
  rest of the night.
- The block's own re-entry path — re-plan at step 1, walk back through step 3 —
  lands on a `startReview` that the reviewer from the first pass refuses. 0061
  answered that with two separate paragraphs of prompt telling the agent not to
  do the thing the numbered steps had just told it to do.

None of that buys anything the reviewer actually uses. What it fans out to is
readers over slices of a diff, and `readWorkspaceDiff` already budgets and slices
one — `stat: true` for the file list, `filePath` per file, the concatenation fitted
to `MAX_AGENT_PAYLOAD_CHARS`. The delegation budget bought a faster read of a wide
change, at the price of the review being refused outright in a workspace that
happened to have a dev server running.

## Decision

**`startReview` opens the caller's sub-agent.** `asPeer: false`, so the spawn
records `parentSessionId` and the conversation takes the durable sub-agent
marker; `reserveCoTenantSlot` is dropped from the handler entirely. What the
shape change does not touch: the renderer still composes the brief, the review
model and thinking level are still the user's preferences rather than the
caller's, the fallback path still applies, and the op is still refused in Plan
Mode and withheld from a sub-agent, the Concierge, and a root delegating
natively. What it does touch beyond the spawn arguments is below — the reuse
guard, and how that pinned model and level resolve.

**The cap counts uncoordinated writers, and a child is not one.** This is the
line that makes the change coherent rather than a hole in the cap. A root and a
harness each write the checkout with no idea what the other is doing; a sub-agent
is opened by an orchestrator that blocks on it and sequences it against its own
edits. That is already the app's stance — `rootsInWorkspace` has always excluded
the durably marked sub-agents — and the review now falls on the side it belongs
on rather than being the one child counted as a co-tenant.

**The reviewer's brief says it reads alone.**
`src/shared/agent-control/review-peer-brief.ts` becomes
`review-subagent-brief.ts`; `buildReviewPeerDirective` becomes
`buildReviewSubAgentDirective`. The paragraph that told it to delegate freely now
points it at `ensemblr_get_workspace_diff` and at
`ensemblr_notify_orchestrator` — which it gains as a child, and which is a better
escape hatch than the `sendFollowUp` it loses, because it wakes an orchestrator
that is already blocked on it.

**"Keep the rounds in one conversation" stays enforced, by the op rather than by
the cap.** This was very nearly the one thing the change gave up. Dropping the
slot dropped the only thing making a second `startReview` impossible, and prose
is too weak for a rule the numbered steps themselves walk an agent into: the
loop's re-plan re-entry path goes back through a step 3 that says to call this
op.

So the op keeps one review per caller. `reviewsByCaller` records what each caller
opened, and a second call hands that session back as an `ok` — before the spawn
guardrail and before the compose, because reusing spends neither. The probe is
`resolveConversationWorkspace`, which answers "is there still a conversation
behind this id in this workspace" rather than "is that reviewer busy": the
session row outlives the reviewer going idle and outlives its tab being closed,
and `sendFollowUp` reaches it in both of those states, so both are a reviewer the
caller still has. Only a session that no longer exists at all falls through to a
fresh spawn, and the stale entry is dropped on the way past. The entry is cleared
in `releaseSession` alongside `guardrails.release`, so the map is bounded by live
sessions.

It is keyed by caller rather than by workspace because a peer running alongside
is a different orchestrator with its own reading to have done, and handing it a
reviewer briefed for somebody else's half would be the wrong answer.

Why a guard rather than reinstating the cap: the cap refused, at a point where
nobody is awake to free anything, and it refused for reasons that had nothing to
do with the review — a dev server in a terminal, a peer the user opened. This
refuses nothing. It also generalises no further than it should: concurrent
writing children are the app's existing stance, answered by "brief them onto
disjoint files", and a second review is the one case where that answer is
unavailable, because both readers are pointed at the same whole diff by
construction.

**The user's review model and level are honoured across runtimes.** Making the
reviewer a child re-raised a question the peer shape had answered badly.
`spawnableReviewModel` used to *drop* a configured review model that belonged to
the runtime the caller does not run on, because `resolveRequested` refuses a
cross-runtime model and `startReview` takes no model argument, so forwarding it
unchecked dead-ended the caller on a refusal it could not answer. The effect was
that a Pi orchestrator silently reviewed on a Pi model whatever the user had
configured — the op's one promise, "this is the review you set up", quietly
broken for every user whose review model is on the other runtime.

The refusal in `resolveRequested` is right for what it guards: an orchestrator
naming a cross-runtime model for a child has misunderstood its own children, and
substituting one silently is how it comes to believe they run something they do
not. None of that applies here, because nobody asked. The model came from
settings, and the spawn says so by withholding the caller's runtime — the same
shape a Concierge spawn takes, and the same reason: this is not a child
inheriting its parent's runtime. `reviewModelRow` resolves the pin against every
runtime's catalogue and hands back the row, and the review opens where that row
lives.

Two degradations, both reported rather than silent. A pin the catalogue has lost
falls back to the caller's own model, because a weaker review beats none. And a
configured thinking level the resolved model's ladder has no rung for is dropped,
because the two runtimes do not share a ladder and `selectionFor` refuses such a
spawn outright — forwarding the level would cost the user the review to save the
setting. A level configured with *no* model keeps riding through untouched: those
are independent preferences, and a user who set only a level would otherwise lose
it.

## Consequences

**AFK stops hitting a cap it should never have been near.** What bounds reviews
is now the op's own one-per-caller guard rather than a count of who else is in
the workspace, and the per-session spawn guardrail behind it — 20 lifetime, 10 a
minute — is about fork-bombs rather than about shared checkouts, and an honest
loop does not come close to it. A workspace with a harness terminal up gets its
review.

**Waiting gets simpler, and one class of wasted turn goes away.** The review is
among the children `waitForAgents` defaults to, so `targets` is optional rather
than mandatory. The result message keeps naming the id, because waiting on the
reviewer *alone* is still the common case when other children are in flight.

**A wide diff takes the reviewer longer.** It reads in slices instead of fanning
out. Both the result message and the loop now say so, because an orchestrator
that does not know it will read a slow review as a stuck one.

**Two agents can still write one checkout without the user asking** — the
serialization is still a contract in the directive rather than a lock, exactly as
0061 left it. What changed is only that the second one is now counted as the
child it behaves like.

**The reviewer's tab reads as a sub-agent.** The renderer resolves the noun in a
timeline row from the same durable marker, so an orchestrator's transcript now
says it steered a sub-agent rather than an orchestrator. That is the marker doing
its job; nothing in the renderer needed changing.

**The prose in three prompts had to be re-earned rather than re-worded.** The old
wording leaned on the app refusing things — a second `startReview`, a review in a
full workspace — and both of those refusals are gone. The second is genuinely
gone, and the place that leaned on it now carries the reason instead. The first
is not a refusal any more but it is still an outcome the app produces, so those
sentences state what a second call *does* rather than warning against making one:
an agent that reads "it will hand you the reviewer you already have" and calls it
anyway has lost nothing.
