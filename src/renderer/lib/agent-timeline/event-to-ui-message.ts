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
import { parentToolCallIdOf } from './subagent-parts.ts';
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
	return createTimelineProjector()(events);
}

/**
 * Resumable state of one projection: the exact event run already folded, the
 * messages it produced, and the group left open at its end.
 */
interface ProjectionCursor {
	folded: readonly AgentEventFrame[];
	pending: PendingGroup | null;
	result: readonly UIMessage[];
}

/**
 * One derived message per source message, held alongside the key it was derived
 * under so a changed key rebuilds instead of serving a stale object.
 */
type MessageDerivationCache = WeakMap<
	UIMessage,
	{ derived: UIMessage; key: string }
>;

/**
 * Per-projector caches, one per derivation the finalize passes apply. Together
 * they keep every settled message referentially stable across the re-projections
 * a streaming turn triggers, which is what lets the timeline memoize its rows.
 */
interface TimelineDecorations {
	promptTime: MessageDerivationCache;
	skillActivation: MessageDerivationCache;
	skillCommand: MessageDerivationCache;
	skillMarker: MessageDerivationCache;
}

/** A skill prompt awaiting the turn its marker belongs to. */
interface SkillActivation {
	name: string;
	source: UIMessage;
}

const EMPTY_CURSOR: ProjectionCursor = {
	folded: [],
	pending: null,
	result: [],
};

/**
 * Builds a projector that folds only the events which arrived since its last
 * call, so a streaming turn costs one delta of work per delta rather than
 * refolding the whole branch. Re-mapping every event on every token is what
 * pushes a long conversation past the frame budget mid-stream; the settled
 * messages it returns also keep their identity, so only the live turn
 * re-renders.
 *
 * Hold one projector per timeline for the component's lifetime. Handing it an
 * unrelated event run is safe — it detects the break and refolds from the start.
 * @returns A projector mapping an event run to the timeline's messages.
 */
export function createTimelineProjector(): (
	events: readonly AgentEventFrame[],
) => UIMessage[] {
	const decorations: TimelineDecorations = {
		promptTime: new WeakMap(),
		skillActivation: new WeakMap(),
		skillCommand: new WeakMap(),
		skillMarker: new WeakMap(),
	};
	let cursor = EMPTY_CURSOR;

	return (events) => {
		const resumed = canResumeProjection(cursor, events);
		const result: UIMessage[] = resumed ? [...cursor.result] : [];
		let pending = resumed ? cursor.pending : null;

		for (const event of events.slice(resumed ? cursor.folded.length : 0)) {
			pending = handleEvent(event, pending, result);
		}

		cursor = { folded: [...events], pending, result };

		return finalizeProjection(result, pending, decorations);
	};
}

/**
 * Whether `events` extends the exact run the cursor already folded.
 *
 * Compares every reference in the folded prefix rather than sampling its ends.
 * TanStack Query's structural sharing keeps unchanged rows referentially
 * identical, so a row that changed surfaces here as a new object — an
 * end-sampled check would resume on a stale fold and serve a wrong transcript
 * with no repair path short of a remount. The cursor compares against its own
 * copy of the prefix, so a caller that appends to the array it handed over in
 * place cannot make the check read the grown length as already folded. Both
 * walks are pointer equality, orders of magnitude cheaper than the fold they
 * guard, which allocates per event.
 * @param cursor - State left by the previous projection
 * @param events - The event run being projected now
 * @returns True when the fold can resume instead of starting over
 */
function canResumeProjection(
	cursor: ProjectionCursor,
	events: readonly AgentEventFrame[],
): boolean {
	return (
		events.length >= cursor.folded.length &&
		cursor.folded.every((event, index) => event === events[index])
	);
}

/**
 * Closes the open group and applies the whole-transcript passes that cannot run
 * incrementally, all of which are linear in messages rather than in events.
 * @param result - Messages finalized so far
 * @param pending - The group still accumulating, or null when none is open
 * @param decorations - Caches that keep every row these passes derive identity-stable
 * @returns The timeline's messages, newest last
 */
