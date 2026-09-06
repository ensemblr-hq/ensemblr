# 0063. Open an Agent-Requested Review as a Peer Again, and Widen the Cap for an Unattended Caller

Date: 2026-09-06

## Status

Accepted

Supersedes [0062](./0062-open-an-agent-requested-review-as-a-sub-agent.md), which
made the agent-opened review a sub-agent of its caller. It restores the root
shape [0061](./0061-run-an-unattended-change-through-plan-review-and-a-pull-request.md)
gave it, and pays for that shape a different way. The two decisions 0062 made
besides the shape — resolving the user's configured review model across both
runtimes, and handing back the review a caller already has — are kept.

## Context

0062 read the cost correctly and priced the benefit wrong.

The cost was real. `startReview` opened the reviewer with `asPeer: true` behind
`reserveCoTenantSlot`, so it held one of the workspace's **two** co-tenancy slots
for as long as it stayed open. The unattended delivery loop is review, fix,
re-review against one conversation, so it holds a reviewer open for most of its
run — and the orchestrator itself is the other slot. Anything the user left in
the workspace before stepping away that the cap counts — a harness terminal still
running, a peer opened earlier — took the slot the review needed, and the loop was
refused with `denied-quota` at the point where nobody is awake to free anything.
A run script is not one of those: `liveHarnessTerminals` counts terminals of kind
`agent`, so a `npm run dev` left going has never taken a slot and is not part of
this problem.

The benefit 0062 dismissed was the reviewer's own delegation budget, on the
grounds that `readWorkspaceDiff` already budgets and slices a wide diff so a
single reader could work through one. That is true about *reading* the diff and
false about *reviewing* it. A sub-agent cannot delegate on any axis, so a
reviewer shaped as one gets exactly one context window for a change that may span
fifty files, several subsystems, and a test suite it has to reason about
alongside them — and it gets that window for the fix rounds too, which is where
the reading is least compressible. The review is the one step of the loop whose
entire job is a second, wider reading than the author managed; capping it at one
window is capping the thing being bought.

So the shape was traded away to fix an arithmetic problem, and the arithmetic
problem has an arithmetic fix.

## Decision

**The review is a root orchestrator again.** `startReview` opens it with
`asPeer: true` and no `parentSessionId`, behind `reserveCoTenantSlot` as before.
It has a delegation budget of its own, it fans readers out over a wide diff, and
it keeps that budget on the follow-up turns where it is asked to fix what it
found. `review-subagent-brief.ts` goes back to `review-peer-brief.ts`, and the
brief tells it to delegate rather than telling it that nested delegation is
blocked.

**An unattended caller may hold four co-tenants rather than two.**
`PEER_ORCHESTRATOR_LIMITS` gains `maxPerUnattendedWorkspace: 4` beside the
existing `maxPerWorkspace: 2`, and `reserveCoTenantSlot` picks between them off
the caller's own AFK state. The four is arithmetic, not generosity: the
unattended run's floor is two — itself and its review — and the two remaining
slots absorb exactly what a user routinely leaves behind when they step away, a
still-running harness terminal and a peer they opened earlier. The refusal
message names the limit that was actually applied, so an unattended caller at
three does not read a refusal claiming two.

The widened half is reachable only through `startReview`. `gatePeerSpawn` takes
its reservation under the same limit but then refuses every unattended caller
outright, so an agent cannot spend the extra slots on peers of its own choosing.

**Widened per caller, not per workspace.** The need belongs to the unattended
run rather than to the checkout. An attended orchestrator still asked for *a*
peer, and the hazard the cap exists for — several agents writing one worktree
with nothing arbitrating them — has not changed for it. Reading the caller leaves
the attended *limit* where it was; what an attended caller may now be refused
under it does change, and Consequences says so.

**The reviewer is still not waited on by default.** A peer registers no
`parentSessionId`, which is what gives it depth 0 and its own budget, and
`childrenOf` is the same field — so it is absent from the default target set of
`waitForAgents` and has to be named in `targets`. That is one documented sentence
in the result message, in the AFK loop's step 3, and in the role playbook. The
alternative was worse; see below.

**One review per caller survives.** `reviewsByCaller` and `reusableReview` are
kept from 0062. Under 0062 they replaced the co-tenancy cap as the only thing
stopping a second reviewer; here they are load-bearing for a different reason —
the cap is back, but it is now wide enough that a second `startReview` would fit
through it. Two reviewers over the same whole diff is the case the app otherwise
answers by briefing agents onto disjoint files, which a review cannot be.

**A review may not open a review.** The same widening opens a second door the
sub-agent shape had shut: a reviewer is a root, so `SUBAGENT_BLOCKED_OPS` no
longer refuses it `startReview`, and its role playbook is the orchestrator one
that recommends the op. At two the arithmetic closed it — orchestrator plus
reviewer is already full — and at four it does not, so a chain of orchestrator,
reviewer, reviewer's reviewer fits. `openedReviewSessions` is the reverse index
of `reviewsByCaller`, and a caller in it is refused `denied-scope` ahead of every
other check.

**The cross-runtime review model survives.** `reviewModelRow` resolves the user's
pin against the whole catalogue and the spawn withholds the caller's runtime, so
the review opens where the configured model lives. `reviewThinkingLevel` drops a
configured level the resolved model has no rung for, and every degradation —
cross-runtime, dropped pin, dropped level, fallback brief — is named in the
result message. None of that depended on the shape.

## Consequences

