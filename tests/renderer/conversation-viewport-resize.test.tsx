// @vitest-environment happy-dom

/**
 * A composer that grows steals height from the transcript above it — a queued
 * follow-up stacking up, the background-tasks notice appearing, a draft wrapping
 * onto another line. The content is exactly as tall as it was, so
 * use-stick-to-bottom's own resize path never runs; these tests pin the rule
 * that replaces it, which decides from the height the viewport had a moment ago
 * rather than from a lock flag that can go stale.
 */

import { renderHook } from '@testing-library/react';
import type { StickToBottomState } from 'use-stick-to-bottom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { useConversationViewportResize } from '../../src/renderer/hooks/conversation/use-conversation-viewport-resize';

const CONTENT_HEIGHT = 2000;

/** The transcript's height before the composer grows. */
const TALL_VIEWPORT = 400;

/** The same transcript once a queued follow-up has taken 100px of it. */
const SHORT_VIEWPORT = 300;

/** Part way up the transcript — well clear of the near-bottom threshold. */
const SCROLLED_UP_TO = 600;

/** Every ResizeObserver a test constructed, so a resize can be delivered on demand. */
const observers: Array<{
	callback: ResizeObserverCallback;
	targets: Element[];
}> = [];

/** Replaces happy-dom's no-op ResizeObserver with one the tests can drive. */
class DrivableResizeObserver implements ResizeObserver {
	private readonly targets: Element[] = [];

	constructor(callback: ResizeObserverCallback) {
		observers.push({ callback, targets: this.targets });
	}

	observe(target: Element): void {
		this.targets.push(target);
	}

	unobserve(): void {}

	disconnect(): void {
		this.targets.length = 0;
	}
}

/**
 * Tells everything watching an element that it resized, the way the browser
 * delivers one resize to every observer of it.
 * @param target - The element that changed size
 */
function notifyResize(target: Element): void {
	for (const observer of observers) {
		if (!observer.targets.includes(target)) {
			continue;
		}
		observer.callback(
			[
				{ contentRect: { height: 0 }, target },
			] as unknown as ResizeObserverEntry[],
			{} as ResizeObserver,
		);
	}
}

/**
 * Builds a scrolling element over a fixed transcript, standing in for the layout
 * happy-dom does not have. `scrollTop` clamps the way a browser's does, so a
 * viewport losing height cannot be parked past its own end.
 * @returns The element, plus the levers a test needs to move and resize it.
 */
function createViewport() {
	const element = document.createElement('div');
	let height = TALL_VIEWPORT;
	let offset = CONTENT_HEIGHT - TALL_VIEWPORT;
	Object.defineProperty(element, 'clientHeight', {
		configurable: true,
		get: () => height,
	});
	Object.defineProperty(element, 'scrollHeight', {
		configurable: true,
		get: () => CONTENT_HEIGHT,
	});
	Object.defineProperty(element, 'scrollTop', {
		configurable: true,
		get: () => offset,
		set: (next: number) => {
			offset = Math.max(0, Math.min(next, CONTENT_HEIGHT - height));
		},
	});
	document.body.append(element);
	return {
		element,
		/**
		 * Reports a new viewport height and notifies the hook's observer.
		 * @param next - The height the transcript is left with
		 */
		resizeTo: (next: number) => {
			height = next;
			notifyResize(element);
		},
	};
}

/**
 * The members of use-stick-to-bottom's state the hook reaches for, backed by the
 * same element so a write lands where the library's own would. `targetScrollTop`
 * answers 0 the way the real one does once either library ref is detached, which
 * is the value the hook must not steer by.
 * @param element - The scrolling element
 * @param isAtBottom - Whether the library already reads as locked to the end
 * @returns A stand-in for the library's state object.
 */
function createScrollState(
	element: HTMLElement,
	isAtBottom: boolean,
): StickToBottomState {
	return {
		get scrollTop() {
			return element.scrollTop;
		},
		set scrollTop(next: number) {
			element.scrollTop = next;
		},
		targetScrollTop: 0,
		isAtBottom,
	} as unknown as StickToBottomState;
}

/**
 * Mounts the hook over a fresh viewport and delivers the observer's opening
 * measurement, which is a baseline rather than a resize.
 */
function renderViewportResize(isAtBottom = false) {
	const viewport = createViewport();
	const scrollToBottom = vi.fn();
	renderHook(() =>
		useConversationViewportResize({
			scrollRef: { current: viewport.element },
			scrollState: createScrollState(viewport.element, isAtBottom),
			scrollToBottom,
		}),
	);
	notifyResize(viewport.element);
	return { ...viewport, scrollToBottom };
}

/**
 * How far the viewport sits above the end of the transcript.
 * @param element - The scrolling element
 * @returns Pixels left below the visible area.
 */
function distanceFromEnd(element: HTMLElement): number {
	return element.scrollHeight - element.scrollTop - element.clientHeight;
}

beforeEach(() => {
	observers.length = 0;
	vi.stubGlobal('ResizeObserver', DrivableResizeObserver);
});

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.replaceChildren();
});

describe('conversation viewport resize', () => {
	test('pins to the newest message when the composer grows underneath it', () => {
		const { element, resizeTo, scrollToBottom } = renderViewportResize();

		resizeTo(SHORT_VIEWPORT);

		expect(distanceFromEnd(element)).toBeLessThanOrEqual(1);
		expect(scrollToBottom).toHaveBeenCalledWith({ animation: 'instant' });
	});

	test('leaves a transcript the user scrolled away from exactly where it is', () => {
		const { element, resizeTo, scrollToBottom } = renderViewportResize();
		element.scrollTop = SCROLLED_UP_TO;

		resizeTo(SHORT_VIEWPORT);

		expect(element.scrollTop).toBe(SCROLLED_UP_TO);
		expect(scrollToBottom).not.toHaveBeenCalled();
	});

	test('reads the opening measurement as a baseline rather than a resize', () => {
		const { element, scrollToBottom } = renderViewportResize();
		element.scrollTop = SCROLLED_UP_TO;

		notifyResize(element);

		expect(element.scrollTop).toBe(SCROLLED_UP_TO);
		expect(scrollToBottom).not.toHaveBeenCalled();
	});

	test('ignores a resize that leaves the viewport the same height', () => {
		const { resizeTo, scrollToBottom } = renderViewportResize();

		resizeTo(TALL_VIEWPORT);

		expect(scrollToBottom).not.toHaveBeenCalled();
	});

	test('keeps following once the composer shrinks back', () => {
		const { element, resizeTo } = renderViewportResize();

		resizeTo(SHORT_VIEWPORT);
		resizeTo(TALL_VIEWPORT);

		expect(distanceFromEnd(element)).toBeLessThanOrEqual(1);
	});

	test('leaves the lock alone when the library already reads as locked', () => {
		const { element, resizeTo, scrollToBottom } = renderViewportResize(true);

		resizeTo(SHORT_VIEWPORT);

		expect(distanceFromEnd(element)).toBeLessThanOrEqual(1);
		expect(scrollToBottom).not.toHaveBeenCalled();
	});

	test('re-pins a viewport that drifted inside the near-bottom threshold', () => {
		const { element, resizeTo } = renderViewportResize();
		element.scrollTop = CONTENT_HEIGHT - TALL_VIEWPORT - 40;

		resizeTo(SHORT_VIEWPORT);

		expect(distanceFromEnd(element)).toBeLessThanOrEqual(1);
	});
});
