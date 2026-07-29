// @vitest-environment happy-dom

/**
 * Switching chat tabs unmounts the timeline, so the viewport has to be put back
 * where the user left it on the way in. These tests drive the real
 * Conversation/ConversationContent pair and assert the remembered position
 * survives an unmount, stays scoped to its own tab, and yields to stickiness
 * when the user was following the stream.
 */

import { getDefaultStore } from 'jotai';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';

import {
	Conversation,
	ConversationContent,
} from '../../src/renderer/components/conversation';
import { conversationScrollOffsetsAtom } from '../../src/renderer/state/conversation-scroll';
import { renderWithProviders } from './support/dom';

const VIEWPORT_SELECTOR = '[data-slot="conversation-scroll-area-viewport"]';
const CLIENT_HEIGHT = 400;
const SCROLL_HEIGHT = 1000;

/** Renders one conversation surface and returns its scrolling viewport. */
function renderConversation(scrollKey?: string) {
	const view = renderWithProviders(
		<Conversation key={scrollKey}>
			<ConversationContent scrollKey={scrollKey}>
				<p>message</p>
			</ConversationContent>
		</Conversation>,
	);
	const viewport = view.container.querySelector(VIEWPORT_SELECTOR);
	if (!(viewport instanceof HTMLElement)) {
		throw new Error('conversation viewport did not render');
	}
	return { ...view, viewport };
}

/** Moves the viewport the way a user would, so the scroll listener records it. */
function scrollTo(viewport: HTMLElement, scrollTop: number): void {
	viewport.scrollTop = scrollTop;
	viewport.dispatchEvent(new Event('scroll'));
}

beforeAll(() => {
	// happy-dom has no layout engine, so the metrics the offset math reads are
	// all zero unless they are stubbed.
	Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
		configurable: true,
		get: () => CLIENT_HEIGHT,
	});
	Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
		configurable: true,
		get: () => SCROLL_HEIGHT,
	});
});

beforeEach(() => {
	getDefaultStore().set(conversationScrollOffsetsAtom, {});
});

describe('conversation scroll restore', () => {
	test('opens a conversation it has never seen at the newest message', () => {
		const { viewport } = renderConversation('tab-a');

		expect(viewport.scrollTop).toBe(SCROLL_HEIGHT);
	});

	test('reopens a scrolled-up conversation where the user left it', () => {
		const first = renderConversation('tab-a');
		scrollTo(first.viewport, 120);
		first.unmount();

		const second = renderConversation('tab-a');

		expect(second.viewport.scrollTop).toBe(120);
	});

	test('keeps remembered positions scoped to their own tab', () => {
		const first = renderConversation('tab-a');
		scrollTo(first.viewport, 120);
		first.unmount();

		const second = renderConversation('tab-b');

		expect(second.viewport.scrollTop).toBe(SCROLL_HEIGHT);
	});

	test('keeps following the stream when the user left the tab at the bottom', () => {
		const first = renderConversation('tab-a');
		scrollTo(first.viewport, 120);
		scrollTo(first.viewport, SCROLL_HEIGHT);
		first.unmount();

		const second = renderConversation('tab-a');

		expect(second.viewport.scrollTop).toBe(SCROLL_HEIGHT);
	});

	test('opens at the newest message when no scroll key is given', () => {
		const first = renderConversation('tab-a');
		scrollTo(first.viewport, 120);
		first.unmount();

		const second = renderConversation();

		expect(second.viewport.scrollTop).toBe(SCROLL_HEIGHT);
	});
});
