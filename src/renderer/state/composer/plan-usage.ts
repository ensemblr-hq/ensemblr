import type { ComposerPlanUsage } from '@/renderer/types/workbench';
import type {
	AgentPlanLimitWindowWire,
	AgentPlanLimitWire,
	AgentSessionCostWire,
	AgentSessionEventWire,
} from '@/shared/ipc/contracts/agent-session';

/** What the gauge starts from before a session has reported anything. */
const EMPTY_USAGE: ComposerPlanUsage = {
	limits: [],
	status: 'allowed',
	totalCostUsd: null,
};

/** A live plan snapshot and the session whose readings built it. */
export interface TaggedComposerPlanUsage {
	sessionId: string;
	usage: ComposerPlanUsage;
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
	reading: {
		cost: AgentSessionCostWire | null;
		limit: AgentPlanLimitWire | null;
		sessionId: string;
	},
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
 * A rate-limit push names a single window, so a reading replaces that window in
 * place and leaves the rest standing — the alternative, treating each push as
 * the whole picture, would blank every other window the session had reported.
 * The spend verdict rides the newest push rather than being derived per window,
 * because that is what the runtime actually reports.
 * @param previous - Snapshot so far, or null before the first reading.
 * @param reading - The window that moved and the cost that sealed, either nullable.
 * @returns The updated snapshot.
 */
export function foldPlanUsage(
	previous: ComposerPlanUsage | null,
	reading: {
		cost: AgentSessionCostWire | null;
		limit: AgentPlanLimitWire | null;
	},
): ComposerPlanUsage {
	const base = previous ?? EMPTY_USAGE;
	const limits = reading.limit
		? replaceWindow(base.limits, reading.limit.window)
		: base.limits;
	return {
		limits,
		status: reading.limit ? reading.limit.status : base.status,
		totalCostUsd: reading.cost ? reading.cost.totalCostUsd : base.totalCostUsd,
	};
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
		status: live.limits.length > 0 ? live.status : persisted.status,
		totalCostUsd: live.totalCostUsd ?? persisted.totalCostUsd,
	};
}

/**
 * Swaps a window's newest reading into the list, appending it when the session
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
	return limits.map((reported, at) => (at === index ? window : reported));
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
		const payload = event.payload;
		if (payload?.kind === 'plan-limit') {
			usage = foldPlanUsage(usage, { cost: null, limit: payload.limit });
		}
		if (payload?.kind === 'session-cost') {
			usage = foldPlanUsage(usage, { cost: payload.cost, limit: null });
		}
	}
	return usage;
}
