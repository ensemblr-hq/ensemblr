// @vitest-environment happy-dom

/**
 * A transcript the user has scrolled away from must not move while the turn
 * below them is still being written. These tests drive the real
 * Conversation/ConversationContent pair, stand in for the layout happy-dom does
 * not have, and step the content height up and down the way a streaming turn
 * does — a fenced block being re-tokenized, a tool card swapping to its result.
 */

import { act } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
	Conversation,
	ConversationContent,
} from '../../src/renderer/components/conversation';
import { conversationScrollOffsetsAtom } from '../../src/renderer/state/conversation-scroll';
import { renderWithProviders } from './support/dom';

const VIEWPORT_SELECTOR = '[data-slot="conversation-scroll-area-viewport"]';
const CLIENT_HEIGHT = 400;
const INITIAL_SCROLL_HEIGHT = 2000;
const SCROLLED_UP_TO = 600;
const SCROLLED_DOWN_TO = 1000;

/**
 * A shrink that leaves the held offset 50px above the new end — inside the
 * library's 70px near-bottom threshold, so it re-arms its lock without the
 * offset ever going out of reach.
 */
const SHRUNK_NEAR_HELD_HEIGHT = 1050;

/**
 * Every ResizeObserver constructed while a test runs, so the content resizes a
 * stream produces can be delivered on demand. Order is preserved: the library
 * registers its observer before the conversation's own, and the correction only
 * works because it lands after the library's clamp.
 */
const observers: Array<{ callback: ResizeObserverCallback; targets: Node[] }> =
	[];

/** Height the stubbed layout currently reports for the scrolling content. */
let scrollHeight = INITIAL_SCROLL_HEIGHT;

/** The rendered viewport, so a resize can clamp and notify it as a browser would. */
let viewportElement: HTMLElement | null = null;

/** Replaces happy-dom's no-op ResizeObserver with one the tests can drive. */
class DrivableResizeObserver implements ResizeObserver {
	private readonly entry = { targets: [] as Node[] };

	constructor(callback: ResizeObserverCallback) {
		observers.push({ callback, targets: this.entry.targets });
	}

	observe(target: Element): void {
		this.entry.targets.push(target);
	}

	unobserve(): void {}

	disconnect(): void {
		this.entry.targets.length = 0;
	}
}

/**
 * Pulls the offset back into range after a shrink and fires the scroll event
 * that move produces, the way a browser does before anything observes the
 * resize. Without it the held position is never asked to survive its own clamp.
 */
function clampViewport(): void {
	const viewport = viewportElement;
	if (viewport === null) {
		return;
	}
	const before = viewport.scrollTop;
	viewport.scrollTop = before;
	if (viewport.scrollTop !== before) {
		viewport.dispatchEvent(new Event('scroll'));
	}
}

/**
 * Reports a new content height to everything observing it, in registration
 * order, the way the browser delivers one resize to every observer.
 * @param height - The height the content now occupies
 */
function resizeContentTo(height: number): void {
	act(() => {
		scrollHeight = height;
		clampViewport();
		for (const observer of observers) {
			if (observer.targets.length === 0) {
				continue;
			}
			const entries = observer.targets.map((target) => ({
				contentRect: { height },
				target,
			})) as unknown as ResizeObserverEntry[];
			observer.callback(entries, {} as ResizeObserver);
		}
	});
}

/**
 * Renders one conversation surface holding a message with a pane that scrolls in
 * its own right, the shape a tool card or a long table gives the timeline. The
 * escape probe reads the lock straight off the stick-to-bottom context, so a
 * test can assert on it without inferring it from where the viewport landed.
 */
function renderConversation() {
	const view = renderWithProviders(
		<Conversation>
			<ConversationContent scrollKey='tab-a'>
				{(context) => (
					<>
						<span data-testid='escaped'>{String(context.escapedFromLock)}</span>
						<div data-testid='pane' style={{ overflowY: 'auto' }}>
							<p>tool output</p>
						</div>
					</>
				)}
			</ConversationContent>
		</Conversation>,
	);
	const viewport = view.container.querySelector(VIEWPORT_SELECTOR);
	if (!(viewport instanceof HTMLElement)) {
		throw new Error('conversation viewport did not render');
	}
	viewportElement = viewport;
	return {
		...view,
		escaped: () => view.getByTestId('escaped').textContent === 'true',
		pane: view.getByTestId('pane'),
		viewport,
	};
}

/** Moves the viewport the way a user would, so the scroll listeners record it. */
function scrollTo(viewport: HTMLElement, scrollTop: number): void {
	act(() => {
		viewport.scrollTop = scrollTop;
		viewport.dispatchEvent(new Event('scroll'));
	});
}

/**
 * Gives a pane a scroll offset of its own. The stub below defines `scrollTop` on
 * the prototype, so without this every element in the tree shares the viewport's.
 * @param pane - The pane to pin
 * @param scrollTop - The offset it should report
 */
function pinPaneScrollTop(pane: HTMLElement, scrollTop: number): void {
	Object.defineProperty(pane, 'scrollTop', {
		configurable: true,
		value: scrollTop,
	});
}

/**
 * Wheels upwards over an element, flushing whatever the gesture changed so the
 * escape probe reads the lock as the surface would render it.
 * @param element - What the gesture lands on
 * @param deltaY - How far it scrolls, negative being upwards
 */
function wheelUp(element: HTMLElement, deltaY: number): void {
	act(() => {
		element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY }));
	});
}

