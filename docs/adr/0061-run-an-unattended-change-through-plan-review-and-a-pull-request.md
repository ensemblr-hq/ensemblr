# 0061. Run an Unattended Change Through Plan, Review, and a Pull Request

Date: 2026-09-05

## Status

Accepted

Extends [0060](./0060-let-a-chat-run-unattended.md), which built AFK Mode as the
premise that nobody is watching. That ADR closed the three surfaces that park a
turn on an absent human; this one says what the hours it freed should be spent
on. It also settles the question 0060 left open by name — "a future op that adds
a blocking prompt has to decide which side it falls on, and 'AFK approves it' is
not the automatic answer" — for the first op to ask it.

## Context

AFK Mode keeps an unattended turn moving. It does not say what a good unattended
turn looks like, and the gap shows in three places, all of which cost the user
the run rather than a message:

1. **Nobody catches the wrong approach at message three.** An attended chat
   self-corrects constantly: the user reads the first edit and says "not like
   that". Unattended, the first correction opportunity is the final report, hours
   later, by which point the wrong approach is the whole change.
2. **The only reader is the author.** An agent reviewing its own diff is the
   weakest reading of a change available — it already believes the code is right,
   and it re-reads its own intent rather than the text. The one thing an
   overnight run has in surplus is time for a second, independent reading, and
   nothing was spending it.
3. **The work stops at the working tree.** The user comes back to an uncommitted
   diff and a report, and does the packaging themselves — which is the part they
   were least likely to want to be woken up for.

The app already has the answer to (2) sitting in the toolbar. The **Review
button** opens a fresh chat over the workspace's change, running the repository's
own review skill when it ships one, carrying the user's per-repository review
instructions, on the model they configured for reviews. It is renderer-only: an
agent cannot press it.

## Decision

**A delivery loop in the AFK preamble, and a control op that opens the app's own
Review conversation so the loop has something to call.**

### `ensemblr_start_review` opens a root orchestrator

The op composes the review prompt, opens a conversation over the caller's
workspace, and hands back the session to wait on. Three decisions inside it:

**It is a root orchestrator, not a sub-agent.** A review of a fifty-file change
is itself delegable work, and a reviewer that cannot spawn its own readers reads
that diff in one pass or not at all. It therefore records no `parentSessionId`,
which has consequences the result message spells out rather than leaving to be
discovered: it is absent from the children `waitForAgents` defaults to and has to
be named in `targets`, and it outlives the turn that opened it.

**Fixes go back to the same conversation.** The reviewer that found a problem
holds the finding and the file in one context, and it can delegate the repair the
same way it delegated the reading. The caller sends the findings back with
`sendFollowUp` and waits again. It stays the committer — the reviewer is told not
to commit, rebase, move HEAD, or touch a pull request — so one agent reconciles
the branch and one agent owns the PR.

**It costs a co-tenancy slot, and raises no confirmation.** It is a second writer
on one checkout for exactly the reason a peer orchestrator is, so it takes one of
the two `PEER_ORCHESTRATOR_LIMITS` slots and answers a full workspace with the
same refusal. What it does *not* inherit from `gatePeerSpawn` is the dialog, or
the AFK refusal behind it. That gate exists because "the user asked for a second
writer" is not something a model can establish about its own prompt — so a dialog
establishes it. Here there is nothing to establish: this is the Review action the
user already has a button for, composed from their own settings, on their own
review model. Asking them to confirm their own review would be gating the wrong
thing, and refusing it overnight would withhold the second reader from the run
that most needs one. **This is the carve-out 0060 said would have to be argued
rather than assumed.**

### The prompt is composed by a window, and by main when none answers

Two of the three inputs that make this *the user's* review live only in the
renderer: the personal per-repository review instructions are still
`localStorage`, and the review model and thinking level are preference atoms. So
main broadcasts a request and a window composes the prompt through the same
`composeActionPrompt` path the button uses, persisting the same `.context/`
attachment — an agent-opened review and a clicked one are the same review.

The wait is bounded at four seconds and expiring is not a failure. No human is in
this loop, so a window either answers within a frame or is not there, and an
agent's turn must not park on a renderer that is reloading. When none answers,
main composes the brief itself from `shared/review-brief` — the same template,
the same context sections, the repository's committed `[prompts]` preference —
and the result message tells the calling agent that the user's own instructions
and model pin did not reach it, so a weaker review is reported rather than passed
off as the configured one.

Extracting that template into `src/shared/review-brief/` is what makes the
fallback a trimmed version of one prompt rather than a second prompt, and a
parity test holds the two composition paths to byte-identical output.

### The loop is a second block, gated on the turn changing code

`buildAfkWorkflowDirective` rides the same per-turn channel as
`buildAfkDirective` and is deliberately not folded into it. The existing block
applies to every AFK turn — a question about the codebase included — while the
loop applies only to a turn that changes code, and one block would put "open a
pull request" in front of an agent that was asked to explain a function. The gate
is the first thing the block says.

The five steps and why each is there:

1. **Plan first, in writing, with an alternative weighed.** The only place a
   wrong approach gets caught.
2. **Build it, and revise the plan out loud when it stops being right.**
3. **Have it reviewed by an agent that did not write it**, via the op above.
4. **Send the findings back to the reviewer**, judging rather than accepting each
   one, for at most **three** rounds. A loop with no exit is how an unattended
   run spends a night on the same three findings; a fourth round still finding
   the same class of problem means the approach is wrong rather than the code,
   which is a thing to report.
5. **Open the pull request, and never merge it.**

Step 5 resolves a standing conflict rather than ignoring one. This repository's
own `AGENTS.md` says never to open a pull request unless the user asked in the
current task; the block states that turning AFK on for a change *is* that
request, and stops there — no merging, no force-pushing over other work, no
closing or reopening. A branch that already has an open PR gets that one updated.

**A hard block stops the run.** Defined by example rather than by adjective — a
credential the agent does not have, a service refusing it, a step needing the
user's authority — because "blocked" is the word a model reaches for when a task
is merely hard, and an unattended run that gives up at the first difficulty is
the failure this whole mode exists to prevent. Being unsure is explicitly not a
hard block: that is what 0060's "decide it yourself" is for.

## Consequences

**An overnight change arrives reviewed and packaged.** The user comes back to a
pull request, a report naming every decision made on their behalf, and the review
conversation in a tab they can read.

**The Review button now has two callers, and the prompt is a cross-process
contract.** `src/shared/review-brief.ts` is the single copy; a change to the
review wording has to go through it, and the parity test fails if the renderer's
generic composition drifts from it.

**Two agents can now write one checkout without the user asking.** Bounded by the
same cap as a peer, and serialized by the loop — the caller waits rather than
working alongside — but the serialization is a contract in the directive rather
than a lock, exactly as it is for a peer.

**A root delegating through its own runtime does not get the op.** Driving the
review needs `sendFollowUp` and `waitForAgents`, and that role holds neither, so
`startReview` joins them in `NATIVE_DELEGATION_WITHHELD_OPS` and its playbook
says so. A review it could open but neither wait on nor steer would be worse than
none.

**The personal review preference being `localStorage` is now load-bearing.** It
is the reason main has to ask a window at all. Moving the per-action preferences
to repository-scoped SQLite — where the git, files-to-copy, and preview-URL
overrides already went — would let main compose the whole brief alone and delete
the round trip. That is a settings migration and its own change.

**The per-turn preamble grew again.** 0060 already noted the list was long enough
that the next addition should be weighed against folding two together. This one
was weighed and kept separate for the reason above — the gate differs — but the
channel now carries eight blocks, and the next addition should be a merge.
