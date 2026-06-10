import type { UIMessage } from 'ai';

import type {
	PiPersistedEnvelope,
	PiSessionEventWire,
	PiWireMessagePart,
	PiWireMessagePayload,
} from '@/shared/ipc';

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
	events: readonly PiSessionEventWire[],
): UIMessage[] {
	const result: UIMessage[] = [];
	let pending: PendingGroup | null = null;

	for (const event of events) {
		pending = handleEvent(event, pending, result);
	}

	if (pending) {
		result.push(finalizeGroup(pending));
	}

	return result;
}

function handleEvent(
	event: PiSessionEventWire,
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

function handleMessageEnvelope(
	event: PiSessionEventWire,
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
	const signature = groupSignature(uiRole);

	const incomingParts = mergeParts(
		[],
		projectMessagePayload(event, envelope.payload),
	);
	if (incomingParts.length === 0) {
		// Nothing to render (e.g., an unknown frame variant). Skip without
		// disturbing any pending group so the timeline stays clean.
		return pending;
	}

	if (!pending || pending.signature !== signature) {
		flush(pending, result);
		return {
			firstEventAt: event.createdAt,
			id: groupIdFromEvent(event, uiRole),
			lastEventAt: event.createdAt,
			parts: incomingParts,
			role: uiRole,
			signature,
		};
	}

	return {
		...pending,
		lastEventAt: event.createdAt,
		parts: mergeParts(pending.parts, incomingParts),
	};
}

/**
 * Projects a single message payload into one or more UI parts. The variant
 * map keeps the renderer ignorant of Pi's wire shapes — the adapter has
 * already normalized them.
 */
function projectMessagePayload(
	event: PiSessionEventWire,
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

function projectMessagePart(
	part: PiWireMessagePart,
	event: PiSessionEventWire,
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

function flush(pending: PendingGroup | null, result: UIMessage[]): void {
	if (!pending) {
		return;
	}
	result.push(finalizeGroup(pending));
}

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
		} satisfies PiTurnMetadata,
		parts,
		role: group.role,
	};
}

/** Turn timing carried on each mapped `UIMessage` for the timer feature. */
export interface PiTurnMetadata {
	firstEventAt: string;
	lastEventAt: string;
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

function groupSignature(role: UIRole): string {
	return `role::${role}`;
}

function groupIdFromEvent(event: PiSessionEventWire, role: UIRole): string {
	// Use the trigger event id so multiple same-role groups within a session
	// (e.g. two user prompts before the next assistant reply) stay unique.
	return `pi-group:${role}:${event.id}`;
}
