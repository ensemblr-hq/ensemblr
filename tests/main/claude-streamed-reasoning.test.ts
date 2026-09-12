import { describe, expect, it } from 'vitest';

import { createStreamedReasoningByThread } from '../../src/main/claude-agent/streamed-reasoning.ts';

describe('createStreamedReasoningByThread', () => {
	it('keeps each thread apart', () => {
		const registry = createStreamedReasoningByThread();

		registry.forThread(null).append(0, 'main thread');
		registry.forThread('tool-1').append(0, 'subagent');

		expect(registry.forThread(null).take(0)).toBe('main thread');
		expect(registry.forThread('tool-1').take(0)).toBe('subagent');
	});

	it('drops a released thread rather than retaining its buffer', () => {
		const registry = createStreamedReasoningByThread();
		const buffer = registry.forThread('tool-1');
		buffer.append(0, 'banked');

		registry.release('tool-1');

		expect(registry.forThread('tool-1')).not.toBe(buffer);
		expect(registry.forThread('tool-1').take(0)).toBe(null);
	});

	it('releasing one thread leaves another untouched', () => {
		const registry = createStreamedReasoningByThread();
		registry.forThread('tool-1').append(0, 'first');
		registry.forThread('tool-2').append(0, 'second');

		registry.release('tool-1');

		expect(registry.forThread('tool-2').take(0)).toBe('second');
	});
});
