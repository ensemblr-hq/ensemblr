// @vitest-environment happy-dom

/**
 * Scrolling up is a decision about the message in front of the user, not a
 * standing preference. These tests pin the expiry: a transcript nobody has
 * touched for a stretch goes back to following the newest message, a gesture
 * anywhere in the scroll area starts the wait over, and a live text selection
 * defers it rather than cancelling it.
 */

import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { useConversationIdleFollow } from '../../src/renderer/hooks/conversation/use-conversation-idle-follow';

/** Matches `FOLLOW_REARM_IDLE_MS` in the hook under test. */
const IDLE_MS = 60_000;

/** Long enough to be a real pause, short enough to leave the wait unfinished. */
const ALMOST_IDLE_MS = IDLE_MS - 1000;

/**
 * Builds the surface a conversation renders: the scrolling viewport, the
 * scrollbar beside it, and the composer below — a sibling of the scroll area
 * rather than a child, which is why a scoped listener would never hear it.
 */
function createScrollArea() {
	const root = document.createElement('div');
	root.dataset.slot = 'conversation-scroll-area';
	const viewport = document.createElement('div');
	const scrollbar = document.createElement('div');
	const composer = document.createElement('textarea');
	root.append(viewport, scrollbar);
	document.body.append(root, composer);
	return { composer, root, scrollbar, viewport };
}

/** Mounts the hook over a fresh scroll area with the lock already escaped. */
function renderIdleFollow(escapedFromLock = true) {
	const area = createScrollArea();
	const scrollToBottom = vi.fn();
	const view = renderHook(
		(props: { escapedFromLock: boolean }) =>
			useConversationIdleFollow({
				escapedFromLock: props.escapedFromLock,
				scrollRef: { current: area.viewport },
				scrollToBottom,
			}),
		{ initialProps: { escapedFromLock } },
	);
	return { ...area, ...view, scrollToBottom };
}

/**
 * Dispatches one of the gestures that means a user is driving the transcript.
 * @param element - What the gesture lands on
 * @param type - The event to raise
 */
function gesture(element: HTMLElement, type: string): void {
	element.dispatchEvent(new Event(type, { bubbles: true }));
}

/**
 * Reports a selection sitting inside `container`, the way a user part way
 * through copying a command leaves one.
 * @param container - The element the selection lives in, or null for none
 */
function stubSelection(container: Node | null): void {
	vi.spyOn(window, 'getSelection').mockReturnValue(
		container === null
			? null
			: ({
					getRangeAt: () => ({ commonAncestorContainer: container }),
					isCollapsed: false,
					rangeCount: 1,
				} as unknown as Selection),
	);
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

describe('conversation idle follow', () => {
	test('goes back to the newest message once the transcript sits untouched', () => {
		const { scrollToBottom } = renderIdleFollow();

		vi.advanceTimersByTime(IDLE_MS);

		expect(scrollToBottom).toHaveBeenCalledTimes(1);
	});

	test('leaves a transcript that is already following alone', () => {
		const { scrollToBottom } = renderIdleFollow(false);

		vi.advanceTimersByTime(IDLE_MS * 3);

		expect(scrollToBottom).not.toHaveBeenCalled();
	});

	test('starts the wait over on every gesture', () => {
		const { scrollToBottom, viewport } = renderIdleFollow();

		vi.advanceTimersByTime(ALMOST_IDLE_MS);
		gesture(viewport, 'wheel');
		vi.advanceTimersByTime(ALMOST_IDLE_MS);
		expect(scrollToBottom).not.toHaveBeenCalled();

		vi.advanceTimersByTime(IDLE_MS);

		expect(scrollToBottom).toHaveBeenCalledTimes(1);
	});

	test('counts a scrollbar drag beside the viewport as a gesture', () => {
		const { scrollbar, scrollToBottom } = renderIdleFollow();

		vi.advanceTimersByTime(ALMOST_IDLE_MS);
		gesture(scrollbar, 'pointerdown');
		vi.advanceTimersByTime(ALMOST_IDLE_MS);

		expect(scrollToBottom).not.toHaveBeenCalled();
	});

	test('counts typing in the composer, which is no child of the scroll area', () => {
		const { composer, scrollToBottom } = renderIdleFollow();

		for (let keystroke = 0; keystroke < 4; keystroke += 1) {
			vi.advanceTimersByTime(ALMOST_IDLE_MS);
			gesture(composer, 'keydown');
		}
		vi.advanceTimersByTime(ALMOST_IDLE_MS);

		expect(scrollToBottom).not.toHaveBeenCalled();
	});

	test('defers while the user holds a selection, and follows once it goes', () => {
		const { scrollToBottom, viewport } = renderIdleFollow();
		stubSelection(viewport);

		vi.advanceTimersByTime(IDLE_MS);
		expect(scrollToBottom).not.toHaveBeenCalled();

		stubSelection(null);
		vi.advanceTimersByTime(IDLE_MS);

		expect(scrollToBottom).toHaveBeenCalledTimes(1);
	});

	test('ignores a selection made outside the transcript', () => {
		const { scrollToBottom } = renderIdleFollow();
		stubSelection(document.createElement('p'));

		vi.advanceTimersByTime(IDLE_MS);

		expect(scrollToBottom).toHaveBeenCalledTimes(1);
	});

	test('stops waiting once the user scrolls back to the newest message', () => {
		const { rerender, scrollToBottom } = renderIdleFollow();

		rerender({ escapedFromLock: false });
		vi.advanceTimersByTime(IDLE_MS * 3);

		expect(scrollToBottom).not.toHaveBeenCalled();
	});

	test('stops watching once the conversation closes', () => {
		const { scrollToBottom, unmount } = renderIdleFollow();

		unmount();
		vi.advanceTimersByTime(IDLE_MS * 3);

		expect(scrollToBottom).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	test('asks for one scroll per idle stretch, not one per tick', () => {
		const { scrollToBottom } = renderIdleFollow();

		vi.advanceTimersByTime(IDLE_MS * 5);

		expect(scrollToBottom).toHaveBeenCalledTimes(1);
	});
});
