import type { AgentEvent } from '../agent-runtime/agent-types.ts';

/**
 * Claude Code's own plan-submission tool. Ensemblr does not re-synthesise plan
 * mode for Claude the way it does for Pi — Pi has no plan tool, so the
 * `ensemblr_*` control surface supplies one; Claude ships this natively, and
 * `PLAN_MODE_GUARDED_TOOLS` (a list of *Pi* tool names) must not be applied to
 * it.
 */
const EXIT_PLAN_MODE_TOOL = 'ExitPlanMode';

/** A plan Claude submitted, ready for the existing review panel. */
export interface ClaudePlanSubmission {
	plan: string;
	title: string;
	toolCallId: string;
}

/**
 * What the adapter reports when one of its sessions submits a plan. The control
 * token is the session's own bearer token and is what resolves back to the
 * trusted origin the plan is filed against; `agentSessionId` is the
 * `agent_sessions.id` row key, carried for diagnostics so a dropped plan names a
 * session a reader can actually look up.
 */
export interface ClaudePlanSubmittedEvent {
	agentSessionId: string;
	controlToken: string | null;
	submission: ClaudePlanSubmission;
}

/**
 * Detects Claude's native `ExitPlanMode` call in the normalized event stream
 * and lifts it into the shape the plan-review broadcast already expects, so
 * `usePlanReview` and `plan-review-panel` light up unmodified.
 *
 * Claude's tool takes only `plan`; the review panel wants a title too, so the
 * plan's first markdown heading (or first line) is used, matching what a user
 * would read as its name.
 * @param event - One normalized event off the session stream.
 * @returns The submission when this event is an `ExitPlanMode` call, else null.
 */
export function detectPlanSubmission(
	event: AgentEvent,
): ClaudePlanSubmission | null {
	if (event.type !== 'message' || event.payload.kind !== 'tool-call') {
		return null;
	}
	if (event.payload.name !== EXIT_PLAN_MODE_TOOL) {
		return null;
	}

	const input = event.payload.input;
	const plan =
		typeof input === 'object' && input !== null
			? (input as Record<string, unknown>).plan
			: null;
	if (typeof plan !== 'string' || !plan.trim()) {
		return null;
	}

	return {
		plan,
		title: derivePlanTitle(plan),
		toolCallId: event.payload.toolCallId,
	};
}

/**
 * Names a plan from its own text: the first markdown heading when there is one,
 * otherwise the first non-empty line, capped so it fits a panel header.
 * @param plan - The submitted plan markdown.
 * @returns A single-line title.
 */
function derivePlanTitle(plan: string): string {
	const lines = plan.split('\n');
	const heading = lines.find((line) => line.trim().startsWith('#'));
	const source = heading ?? lines.find((line) => line.trim().length > 0) ?? '';
	const cleaned = source.replace(/^#+\s*/, '').trim();
	return cleaned.length > 120 ? `${cleaned.slice(0, 117)}…` : cleaned || 'Plan';
}
