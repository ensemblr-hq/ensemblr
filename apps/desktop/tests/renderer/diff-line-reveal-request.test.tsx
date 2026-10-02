// @vitest-environment happy-dom

/**
 * The reveal request outlives the tab that will serve it: the gesture fires
 * while the diff tab is still opening and its patch still loading. So the atom
 * is not cleared on read — the viewer settles it once it has scrolled or ruled
 * the line out, which is also what stops a later mount replaying the jump.
 */

import { renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { act } from 'react';
import { expect, test } from 'vitest';

import {
	useDiffLineReveal,
	useRequestDiffLineReveal,
	useSettleDiffLineReveal,
} from '../../src/renderer/state/workspace';

const WORKSPACE = 'ws-1';

/** Renders the request, read, and settle hooks against one shared store. */
function renderRevealHooks(filePath: string, workspaceId = WORKSPACE) {
	const store = createStore();
	const wrapper = ({ children }: { children: ReactNode }) => (
		<Provider store={store}>{children}</Provider>
	);
	const request = renderHook(() => useRequestDiffLineReveal(), { wrapper });
	const reveal = renderHook(() => useDiffLineReveal(filePath, workspaceId), {
		wrapper,
	});
	const settle = renderHook(() => useSettleDiffLineReveal(), { wrapper });
	return { request, reveal, settle };
}

test('a queued reveal reaches the panel showing that file', () => {
	const { request, reveal } = renderRevealHooks('src/a.ts');

	act(() =>
		request.result.current({
			filePath: 'src/a.ts',
			line: 12,
			workspaceId: WORKSPACE,
		}),
	);

	expect(reveal.result.current).toEqual({
		line: 12,
		requestId: 1,
		side: 'new',
	});
});

test('a repeat request for the same line gets a fresh id', () => {
	const { request, reveal } = renderRevealHooks('src/a.ts');

	act(() =>
		request.result.current({
			filePath: 'src/a.ts',
			line: 12,
			workspaceId: WORKSPACE,
		}),
	);
	act(() =>
		request.result.current({
			filePath: 'src/a.ts',
			line: 12,
			workspaceId: WORKSPACE,
		}),
	);

	expect(reveal.result.current?.requestId).toBe(2);
});

test('a panel showing another file sees nothing', () => {
	const { request, reveal } = renderRevealHooks('src/other.ts');

	act(() =>
		request.result.current({
			filePath: 'src/a.ts',
			line: 12,
			workspaceId: WORKSPACE,
		}),
	);

	expect(reveal.result.current).toBeNull();
});

// Paths here are repository-relative and workspaces are branches of the same
// repository, so the same path exists in every one of them.
test('a panel in another workspace sees nothing for the same path', () => {
	const { request, reveal } = renderRevealHooks('src/a.ts', 'ws-2');

	act(() =>
		request.result.current({
			filePath: 'src/a.ts',
			line: 12,
			workspaceId: WORKSPACE,
		}),
	);

	expect(reveal.result.current).toBeNull();
});

test('an old-side request keeps its side', () => {
	const { request, reveal } = renderRevealHooks('src/a.ts');

	act(() =>
		request.result.current({
			filePath: 'src/a.ts',
			line: 3,
			side: 'old',
			workspaceId: WORKSPACE,
		}),
	);

	expect(reveal.result.current?.side).toBe('old');
});

test('settling drops the request so no later mount replays it', () => {
	const { request, reveal, settle } = renderRevealHooks('src/a.ts');

	act(() =>
		request.result.current({
			filePath: 'src/a.ts',
			line: 12,
			workspaceId: WORKSPACE,
		}),
	);
	act(() => settle.result.current(1));

	expect(reveal.result.current).toBeNull();
});

test('a stale settle leaves a newer request alone', () => {
	const { request, reveal, settle } = renderRevealHooks('src/a.ts');

	act(() =>
		request.result.current({
			filePath: 'src/a.ts',
			line: 12,
			workspaceId: WORKSPACE,
		}),
	);
	act(() =>
		request.result.current({
			filePath: 'src/a.ts',
			line: 40,
			workspaceId: WORKSPACE,
		}),
	);
	act(() => settle.result.current(1));

	expect(reveal.result.current?.requestId).toBe(2);
});
