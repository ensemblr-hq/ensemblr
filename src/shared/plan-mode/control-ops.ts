/**
 * Plan Mode's policy for Ensemblr's own control ops. Blocking Pi's `bash`,
 * `edit`, and `write` is not enough on its own: the same extension registers
 * tools that open a real terminal, launch another coding agent, or start a child
 * conversation, and every one of those is an unguarded route back to editing the
 * repository.
 *
 * Policy splits by role. A planning orchestrator may fan out sub-agents, because
 * a spawned child now inherits its parent's Plan Mode and is read-only for the
 * same reasons its parent is. A planning sub-agent may not: it cannot delegate
 * onward, submit a plan, or question the user, because all three belong to the
 * orchestrator that spawned it and is blocked waiting on its report.
 *
 * Everything here is a pure function of its arguments. The playbook text in
 * `src/shared/agent-control/awareness.ts` tells the model which tools are
 * blocked, and a parity test cross-checks that prose against these functions —
 * which it can only do while the decision takes its inputs as arguments rather
 * than reading session state.
 */

import type { AgentControlRole } from '../agent-control/awareness.ts';
import type { AgentControlOp } from '../agent-control/contracts.ts';
import { planModeBlockReason } from './block-reason.ts';

/**
 * Control ops no planning agent may dispatch, whatever its role, mapped to the
 * cause named in the denial. A harness has no Plan Mode surface at all and
 * launches with permission prompts skipped, and a terminal is a raw shell the
 * read-only command classifier cannot see into, so neither can be made safe by
 * inheritance the way a spawned agent conversation can.
 */
const PLAN_MODE_BLOCKED_OPS: ReadonlyMap<AgentControlOp, string> = new Map([
	[
		'launchHarness',
		'`ensemblr_launch_harness` starts a coding agent that has no Plan Mode of its own and launches with approval prompts skipped',
	],
	[
		'startTerminal',
		'`ensemblr_start_terminal` opens a shell the read-only command rules cannot reach',
	],
	[
		'writeTerminal',
		'`ensemblr_write_terminal` runs arbitrary commands in a shell',
	],
	[
		'resolveDiffComments',
		'`ensemblr_resolve_diff_comments` marks a review finding as fixed, and nothing has been fixed while `write` and `edit` are blocked — a comment resolved from here tells the user a change landed that does not exist',
	],
	[
		'linearUpdateIssue',
		'`ensemblr_linear_update_issue` moves a ticket the whole team reads, and an issue pushed to In Review from here claims an implementation that does not exist while `write` and `edit` are blocked — the same reason `ensemblr_resolve_diff_comments` is blocked. Commenting on the issue is not: `ensemblr_linear_create_comment` records what you found, which is planning output',
	],
]);

/**
 * Ops a planning orchestrator may reach but a planning sub-agent may not, mapped
 * to the denial handed to the sub-agent. These reasons deliberately do not use
 * {@link planModeBlockReason}: its escape hatch tells the caller to finish the
 * plan and call `ensemblr_exit_plan_mode`, which for a sub-agent names a tool
 * that is itself denied and would send it round the same loop.
 */
const PLAN_MODE_SUBAGENT_BLOCKED_OPS: ReadonlyMap<AgentControlOp, string> =
	new Map([
		[
			'startConversation',
			'You were spawned as a sub-agent to answer one question, and nested delegation is blocked. Do the investigation yourself and leave your findings as your last message.',
		],
		[
			'sendFollowUp',
			'You were spawned as a sub-agent and have no conversations of your own to steer. Leave your findings as your last message, or call `ensemblr_notify_orchestrator` if you are blocked.',
		],
		[
			'exitPlanMode',
			'You were spawned as a sub-agent, and submitting the plan belongs to the orchestrator that spawned you — a plan posted here would put a review panel in a tab nobody is watching. Leave your findings as your last message instead; that is what the orchestrator reads.',
		],
		[
			'askUserQuestion',
			'You were spawned as a sub-agent, and the orchestrator that spawned you owns the conversation with the user and is blocked waiting on you. Call `ensemblr_notify_orchestrator` with reason `need_decision` and it will answer you.',
		],
	]);

/**
 * Ops whose plan-mode answer depends on more than the op and the caller's role,
 * so their absence from {@link PLAN_MODE_BLOCKED_OPS} is deliberate rather than
 * an omission. `startConversation` is allowed for an orchestrator because the
 * child inherits Plan Mode; `sendFollowUp` defers to
 * {@link planModeFollowUpDenial}, which needs the target's state.
 */
export const PLAN_MODE_CONDITIONAL_OPS: ReadonlySet<AgentControlOp> = new Set([
	'sendFollowUp',
	'startConversation',
]);

/**
 * Reports why a control op is not allowed while planning, given only the op and
 * the caller's role. `sendFollowUp` from an orchestrator resolves to null here
 * because its answer depends on the target session; see
 * {@link planModeFollowUpDenial}.
 * @param op - The control op being dispatched.
 * @param role - Whether the caller is a root orchestrator or a spawned sub-agent.
 * @returns The model-facing denial reason, or null when the op may proceed.
 */
export function planModeControlOpDenial(
	op: AgentControlOp,
	role: AgentControlRole,
): string | null {
	const cause = PLAN_MODE_BLOCKED_OPS.get(op);
	if (cause !== undefined) {
		return planModeBlockReason(cause);
	}
	if (role !== 'subagent') {
		return null;
	}
	return PLAN_MODE_SUBAGENT_BLOCKED_OPS.get(op) ?? null;
}

/**
 * Reports why a planning orchestrator may not follow up on a conversation. A
 * target that is not itself planning would be an unrestricted writer taking
 * instructions from an agent that is supposed to be reading, so the denial names
 * the spawn route instead — a fresh sub-agent inherits Plan Mode.
 * @param targetPlanning - Whether the conversation being driven is itself planning.
 * @returns The model-facing denial reason, or null when the follow-up may proceed.
 */
export function planModeFollowUpDenial(targetPlanning: boolean): string | null {
	if (targetPlanning) {
		return null;
	}
	return planModeBlockReason(
		'`ensemblr_send_follow_up` reaches only a conversation that is itself planning, and that one is not — it could edit files. Spawn a fresh sub-agent with `ensemblr_start_conversation` instead; it inherits Plan Mode',
	);
}
