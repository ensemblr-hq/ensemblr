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
 * and the file in one context. A report, because the final message is the entire
 * account of what happened.
 *
 * Two things the block is shaped by that the steps do not say on their own.
 *
 * The first is context. An unattended run ends when the orchestrator's context
 * window runs out, not when the work does, and nobody is there to start it
 * again — so the block asks for the reading to be spent out of a sub-agent's
 * window rather than the orchestrator's, and says so *before* step 1, because
 * planning is where the first wide reads happen. It has to override the role
 * playbook's "delegate only for two or more substantial parallel workstreams"
 * in as many words: that default is written for a chat somebody is watching,
 * and an agent holding both instructions with nothing saying which governs picks
 * one by guess.
 *
 * The second is that the core is a cycle rather than a line. Steps 1 to 4 run as
 * many times as the agent judges they earn, bounded by whether a round changed
 * anything rather than by a count — a fixed cap either cuts off a run that was
 * still converging or licenses rounds that were not paying for themselves, and
 * the agent is the only party in the loop that can tell those apart. Re-entering
 * at step 1 walks back through step 3, so the cycle carries the same mechanism
 * split step 3 does: one of the two mechanisms already has a reviewer open.
 */

import type { AgentControlRole } from './awareness.ts';
import type { SubagentMechanism } from './subagent-mechanism.ts';

/** Opening line of the block, and the marker tests locate it by. */
export const AFK_WORKFLOW_HEADER = 'UNATTENDED DELIVERY LOOP';

/**
 * What puts a turn inside the loop, and what to do when it is outside it.
 *
 * Stated before the steps rather than after them because a model that has read
 * five numbered steps has already started step one.
 *
 * The second gate covers the agents this block reaches by inheritance rather
 * than by being asked for. A review opened by `startReview` and a peer opened by
 * `startConversation` both inherit the caller's AFK mode, so both read this
 * block on every turn — and the turn where one is asked to fix what it found is
 * a change to the codebase by the first gate's own definition. Without the
 * second gate that turn ends in a commit and a pull request from an agent whose
 * opening brief forbids both, racing the orchestrator that owns them. Written as
 * scope prose rather than enforced by role because a harness launched into the
 * same checkout is in exactly the same position and holds no role the app can
 * read.
 */
const SCOPE = `This applies when the task in front of you is a **change to this codebase** that this workspace's branch would carry — a feature, a fix, a refactor, a migration. It does not apply to a question, an investigation, a review of somebody else's work, or a one-line correction the user asked for by name. Answer those directly, and skip the rest of this block; opening a pull request for work nobody asked to have shipped is worse than not doing it.

It also does not apply when this conversation's own opening brief named another orchestrator in this workspace as the committer — as it does for a reviewer, and for a peer opened to take half the work. That brief wins outright over every step below, including on a follow-up asking you to fix what you found: make the change, leave it in the working tree, and say what you touched. Committing, pushing, or opening a pull request from there would move HEAD underneath the agent already doing those things for both of you.`;

/**
 * Why an unattended run delegates more than an attended one, and what it must
 * not delegate.
 *
 * Placed ahead of step 1 because the survey a plan needs is the single largest
 * read of the run, and an orchestrator that has already done it here cannot
 * un-spend the window. The last paragraph names the two halves — reading out,
 * decisions in — because a model told only "delegate more" fans the *writing*
 * out too, and a change authored by four agents at once is one nobody can hold.
 */
