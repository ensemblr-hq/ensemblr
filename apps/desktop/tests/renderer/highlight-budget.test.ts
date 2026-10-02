/**
 * Shiki's `codeToTokens` runs to completion in one synchronous task, so the only
 * thing standing between a committed bundle and a frozen window is the budget
 * this file guards. Each assertion pins one of the three bounds at its boundary,
 * so a threshold that moves names itself rather than going quiet.
 */

import { describe, expect, test } from 'vitest';

import {
	isWithinHighlightBudget,
	MAX_HIGHLIGHT_CHARS,
	MAX_HIGHLIGHT_LINE_LENGTH,
	MAX_HIGHLIGHT_LINES,
} from '../../src/renderer/hooks/code-surface/highlight-budget';

describe('isWithinHighlightBudget', () => {
	test('accepts an ordinary source file', () => {
		const source = Array.from(
			{ length: 200 },
			(_, index) => `const value${index} = ${index};`,
		).join('\n');
		expect(isWithinHighlightBudget(source)).toBe(true);
	});

	test('accepts exactly the line ceiling and refuses one line more', () => {
		const atCeiling = Array.from(
			{ length: MAX_HIGHLIGHT_LINES },
			() => 'a',
		).join('\n');
		const overCeiling = Array.from(
			{ length: MAX_HIGHLIGHT_LINES + 1 },
			() => 'a',
		).join('\n');
		expect(isWithinHighlightBudget(atCeiling)).toBe(true);
		expect(isWithinHighlightBudget(overCeiling)).toBe(false);
	});

	test('refuses one very long line even when the file is short', () => {
		const atCeiling = 'x'.repeat(MAX_HIGHLIGHT_LINE_LENGTH);
		const overCeiling = 'x'.repeat(MAX_HIGHLIGHT_LINE_LENGTH + 1);
		expect(isWithinHighlightBudget(atCeiling)).toBe(true);
		expect(isWithinHighlightBudget(overCeiling)).toBe(false);
	});

	test('refuses a long line wherever it sits in the file', () => {
		const long = 'x'.repeat(MAX_HIGHLIGHT_LINE_LENGTH + 1);
		expect(isWithinHighlightBudget(`a\n${long}\nb`)).toBe(false);
		expect(isWithinHighlightBudget(`a\nb\n${long}`)).toBe(false);
		expect(isWithinHighlightBudget(`${long}\na\nb`)).toBe(false);
	});

	test('refuses a source over the total character ceiling', () => {
		const wide = `${'y'.repeat(MAX_HIGHLIGHT_LINE_LENGTH - 1)}\n`;
		const source = wide.repeat(
			Math.ceil(MAX_HIGHLIGHT_CHARS / wide.length) + 1,
		);
		expect(source.length).toBeGreaterThan(MAX_HIGHLIGHT_CHARS);
		expect(isWithinHighlightBudget(source)).toBe(false);
	});

	test('accepts an empty source', () => {
		expect(isWithinHighlightBudget('')).toBe(true);
	});
});
