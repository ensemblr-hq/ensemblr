import { describe, expect, it } from 'vitest';
import {
	capPersistedPayload,
	MAX_PERSISTED_PAYLOAD_BYTES,
	payloadByteLength,
} from '../../src/main/storage/repositories/agent-event-payload-cap.ts';
import type { AgentPersistedEnvelope } from '../../src/shared/ipc/contracts/agent-session';

const BUDGET = 1024;

function toolResult(output: unknown): AgentPersistedEnvelope {
	return {
		kind: 'message',
		payload: { isError: false, kind: 'tool-result', output, toolCallId: 't1' },
		role: 'tool',
	};
}

describe('capPersistedPayload', () => {
	it('leaves a payload inside the budget untouched', () => {
		const envelope = toolResult('short output');
		expect(capPersistedPayload(envelope, BUDGET)).toBe(envelope);
	});

	it('caps an oversized tool result and reports the dropped bytes', () => {
		const capped = capPersistedPayload(toolResult('x'.repeat(50_000)), BUDGET);

		expect(payloadByteLength(capped)).toBeLessThanOrEqual(BUDGET + 256);
		if (capped?.kind !== 'message' || capped.payload.kind !== 'tool-result') {
			throw new Error('expected a tool-result envelope');
		}
		expect(capped.payload.output).toBe('x'.repeat(BUDGET));
		expect(capped.payload.truncatedBytes).toBe(50_000 - BUDGET);
	});

	it('keeps the head of a structured tool output as a string', () => {
		const capped = capPersistedPayload(
			toolResult({ lines: Array.from({ length: 5_000 }, () => 'line') }),
			BUDGET,
		);

		if (capped?.kind !== 'message' || capped.payload.kind !== 'tool-result') {
			throw new Error('expected a tool-result envelope');
		}
		expect(typeof capped.payload.output).toBe('string');
		expect(capped.payload.output as string).toMatch(/^\{"lines":\["line"/);
		expect(capped.payload.truncatedBytes).toBeGreaterThan(0);
	});

	it('caps free text and a tool call input', () => {
		const text = capPersistedPayload(
			{
				kind: 'message',
				payload: { kind: 'text', text: 'y'.repeat(9_000) },
				role: 'agent',
			},
			BUDGET,
		);
		const call = capPersistedPayload(
			{
				kind: 'message',
				payload: {
					input: { command: 'z'.repeat(9_000) },
					kind: 'tool-call',
					name: 'Bash',
					toolCallId: 't2',
				},
				role: 'tool',
			},
			BUDGET,
		);

		if (text?.kind !== 'message' || text.payload.kind !== 'text') {
			throw new Error('expected a text envelope');
		}
		if (call?.kind !== 'message' || call.payload.kind !== 'tool-call') {
			throw new Error('expected a tool-call envelope');
		}
		expect(text.payload.text).toHaveLength(BUDGET);
		expect(text.payload.truncatedBytes).toBe(9_000 - BUDGET);
		expect(typeof call.payload.input).toBe('string');
		expect(call.payload.truncatedBytes).toBeGreaterThan(0);
	});

	it('splits the budget across the parts of a sealed message', () => {
		const capped = capPersistedPayload(
			{
				kind: 'message',
				payload: {
					kind: 'message',
					parts: [
						{ kind: 'text', text: 'a'.repeat(400_000) },
						{
							isError: false,
							kind: 'tool-result',
							output: 'b'.repeat(400_000),
							toolCallId: 't3',
						},
					],
					role: 'assistant',
				},
				role: 'agent',
			},
			MAX_PERSISTED_PAYLOAD_BYTES,
		);

		if (capped?.kind !== 'message' || capped.payload.kind !== 'message') {
			throw new Error('expected a sealed message envelope');
		}
		expect(payloadByteLength(capped)).toBeLessThan(
			MAX_PERSISTED_PAYLOAD_BYTES + 1024,
		);
		for (const part of capped.payload.parts) {
			expect(part.truncatedBytes).toBeGreaterThan(0);
		}
	});

	it('leaves a non-message envelope alone', () => {
		const envelope: AgentPersistedEnvelope = {
			kind: 'status',
			previous: 'idle',
			status: 'streaming',
		};
		expect(capPersistedPayload(envelope, 1)).toBe(envelope);
	});
});