const DELEGATE_PREMISE = `**Spend a sub-agent's context before you spend your own.** An unattended run ends when your context window runs out, not when the work does, and nobody is here to restart you — so what you have left is the real budget for every step below. A child's window is a separate one and costs you only what it reports back: a sub-agent that opens twenty files and answers in six lines with paths costs you six lines, where the same reading done here costs you those twenty files for the rest of the run.

Your role playbook says to do the work yourself and delegate only when the task splits into two or more substantial workstreams that can run in parallel. That default is written for a chat somebody is watching, and here it is narrower than it should be. Read it as: delegate whenever a unit of work would fill your context with material you will not need again, whether or not anything else runs beside it. One child, spawned for that reason alone, is a correct use of the mechanism — and the smaller your context window, the earlier that stops being optional.

Hand over the reading, keep the deciding. Worth handing over: the survey of a subsystem you do not know yet, before you plan; the triage of a failing suite or a long build log; a sweep confirming a fix landed everywhere it had to; an edit that is the same mechanical change in many files. Not worth handing over: the plan, the design calls, the load-bearing edits, and the reconciliation of what comes back. The shape of the change is the part you cannot delegate, and a diff written by four agents at once is one nobody can hold.`;

/**
 * The Ensemblr-mechanism half of the delegation block: the ops, and the two
 * habits that stop a fan-out costing more context than it saves — briefing with
 * what you already hold, and not reading a whole report to use one line of it.
 */
const DELEGATE_MECHANICS_ENSEMBLR = `Pay for a hand-off once. Quote into each brief the paths and facts you already have, or the child re-derives them and you have bought the same read twice; say what to deliver rather than what to look at; ask for findings with full paths rather than a narrative. Spawn with \`ensemblr_start_conversation\`, one child per unit of work, then block on \`ensemblr_wait_for_agents\` — and pass \`reports: "brief"\` when several land at once, so four full reports do not arrive to be mined for one line each. Verify a load-bearing claim against the file yourself before you build on it.`;

/**
 * The same half for a root delegating through its own runtime. It states the
 * absence of the chat-tab ops rather than leaving it to be discovered, because
 * this block is read on every turn while the playbook that says so was read once
 * at session open.
 */
const DELEGATE_MECHANICS_NATIVE = `Pay for a hand-off once. Delegation here runs through your own runtime's sub-agent tool — Ensemblr's chat-tab spawn ops are absent from your list rather than discouraged, so do not go hunting for them. Quote into each brief the paths and facts you already have, or the child re-derives them and you have bought the same read twice; say what to deliver rather than what to look at; ask for findings with full paths rather than a narrative. Verify a load-bearing claim against the file yourself before you build on it.`;

/** Step one, and the one the length of the run is decided by. */
const PLAN = `**1. Plan before you write anything.** Read the code the change touches, the tests around it, and whatever the repository says about how it wants to be worked on — its agent instructions, its architecture notes, its decision records. Where that reading is wide, send a child to do it and plan from what it reports. Then decide the approach and write it down, in this conversation, before the first edit. Weigh at least one alternative and say why you rejected it. Nobody is going to stop you at message three, so the plan is the only place a wrong approach gets caught.

Choose the design that is genuinely best for the architecture and for the person using the app — not the fastest to type, not the one that touches fewest files. An unattended run is the one place where "do it properly" costs nothing but time, and time is what you have. Where the repository already has a way of doing this thing, follow it rather than inventing a second one.`;

/** Step two. */
const BUILD = `**2. Build the plan.** Follow it. When something you find while building invalidates it, say so in the conversation, revise it, and carry on from the revision rather than quietly drifting. Keep the change to what the task asked for. Leave the tree in a state that builds and whose tests pass, and run whatever this repository uses to check that — a change you have not run the checks on is not finished.`;

/**
 * Step three for the Ensemblr mechanism. Names the tool and its two non-obvious
 * mechanics — the review is not a child, and it shares the checkout — because
 * both cost a wasted turn when discovered by trial.
 */
