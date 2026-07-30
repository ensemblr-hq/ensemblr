/**
 * Projects a conversation's persisted event log into a transcript an agent can
 * audit: the prompts, the answers, and the tool calls with their arguments and
 * results. `getLastMessage` answers "what did the child conclude"; this answers
 * "what did it actually do", which is the question a delegated unit of work
 * cannot be checked without.
 *
 * Two properties of the log make a naive walk wrong. Pi persists every tool
 * invocation twice — once as streaming frames, once inside the composite message
 * that closes the turn — so entries are merged on `toolCallId` or every call
 * renders twice. And a transcript has no natural ceiling, so the page is capped
 * per field and in total, with the cursor cutting only between event ordinals so
 * a resumed read can neither skip an entry nor repeat one.
 */

import type {
	PiEventStreamWire,
	PiPersistedEnvelope,
	PiWireMessagePart,
	PiWireMessagePayload,
} from '../ipc/contracts/pi-message-payloads.ts';
import {
	type ConversationTranscriptEntry,
	READ_CONVERSATION_LIMITS,
	type ReadConversationResult,
} from './contracts.ts';

/**
 * The persisted event fields a transcript is built from. Structural rather than
 * a named row type so the main process can pass its storage rows and the
 * renderer its wire rows without either shape leaking across the boundary.
 */
export interface TranscriptSourceEvent {
	ordinal: number;
	payload: PiPersistedEnvelope | null;
	stream: PiEventStreamWire;
}

/** Name a tool result carries when its call never made it into the log. */
const UNKNOWN_TOOL_NAME = 'tool';

/** Blank line separating a shortened field from the marker explaining the cut. */
const POINTER_GAP = '\n\n';

/** Separator joining the text parts of one composite message. */
const PART_SEPARATOR = '\n';

/** A tool call and its result, accumulated across both persistences. */
interface ToolDraft {
	name: string | null;
	input: unknown;
	output: unknown;
	isError: boolean;
	answered: boolean;
}

/**
 * A projected event, either finished or still awaiting the other half of its
 * tool invocation. Tool slots hold a key rather than a value so a result
 * persisted many ordinals later still lands at the call site.
 */
type TranscriptSlot =
	| { kind: 'entry'; entry: ConversationTranscriptEntry }
	| { kind: 'tool'; ordinal: number; toolCallId: string };

/**
 * Builds a page of a conversation's transcript from its persisted events.
 * `stat`, `ordinal`, and `fromOrdinal` are alternatives honoured in that order:
 * a probe reports what there is to read, an ordinal reads one entry whole, and a
 * cursor pages forward.
 * @param input - The branch's visible events, the session they belong to, and the read mode.
 * @returns The branch-wide counts plus the requested page and its continuation cursor.
 */
export function buildConversationTranscript({
	events,
	piSessionId,
	fromOrdinal,
	ordinal,
	stat,
}: {
	events: readonly TranscriptSourceEvent[];
	piSessionId: string;
	fromOrdinal?: number;
	ordinal?: number;
	stat?: boolean;
}): ReadConversationResult {
	const entries = projectEntries(events);
	const summary = {
		entryCount: entries.length,
		firstOrdinal: entries.at(0)?.ordinal ?? null,
		lastOrdinal: entries.at(-1)?.ordinal ?? null,
		piSessionId,
		turnCount: entries.filter((entry) => entry.kind === 'prompt').length,
	};
	if (stat) {
		return { ...summary, entries: [], nextOrdinal: null };
	}
	if (ordinal !== undefined) {
		const selected = entries.filter((entry) => entry.ordinal === ordinal);
		const budget = singleReadFieldBudget(selected);
		return {
			...summary,
			entries: selected.map((entry) => capEntry(entry, budget)),
			nextOrdinal: null,
		};
	}
	return { ...summary, ...paginate(entries, fromOrdinal ?? 0) };
}