/**
 * Puts the viewport partway up a long transcript and waits for the library to
 * release the stick-to-bottom lock, which it decides on a timeout rather than
 * on the scroll event itself.
 */
async function renderScrolledUp() {
	const view = renderConversation();
	scrollTo(view.viewport, SCROLLED_UP_TO);
	await settleLock();
	// use-stick-to-bottom reads its first observation as a zero-height change, so
	// until one has landed no later resize can register with it as a shrink.
	resizeContentTo(INITIAL_SCROLL_HEIGHT);
	return view;
}

/** Lets use-stick-to-bottom's deferred scroll handling run. */
async function settleLock(): Promise<void> {
	await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
}

beforeEach(() => {
	scrollHeight = INITIAL_SCROLL_HEIGHT;
	observers.length = 0;
	viewportElement = null;
	getDefaultStore().set(conversationScrollOffsetsAtom, {});
	vi.stubGlobal('ResizeObserver', DrivableResizeObserver);
	// happy-dom has no layout engine and no scroll container, so the metrics the
	// hold reads are stubbed, and `scrollTop` is clamped here the way a browser
	// clamps it when the content shrinks out from under the offset.
	Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
		configurable: true,
		get: () => CLIENT_HEIGHT,
	});
	Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
		configurable: true,
		get: () => scrollHeight,
	});
	let offset = 0;
	Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
		configurable: true,
		get: () => offset,
		set: (next: number) => {
			offset = Math.max(0, Math.min(next, scrollHeight - CLIENT_HEIGHT));
		},
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('conversation scroll hold', () => {
	test('holds position while the streaming turn grows below', async () => {
		const { viewport } = await renderScrolledUp();

		for (let height = 2100; height <= 2600; height += 100) {
			resizeContentTo(height);
		}

		expect(viewport.scrollTop).toBe(SCROLLED_UP_TO);
	});

	test('holds position across a resize that shrinks the content and grows back', async () => {
		const { viewport } = await renderScrolledUp();

		resizeContentTo(2400);
		resizeContentTo(800);
		resizeContentTo(2400);

		expect(viewport.scrollTop).toBe(SCROLLED_UP_TO);
	});

	test('holds position when the content shrinks below the offset repeatedly', async () => {
		const { viewport } = await renderScrolledUp();
		const seen: number[] = [];

		for (let tick = 0; tick < 6; tick += 1) {
			resizeContentTo(tick % 2 === 0 ? 900 : 2400);
			seen.push(viewport.scrollTop);
		}
		resizeContentTo(2400);

		expect(viewport.scrollTop).toBe(SCROLLED_UP_TO);
		expect(seen.filter((offset) => offset === SCROLLED_UP_TO).length).toBe(3);
	});

	test('does not re-arm the lock when a shrink parks the viewport at the end', async () => {
		const { viewport } = await renderScrolledUp();

		resizeContentTo(800);
		for (let height = 2400; height <= 2800; height += 100) {
			resizeContentTo(height);
		}

		expect(viewport.scrollTop).toBe(SCROLLED_UP_TO);
	});

	test('keeps following the newest message when the user has not scrolled up', () => {
		const { viewport } = renderConversation();
		const followed = viewport.scrollTop;

		resizeContentTo(2600);

		expect(viewport.scrollTop).toBeGreaterThanOrEqual(followed);
	});

	test('releases the stick-to-bottom lock when the user scrolls up with a wheel', async () => {
		const { viewport } = renderConversation();

		wheelUp(viewport, -120);
		scrollTo(viewport, SCROLLED_UP_TO);
		resizeContentTo(2600);

		expect(viewport.scrollTop).toBe(SCROLLED_UP_TO);
	});

	test('releases the lock when a wheel chains out of a pane at its own top', () => {
		const { escaped, pane } = renderConversation();
		pinPaneScrollTop(pane, 0);

		wheelUp(pane, -120);

		expect(escaped()).toBe(true);
	});

	test('leaves the lock armed for a wheel inside a pane that scrolls itself', () => {
		const { escaped, pane, viewport } = renderConversation();
		pinPaneScrollTop(pane, 500);

		wheelUp(pane, -120);
		wheelUp(pane, -1);
		expect(escaped()).toBe(false);

		wheelUp(viewport, -120);

		expect(escaped()).toBe(true);
	});

	test('re-asserts the escape when a shrink parks the held offset near the end', async () => {
		const { escaped, viewport } = await renderScrolledUp();

		resizeContentTo(SHRUNK_NEAR_HELD_HEIGHT);
		expect(escaped()).toBe(true);

		resizeContentTo(2400);

		expect(viewport.scrollTop).toBe(SCROLLED_UP_TO);
	});

	test('leaves the lock alone when the user scrolled down of their own accord', async () => {
		const { escaped, viewport } = await renderScrolledUp();

		scrollTo(viewport, SCROLLED_DOWN_TO);
		await settleLock();
		expect(escaped()).toBe(false);

		resizeContentTo(2600);

		expect(escaped()).toBe(false);
	});

	test('stops holding once the user scrolls back to the newest message', async () => {
		const { viewport } = await renderScrolledUp();

		scrollTo(viewport, INITIAL_SCROLL_HEIGHT - CLIENT_HEIGHT);
		await settleLock();
		resizeContentTo(2600);

		expect(viewport.scrollTop).not.toBe(SCROLLED_UP_TO);
	});
});
