// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { createElement, type ReactNode } from 'react';
import type { PanelSize } from 'react-resizable-panels';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useRightSidebarController } from '../../src/renderer/hooks/workbench-shell/use-right-sidebar-controller';
import {
	rightSidebarCollapsedAtom,
	rightSidebarSizePercentAtom,
} from '../../src/renderer/state/workspace';
import { installLocalStorage } from './support/dom';

const SIZE_STORAGE_KEY = 'ensemblr_workspace_right_sidebar_size_percent';
const COLLAPSED_STORAGE_KEY = 'ensemblr_workspace_right_sidebar_collapsed';
const COMMIT_DELAY_MS = 250;
const DRAG_STEPS = 30;

function panelSize(asPercentage: number): PanelSize {
	return { asPercentage, inPixels: Math.round(asPercentage * 12) };
}

function dragStepSize(step: number) {
	return panelSize(34 + step * 0.5);
}

function trackStorageWrites() {
	const writes: { key: string; value: string }[] = [];
	const setItem = window.localStorage.setItem.bind(window.localStorage);

	vi.spyOn(window.localStorage, 'setItem').mockImplementation((key, value) => {
		writes.push({ key, value });
		setItem(key, value);
	});

	return writes;
}

function renderController(
	seed?: (store: ReturnType<typeof createStore>) => void,
) {
	const store = createStore();

	seed?.(store);

	let renderCount = 0;
	const rendered = renderHook(
		() => {
			renderCount += 1;
			return useRightSidebarController();
		},
		{
			wrapper: ({ children }: { children: ReactNode }) =>
				createElement(Provider, { store }, children),
		},
	);

	return { ...rendered, getRenderCount: () => renderCount };
}

beforeEach(() => {
	installLocalStorage();
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

test('a drag writes the sidebar width to storage once, after it settles', () => {
	const writes = trackStorageWrites();
	const { result } = renderController();
	writes.length = 0;

	act(() => {
		for (let step = 0; step < DRAG_STEPS; step += 1) {
			result.current.handleRightSidebarResize(dragStepSize(step));
		}
	});

	expect(writes.filter((write) => write.key === SIZE_STORAGE_KEY)).toHaveLength(
		0,
	);

	act(() => {
		vi.advanceTimersByTime(COMMIT_DELAY_MS);
	});

	expect(writes.filter((write) => write.key === SIZE_STORAGE_KEY)).toEqual([
		{ key: SIZE_STORAGE_KEY, value: '48.5' },
	]);
});

test('a drag that never crosses the collapse threshold leaves the flag alone', () => {
	const writes = trackStorageWrites();
	const { result } = renderController();
	writes.length = 0;

	act(() => {
		for (let step = 0; step < DRAG_STEPS; step += 1) {
			result.current.handleRightSidebarResize(dragStepSize(step));
		}
		vi.advanceTimersByTime(COMMIT_DELAY_MS);
	});

	expect(
		writes.filter((write) => write.key === COLLAPSED_STORAGE_KEY),
	).toHaveLength(0);
});

test('collapsing during a drag persists the flag once', () => {
	const writes = trackStorageWrites();
	const { result } = renderController();
	writes.length = 0;

	act(() => {
		for (let step = 0; step < 5; step += 1) {
			result.current.handleRightSidebarResize(panelSize(0.4));
		}
		vi.advanceTimersByTime(COMMIT_DELAY_MS);
	});

	expect(writes.filter((write) => write.key === COLLAPSED_STORAGE_KEY)).toEqual(
		[{ key: COLLAPSED_STORAGE_KEY, value: 'true' }],
	);
	expect(result.current.isRightSidebarCollapsed).toBe(true);
});

test('a drag re-renders the shell no more than the collapse flag forces', () => {
	const { result, getRenderCount } = renderController();
	const rendersBeforeDrag = getRenderCount();

	act(() => {
		for (let step = 0; step < DRAG_STEPS; step += 1) {
			result.current.handleRightSidebarResize(dragStepSize(step));
		}
	});

	expect(getRenderCount()).toBe(rendersBeforeDrag);

	act(() => {
		vi.advanceTimersByTime(COMMIT_DELAY_MS);
	});

	expect(getRenderCount()).toBe(rendersBeforeDrag);
});

test('unmounting mid-drag still persists the width the user dragged to', () => {
	const writes = trackStorageWrites();
	const { result, unmount } = renderController();
	writes.length = 0;

	act(() => {
		result.current.handleRightSidebarResize(panelSize(51.25));
	});
	unmount();

	expect(writes.filter((write) => write.key === SIZE_STORAGE_KEY)).toEqual([
		{ key: SIZE_STORAGE_KEY, value: '51.25' },
	]);
});

test('quitting mid-drag still persists the width the user dragged to', () => {
	const writes = trackStorageWrites();
	const { result } = renderController();
	writes.length = 0;

	act(() => {
		result.current.handleRightSidebarResize(panelSize(44.75));
	});

	act(() => {
		window.dispatchEvent(new Event('pagehide'));
	});

	expect(writes.filter((write) => write.key === SIZE_STORAGE_KEY)).toEqual([
		{ key: SIZE_STORAGE_KEY, value: '44.75' },
	]);
});

test('the initial panel size comes from the persisted width', () => {
	const { result } = renderController((store) => {
		store.set(rightSidebarSizePercentAtom, 52.5);
	});

	expect(result.current.initialRightSidebarSize).toBe('52.5%');
});

test('the persisted width is clamped before it reaches the panel', () => {
	const { result } = renderController((store) => {
		store.set(rightSidebarSizePercentAtom, 91);
	});

	expect(result.current.initialRightSidebarSize).toBe('68%');
});

test('the initial panel size is the collapsed width when the sidebar was left closed', () => {
	const { result } = renderController((store) => {
		store.set(rightSidebarSizePercentAtom, 52.5);
		store.set(rightSidebarCollapsedAtom, true);
	});

	expect(result.current.initialRightSidebarSize).toBe('0rem');
	expect(result.current.isRightSidebarCollapsed).toBe(true);
});

test('the initial panel size is frozen at mount so the panel never re-registers', () => {
	const { result } = renderController();
	const sizeAtMount = result.current.initialRightSidebarSize;

	act(() => {
		for (let step = 0; step < DRAG_STEPS; step += 1) {
			result.current.handleRightSidebarResize(dragStepSize(step));
		}
		vi.advanceTimersByTime(COMMIT_DELAY_MS);
	});

	expect(window.localStorage.getItem(SIZE_STORAGE_KEY)).toBe('48.5');
	expect(result.current.initialRightSidebarSize).toBe(sizeAtMount);
	expect(result.current.initialRightSidebarSize).toBe('34%');
});