**The unattended loop gets a reviewer that can delegate, and room to keep it
open.** A wide change is read by several agents on the review side, and the loop
is no longer refused its second reading by a harness terminal the user left
running.

**A peer or a review can now seat a fourth writer on one checkout while nobody
is watching.** That is a real widening of the hazard the cap exists for, and four
things bound *those two paths*: the fourth slot is only reachable by an
unattended run, `gatePeerSpawn` still refuses an agent-chosen peer outright under
AFK, `openedReviewSessions` refuses a review that would open a review — the one
of the two that inherits neither of those refusals — and the reviewer occupying
the extra slot is serialized against its orchestrator by the loop itself: the
orchestrator blocks on it and leaves the files alone while it works.

**The cap is not a ceiling on writers, and this does not make it one.**
`handleLaunchHarness` runs `evaluateSpawnGuard` and nothing else — it never
reaches `reserveCoTenantSlot` — but what it opens is a terminal of kind `agent`,
which `liveHarnessTerminals` counts from then on. `AFK_BLOCKED_OPS` blocks
`askUserQuestion` alone, so an unattended agent may launch harnesses up to
`maxSpawnsPerSession`, each gated on the way in by nothing that knows about the
cap. More than four uncoordinated writers can therefore land on one checkout with
nobody watching, and the cap will report them afterwards without ever having
admitted them.

That asymmetry predates this ADR and is deliberately left standing. Routing
`launchHarness` through the cap is a behaviour change well outside what was
asked for here, and it would refuse an agent a harness the user wants. What the
cap bounds is what may be *added beside* the writers already present, by the two
ops that consult it; it has never counted the ones that arrive by another door.
It is named here so the next reader finds it in the record rather than in
production.

**A reviewer under `native` delegation delegates through its own runtime, and
cannot initiate contact.** A peer records no `parentSessionId` and carries no
sub-agent marker, so `resolveDelegation` no longer forces `ensemblr` the way it
did for the child of 0062: a review opened on Claude Code reads the user's own
`claudeSubagentMode`, and under `native` the Ensemblr spawn ops and `sendFollowUp`
are withheld in favour of the runtime's sub-agent tool. That reviewer still has a
delegation budget — it reaches it differently — but with `notifyOrchestrator`
refused to a root it has no op that reaches its orchestrator first. Forcing
`ensemblr` on the spawn was rejected: it would override a setting the user chose
for a conversation they can see and steer, and needs a pin mechanism that does
not exist. `review-peer-brief.ts` therefore names no delegation op and no
back-channel op; it states the budget, leaves the mechanism to whichever tool
list the reader holds, and points the blocked case at the report the orchestrator
is already waiting on.

**An attended caller can now be refused a review it would have got under 0062.**
The cap is the 0061 one restored, so nothing here is new against *that* — but
0062 is the tree this is diffed against, and under it `startReview` came through
no cap at all. An attended orchestrator whose workspace also holds a running
harness terminal is `1 + 1 >= 2` and answers `denied-quota`. That is the same
refusal the Context section above names as the problem, still standing for the
attended half, and it is accepted rather than overlooked: the attended cap's
premise — the user asked for *a* second writer — has not changed, and widening it
for a caller who is sitting there to close the harness themselves would be
solving the unattended run's problem everywhere. The answer at the keyboard is to
close the harness or work with the reviewer already open.

Otherwise attended behaviour is as it was: the same allowance of two, the same
refusal message, the same confirmation on a peer.

**A restart forgets which sessions are reviews.** `reviewsByCaller` and
`openedReviewSessions` are both in-memory, so nothing survives an app restart:
the orchestrator can open a second reviewer beside the one it already has, and a
reviewer resumed by a follow-up can open one of its own. What bounds that is the
co-tenancy cap rather than either guard. Accepted rather than fixed, because the
durable answer is the chat-tab marker `rootsInWorkspace` and `resolveDelegation`
already prefer for exactly this reason — a column rather than a process fact —
and a peer's marker is deliberately `null`, so recording "this session is a
review" there means a new column and a migration. That is disproportionate to a
harm the cap already bounds at four.

**The reviewer must be named in `targets`.** Three places say so, and a caller
that forgets gets an empty wait rather than a wrong answer.

## Alternatives Considered

**Keep the sub-agent shape and live with the single window.** This is 0062, and
it is what is being reversed. The delegation budget is the difference between a
review that can read a fifty-file change properly and one that cannot, and no
amount of diff-slicing substitutes for a second reader with its own context.

**Raise `maxPerWorkspace` to four for everyone.** Simpler, and wrong. The
attended cap's stated reason is that the user asked for *a* peer; four attended
writers on one worktree is a hazard nobody asked for, to solve a problem only the
unattended loop has.

**Make the review a peer that is also in the caller's default wait set** —
register it with a `parentSessionId` while exempting it from `resolveDepth`, the
way a Concierge-spawned root is exempt. Rejected because `childrenOf` reads the
same field: threading the review in would put *every* user-requested peer into
the spawner's default wait set, and a peer deliberately outlives its spawner's
turn. An orchestrator calling `waitForAgents` with no targets would block on one.
A review-only third species — root, but waitable — is more machinery than the one
sentence it saves.

**Exempt the review from the cap entirely, keeping only the peer shape.** It
would work, and it would be a lie about what the reviewer is. A root with its own
delegation budget is an uncoordinated writer on the checkout by the cap's own
definition; counting it and widening the count says the same thing honestly, and
keeps the refusal available when a workspace really is full.
