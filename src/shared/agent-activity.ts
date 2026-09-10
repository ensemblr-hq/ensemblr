import type {
	AgentPersistedEnvelope,
	AgentSessionToolActivityWire,
	AgentWireMessagePart,
	AgentWireMessagePayload,
} from './ipc/contracts/agent-session.ts';

/** Live tool-call projection plus resolved ids that suppress delayed duplicates. */
export interface AgentActivityState {
	currentTools: readonly AgentSessionToolActivityWire[];
	resolvedToolCallIds: ReadonlySet<string>;
}

/**
 * Creates an activity projection, optionally seeded from unresolved snapshot calls.
 * @param tools - Unresolved tools supplied by an initial session snapshot.
 * @returns A fresh activity state with no resolution tombstones.
 */
export function createAgentActivityState(
	tools: readonly AgentSessionToolActivityWire[] = [],
): AgentActivityState {
	const byId = new Map<string, AgentSessionToolActivityWire>();
	for (const tool of tools) {
		byId.set(tool.toolCallId, tool);
	}
	return { currentTools: [...byId.values()], resolvedToolCallIds: new Set() };
}

/**
 * Folds one persisted envelope into the compact unresolved-tool projection.
 * @param state - Current activity projection.
 * @param envelope - Normalized persisted event to apply.
 * @returns The original state for irrelevant events, otherwise the updated projection.
 */
export function reduceAgentActivity(
	state: AgentActivityState,
	envelope: AgentPersistedEnvelope,
): AgentActivityState {
	if (envelope.kind === 'error') {
		return envelope.error.recoverable ? state : settleCurrentTools(state);
	}
	if (envelope.kind === 'shutdown') {
		return settleCurrentTools(state);
	}
	if (envelope.kind === 'status') {
		if (envelope.status === 'starting') {
			return createAgentActivityState();
		}
		if (envelope.status === 'streaming') {
			return envelope.previous !== 'streaming' &&
				state.currentTools.length === 0 &&
				state.resolvedToolCallIds.size > 0
				? createAgentActivityState()
				: state;
		}
		return envelope.status === 'idle' ||
			envelope.status === 'closed' ||
			envelope.status === 'errored'
			? settleCurrentTools(state)
			: state;
	}
	return envelope.kind === 'message'
		? reduceMessagePayload(state, envelope.payload)
		: state;
}

/**
 * Applies normalized tool lifecycle payloads while ignoring prose-only messages.
 * @param state - Current activity projection.
 * @param payload - Normalized message payload to apply.
 * @returns The projected state after this message.
 */
function reduceMessagePayload(
	state: AgentActivityState,
	payload: AgentWireMessagePayload,
): AgentActivityState {
	if (payload.kind === 'tool-result') {
		return resolveTool(state, payload.toolCallId);
	}
	if (payload.kind === 'tool-call' || payload.kind === 'tool-update') {
		return upsertTool(state, payload);
	}
	if (payload.kind !== 'message' || payload.role !== 'assistant') {
		return state;
	}

	let next = state;
	for (const part of payload.parts) {
		if (part.kind === 'tool-result') {
			next = resolveTool(next, part.toolCallId);
		}
	}
	if (payload.endsResponse) {
		return settleCurrentTools(next);
	}
	for (const part of payload.parts) {
		if (part.kind === 'tool-call') {
			next = upsertTool(next, part);
		}
	}
	return next;
}

/**
 * Adds or replaces one unresolved call without changing its parallel-call order.
 * @param state - Current activity projection.
 * @param payload - Tool start or complete presentation replacement.
 * @returns The updated projection, or the original for a resolved or unchanged call.
 */
function upsertTool(
	state: AgentActivityState,
	payload: Extract<
		AgentWireMessagePayload | AgentWireMessagePart,
		{
			kind: 'tool-call' | 'tool-update';
		}
	>,
): AgentActivityState {
	if (state.resolvedToolCallIds.has(payload.toolCallId)) {
		return state;
	}
	const index = state.currentTools.findIndex(
		(tool) => tool.toolCallId === payload.toolCallId,
	);
	const previous = state.currentTools[index];
	const base: AgentSessionToolActivityWire = {
		input: payload.input,
		name: payload.name,
		toolCallId: payload.toolCallId,
	};
	let next = base;
	if (payload.kind === 'tool-update') {
		next = { ...base, presentation: payload.presentation };
	} else if (previous?.presentation !== undefined) {
		next = { ...base, presentation: previous.presentation };
	}
	if (
		previous?.input === next.input &&
		previous.name === next.name &&
		previous.presentation === next.presentation
	) {
		return state;
	}
	if (index < 0) {
		return { ...state, currentTools: [...state.currentTools, next] };
	}
	return {
		...state,
		currentTools: state.currentTools.map((tool, toolIndex) => {
			if (toolIndex === index) {
				return next;
			}
			return tool;
		}),
	};
}

/**
 * Removes a completed call and remembers its id against delayed duplicates.
 * @param state - Current activity projection.
 * @param toolCallId - Completed call identifier.
 * @returns The projection with the call removed and tombstoned.
 */
function resolveTool(
	state: AgentActivityState,
	toolCallId: string,
): AgentActivityState {
	if (state.resolvedToolCallIds.has(toolCallId)) {
		return state;
	}
	return {
		currentTools: state.currentTools.filter(
			(tool) => tool.toolCallId !== toolCallId,
		),
		resolvedToolCallIds: new Set([...state.resolvedToolCallIds, toolCallId]),
	};
}

/**
 * Clears visible calls while retaining their ids as duplicate tombstones.
 * @param state - Current activity projection.
 * @returns The cleared projection, or the original when already empty.
 */
function settleCurrentTools(state: AgentActivityState): AgentActivityState {
	if (state.currentTools.length === 0) {
		return state;
	}
	return {
		currentTools: [],
		resolvedToolCallIds: new Set([
			...state.resolvedToolCallIds,
			...state.currentTools.map((tool) => tool.toolCallId),
		]),
	};
}
