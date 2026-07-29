import { describe, expect, test } from 'vitest';

import {
	buildCustomMessagePart,
	customMessageDataOf,
} from '../../src/renderer/lib/pi/custom-message-part';
import {
	buildSkillPart,
	skillPartDataOf,
} from '../../src/renderer/lib/pi/skill-part';
import type { UIMessagePart } from '../../src/renderer/types/pi-timeline';

function partWithData(type: string, data: unknown): UIMessagePart {
	return { data, type } as unknown as UIMessagePart;
}

describe('skillPartDataOf', () => {
	test('round-trips a part built by buildSkillPart', () => {
		expect(skillPartDataOf(buildSkillPart('caveman'))).toEqual({
			name: 'caveman',
		});
	});

	test('rejects a part of a different type', () => {
		expect(
			skillPartDataOf({ state: 'done', text: 'hi', type: 'text' }),
		).toBeNull();
	});

	test('rejects a part carrying no data', () => {
		expect(
			skillPartDataOf({ type: 'data-pi-skill' } as unknown as UIMessagePart),
		).toBeNull();
	});

	test('rejects non-object and null data', () => {
		expect(
			skillPartDataOf(partWithData('data-pi-skill', 'caveman')),
		).toBeNull();
		expect(skillPartDataOf(partWithData('data-pi-skill', null))).toBeNull();
	});

	test('rejects a missing, non-string, or empty name', () => {
		expect(skillPartDataOf(partWithData('data-pi-skill', {}))).toBeNull();
		expect(
			skillPartDataOf(partWithData('data-pi-skill', { name: 42 })),
		).toBeNull();
		expect(
			skillPartDataOf(partWithData('data-pi-skill', { name: '' })),
		).toBeNull();
	});
});

describe('customMessageDataOf', () => {
	test('round-trips a part built by buildCustomMessagePart', () => {
		const data = { customType: 'context7', display: true, text: 'docs' };

		expect(customMessageDataOf(buildCustomMessagePart(data))).toEqual(data);
	});

	test('rejects a part of a different type', () => {
		expect(
			customMessageDataOf({ state: 'done', text: 'hi', type: 'text' }),
		).toBeNull();
	});

	test('rejects a part carrying no data', () => {
		expect(
			customMessageDataOf({
				type: 'data-pi-custom',
			} as unknown as UIMessagePart),
		).toBeNull();
	});

	test('rejects non-object and null data', () => {
		expect(customMessageDataOf(partWithData('data-pi-custom', 7))).toBeNull();
		expect(
			customMessageDataOf(partWithData('data-pi-custom', null)),
		).toBeNull();
	});

	test('rejects a non-string customType or text', () => {
		expect(
			customMessageDataOf(partWithData('data-pi-custom', { text: 'docs' })),
		).toBeNull();
		expect(
			customMessageDataOf(
				partWithData('data-pi-custom', { customType: 'ctx7' }),
			),
		).toBeNull();
		expect(
			customMessageDataOf(
				partWithData('data-pi-custom', { customType: 5, text: 'docs' }),
			),
		).toBeNull();
	});

	test('coerces a non-boolean display to false rather than rejecting', () => {
		expect(
			customMessageDataOf(
				partWithData('data-pi-custom', {
					customType: 'ctx7',
					display: 'yes',
					text: 'docs',
				}),
			),
		).toEqual({ customType: 'ctx7', display: false, text: 'docs' });
	});
});