const REVIEW_ENSEMBLR = `**3. Have it reviewed by an agent that did not write it.** Call \`ensemblr_start_review\`. That opens this workspace's Review conversation over your change: the same review the user's Review button runs, on the model they configured for it, deferring to whatever review skill this repository ships. Do not review your own work instead — a reader who already believes the code is right is the weakest reviewer available, and the whole point of the hours nobody is watching is that a second reading is free. It reads the diff so you do not have to, which is the largest single saving of context in the loop.

Two things about what it opens. It is a root orchestrator rather than your child, so \`ensemblr_wait_for_agents\` will not find it unless you name its \`agentSessionId\` in \`targets\` — wait on it that way. And it shares this worktree with you, so leave the files alone while it works.`;

/**
 * Step three for a root delegating through its own runtime, which does not hold
 * `startReview` — driving the conversation it opens needs the spawn ops that
 * role is withheld. Without this variant the block orders a tool that is absent
 * from the list, and the agent spends a turn of an unattended run finding out.
 */
const REVIEW_NATIVE = `**3. Have it reviewed by an agent that did not write it.** \`ensemblr_start_review\` is absent from your tool list, because driving the conversation it opens would take the spawn ops this session withholds — so your second reader is a sub-agent of your own. Do not review your own work instead: a reader who already believes the code is right is the weakest reviewer available, and the whole point of the hours nobody is watching is that a second reading is free. It also reads the diff so you do not have to, which is the largest single saving of context in the loop.

Brief it as a reviewer rather than as a helper, or it comes back with prose you cannot act on: the diff to read (\`git diff\` against this branch's base), the repository's own review skill or review instructions where it ships them, and a report of ranked findings carrying full paths and line numbers, with anything it is unsure of marked as such. Where the diff is wide, brief one reader per slice of it rather than one over all of it.`;

/**
 * Step four for the Ensemblr mechanism, and where the user's "fixes go back to
 * the same chat" rule lives. The co-tenancy sentence is here rather than in the
 * iteration block because it is what makes re-review a follow-up rather than a
 * second `startReview` — which would be refused.
 */
const FIX_ENSEMBLR = `**4. Send the findings back to the same conversation.** When the review reports, use \`ensemblr_send_follow_up\` against that same \`agentSessionId\` and ask it to fix what it found. The fixes belong there, not here: it holds the finding and the file in one context, it can spawn its own sub-agents when the list is long, and every repair made there is one that never enters your window. Then wait on it again.

Judge each finding rather than accepting the whole list. A finding you disagree with is one you say you disagree with — in the follow-up, so the reviewer can answer, and in your final report, so the user can. Where it is right, the fix is the fix, not a comment explaining the problem.

Then ask that same conversation to re-review what it changed. Keep every round in the one conversation: it holds a co-tenancy slot for as long as it is open, so a second \`ensemblr_start_review\` is refused rather than opening a fresh reviewer.`;

/**
 * Step four for a root delegating through its own runtime. A child ends with its
 * report and cannot be followed up, so the re-read is a fresh child rather than
 * a second message — the one mechanic that genuinely differs between the two.
 */
const FIX_NATIVE = `**4. Fix what the review found, and have it read again.** Judge each finding rather than accepting the whole list. A finding you disagree with is one you say you disagree with — in your final report, so the user can answer it. Where it is right, the fix is the fix, not a comment explaining the problem.

Make the repairs here, or hand a mechanical one to a child of its own. Then spawn a fresh reviewer over what changed: a sub-agent ends with its report and cannot be followed up, so a second reading is a second child, briefed with the findings it is checking and the files they moved.`;

/**
 * How the Ensemblr mechanism gets the *rebuilt* change read again.
 *
 * The re-plan re-entry walks back through step 3, which on this mechanism says
 * to call `startReview` — and the reviewer opened on the first pass is still
 * holding the workspace's second co-tenancy slot, so that call is refused. Step
 * 4 carries the same fact for an ordinary round, but the re-entry bypasses step
 * 4 entirely, which is why it is stated twice rather than once.
 */
const REBUILT_REVIEW_ENSEMBLR = `Send the rebuilt change back to the reviewer you already have, the way you sent the first round: it holds the workspace's second co-tenancy slot for as long as it is open, so a second \`ensemblr_start_review\` on the way past step 3 is refused rather than opening a fresh reader.`;

