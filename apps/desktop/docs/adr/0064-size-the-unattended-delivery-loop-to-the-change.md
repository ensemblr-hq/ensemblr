# 0064. Size the Unattended Delivery Loop to the Change

Date: 2026-09-07

## Status

Accepted

Amends [0061](./0061-run-an-unattended-change-through-plan-review-and-a-pull-request.md),
which made the loop mandatory for every turn that changes code. The five steps,
their order, the cycle bound, and the delegation posture are all unchanged; what
changes is which of them a given change has to run.

## Context

0061 gated the loop on one question: is this turn a change to the codebase this
workspace's branch would carry? That gate is the right one for the failure it was
written against — an AFK chat asked what a module does must not come back with a
pull request — and it is one axis short of what the loop actually needs.

Everything on the far side of it takes the whole apparatus. A documentation edit
clears the gate. So does a version bump, a locale fill, a rename, a typo in a
label. Each of those then gets a written plan with a rejected alternative, a
second orchestrator opened over the diff with a delegation budget of its own, and
however many fix rounds the cycle judges it has earned — to arrive at a change
the agent could have established was right by reading its own diff.

The cost is not only wall-clock, though an unattended run is the one place where
wall-clock is nearly free. Three things are actually spent:

- **The orchestrator's context**, which is the run's real budget. 0061 is
  explicit that the run ends when the window fills rather than when the work
  does. A plan, a review hand-off, and two fix rounds over a docs edit are all
  turns in that window.
- **A co-tenancy slot**, for as long as the reviewer stays open.
  [0063](./0063-open-an-agent-requested-review-as-a-peer-again.md) widened the
  unattended cap to four to stop the loop being refused, and a reviewer seated
  over a one-file docs change is holding a slot the next real change wants.
- **The user's attention on return.** A report describing three review rounds
  over a paragraph of prose reads as though something was difficult. Ceremony
  applied uniformly stops carrying information about the work.

There is also a legibility failure that is easy to miss. The loop's own stop
conditions are about *convergence* — a round that finds nothing, a round that
repeats itself, rounds circling one problem. A change that was never in doubt
converges on round one every time, so the loop reports success in exactly the
shape it reports success for a hard change, and the difference between the two is
not visible anywhere.

## Decision

Add a second gate, on a different axis from 0061's, ahead of the steps. 0061's
asks whether the turn is a change; this one asks how much of the loop that change
has earned. It renders as `RIGHT_SIZE` in
`src/shared/agent-control/afk-workflow.ts`, between the scope gate and the
delegation premise.

### The criterion is evidence, not size

A change takes the **short path** when all three hold:

1. The whole diff fits in one reading of the agent's own.
2. Its correctness is settled by that reading plus whatever the repository uses
   to check a change, rather than by behaviour that has to be reasoned about to
   be seen.
3. The shape was decided before the agent started — the user named it, or the
   repository leaves one way to do it.

Deliberately not a list of small-looking task types, and deliberately not a line
count. A one-word label change is short; a fifty-line feature that happens to
live in one file is not. Both would be sorted the wrong way by a size heuristic,
and the thing that actually distinguishes them is whether the agent can settle
correctness alone — which is precisely what the second reader supplies and what
the plan protects. Examples are given on both sides, because the three conditions
are checkable and the examples are what make them recognizable.

### The examples stop where 0061's gate already answered

0061's gate routes "a one-line correction the user asked for by name" *out* of
the loop — answer it directly, open nothing. That is a different answer from the
short path's, which ends in a pull request, so the short-path examples must not
name it: an agent handed "fix the typo in that label" would read two adjacent
paragraphs ordering opposite things, and neither the tie-break nor the escalation
clause arbitrates it. Both are about which path a change *inside* the loop takes,
and this disagreement is about whether it is inside at all.

The boundary is therefore that the sizing gate never widens the set of tasks
0061's gate admits — it only subdivides it. Condition 3 still reads "the user
named it", because a shape the user fixed is genuinely one the agent did not have
to design; what it may not do is re-admit a task the gate above already sent out.
`tests/shared/afk-workflow.test.ts` asserts the phrase is claimed once in the
rendered block rather than twice.

### The short path drops steps 1, 3, and 4, and nothing else

No written plan, no second reader, no fix rounds. Step 2 and step 5 both run:
the change is built, the repository's checks are run, and the work is committed,
pushed, and opened as a pull request exactly as before. Three seams in the
existing steps move to admit the second entry:

