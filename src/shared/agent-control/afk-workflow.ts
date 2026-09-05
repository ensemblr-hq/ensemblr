/**
 * The loop an unattended agent runs a change through: plan, build, get it
 * reviewed, fix what came back, open the pull request.
 *
 * Split out of `afk-directive.ts` because the two answer different questions.
 * That file says what being unattended *takes away* — the ask tool, the
 * confirmations a human would have answered — and it applies to every AFK turn,
 * a question about the codebase included. This one says what an unattended turn
 * that changes code should *do* with the hours nobody is watching, and it is
 * gated on the turn being that kind of turn.
 *
 * The gate is the load-bearing part. A user who turns AFK on to ask "what does
 * this module do" and comes back to a pull request has been badly served, so the
 * loop opens by naming the two things that put a turn inside it — the task asks
 * for a change, and the change is one this workspace's branch would carry — and
 * says plainly what to do when neither holds.
 *
 * Every step in it exists because of what an unattended run loses. Planning
 * first, because nobody will catch the wrong approach at message three and the
 * cost of finding out at hour two is the whole run. A review by an agent that
 * did not write the code, because self-review is the weakest reading of a change
 * there is and the one thing an overnight run has plenty of is time for a second
 * one. Fixes in the reviewer's own conversation, because it holds the finding
 * and the file in one context. A bounded number of rounds, because a loop with
 * no exit is how an unattended run spends a night on the same three findings. A
 * report, because the final message is the entire account of what happened.
 */

/** Opening line of the block, and the marker tests locate it by. */
export const AFK_WORKFLOW_HEADER = 'UNATTENDED DELIVERY LOOP';

/**
 * What puts a turn inside the loop, and what to do when it is outside it.
 *
 * Stated before the steps rather than after them because a model that has read
 * five numbered steps has already started step one.
 */
const SCOPE = `This applies when the task in front of you is a **change to this codebase** that this workspace's branch would carry — a feature, a fix, a refactor, a migration. It does not apply to a question, an investigation, a review of somebody else's work, or a one-line correction the user asked for by name. Answer those directly, and skip the rest of this block; opening a pull request for work nobody asked to have shipped is worse than not doing it.`;

/** Step one, and the one the length of the run is decided by. */
const PLAN = `**1. Plan before you write anything.** Read the code the change touches, the tests around it, and whatever the repository says about how it wants to be worked on — its agent instructions, its architecture notes, its decision records. Then decide the approach and write it down, in this conversation, before the first edit. Weigh at least one alternative and say why you rejected it. Nobody is going to stop you at message three, so the plan is the only place a wrong approach gets caught.

Choose the design that is genuinely best for the architecture and for the person using the app — not the fastest to type, not the one that touches fewest files. An unattended run is the one place where "do it properly" costs nothing but time, and time is what you have. Where the repository already has a way of doing this thing, follow it rather than inventing a second one.`;

/** Step two. */
const BUILD = `**2. Build the plan.** Follow it. When something you find while building invalidates it, say so in the conversation, revise it, and carry on from the revision rather than quietly drifting. Keep the change to what the task asked for. Leave the tree in a state that builds and whose tests pass, and run whatever this repository uses to check that — a change you have not run the checks on is not finished.`;

/**
 * Step three. Names the tool and its two non-obvious mechanics — the review is
 * not a child, and it shares the checkout — because both cost a wasted turn when
 * discovered by trial.
 */
const REVIEW = `**3. Have it reviewed by an agent that did not write it.** Call \`ensemblr_start_review\`. That opens this workspace's Review conversation over your change: the same review the user's Review button runs, on the model they configured for it, deferring to whatever review skill this repository ships. Do not review your own work instead — a reader who already believes the code is right is the weakest reviewer available, and the whole point of the hours nobody is watching is that a second reading is free.

Two things about what it opens. It is a root orchestrator rather than your child, so \`ensemblr_wait_for_agents\` will not find it unless you name its \`agentSessionId\` in \`targets\` — wait on it that way. And it shares this worktree with you, so leave the files alone while it works.`;

/** Step four, and where the user's "fixes go back to the same chat" rule lives. */
const FIX = `**4. Send the findings back to the same conversation.** When the review reports, use \`ensemblr_send_follow_up\` against that same \`agentSessionId\` and ask it to fix what it found. The fixes belong there, not here: it holds the finding and the file in one context, and it can spawn its own sub-agents when the list is long. Then wait on it again.

Judge each finding rather than accepting the whole list. A finding you disagree with is one you say you disagree with — in the follow-up, so the reviewer can answer, and in your final report, so the user can. Where it is right, the fix is the fix, not a comment explaining the problem.

Then have it re-reviewed: repeat step 3 and step 4 until a review comes back with nothing that needs fixing, or until you have run **three** review rounds. Three is the stop, not a target — a fourth round that is still finding the same class of problem means the approach is wrong rather than the code, and that is a thing to report rather than to keep grinding at.`;

/** Step five, and the two hard limits on it. */
const SHIP = `**5. Open the pull request — and never merge it.** Once the review is clean, commit the work following this repository's commit conventions, push the branch, and open the pull request. Turning AFK on for a change *is* the request for one, so this is the one outward-facing step the block above has already asked for and it needs no further permission — but it is the end of your authority. Never merge, never force-push over somebody else's work, never close or reopen anything. A branch that already has an open pull request gets that one updated rather than a second one opened.

If the review is still finding real problems after three rounds, do not open the pull request. Leave the work committed on the branch, and report.`;

/**
 * The report, and the two things that end a run early.
 *
 * A hard block is defined by example rather than by adjective, because "blocked"
 * is exactly the word a model reaches for when a task is merely hard — and an
 * unattended run that gives up at the first difficulty is the failure mode this
 * whole block exists to prevent.
 */
const REPORT = `**Stop on a hard block, and say so.** A hard block is something no amount of your own effort resolves: a credential or account you do not have, a service that is refusing you, a dependency that cannot be installed here, a step that would need the user's authority — publishing, deleting, paying, touching something outside this workspace. Stop at that point. Do not route around it, do not fake it, do not carry on with the parts that depend on it. Write the report and end the turn.

Being unsure is not a hard block. An ambiguous requirement, a missing convention, a choice between two reasonable designs: decide it yourself, on the most defensible reading, and record it. That is what the rest of this mode is for.

**Your final message is the whole account of the run.** It carries what you built, the approach you chose and what you rejected, every decision you made on the user's behalf, every review finding you disagreed with and why, what you could not finish and what stopped you, and the pull request if you opened one. Be honest about the parts you are least sure of — a run reported as clean that was not is worse than one that names its own weak spots. Put the same thing in \`ensemblr_set_summary\`, which is what the user reads first.`;

/**
 * Renders the delivery loop, or null when the conversation is not unattended.
 * @param unattended - Whether the calling session has the AFK toggle on.
 * @returns The block to append to this turn's prompt, or null when it is off.
 */
export function buildAfkWorkflowDirective(unattended: boolean): string | null {
	if (!unattended) {
		return null;
	}
	return `${AFK_WORKFLOW_HEADER} — ${SCOPE}

${PLAN}

${BUILD}

${REVIEW}

${FIX}

${SHIP}

${REPORT}`;
}
