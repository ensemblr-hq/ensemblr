const START_CONVERSATION_TOOL = 'ensemblr_start_conversation';
const WAIT_FOR_AGENTS_TOOL = 'ensemblr_wait_for_agents';
const SEND_FOLLOW_UP_TOOL = 'ensemblr_send_follow_up';
const CLOSE_TAB_TOOL = 'ensemblr_close_tab';
const ASK_USER_QUESTION_TOOL = 'ensemblr_ask_user_question';
const NOTIFY_ORCHESTRATOR_TOOL = 'ensemblr_notify_orchestrator';

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
	/** Consecutive auto-resumed turns that settled without running any tool. */
	staleResumes: number;
	/**
	 * A user message cut the last wait short. The barrier stands aside until the
	 * next wait or the end of the turn, so the orchestrator can answer it — in
	 * prose or with any tool — rather than have its reply stripped.
	 */
	userInterjection: boolean;
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

/**
 * How many consecutive turns may settle without a single *permitted* tool call
 * before the barrier stops queueing another one. Two distinct loops end here,
 * and neither is repaired by asking again while each attempt spends a provider
 * call the user is billed for: a turn that produced nothing at all died in the
 * runtime — a provider rate limit, a dropped connection — and a turn whose only
 * calls this barrier refused came from a model that already read the refusal
 * mid-turn and stopped anyway. Repeating the nudge only repeats the refusal.
 */
const MAX_STALE_DELEGATION_RESUMES = 2;

