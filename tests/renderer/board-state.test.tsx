// @vitest-environment happy-dom

import { renderHook } from '@testing-library/react';
import { createStore, Provider, useAtomValue } from 'jotai';
import type { ReactNode } from 'react';
import { act } from 'react';
import { expect, test } from 'vitest';

import {
	useWorkspaceBoardActions,
	useWorkspaceBoardStatuses,
} from '../../src/renderer/state/workspace';
import { unreadWorkspaceIdsAtom } from '../../src/renderer/state/workspace/structure-atoms';

/** Renders the board-state hooks against an isolated Jotai store. */
function renderBoardState() {
	const store = createStore();
	const wrapper = ({ children }: { children: ReactNode }) => (
		<Provider store={store}>{children}</Provider>
	);
	return renderHook(
		() => ({
			actions: useWorkspaceBoardActions(),
			statuses: useWorkspaceBoardStatuses(),
			unread: useAtomValue(unreadWorkspaceIdsAtom),
		}),
		{ wrapper },
	);
}

test('setting a non-default status stores it', () => {
	const { result } = renderBoardState();
	act(() => result.current.actions.setWorkspaceBoardStatus('w1', 'done'));
	expect(result.current.statuses.w1).toBe('done');
});

test('setting the default status clears the stored entry', () => {
	const { result } = renderBoardState();
	act(() => result.current.actions.setWorkspaceBoardStatus('w1', 'in-review'));
	act(() => result.current.actions.setWorkspaceBoardStatus('w1', 'backlog'));
	expect('w1' in result.current.statuses).toBe(false);
});

test('marking a workspace unread and read toggles the id', () => {
	const { result } = renderBoardState();
	act(() => result.current.actions.markWorkspaceUnread('w1'));
	expect(result.current.unread).toEqual(['w1']);
	act(() => result.current.actions.markWorkspaceUnread('w1'));
	expect(result.current.unread).toEqual(['w1']);
	act(() => result.current.actions.markWorkspaceRead('w1'));
	expect(result.current.unread).toEqual([]);
});

test('toggleWorkspaceUnread flips the unread state', () => {
	const { result } = renderBoardState();
	act(() => result.current.actions.toggleWorkspaceUnread('w1'));
	expect(result.current.unread).toEqual(['w1']);
	act(() => result.current.actions.toggleWorkspaceUnread('w1'));
	expect(result.current.unread).toEqual([]);
});
