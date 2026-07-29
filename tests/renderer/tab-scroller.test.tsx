// @vitest-environment happy-dom

import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { TabScroller } from '@/renderer/components/ui/tab-scroller';

const VIEWPORT_LEFT = 0;
const VIEWPORT_RIGHT = 300;
const TAB_WIDTH = 120;

const resizeCallbacks = new Set<ResizeObserverCallback>();

class FakeResizeObserver {
	readonly #callback: ResizeObserverCallback;

	constructor(callback: ResizeObserverCallback) {
		this.#callback = callback;
		resizeCallbacks.add(callback);
	}

	disconnect() {
		resizeCallbacks.delete(this.#callback);
	}

	observe() {}

	unobserve() {}
}

function triggerReflow() {
	for (const callback of resizeCallbacks) {
		callback([], {} as ResizeObserver);
	}
}

function stubRect(element: Element, left: number, right: number) {
	element.getBoundingClientRect = () =>
		({
			bottom: 40,
			height: 40,
			left,
			right,
			toJSON: () => ({}),
			top: 0,
			width: right - left,
			x: left,
			y: 0,
		}) as DOMRect;
}

function stubScrollMetrics(
	viewport: HTMLElement,
	metrics: { clientWidth: number; scrollLeft?: number; scrollWidth: number },
) {
	Object.defineProperty(viewport, 'clientWidth', {
		configurable: true,
		value: metrics.clientWidth,
	});
	Object.defineProperty(viewport, 'scrollWidth', {
		configurable: true,
		value: metrics.scrollWidth,
	});
	Object.defineProperty(viewport, 'scrollLeft', {
		configurable: true,
		value: metrics.scrollLeft ?? 0,
		writable: true,
	});
}

function Strip({
	activeKey,
	tabKeys,
}: {
	activeKey: string;
	tabKeys: readonly string[];
}) {
	return (
		<TabScroller activeKey={activeKey}>
			<div>
				{tabKeys.map((tabKey) => (
					<button data-tab-key={tabKey} key={tabKey} type='button'>
						{tabKey}
					</button>
				))}
			</div>
		</TabScroller>
	);
}

function renderStrip(
	activeKey: string,
	tabKeys: readonly string[] = ['a', 'b', 'c'],
) {
	const utils = render(<Strip activeKey={activeKey} tabKeys={tabKeys} />);
	const wrapper = utils.container.querySelector<HTMLElement>(
		'[data-slot="tab-scroller"]',
	);
	const viewport = utils.container.querySelector<HTMLElement>(
		'[data-slot="tab-scroller-viewport"]',
	);
	const thumb = utils.container.querySelector<HTMLElement>(
		'[data-slot="tab-scroller-thumb"]',
	);
	if (!(wrapper && viewport && thumb)) {
		throw new Error('TabScroller did not render its scroll surfaces');
	}
	stubRect(viewport, VIEWPORT_LEFT, VIEWPORT_RIGHT);
	for (const [index, tab] of Array.from(
		viewport.querySelectorAll('[data-tab-key]'),
	).entries()) {
		stubRect(tab, index * TAB_WIDTH, index * TAB_WIDTH + TAB_WIDTH);
	}
	return { ...utils, thumb, viewport, wrapper };
}

function spyOnScrollBy(viewport: HTMLElement) {
	return vi.spyOn(viewport, 'scrollBy').mockImplementation(() => {});
}

describe('TabScroller', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal('ResizeObserver', FakeResizeObserver);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		resizeCallbacks.clear();
	});

	test('scrolls an out-of-view tab fully into view when it becomes active', () => {
		const { rerender, viewport } = renderStrip('a');
		const scrollBy = spyOnScrollBy(viewport);

		rerender(<Strip activeKey='c' tabKeys={['a', 'b', 'c']} />);

		expect(scrollBy).toHaveBeenCalledWith({ behavior: 'smooth', left: 72 });
	});

	test('leaves the strip alone when the active tab is already in view', () => {
		const { rerender, viewport } = renderStrip('a');
		const scrollBy = spyOnScrollBy(viewport);

		rerender(<Strip activeKey='b' tabKeys={['a', 'b', 'c']} />);

		expect(scrollBy).not.toHaveBeenCalled();
	});

	test('leading-aligns a tab wider than the viewport so its label stays readable', () => {
		const { rerender, viewport } = renderStrip('a');
		const wideTab = viewport.querySelector<HTMLElement>('[data-tab-key="c"]');
		if (!wideTab) {
			throw new Error('TabScroller did not render the wide tab');
		}
		stubRect(wideTab, 100, 600);
		const scrollBy = spyOnScrollBy(viewport);

		rerender(<Strip activeKey='c' tabKeys={['a', 'b', 'c']} />);

		expect(scrollBy).toHaveBeenCalledWith({ behavior: 'smooth', left: 100 });
	});

	test('jumps instead of animating when the tab being left has closed', () => {
		const { rerender, viewport } = renderStrip('a', ['a', 'b', 'c', 'd']);
		const scrollBy = spyOnScrollBy(viewport);

		rerender(<Strip activeKey='d' tabKeys={['b', 'c', 'd']} />);

		expect(scrollBy).toHaveBeenCalledWith({ behavior: 'auto', left: 192 });
	});

	test('re-reveals the active tab when a reflow pushes it out of view', () => {
		const { viewport } = renderStrip('c');
		const scrollBy = spyOnScrollBy(viewport);

		act(() => {
			triggerReflow();
		});

		expect(scrollBy).toHaveBeenCalledWith({ behavior: 'auto', left: 72 });
	});

	test('resizes the thumb when a reflow changes how far the strip overflows', () => {
		const { thumb, viewport } = renderStrip('a');
		stubScrollMetrics(viewport, { clientWidth: 300, scrollWidth: 600 });

		act(() => {
			triggerReflow();
		});

		expect(thumb.dataset.visible).toBe('true');
		expect(thumb.style.width).toBe('150px');
	});

	test('reveals the thumb while scrolling and fades it out once idle', () => {
		const { thumb, viewport } = renderStrip('a');
		stubScrollMetrics(viewport, { clientWidth: 300, scrollWidth: 600 });

		act(() => {
			fireEvent.scroll(viewport);
			vi.advanceTimersByTime(20);
		});

		expect(thumb.dataset.visible).toBe('true');
		expect(thumb.style.width).toBe('150px');

		act(() => {
			vi.advanceTimersByTime(1000);
		});

		expect(thumb.dataset.visible).toBe('false');
	});

	test('coalesces a burst of scroll events into one thumb sync', () => {
		const { thumb, viewport } = renderStrip('a');
		stubScrollMetrics(viewport, { clientWidth: 300, scrollWidth: 600 });
		const syncs = vi.spyOn(thumb.style, 'transform', 'set');

		act(() => {
			fireEvent.scroll(viewport);
			fireEvent.scroll(viewport);
			fireEvent.scroll(viewport);
			vi.advanceTimersByTime(20);
		});

		expect(syncs).toHaveBeenCalledTimes(1);
	});

	test('keeps the thumb visible while the strip is hovered', () => {
		const { thumb, viewport, wrapper } = renderStrip('a');
		stubScrollMetrics(viewport, { clientWidth: 300, scrollWidth: 600 });

		act(() => {
			fireEvent.pointerEnter(wrapper);
			vi.advanceTimersByTime(1000);
		});

		expect(thumb.dataset.visible).toBe('true');

		act(() => {
			fireEvent.pointerLeave(wrapper);
			vi.advanceTimersByTime(1000);
		});

		expect(thumb.dataset.visible).toBe('false');
	});

	test('keeps the thumb hidden when the strip does not overflow', () => {
		const { thumb, viewport } = renderStrip('a');
		stubScrollMetrics(viewport, { clientWidth: 300, scrollWidth: 300 });

		act(() => {
			fireEvent.scroll(viewport);
			vi.advanceTimersByTime(20);
		});

		expect(thumb.dataset.visible).toBe('false');
	});
});