/** Creates an empty delegation barrier. */
export function createDelegationBarrierState(): DelegationBarrierState {
	return {
		children: [],
		operations: [],
		recoveryRequired: false,
		staleResumes: 0,
		userInterjection: false,
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

/**
 * Whether the barrier is blocking work and stripping prose right now: child
 * work is outstanding and no user message has asked it to stand aside.
 * @param state - The barrier as it stands.
 * @returns True when the barrier's guards apply.
 */
export function delegationBarrierEnforced(
	state: DelegationBarrierState,
): boolean {
	return !state.userInterjection && delegationBarrierActive(state);
}

/**
 * Stands the barrier aside for a message addressed to this orchestrator — the
 * user's, or its own orchestrator's — that Pi delivered while child work was
 * outstanding, wherever it landed. A wait the message cut short says the same
 * thing from the app's side; this catches one that arrived at any other
 * boundary, whose answer would otherwise be stripped.
 * @param state - The barrier as the message arrived.
 * @returns The barrier standing aside, or the same state when it was not active.
 */
export function noteDelegationUserMessage(
	state: DelegationBarrierState,
): DelegationBarrierState {
	return delegationBarrierEnforced(state)
		? { ...state, userInterjection: true }
		: state;
}

/**
 * Puts the barrier back once the turn a user message opened it for has ended,
 * so the resumed wait loop runs under its guards again.
 * @param state - The barrier as the turn left it.
 * @returns The barrier with the interjection spent, or the same state when there was none.
 */
export function endDelegationInterjection(
	state: DelegationBarrierState,
): DelegationBarrierState {
	return state.userInterjection ? { ...state, userInterjection: false } : state;
}

/** Whether a premature stop should queue another turn to resume the wait loop. */
export function shouldResumeDelegationWait(
	state: DelegationBarrierState,
): boolean {
	return (
		delegationBarrierActive(state) &&
		!state.waitFailed &&
		!state.recoveryRequired &&
		state.staleResumes < MAX_STALE_DELEGATION_RESUMES
	);
}

/**
 * Counts a turn that settled without a permitted tool call while children were
 * outstanding, so neither a runtime failing every turn nor a model that only
 * retries refused work keeps being asked to resume.
 * @param state - The barrier as it stood when the turn settled.
 * @returns The barrier with one more stale resume against the cap.
 */
export function noteStalledDelegationTurn(
	state: DelegationBarrierState,
): DelegationBarrierState {
	return { ...state, staleResumes: state.staleResumes + 1 };
}

/** Removes assistant findings while preserving tool calls needed to open the barrier. */
export function sanitizeDelegationMessageContent(
	state: DelegationBarrierState,
	content: readonly unknown[],
): readonly unknown[] {
	const nonText = content.filter((block) => recordOf(block).type !== 'text');
	if (nonText.some((block) => recordOf(block).type === 'toolCall')) {
		return nonText;
	}
	return [
		...nonText,
		{
			text:
				state.staleResumes > 0
					? 'Delegated children are still working, but the last turns produced no permitted tool call, so automatic resuming has stopped. Continuing or re-sending this turn picks the wait back up.'
					: 'Delegated children are still working. Waiting for every child before continuing.',
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

/**
 * Checks and records a Pi tool call before it executes, clearing the stale
 * resume count whenever a call is allowed through. A permitted call is the
 * evidence that the turn is doing the orchestration the barrier asked for — a
 * refused one proves only that the model is reachable, which is why a blocked
 * call leaves the count alone — so it is what re-arms automatic resuming.
 * @param state - The barrier as it stood before this call.
 * @param call - The Pi tool call about to execute.
 * @returns The barrier decision for this call, over the updated barrier.
 */
export function beforeDelegationToolCall(
	state: DelegationBarrierState,
	call: DelegationToolCall,
): DelegationToolCallDecision {
	const decision = decideDelegationToolCall(state, call);
	if (decision.blockReason || decision.state.staleResumes === 0) {
		return decision;
	}
	return { ...decision, state: { ...decision.state, staleResumes: 0 } };
}

/** Applies the barrier's guard rules to one Pi tool call. */
function decideDelegationToolCall(
	state: DelegationBarrierState,
	call: DelegationToolCall,
): DelegationToolCallDecision {
	const input = recordOf(call.input);
	const enforced = delegationBarrierEnforced(state);
	if (call.toolName === START_CONVERSATION_TOOL) {
		if (input.peer === true) {
			return enforced ? { blockReason: WORK_BLOCK_REASON, state } : { state };
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
			state: { ...state, userInterjection: false, waitFailed: false },
		};
	}

	if (call.toolName === SEND_FOLLOW_UP_TOOL) {
		const agentSessionId = stringField(input, 'agentSessionId');
		if (!agentSessionId || !hasChild(state, agentSessionId)) {
			return enforced
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

	if (call.toolName === CLOSE_TAB_TOOL && enforced) {
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
		(call.toolName === ASK_USER_QUESTION_TOOL ||
			call.toolName === NOTIFY_ORCHESTRATOR_TOOL) &&
		enforced
	) {
		return state.children.some((child) => child.phase === 'attention')
			? { state }
			: { blockReason: WORK_BLOCK_REASON, state };
	}

	if (enforced || (call.batchStartsChild && !state.userInterjection)) {
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
		return upsertChild(withInterruption(next, data), {
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
		return updateChildPhase(
			withInterruption(next, recordOf(envelope.data)),
			operation.agentSessionId,
			'working',
		);
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
	let next = {
		...state,
		userInterjection: data.interrupted === 'user-message',
		waitFailed: false,
	};
	if (state.recoveryRequired) {
		for (const completed of recordsOf(data.completed)) {
			next = adoptRecoveryChild(
				next,
				completed,
				completedChildPhase(completed),
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
			completedChildPhase(completed),
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

/**
 * Distinguishes informational signals from any signal that may need attention.
 * @param completed - A child included in a successful wait's completed reports.
 * @returns Settled only without a signal or for a known informational signal.
 */
function completedChildPhase(
	completed: Record<string, unknown>,
): DelegatedChild['phase'] {
	if (completed.signal == null) {
		return 'settled';
	}
	const reason = recordOf(completed.signal).reason;
	return reason === 'done' || reason === 'progress' ? 'settled' : 'attention';
}

/**
 * Stands the barrier aside when a `wait: true` spawn or follow-up reports that
 * the user's message cut its wait short, the way an interrupted
 * `ensemblr_wait_for_agents` does.
 * @param state - The barrier after the call's own bookkeeping.
 * @param data - The call's result payload.
 * @returns The barrier, standing aside when the result says it was interrupted.
 */
function withInterruption(
	state: DelegationBarrierState,
	data: Record<string, unknown>,
): DelegationBarrierState {
	return data.interrupted === 'user-message'
		? { ...state, userInterjection: true }
		: state;
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
		staleResumes: staleResumeCount(record.staleResumes),
		userInterjection: false,
		waitFailed: record.waitFailed === true,
	};
}

/**
 * Reads a persisted stale-resume count, treating anything unusable as none so a
 * corrupt snapshot cannot silently disable automatic resuming for the session.
 * @param value - The count as it was read back from the session entry.
 * @returns A whole count within the cap.
 */
function staleResumeCount(value: unknown): number {
	return typeof value === 'number' && Number.isInteger(value) && value > 0
		? Math.min(value, MAX_STALE_DELEGATION_RESUMES)
		: 0;
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
