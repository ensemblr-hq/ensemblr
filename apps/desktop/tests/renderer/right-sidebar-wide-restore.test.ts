// @vitest-environment happy-dom

import { act } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { rightSidebarCollapsedAtom } from '../../src/renderer/state/workspace';
import { installLocalStorage } from './support/dom';
import {
	createPanelStub,
	flushAnimationFrame,
	installViewport,
	renderRightSidebarController,
} from './support/right-sidebar';

beforeEach(() => {
	installLocalStorage();
});

afterEach(() => {
	vi.restoreAllMocks();
});

test('widening asks again when the group refuses the first attempt', async () => {
	const viewport = installViewport(false);
	const { result } = renderRightSidebarController();
	const panel = createPanelStub(1);

	result.current.rightSidebarPanelRef.current = panel.handle;

	act(() => {
		viewport.resizeTo(true);
	});
	await flushAnimationFrame();
	await flushAnimationFrame();

	expect(panel.getExpansionAttempts()).toBe(2);
	expect(panel.handle.isCollapsed()).toBe(false);
	expect(result.current.isRightSidebarCollapsed).toBe(false);
});

test('a rail the group never seats stays reported collapsed, so one click shows it', async () => {
	const viewport = installViewport(false);
	const { result } = renderRightSidebarController();
	const panel = createPanelStub(Number.POSITIVE_INFINITY);

	result.current.rightSidebarPanelRef.current = panel.handle;

	act(() => {
		viewport.resizeTo(true);
	});
	await flushAnimationFrame();
	await flushAnimationFrame();
	await flushAnimationFrame();

	expect(result.current.isRightSidebarCollapsed).toBe(true);
	expect(panel.getExpansionAttempts()).toBe(2);
});

test('a restore with no panel attached yet claims nothing', async () => {
	const viewport = installViewport(false);
	const { result } = renderRightSidebarController();

	act(() => {
		viewport.resizeTo(true);
	});
	await flushAnimationFrame();
	await flushAnimationFrame();
	await flushAnimationFrame();

	expect(result.current.isRightSidebarCollapsed).toBe(true);
});

test('a window that opened narrow seats the rail once it widens', async () => {
	const viewport = installViewport(false);
	const { result } = renderRightSidebarController();
	const panel = createPanelStub(0);

	result.current.rightSidebarPanelRef.current = panel.handle;

	act(() => {
		viewport.resizeTo(true);
	});
	await flushAnimationFrame();

	expect(result.current.isRightSidebarCollapsed).toBe(false);
	expect(panel.handle.isCollapsed()).toBe(false);
});

test('a window that opened wide leaves the seating to the panel default', async () => {
	installViewport(true);
	const { result } = renderRightSidebarController();
	const panel = createPanelStub(0);

	result.current.rightSidebarPanelRef.current = panel.handle;

	await flushAnimationFrame();
	await flushAnimationFrame();

	expect(panel.getExpansionAttempts()).toBe(0);
	expect(result.current.isRightSidebarCollapsed).toBe(false);
});

test('widening leaves a rail the user collapsed alone', async () => {
	const viewport = installViewport(false);
	const { result } = renderRightSidebarController((store) => {
		store.set(rightSidebarCollapsedAtom, true);
	});
	const panel = createPanelStub(0);

	result.current.rightSidebarPanelRef.current = panel.handle;

	act(() => {
		viewport.resizeTo(true);
	});
	await flushAnimationFrame();
	await flushAnimationFrame();

	expect(result.current.isRightSidebarCollapsed).toBe(true);
	expect(panel.getExpansionAttempts()).toBe(0);
});

test('collapsing between the widening and its frame drops the queued restore', async () => {
	const viewport = installViewport(false);
	const { result } = renderRightSidebarController();
	const panel = createPanelStub(0);

	result.current.rightSidebarPanelRef.current = panel.handle;

	act(() => {
		viewport.resizeTo(true);
	});
	act(() => {
		result.current.collapseRightSidebar();
	});
	await flushAnimationFrame();
	await flushAnimationFrame();

	expect(panel.getExpansionAttempts()).toBe(0);
	expect(panel.handle.isCollapsed()).toBe(true);
	expect(result.current.isRightSidebarCollapsed).toBe(true);
});

test('re-narrowing between the widening and its frame drops the queued restore', async () => {
	const viewport = installViewport(false);
	const { result } = renderRightSidebarController();
	const panel = createPanelStub(0);

	result.current.rightSidebarPanelRef.current = panel.handle;

	act(() => {
		viewport.resizeTo(true);
	});
	act(() => {
		viewport.resizeTo(false);
	});
	await flushAnimationFrame();
	await flushAnimationFrame();

	expect(panel.getExpansionAttempts()).toBe(0);
	expect(panel.handle.isCollapsed()).toBe(true);
});

test('unmounting between the widening and its frame drops the queued restore', async () => {
	const viewport = installViewport(false);
	const { result, unmount } = renderRightSidebarController();
	const panel = createPanelStub(0);

	result.current.rightSidebarPanelRef.current = panel.handle;

	act(() => {
		viewport.resizeTo(true);
	});
	act(() => {
		unmount();
	});
	await flushAnimationFrame();
	await flushAnimationFrame();

	expect(panel.getExpansionAttempts()).toBe(0);
});
