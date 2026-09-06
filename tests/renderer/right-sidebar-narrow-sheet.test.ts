// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useRightSidebarController } from '../../src/renderer/hooks/workbench-shell/use-right-sidebar-controller';
import {
	rightSidebarCollapsedAtom,
	rightSidebarSizePercentAtom,
} from '../../src/renderer/state/workspace';
import { installLocalStorage } from './support/dom';

const WIDE_VIEWPORT_QUERY = '(min-width: 1024px)';
const SIZE_STORAGE_KEY = 'ensemblr_workspace_right_sidebar_size_percent';
const COLLAPSED_STORAGE_KEY = 'ensemblr_workspace_right_sidebar_collapsed';

/**
 * Replaces `matchMedia` with a driveable stand-in, recording every query the
 * controller asks for so a test can hold it to using one.
 */
function installViewport(startsWide: boolean) {
	let isWide = startsWide;
	const listeners = new Set<() => void>();
	const queries: string[] = [];

	vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
		queries.push(query);

		return {
			get matches() {
				return isWide;
			},
			addEventListener: (_type: string, listener: () => void) => {
				listeners.add(listener);
			},
			removeEventListener: (_type: string, listener: () => void) => {
				listeners.delete(listener);
			},
		} as unknown as MediaQueryList;
	});

	return {
		queries,
		resizeTo(nextIsWide: boolean) {
			isWide = nextIsWide;
			for (const listener of [...listeners]) {
				listener();
			}
		},
	};
}

function renderController(
	seed?: (store: ReturnType<typeof createStore>) => void,
) {
	const store = createStore();

	seed?.(store);

	return renderHook(() => useRightSidebarController(), {
		wrapper: ({ children }: { children: ReactNode }) =>
			createElement(Provider, { store }, children),
	});
}

function trackStorageWrites() {
	const writes: string[] = [];
	const setItem = window.localStorage.setItem.bind(window.localStorage);

	vi.spyOn(window.localStorage, 'setItem').mockImplementation((key, value) => {
		writes.push(key);
		setItem(key, value);
	});

	return writes;
}

/** Lets the queued animation frame the wide-layout restore runs in settle. */
async function flushAnimationFrame() {
	await act(async () => {
		await new Promise((resolve) => {
			window.requestAnimationFrame(() => resolve(undefined));
		});
	});
}

beforeEach(() => {
	installLocalStorage();
});

afterEach(() => {
	vi.restoreAllMocks();
});

test('a narrow viewport reports the rail hidden until the sheet is opened', () => {
	installViewport(false);
	const { result } = renderController();

	expect(result.current.isNarrowViewport).toBe(true);
	expect(result.current.isRightSidebarSheetOpen).toBe(false);
	expect(result.current.isRightSidebarCollapsed).toBe(true);
});

test('expanding on a narrow viewport opens the sheet rather than the panel', () => {
	installViewport(false);
	const { result } = renderController();

	act(() => {
		result.current.expandRightSidebar();
	});

	expect(result.current.isRightSidebarSheetOpen).toBe(true);
	expect(result.current.isRightSidebarCollapsed).toBe(false);
});

test('collapsing on a narrow viewport closes the sheet', () => {
	installViewport(false);
	const { result } = renderController();

	act(() => {
		result.current.expandRightSidebar();
	});
	act(() => {
		result.current.collapseRightSidebar();
	});

	expect(result.current.isRightSidebarSheetOpen).toBe(false);
	expect(result.current.isRightSidebarCollapsed).toBe(true);
});

test('opening and closing the narrow sheet leaves the persisted wide layout alone', () => {
	installViewport(false);
	const { result } = renderController();
	const writes = trackStorageWrites();

	act(() => {
		result.current.expandRightSidebar();
	});
	act(() => {
		result.current.collapseRightSidebar();
	});

	expect(writes).not.toContain(COLLAPSED_STORAGE_KEY);
	expect(writes).not.toContain(SIZE_STORAGE_KEY);
});

test('widening seats the rail back in the panel and lets the sheet go', async () => {
	const viewport = installViewport(false);
	const { result } = renderController((store) => {
		store.set(rightSidebarSizePercentAtom, 40);
	});

	act(() => {
		result.current.expandRightSidebar();
	});
	expect(result.current.isRightSidebarSheetOpen).toBe(true);

	act(() => {
		viewport.resizeTo(true);
	});
	await flushAnimationFrame();

	expect(result.current.isNarrowViewport).toBe(false);
	expect(result.current.isRightSidebarSheetOpen).toBe(false);
	expect(result.current.isRightSidebarCollapsed).toBe(false);
});

test('a sidebar the user had collapsed stays collapsed when the window widens', async () => {
	const viewport = installViewport(false);
	const { result } = renderController((store) => {
		store.set(rightSidebarCollapsedAtom, true);
	});

	act(() => {
		viewport.resizeTo(true);
	});
	await flushAnimationFrame();

	expect(result.current.isRightSidebarSheetOpen).toBe(false);
	expect(result.current.isRightSidebarCollapsed).toBe(true);
});

test('a wide viewport keeps expanding the panel rather than opening a sheet', async () => {
	installViewport(true);
	const { result } = renderController((store) => {
		store.set(rightSidebarCollapsedAtom, true);
	});

	act(() => {
		result.current.expandRightSidebar();
	});
	await flushAnimationFrame();

	expect(result.current.isRightSidebarSheetOpen).toBe(false);
	expect(result.current.isRightSidebarCollapsed).toBe(false);
	expect(window.localStorage.getItem(COLLAPSED_STORAGE_KEY)).toBe('false');
});

test('every viewport test goes through one query, so narrow and lg cannot disagree', () => {
	const viewport = installViewport(false);
	const { result } = renderController();

	act(() => {
		result.current.expandRightSidebar();
	});
	act(() => {
		viewport.resizeTo(true);
	});
	act(() => {
		result.current.collapseRightSidebar();
	});

	expect([...new Set(viewport.queries)]).toEqual([WIDE_VIEWPORT_QUERY]);
});
