import { describe, expect, test } from 'vitest';

import { contentBlockToPart } from '../../src/main/pi-agent/pi-wire-normalizer.ts';

describe('contentBlockToPart', () => {
	test('maps a thinking block to a reasoning part', () => {
		expect(
			contentBlockToPart({ thinking: 'weighing it up', type: 'thinking' }),
		).toEqual({ kind: 'reasoning', text: 'weighing it up' });
	});

	test('drops a thinking block Pi sent with no text', () => {
		expect(contentBlockToPart({ thinking: '', type: 'thinking' })).toBeNull();
	});

	test('maps a text block to a text part', () => {
		expect(contentBlockToPart({ text: 'hello', type: 'text' })).toEqual({
			kind: 'text',
			text: 'hello',
		});
	});
});
