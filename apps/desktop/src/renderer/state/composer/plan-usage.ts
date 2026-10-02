import type { ComposerPlanUsage } from '@/renderer/types/workbench';
import type {
	AgentPersistedEnvelope,
	AgentPlanLimitWindowWire,
	AgentPlanLimitWire,
	AgentSessionCostWire,
	AgentSessionEventWire,
} from '@/shared/ipc/contracts/agent-session';

/** What the gauge starts from before a session has reported anything. */
const EMPTY_USAGE: ComposerPlanUsage = {
	limits: [],
	status: null,
	totalCostUsd: null,
};

/** A live plan snapshot and the session whose readings built it. */
export interface TaggedComposerPlanUsage {
	sessionId: string;
	usage: ComposerPlanUsage;
}

/**
 * One thing a session can report about its plan. Each arrives on its own event
 * and describes one slice of the picture, so a reading says which slice it is
 * rather than restating figures it did not measure.
 */
export type PlanUsageReading =
	| { cost: AgentSessionCostWire; kind: 'cost' }
	| { kind: 'limit'; limit: AgentPlanLimitWire }
	| { kind: 'windows'; windows: readonly AgentPlanLimitWindowWire[] };

/**
 * Reads a persisted envelope as a plan reading, so the live subscription and the
 * replay agree on which envelopes describe the plan and on what each one says —
 * the two paths carry the same events and would otherwise drift apart one
 * envelope kind at a time.
 * @param payload - The envelope a broadcast or a stored event carried.
 * @returns The reading, or null when the envelope describes something else.
 */
export function toPlanUsageReading(
	payload: AgentPersistedEnvelope | null | undefined,
): PlanUsageReading | null {
	switch (payload?.kind) {
		case 'plan-limit':
			return { kind: 'limit', limit: payload.limit };
		case 'plan-windows':
			return { kind: 'windows', windows: payload.windows };
		case 'session-cost':
			return { cost: payload.cost, kind: 'cost' };
		default:
			return null;
	}
}

/**
 * Folds a live reading into the tagged snapshot, restarting the fold when the
 * reading belongs to a different session than the one accumulated so far — one
 * chat's windows and cost must not carry into the next.
 * @param previous - Tagged snapshot so far, or null before the first reading.
 * @param reading - The reading that just landed, tagged with its session.
 * @returns The updated tagged snapshot.
 */
export function foldTaggedPlanUsage(
	previous: TaggedComposerPlanUsage | null,
	reading: PlanUsageReading & { sessionId: string },
): TaggedComposerPlanUsage {
	const continues = previous?.sessionId === reading.sessionId;
	return {
		sessionId: reading.sessionId,
		usage: foldPlanUsage(continues ? (previous?.usage ?? null) : null, reading),
	};
}

/**
 * Folds one plan reading into the running snapshot.
 *
 * A rate-limit push names a single window, so a reading updates that window in
 * place and leaves the rest standing — the alternative, treating each push as
 * the whole picture, would blank every other window the session had reported. A
 * polled read names them all and updates each the same way, which is what lets a
 * baseline and the pushes that follow it compose. The spend verdict rides the
 * newest push and nothing else, because a read reports no verdict at all.
 * @param previous - Snapshot so far, or null before the first reading.
 * @param reading - What the session just reported about its plan.
 * @returns The updated snapshot.
 */
export function foldPlanUsage(
	previous: ComposerPlanUsage | null,
	reading: PlanUsageReading,
): ComposerPlanUsage {
	const base = previous ?? EMPTY_USAGE;
	switch (reading.kind) {
		case 'cost':
			return { ...base, totalCostUsd: reading.cost.totalCostUsd };
		case 'limit':
			return {
				...base,
				limits: replaceWindow(base.limits, reading.limit.window),
				status: reading.limit.status,
			};
		case 'windows':
			return {
				...base,
				limits: reading.windows.reduce(replaceWindow, base.limits),
			};
	}
}

