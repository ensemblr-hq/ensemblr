// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { ensemblrQueryKeys } from '../../src/renderer/api/ensemblr/query-keys';
import { removeOpenChatTabFromCache } from '../../src/renderer/api/ensemblr-queries';
import { useClearUnreadOnAgentTabClose } from '../../src/renderer/hooks/workspace/use-clear-unread-on-agent-tab-close';
import type { UnreadChatEntry } from '../../src/renderer/state/unread/atoms';
import { unreadChatEntriesAtom } from '../../src/renderer/state/unread/atoms';
import { useSessionTabState } from '../../src/renderer/state/workspace';
import type {
	SessionTabModel,
	WorkspaceShellModel,
} from '../../src/renderer/types/workbench';
import type { TabsChangedBroadcast } from '../../src/shared/agent-control';
import type {
	ChatTabWire,
	ListChatTabsResult,
} from '../../src/shared/ipc/contracts/chat-tab';
import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
	installLocalStorage,
} from './support/dom';

const WORKSPACE_ID = 'ws-1';

/** Builds an unread mark, defaulting to one made with no tab id resolved yet. */
function mark(overrides: Partial<UnreadChatEntry> = {}): UnreadChatEntry {
	return {
		agentSessionId: 'session-a',
		chatTabId: null,
		lastMessageAt: 1,
		reason: 'turn-finished',
		workspaceId: WORKSPACE_ID,
		...overrides,
	};
}

/** Builds a minimal open chat-tab wire row. */
function tab(overrides: Partial<ChatTabWire> = {}): ChatTabWire {
	return {
		agentSessionId: 'session-a',
		closedAt: null,
		fullTitle: 'tab-a',
		id: 'tab-a',
		isPreview: false,
		kind: 'chat',
		metadata: {},
		openedAt: '2026-08-16T00:00:00.000Z',
		position: 0,
		title: 'tab-a',
		workspaceId: WORKSPACE_ID,
		...overrides,
	};
}

/** Mounts the agent-close listener over a store seeded with the given marks. */
function renderListener(marks: UnreadChatEntry[]) {
	const store = createStore();
	store.set(unreadChatEntriesAtom, marks);
	const wrapper = ({ children }: { children: ReactNode }) => (
		<Provider store={store}>{children}</Provider>
	);
	renderHook(useClearUnreadOnAgentTabClose, { wrapper });
	return store;
}

let emit: (payload: TabsChangedBroadcast) => void = () => {};
let unsubscribe: ReturnType<typeof vi.fn>;

beforeEach(() => {
	installLocalStorage();
	unsubscribe = vi.fn();
	installEnsemblrApi({
		onAgentControlTabsChanged: (
			listener: (payload: TabsChangedBroadcast) => void,
		) => {
			emit = listener;
			return unsubscribe;
		},
	});
});

afterEach(() => {
	clearEnsemblrApi();
});

test('an agent closing a tab clears the mark its session left behind', () => {
	const store = renderListener([mark()]);

	emit({
		closedChat: { agentSessionId: 'session-a', chatTabId: 'tab-a' },
		workspaceId: WORKSPACE_ID,
	});

	expect(store.get(unreadChatEntriesAtom)).toEqual([]);
});

test('a tab-set change that is not a close leaves every mark standing', () => {
	const store = renderListener([mark()]);

	emit({ workspaceId: WORKSPACE_ID });

	expect(store.get(unreadChatEntriesAtom)).toHaveLength(1);
});

test('a close in one workspace leaves another workspace marked', () => {
	const store = renderListener([
		mark(),
		mark({ agentSessionId: 'session-b', workspaceId: 'ws-2' }),
	]);

	emit({
		closedChat: { agentSessionId: 'session-a', chatTabId: 'tab-a' },
		workspaceId: WORKSPACE_ID,
	});

	expect(
		store.get(unreadChatEntriesAtom).map((entry) => entry.agentSessionId),
	).toEqual(['session-b']);
});

test('a close carrying no session still clears a mark that resolved a tab id', () => {
	const store = renderListener([mark({ chatTabId: 'tab-a' })]);

	emit({
		closedChat: { agentSessionId: null, chatTabId: 'tab-a' },
		workspaceId: WORKSPACE_ID,
	});

	expect(store.get(unreadChatEntriesAtom)).toEqual([]);
});

