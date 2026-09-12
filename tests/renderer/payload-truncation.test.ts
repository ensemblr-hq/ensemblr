/**
 * A persisted event payload is capped at 256 KiB and the writer keeps the head
 * of the bulk-carrying field, so a truncated tool result arrives looking exactly
 * like a complete one. These pin the notice that says otherwise.
 */

import { describe, expect, test } from 'vitest';

import { withTruncationNotice } from '../../src/renderer/lib/agent-timeline/payload-truncation';

describe('withTruncationNotice', () => {
	test('returns the same string identity when nothing was dropped', () => {
		const text = 'complete output';
		expect(withTruncationNotice(text, undefined)).toBe(text);
		expect(withTruncationNotice(text, 0)).toBe(text);
	});

	test('appends a notice carrying the dropped size in kibibytes', () => {
		const notice = withTruncationNotice('head of the output', 240 * 1024);
		expect(notice).toContain('head of the output');
		expect(notice).toContain('240 KB');
	});

	test('switches to mebibytes once the drop reaches one', () => {
		expect(withTruncationNotice('x', 3 * 1024 * 1024)).toContain('3 MB');
	});

	test('never reports zero kilobytes for a drop that happened', () => {
		expect(withTruncationNotice('x', 12)).toContain('1 KB');
	});

	test('stands alone when the payload kept no text at all', () => {
		const notice = withTruncationNotice('', 5 * 1024);
		expect(notice.startsWith('\n')).toBe(false);
		expect(notice).toContain('5 KB');
	});
});
