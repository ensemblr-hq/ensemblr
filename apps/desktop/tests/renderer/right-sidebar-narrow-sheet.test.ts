// @vitest-environment happy-dom

import { act } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
	rightSidebarCollapsedAtom,
	rightSidebarSizePercentAtom,
} from '../../src/renderer/state/workspace';
import { installLocalStorage } from './support/dom';
import {
	createPanelStub,
	flushAnimationFrame,
	installViewport,
	renderRightSidebarController,
	WIDE_VIEWPORT_QUERY,
} from './support/right-sidebar';

const COLLAPSED_STORAGE_KEY = 'ensemblr_workspace_right_sidebar_collapsed';
const SIZE_STORAGE_KEY = 'ensemblr_workspace_right_sidebar_size_percent';

function trackStorageWrites() {
	const writes: string[] = [];
	const setItem = window.localStorage.setItem.bind(window.localStorage);

	vi.spyOn(window.localStorage, 'setItem').mockImplementation((key, value) => {
		writes.push(key);
		setItem(key, value);
	});

	return writes;
}

beforeEach(() => {
	installLocalStorage();
});

afterEach(() => {
	vi.restoreAllMocks();
});

test('a narrow viewport reports the rail hidden until the sheet is opened', () => {
	installViewport(false);
	const { result } = renderRightSidebarController();

	expect(result.current.isNarrowViewport).toBe(true);
	expect(result.current.isRightSidebarSheetOpen).toBe(false);
	expect(result.current.isRightSidebarCollapsed).toBe(true);
});

test('expanding on a narrow viewport opens the sheet rather than the panel', () => {
	installViewport(false);
	const { result } = renderRightSidebarController();

	act(() => {
		result.current.expandRightSidebar();
	});

	expect(result.current.isRightSidebarSheetOpen).toBe(true);
	expect(result.current.isRightSidebarCollapsed).toBe(false);
});

test('collapsing on a narrow viewport closes the sheet', () => {
	installViewport(false);
	const { result } = renderRightSidebarController();

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
	const { result } = renderRightSidebarController();
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
	const { result } = renderRightSidebarController((store) => {
		store.set(rightSidebarSizePercentAtom, 40);
	});

	result.current.rightSidebarPanelRef.current = createPanelStub(0).handle;

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
	const { result } = renderRightSidebarController((store) => {
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
	const { result } = renderRightSidebarController((store) => {
		store.set(rightSidebarCollapsedAtom, true);
	});

	result.current.rightSidebarPanelRef.current = createPanelStub(0).handle;

	act(() => {
		result.current.expandRightSidebar();
	});
	await flushAnimationFrame();

	expect(result.current.isRightSidebarSheetOpen).toBe(false);
	expect(result.current.isRightSidebarCollapsed).toBe(false);
	expect(window.localStorage.getItem(COLLAPSED_STORAGE_KEY)).toBe('false');
});

test('every viewport test goes through one query, so narrow and rail cannot disagree', () => {
	const viewport = installViewport(false);
	const { result } = renderRightSidebarController();

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
