// @vitest-environment happy-dom

import { renderHook } from '@testing-library/react';
import { createStore, Provider, useAtomValue } from 'jotai';
import type { ReactNode } from 'react';
import { act } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

import type { ChatTurnFinishedBroadcast } from '@/shared/ipc/contracts/notifications';

const { subscribers } = vi.hoisted(() => ({
	subscribers: [] as Array<(broadcast: ChatTurnFinishedBroadcast) => void>,
}));

vi.mock('@/renderer/api/ensemblr', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../src/renderer/api/ensemblr')>()),
	subscribeChatTurnFinished: (
		listener: (broadcast: ChatTurnFinishedBroadcast) => void,
	) => {
		subscribers.push(listener);
		return () => {
			subscribers.splice(subscribers.indexOf(listener), 1);
		};
	},
}));

import { useAutoMarkUnread } from '../../src/renderer/hooks/workspace/use-auto-mark-unread';
import { pendingAskUserQuestionsAtom } from '../../src/renderer/state/ask-user-question';
import { activeChatIdentityAtom } from '../../src/renderer/state/unread/active-chat';
import { unreadChatEntriesAtom } from '../../src/renderer/state/unread/atoms';

/** A turn-finish broadcast for one session in one workspace. */
function finishedTurn(
	workspaceId: string,
	agentSessionId: string,
	chatTabId: string | null = null,
): ChatTurnFinishedBroadcast {
	return {
		agentSessionId,
		chatTabId,
		finishedAt: '2026-08-11T10:00:00.000Z',
		workspaceId,
	};
}

/** Mounts the hook against an isolated store and exposes the unread list. */
function renderAutoMark(activeWorkspaceId: string | null = null) {
	const store = createStore();
	const wrapper = ({ children }: { children: ReactNode }) => (
		<Provider store={store}>{children}</Provider>
	);
	const view = renderHook(
		() => {
			useAutoMarkUnread(activeWorkspaceId);
			return useAtomValue(unreadChatEntriesAtom);
		},
		{ wrapper },
	);
	return { store, view };
}

/** Delivers a broadcast to every mounted subscriber. */
function emit(broadcast: ChatTurnFinishedBroadcast) {
	act(() => {
		for (const listener of [...subscribers]) {
			listener(broadcast);
		}
	});
}

beforeEach(() => {
	subscribers.length = 0;
	window.localStorage?.clear();
});

test('a finished turn in a background workspace marks its chat unread', () => {
	const { view } = renderAutoMark(null);
	emit(finishedTurn('ws-2', 'session-2'));
	expect(view.result.current).toEqual([
		{
			agentSessionId: 'session-2',
			chatTabId: null,
			lastMessageAt: Date.parse('2026-08-11T10:00:00.000Z'),
			reason: 'turn-finished',
			workspaceId: 'ws-2',
		},
	]);
});

test('a finished turn in the chat on screen is not marked', () => {
	const { store, view } = renderAutoMark('ws-1');
	act(() => {
		store.set(activeChatIdentityAtom, {
			agentSessionId: 'session-1',
			chatTabId: 'tab-1',
			workspaceId: 'ws-1',
		});
	});
	emit(finishedTurn('ws-1', 'session-1'));
	expect(view.result.current).toEqual([]);
});

test('a sibling tab in the open workspace is still marked', () => {
	const { store, view } = renderAutoMark('ws-1');
	act(() => {
		store.set(activeChatIdentityAtom, {
			agentSessionId: 'session-1',
			chatTabId: 'tab-1',
			workspaceId: 'ws-1',
		});
	});
	emit(finishedTurn('ws-1', 'session-other'));
	expect(view.result.current).toHaveLength(1);
	expect(view.result.current[0].agentSessionId).toBe('session-other');
});

test('a pending question marks its chat once, not on every republish', () => {
	const { store, view } = renderAutoMark(null);
	act(() => {
		store.set(pendingAskUserQuestionsAtom, {
			'session-3': {
				agentSessionId: 'session-3',
				questions: [],
				requestId: 'request-1',
				workspaceId: 'ws-3',
			},
		});
	});
	expect(view.result.current).toHaveLength(1);
	expect(view.result.current[0].reason).toBe('question');

	act(() => {
		store.set(pendingAskUserQuestionsAtom, {
			'session-3': {
				agentSessionId: 'session-3',
				questions: [],
				requestId: 'request-1',
				workspaceId: 'ws-3',
			},
			'session-4': {
				agentSessionId: 'session-4',
				questions: [],
				requestId: 'request-2',
				workspaceId: 'ws-4',
			},
		});
	});
	expect(view.result.current).toHaveLength(2);
});

test('a question raised in the chat on screen is not marked', () => {
	const { store, view } = renderAutoMark('ws-1');
	act(() => {
		store.set(activeChatIdentityAtom, {
			agentSessionId: 'session-1',
			chatTabId: 'tab-1',
			workspaceId: 'ws-1',
		});
	});
	act(() => {
		store.set(pendingAskUserQuestionsAtom, {
			'session-1': {
				agentSessionId: 'session-1',
				questions: [],
				requestId: 'request-1',
				workspaceId: 'ws-1',
			},
		});
	});
	expect(view.result.current).toEqual([]);
});

test('a question seen on screen re-arms when the user leaves it unanswered', () => {
	const { store, view } = renderAutoMark('ws-1');
	act(() => {
		store.set(activeChatIdentityAtom, {
			agentSessionId: 'session-1',
			chatTabId: 'tab-1',
			workspaceId: 'ws-1',
		});
	});
	act(() => {
		store.set(pendingAskUserQuestionsAtom, {
			'session-1': {
				agentSessionId: 'session-1',
				questions: [],
				requestId: 'request-1',
				workspaceId: 'ws-1',
			},
		});
	});
	expect(view.result.current).toEqual([]);

	act(() => {
		store.set(activeChatIdentityAtom, null);
	});
	expect(view.result.current).toHaveLength(1);
	expect(view.result.current[0].agentSessionId).toBe('session-1');
});

test('a mark keeps the tab main resolved, so it needs no lookup to jump to', () => {
	const { view } = renderAutoMark(null);
	emit(finishedTurn('ws-2', 'session-2', 'tab-2'));
	expect(view.result.current[0].chatTabId).toBe('tab-2');
});
