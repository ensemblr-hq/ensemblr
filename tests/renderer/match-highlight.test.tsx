// @vitest-environment happy-dom

/**
 * The highlight has to survive a stale pairing of text and ranges: the menu
 * re-renders between a keystroke and the rescore it triggers.
 */

import { render } from '@testing-library/react';
import { expect, test } from 'vitest';

import { MatchHighlight } from '../../src/renderer/components/workbench-shell/conversation-panel/composer/match-highlight';

/** Reads the dimmed runs the highlight rendered, in order. */
function mutedText(container: HTMLElement): string[] {
	return [...container.querySelectorAll('.text-muted-foreground')].map(
		(node) => node.textContent ?? '',
	);
}

test('renders plain text when nothing matched', () => {
	const { container } = render(
		<MatchHighlight ranges={[]} text='code-review' />,
	);
	expect(container.textContent).toBe('code-review');
	expect(mutedText(container)).toEqual([]);
});

test('dims only the characters outside the matched range', () => {
	const { container } = render(
		<MatchHighlight ranges={[{ end: 5, start: 0 }]} text='code-review' />,
	);
	expect(container.textContent).toBe('code-review');
	expect(mutedText(container)).toEqual(['review']);
});

test('renders every character exactly once across several ranges', () => {
	const { container } = render(
		<MatchHighlight
			ranges={[
				{ end: 2, start: 0 },
				{ end: 8, start: 6 },
			]}
			text='context-mode'
		/>,
	);
	expect(container.textContent).toBe('context-mode');
	expect(mutedText(container)).toEqual(['ntex', 'mode']);
});

test('dims nothing when touching ranges cover the whole string', () => {
	const { container } = render(
		<MatchHighlight
			ranges={[
				{ end: 2, start: 0 },
				{ end: 4, start: 2 },
			]}
			text='code'
		/>,
	);
	expect(container.textContent).toBe('code');
	expect(mutedText(container)).toEqual([]);
});

test('ignores ranges that fall outside the text instead of throwing', () => {
	const { container } = render(
		<MatchHighlight
			ranges={[
				{ end: 99, start: 40 },
				{ end: 2, start: 5 },
			]}
			text='code'
		/>,
	);
	expect(container.textContent).toBe('code');
});
