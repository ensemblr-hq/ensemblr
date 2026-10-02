import { Buffer } from 'node:buffer';

import type {
	AgentPersistedEnvelope,
	AgentWireMessagePart,
	AgentWireMessagePayload,
} from '../../../shared/ipc/contracts/agent-session';

/**
 * Byte budget one persisted event payload may occupy in `payload_json`.
 *
 * A tool result is whatever the tool printed, so a `cat` of a log or a wide
 * `git diff` lands in one row: the live database held 476 rows over 100 KB
 * carrying 123 MB between them, each re-read and re-cloned across IPC on every
 * replay of that branch. The full output is still on disk and in the terminal
 * scrollback, so the transcript does not need to be the archive of record.
 */
export const MAX_PERSISTED_PAYLOAD_BYTES = 256 * 1024;

/** Smallest per-field budget a split across message parts may fall to. */
const MIN_FIELD_BUDGET_BYTES = 4 * 1024;

/**
 * Serialized byte length of a value, counting an unserializable value as zero.
 * @param value - Value to measure as JSON.
 * @returns UTF-8 byte length of its JSON form.
 */
export function payloadByteLength(value: unknown): number {
	try {
		const serialized = JSON.stringify(value);
		return serialized === undefined ? 0 : Buffer.byteLength(serialized);
	} catch {
		return 0;
	}
}

/** A field narrowed to its budget, plus the number of bytes dropped. */
interface TruncatedText {
	text: string;
	truncatedBytes: number;
}

/**
 * Narrows a string to a byte budget, reporting what it dropped.
 * @param text - Text to narrow.
 * @param budget - Byte budget the result must fit.
 * @returns The kept prefix and the dropped byte count.
 */
function truncateText(text: string, budget: number): TruncatedText {
	const bytes = Buffer.from(text, 'utf8');
	if (bytes.byteLength <= budget) {
		return { text, truncatedBytes: 0 };
	}
	return {
		text: bytes.subarray(0, budget).toString('utf8'),
		truncatedBytes: bytes.byteLength - budget,
	};
}

/**
 * Narrows an opaque tool input or output to a byte budget by serializing it and
 * keeping the prefix, so the renderer still receives the head of what the tool
 * produced rather than nothing at all.
 * @param value - Opaque value to narrow.
 * @param budget - Byte budget the result must fit.
 * @returns The kept prefix as a string and the dropped byte count.
 */
function truncateOpaque(value: unknown, budget: number): TruncatedText {
	const serialized =
		typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
	return truncateText(serialized, budget);
}

/**
 * Narrows one message part to a byte budget, leaving a part already inside it
 * untouched.
 * @param part - Part to narrow.
 * @param budget - Byte budget the part must fit.
 * @returns The part, narrowed when it exceeded the budget.
 */
function capPart(
	part: AgentWireMessagePart,
	budget: number,
): AgentWireMessagePart {
	if (payloadByteLength(part) <= budget) {
		return part;
	}
	switch (part.kind) {
		case 'text':
			return { kind: 'text', ...truncateText(part.text, budget) };
		case 'reasoning':
			return { kind: 'reasoning', ...truncateText(part.text, budget) };
		case 'tool-call': {
			const { text, truncatedBytes } = truncateOpaque(part.input, budget);
			return {
				input: text,
				kind: 'tool-call',
				name: part.name,
				toolCallId: part.toolCallId,
				truncatedBytes,
			};
		}
		case 'tool-result': {
			const { text, truncatedBytes } = truncateOpaque(part.output, budget);
			return {
				isError: part.isError,
				kind: 'tool-result',
				output: text,
				toolCallId: part.toolCallId,
				truncatedBytes,
			};
		}
	}
}

/**
 * Narrows one wire message payload to a byte budget. Bulk lives in exactly
 * three places — free text, an opaque tool input, an opaque tool output — so
 * each variant narrows the one field that can grow and reports the loss in
 * `truncatedBytes`.
 * @param payload - Payload to narrow.
 * @param budget - Byte budget the payload must fit.
 * @returns The payload, narrowed when it exceeded the budget.
 */
function capWirePayload(
	payload: AgentWireMessagePayload,
	budget: number,
): AgentWireMessagePayload {
	switch (payload.kind) {
		case 'text':
			return { kind: 'text', ...truncateText(payload.text, budget) };
		case 'reasoning':
			return { kind: 'reasoning', ...truncateText(payload.text, budget) };
		case 'text-delta':
			return { kind: 'text-delta', ...truncateText(payload.text, budget) };
		case 'reasoning-delta':
			return {
				kind: 'reasoning-delta',
				...truncateText(payload.text, budget),
			};
		case 'custom':
			return {
				customType: payload.customType,
				display: payload.display,
				kind: 'custom',
				...truncateText(payload.text, budget),
			};
		case 'prompt': {
			const { text, truncatedBytes } = truncateText(payload.prompt, budget);
			return { kind: 'prompt', prompt: text, truncatedBytes };
		}
		case 'tool-call': {
			const { text, truncatedBytes } = truncateOpaque(payload.input, budget);
			return {
				input: text,
				kind: 'tool-call',
				name: payload.name,
				toolCallId: payload.toolCallId,
				truncatedBytes,
			};
		}
		case 'tool-update': {
			const { text, truncatedBytes } = truncateOpaque(payload.input, budget);
			return {
				input: text,
				kind: 'tool-update',
				name: payload.name,
				presentation: payload.presentation,
				toolCallId: payload.toolCallId,
				truncatedBytes,
			};
		}
		case 'tool-result': {
			const { text, truncatedBytes } = truncateOpaque(payload.output, budget);
			return {
				isError: payload.isError,
				kind: 'tool-result',
				output: text,
				toolCallId: payload.toolCallId,
				truncatedBytes,
			};
		}
		case 'message': {
			const perPart = Math.max(
				MIN_FIELD_BUDGET_BYTES,
				Math.floor(budget / Math.max(1, payload.parts.length)),
			);
			return {
				...payload,
				parts: payload.parts.map((part) => capPart(part, perPart)),
			};
		}
		case 'unknown':
			return payload;
	}
}

/**
 * Caps a persisted event payload at a byte budget before it reaches
 * `payload_json`, narrowing the one bulk-carrying field and recording the
 * dropped byte count so the timeline can say how much it is not showing.
 *
 * Only `message` envelopes can grow: every other variant is a fixed-shape
 * record of usage, status, or cost.
 * @param payload - Envelope about to be written, or null.
 * @param maxBytes - Byte budget for the serialized envelope.
 * @returns The envelope, narrowed when it exceeded the budget.
 */
export function capPersistedPayload(
	payload: AgentPersistedEnvelope | null,
	maxBytes: number = MAX_PERSISTED_PAYLOAD_BYTES,
): AgentPersistedEnvelope | null {
	if (
		payload === null ||
		payload.kind !== 'message' ||
		payloadByteLength(payload) <= maxBytes
	) {
		return payload;
	}
	return { ...payload, payload: capWirePayload(payload.payload, maxBytes) };
}
