import type { DatabaseSync } from 'node:sqlite';

import {
	createAgentActivityState,
	reduceAgentActivity,
} from '../../../shared/agent-activity.ts';
import type {
	AgentContextUsageWire,
	AgentPersistedEnvelope,
	AgentSessionContextSnapshotWire,
	AgentSessionToolActivityWire,
} from '../../../shared/ipc/contracts/agent-session.ts';
import { resolveAgentSessionLineage } from '../../agent-control/session-lineage.ts';
import {
	isOrdinalHidden,
	readHiddenEventRanges,
} from '../../checkpoints/checkpoint-service.ts';
import {
	getMaxOrdinalForBranch,
	iterateBranchPayloadsDescending,
} from '../../storage/repositories/agent-event-repository.ts';
import { getAgentSessionBranchById } from '../../storage/repositories/agent-session-repository.ts';
import type { AgentSessionSnapshot } from '../agent-session-types.ts';
import type { AgentContextUsage } from '../agent-types.ts';

/** Live fields available through the lifecycle's narrow active-session view. */
interface ActiveSessionActivityView {
	contextUsage: AgentContextUsage | null;
}

/**
 * Tests whether a nullable numeric reading is finite and non-negative.
 * @param candidate - Value read from a runtime or persisted JSON payload.
 * @returns True when the value is null or a usable non-negative number.
 */
function isNullableNonNegative(candidate: unknown): boolean {
	return (
		candidate === null ||
		(typeof candidate === 'number' &&
			Number.isFinite(candidate) &&
			candidate >= 0)
	);
}

/**
 * Tests whether a persisted or live value is a usable context reading.
 * @param value - Candidate runtime or persisted usage value.
 * @returns True when all context usage fields have valid numeric ranges.
 */
export function isValidContextUsage(
	value: unknown,
): value is AgentContextUsageWire {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const usage = value as Record<string, unknown>;
	const contextWindow = usage.contextWindow;
	const percent = usage.percent;
	return (
		typeof contextWindow === 'number' &&
		Number.isFinite(contextWindow) &&
		contextWindow > 0 &&
		isNullableNonNegative(percent) &&
		(percent === null || (typeof percent === 'number' && percent <= 100)) &&
		isNullableNonNegative(usage.tokens)
	);
}

/**
 * Reads the newest visible valid context reading without materializing a branch transcript.
 * @param input - Open database and branch to scan newest-first.
 * @returns The latest valid visible reading, or null when none was recorded.
 */
function readLastRecordedContextUsage({
	branchId,
	database,
}: {
	branchId: string;
	database: DatabaseSync;
}): AgentSessionContextSnapshotWire | null {
	const branch = getAgentSessionBranchById({ database, id: branchId });
	const hiddenRanges = branch ? readHiddenEventRanges(branch.metadata) : [];
	for (const { ordinal, payload } of iterateBranchPayloadsDescending({
		branchId,
		database,
	})) {
		if (
			isOrdinalHidden(ordinal, hiddenRanges) ||
			payload?.kind !== 'context-usage' ||
			!isValidContextUsage(payload.usage)
		) {
			continue;
		}
		return { reading: 'last-recorded', usage: payload.usage };
	}
	return null;
}

/**
 * Tests whether an envelope proves there can be no running tool from this turn.
 * @param payload - Visible persisted envelope being scanned newest-first.
 * @returns True when scanning can stop with an empty projection.
 */
function endsCurrentActivity(payload: AgentPersistedEnvelope): boolean {
	return (
		payload.kind === 'shutdown' ||
		(payload.kind === 'error' && !payload.error.recoverable) ||
		(payload.kind === 'status' &&
			(payload.status === 'idle' ||
				payload.status === 'closed' ||
				payload.status === 'errored'))
	);
}

/**
 * Tests whether an envelope begins the runtime generation or current turn.
 * @param payload - Visible persisted envelope being scanned newest-first.
 * @returns True when older envelopes cannot affect current live activity.
 */
function beginsCurrentActivity(payload: AgentPersistedEnvelope): boolean {
	return (
		payload.kind === 'status' &&
		(payload.status === 'starting' ||
			(payload.status === 'streaming' && payload.previous !== 'streaming'))
	);
}

/**
 * Replays only the active turn to seed unresolved calls for a live snapshot.
 * @param input - Open database and live branch to scan newest-first.
 * @returns Unresolved normalized calls from the current turn only.
 */
function readCurrentTools({
	branchId,
	database,
}: {
	branchId: string;
	database: DatabaseSync;
}): readonly AgentSessionToolActivityWire[] {
	const branch = getAgentSessionBranchById({ database, id: branchId });
	const hiddenRanges = branch ? readHiddenEventRanges(branch.metadata) : [];
	const payloads: AgentPersistedEnvelope[] = [];
	for (const { ordinal, payload } of iterateBranchPayloadsDescending({
		branchId,
		database,
	})) {
		if (isOrdinalHidden(ordinal, hiddenRanges) || !payload) {
			continue;
		}
		if (endsCurrentActivity(payload)) {
			return [];
		}
		payloads.push(payload);
		if (beginsCurrentActivity(payload)) {
			break;
		}
	}
	let state = createAgentActivityState();
	for (const payload of payloads.toReversed()) {
		state = reduceAgentActivity(state, payload);
	}
	return state.currentTools;
}

/**
 * Adds compact live activity, durable lineage, and the newest usable context reading.
 * @param input - Active view, database, and base persisted snapshot.
 * @returns The snapshot enriched for renderer activity surfaces.
 */
export function projectSessionActivity({
	active,
	database,
	snapshot,
}: {
	active: ActiveSessionActivityView | null;
	database: DatabaseSync;
	snapshot: AgentSessionSnapshot;
}): AgentSessionSnapshot {
	const contextUsage = isValidContextUsage(active?.contextUsage)
		? { reading: 'live' as const, usage: active.contextUsage }
		: readLastRecordedContextUsage({
				branchId: snapshot.branchId,
				database,
			});
	return {
		...snapshot,
		activityOrdinal: getMaxOrdinalForBranch({
			branchId: snapshot.branchId,
			database,
		}),
		contextUsage,
		currentTools: active
			? readCurrentTools({ branchId: snapshot.branchId, database })
			: [],
		lineage: resolveAgentSessionLineage({
			database,
			sessionId: snapshot.id,
		}),
	};
}
