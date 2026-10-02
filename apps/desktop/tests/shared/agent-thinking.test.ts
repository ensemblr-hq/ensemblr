import { describe, expect, it } from 'vitest';

import {
	getThinkingAxisLabel,
	getThinkingLevelLabel,
	listThinkingLevels,
} from '../../src/shared/agent-thinking.ts';

describe('each runtime keeps its own thinking vocabulary', () => {
	it('gives pi `minimal` and Claude `max`', () => {
		expect(listThinkingLevels('pi')).toEqual([
			'off',
			'minimal',
			'low',
			'medium',
			'high',
			'xhigh',
		]);
		expect(listThinkingLevels('claude')).toEqual([
			'off',
			'low',
			'medium',
			'high',
			'xhigh',
			'max',
		]);
	});

	it('labels Claude`s top level rather than leaking the raw id', () => {
		expect(getThinkingLevelLabel('claude', 'max')).toBe('Max');
		expect(getThinkingLevelLabel('claude', 'xhigh')).toBe('Extra high');
		expect(getThinkingLevelLabel('pi', 'minimal')).toBe('Minimal');
	});

	it('falls back to the raw id for a level a runtime adds later', () => {
		expect(getThinkingLevelLabel('claude', 'ultra')).toBe('ultra');
	});

	it('names the dial the way each runtime does', () => {
		expect(getThinkingAxisLabel('claude')).toBe('Effort');
		expect(getThinkingAxisLabel('pi')).toBe('Thinking');
	});
});
