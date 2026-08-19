// @vitest-environment happy-dom

import { renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { act } from 'react';
import { beforeEach, expect, test } from 'vitest';

import { shellFixtureProjects } from '../../src/renderer/fixtures/workbench';
import { useReconcileUnreadChats } from '../../src/renderer/hooks/workspace/use-reconcile-unread-chats';
import {
	activeChatIdentityAtom,
	usePublishActiveChat,
} from '../../src/renderer/state/unread/active-chat';
import type { UnreadChatEntry } from '../../src/renderer/state/unread/atoms';
import { unreadChatEntriesAtom } from '../../src/renderer/state/unread/atoms';

/** Builds an entry with the ids a case cares about and sane defaults elsewhere. */
function entry(overrides: Partial<UnreadChatEntry> = {}): UnreadChatEntry {
	return {
		agentSessionId: 'session-a',
		chatTabId: 'tab-a',
		lastMessageAt: 1,
		reason: 'turn-finished',
		workspaceId: 'ws-1',
		...overrides,
	};
}

/**
 * Wraps a hook in an isolated store seeded with the given marks. The list is
 * subscribed before it is seeded: happy-dom ships no `localStorage`, so mounting
 * the persisted atom re-initialises it from the fallback and would drop a value
 * written while it was still unmounted.
 */
function renderWithMarks<T>(
	marks: UnreadChatEntry[],
	useHook: () => T,
): {
	store: ReturnType<typeof createStore>;
	view: ReturnType<typeof renderHook<T, void>>;
} {
	const store = createStore();
	store.sub(unreadChatEntriesAtom, () => undefined);
	store.set(unreadChatEntriesAtom, marks);
	const wrapper = ({ children }: { children: ReactNode }) => (
		<Provider store={store}>{children}</Provider>
	);
	return { store, view: renderHook(useHook, { wrapper }) };
}

beforeEach(() => {
	window.localStorage?.clear();
});

test('opening a chat publishes its identity', () => {
	const { store } = renderWithMarks([], () =>
		usePublishActiveChat({
			agentSessionId: 'session-a',
			chatTabId: 'tab-a',
			workspaceId: 'ws-1',
		}),
	);

	expect(store.get(activeChatIdentityAtom)).toEqual({
		agentSessionId: 'session-a',
		chatTabId: 'tab-a',
		workspaceId: 'ws-1',
	});
});

test('opening a chat clears its own mark and leaves the others', () => {
	const { store } = renderWithMarks(
		[entry(), entry({ agentSessionId: 'session-b', chatTabId: 'tab-b' })],
		() =>
			usePublishActiveChat({
				agentSessionId: 'session-a',
				chatTabId: 'tab-a',
				workspaceId: 'ws-1',
			}),
	);

	expect(store.get(unreadChatEntriesAtom)).toEqual([
		entry({ agentSessionId: 'session-b', chatTabId: 'tab-b' }),
	]);
});

test('a session-only mark is cleared by the tab that turns out to hold it', () => {
	const { store } = renderWithMarks([entry({ chatTabId: null })], () =>
		usePublishActiveChat({
			agentSessionId: 'session-a',
			chatTabId: 'tab-a',
			workspaceId: 'ws-1',
		}),
	);

	expect(store.get(unreadChatEntriesAtom)).toEqual([]);
});

test('a mark landing while the chat is already on screen is retired', () => {
	const { store } = renderWithMarks([], () =>
		usePublishActiveChat({
			agentSessionId: 'session-a',
			chatTabId: 'tab-a',
			workspaceId: 'ws-1',
		}),
	);

	act(() => {
		store.set(unreadChatEntriesAtom, [entry({ chatTabId: null })]);
	});

	expect(store.get(unreadChatEntriesAtom)).toEqual([]);
});

test('a mark for the on-screen tab is retired even before its session resolves', () => {
	const { store } = renderWithMarks([], () =>
		usePublishActiveChat({
			agentSessionId: null,
			chatTabId: 'tab-a',
			workspaceId: 'ws-1',
		}),
	);

	act(() => {
		store.set(unreadChatEntriesAtom, [entry()]);
	});

	expect(store.get(unreadChatEntriesAtom)).toEqual([]);
});

test('a mark for another chat survives while this one is on screen', () => {
	const { store } = renderWithMarks([], () =>
		usePublishActiveChat({
			agentSessionId: 'session-a',
			chatTabId: 'tab-a',
			workspaceId: 'ws-1',
		}),
	);

	const other = entry({ agentSessionId: 'session-b', chatTabId: 'tab-b' });
	act(() => {
		store.set(unreadChatEntriesAtom, [other]);
	});

	expect(store.get(unreadChatEntriesAtom)).toEqual([other]);
});

test('leaving the workspace blanks the identity, so the next turn does mark', () => {
	const { store, view } = renderWithMarks([], () =>
		usePublishActiveChat({
			agentSessionId: 'session-a',
			chatTabId: 'tab-a',
			workspaceId: 'ws-1',
		}),
	);

	view.unmount();
	expect(store.get(activeChatIdentityAtom)).toBeNull();
});

test('reconciling drops marks for a workspace the shell no longer lists', () => {
	const live = shellFixtureProjects[0].workspaces[0].id;
	const { store } = renderWithMarks(
		[entry({ workspaceId: live }), entry({ workspaceId: 'ws-archived' })],
		() => useReconcileUnreadChats(shellFixtureProjects),
	);

	expect(store.get(unreadChatEntriesAtom)).toEqual([
		entry({ workspaceId: live }),
	]);
});

test('reconciling against an unloaded project list keeps every mark', () => {
	const { store } = renderWithMarks([entry()], () =>
		useReconcileUnreadChats([]),
	);

	expect(store.get(unreadChatEntriesAtom)).toEqual([entry()]);
});
