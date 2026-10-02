import type {
	ModelUsage,
	SDKControlGetUsageResponse,
	SDKRateLimitInfo,
} from '@anthropic-ai/claude-agent-sdk';
import type { AgentProviderUsageWire } from '../../shared/ipc/contracts/agent-provider';
import type {
	AgentPlanLimitStatusWire,
	AgentPlanLimitWindowWire,
	AgentPlanLimitWire,
	AgentSessionCostWire,
} from '../../shared/ipc/contracts/agent-session';

/**
 * The named plan windows, in the order the Providers page lists them: the
 * rolling session window first, then the weekly ceilings. Per-model buckets are
 * appended after these, since the server decides how many there are and names
 * them itself.
 */
const NAMED_WINDOW_IDS = [
	'five_hour',
	'seven_day',
	'seven_day_opus',
	'seven_day_sonnet',
	'seven_day_oauth_apps',
] as const;

/**
 * The one place that names the SDK's experimental usage method.
 *
 * The method is called `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET`
 * and its own docblock promises the name will change once the API stabilizes.
 * Keeping the call behind this structural type means that rename touches one
 * line here rather than every caller, and a runtime that does not implement the
 * control request at all just rejects the promise like any other failure.
 */
interface UsageReadableSession {
	usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: () => Promise<SDKControlGetUsageResponse>;
}

/** One window as the SDK reports it, before it carries its own id. */
type RateLimitWindow = {
	resets_at?: string | null;
	utilization?: number | null;
};

/**
 * Projects one SDK window onto the wire.
 * @param id - Window key the reading belongs to, e.g. `five_hour`.
 * @param window - The SDK's own reading, absent when the plan has no such window.
 * @param displayName - Server-supplied label, set only on per-model buckets.
 * @returns The window, or null when the plan reported nothing for it.
 */
function toWindow(
	id: string,
	window: RateLimitWindow | null | undefined,
	displayName: string | null = null,
): AgentPlanLimitWindowWire | null {
	if (!window) {
		return null;
	}
	return {
		displayName,
		id,
		resetsAt: window.resets_at ?? null,
		utilization: window.utilization ?? null,
	};
}

/**
 * Flattens the SDK's per-window object into the ordered list the page renders.
 * @param rateLimits - The `rate_limits` object, null when plan limits do not apply.
 * @returns Every window the plan reported, named ones first.
 */
function toWindows(
	rateLimits: SDKControlGetUsageResponse['rate_limits'],
): readonly AgentPlanLimitWindowWire[] {
	if (!rateLimits) {
		return [];
	}
	const named = NAMED_WINDOW_IDS.map((id) => toWindow(id, rateLimits[id]));
	const modelScoped = (rateLimits.model_scoped ?? []).map((bucket) =>
		toWindow(bucket.display_name, bucket, bucket.display_name),
	);
	return [...named, ...modelScoped].filter(
		(window): window is AgentPlanLimitWindowWire => window !== null,
	);
}

/**
 * Maps the SDK's snake-cased spend verdict onto the wire's own union.
 * @param status - Verdict the runtime reported for a window.
 * @returns The wire status; anything unrecognized reads as still allowed.
 */
function toLimitStatus(status: string): AgentPlanLimitStatusWire {
	if (status === 'rejected') {
		return 'rejected';
	}
	return status === 'allowed_warning' ? 'allowed-warning' : 'allowed';
}

/**
 * Turns the push frame's numeric reset stamp into an ISO instant.
 *
 * The pushed frame carries a bare number where the control response carries an
 * ISO string, and the SDK documents no unit for it. Reading seconds as
 * milliseconds renders 1970 and the reverse renders the year 56000, so the
 * magnitude decides: anything below this threshold cannot be a millisecond
 * stamp for any date this decade.
 * @param resetsAt - Reset stamp off a rate-limit frame, in seconds or milliseconds.
 * @returns The instant as ISO 8601, or null when the frame carried none.
 */
function toResetInstant(resetsAt: number | undefined): string | null {
	if (!resetsAt) {
		return null;
	}
	const MILLISECOND_STAMP_FLOOR = 1e12;
	const millis =
		resetsAt < MILLISECOND_STAMP_FLOOR ? resetsAt * 1000 : resetsAt;
	const instant = new Date(millis);
	return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}

/**
 * Projects a pushed rate-limit frame onto the wire.
 *
 * The push describes whichever window just moved, so a frame naming no window is
 * a status change the gauge cannot place and is dropped rather than rendered
 * against a guessed one. A frame carrying no rate-limit block at all is dropped
 * the same way: these arrive from a separate process over a wire the app does
 * not control, so the shape is checked rather than assumed.
 * @param info - The `rate_limit_info` off an SDK `rate_limit_event`.
 * @returns The limit, or null when the frame named no window.
 */
export function toPlanLimit(
	info: SDKRateLimitInfo | undefined,
): AgentPlanLimitWire | null {
	if (!info?.rateLimitType) {
		return null;
	}
	return {
		status: toLimitStatus(info.status),
		window: {
			displayName: null,
			id: info.rateLimitType,
			resetsAt: toResetInstant(info.resetsAt),
			utilization: info.utilization ?? null,
		},
	};
}

/**
 * Projects a turn's cumulative spend onto the wire.
 *
 * `modelUsage` is keyed by the raw model string the turn ran under and covers
 * subagents and compaction calls as well as the main loop, which is what makes
 * it the honest total rather than the main model's own share.
 * @param totalCostUsd - The runtime's running cost estimate for the session.
 * @param modelUsage - Per-model counters off a `result` message.
 * @returns Cost totals for the session so far.
 */
export function toSessionCost(
	totalCostUsd: number,
	modelUsage: Record<string, ModelUsage> | undefined,
): AgentSessionCostWire {
	return {
		models: Object.entries(modelUsage ?? {}).map(([model, usage]) => ({
			cacheCreationInputTokens: usage.cacheCreationInputTokens,
			cacheReadInputTokens: usage.cacheReadInputTokens,
			costUsd: usage.costUSD,
			inputTokens: usage.inputTokens,
			model,
			outputTokens: usage.outputTokens,
		})),
		totalCostUsd,
	};
}

/**
 * Asks a live session what the account's plan windows read.
 *
 * Deliberately reports only the plan half of the runtime's answer: the session
 * half is scoped to the asking session, so a throwaway probe that has run no
 * turns would report its own zeroes as though they were the user's spend.
 * Per-session cost reaches the composer from that session's own `result`
 * messages instead.
 * @param session - A live session able to serve the usage control request.
 * @returns Plan usage, or null when the runtime could not answer.
 */
export async function readPlanUsage(
	session: UsageReadableSession,
): Promise<AgentProviderUsageWire | null> {
	try {
		const usage =
			await session.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET();
		return {
			available: usage.rate_limits_available,
			limits: toWindows(usage.rate_limits),
			subscriptionType: usage.subscription_type,
		};
	} catch {
		return null;
	}
}
