/**
 * Replays raw Pi RPC frame captures (JSONL) through the renderer's
 * event-to-ui-message pipeline and prints the resulting UIMessage structure.
 *
 * Usage: npx tsx scripts/replay-pi-capture.ts /tmp/pi-capture/02-tools.jsonl
 *
 * The mapping below mirrors `protocol-dispatch.ts` + the persistence adapter
 * closely enough to validate grouping, dedup, and the activity/final split
 * against real wire data without booting Electron.
 */

import { readFileSync } from 'node:fs';

import { eventsToUIMessages, turnMetadataOf } from '../src/renderer/lib/pi';
import type {
	PiPersistedEnvelope,
	PiSessionEventWire,
	PiWireMessagePart,
} from '../src/shared/ipc';

type RawFrame = Record<string, unknown>;

let ordinal = 0;

/**
 * Wraps a persisted envelope in a wire event, stamping a deterministic ordinal
 * and timestamp so replays render identically across runs.
 * @param payload - Persisted envelope to carry on the event
 * @param turnId - Turn the event belongs to, or null when it is turn-less
 * @returns A replay-scoped session event ready for the timeline
 */
function makeEvent(
	payload: PiPersistedEnvelope,
	turnId: string | null,
): PiSessionEventWire {
	ordinal += 1;
	return {
		branchId: 'replay',
		createdAt: new Date(1_700_000_000_000 + ordinal * 250).toISOString(),
		eventType: 'message',
		id: `evt-${ordinal}`,
		ordinal,
		payload,
		stream: 'protocol',
		turnId,
	};
}

/**
 * Converts raw capture content blocks into wire message parts, skipping any
 * block whose shape the timeline cannot render.
 * @param blocks - Untrusted content-block array read from a capture frame
 * @returns The recognised text, reasoning, and tool-call parts in order
 */
function contentBlocksToParts(blocks: unknown): PiWireMessagePart[] {
	if (!Array.isArray(blocks)) {
		return [];
	}
	const parts: PiWireMessagePart[] = [];
	for (const block of blocks) {
		if (!block || typeof block !== 'object') {
			continue;
		}
		const b = block as RawFrame;
		if (b.type === 'text' && typeof b.text === 'string') {
			parts.push({ kind: 'text', text: b.text });
		} else if (b.type === 'thinking' && typeof b.thinking === 'string') {
			parts.push({ kind: 'reasoning', text: b.thinking });
		} else if (b.type === 'toolCall') {
			parts.push({
				input: b.arguments ?? b.args ?? {},
				kind: 'tool-call',
				name: typeof b.name === 'string' ? b.name : 'tool',
				toolCallId: typeof b.id === 'string' ? b.id : '',
			});
		}
	}
	return parts;
}

/**
 * Turns a captured JSONL transcript into the session events a replay renders,
 * dropping lines that fail to parse rather than aborting the whole capture.
 * @param lines - Raw JSONL lines from a Pi capture file
 * @returns Ordered session events reconstructed from the recognised frames
 */
function framesToEvents(lines: readonly string[]): PiSessionEventWire[] {
	return lines.flatMap((line) => {
		const frame = parseFrame(line);
		return frame ? frameToEvents(frame) : [];
	});
}

/**
 * Parse one JSONL line into a raw frame.
 * @param line - Raw JSONL line from a Pi capture file
 * @returns The parsed frame, or null when the line is not valid JSON
 */
function parseFrame(line: string): RawFrame | null {
	try {
		return JSON.parse(line) as RawFrame;
	} catch {
		return null;
	}
}

/**
 * Project one recognised capture frame onto the session events a replay renders.
 * @param frame - A parsed capture frame
 * @returns The events the frame produces, empty for frames a replay ignores
 */
function frameToEvents(frame: RawFrame): PiSessionEventWire[] {
	switch (frame.type) {
		case 'message_end':
			return messageEndEvents(frame);
		case 'message_update':
			return messageUpdateEvents(frame);
		case 'tool_execution_start':
			return [toolCallEvent(frame)];
		case 'tool_execution_end':
			return [toolResultEvent(frame)];
		default:
			return [];
	}
}

