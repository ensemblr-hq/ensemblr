// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test } from 'vitest';

import { ensemblrQueryKeys } from '@/renderer/api/ensemblr-queries';
import { getDefaultWorkspace } from '@/renderer/fixtures/workbench';
import { useWorkspacePanelTabState } from '@/renderer/state/workspace/panel-tabs';
import {
	activeChatTabByWorkspaceAtom,
	sessionVisitOrderByWorkspaceAtom,
} from '@/renderer/state/workspace/selection-atoms';
import { useSessionTabModels } from '@/renderer/state/workspace/session-tab-models';
import type {
	SessionTabModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type { ChatTabWire } from '@/shared/ipc/contracts/chat-tab';

import { createTestQueryClient, installLocalStorage } from './support/dom';

const WORKSPACE_ID = 'workspace-b';

/** Builds a persisted open chat-tab row for the workspace under test. */
function chatTabRow(id: string, position: number): ChatTabWire {
	return {
		agentSessionId: null,
		closedAt: null,
		fullTitle: id,
		id,
		isPreview: false,
		kind: 'chat',
		metadata: {},
		openedAt: '2026-08-20T10:00:00.000Z',
		position,
		title: id,
		workspaceId: WORKSPACE_ID,
	};
}

/** Builds the routed session the workspace route derives from the `$chatId` param. */
function routedSession(id: string): SessionTabModel {
	return {
		agentSessionId: null,
		chatTabId: id,
		fullLabel: id,
		id,
		isPreview: false,
		isSubAgent: false,
		kind: 'chat',
		label: id,
		status: 'idle',
		summary: '',
		updatedLabel: '',
	};
}

/**
 * Mirrors how `WorkspaceRouteContent` composes the two hooks: the tab models
 * resolve the routed chat id against the workspace's persisted rows, and the
 * panel-tab state persists whichever chat the workspace ended up showing.
 */
function renderRouteMemory({
	client,
	routedChatId,
	store,
	workspace,
}: {
	client: ReturnType<typeof createTestQueryClient>;
	routedChatId: string;
	store: ReturnType<typeof createStore>;
	workspace: WorkspaceShellModel;
}) {
	return renderHook(
		(props: { routedChatId: string }) => {
			const models = useSessionTabModels({
				activeSession: routedSession(props.routedChatId),
				activeWorkspace: workspace,
				busyTerminalIds: new Set<string>(),
				terminalTitles: {},
			});
			useWorkspacePanelTabState({
				activeChatId: models.resolvedActiveChatId ?? undefined,
				activeWorkspace: workspace,
			});
			return models;
		},
		{
			initialProps: { routedChatId },
			wrapper: ({ children }: { children: ReactNode }) => (
				<QueryClientProvider client={client}>
					<Provider store={store}>{children}</Provider>
				</QueryClientProvider>
			),
		},
	);
}

describe('per-workspace active chat memory', () => {
	let store: ReturnType<typeof createStore>;
	let client: ReturnType<typeof createTestQueryClient>;
	let workspace: WorkspaceShellModel;

	beforeEach(() => {
		installLocalStorage();
		store = createStore();
		client = createTestQueryClient();
		workspace = { ...getDefaultWorkspace(), id: WORKSPACE_ID };
		client.setQueryData(ensemblrQueryKeys.chatTabs(WORKSPACE_ID), {
			closed: [],
			open: [chatTabRow('tab-1', 0), chatTabRow('tab-2', 1)],
		});
		client.setQueryData(
			ensemblrQueryKeys.closedChatTabsWithSummary(WORKSPACE_ID),
			{ entries: [] },
		);
		client.setQueryData(
			ensemblrQueryKeys.agentSessionsForWorkspace(WORKSPACE_ID),
			{
				sessions: [],
			},
		);
		store.set(activeChatTabByWorkspaceAtom, { [WORKSPACE_ID]: 'tab-2' });
	});

	test('remembers the chat the route actually resolved to', () => {
		renderRouteMemory({ client, routedChatId: 'tab-2', store, workspace });

		expect(store.get(activeChatTabByWorkspaceAtom)).toEqual({
			[WORKSPACE_ID]: 'tab-2',
		});
	});

	test('keeps the remembered chat when the routed id belongs to another workspace', () => {
		const { result } = renderRouteMemory({
			client,
			routedChatId: 'chat-from-workspace-a',
			store,
			workspace,
		});

		expect(result.current.effectiveActiveSession.id).toBe('tab-1');
		expect(store.get(activeChatTabByWorkspaceAtom)).toEqual({
			[WORKSPACE_ID]: 'tab-2',
		});
		expect(store.get(sessionVisitOrderByWorkspaceAtom)).toEqual({});
	});
});