/**
 * The same, for a root delegating through its own runtime. Here there is nothing
 * still open to follow up — the reviewer was a sub-agent that ended with its
 * report — so the re-entry genuinely does spawn a new one, and the only thing
 * worth saying is that it reads the rebuilt change whole.
 *
 * Worded so it does not echo step 4's own "the files they moved". That step
 * briefs a per-round reader on the delta, which is right for a round; negating
 * its phrasing here would read as overriding it rather than as naming the one
 * case it does not cover.
 */
const REBUILT_REVIEW_NATIVE = `Brief a fresh reviewer child over the rebuilt change, and give it the whole of that change: it came out of a plan the earlier readers never saw, so a brief scoped to one round's findings would point it at the wrong thing.`;

/**
 * The cycle, and what ends it.
 *
 * There is no round count. A cap either cuts off a run that was still
 * converging or licenses rounds that stopped paying for themselves, and the
 * agent inside the loop is the only party that can tell those apart — so the
 * stop conditions are about whether the last round changed anything, and the
 * one failure they exist to name is a run of rounds circling the same problem,
 * which is a fact about the approach rather than about the code.
 *
 * Mechanism-dependent for one sentence only: the re-entry passes through step 3,
 * and step 3 is where the two mechanisms differ.
 * @param delegation - The mechanism this session was pinned to at open.
 * @returns The cycle, carrying the re-entry sentence its mechanism needs.
 */
function iterateFor(delegation: SubagentMechanism): string {
	const rebuiltReview =
		delegation === 'native' ? REBUILT_REVIEW_NATIVE : REBUILT_REVIEW_ENSEMBLR;
	return `**Steps 1 to 4 are a loop, and you decide how many times it runs.** Nothing caps the rounds. Run the cycle as many times as it earns — reviewing, judging, repairing, re-reading — and let each pass be paid for by something actually changing. Say in the conversation when a round finishes and what it moved, so the record shows how the change converged rather than only where it landed.

Three things end it. A round that comes back with nothing you agree needs fixing: the change is done. A round that repeats the list you already judged and answered: a second copy of an answered finding is not new information. And a run of rounds circling the same class of problem: that says the approach is wrong rather than the code, and grinding step 4 will not fix an approach — go back to step 1 with what the reviews taught you, re-plan, and rebuild from there. ${rebuiltReview}

When re-planning does not break the circle either, stop. An honest report of a change that did not converge is worth more than another six rounds against the same wall, and spending the night on one finding is the outcome this loop exists to prevent.`;
}

/** Step five, and the two hard limits on it. */
const SHIP = `**5. Open the pull request — and never merge it.** Once the loop has ended clean, commit the work following this repository's commit conventions, push the branch, and open the pull request. Turning AFK on for a change *is* the request for one, so this is the one outward-facing step the block above has already asked for and it needs no further permission — but it is the end of your authority. Never merge, never force-push over somebody else's work, never close or reopen anything. A branch that already has an open pull request gets that one updated rather than a second one opened.

If the loop ended with real problems still standing, do not open the pull request. Leave the work committed on the branch, and report what is unresolved.`;

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

**Your final message is the whole account of the run.** It carries what you built, the approach you chose and what you rejected, how many rounds the loop ran and what each one moved, every decision you made on the user's behalf, every review finding you disagreed with and why, what you could not finish and what stopped you, and the pull request if you opened one. Be honest about the parts you are least sure of — a run reported as clean that was not is worse than one that names its own weak spots. Put the same thing in \`ensemblr_set_summary\`, which is what the user reads first.`;

