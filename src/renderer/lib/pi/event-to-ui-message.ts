import type { UIMessage } from 'ai';

import type {
	PiSessionEventWire as PiEventFrame,
	PiPersistedEnvelope,
	PiWireMessagePart,
	PiWireMessagePayload,
} from '@/shared/ipc/contracts/pi-session';

import {
	buildErrorMessage,
	buildStderrMessage,
} from './diagnostic-event-mapper';
import {
	dropStreamingPartsOfType,
	isDoneTextPart,
	isStreamingTextPart,
	mergeStreamingTextPart,
} from './text-event-mapper';
import {
	buildToolCallPart,
	buildToolResultPart,
	mergeToolPart,
} from './tool-event-mapper';
import type { PendingGroup, UIMessagePart, UIRole } from './types';

/**
 * Converts the persisted Pi RPC event stream into the AI SDK `UIMessage` shape
 * consumed by the `Conversation` + `Message` primitives.
 *
 * The wire payload is a tagged {@link PiPersistedEnvelope} union — the
 * normalization happens in the main-process adapter so this mapper just
 * pattern-matches on `payload.kind` and projects each variant to UI parts via
 * the concern-specific sub-mappers.
 *
 * Grouping rule: consecutive renderable `message` events that share the same
 * `turnId` and the same UI role collapse into a single `UIMessage`. Lifecycle,
 * metadata, status, shutdown, unknown, and no-op rows are skipped so runtime
 * bookkeeping does not appear as chat content. Actionable errors and stderr
 * diagnostics remain as compact system messages for the timeline renderer.
 */
export function eventsToUIMessages(
	events: readonly PiEventFrame[],
): UIMessage[] {
	const result: UIMessage[] = [];
	let pending: PendingGroup | null = null;

	for (const event of events) {
		pending = handleEvent(event, pending, result);
	}

	if (pending) {
		result.push(finalizeGroup(pending));
	}

	return withPromptTimes(result);
}

/**
 * Stamps each assistant turn with the submit time of the user prompt that
 * preceded it. Walks the finalized messages in order, tracking the latest
 * user-message timestamp, so the turn timer can span prompt → final answer.
 */
function withPromptTimes(messages: readonly UIMessage[]): UIMessage[] {
	let lastUserAt: string | undefined;
	return messages.map((message) => {
		const metadata = turnMetadataOf(message);
		if (message.role === 'user') {
			if (metadata) {
				lastUserAt = metadata.firstEventAt;
			}
			return message;
		}
		if (message.role === 'assistant' && metadata && lastUserAt) {
			return {
				...message,
				metadata: { ...metadata, promptAt: lastUserAt },
			};
		}
		return message;
	});
}

/**
 * Routes one persisted Pi event to the appropriate handler, flushing the
 * pending group before emitting standalone stderr or error messages.
 * @param event - The persisted Pi event frame being processed
 * @param pending - The group currently being accumulated, or null when none is open
 * @param result - Accumulator of finalized UI messages, appended in place
 * @returns The still-open pending group, or null when the event closed it
 */
function handleEvent(
	event: PiEventFrame,
	pending: PendingGroup | null,
	result: UIMessage[],
): PendingGroup | null {
	if (event.stream === 'stderr') {
		const stderrMessage = buildStderrMessage(event);
		if (!stderrMessage) {
			return pending;
		}
		flush(pending, result);
		result.push(stderrMessage);
		return null;
	}

	const envelope = event.payload;
	if (!envelope) {
		return pending;
	}

	switch (envelope.kind) {
		case 'message':
			return handleMessageEnvelope(event, envelope, pending, result);
		case 'error':
			flush(pending, result);
			result.push(buildErrorMessage(event, envelope));
			return null;
		case 'context-usage':
		case 'status':
		case 'metadata':
		case 'shutdown':
			return pending;
		default: {
			// Exhaustiveness guard: a future variant should be added above.
			const exhaustive: never = envelope;
			void exhaustive;
			return pending;
		}
	}
}

/**
 * Folds a renderable `message` envelope into the pending group, opening a new
 * group when the role changes; user prompts also key on event id so
 * back-to-back submissions stay in separate bubbles.
 * @param event - The persisted Pi event frame carrying the message
 * @param envelope - The `message` variant of the persisted envelope
 * @param pending - The group currently being accumulated, or null when none is open
 * @param result - Accumulator of finalized UI messages, appended in place
 * @returns The pending group after folding in the message, unchanged when nothing rendered
 */
