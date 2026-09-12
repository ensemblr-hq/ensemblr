// @vitest-environment happy-dom

/**
 * Streamdown memoizes the blocks it has already drawn, but it re-lexes the whole
 * markdown string on every delta to find where those blocks start and end — so
 * one streamed token costs a walk over the whole answer, and the answer only
 * grows. The audit measured that walk at 0.84 ms on an 8-byte answer and 4.32 ms
 * on a 23 KB one, per delta.
 *
 * `ChatMessageText` therefore hands a long answer over in two pieces, cut at the
 * last fenced block that closed. The first piece is a string that can no longer
 * change, so the memo on `MessageResponse` skips it and the walk is bounded by
 * the tail. This counts which piece re-renders, and checks the two pieces still
 * draw what one did.
 */

import { screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { ChatMessageText } from '@/renderer/components/chat-message-text';
import { renderWithProviders } from '../support/dom';

/** Every markdown string a renderer instance was handed, in render order. */
const rendered: string[] = [];

vi.mock('streamdown', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	Streamdown: ({ children }: { children?: unknown }) => {
		rendered.push(String(children));
		return <div data-testid='markdown'>{String(children)}</div>;
	},
}));

const SETTLED = 'Here is the fix.\n\n```ts\nconst a = 1;\n```\n';

describe('a streaming answer past its first closed fence', () => {
	test('re-renders only the tail as tokens arrive', () => {
		const { rerender } = renderWithProviders(
			<ChatMessageText text={`${SETTLED}\nIt`} />,
		);
		expect(rendered).toEqual([SETTLED, '\nIt']);

		rendered.length = 0;
		for (const tail of ['\nIt works', '\nIt works because']) {
			rerender(<ChatMessageText text={`${SETTLED}${tail}`} />);
		}

		expect(rendered).toEqual(['\nIt works', '\nIt works because']);
	});

	test('the tail handed to the live renderer does not grow with the answer', () => {
		const long = Array.from(
			{ length: 40 },
			(_, index) => `Paragraph ${index}.`,
		).join('\n\n');
		rendered.length = 0;
		renderWithProviders(
			<ChatMessageText text={`${long}\n\n${SETTLED}\nShort tail`} />,
		);

		expect(rendered.at(-1)).toBe('\nShort tail');
		expect(rendered.at(-1)?.length).toBeLessThan(long.length);
	});

	test('renders an answer with no closed fence as one piece', () => {
		rendered.length = 0;
		renderWithProviders(
			<ChatMessageText text={'Plain prose.\n\nMore prose.'} />,
		);

		expect(rendered).toEqual(['Plain prose.\n\nMore prose.']);
	});

	test('reassembles to exactly the answer it was given', () => {
		const text = `${SETTLED}\nAnd then some.`;
		rendered.length = 0;
		renderWithProviders(<ChatMessageText text={text} />);

		expect(rendered.join('')).toBe(text);
		expect(screen.getAllByTestId('markdown')).toHaveLength(2);
	});
});