/**
 * How much each field of a single-entry read may spend. The cap lifts off
 * {@link READ_CONVERSATION_LIMITS.maxFieldChars} so one entry can be read whole,
 * but it lifts to a share of the page budget rather than to the budget itself:
 * an ordinal can carry a whole composite turn, and giving every field the page
 * ceiling would return a multiple of the ceiling this read exists to respect.
 * @param entries - The entries sharing the requested ordinal.
 * @returns The per-field char ceiling.
 */
function singleReadFieldBudget(
	entries: readonly ConversationTranscriptEntry[],
): number {
	const fields = entries.reduce(
		(total, entry) => total + (entry.kind === 'tool' ? 2 : 1),
		0,
	);
	return fields > 0
		? Math.floor(READ_CONVERSATION_LIMITS.maxPageChars / fields)
		: READ_CONVERSATION_LIMITS.maxPageChars;
}

/**
 * Walks the log once, projecting every visible event and merging the two
 * persistences of each tool invocation into a single slot.
 * @param events - The branch's events, ascending by ordinal.
 * @returns The finished entries, ascending by ordinal.
 */
function projectEntries(
	events: readonly TranscriptSourceEvent[],
): readonly ConversationTranscriptEntry[] {
	const slots: TranscriptSlot[] = [];
	const drafts = new Map<string, ToolDraft>();
	for (const event of events) {
		if (event.stream === 'stderr' || !event.payload) {
			continue;
		}
		for (const projected of projectEnvelope(event.ordinal, event.payload)) {
			if (projected.kind === 'entry') {
				slots.push(projected);
				continue;
			}
			const previous = drafts.get(projected.toolCallId);
			drafts.set(projected.toolCallId, mergeDraft(previous, projected.draft));
			if (!previous) {
				slots.push({
					kind: 'tool',
					ordinal: projected.ordinal,
					toolCallId: projected.toolCallId,
				});
			}
		}
	}
	return slots.map((slot) =>
		slot.kind === 'entry'
			? slot.entry
			: toolEntry(slot.ordinal, drafts.get(slot.toolCallId)),
	);
}

/** A projected slot, or a tool fragment still to be merged into one. */
type ProjectedSlot =
	| { kind: 'entry'; entry: ConversationTranscriptEntry }
	| { kind: 'tool'; ordinal: number; toolCallId: string; draft: ToolDraft };

/**
 * Projects one persisted envelope. Reasoning, streaming deltas, custom frames,
 * and the status/metadata/usage bookkeeping yield nothing: the composite message
 * that closes a turn already carries the completed text, so keeping the deltas
 * too would render every answer twice.
 * @param ordinal - The event's ordinal, which becomes the entry's.
 * @param envelope - The persisted envelope to project.
 * @returns Zero or more slots for this event.
 */
function projectEnvelope(
	ordinal: number,
	envelope: PiPersistedEnvelope,
): readonly ProjectedSlot[] {
	if (envelope.kind === 'error') {
		return [
			{
				entry: { kind: 'error', ordinal, text: envelope.error.message },
				kind: 'entry',
			},
		];
	}
	if (envelope.kind !== 'message') {
		return [];
	}
	if (envelope.role === 'user') {
		return textSlot('prompt', ordinal, promptText(envelope.payload));
	}
	return projectAgentPayload(ordinal, envelope.payload);
}

/**
 * Projects an agent- or tool-role payload: its visible text as one entry, plus a
 * fragment for every tool call or result it carries.
 * @param ordinal - The event's ordinal.
 * @param payload - The envelope's inner wire payload.
 * @returns Zero or more slots for this payload.
 */
function projectAgentPayload(
	ordinal: number,
	payload: PiWireMessagePayload,
): readonly ProjectedSlot[] {
	if (payload.kind === 'text') {
		return textSlot('message', ordinal, payload.text);
	}
	if (payload.kind === 'tool-call' || payload.kind === 'tool-result') {
		return [toolSlot(ordinal, payload)];
	}
	if (payload.kind !== 'message') {
		return [];
	}
	return projectMessageParts(ordinal, payload.parts);
}

