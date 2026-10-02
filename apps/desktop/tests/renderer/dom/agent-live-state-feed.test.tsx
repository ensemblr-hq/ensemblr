// @vitest-environment happy-dom

/**
 * The live agent state was seeded and kept current by the hook that also built
 * the Agents panel's rows, and that hook ran in the workspace shell — so the
 * shell re-rendered for every tool call of every running agent, and the state
 * the close guard reads existed only because the panel's model happened to be
 * built. The feed owns that upkeep alone and renders nothing.
 */

import { act, screen, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, describe, expect, test } from 'vitest';

import { ensemblrQueryKeys } from '../../../src/renderer/api/ensemblr/query-keys';
import { AgentLiveStateFeed } from '../../../src/renderer/components/workbench-shell/agent-live-state-feed';
import { LiveAgentsPanel } from '../../../src/renderer/components/workbench-shell/agents-panel/live-agents-panel';
import { agentWorkspaceLiveStateAtomFamily } from '../../../src/renderer/state/agents';
import type {
	AgentSessionEventBroadcast,
	AgentSessionSnapshotWire,
} from '../../../src/shared/ipc/contracts/agent-session';
import type { ChatTabWire } from '../../../src/shared/ipc/contracts/chat-tab';
import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
	renderWithProviders,
} from '../support/dom';

type BridgeListener = (event: AgentSessionEventBroadcast) => void;

/** Produces one idle session snapshot for a workspace. */
function agentSession(
	id: string,
	workspaceId: string,
): AgentSessionSnapshotWire {
	return {
		activityOrdinal: 0,
		branchId: `branch-${id}`,
		closedAt: null,
		createdAt: '2026-01-01T00:00:00.000Z',
		cwd: `/tmp/${workspaceId}`,
		id,
		label: null,
		model: null,
		openedTabs: [],
		provider: 'pi',
		runtimeOpen: true,
		runtimeSessionId: `runtime-${id}`,
		status: 'idle',
		thinkingLevel: null,
		updatedAt: '2026-01-01T00:00:00.000Z',
		workspaceId,
	};
}

/** Produces one open chat tab that has started the given agent session. */
function openChatTab(id: string, agentSessionId: string): ChatTabWire {
	return {
		agentSessionId,
		closedAt: null,
		fullTitle: 'Open chat',
		id,
		isPreview: false,
		kind: 'chat',
		metadata: {},
		openedAt: '2026-01-01T00:00:00.000Z',
		position: 0,
		title: id,
		workspaceId: 'workspace-1',
	};
}

/** Builds a status broadcast for a session, with a payload only when asked. */
function statusBroadcast({
	ordinal,
	payload = { kind: 'status', previous: 'idle', status: 'streaming' },
	sessionId,
	workspaceId,
}: {
	ordinal: number;
	payload?: AgentSessionEventBroadcast['event']['payload'];
	sessionId: string;
	workspaceId: string;
}): AgentSessionEventBroadcast {
	return {
		event: {
			branchId: `branch-${sessionId}`,
			createdAt: '2026-01-01T00:00:01.000Z',
			eventType: 'status',
			id: `event-${ordinal}`,
			ordinal,
			payload,
			stream: 'protocol',
			turnId: null,
		},
		sessionId,
		workspaceId,
	};
}

/** Mounts only the feed, over seeded workspace snapshots and a capturing bridge. */
function renderFeed(workspaceId = 'workspace-1') {
	let emit: BridgeListener = () => undefined;
	installEnsemblrApi({
		onAgentSessionEvent: (listener: BridgeListener) => {
			emit = listener;
			return () => undefined;
		},
	});
	const client = createTestQueryClient();
	client.setQueryData(
		ensemblrQueryKeys.agentSessionsForWorkspace('workspace-1'),
		{
			sessions: [agentSession('session-1', 'workspace-1')],
		},
	);
	client.setQueryData(
		ensemblrQueryKeys.agentSessionsForWorkspace('workspace-2'),
		{
			sessions: [agentSession('session-2', 'workspace-2')],
		},
	);
	const store = createStore();
	const view = renderWithProviders(
		<Provider store={store}>
			<AgentLiveStateFeed workspaceId={workspaceId} />
		</Provider>,
		{ client },
	);
	return {
		client,
		container: view.container,
		emit: (broadcast: AgentSessionEventBroadcast) => act(() => emit(broadcast)),
		store,
	};
}

