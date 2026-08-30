// @vitest-environment happy-dom

import { act, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useResizingWidth } from '../../src/renderer/hooks/workbench-shell/composer/use-resizing-width';

const SETTLE_MS = 150;

const observers = new Set<FakeResizeObserver>();

class FakeResizeObserver {
	readonly callback: ResizeObserverCallback;
	observed: Element | null = null;
	disconnected = false;

	constructor(callback: ResizeObserverCallback) {
		this.callback = callback;
		observers.add(this);
	}

	disconnect() {
		this.disconnected = true;
		observers.delete(this);
	}

	observe(target: Element) {
		this.observed = target;
	}

	unobserve() {}
}

function reportWidth(width: number) {
	for (const observer of observers) {
		observer.callback(
			[{ contentRect: { width } } as unknown as ResizeObserverEntry],
			observer as unknown as ResizeObserver,
		);
	}
}

function renderResizingWidth() {
	const state = { resizing: false };
	const Probe = () => {
		const { boxRef, resizing } = useResizingWidth();

		state.resizing = resizing;

		return createElement('div', { ref: boxRef });
	};
	const { unmount } = render(createElement(Probe));

	return { state, unmount };
}

beforeEach(() => {
	observers.clear();
	vi.stubGlobal('ResizeObserver', FakeResizeObserver);
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

test('the hook observes its box and starts settled', () => {
	const { state } = renderResizingWidth();

	expect(state.resizing).toBe(false);
	expect(observers.size).toBe(1);
	expect(Array.from(observers).at(0)?.observed).not.toBeNull();
});

test('the first measurement is the baseline, not a resize', () => {
	const { state } = renderResizingWidth();

	act(() => {
		reportWidth(420);
	});

	expect(state.resizing).toBe(false);
});

test('a width change marks the box as resizing', () => {
	const { state } = renderResizingWidth();

	act(() => {
		reportWidth(420);
		reportWidth(380);
	});

	expect(state.resizing).toBe(true);
});

test('a repeated width is not a change', () => {
	const { state } = renderResizingWidth();

	act(() => {
		reportWidth(420);
		reportWidth(420);
	});

	expect(state.resizing).toBe(false);
});

test('the box stops resizing once the width holds still', () => {
	const { state } = renderResizingWidth();

	act(() => {
		reportWidth(420);
		reportWidth(380);
	});
	act(() => {
		vi.advanceTimersByTime(SETTLE_MS - 1);
	});

	expect(state.resizing).toBe(true);

	act(() => {
		vi.advanceTimersByTime(1);
	});

	expect(state.resizing).toBe(false);
});

test('a drag that keeps moving keeps the settle window open', () => {
	const { state } = renderResizingWidth();

	act(() => {
		reportWidth(420);
	});

	for (let step = 0; step < 6; step += 1) {
		act(() => {
			reportWidth(416 - step * 4);
			vi.advanceTimersByTime(SETTLE_MS - 20);
		});

		expect(state.resizing).toBe(true);
	}

	act(() => {
		vi.advanceTimersByTime(SETTLE_MS);
	});

	expect(state.resizing).toBe(false);
});

test('unmounting disconnects the observer and drops the settle timer', () => {
	const { state, unmount } = renderResizingWidth();

	act(() => {
		reportWidth(420);
		reportWidth(380);
	});

	const observer = Array.from(observers).at(0);

	expect(state.resizing).toBe(true);

	unmount();

	expect(observer?.disconnected).toBe(true);
	expect(vi.getTimerCount()).toBe(0);
});