/**
 * Projects a composite message's parts in the order the turn wrote them, so a
 * run of narration lands before the call it introduces instead of after every
 * call in the message. Consecutive text parts collapse into one entry; a tool
 * part closes the run that preceded it.
 * @param ordinal - The event's ordinal, shared by every slot this yields.
 * @param parts - The composite message's parts, in written order.
 * @returns The slots for this message, in written order.
 */
function projectMessageParts(
	ordinal: number,
	parts: readonly PiWireMessagePart[],
): readonly ProjectedSlot[] {
	const slots: ProjectedSlot[] = [];
	let pendingText: string[] = [];
	const flushText = (): void => {
		slots.push(
			...textSlot('message', ordinal, pendingText.join(PART_SEPARATOR)),
		);
		pendingText = [];
	};
	for (const part of parts) {
		if (part.kind === 'text') {
			pendingText = [...pendingText, part.text];
			continue;
		}
		if (part.kind === 'tool-call' || part.kind === 'tool-result') {
			flushText();
			slots.push(toolSlot(ordinal, part));
		}
	}
	flushText();
	return slots;
}

/**
 * Reads the visible text of a user-role payload, which arrives as a prompt, a
 * bare text frame, or a composite message depending on how it was submitted.
 * @param payload - The user envelope's inner wire payload.
 * @returns The prompt text, possibly empty.
 */
function promptText(payload: PiWireMessagePayload): string {
	if (payload.kind === 'prompt') {
		return payload.prompt;
	}
	if (payload.kind === 'text') {
		return payload.text;
	}
	if (payload.kind === 'message') {
		return payload.parts
			.flatMap((part) => (part.kind === 'text' ? [part.text] : []))
			.join(PART_SEPARATOR);
	}
	return '';
}

/**
 * Wraps text as a slot, dropping it when the frame carried none so an empty
 * envelope does not occupy an ordinal in the page.
 * @param kind - Whether the text is a user prompt or an agent answer.
 * @param ordinal - The event's ordinal.
 * @param text - The visible text.
 * @returns One slot, or none when the text is empty.
 */
function textSlot(
	kind: 'prompt' | 'message',
	ordinal: number,
	text: string,
): readonly ProjectedSlot[] {
	return text.length > 0
		? [{ entry: { kind, ordinal, text }, kind: 'entry' }]
		: [];
}

/**
 * Turns a tool call or result frame into a fragment keyed by its call id.
 * @param ordinal - The event's ordinal.
 * @param source - The tool-call or tool-result payload or message part.
 * @returns The fragment slot for this half of the invocation.
 */
function toolSlot(
	ordinal: number,
	source: Extract<
		PiWireMessagePayload | PiWireMessagePart,
		{ kind: 'tool-call' | 'tool-result' }
	>,
): ProjectedSlot {
	const draft: ToolDraft =
		source.kind === 'tool-call'
			? {
					answered: false,
					input: source.input,
					isError: false,
					name: source.name,
					output: undefined,
				}
			: {
					answered: true,
					input: undefined,
					isError: source.isError,
					name: null,
					output: source.output,
				};
	return { draft, kind: 'tool', ordinal, toolCallId: source.toolCallId };
}

/**
 * Folds a fragment into what is already known about a tool invocation. A
 * concrete name outranks the fallback a result frame carries, richer arguments
 * outrank empty ones, and only a result frame may set the output — the merge has
 * to survive the streaming and composite persistences arriving in either order.
 * @param previous - What earlier fragments established, or undefined for the first.
 * @param incoming - The fragment being folded in.
 * @returns A new draft holding the best of both.
 */