function handleMessageEnvelope(
	event: PiEventFrame,
	envelope: Extract<PiPersistedEnvelope, { kind: 'message' }>,
	pending: PendingGroup | null,
	result: UIMessage[],
): PendingGroup | null {
	const uiRole: UIRole = envelope.role === 'user' ? 'user' : 'assistant';
	// Group by role only. Pi's wire frames carry inconsistent turn ids —
	// tool_execution_* frames fall back to toolCallId, message frames use
	// message ids — so keying on turnId fractures one logical assistant turn
	// into dozens of single-part messages. A run of consecutive
	// assistant/tool events IS the turn; user messages and errors flush it.
	//
	// User prompts never merge with each other: each submission is a distinct
	// input and gets its own bubble. Keying user groups by event id keeps
	// back-to-back prompts (e.g. while a turn errors and retries) from stacking
	// into a single bubble. Assistant/tool runs still collapse into one turn.
	const groupKey =
		uiRole === 'user'
			? `${groupKeyFor(uiRole)}::${event.id}`
			: groupKeyFor(uiRole);

	const incomingParts = mergeParts(
		[],
		projectMessagePayload(event, envelope.payload),
	);
	if (incomingParts.length === 0) {
		// Nothing to render (e.g., an unknown frame variant). Skip without
		// disturbing any pending group so the timeline stays clean.
		return pending;
	}

	if (!pending || pending.groupKey !== groupKey) {
		flush(pending, result);
		return {
			firstEventAt: event.createdAt,
			id: groupIdFromEvent(event, uiRole),
			lastEventAt: event.createdAt,
			lastOrdinal: event.ordinal,
			parts: incomingParts,
			role: uiRole,
			groupKey,
			turnId: event.turnId,
		};
	}

	return {
		...pending,
		lastEventAt: event.createdAt,
		lastOrdinal: Math.max(pending.lastOrdinal, event.ordinal),
		parts: mergeParts(pending.parts, incomingParts),
		turnId: pending.turnId ?? event.turnId,
	};
}

/**
 * Projects a single message payload into one or more UI parts. The variant
 * map keeps the renderer ignorant of Pi's wire shapes — the adapter has
 * already normalized them.
 */
function projectMessagePayload(
	event: PiEventFrame,
	payload: PiWireMessagePayload,
): UIMessagePart[] {
	switch (payload.kind) {
		case 'text':
			return payload.text
				? [{ state: 'done', text: payload.text, type: 'text' }]
				: [];
		case 'reasoning':
			return payload.text
				? [{ state: 'done', text: payload.text, type: 'reasoning' }]
				: [];
		case 'text-delta':
			return payload.text
				? [{ state: 'streaming', text: payload.text, type: 'text' }]
				: [];
		case 'reasoning-delta':
			return payload.text
				? [{ state: 'streaming', text: payload.text, type: 'reasoning' }]
				: [];
		case 'prompt':
			return payload.prompt
				? [{ state: 'done', text: payload.prompt, type: 'text' }]
				: [];
		case 'tool-call':
			return [buildToolCallPart(payload, event)];
		case 'tool-result':
			return [buildToolResultPart(payload, event)];
		case 'message':
			return payload.parts.flatMap((part) => projectMessagePart(part, event));
		case 'unknown':
			return [];
		default: {
			const exhaustive: never = payload;
			void exhaustive;
			return [];
		}
	}
}

/**
 * Projects one part of a composite `message` payload into UI parts, covering
 * text, reasoning, and tool call/result variants.
 * @param part - A single wire message part
 * @param event - The persisted Pi event frame the part belongs to
 * @returns The UI parts for this part, or an empty array when it has no content
 */
function projectMessagePart(
	part: PiWireMessagePart,
	event: PiEventFrame,
): UIMessagePart[] {
	switch (part.kind) {
		case 'text':
			return part.text
				? [{ state: 'done', text: part.text, type: 'text' }]
				: [];
		case 'reasoning':
			return part.text
				? [{ state: 'done', text: part.text, type: 'reasoning' }]
				: [];
		case 'tool-call':
			return [buildToolCallPart(part, event)];
		case 'tool-result':
			return [buildToolResultPart(part, event)];
		default: {
			const exhaustive: never = part;
			void exhaustive;
			return [];
		}
	}
}