/**
 * Decides what a chat's gauge shows, from what its events replayed and what its
 * live subscription has heard since.
 *
 * A live snapshot tagged with some other session is a leftover from the chat the
 * composer was bound to before, so it is treated as absent rather than shown
 * against the wrong plan.
 * @param input - The replayed snapshot, the tagged live one, and the bound session.
 * @returns The snapshot to render, or null when nothing has reported usage.
 */
export function resolvePlanUsage({
	live,
	persisted,
	sessionId,
}: {
	live: TaggedComposerPlanUsage | null;
	persisted: ComposerPlanUsage | null;
	sessionId: string | null;
}): ComposerPlanUsage | null {
	const bound = live?.sessionId === sessionId ? (live?.usage ?? null) : null;
	return mergePlanUsage(persisted, bound);
}

/**
 * Layers a session's live readings over the snapshot replayed from its persisted
 * events.
 *
 * The live fold accumulates only what has arrived since the chat was opened, and
 * each event carries one half of the picture — so a sealed turn's cost, landing
 * before any window has moved, describes an empty window list. Replacing rather
 * than layering would take that literally and blank every bar the chat had
 * already shown until the runtime happened to push the next window.
 * @param persisted - Snapshot replayed from the session's stored events.
 * @param live - What this chat's own subscription has folded, or null before any.
 * @returns The snapshot to render, or null when neither half reported anything.
 */
function mergePlanUsage(
	persisted: ComposerPlanUsage | null,
	live: ComposerPlanUsage | null,
): ComposerPlanUsage | null {
	if (!live) {
		return persisted;
	}
	if (!persisted) {
		return live;
	}
	return {
		limits: live.limits.reduce(replaceWindow, persisted.limits),
		status: live.status ?? persisted.status,
		totalCostUsd: live.totalCostUsd ?? persisted.totalCostUsd,
	};
}

/**
 * Layers a window's newest reading over the list, appending it when the session
 * has not named that window before.
 * @param limits - Windows reported so far.
 * @param window - The reading that just landed.
 * @returns A new list carrying the reading.
 */
function replaceWindow(
	limits: ComposerPlanUsage['limits'],
	window: AgentPlanLimitWindowWire,
): ComposerPlanUsage['limits'] {
	const index = limits.findIndex((reported) => reported.id === window.id);
	if (index === -1) {
		return [...limits, window];
	}
	return limits.map((reported, at) =>
		at === index ? mergeWindow(reported, window) : reported,
	);
}

/**
 * Layers a newer reading of one window over an older one, keeping the older
 * figure wherever the newer reading measured nothing.
 *
 * The SDK marks a pushed frame's utilization optional, so a push announcing a
 * status change can name a window and report no reading for it. Taking that
 * literally would blank a percentage the account did report, which the gauge
 * then draws as an empty bar. `0` is a measurement rather than an absence, so a
 * window that genuinely reset still reads as empty.
 * @param previous - The reading standing before this one.
 * @param next - The reading that just landed.
 * @returns The window as it now reads.
 */
function mergeWindow(
	previous: AgentPlanLimitWindowWire,
	next: AgentPlanLimitWindowWire,
): AgentPlanLimitWindowWire {
	return {
		displayName: next.displayName ?? previous.displayName,
		id: next.id,
		resetsAt: next.resetsAt ?? previous.resetsAt,
		utilization: next.utilization ?? previous.utilization,
	};
}

/**
 * Replays a session's persisted events into a plan-usage snapshot, so reopening
 * a chat restores the gauge instead of blanking it until the next turn.
 * @param events - The session's persisted events, oldest first.
 * @returns The snapshot, or null when the session reported no usage at all.
 */
export function planUsageFromEvents(
	events: readonly AgentSessionEventWire[],
): ComposerPlanUsage | null {
	let usage: ComposerPlanUsage | null = null;
	for (const event of events) {
		const reading = toPlanUsageReading(event.payload);
		if (reading) {
			usage = foldPlanUsage(usage, reading);
		}
	}
	return usage;
}