function finalizeProjection(
	result: readonly UIMessage[],
	pending: PendingGroup | null,
	decorations: TimelineDecorations,
): UIMessage[] {
	const messages = pending ? [...result, finalizeGroup(pending)] : result;
	return withPromptTimes(
		relocateSkillInvocations(dropFlushedSkillDuplicates(messages), decorations),
		decorations,
	);
}

/**
 * Reads a derived message out of `cache`, rebuilding it only when the key it was
 * derived under changed. Reusing the previous object is what keeps a settled turn
 * referentially stable across a streaming turn's re-projections, so a memoized
 * timeline row re-renders only when its content actually moved.
 * @param cache - Derived messages, keyed by the message each came from
 * @param source - The message the derivation reads
 * @param key - Everything outside `source` that the derivation depends on
 * @param derive - Builds the derived message on a miss
 * @returns The derived message, reused when nothing changed
 */
function deriveStable(
	cache: MessageDerivationCache,
	source: UIMessage,
	key: string,
	derive: () => UIMessage,
): UIMessage {
	const cached = cache.get(source);
	if (cached?.key === key) {
		return cached.derived;
	}
	const derived = derive();
	cache.set(source, { derived, key });
	return derived;
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
 * Every row this pass rewrites goes through {@link deriveStable}: a transcript
 * that used a skill re-projects on every token like any other, and rebuilding
 * these rows each time would strand exactly those turns outside the timeline's
 * memoization.
 * @param messages - The finalized messages to transform
 * @param decorations - Caches keeping the rewritten rows referentially stable
 * @returns The messages with skill prompts rewritten and their markers relocated
 */
function relocateSkillInvocations(
	messages: readonly UIMessage[],
	decorations: TimelineDecorations,
): UIMessage[] {
	const result: UIMessage[] = [];
	let activation: SkillActivation | null = null;
	for (const message of messages) {
		if (activation) {
			const placed = placeSkillMarker(message, activation, decorations);
			activation = null;
			result.push(placed.row);
			if (placed.absorbedMessage) {
				continue;
			}
		}
		activation = emitRelocatedRow(message, result, decorations);
	}
	return result;
}

/**
 * Places the marker for a skill whose prompt was just emitted: folded into the
 * assistant turn it opened, or standing alone when the next row is not one.
 * @param message - The row following the skill prompt
 * @param activation - The activated skill's name and the prompt that invoked it
 * @param decorations - Caches keeping the placed row referentially stable
 * @returns The row carrying the marker, and whether it absorbed `message`
 */
function placeSkillMarker(
	message: UIMessage,
	activation: SkillActivation,
	decorations: TimelineDecorations,
): { absorbedMessage: boolean; row: UIMessage } {
	if (message.role === 'assistant') {
		return {
			absorbedMessage: true,
			row: deriveStable(
				decorations.skillMarker,
				message,
				activation.name,
				() => ({
					...message,
					parts: [buildSkillPart(activation.name), ...message.parts],
				}),
			),
		};
	}
	return {
		absorbedMessage: false,
		row: deriveStable(
			decorations.skillActivation,
			activation.source,
			activation.name,
			() => skillActivationRow(activation.name, activation.source),
		),
	};
}

/**
 * Emits one row that carries no relocated marker, rewriting a `<skill>` prompt
 * back to the command the user typed so the bubble reads normally.
 * @param message - The row being emitted
 * @param result - Accumulator of relocated messages, appended in place
 * @param decorations - Caches keeping the rewritten prompt referentially stable
 * @returns The activation this row opened, or null when it opened none
 */
function emitRelocatedRow(
	message: UIMessage,
	result: UIMessage[],
	decorations: TimelineDecorations,
): SkillActivation | null {
	if (message.role !== 'user') {
		result.push(message);
		return null;
	}
	const { skill, text } = parseSkillInvocation(joinTextParts(message));
	if (!skill) {
		result.push(message);
		return null;
	}
	const command = skillCommandText(skill.name, text);
	result.push(
		deriveStable(decorations.skillCommand, message, command, () => ({
			...message,
			parts: [{ state: 'done', text: command, type: 'text' }],
		})),
	);
	return { name: skill.name, source: message };
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
function withPromptTimes(
	messages: readonly UIMessage[],
	decorations: TimelineDecorations,
): UIMessage[] {
	let lastUserAt: string | undefined;
	return messages.map((message) => {
		const metadata = turnMetadataOf(message);
		if (message.role === 'user') {
			if (metadata) {
				lastUserAt = metadata.firstEventAt;
			}
			return message;
		}
		if (message.role !== 'assistant' || !metadata || !lastUserAt) {
			return message;
		}
		const promptAt = lastUserAt;
		return deriveStable(decorations.promptTime, message, promptAt, () => ({
			...message,
			metadata: { ...metadata, promptAt },
		}));
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
		case 'plan-limit':
		case 'session-cost':
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
		projectMessagePayload(
			event,
			envelope.payload,
			envelope.parentToolCallId ?? null,
		),
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
 * @param event - The persisted event frame carrying the payload
 * @param payload - The normalized message payload
 * @param parentToolCallId - Tool call whose subagent produced it, or null on the main thread
 * @returns The UI parts for this payload
 */
function projectMessagePayload(
	event: AgentEventFrame,
	payload: AgentWireMessagePayload,
	parentToolCallId: string | null,
): UIMessagePart[] {
	const link = parentToolCallId ? { parentToolCallId } : {};
	switch (payload.kind) {
		case 'text':
			return payload.text
				? [{ ...link, state: 'done', text: payload.text, type: 'text' }]
				: [];
		case 'reasoning':
			return [
				{ ...link, state: 'done', text: payload.text, type: 'reasoning' },
			];
		case 'custom':
			return payload.text
				? [
						{
							...buildCustomMessagePart({
								customType: payload.customType,
								display: payload.display,
								text: payload.text,
							}),
							...link,
						},
					]
				: [];
		case 'text-delta':
			return payload.text
				? [{ ...link, state: 'streaming', text: payload.text, type: 'text' }]
				: [];
		case 'reasoning-delta':
			return payload.text
				? [
						{
							...link,
							state: 'streaming',
							text: payload.text,
							type: 'reasoning',
						},
					]
				: [];
		case 'prompt':
			return payload.prompt
				? [{ ...link, state: 'done', text: payload.prompt, type: 'text' }]
				: [];
		case 'tool-call':
			return [buildToolCallPart(payload, event, parentToolCallId)];
		case 'tool-result':
			return [buildToolResultPart(payload, event, parentToolCallId)];
		case 'message':
			return payload.parts.flatMap((part) =>
				projectMessagePart(part, event, parentToolCallId),
			);
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
 * @param parentToolCallId - Tool call whose subagent produced it, or null on the main thread
 * @returns The UI parts for this part, or an empty array when it has no content
 */
function projectMessagePart(
	part: AgentWireMessagePart,
	event: AgentEventFrame,
	parentToolCallId: string | null,
): UIMessagePart[] {
	const link = parentToolCallId ? { parentToolCallId } : {};
	switch (part.kind) {
		case 'text':
			return part.text
				? [{ ...link, state: 'done', text: part.text, type: 'text' }]
				: [];
		case 'reasoning':
			return [{ ...link, state: 'done', text: part.text, type: 'reasoning' }];
		case 'tool-call':
			return [buildToolCallPart(part, event, parentToolCallId)];
		case 'tool-result':
			return [buildToolResultPart(part, event, parentToolCallId)];
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
			merged = dropStreamingPartsOfType(
				merged,
				incomingPart.type,
				parentToolCallIdOf(incomingPart),
			);
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