function mergeDraft(
	previous: ToolDraft | undefined,
	incoming: ToolDraft,
): ToolDraft {
	if (!previous) {
		return incoming;
	}
	return {
		answered: previous.answered || incoming.answered,
		input: pickToolInput(previous.input, incoming.input),
		isError: incoming.answered ? incoming.isError : previous.isError,
		name: pickToolName(previous.name, incoming.name),
		output: incoming.answered ? incoming.output : previous.output,
	};
}

/**
 * Picks the tool input to keep. A frame that carried one always beats a frame
 * that carried none — a result fragment merging first must not shadow the call's
 * arguments, whatever shape they took — and richer arguments settle a tie
 * between two frames that both carried something.
 * @param previous - The input established so far, undefined when none was.
 * @param incoming - The incoming fragment's input, undefined when it carried none.
 * @returns The surviving input.
 */
function pickToolInput(previous: unknown, incoming: unknown): unknown {
	if (incoming === undefined) {
		return previous;
	}
	if (previous === undefined) {
		return incoming;
	}
	return hasArguments(incoming) && !hasArguments(previous)
		? incoming
		: previous;
}

/**
 * Whether a tool input carries anything worth showing, which breaks a tie
 * between the two persistences of the same call.
 * @param input - A frame's raw input value.
 * @returns True when the value is an object with at least one key.
 */
function hasArguments(input: unknown): boolean {
	return (
		typeof input === 'object' &&
		input !== null &&
		!Array.isArray(input) &&
		Object.keys(input).length > 0
	);
}

/**
 * Picks the tool name to keep, preferring any concrete name over the fallback a
 * nameless result frame contributes.
 * @param previous - The name established so far, or null.
 * @param incoming - The incoming fragment's name, or null.
 * @returns The surviving name, or null when neither frame named the tool.
 */
function pickToolName(
	previous: string | null,
	incoming: string | null,
): string | null {
	if (incoming && incoming !== UNKNOWN_TOOL_NAME) {
		return incoming;
	}
	return previous ?? incoming;
}

/**
 * Renders a merged invocation as a transcript entry, stringifying both halves so
 * the reader gets text rather than a nested payload to re-parse.
 * @param ordinal - The ordinal of the call that opened the invocation.
 * @param draft - The merged invocation, absent only if a slot outlived its draft.
 * @returns The tool entry.
 */
function toolEntry(
	ordinal: number,
	draft: ToolDraft | undefined,
): ConversationTranscriptEntry {
	return {
		input: stringifyToolValue(draft?.input),
		isError: draft?.isError ?? false,
		kind: 'tool',
		name: draft?.name ?? UNKNOWN_TOOL_NAME,
		ordinal,
		output: stringifyToolValue(draft?.output),
	};
}

/**
 * Flattens a tool's arguments or result into readable text, unwrapping the
 * content-block envelope Pi tools answer in so a transcript shows the output
 * itself rather than the protocol around it.
 * @param value - A raw input or output value of any shape.
 * @returns The value as text, empty when it carried none.
 */
function stringifyToolValue(value: unknown): string {
	if (typeof value === 'string') {
		return value;
	}
	if (value === null || value === undefined) {
		return '';
	}
	const blocks = contentBlocks(value);
	if (blocks) {
		return blocks.join(PART_SEPARATOR);
	}
	try {
		return JSON.stringify(value, null, 2) ?? String(value);
	} catch {
		return String(value);
	}
}

/**
 * Reads the text of a content-block envelope, the shape Pi tool results arrive
 * in when they carry rendered output. An envelope whose blocks carry no text —
 * an image, an empty result — is refused rather than unwrapped to an empty
 * string, because a blank output is what a tool that returned nothing looks
 * like, and telling those two apart is what an audit is for.
 * @param value - A raw tool value.
 * @returns The block texts, or null when there are none to read.
 */
function contentBlocks(value: unknown): readonly string[] | null {
	if (typeof value !== 'object' || value === null || !('content' in value)) {
		return null;
	}
	const { content } = value as { content: unknown };
	if (!Array.isArray(content)) {
		return null;
	}
	const texts = content.flatMap((block) =>
		typeof block === 'object' &&
		block !== null &&
		typeof (block as { text?: unknown }).text === 'string'
			? [(block as { text: string }).text]
			: [],
	);
	return texts.length > 0 ? texts : null;
}