afterEach(() => {
	clearEnsemblrApi();
});

describe('AgentLiveStateFeed', () => {
	test('seeds its workspace from the session snapshots and renders nothing', () => {
		const { container, store } = renderFeed();

		expect(
			store.get(agentWorkspaceLiveStateAtomFamily('workspace-1'))['session-1']
				?.status,
		).toBe('idle');
		expect(container).toBeEmptyDOMElement();
	});

	test('applies its own workspace broadcasts and ignores the rest', () => {
		const { emit, store } = renderFeed();

		emit(
			statusBroadcast({
				ordinal: 1,
				sessionId: 'session-2',
				workspaceId: 'workspace-2',
			}),
		);
		emit(
			statusBroadcast({
				ordinal: 2,
				payload: null,
				sessionId: 'session-1',
				workspaceId: 'workspace-1',
			}),
		);
		expect(
			store.get(agentWorkspaceLiveStateAtomFamily('workspace-1'))['session-1']
				?.status,
		).toBe('idle');
		expect(store.get(agentWorkspaceLiveStateAtomFamily('workspace-2'))).toEqual(
			{},
		);

		emit(
			statusBroadcast({
				ordinal: 3,
				sessionId: 'session-1',
				workspaceId: 'workspace-1',
			}),
		);
		expect(
			store.get(agentWorkspaceLiveStateAtomFamily('workspace-1'))['session-1']
				?.status,
		).toBe('streaming');
	});

	test('re-seeds when the workspace snapshots change', async () => {
		const { client, store } = renderFeed();

		act(() => {
			client.setQueryData(
				ensemblrQueryKeys.agentSessionsForWorkspace('workspace-1'),
				{
					sessions: [
						{
							...agentSession('session-1', 'workspace-1'),
							status: 'streaming' as const,
							updatedAt: '2026-01-01T00:00:05.000Z',
						},
					],
				},
			);
		});

		await waitFor(() => {
			expect(
				store.get(agentWorkspaceLiveStateAtomFamily('workspace-1'))['session-1']
					?.status,
			).toBe('streaming');
		});
	});

	test('shows seeded activity in a panel that mounts in the same commit as the feed', () => {
		installEnsemblrApi({ onAgentSessionEvent: () => () => undefined });
		const client = createTestQueryClient();
		client.setQueryData(
			ensemblrQueryKeys.agentSessionsForWorkspace('workspace-1'),
			{
				sessions: [
					{
						...agentSession('session-1', 'workspace-1'),
						currentTools: [
							{
								input: { path: 'README.md' },
								name: 'read',
								toolCallId: 'tool-1',
							},
						],
						status: 'streaming' as const,
					},
				],
			},
		);
		client.setQueryData(ensemblrQueryKeys.chatTabs('workspace-1'), {
			closed: [],
			open: [openChatTab('open-chat', 'session-1')],
		});
		client.setQueryData(ensemblrQueryKeys.agentModels(), {
			defaultModelId: null,
			defaultThinkingLevel: null,
			models: [],
		});
		const navigation = {
			onDismiss: () => undefined,
			onRestore: async () => true,
			onSelect: () => undefined,
			selectedChatTabId: 'open-chat',
		};

		renderWithProviders(
			<Provider store={createStore()}>
				<AgentLiveStateFeed workspaceId='workspace-1' />
				<LiveAgentsPanel navigation={navigation} workspaceId='workspace-1' />
			</Provider>,
			{ client },
		);

		expect(screen.getByText('README.md')).toBeInTheDocument();
	});
});