/**
 * Folds `incomingParts` into `existingParts`, delegating to the concern-
 * specific mergers for streaming text, finalized text, and tool-output pairing.
 */
function mergeParts(
	existingParts: readonly UIMessagePart[],
	incomingParts: readonly UIMessagePart[],
): UIMessagePart[] {
	let merged: UIMessagePart[] = [...existingParts];
	for (const incomingPart of incomingParts) {
		if (isStreamingTextPart(incomingPart)) {
			merged = mergeStreamingTextPart(merged, incomingPart);
			continue;
		}
		if (isDoneTextPart(incomingPart)) {
			merged = dropStreamingPartsOfType(merged, incomingPart.type);
			merged.push(incomingPart);
			continue;
		}
		const toolMerged = mergeToolPart(merged, incomingPart);
		if (toolMerged !== null) {
			merged = toolMerged;
			continue;
		}
		merged.push(incomingPart);
	}
	return merged;
}

/**
 * Finalizes the pending group when one is open and appends it to the result.
 * @param pending - The group currently being accumulated, or null when none is open
 * @param result - Accumulator of finalized UI messages, appended in place
 */
function flush(pending: PendingGroup | null, result: UIMessage[]): void {
	if (!pending) {
		return;
	}
	result.push(finalizeGroup(pending));
}

/**
 * Converts an accumulated pending group into a finalized `UIMessage`,
 * substituting an empty text part when the group produced none.
 * @param group - The accumulated pending group to finalize
 * @returns The finalized UI message carrying turn timing metadata
 */
function finalizeGroup(group: PendingGroup): UIMessage {
	const parts =
		group.parts.length > 0
			? group.parts
			: ([{ state: 'done', text: '', type: 'text' }] satisfies UIMessagePart[]);
	return {
		id: group.id,
		metadata: {
			firstEventAt: group.firstEventAt,
			lastEventAt: group.lastEventAt,
			lastOrdinal: group.lastOrdinal,
			turnId: group.turnId,
		} satisfies PiTurnMetadata,
		parts,
		role: group.role,
	};
}

/** Turn timing carried on each mapped `UIMessage` for the timer feature. */
export interface PiTurnMetadata {
	/**
	 * Submit time of the user prompt that opened this turn, when known. Used as
	 * the turn-timer start so the elapsed time spans prompt → final answer
	 * (reasoning + tool calls included), not just the first assistant event.
	 * Only set on assistant turns.
	 */
	promptAt?: string;
	firstEventAt: string;
	lastEventAt: string;
	/** Highest persisted-event ordinal in the turn — the fork boundary. */
	lastOrdinal: number;
	/** Persisted `pi_turns` id backing this group; keys checkpoint lookups. */
	turnId: string | null;
}

/** Reads the timing metadata back off a mapped message, if present. */
export function turnMetadataOf(message: UIMessage): PiTurnMetadata | null {
	const metadata = message.metadata;
	if (
		metadata &&
		typeof metadata === 'object' &&
		'firstEventAt' in metadata &&
		typeof (metadata as PiTurnMetadata).firstEventAt === 'string' &&
		'lastEventAt' in metadata &&
		typeof (metadata as PiTurnMetadata).lastEventAt === 'string'
	) {
		return metadata as PiTurnMetadata;
	}
	return null;
}

/**
 * Builds the grouping key that collapses consecutive same-role events.
 * @param role - The UI role of the events being grouped
 * @returns The role-scoped group key
 */
function groupKeyFor(role: UIRole): string {
	return `role::${role}`;
}

/**
 * Derives a stable, unique id for a message group from its trigger event so
 * multiple same-role groups within one chat stay distinct.
 * @param event - The event that opened the group
 * @param role - The UI role of the group
 * @returns A unique group id keyed by role and event id
 */
function groupIdFromEvent(event: PiEventFrame, role: UIRole): string {
	// Use the trigger event id so multiple same-role groups within a chat
	// (e.g. two user prompts before the next assistant reply) stay unique.
	return `pi-group:${role}:${event.id}`;
}
