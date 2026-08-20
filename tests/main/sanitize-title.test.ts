import { describe, expect, test } from 'vitest';

import {
	CHAT_TITLE_MAX_LENGTH,
	cleanTitleLine,
	sanitizeChatTitle,
	truncateChatTitle,
} from '../../src/main/agent-runtime/naming/sanitize-title';

describe('cleanTitleLine', () => {
	test('returns null for empty or whitespace input', () => {
		expect(cleanTitleLine('')).toBeNull();
		expect(cleanTitleLine('   \n  ')).toBeNull();
	});

	test('keeps a clean short title unchanged', () => {
		expect(cleanTitleLine('Fix login redirect')).toBe('Fix login redirect');
	});

	test('takes only the first non-empty line', () => {
		expect(cleanTitleLine('\n\nAdd dark mode\nsome explanation')).toBe(
			'Add dark mode',
		);
	});

	test('strips code fences, markdown, bullets, and prefixes', () => {
		expect(cleanTitleLine('```\nTitle: **Add dark mode**\n```')).toBe(
			'Add dark mode',
		);
		expect(cleanTitleLine('- Refactor auth')).toBe('Refactor auth');
		expect(cleanTitleLine("Here's the title: Cache tokens")).toBe(
			'Cache tokens',
		);
	});

	test('strips summary preambles so session summaries share this cleaner', () => {
		expect(cleanTitleLine("Here's the summary: Cache tokens")).toBe(
			'Cache tokens',
		);
		expect(cleanTitleLine("Here's a session summary — Cache tokens")).toBe(
			'Cache tokens',
		);
		expect(cleanTitleLine('The summary is: Cache tokens')).toBe('Cache tokens');
	});

	test('strips surrounding quotes and trailing punctuation', () => {
		expect(cleanTitleLine('"Update billing flow."')).toBe(
			'Update billing flow',
		);
	});

	test('decodes HTML entities the title arrived encoded with', () => {
		expect(cleanTitleLine('Admin &amp; Management')).toBe('Admin & Management');
		expect(cleanTitleLine('Compare &lt;div&gt; output')).toBe(
			'Compare <div> output',
		);
		expect(cleanTitleLine('It&#39;s the billing flow')).toBe(
			"It's the billing flow",
		);
		expect(cleanTitleLine('Admin &#38; Management')).toBe('Admin & Management');
		expect(cleanTitleLine('Admin &#x26; Management')).toBe(
			'Admin & Management',
		);
	});

	test('collapses a decoded non-breaking space into a plain space', () => {
		expect(cleanTitleLine('Admin&nbsp;panel')).toBe('Admin panel');
	});

	test('decodes doubly-escaped input down to one character', () => {
		expect(cleanTitleLine('Admin &amp;amp; Management')).toBe(
			'Admin & Management',
		);
	});

	test('leaves a bare ampersand untouched', () => {
		expect(cleanTitleLine('Admin & Management')).toBe('Admin & Management');
	});

	test('leaves the decoded title as prose rather than a slug', () => {
		expect(cleanTitleLine('Admin &amp; Management')).not.toMatch(/-/);
		expect(cleanTitleLine('Admin &amp; Management')).not.toBe(
			'Admin and Management',
		);
	});

	test('leaves an over-long title at full length', () => {
		const long = 'Implement comprehensive workspace renaming pipeline system';
		expect(cleanTitleLine(long)).toBe(long);
	});
});

describe('truncateChatTitle', () => {
	test('leaves a title within the cap untouched', () => {
		expect(truncateChatTitle('Fix login redirect')).toBe('Fix login redirect');
	});

	test('truncates over-long titles at a word boundary with an ellipsis', () => {
		const result = truncateChatTitle(
			'Implement comprehensive workspace renaming pipeline system',
		);
		expect(result.length).toBeLessThanOrEqual(CHAT_TITLE_MAX_LENGTH);
		expect(result).toMatch(/…$/);
		expect(result).not.toMatch(/ …$/);
	});

	test('hard-cuts a single word too long to break on a boundary', () => {
		const result = truncateChatTitle('A'.repeat(CHAT_TITLE_MAX_LENGTH + 20));
		expect(result.length).toBe(CHAT_TITLE_MAX_LENGTH);
		expect(result).toMatch(/…$/);
	});
});

describe('sanitizeChatTitle', () => {
	test('returns null when nothing usable remains', () => {
		expect(sanitizeChatTitle('')).toBeNull();
		expect(sanitizeChatTitle('   \n  ')).toBeNull();
	});

	test('returns identical display and full forms for a short title', () => {
		expect(sanitizeChatTitle('"Update billing flow."')).toEqual({
			display: 'Update billing flow',
			full: 'Update billing flow',
		});
	});

	test('decodes entities in both the tab title and the tooltip form', () => {
		expect(sanitizeChatTitle('Admin &amp; Management')).toEqual({
			display: 'Admin & Management',
			full: 'Admin & Management',
		});
	});

	test('caps display while keeping the untruncated title in full', () => {
		const long = 'Implement comprehensive workspace renaming pipeline system';
		const result = sanitizeChatTitle(long);
		expect(result?.full).toBe(long);
		expect(result?.display.length).toBeLessThanOrEqual(CHAT_TITLE_MAX_LENGTH);
		expect(result?.display).toMatch(/…$/);
	});
});
