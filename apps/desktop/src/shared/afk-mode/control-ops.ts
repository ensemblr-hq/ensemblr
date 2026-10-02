/**
 * AFK Mode's policy for Ensemblr's own control ops. The user has told the app
 * they are away, so every surface that parks the turn waiting on a human is a
 * turn that makes no further progress — and `ensemblr_ask_user_question` is the
 * one with no time limit at all.
 *
 * Everything here is a pure function of its arguments, matching
 * `../plan-mode/control-ops.ts`: the directive in
 * `src/shared/agent-control/afk-directive.ts` tells the model which tool is
 * refused, and a parity test cross-checks that prose against this map — which it
 * can only do while the decision takes its inputs as arguments rather than
 * reading session state.
 */

import type { AgentControlOp } from '../agent-control/contracts.ts';

/**
 * Control ops no unattended agent may dispatch, mapped to the denial handed
 * back. The reason carries the escape hatch rather than only the cause: an agent
 * told "no" with nothing to do instead retries the same call or stops, and both
 * lose the run the mode exists to keep moving.
 */
const AFK_BLOCKED_OPS: ReadonlyMap<AgentControlOp, string> = new Map([
	[
		'askUserQuestion',
		'`ensemblr_ask_user_question` blocks your turn until a human answers, and the user has told the app they are away — nothing would answer it. Decide it yourself: take the most defensible reading, act on it, and put the assumption in your final message under its own heading so they can correct it when they are back. If the decision is genuinely unsafe to make alone, do every part of the task that does not depend on it, then say plainly in your answer what you left undone and why.',
	],
]);

/**
 * Reports why a control op is not allowed while the user is away.
 * @param op - The control op being dispatched.
 * @returns The model-facing denial reason, or null when the op may proceed.
 */
export function afkModeControlOpDenial(op: AgentControlOp): string | null {
	return AFK_BLOCKED_OPS.get(op) ?? null;
}
