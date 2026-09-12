/**
 * A streaming markdown renderer memoizes the blocks it has drawn but still
 * re-lexes the whole string per delta to find them, so one token costs O(answer)
 * and the answer only grows. Splitting at the last closed column-zero fence caps
 * that walk — provided the boundary is one no markdown container can straddle.
 */

import { describe, expect, test } from 'vitest';

import { splitSettledMarkdown } from '../../src/renderer/lib/agent-timeline/streaming-markdown-split';

describe('splitSettledMarkdown', () => {
	test('leaves prose with no fence whole', () => {
		const text = 'First paragraph.\n\nSecond paragraph.';
		expect(splitSettledMarkdown(text)).toEqual({ settled: '', tail: text });
	});

	test('splits after a closed fence followed by a blank line', () => {
		const text = 'Intro.\n\n```ts\nconst a = 1;\n```\n\nAfter.';
		const { settled, tail } = splitSettledMarkdown(text);

		expect(settled).toBe('Intro.\n\n```ts\nconst a = 1;\n```\n');
		expect(tail).toBe('\nAfter.');
		expect(settled + tail).toBe(text);
	});

	test('splits at the last closed fence, not the first', () => {
		const text =
			'a\n\n```ts\none\n```\n\nb\n\n```ts\ntwo\n```\n\nc, still arriving';
		const { settled, tail } = splitSettledMarkdown(text);

		expect(settled).toContain('two');
		expect(tail).toBe('\nc, still arriving');
	});

	test('never splits inside an open fence', () => {
		const text = 'a\n\n```ts\nconst a = 1;\n\nconst b = 2;';
		expect(splitSettledMarkdown(text)).toEqual({ settled: '', tail: text });
	});

	test('does not split on a fence whose close has not arrived after an earlier pair', () => {
		const text = 'a\n\n```ts\none\n```\n\n```ts\ntwo, still writing';
		const { settled, tail } = splitSettledMarkdown(text);

		expect(settled).toBe('a\n\n```ts\none\n```\n');
		expect(tail).toBe('\n```ts\ntwo, still writing');
	});

	test('ignores an indented fence, which belongs to a list item', () => {
		const text = '1. step\n\n   ```ts\n   const a = 1;\n   ```\n\n2. next';
		expect(splitSettledMarkdown(text)).toEqual({ settled: '', tail: text });
	});

	test('requires a blank line after the close so the tail starts on a block', () => {
		const text = 'a\n\n```ts\none\n```\nlazy continuation';
		expect(splitSettledMarkdown(text)).toEqual({ settled: '', tail: text });
	});

	test('leaves a text that ends exactly at the boundary whole', () => {
		const text = 'a\n\n```ts\none\n```\n';
		expect(splitSettledMarkdown(text)).toEqual({ settled: '', tail: text });
	});

	test('honours the CommonMark rule that a close is at least as long as its open', () => {
		const text = 'a\n\n````ts\n```\nnested\n````\n\nafter';
		const { settled, tail } = splitSettledMarkdown(text);

		expect(settled).toBe('a\n\n````ts\n```\nnested\n````\n');
		expect(tail).toBe('\nafter');
	});

	test('does not close a backtick fence with a tilde one', () => {
		const text = 'a\n\n```ts\none\n~~~\n\nstill inside';
		expect(splitSettledMarkdown(text)).toEqual({ settled: '', tail: text });
	});

	test('always reconstructs the input exactly', () => {
		const texts = [
			'',
			'plain',
			'```\na\n```\n\nb',
			'x\n\n```\ny\n```\n\n```\nz\n```\n\nw',
		];
		for (const text of texts) {
			const { settled, tail } = splitSettledMarkdown(text);
			expect(settled + tail).toBe(text);
		}
	});
});
