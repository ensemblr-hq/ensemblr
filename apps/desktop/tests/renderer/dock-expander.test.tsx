// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { expect, test, vi } from 'vitest';

import {
	useExpandDockPanel,
	useProvideDockExpander,
} from '@/renderer/state/workspace/terminal-requests';

/** Registers one workspace's dock reveal and hands back the caller-side dispatcher. */
function useDockExpanderHarness(
	workspaceId: string,
	expand: () => void,
): (workspaceId: string) => void {
	useProvideDockExpander(workspaceId, expand);
	return useExpandDockPanel();
}

/**
 * Renders the harness over a store of its own, so one test's registrations never
 * reach another's.
 */
function renderRegistry(expand: () => void) {
	const store = createStore();

	return renderHook(({ reveal }) => useDockExpanderHarness('ws-1', reveal), {
		initialProps: { reveal: expand },
		wrapper: ({ children }: { children: ReactNode }) => (
			<Provider store={store}>{children}</Provider>
		),
	});
}

test('reveals the dock of the workspace a request names', () => {
	const expand = vi.fn();
	const { result } = renderRegistry(expand);

	act(() => result.current('ws-1'));

	expect(expand).toHaveBeenCalledTimes(1);
});

// The dock composes layout actions that are rebuilt on every render, so the
// registry has to dispatch to the current one rather than the one mounted with.
test('dispatches to the latest callback after a re-render replaces it', () => {
	const first = vi.fn();
	const { rerender, result } = renderRegistry(first);
	const second = vi.fn();

	rerender({ reveal: second });
	act(() => result.current('ws-1'));

	expect(second).toHaveBeenCalledTimes(1);
	expect(first).not.toHaveBeenCalled();
});

test('ignores a request for a workspace whose dock is not mounted', () => {
	const expand = vi.fn();
	const { result } = renderRegistry(expand);

	act(() => result.current('ws-2'));

	expect(expand).not.toHaveBeenCalled();
});

test('stops revealing once the dock unmounts', () => {
	const expand = vi.fn();
	const { result, unmount } = renderRegistry(expand);

	unmount();
	act(() => result.current('ws-1'));

	expect(expand).not.toHaveBeenCalled();
});
