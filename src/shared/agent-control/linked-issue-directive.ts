/**
 * The standing instruction that turns a workspace's linked Linear issue into work
 * the agent does unprompted.
 *
 * The tools to move a ticket have been there all along; what was missing is the
 * fact that there is a ticket. A workspace created from an issue persists that
 * issue on its metadata, and nothing ever told the agent — so every state change
 * happened because the user asked for one by hand, which is the same as it not
 * happening. This block names the issue and names the trigger for each call, on
 * the reasoning that a model acts on "when you open a pull request, move it" far
 * more reliably than on a tool description saying what an update does.
 *
 * It is rendered by the app rather than written into a playbook for the reason
 * {@link buildLanguageDirective} and `session-brief.ts` are: the shipped Pi
 * extension carries byte-identical copies of the playbooks that a parity test
 * polices, and those copies must stay flat literals. A block built from live
 * workspace state has no literal to compare against, so the app renders the
 * finished sentence and every surface appends a string it never authors. It is
 * also why Plan Mode cannot lose it — the plan-mode playbooks replace the role
 * playbook, and this block is appended after whichever one won.
 *
 * Both axes that decide what an agent may do to a tracker are arguments here, so
 * the block never names a call the caller would be refused. A spawned sub-agent
 * is denied `linearCreateComment` and `linearUpdateIssue`
 * ({@link SUBAGENT_WITHHELD_OPS}) and a planning agent is denied
 * `linearUpdateIssue` (`src/shared/plan-mode/control-ops.ts`); in both cases the
 * work goes into the report or the plan instead, and the block says so rather
 * than sending the caller at a denial.
 */

import type { AgentControlRole } from './awareness.ts';
import type { WorkspaceLinkedIssue } from './contracts.ts';

/** Opening line of the block, and the marker tests assert on. */
export const LINKED_ISSUE_DIRECTIVE_HEADER = 'LINKED ISSUE';

/**
 * How the block identifies the issue, account included so a write can be scoped.
 * @param issue - The issue the workspace was created from.
 * @returns The opening sentence naming the issue and its account.
 */
function subject(issue: WorkspaceLinkedIssue): string {
	const account = issue.accountId
		? ` Its Linear accountId is \`${issue.accountId}\` — pass that on every call about it, because an id from one organization is never valid in another.`
		: '';
	return `${LINKED_ISSUE_DIRECTIVE_HEADER}: this workspace was created from Linear issue \`${issue.identifier}\` — "${issue.title}".${account}`;
}

/**
 * Why the tracker is the agent's job rather than the user's. Stated once, because
 * a list of triggers with no reason behind it reads as optional bookkeeping.
 */
const OBLIGATION = `Keeping that issue current is part of the work, not something to wait for permission on. The tracker is where the user and their team read what is happening; an issue nobody moved says the work never started, and an issue still In Progress after the change shipped says it never finished.`;

/** The read trigger, which every role and every mode holds. */
const READ_TRIGGER = `- **Before you change any code**, read the issue: \`ensemblr_linear_get_issue\` takes the identifier directly. Its description and comment thread carry requirements, decisions, and rejected approaches that your prompt does not, and re-deriving them from the code is how an agent rebuilds something the ticket already ruled out.`;

/** The start-of-work trigger, for a role that may move a ticket. */
const START_TRIGGER = `- **As soon as you begin implementing**, move the issue into a started state if it is not in one already, with \`ensemblr_linear_update_issue\`. Call \`ensemblr_linear_get_metadata\` first: \`stateId\` and \`assigneeId\` are ids rather than names, and that is the only call that turns one into the other. It also reports \`viewer\`, the Linear user this app is connected as — assign the issue to that \`userId\` when it has no assignee, so the board shows the work as taken rather than as unclaimed.`;

/** The comment trigger, for a role that may write to the tracker. */
const COMMENT_TRIGGER = `- **When you settle something the ticket should record** — a decision you made, a constraint you hit, a question you answered yourself — post it with \`ensemblr_linear_create_comment\`. Once per turn, in the agent's own voice, and only what a teammate reading the ticket next month would need: a comment that restates your reply to the user is noise on a page the whole team reads, and nothing here can delete it afterwards.`;

/** The hand-off trigger, the one this whole block exists to produce. */
const REVIEW_TRIGGER = `- **When the work is ready for a human** — the change made and verified, a pull request opened, or the turn ending with something reviewable — move the issue to your team's In Review state in the same turn, and say in your reply that you moved it. Do not wait to be asked, and do not leave it for the next session. This is as far as agent work goes: a state whose type is \`completed\` or \`canceled\` is refused whatever you pass, because whether the work is done is the user's call.`;

/** How a sub-agent discharges the same obligation, through its orchestrator. */
const SUBAGENT_HANDBACK = `Writing to the tracker is not yours: \`ensemblr_linear_create_comment\` and \`ensemblr_linear_update_issue\` are both refused to a spawned sub-agent, because a ticket the whole team reads should be moved once for the whole body of work rather than once per child. Put it in your report instead — name the state you think the issue should now be in, and anything you found that belongs in a comment — and let the orchestrator that spawned you make the call.`;

/** How a planning agent discharges it, given that moving a ticket claims an implementation. */
const PLAN_MODE_HANDBACK = `Moving the issue is refused while you are planning, for the same reason \`write\` and \`edit\` are: an issue pushed to In Review from here claims an implementation that does not exist yet. Reading it is not, and neither is commenting — \`ensemblr_linear_create_comment\` records what you found, which is planning output. Put the state the issue should end up in into the plan, and move it once the plan is approved and you are implementing.`;

/** The triggers a planning root holds: read the issue, and record what it found. */
const PLAN_MODE_TRIGGERS = `${READ_TRIGGER}
${COMMENT_TRIGGER}`;

/** Every trigger a root implementing against the issue holds, in lifecycle order. */
const IMPLEMENTING_TRIGGERS = `${READ_TRIGGER}
${START_TRIGGER}
${COMMENT_TRIGGER}
${REVIEW_TRIGGER}`;

/**
 * Renders the trigger list and closing clause for a caller's role and mode.
 * @param role - Whether the caller is a root orchestrator or a spawned sub-agent.
 * @param planMode - Whether the calling session is planning, which blocks the move.
 * @returns The body of the block, after its subject and obligation.
 */
function bodyFor(role: AgentControlRole, planMode: boolean): string {
	if (role === 'subagent') {
		return `${READ_TRIGGER}\n\n${SUBAGENT_HANDBACK}`;
	}
	if (planMode) {
		return `${PLAN_MODE_TRIGGERS}\n\n${PLAN_MODE_HANDBACK}`;
	}
	return IMPLEMENTING_TRIGGERS;
}

/**
 * Renders the linked-issue block for a caller, or null when there is nothing to
 * say. A workspace with no linked issue, or one linked to a GitHub issue, gets no
 * block: the control surface has no GitHub issue ops, so a directive there would
 * name obligations with no tool behind them.
 * @param issue - The issue the workspace was created from, or null when it has none.
 * @param role - Whether the caller is a root orchestrator or a spawned sub-agent.
 * @param planMode - Whether the calling session is planning.
 * @returns The block to append to a playbook, or null when none applies.
 */
export function buildLinkedIssueDirective(
	issue: WorkspaceLinkedIssue | null,
	role: AgentControlRole = 'orchestrator',
	planMode = false,
): string | null {
	if (issue?.provider !== 'linear') {
		return null;
	}
	return `${subject(issue)} ${OBLIGATION}\n\n${bodyFor(role, planMode)}`;
}
