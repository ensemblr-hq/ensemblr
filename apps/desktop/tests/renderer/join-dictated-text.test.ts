import { describe, expect, test } from 'vitest';

import { joinDictatedText } from '../../src/renderer/lib/dictation/join-dictated-text.ts';

describe('joinDictatedText', () => {
	test('inserts without a leading space at the start of an empty draft', () => {
		expect(joinDictatedText('', 'fix the parser')).toBe('fix the parser');
	});

	test('adds a space when the caret sits right after a word', () => {
		expect(joinDictatedText('fix the', 'parser bug')).toBe(' parser bug');
	});

	test('does not double a space the draft already ends with', () => {
		expect(joinDictatedText('fix the ', 'parser')).toBe('parser');
	});

	test('does not add a space after a newline', () => {
		expect(joinDictatedText('first line\n', 'second line')).toBe('second line');
	});

	test('keeps trailing punctuation attached to the previous word', () => {
		expect(joinDictatedText('done', ', then ship it')).toBe(', then ship it');
	});

	test('trims the transcript the provider returned', () => {
		expect(joinDictatedText('fix the', '  parser bug  ')).toBe(' parser bug');
	});

	test('inserts nothing for a blank transcript', () => {
		expect(joinDictatedText('fix the', '   ')).toBe('');
	});

	test('spaces against the text before the caret, not the end of the draft', () => {
		expect(joinDictatedText('fix the', 'broken')).toBe(' broken');
	});
});
