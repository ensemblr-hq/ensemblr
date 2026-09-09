const START_CONVERSATION_TOOL = 'ensemblr_start_conversation';
const WAIT_FOR_AGENTS_TOOL = 'ensemblr_wait_for_agents';
const SEND_FOLLOW_UP_TOOL = 'ensemblr_send_follow_up';
const CLOSE_TAB_TOOL = 'ensemblr_close_tab';
const ASK_USER_QUESTION_TOOL = 'ensemblr_ask_user_question';

/** A child tracked until the orchestrator has observed its final settled turn. */
export interface DelegatedChild {
	agentSessionId: string;
	chatTabId: string | null;
	phase: 'working' | 'attention' | 'settled';
}

type DelegationOperation =
	| {
			kind: 'start';
			toolCallId: string;
	  }
	| {
			agentSessionId: string;
			kind: 'follow-up';
			toolCallId: string;
	  };

/** Serializable state held by the Pi extension's root-only delegation barrier. */
export interface DelegationBarrierState {
	children: readonly DelegatedChild[];
	operations: readonly DelegationOperation[];
	recoveryRequired: boolean;
	waitFailed: boolean;
}

/** Input known for each Pi tool-call lifecycle event. */
export interface DelegationToolCall {
	batchStartsChild: boolean;
	input: unknown;
	toolCallId: string;
	toolName: string;
}

/** Result known after a Pi tool has completed. */
export interface DelegationToolResult {
	details: unknown;
	input: unknown;
	toolCallId: string;
	toolName: string;
}

/** Outcome of checking one tool call against the barrier. */
export interface DelegationToolCallDecision {
	blockReason?: string;
	clearWaitTargets?: boolean;
	input?: Record<string, unknown>;
	state: DelegationBarrierState;
}

interface ControlResult {
	data?: unknown;
	ok: boolean;
}

const WORK_BLOCK_REASON =
	'Delegated children are still working. Call ensemblr_wait_for_agents and observe every child settled before doing more work or presenting findings.';
const BATCH_BLOCK_REASON =
	'A child is being spawned in this same tool batch. Finish the parallel spawn calls first; unrelated work must wait for the children.';
const RACING_WAIT_REASON =
	'Child spawn calls in this tool batch have not returned their session ids yet. Call ensemblr_wait_for_agents in the next turn so it can wait on every child.';

/** Creates an empty delegation barrier. */
export function createDelegationBarrierState(): DelegationBarrierState {
	return {
		children: [],
		operations: [],
		recoveryRequired: false,
		waitFailed: false,
	};
}

/** Whether child work or a child-producing call still has to settle. */
export function delegationBarrierActive(
	state: DelegationBarrierState,
): boolean {
	return (
		state.recoveryRequired ||
		state.operations.length > 0 ||
		state.children.some((child) => child.phase !== 'settled')
	);
}

/** Whether a premature stop should queue another turn to resume the wait loop. */
export function shouldResumeDelegationWait(
	state: DelegationBarrierState,
): boolean {
	return (
		delegationBarrierActive(state) &&
		!state.waitFailed &&
		!state.recoveryRequired
	);
}

/** Removes assistant findings while preserving tool calls needed to open the barrier. */
export function sanitizeDelegationMessageContent(
	content: readonly unknown[],
): readonly unknown[] {
	const nonText = content.filter((block) => recordOf(block).type !== 'text');
	if (nonText.some((block) => recordOf(block).type === 'toolCall')) {
		return nonText;
	}
	return [
		...nonText,
		{
			text: 'Delegated children are still working. Waiting for every child before continuing.',
			type: 'text',
		},
	];
}

/** Returns the active children an enforced all-child wait must target. */
export function outstandingDelegatedChildren(
	state: DelegationBarrierState,
): readonly string[] {
	return state.children.flatMap((child) =>
		child.phase === 'settled' ? [] : [child.agentSessionId],
	);
}

