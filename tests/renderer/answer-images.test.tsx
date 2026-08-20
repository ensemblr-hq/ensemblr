// @vitest-environment happy-dom

/**
 * Streamdown frames every image in a block media widget — a 1rem block margin
 * plus hover download chrome. Bots write images as inline badges (a PR comment's
 * status dot, a project favicon), and that margin drops the link beside them onto
 * a line of its own, which is what made Vercel's deployment table read as two
 * ragged rows. Images render bare and inline instead.
 */

import { fireEvent } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { expect, test } from 'vitest';

import { ChatMessageText } from '../../src/renderer/components/chat-message-text';
import { renderWithProviders } from './support/dom';

const BADGE_ROW =
	'| Project | Deployment |\n| :--- | :--- |\n| ![](https://vercel.com/avatar.svg) [inherence-dev](https://vercel.com/p) | ![Ready](https://vercel.com/static/status/ready.svg) [Ready](https://vercel.com/d) |';

/** Renders markdown through the shipped answer renderer inside a fresh store. */
function renderMarkdown(text: string) {
	const { container } = renderWithProviders(
		<Provider store={createStore()}>
			<ChatMessageText text={text} />
		</Provider>,
	);
	return container;
}

test('an image carries no block media wrapper', () => {
	const container = renderMarkdown(BADGE_ROW);

	expect(
		container.querySelectorAll('[data-streamdown="image-wrapper"]'),
	).toHaveLength(0);
	expect(container.querySelectorAll('[data-streamdown="image"]')).toHaveLength(
		2,
	);
});

test('a badge stays inline with the link beside it', () => {
	const container = renderMarkdown(BADGE_ROW);
	const badge = container.querySelector('[data-streamdown="image"]');

	expect(badge?.className).toContain('inline-block');
	expect(badge?.className).toContain('align-middle');
	expect(badge?.className).not.toContain('my-4');
});

// Streamdown unwraps the paragraph around a lone image, so it lands as a
// block-level child of the answer root — which is what the stylesheet's
// `.ensemblr-answer > [data-streamdown="image"]` rule keys off.
test('an image that stands alone is a direct child of the answer root', () => {
	const container = renderMarkdown('![A diagram](https://example.com/d.png)');
	const answer = container.querySelector('.ensemblr-answer');

	expect(answer?.querySelector(':scope > [data-streamdown="image"]')).not.toBe(
		null,
	);
});

test('an image without a source renders nothing rather than a broken frame', () => {
	const container = renderMarkdown('![missing]()');

	expect(container.querySelectorAll('[data-streamdown="image"]')).toHaveLength(
		0,
	);
});

// A host that refuses the fetch — an expired link, a private asset, an offline
// machine — otherwise falls through to the platform's broken-image glyph, which
// reads as a rendering fault in the app rather than as a missing picture.
test('an image whose fetch fails is replaced by a placeholder carrying its alt text', () => {
	const container = renderMarkdown('![A diagram](https://example.com/d.png)');
	const image = container.querySelector('[data-streamdown="image"]');

	expect(image).not.toBe(null);
	if (image) {
		fireEvent.error(image);
	}

	expect(container.querySelector('[data-streamdown="image"]')).toBe(null);
	expect(
		container.querySelector('[data-streamdown="image-unavailable"]')
			?.textContent,
	).toContain('A diagram');
});

test('an image with no alt text falls back to a named failure', () => {
	const container = renderMarkdown('![](https://example.com/d.png)');
	const image = container.querySelector('[data-streamdown="image"]');

	if (image) {
		fireEvent.error(image);
	}

	expect(
		container.querySelector('[data-streamdown="image-unavailable"]')
			?.textContent,
	).toBe('Image unavailable');
});
