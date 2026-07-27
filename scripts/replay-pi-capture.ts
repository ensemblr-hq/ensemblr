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

function framesToEvents(lines: readonly string[]): PiSessionEventWire[] {
	const events: PiSessionEventWire[] = [];
	for (const line of lines) {
		let frame: RawFrame;
		try {
			frame = JSON.parse(line) as RawFrame;
		} catch {
			continue;
		}
		const type = frame.type;
		if (type === 'message_end') {
			const message = (frame.message ?? {}) as RawFrame;
			if (message.role === 'toolResult') {
				// Mirrors protocol-dispatch: tool_execution_end already carries it.
				continue;
			}
			const role = message.role === 'user' ? 'user' : 'agent';
			const parts = contentBlocksToParts(message.content);
			if (parts.length === 0) {
				continue;
			}
			events.push(
				makeEvent(
					{
						kind: 'message',
						payload: { kind: 'message', parts, role: role as 'user' },
						role: role as 'user',
					},
					null,
				),
			);
		} else if (type === 'message_update') {
			const event = (frame as RawFrame).assistantMessageEvent as
				| RawFrame
				| undefined;
			const text =
				event && typeof event.text === 'string'
					? event.text
					: event && typeof event.delta === 'string'
						? event.delta
						: null;
			if (text) {
				events.push(
					makeEvent(
						{
							kind: 'message',
							payload: { kind: 'text-delta', text },
							role: 'agent',
						},
						null,
					),
				);
			}
		} else if (type === 'tool_execution_start') {
			events.push(
				makeEvent(
					{
						kind: 'message',
						payload: {
							input: frame.args ?? {},
							kind: 'tool-call',
							name:
								typeof frame.toolName === 'string' ? frame.toolName : 'tool',
							toolCallId:
								typeof frame.toolCallId === 'string' ? frame.toolCallId : '',
						},
						role: 'tool',
					},
					typeof frame.toolCallId === 'string' ? frame.toolCallId : null,
				),
			);
		} else if (type === 'tool_execution_end') {
			events.push(
				makeEvent(
					{
						kind: 'message',
						payload: {
							isError: frame.isError === true,
							kind: 'tool-result',
							output: frame.result,
							toolCallId:
								typeof frame.toolCallId === 'string' ? frame.toolCallId : '',
						},
						role: 'tool',
					},
					typeof frame.toolCallId === 'string' ? frame.toolCallId : null,
				),
			);
		}
	}
	return events;
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