/** Checks and records a Pi tool call before it executes. */
export function beforeDelegationToolCall(
	state: DelegationBarrierState,
	call: DelegationToolCall,
): DelegationToolCallDecision {
	const input = recordOf(call.input);
	if (call.toolName === START_CONVERSATION_TOOL) {
		if (input.peer === true) {
			return delegationBarrierActive(state)
				? { blockReason: WORK_BLOCK_REASON, state }
				: { state };
		}
		return {
			state: {
				...state,
				operations: [
					...state.operations,
					{ kind: 'start', toolCallId: call.toolCallId },
				],
				waitFailed: false,
			},
		};
	}

	if (call.toolName === WAIT_FOR_AGENTS_TOOL) {
		if (
			call.batchStartsChild ||
			state.operations.some((operation) => operation.kind === 'start')
		) {
			return { blockReason: RACING_WAIT_REASON, state };
		}
		const targets = outstandingDelegatedChildren(state);
		let waitInput = input;
		if (targets.length > 0) {
			waitInput = { ...input, mode: 'all', targets: [...targets] };
		} else if (state.recoveryRequired) {
			waitInput = { mode: 'all' };
		}
		return {
			clearWaitTargets: state.recoveryRequired,
			input: waitInput,
			state: { ...state, waitFailed: false },
		};
	}

	if (call.toolName === SEND_FOLLOW_UP_TOOL) {
		const agentSessionId = stringField(input, 'agentSessionId');
		if (!agentSessionId || !hasChild(state, agentSessionId)) {
			return delegationBarrierActive(state)
				? {
						blockReason:
							'Only a tracked child can receive a follow-up while delegated work is outstanding.',
						state,
					}
				: { state };
		}
		return {
			state: {
				...state,
				operations: [
					...state.operations,
					{ agentSessionId, kind: 'follow-up', toolCallId: call.toolCallId },
				],
				waitFailed: false,
			},
		};
	}

	if (call.toolName === CLOSE_TAB_TOOL && delegationBarrierActive(state)) {
		const chatTabId = stringField(input, 'chatTabId');
		return state.children.some((child) => child.chatTabId === chatTabId)
			? { state }
			: {
					blockReason:
						'Only a tracked child tab can be closed while delegated work is outstanding.',
					state,
				};
	}

	if (
		call.toolName === ASK_USER_QUESTION_TOOL &&
		delegationBarrierActive(state)
	) {
		return state.children.some((child) => child.phase === 'attention')
			? { state }
			: { blockReason: WORK_BLOCK_REASON, state };
	}

	if (delegationBarrierActive(state) || call.batchStartsChild) {
		return {
			blockReason: call.batchStartsChild
				? BATCH_BLOCK_REASON
				: WORK_BLOCK_REASON,
			state,
		};
	}
	return { state };
}

/** Applies a completed Pi tool result to the delegation barrier. */
export function afterDelegationToolResult(
	state: DelegationBarrierState,
	result: DelegationToolResult,
): DelegationBarrierState {
	if (result.toolName === START_CONVERSATION_TOOL) {
		const operation = state.operations.find(
			(candidate) =>
				candidate.kind === 'start' &&
				candidate.toolCallId === result.toolCallId,
		);
		if (!operation) {
			return state;
		}
		const next = withoutOperation(state, result.toolCallId);
		const envelope = controlResultOf(result.details);
		const data = recordOf(envelope?.data);
		const agentSessionId = stringField(data, 'agentSessionId');
		const chatTabId = stringField(data, 'chatTabId');
		if (!envelope?.ok || !agentSessionId || !chatTabId) {
			return next;
		}
		return upsertChild(next, {
			agentSessionId,
			chatTabId,
			phase: 'working',
		});
	}

	if (result.toolName === SEND_FOLLOW_UP_TOOL) {
		const operation = state.operations.find(
			(candidate) =>
				candidate.kind === 'follow-up' &&
				candidate.toolCallId === result.toolCallId,
		);
		if (operation?.kind !== 'follow-up') {
			return state;
		}
		const next = withoutOperation(state, result.toolCallId);
		const envelope = controlResultOf(result.details);
		if (!envelope?.ok) {
			return next;
		}
		return updateChildPhase(next, operation.agentSessionId, 'working');
	}

	if (result.toolName !== WAIT_FOR_AGENTS_TOOL) {
		return state;
	}
	const envelope = controlResultOf(result.details);
	if (!envelope) {
		return state;
	}
	if (!envelope.ok) {
		return { ...state, waitFailed: true };
	}
	const data = recordOf(envelope.data);
	let next = { ...state, waitFailed: false };
	if (state.recoveryRequired) {
		for (const completed of recordsOf(data.completed)) {
			next = adoptRecoveryChild(
				next,
				completed,
				completed.signal == null ? 'settled' : 'attention',
			);
		}
		for (const pending of recordsOf(data.pending)) {
			next = adoptRecoveryChild(next, pending, 'working');
		}
	}
	for (const completed of recordsOf(data.completed)) {
		const agentSessionId = stringField(completed, 'agentSessionId');
		if (!agentSessionId || !hasChild(next, agentSessionId)) {
			continue;
		}
		next = updateChildPhase(
			next,
			agentSessionId,
			completed.signal == null ? 'settled' : 'attention',
		);
	}
	for (const pending of recordsOf(data.pending)) {
		const agentSessionId = stringField(pending, 'agentSessionId');
		if (agentSessionId && hasChild(next, agentSessionId)) {
			next = updateChildPhase(next, agentSessionId, 'working');
		}
	}
	if (
		next.recoveryRequired &&
		next.children.some((child) => child.chatTabId === null) &&
		next.children
			.filter((child) => child.chatTabId === null)
			.every((child) => child.phase === 'settled')
	) {
		next = { ...next, recoveryRequired: false };
	}
	return next;
}