test('the listener unsubscribes on unmount', () => {
	const store = createStore();
	const wrapper = ({ children }: { children: ReactNode }) => (
		<Provider store={store}>{children}</Provider>
	);
	const view = renderHook(useClearUnreadOnAgentTabClose, { wrapper });

	view.unmount();

	expect(unsubscribe).toHaveBeenCalledTimes(1);
});

test('removing a closing tab from the cache hands back the row it dropped', () => {
	const queryClient = createTestQueryClient();
	queryClient.setQueryData<ListChatTabsResult>(
		ensemblrQueryKeys.chatTabs(WORKSPACE_ID),
		{ closed: [], open: [tab(), tab({ id: 'tab-b', position: 1 })] },
	);

	const removed = removeOpenChatTabFromCache({
		chatTabId: 'tab-a',
		queryClient,
		workspaceId: WORKSPACE_ID,
	});

	expect(removed?.agentSessionId).toBe('session-a');
	expect(
		queryClient
			.getQueryData<ListChatTabsResult>(
				ensemblrQueryKeys.chatTabs(WORKSPACE_ID),
			)
			?.open.map((row) => row.id),
	).toEqual(['tab-b']);
});

test('removing a tab the cache does not hold reports nothing dropped', () => {
	const queryClient = createTestQueryClient();
	queryClient.setQueryData<ListChatTabsResult>(
		ensemblrQueryKeys.chatTabs(WORKSPACE_ID),
		{ closed: [], open: [tab()] },
	);

	expect(
		removeOpenChatTabFromCache({
			chatTabId: 'tab-missing',
			queryClient,
			workspaceId: WORKSPACE_ID,
		}),
	).toBeNull();
});

test('removing a tab before the cache has a snapshot reports nothing dropped', () => {
	expect(
		removeOpenChatTabFromCache({
			chatTabId: 'tab-a',
			queryClient: createTestQueryClient(),
			workspaceId: WORKSPACE_ID,
		}),
	).toBeNull();
});

/** Mounts `useSessionTabState` over a store seeded with one mark for `session-a`. */
function renderCloseFlow(closeChatTab: () => Promise<unknown>) {
	const activeSession: SessionTabModel = {
		agentSessionId: null,
		chatTabId: 'tab-b',
		id: 'tab-b',
		isPreview: false,
		isSubAgent: false,
		kind: 'chat',
		label: 'Chat',
		status: 'idle',
		summary: '',
		updatedLabel: 'Chat',
	};
	const activeWorkspace = {
		id: WORKSPACE_ID,
		sessions: [activeSession],
	} as unknown as WorkspaceShellModel;
	installEnsemblrApi({
		closeChatTab,
		listChatTabs: vi.fn(async () => ({
			closed: [],
			open: [tab(), tab({ agentSessionId: null, id: 'tab-b', position: 1 })],
		})),
		onAgentControlTabsChanged: vi.fn(() => () => undefined),
		onAgentSessionEvent: vi.fn(() => () => undefined),
		onTerminalLifecycle: vi.fn(() => () => undefined),
	});

	const store = createStore();
	store.set(unreadChatEntriesAtom, [mark()]);
	const client = createTestQueryClient();
	client.setQueryData<ListChatTabsResult>(
		ensemblrQueryKeys.chatTabs(WORKSPACE_ID),
		{ closed: [], open: [tab(), tab({ id: 'tab-b', position: 1 })] },
	);
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>
			<Provider store={store}>{children}</Provider>
		</QueryClientProvider>
	);

	const view = renderHook(
		() =>
			useSessionTabState({
				activeSession,
				activeWorkspace,
				onSessionTabChange: () => undefined,
			}),
		{ wrapper },
	);
	return { store, view };
}

test('the user closing a tab clears the mark its session left behind', async () => {
	const { store, view } = renderCloseFlow(
		vi.fn(async () => ({ deleted: false, ok: true })),
	);

	await act(async () => {
		await view.result.current.closeSessionTabAsync('tab-a');
	});

	expect(store.get(unreadChatEntriesAtom)).toEqual([]);
});

test('a close that fails leaves the mark standing with the tab it belongs to', async () => {
	const { store, view } = renderCloseFlow(
		vi.fn(async () => {
			throw new Error('close refused');
		}),
	);

	await act(async () => {
		await view.result.current
			.closeSessionTabAsync('tab-a')
			.catch(() => undefined);
	});

	expect(
		store.get(unreadChatEntriesAtom).map((entry) => entry.agentSessionId),
	).toEqual(['session-a']);
});
