/**
 * The control ops a spawned sub-agent may not dispatch, whatever mode it is in.
 *
 * Plan Mode already denies a planning sub-agent four ops, but its table only
 * applies while planning. Outside it the only op that consulted the caller's role
 * was `setBranchName`; everything else a sub-agent could not reach was stopped by
 * the spawn guardrail noticing `origin.depth >= 1`. That is a fork-bomb counter,
 * not a policy, and it lives in an in-memory registry: a session resumed after a
 * restart re-registers with no parent, reads as depth 0, and regains every spawn
 * op — while `notifyOrchestrator`, its one sanctioned escape hatch, fails on the
 * same missing lineage. The privileges invert exactly when they should not.
 *
 * This table takes the durable role instead, so the answer survives a restart and
 * matches what {@link SUBAGENT_AWARENESS} promises. Ops whose only problem is that
 * a sub-agent has no use for them — `waitForAgents` with no children to wait on,
 * `listModels` when it cannot spawn, `listRunScripts` when it cannot start one —
 * are absent on purpose: they are withheld
 * from the sub-agent's tool list rather than denied, because a denial implies a
 * hazard where there is only noise.
 *
 * Everything here is a pure function of its argument, so the parity test can
 * cross-check the playbook prose against it.
 */

import type { AgentControlOp } from './contracts.ts';

/**
 * Ops denied to a spawned sub-agent, mapped to the reason handed back. Each
 * reason names what to do instead, because a denial that only says no leaves the
 * model to invent a workaround.
 */
const SUBAGENT_BLOCKED_OPS: ReadonlyMap<AgentControlOp, string> = new Map([
	[
		'spawnChatTab',
		'You were spawned as a sub-agent to carry out one unit of work, and nested delegation is blocked. Do the work yourself and leave your findings as your last message.',
	],
	[
		'startConversation',
		'You were spawned as a sub-agent to carry out one unit of work, and nested delegation is blocked. Do the work yourself and leave your findings as your last message.',
	],
	[
		'sendFollowUp',
		'You were spawned as a sub-agent and have no conversations of your own to steer. Driving another agent from here would put a second writer on a workspace you do not own. Leave your findings as your last message, or call `ensemblr_notify_orchestrator` if you are blocked.',
	],
	[
		'launchHarness',
		'You were spawned as a sub-agent, and launching a harness belongs to the orchestrator that spawned you. A harness is an unrestricted writer on the same worktree you and your orchestrator are working in, and it launches with approval prompts skipped. Do the work yourself, or report what would need one.',
	],
	[
		'startTerminal',
		'You were spawned as a sub-agent, and the setup, run, and spawn terminals belong to the workspace rather than to your unit of work. Run what you need through `bash`, or say in your report which script should be started.',
	],
	[
		'stopTerminal',
		'You were spawned as a sub-agent, and the workspace terminals outlive your unit of work — the orchestrator or the user may be depending on the one you are stopping. Say in your report which terminal should be stopped and why.',
	],
	[
		'writeTerminal',
		"You were spawned as a sub-agent, and writing into an existing terminal drives a shell — including another agent's — that your unit of work does not own. Run your own commands through `bash` instead.",
	],
	[
		'openTab',
		'You were spawned as a sub-agent, and opening a file, diff, or comment tab leaves a view behind in a workspace whose tabs your orchestrator manages. Cite the full path in your report instead; you may still bring an existing tab forward with `ensemblr_focus_tab`.',
	],
	[
		'closeTab',
		'You were spawned as a sub-agent, and the tabs in this workspace are not yours to close — the one you reach for could be your orchestrator, blocked waiting on your report, or a sibling still working. You create no tabs, so you have none to clean up.',
	],
	[
		'setBranchName',
		'Naming the workspace and its git branch belongs to the root conversation, not to a spawned sub-agent: that name describes the whole body of work rather than the one unit you were handed. Report the name you would have chosen instead.',
	],
	[
		'setWorkspaceStatus',
		'The kanban status describes the whole workspace, not the one unit of work you were handed, so moving the board belongs to the root conversation that spawned you. Say in your report where you think the work now stands.',
	],
	[
		'askUserQuestion',
		'You were spawned as a sub-agent, and the orchestrator that spawned you owns the conversation with the user and is blocked waiting on you — a question raised here opens a dialog in a tab nobody is watching. Put the decision under the `Open questions` heading of your report, which your orchestrator turns into a questionnaire, or call `ensemblr_notify_orchestrator` with reason `need_decision` when you cannot produce your deliverable at all without an answer.',
	],
	[
		'exitPlanMode',
		'You were spawned as a sub-agent, and submitting a plan belongs to the orchestrator that spawned you — a plan posted here would put a review panel in a tab nobody is watching. Leave your findings as your last message instead; that is what the orchestrator reads.',
	],
]);

/**
 * Ops withheld from a sub-agent's tool list because it can never usefully call
 * them, not because calling one would do harm. They stay dispatchable so a stale
 * caller meets an ordinary result rather than a denial that overstates the stakes.
 */
export const SUBAGENT_UNUSABLE_OPS: ReadonlySet<AgentControlOp> = new Set([
	'waitForAgents',
	'listModels',
	'listRunScripts',
]);

/**
 * Every op a sub-agent's tool list omits: the denied ones plus the useless ones.
 * The Pi extension registers the complement of this set for a sub-agent, and the
 * parity test compares the two.
 */
export const SUBAGENT_WITHHELD_OPS: ReadonlySet<AgentControlOp> = new Set([
	...SUBAGENT_BLOCKED_OPS.keys(),
	...SUBAGENT_UNUSABLE_OPS,
]);

/**
 * Reports why a spawned sub-agent may not dispatch a control op.
 * @param op - The control op being dispatched.
 * @returns The model-facing denial reason, or null when the op may proceed.
 */
export function subAgentControlOpDenial(op: AgentControlOp): string | null {
	return SUBAGENT_BLOCKED_OPS.get(op) ?? null;
}