/**
 * What a spawned sub-agent reads instead of the loop.
 *
 * It gets a body of its own rather than the scope gate alone for two reasons.
 * Nested delegation is blocked on every axis, so the delegation block above
 * would be an instruction it cannot follow — and the steps that follow name ops
 * it does not hold. What survives is the discipline the loop exists for, which
 * applies to a child's unwatched turn exactly as it does to its orchestrator's.
 *
 * The opening names what the child does not do rather than what its parent does,
 * because the parent is not always the committer: a reviewer and a peer are both
 * spawned as roots, both read this file, and both may spawn children of their
 * own — whose commit belongs two levels up. Naming the parent's role would be a
 * false claim for a whole class of children, and every other claim in the block
 * is worth following only because they can all be checked.
 */
const SUBAGENT_BODY = `The delivery loop Ensemblr runs an unattended change through is not yours. You were spawned to carry out one unit of work, and nothing that happens to the change afterwards is yours: the commit, the review, and the pull request all sit above you, however many levels up that is. Do not commit, push, rebase, or open one from here — make the change, leave it in the working tree, and say in your report exactly what you touched.

What does carry over is the discipline the loop exists for, because nobody is watching your turn either. Decide the approach before the first edit rather than discovering it during one. Where your unit of work changed files, run whatever this repository uses to check a change and say in your report what it said — a survey, a triage, or any other unit that changed none has nothing to check. Where the brief left something ambiguous, take the most defensible reading, act on it, and name the assumption rather than deciding it silently.

Nested delegation is blocked on every axis, so the reading is yours to do — and do only what your unit of work needs. Your brief already holds paths and facts your orchestrator paid to establish; re-deriving them spends the saving the hand-off was for. Read what the brief did not give you, and leave your findings as your last message.`;

/**
 * The delegation block for one caller: why it delegates, then how.
 * @param delegation - The mechanism this session was pinned to at open.
 * @returns The premise and the mechanism-specific mechanics, joined.
 */
function delegateFor(delegation: SubagentMechanism): string {
	const mechanics =
		delegation === 'native'
			? DELEGATE_MECHANICS_NATIVE
			: DELEGATE_MECHANICS_ENSEMBLR;
	return `${DELEGATE_PREMISE}\n\n${mechanics}`;
}

/**
 * Steps 3 and 4 for one caller. They move together: the mechanism that opens the
 * review is the one that drives the fix round, and a caller handed one half of
 * each pair would be told to follow up into something it never opened.
 * @param delegation - The mechanism this session was pinned to at open.
 * @returns The review and fix steps, joined.
 */
function reviewAndFixFor(delegation: SubagentMechanism): string {
	return delegation === 'native'
		? `${REVIEW_NATIVE}\n\n${FIX_NATIVE}`
		: `${REVIEW_ENSEMBLR}\n\n${FIX_ENSEMBLR}`;
}

/**
 * Renders the delivery loop, or null when the conversation is not unattended.
 *
 * There is no Concierge branch, and it is not an omission: AFK is a per-chat-tab
 * toggle and the Concierge is a panel, so no Concierge session is ever in the
 * registry `isUnattended` reads. A branch for it would be an unreachable answer
 * to a question the caller cannot ask.
 * @param options - Whether the session is unattended, the delegation mechanism it was pinned to at open, and the caller's control-layer role.
 * @returns The block to append to this turn's prompt, or null when AFK is off.
 */
export function buildAfkWorkflowDirective({
	delegation,
	role,
	unattended,
}: {
	delegation: SubagentMechanism;
	role: AgentControlRole;
	unattended: boolean;
}): string | null {
	if (!unattended) {
		return null;
	}
	if (role === 'subagent') {
		return `${AFK_WORKFLOW_HEADER} — ${SUBAGENT_BODY}`;
	}
	return `${AFK_WORKFLOW_HEADER} — ${SCOPE}

${delegateFor(delegation)}

${PLAN}

${BUILD}

${reviewAndFixFor(delegation)}

${iterateFor(delegation)}

${SHIP}

${REPORT}`;
}
