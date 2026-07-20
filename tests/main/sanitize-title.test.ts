import { describe, expect, test } from 'vitest';

import {
	CHAT_TITLE_MAX_LENGTH,
	sanitizeChatTitle,
} from '../../src/main/pi-agent/naming/sanitize-title';

describe('sanitizeChatTitle', () => {
	test('returns null for empty or whitespace input', () => {
		expect(sanitizeChatTitle('')).toBeNull();
		expect(sanitizeChatTitle('   \n  ')).toBeNull();
	});

	test('keeps a clean short title unchanged', () => {
		expect(sanitizeChatTitle('Fix login redirect')).toBe('Fix login redirect');
	});

	test('takes only the first non-empty line', () => {
		expect(sanitizeChatTitle('\n\nAdd dark mode\nsome explanation')).toBe(
			'Add dark mode',
		);
	});

	test('strips code fences, markdown, bullets, and prefixes', () => {
		expect(sanitizeChatTitle('```\nTitle: **Add dark mode**\n```')).toBe(
			'Add dark mode',
		);
		expect(sanitizeChatTitle('- Refactor auth')).toBe('Refactor auth');
		expect(sanitizeChatTitle("Here's the title: Cache tokens")).toBe(
			'Cache tokens',
		);
	});

	test('strips surrounding quotes and trailing punctuation', () => {
		expect(sanitizeChatTitle('"Update billing flow."')).toBe(
			'Update billing flow',
		);
	});

	test('truncates over-long titles at a word boundary with an ellipsis', () => {
		const long = 'Implement comprehensive workspace renaming pipeline system';
		const result = sanitizeChatTitle(long);
		expect(result).not.toBeNull();
		expect((result as string).length).toBeLessThanOrEqual(
			CHAT_TITLE_MAX_LENGTH,
		);
		expect(result as string).toMatch(/…$/);
		expect(result as string).not.toMatch(/ …$/);
	});
});
