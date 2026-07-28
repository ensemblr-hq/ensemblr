/**
 * Plan Mode's policy for Ensemblr's own control ops. Blocking Pi's `bash`,
 * `edit`, and `write` is not enough on its own: the same extension registers
 * tools that open a real terminal, launch another coding agent, or start a child
 * conversation, and every one of those is an unguarded route back to editing the
 * repository.
 */
import type { AgentControlOp } from '../agent-control/contracts.ts';
import { planModeBlockReason } from './block-reason.ts';

/**
 * Control ops a planning agent may not dispatch, mapped to the cause named in
 * the denial. Delegation ops are on the list because a spawned conversation's
 * session is never registered as planning, so it would run unrestricted.
 */
const PLAN_MODE_BLOCKED_OPS: ReadonlyMap<AgentControlOp, string> = new Map([
	[
		'launchHarness',
		'`ensemblr_launch_harness` starts another coding agent that can edit files',
	],
	[
		'sendFollowUp',
		'`ensemblr_send_follow_up` drives another conversation that can edit files',
	],
	[
		'startConversation',
		'`ensemblr_start_conversation` spawns an agent that is not itself planning',
	],
	[
		'startTerminal',
		'`ensemblr_start_terminal` opens a shell the read-only command rules cannot reach',
	],
	[
		'writeTerminal',
		'`ensemblr_write_terminal` runs arbitrary commands in a shell',
	],
]);

/**
 * Reports why a control op is not allowed while planning.
 * @param op - The control op being dispatched.
 * @returns The model-facing denial reason, or null when the op may proceed.
 */
export function planModeControlOpDenial(op: AgentControlOp): string | null {
	const cause = PLAN_MODE_BLOCKED_OPS.get(op);
	return cause === undefined ? null : planModeBlockReason(cause);
}
