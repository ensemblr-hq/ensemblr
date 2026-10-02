import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { createElement, type ReactNode } from 'react';
import type { PanelImperativeHandle } from 'react-resizable-panels';
import { vi } from 'vitest';
import { useRightSidebarController } from '../../../src/renderer/hooks/workbench-shell/use-right-sidebar-controller';

/** The single media query the right-sidebar controller is allowed to ask for. */
export const WIDE_VIEWPORT_QUERY = '(min-width: 1152px)';

/**
 * Replaces `matchMedia` with a driveable stand-in so a test can cross the
 * breakpoint on demand, recording every query the controller asks for so a test
 * can hold it to using one.
 */
export function installViewport(startsWide: boolean) {
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

/**
 * A panel handle that refuses the first `refusedExpansions` attempts, standing
 * in for a group still holding the pre-resize width — where the panels' pixel
 * minimums cannot both fit and the library leaves the layout alone instead of
 * reporting a failure.
 */
export function createPanelStub(refusedExpansions: number) {
	let isCollapsed = true;
	let remainingRefusals = refusedExpansions;
	let expansionAttempts = 0;

	return {
		getExpansionAttempts: () => expansionAttempts,
		handle: {
			collapse: () => {
				isCollapsed = true;
			},
			expand: () => {
				expansionAttempts += 1;

				if (remainingRefusals > 0) {
					remainingRefusals -= 1;
					return;
				}

				isCollapsed = false;
			},
			getSize: () => ({ asPercentage: isCollapsed ? 0 : 34, inPixels: 0 }),
			isCollapsed: () => isCollapsed,
			resize: () => {},
		} as unknown as PanelImperativeHandle,
	};
}

/**
 * Renders the controller against a fresh Jotai store, which `seed` may prime
 * with persisted layout before the first render reads it.
 */
export function renderRightSidebarController(
	seed?: (store: ReturnType<typeof createStore>) => void,
) {
	const store = createStore();

	seed?.(store);

	return renderHook(() => useRightSidebarController(), {
		wrapper: ({ children }: { children: ReactNode }) =>
			createElement(Provider, { store }, children),
	});
}

/** Lets one queued animation frame — one restore attempt — settle. */
export async function flushAnimationFrame() {
	await act(async () => {
		await new Promise((resolve) => {
			window.requestAnimationFrame(() => resolve(undefined));
		});
	});
}