/**
 * Fills one page from the cursor, cutting only between ordinals. An envelope
 * that projects to several entries is therefore delivered whole or not at all,
 * which is what lets the returned cursor be an ordinal without a resumed read
 * repeating half of one event.
 * @param entries - Every entry on the branch, ascending.
 * @param fromOrdinal - Inclusive lower bound on the entries to return.
 * @returns The page and the ordinal to resume from, or null at the end.
 */
function paginate(
	entries: readonly ConversationTranscriptEntry[],
	fromOrdinal: number,
): {
	entries: readonly ConversationTranscriptEntry[];
	nextOrdinal: number | null;
} {
	const page: ConversationTranscriptEntry[] = [];
	let size = 0;
	for (const entry of entries) {
		if (entry.ordinal < fromOrdinal) {
			continue;
		}
		const capped = capEntry(entry, READ_CONVERSATION_LIMITS.maxFieldChars);
		const cost = entryCost(capped);
		const opensOrdinal = page.at(-1)?.ordinal !== capped.ordinal;
		if (
			page.length > 0 &&
			opensOrdinal &&
			size + cost > READ_CONVERSATION_LIMITS.maxPageChars
		) {
			return { entries: page, nextOrdinal: capped.ordinal };
		}
		page.push(capped);
		size += cost;
	}
	return { entries: page, nextOrdinal: null };
}

/**
 * How much of the page budget an entry spends, counted over its text fields.
 * @param entry - A capped entry.
 * @returns The entry's char cost.
 */
function entryCost(entry: ConversationTranscriptEntry): number {
	return entry.kind === 'tool'
		? entry.name.length + entry.input.length + entry.output.length
		: entry.text.length;
}

/**
 * Caps every text field of an entry to the budget, so one runaway tool result
 * cannot be the only thing a page carries.
 * @param entry - The entry to cap.
 * @param budget - Char ceiling for each field.
 * @returns The entry with each over-long field cut and marked.
 */
function capEntry(
	entry: ConversationTranscriptEntry,
	budget: number,
): ConversationTranscriptEntry {
	if (entry.kind === 'tool') {
		return {
			...entry,
			input: capField(entry.input, budget, entry.ordinal),
			output: capField(entry.output, budget, entry.ordinal),
		};
	}
	return { ...entry, text: capField(entry.text, budget, entry.ordinal) };
}

/**
 * Cuts one field to the budget and appends the call that reads it whole. The
 * marker is a floor rather than part of the budget: a truncated instruction is
 * worse than a slightly over-budget one, so a budget below the marker's own
 * length returns the marker alone.
 * @param text - The field's text.
 * @param budget - Char ceiling for the field.
 * @param ordinal - The entry's ordinal, named in the recovery call.
 * @returns The text at or under budget, marked when anything was cut.
 */
function capField(text: string, budget: number, ordinal: number): string {
	if (text.length <= budget) {
		return text;
	}
	const pointer = recoveryPointer(text.length, ordinal);
	const room = budget - pointer.length - POINTER_GAP.length;
	if (room <= 0) {
		return pointer;
	}
	return `${text.slice(0, room)}${POINTER_GAP}${pointer}`;
}

/**
 * Renders the marker closing a cut field. A `truncated` flag alone is not enough
 * — models act on the wording, and the single-entry read is the only route back
 * to what this cut away.
 * @param length - The field's full length before the cut.
 * @param ordinal - The entry's ordinal.
 * @returns The sentence appended to the shortened field.
 */
function recoveryPointer(length: number, ordinal: number): string {
	return `… shortened, ${length} char(s) in full. Read this entry whole with ensemblr_read_conversation({ ordinal: ${ordinal} }).`;
}