/**
 * Project a `message_end` frame, dropping tool results (which
 * `tool_execution_end` already carries) and messages with no renderable parts.
 * @param frame - The `message_end` frame
 * @returns The message event, or nothing when the frame carries no content
 */
function messageEndEvents(frame: RawFrame): PiSessionEventWire[] {
	const message = (frame.message ?? {}) as RawFrame;
	// Mirrors protocol-dispatch: tool_execution_end already carries it.
	if (message.role === 'toolResult') {
		return [];
	}
	const parts = contentBlocksToParts(message.content);
	if (parts.length === 0) {
		return [];
	}
	const role = (message.role === 'user' ? 'user' : 'agent') as 'user';
	return [
		makeEvent(
			{ kind: 'message', payload: { kind: 'message', parts, role }, role },
			null,
		),
	];
}

/**
 * Project a `message_update` frame into a streaming text delta.
 * @param frame - The `message_update` frame
 * @returns The delta event, or nothing when the frame carries no text
 */
function messageUpdateEvents(frame: RawFrame): PiSessionEventWire[] {
	const event = frame.assistantMessageEvent as RawFrame | undefined;
	const text = readString(event?.text) ?? readString(event?.delta);
	if (!text) {
		return [];
	}
	return [
		makeEvent(
			{ kind: 'message', payload: { kind: 'text-delta', text }, role: 'agent' },
			null,
		),
	];
}

/**
 * Project a `tool_execution_start` frame into its tool-call event.
 * @param frame - The `tool_execution_start` frame
 * @returns The tool-call event
 */
function toolCallEvent(frame: RawFrame): PiSessionEventWire {
	const toolCallId = readString(frame.toolCallId);
	return makeEvent(
		{
			kind: 'message',
			payload: {
				input: frame.args ?? {},
				kind: 'tool-call',
				name: readString(frame.toolName) ?? 'tool',
				toolCallId: toolCallId ?? '',
			},
			role: 'tool',
		},
		toolCallId,
	);
}

/**
 * Project a `tool_execution_end` frame into its tool-result event.
 * @param frame - The `tool_execution_end` frame
 * @returns The tool-result event
 */
function toolResultEvent(frame: RawFrame): PiSessionEventWire {
	const toolCallId = readString(frame.toolCallId);
	return makeEvent(
		{
			kind: 'message',
			payload: {
				isError: frame.isError === true,
				kind: 'tool-result',
				output: frame.result,
				toolCallId: toolCallId ?? '',
			},
			role: 'tool',
		},
		toolCallId,
	);
}

/**
 * Read a capture field as a string.
 * @param value - Raw field value
 * @returns The string, or null when the field holds anything else
 */
function readString(value: unknown): string | null {
	return typeof value === 'string' ? value : null;
}

const file = process.argv[2];
if (!file) {
	console.error('usage: npx tsx scripts/replay-pi-capture.ts <capture.jsonl>');
	process.exit(1);
}

const lines = readFileSync(file, 'utf8').trim().split('\n');
const events = framesToEvents(lines);
const messages = eventsToUIMessages(events);

console.log(`events: ${events.length} → messages: ${messages.length}`);
for (const message of messages) {
	const meta = turnMetadataOf(message);
	const duration =
		meta !== null
			? `${(Date.parse(meta.lastEventAt) - Date.parse(meta.firstEventAt)) / 1000}s`
			: 'n/a';
	console.log(`\n[${message.role}] (${duration})`);
	for (const part of message.parts) {
		if (part.type === 'text') {
			console.log(
				`  text(${'state' in part ? part.state : '?'}): ${part.text.slice(0, 80).replaceAll('\n', '\\n')}`,
			);
		} else if (part.type === 'reasoning') {
			console.log(
				`  reasoning: ${part.text.slice(0, 60).replaceAll('\n', '\\n')}`,
			);
		} else if (part.type === 'dynamic-tool') {
			const p = part as { state: string; toolName: string; toolCallId: string };
			console.log(
				`  tool[${p.toolName}] state=${p.state} id=${p.toolCallId.slice(0, 24)}…`,
			);
		}
	}
}
