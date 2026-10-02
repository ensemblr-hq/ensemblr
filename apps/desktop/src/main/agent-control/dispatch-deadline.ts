/**
 * Bounds how long one control op may run before the app answers for it.
 *
 * The client-side ceiling in `mcp-tool-timeout.ts` is a day, and it is set per
 * *server* because no MCP client exposes a per-tool knob. That is the right
 * trade for the three ops that block by design, and the wrong one for the other
 * thirty-seven: before it, a wedged port surfaced to the agent as its client's
 * 60-second timeout and the turn carried on; after it, the same wedge would hold
 * the agent for a day while the progress heartbeat reported it healthy the whole
 * time. Port coverage cannot be relied on to prevent that — `linear-client.ts`
 * and `workspace-git-status.ts` bound themselves, the terminal, harness-launch
 * and tab ports do not.
 *
 * So the bound the client can no longer provide is provided here instead, where
 * it can be applied per op rather than per server. The deadline is deliberately
 * generous: it exists to break a wedge, not to police a slow repository.
 *
 * A timed-out op is abandoned, not cancelled — the port keeps running and its
 * side effect may still land. That is what the envelope tells the agent, because
 * "retry" and "check first" are different instructions.
 */
import type {
	AgentControlOp,
	AgentControlResult,
} from '../../shared/agent-control.ts';

/**
 * How long a non-blocking op may run before the app answers for it. Two minutes
 * is far past every ordinary op — the slowest are a git walk and a pty spawn —
 * and far short of the day the client now allows.
 */
export const DISPATCH_TIMEOUT_MS = 120_000;

/**
 * Ops exempt from the deadline because blocking *is* their contract:
 * `askUserQuestion` waits on a human with no timeout at all, `waitForAgents`
 * waits on a child, and `startConversation`/`sendFollowUp` do the same whenever
 * the caller passed `wait: true`. The last three are already bounded by
 * `guardrails.waitTimeoutMs`, so exempting them removes no protection.
 */
const BLOCKING_CONTROL_OPS: ReadonlySet<AgentControlOp> = new Set([
	'askUserQuestion',
	'sendFollowUp',
	'startConversation',
	'waitForAgents',
]);

/**
 * Builds the envelope handed to an agent whose op outlived the deadline.
 * @param op - The op that did not finish.
 * @param timeoutMs - The deadline it outlived.
 * @returns A `timeout` failure naming the op and warning against a blind retry.
 */
function abandoned(
	op: AgentControlOp,
	timeoutMs: number,
): AgentControlResult<never> {
	return {
		ok: false,
		code: 'timeout',
		error: `${op} did not finish within ${Math.round(timeoutMs / 1000)}s, so the app stopped waiting on it. It may still be running and its effect may still land — check the current state before running it again.`,
	};
}

/**
 * Runs one control op under a deadline, unless blocking is that op's contract.
 * @param op - The op being dispatched, which decides whether a deadline applies.
 * @param run - The dispatch to bound.
 * @param timeoutMs - Overrides the deadline; tests scale it down.
 * @returns The op's own result, or a `timeout` envelope when it outlived the
 *   deadline. A rejection passes through untouched, so `invoke` still maps a
 *   crashing port onto its own `internal` envelope.
 */
export async function withDispatchDeadline<T>(
	op: AgentControlOp,
	run: () => Promise<AgentControlResult<T>>,
	timeoutMs: number = DISPATCH_TIMEOUT_MS,
): Promise<AgentControlResult<T>> {
	if (BLOCKING_CONTROL_OPS.has(op)) {
		return await run();
	}
	let timer: ReturnType<typeof setTimeout> | undefined;
	const expired = new Promise<AgentControlResult<never>>((resolve) => {
		timer = setTimeout(() => resolve(abandoned(op, timeoutMs)), timeoutMs);
	});
	try {
		return await Promise.race([run(), expired]);
	} finally {
		clearTimeout(timer);
	}
}
