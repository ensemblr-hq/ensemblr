# 0084. See an Unattended Pull Request Through Its Checks

Date: 2026-10-05

## Status

Accepted

Amends [0061](./0061-run-an-unattended-change-through-plan-review-and-a-pull-request.md),
whose loop ended when the pull request was opened. The five existing steps, the
short-path sizing from [0064](./0064-size-the-unattended-delivery-loop-to-the-change.md),
and the review-delegation choice from
[0068](./0068-let-afk-agents-choose-review-delegation.md) are unchanged; this
adds a sixth step after them.

## Context

The delivery loop stopped at step 5: commit, push, open the pull request, bring
the Checks panel forward, write the report. Everything that happens to a pull
request after it opens therefore happened to nobody. CI ran the suites the agent
had already run locally and sometimes disagreed with them: a platform leg the
host does not have, a job with a secret the workspace does not carry, a check
the repository runs only in CI. Review tools such as CodeRabbit posted findings
a few minutes later. The user came back to a report that said the change was
done and a Checks panel that said otherwise. Then they had to brief a new
conversation to read the failures the old one could have fixed while it still
held the whole change in its context.

That is the failure AFK exists to prevent. The loop's own premise is that
nobody is there to read what comes back, so the agent has to. Stopping at the
open pull request left the most mechanical part of the work, reading a red
check and fixing it, to the person who had handed the machine over.

## Decision

Add `WATCH` to `src/shared/agent-control/afk-workflow.ts` as step 6, rendered
after `SHIP` and before `REPORT`.

### What the agent does

- **Watch every check until it settles**, with `gh pr checks --watch`. `gh` is
  already how Ensemblr talks to GitHub (it stores no token of its own), and
  every agent's shell has it. The watch's non-zero exit is named as a failed
  check rather than a crash, and a watch a capped shell tool cut off is a lap to
  run again. That is the same framing the compute queue uses for `timedOut`.
- **Treat a failed check as a step-4 finding.** Read the log
  (`gh run view <run-id> --log-failed`), fix the cause, run the repository's
  checks, and push the fix as a new commit. Never amend, rebase, or force-push
  while the pull request is open. Review tools anchor their comments to commits,
  and rewriting the branch marks the threads the user will read as outdated.
- **Read reviews and line comments once the checks settle**, and again after
  every push and before the report. Bots post on their own schedule, and some
  without any check that would hold the watch open. Every comment, a bot's or a
  person's, is judged as step 4 judges a finding. Line comments are read with
  `gh api --paginate`, because a review bot on a large diff leaves more than one
  page of them.

### What it does not do

- **It does not reply to, resolve, or dismiss review threads.** Posting on the
  pull request is a new outward-facing act the AFK block withholds by default,
  and resolving is the GitHub counterpart of the in-app rule that only a fixed
  comment is resolved. An open thread is the user's record that a finding still
  stands. A disagreement is theirs to settle, so the agent argues it in its
  report.
- **It does not fix red it did not cause.** Where the log points at a flaky
  test or a runner or network outage, the failed jobs get one
  `gh run rerun --failed`. A missing secret, an already-failing base, or a flake
  that fails again gets a line in the report. A merge conflict
  or a required update from the base is named as *not base-sync consent*, so the
  watch does not become a back door around the Git isolation rules.
- **It does not watch forever.** A check that never starts, because it waits on
  an approval, a label, or a runner, is reported as pending once nothing in the
  rollup has moved for half an hour. The watch rounds follow the loop's own stop
  rules. A settled round with nothing new to fix ends it, whether its checks are
  green or red only where the red is not the agent's. So does a repeated
  finding. Rounds circling one class of failure send the agent back to step 1,
  and the rebuilt change goes to the same pull request.
- **It never closes the pull request.** Checks still red when the watch ends
  leave it open with the reason in the report, as step 5 already forbids
  closing or reopening anything.

### Where it applies

Both delegation mechanisms render it identically, because watching a pull
request is a fact about the pull request and not about how the session spawns.
The short path runs it too: a docs change still has CI. Sub-agents never see
it, since their body already places the pull request above them. The report's
required contents gain what the checks and reviewers said, what was pushed in
answer, and what is still red or unanswered.

## Consequences

An unattended run now ends when the pull request is green or honestly stuck,
not when it exists. A report that says the change is done now agrees with the
Checks panel the user lands on.

The run is longer by however long CI and the review bots take, and that time is
spent in the orchestrator's turn. Most of it is spent blocked on a shell
command rather than on reading, so the context cost is the failure logs and
comments themselves. Those are exactly what the user would otherwise have
paid a fresh conversation to read.

Pushes after the pull request opens are new commits, so a run that needed three
CI fixes shows three commits. That is the honest history of what CI caught, and
squash-merging is still the user's call.

The block grows by five paragraphs, read on every AFK turn. 0064 accepted the
same trade for the sizing gate, on the same grounds: the scope gate above it
can only be evaluated by reading past it, and the alternative is a step the
user has to do by hand every time.

## Alternatives Considered

**Fold the watch into step 5.** Rejected. Step 5 carries the run's authority
limits: open, never merge, never force-push, not base-sync consent. The watch
is a loop of its own with its own bounds and its own report lines. Keeping it
a separate step keeps the order testable and keeps step 5's limits readable.

**An agent-control op that serves check state from the app's own pull-request
snapshot** (`src/main/github/pr-snapshot.ts`), with a blocking wait like
`ensemblr_wait_for_job`. Deferred, not rejected. The snapshot already carries
the check rollup, the reviews, and the review-thread comments with bot authors
tagged. An op over it would let an agent block without knowing `gh`, and it
would read the same cache the Checks panel reads. But it is a new port, schema,
MCP tool, and Pi-extension surface for information `gh` already gives every
agent, and this change was asked for as a playbook change. If watching through
`gh` proves costly or unreliable in practice, that op is the next step, and this
step's prose would name it in place of `gh`.

**Reply to review bots to argue a finding.** Rejected for an unattended run.
Some bots learn from replies, but a reply is published text the user did not
ask for. A finding the agent disagrees with is the same decision 0061 already
puts in the report.

**Re-run failed jobs until green.** Rejected. Repeated re-runs hide a real
intermittent failure behind a green tick. One re-run where the log points at
flake is the usual first move, and anything past it is information for the
user.
