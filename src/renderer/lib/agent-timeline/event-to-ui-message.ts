import type { UIMessage } from 'ai';
import {
	buildCustomMessagePart,
	buildSkillPart,
	parseSkillInvocation,
	skillCommandText,
	skillInvocationKey,
} from '@/renderer/lib/pi';
import type {
	AgentNoticeMetadata,
	AgentTurnMetadata,
	PendingGroup,
	UIMessagePart,
	UIRole,
} from '@/renderer/types/agent-timeline';
import type {
	AgentSessionEventWire as AgentEventFrame,
	AgentPersistedEnvelope,
	AgentWireMessagePart,
	AgentWireMessagePayload,
} from '@/shared/ipc/contracts/agent-session';
import {
	buildErrorMessage,
	buildInterruptedMessage,
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

/**
 * Converts the persisted Pi RPC event stream into the AI SDK `UIMessage` shape
 * consumed by the `Conversation` + `Message` primitives.
 *
 * The wire payload is a tagged {@link AgentPersistedEnvelope} union — the
 * normalization happens in the main-process adapter so this mapper just
 * pattern-matches on `payload.kind` and projects each variant to UI parts via
 * the concern-specific sub-mappers.
 *
 * Grouping rule: consecutive renderable `message` events that share the same
 * `turnId` and the same UI role collapse into a single `UIMessage`. Lifecycle,
 * metadata, status, shutdown, unknown, stderr, and recoverable-error rows are
 * skipped so runtime bookkeeping does not appear as chat content. Only fatal
 * errors remain, as compact system messages for the timeline renderer.
 */
export function eventsToUIMessages(
	events: readonly AgentEventFrame[],
): UIMessage[] {
	const result: UIMessage[] = [];
	let pending: PendingGroup | null = null;

	for (const event of events) {
		pending = handleEvent(event, pending, result);
	}

	if (pending) {
		result.push(finalizeGroup(pending));
	}

	return withPromptTimes(
		relocateSkillInvocations(dropFlushedSkillDuplicates(result)),
	);
}

/**
 * Reads the turn a message belongs to, as the key used to scope skill dedup.
 * Null is a key in its own right: messages carrying no turn metadata bucket
 * together and cannot be mistaken for a real turn.
 * @param message - The finalized message to inspect
 * @returns The message's turn id, or null when it carries no turn metadata
 */
function dedupTurnKey(message: UIMessage): string | null {
	return turnMetadataOf(message)?.turnId ?? null;
}

/**
 * Drops the raw `/skill:name` user message the adapter re-emits on shutdown when
 * a matching `<skill>` echo is already in the stream. Pi only ever persists the
 * expanded block, so a raw typed skill prompt is a shutdown-flush artifact; kept
 * only when it stands alone (a turn interrupted before Pi echoed it), so an
 * early-cancelled prompt is never lost.
 *
 * Scoped per turn, not per conversation: invoking the same skill with the same
 * arguments again later produces the same key, so a session-wide set would read
 * the second, interrupted invocation as a duplicate of the first and silently
 * drop the user's prompt.
 * @param messages - The finalized messages to filter
 * @returns The messages with flushed skill duplicates removed
 */
function dropFlushedSkillDuplicates(
	messages: readonly UIMessage[],
): UIMessage[] {
	const expandedKeysByTurn = new Map<string | null, Set<string>>();
	for (const message of messages) {
		if (message.role !== 'user') {
			continue;
		}
		const text = joinTextParts(message);
		if (!parseSkillInvocation(text).skill) {
			continue;
		}
		const key = skillInvocationKey(text);
		if (!key) {
			continue;
		}
		const turnKey = dedupTurnKey(message);
		const keys = expandedKeysByTurn.get(turnKey) ?? new Set<string>();
		keys.add(key);
		expandedKeysByTurn.set(turnKey, keys);
	}
	if (expandedKeysByTurn.size === 0) {
		return [...messages];
	}
	return messages.filter((message) => {
		if (message.role !== 'user') {
			return true;
		}
		const text = joinTextParts(message);
		if (parseSkillInvocation(text).skill) {
			return true;
		}
		const key = skillInvocationKey(text);
		if (key === null) {
			return true;
		}
		return !expandedKeysByTurn.get(dedupTurnKey(message))?.has(key);
	});
}

/**
 * Rewrites each skill prompt Pi expanded into a `<skill>` block back to the
 * `/skill:name` command the user typed, and moves the skill into the assistant
 * turn it opened as a "Skill activated" marker. The prompt then reads as a
 * normal bubble and the skill folds into the turn's activity instead of standing
 * above it as the whole `SKILL.md`.
 * @param messages - The finalized messages to transform
 * @returns The messages with skill prompts rewritten and their markers relocated
 */
function relocateSkillInvocations(messages: readonly UIMessage[]): UIMessage[] {
	const result: UIMessage[] = [];
	let pending: { name: string; source: UIMessage } | null = null;
	for (const message of messages) {
		if (pending) {
			if (message.role === 'assistant') {
				result.push({
					...message,
					parts: [buildSkillPart(pending.name), ...message.parts],
				});
				pending = null;
				continue;
			}
			result.push(skillActivationRow(pending.name, pending.source));
			pending = null;
		}
		if (message.role !== 'user') {
			result.push(message);
			continue;
		}
		const { skill, text } = parseSkillInvocation(joinTextParts(message));
		if (!skill) {
			result.push(message);
			continue;
		}
		result.push({
			...message,
			parts: [
				{
					state: 'done',
					text: skillCommandText(skill.name, text),
					type: 'text',
				},
			],
		});
		pending = { name: skill.name, source: message };
	}
	return result;
}

/**
 * Builds the standalone assistant row that carries a skill marker when the
 * message following the prompt is not an assistant turn — a fatally errored or
 * interrupted turn. Without it the activation is lost, since `system` and
 * `user` rows render their text and ignore their parts. A skill prompt that is
 * still the last message gets no row: its turn may yet be streaming, and
 * emitting one would flash a marker that the arriving turn immediately absorbs.
 * @param name - The activated skill's name
 * @param source - The user message that invoked it, whose turn metadata the row inherits
 * @returns An assistant message carrying only the skill marker
 */
function skillActivationRow(name: string, source: UIMessage): UIMessage {
	return {
		id: `${source.id}-skill`,
		metadata: source.metadata,
		parts: [buildSkillPart(name)],
		role: 'assistant',
	};
}

/**
 * Joins the text parts of a message into one string.
 * @param message - The message to read
 * @returns The concatenated text of every text part
 */
function joinTextParts(message: UIMessage): string {
	return message.parts
		.flatMap((part) => (part.type === 'text' && part.text ? [part.text] : []))
		.join('\n');
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
 * pending group before emitting a standalone fatal-error message.
 * @param event - The persisted Pi event frame being processed
 * @param pending - The group currently being accumulated, or null when none is open
 * @param result - Accumulator of finalized UI messages, appended in place
 * @returns The still-open pending group, or null when the event closed it
 */
function handleEvent(
	event: AgentEventFrame,
	pending: PendingGroup | null,
	result: UIMessage[],
): PendingGroup | null {
	if (event.stream === 'stderr') {
		return pending;
	}

	const envelope = event.payload;
	if (!envelope) {
		return pending;
	}

	switch (envelope.kind) {
		case 'message':
			return handleMessageEnvelope(event, envelope, pending, result);
		case 'error': {
			const errorMessage = buildErrorMessage(event, envelope);
			if (!errorMessage) {
				return pending;
			}
			flush(pending, result);
			result.push(errorMessage);
			return null;
		}
		case 'shutdown': {
			const noticeMessage = buildInterruptedMessage(event, envelope);
			if (!noticeMessage) {
				return pending;
			}
			flush(pending, result);
			result.push(noticeMessage);
			return null;
		}
		case 'context-usage':
		case 'status':
		case 'metadata':
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
	event: AgentEventFrame,
	envelope: Extract<AgentPersistedEnvelope, { kind: 'message' }>,
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
	event: AgentEventFrame,
	payload: AgentWireMessagePayload,
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
		case 'custom':
			return payload.text
				? [
						buildCustomMessagePart({
							customType: payload.customType,
							display: payload.display,
							text: payload.text,
						}),
					]
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
	part: AgentWireMessagePart,
	event: AgentEventFrame,
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
		} satisfies AgentTurnMetadata,
		parts,
		role: group.role,
	};
}

/**
 * Reads the lifecycle-notice marker back off a mapped system message, if present.
 * @param message - The mapped message to inspect
 * @returns The notice metadata, or null when the message carries none
 */
export function noticeMetadataOf(
	message: UIMessage,
): AgentNoticeMetadata | null {
	const metadata = message.metadata;
	if (
		metadata &&
		typeof metadata === 'object' &&
		'notice' in metadata &&
		(metadata as AgentNoticeMetadata).notice === 'interrupted'
	) {
		return metadata as AgentNoticeMetadata;
	}
	return null;
}

/** Reads the timing metadata back off a mapped message, if present. */
export function turnMetadataOf(message: UIMessage): AgentTurnMetadata | null {
	const metadata = message.metadata;
	if (
		metadata &&
		typeof metadata === 'object' &&
		'firstEventAt' in metadata &&
		typeof (metadata as AgentTurnMetadata).firstEventAt === 'string' &&
		'lastEventAt' in metadata &&
		typeof (metadata as AgentTurnMetadata).lastEventAt === 'string'
	) {
		return metadata as AgentTurnMetadata;
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
function groupIdFromEvent(event: AgentEventFrame, role: UIRole): string {
	// Use the trigger event id so multiple same-role groups within a chat
	// (e.g. two user prompts before the next assistant reply) stay unique.
	return `pi-group:${role}:${event.id}`;
}