- Step 5 opened on "once the loop has ended clean", which a short-path change
  never entered.
- Step 5's *withholding* clause opened the same way — "if the loop ended with
  real problems still standing, do not open the pull request". It is the only
  thing that stops a change with real problems in it being pushed, so leaving it
  loop-shaped would have left the short path with no such condition at all. The
  escalation clause does not cover the case: it fires on a diff outgrowing one
  reading, an *unpredicted* check failure, or a repair needing a design call, and
  a foreseen problem the self-read cannot settle is none of those.
- The report's list of what it must carry now names which path the change was
  sized onto. Not cosmetic — a short-path run reports one build and no rounds,
  which is exactly what a full-loop run that converged on the first round also
  reports, so the path is the only thing that distinguishes them.

What replaces the second reader is a named obligation rather than an omission —
the agent reads the diff it produced from the top, as though somebody else wrote
it. The block says in as many words that this reading is not a formality, and
names what it is for: a claim the code no longer supports, a path that does not
exist, a value left unfilled. Trading a reviewer for the author's own reading is
a real trade; trading it for nothing would be shipping something nobody read.

### Two asymmetries hold the gate in place

**The tie goes to the full loop.** A change the agent cannot place is on the full
loop. Without this, a model with an incentive to finish decides every ambiguous
case in favour of the cheaper path, and the gate becomes a way out of the loop
rather than a way of sizing it.

**The judgement only moves upward.** A run that discovers mid-build that it
guessed wrong — the diff outgrew one reading, a check failed for an unpredicted
reason, a repair needed a design call — says so and picks the loop up at step 1.
A run already inside the full loop never drops out of it, because by then a
reviewer is already reading and abandoning it wastes the read rather than saving
it.

### Sub-agents read no sizing gate

`SUBAGENT_BODY` is unchanged. A child never runs the loop, so it has nothing to
size, and the short path ends in a pull request its own body forbids. Asserted
rather than assumed, in `tests/shared/afk-workflow.test.ts`.

### Both mechanisms size identically

Which steps a change earns is a fact about the change, not about how the session
spawns, so `RIGHT_SIZE` carries no `ensemblr` / `native` split and no harness
clause. It is the only block in the file below the scope gate that does not vary.

## Consequences

A docs change under AFK now costs one plan-free build, one checks run, one
self-read, and a pull request — where it previously cost a plan turn, a review
hand-off, a wait, at least one fix round, and a re-review. On a small-window
model that is the difference between a run that finishes its queue and one that
fills up part-way.

The gate is judgement exercised by the model, and it will occasionally be wrong.
The two asymmetries bound the damage in one direction only: a change wrongly
placed on the full loop costs time nobody is waiting on, and a change wrongly
placed on the short path is caught by the escalation clause the moment a check
fails or the diff grows — but a change that stays wrongly short and stays green
ships with one reader instead of two. That is the residual risk, and it is priced
against a second reader that was previously spent on every typo.

Reports become informative about difficulty again: a run that says it took the
short path is telling the user the change was never in doubt, which the previous
uniform three-round account could not.

The block grows by four paragraphs, read on every AFK turn. That is real prompt
cost, paid on questions and investigations too, since the scope gate above it can
only be evaluated by reading past it. It is bought back many times over on the
first short-path change, and the block is still the shortest place the rule can
live — a per-repository setting would need every repository to configure it, and
the agent is the only party that has seen the diff.

## Alternatives Considered

**A round cap for small changes.** Rejected for the reason 0061 rejected a cap
generally: it prices ceremony in rounds when the cost is the plan and the review
hand-off, both of which happen before round one.

**A user-facing toggle — "light AFK".** Rejected. It asks the user to classify
the task before the agent has read it, which is the one moment they know least,
and AFK is turned on to stop having to make calls like that.

**Letting the agent skip the review only.** Rejected as the wrong half. The plan
is the more expensive step in context terms and the one that most obviously does
not apply to a change whose shape was already decided; a rule that dropped the
review and kept the plan would produce a written approach for a version bump.

**Deriving it from the diff after the fact — small diff, short path.** Rejected:
the decision has to be made before step 1, because the plan is step 1. Anything
measured on the finished diff arrives after the cost it was meant to avoid.
