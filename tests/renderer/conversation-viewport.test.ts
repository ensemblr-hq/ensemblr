// @vitest-environment happy-dom

/**
 * A wheel gesture inside the conversation belongs to the transcript only when
 * nothing between it and the viewport swallows it. These tests build that nesting
 * directly and stand in for the layout happy-dom does not have, so each rung of
 * the rule — is it a scroller, can it still move, does it block the chain — is
 * decided on its own.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { ownsWheelGesture } from '../../src/renderer/lib/conversation/viewport';

const CLIENT_HEIGHT = 400;
const CONTENT_HEIGHT = 2000;
const WHEEL_UP = -120;
const WHEEL_DOWN = 120;

/** The bottom of a pane whose content is {@link CONTENT_HEIGHT} tall. */
const PANE_BOTTOM = CONTENT_HEIGHT - CLIENT_HEIGHT;

/**
 * Builds a viewport holding a pane holding the leaf a wheel lands on, the shape
 * a tool card or a table gives the timeline.
 * @param pane - How the pane in the middle scrolls
 * @returns The viewport and the leaf to dispatch against.
 */
function nestPane(pane: {
	contentHeight?: number;
	overscrollBehaviorY?: string;
	scrollTop: number;
}) {
	const viewport = document.createElement('div');
	const middle = document.createElement('div');
	const leaf = document.createElement('span');
	middle.style.overflowY = 'auto';
	if (pane.overscrollBehaviorY !== undefined) {
		middle.style.overscrollBehaviorY = pane.overscrollBehaviorY;
	}
	Object.defineProperty(middle, 'scrollTop', {
		configurable: true,
		value: pane.scrollTop,
	});
	if (pane.contentHeight !== undefined) {
		Object.defineProperty(middle, 'scrollHeight', {
			configurable: true,
			value: pane.contentHeight,
		});
	}
	middle.append(leaf);
	viewport.append(middle);
	document.body.append(viewport);
	return { leaf, viewport };
}

beforeEach(() => {
	// happy-dom has no layout engine, so every element reports the one size that
	// makes it a scroller with content to spare.
	Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
		configurable: true,
		get: () => CLIENT_HEIGHT,
	});
	Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
		configurable: true,
		get: () => CONTENT_HEIGHT,
	});
});

afterEach(() => {
	document.body.replaceChildren();
});

describe('ownsWheelGesture', () => {
	test('a pane part-way down its own content keeps a wheel up', () => {
		const { leaf, viewport } = nestPane({ scrollTop: 500 });

		expect(ownsWheelGesture(viewport, leaf, WHEEL_UP)).toBe(false);
	});

	test('a pane at its own top keeps a wheel up when it blocks the chain', () => {
		const { leaf, viewport } = nestPane({
			overscrollBehaviorY: 'contain',
			scrollTop: 0,
		});

		expect(ownsWheelGesture(viewport, leaf, WHEEL_UP)).toBe(false);
	});

	test('a pane at its own top passes a wheel up on when the chain is open', () => {
		const { leaf, viewport } = nestPane({ scrollTop: 0 });

		expect(ownsWheelGesture(viewport, leaf, WHEEL_UP)).toBe(true);
	});

	test('a pane at its own top keeps a wheel down, having room below', () => {
		const { leaf, viewport } = nestPane({ scrollTop: 0 });

		expect(ownsWheelGesture(viewport, leaf, WHEEL_DOWN)).toBe(false);
	});

	test('a pane at its own bottom passes a wheel down on when the chain is open', () => {
		const { leaf, viewport } = nestPane({ scrollTop: PANE_BOTTOM });

		expect(ownsWheelGesture(viewport, leaf, WHEEL_DOWN)).toBe(true);
	});

	test('a scroll container short enough to fit its content is no obstacle', () => {
		const { leaf, viewport } = nestPane({
			contentHeight: CLIENT_HEIGHT,
			overscrollBehaviorY: 'contain',
			scrollTop: 0,
		});

		expect(ownsWheelGesture(viewport, leaf, WHEEL_UP)).toBe(true);
	});

	test('an element that does not scroll is no obstacle either way', () => {
		const viewport = document.createElement('div');
		const prose = document.createElement('p');
		viewport.append(prose);
		document.body.append(viewport);

		expect(ownsWheelGesture(viewport, prose, WHEEL_UP)).toBe(true);
	});

	test('a gesture that never reaches the viewport is not the transcript to move', () => {
		const outside = document.createElement('div');
		const prose = document.createElement('p');
		const viewport = document.createElement('div');
		outside.append(prose);
		document.body.append(outside, viewport);

		expect(ownsWheelGesture(viewport, prose, WHEEL_UP)).toBe(false);
	});
});
