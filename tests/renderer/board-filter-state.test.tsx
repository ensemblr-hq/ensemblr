// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test } from 'vitest';

import {
	DEFAULT_BOARD_FILTERS,
	useBoardFilters,
	useBoardIssueDismissals,
} from '@/renderer/state/workspace';

let store: ReturnType<typeof createStore>;

beforeEach(() => {
	globalThis.localStorage?.clear();
	store = createStore();
});

/** Mounts a state hook against one store, so remounts share the persisted value. */
function render<T>(hook: () => T) {
	return renderHook(hook, {
		wrapper: ({ children }: { children: ReactNode }) => (
			<Provider store={store}>{children}</Provider>
		),
	});
}

describe('useBoardFilters', () => {
	test('starts from the documented defaults', () => {
		const { result } = render(useBoardFilters);

		expect(result.current.filters).toEqual(DEFAULT_BOARD_FILTERS);
	});

	test('toggles a repository on and back off', () => {
		const { result } = render(useBoardFilters);

		act(() => result.current.toggleRepo('repo-1'));
		expect(result.current.filters.repoIds).toEqual(['repo-1']);

		act(() => result.current.toggleRepo('repo-1'));
		expect(result.current.filters.repoIds).toEqual([]);
	});

	test('toggles sources independently of repositories', () => {
		const { result } = render(useBoardFilters);

		act(() => result.current.toggleSource('linear'));
		act(() => result.current.toggleRepo('repo-1'));

		expect(result.current.filters.sources).toEqual(['linear']);
		expect(result.current.filters.repoIds).toEqual(['repo-1']);
	});

	test('clear returns every facet to its default', () => {
		const { result } = render(useBoardFilters);

		act(() => result.current.setQuery('auth'));
		act(() => result.current.toggleRepo('repo-1'));
		act(() => result.current.toggleSource('github'));
		act(() => result.current.setSort('priority'));
		act(() => result.current.clear());

		expect(result.current.filters).toEqual(DEFAULT_BOARD_FILTERS);
	});
});

describe('useBoardIssueDismissals', () => {
	test('dismiss is idempotent', () => {
		const { result } = render(useBoardIssueDismissals);

		act(() => result.current.dismiss('ENS-1'));
		act(() => result.current.dismiss('ENS-1'));

		expect(result.current.dismissedKeys).toEqual(['ENS-1']);
	});

	test('restore removes only the named key', () => {
		const { result } = render(useBoardIssueDismissals);

		act(() => result.current.dismiss('ENS-1'));
		act(() => result.current.dismiss('ENS-2'));
		act(() => result.current.restore('ENS-1'));

		expect(result.current.dismissedKeys).toEqual(['ENS-2']);
	});

	// Without this, an issue dismissed once and later closed keeps its key
	// forever, and comes back dismissed if it ever reappears on the board.
	test('prune drops keys no longer backed by a live issue', () => {
		const { result } = render(useBoardIssueDismissals);

		act(() => result.current.dismiss('ENS-1'));
		act(() => result.current.dismiss('ENS-2'));
		act(() => result.current.prune(['ENS-2']));

		expect(result.current.dismissedKeys).toEqual(['ENS-2']);
	});

	test('prune keeps the same array when nothing is stale', () => {
		const { result } = render(useBoardIssueDismissals);

		act(() => result.current.dismiss('ENS-1'));
		const before = result.current.dismissedKeys;
		act(() => result.current.prune(['ENS-1']));

		expect(result.current.dismissedKeys).toBe(before);
	});
});