/** Adopts a child returned by a recovery wait without inventing a tab id. */
function adoptRecoveryChild(
	state: DelegationBarrierState,
	value: Record<string, unknown>,
	phase: DelegatedChild['phase'],
): DelegationBarrierState {
	const agentSessionId = stringField(value, 'agentSessionId');
	return agentSessionId && !hasChild(state, agentSessionId)
		? upsertChild(state, { agentSessionId, chatTabId: null, phase })
		: state;
}

/** Restores a persisted snapshot, falling back to a closed barrier on bad data. */
export function restoreDelegationBarrierState(
	value: unknown,
): DelegationBarrierState {
	const record = recordOf(value);
	if (!Array.isArray(record.children) || !Array.isArray(record.operations)) {
		return createDelegationBarrierState();
	}
	const children: DelegatedChild[] = [];
	for (const candidate of record.children) {
		const child = recordOf(candidate);
		const agentSessionId = stringField(child, 'agentSessionId');
		const chatTabId =
			child.chatTabId === null ? null : stringField(child, 'chatTabId');
		const phase = child.phase;
		if (
			!agentSessionId ||
			(chatTabId !== null && !chatTabId) ||
			(phase !== 'working' && phase !== 'attention' && phase !== 'settled')
		) {
			return createDelegationBarrierState();
		}
		children.push({ agentSessionId, chatTabId, phase });
	}
	return {
		children,
		operations: [],
		recoveryRequired:
			record.recoveryRequired === true || record.operations.length > 0,
		waitFailed: record.waitFailed === true,
	};
}

/** Reads a record-shaped value without trusting its fields. */
function recordOf(value: unknown): Record<string, unknown> {
	return typeof value === 'object' && value !== null
		? (value as Record<string, unknown>)
		: {};
}

/** Reads one non-empty string field from an untrusted record. */
function stringField(
	record: Record<string, unknown>,
	key: string,
): string | null {
	const value = record[key];
	return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Reads the app's control envelope from a Pi tool-result details value. */
function controlResultOf(value: unknown): ControlResult | null {
	const record = recordOf(value);
	return typeof record.ok === 'boolean'
		? { data: record.data, ok: record.ok }
		: null;
}

/** Reads only record-shaped members from an untrusted array field. */
function recordsOf(value: unknown): readonly Record<string, unknown>[] {
	return Array.isArray(value) ? value.map(recordOf) : [];
}

/** Whether the barrier knows a child by session id. */
function hasChild(
	state: DelegationBarrierState,
	agentSessionId: string,
): boolean {
	return state.children.some(
		(child) => child.agentSessionId === agentSessionId,
	);
}

/** Replaces or appends one child without mutating the current snapshot. */
function upsertChild(
	state: DelegationBarrierState,
	child: DelegatedChild,
): DelegationBarrierState {
	if (!hasChild(state, child.agentSessionId)) {
		return { ...state, children: [...state.children, child] };
	}
	const children = state.children.map((current) => {
		if (current.agentSessionId === child.agentSessionId) {
			return child;
		}
		return current;
	});
	return { ...state, children };
}

/** Changes one tracked child's phase without mutating the current snapshot. */
function updateChildPhase(
	state: DelegationBarrierState,
	agentSessionId: string,
	phase: DelegatedChild['phase'],
): DelegationBarrierState {
	return {
		...state,
		children: state.children.map((child) =>
			child.agentSessionId === agentSessionId ? { ...child, phase } : child,
		),
	};
}

/** Drops an in-flight operation once its matching result arrives. */
function withoutOperation(
	state: DelegationBarrierState,
	toolCallId: string,
): DelegationBarrierState {
	return {
		...state,
		operations: state.operations.filter(
			(operation) => operation.toolCallId !== toolCallId,
		),
	};
}
