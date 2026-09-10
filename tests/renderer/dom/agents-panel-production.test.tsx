// @vitest-environment happy-dom

import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Provider } from 'jotai';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ensemblrQueryKeys } from '../../../src/renderer/api/ensemblr/query-keys';
import { AgentsPanel } from '../../../src/renderer/components/workbench-shell/agents-panel/agents-panel';
import { useAgentsPanelState } from '../../../src/renderer/state/agents';
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

/** Produces one minimal chat row for the production workspace query. */
function chatTab(
	id: string,
	closedAt: string | null,
	agentSessionId: string | null = null,
): ChatTabWire {
	return {
		agentSessionId,
		closedAt,
		fullTitle:
			id === 'open-chat'
				? 'Open chat'
				: id === 'fresh-chat'
					? 'Fresh chat'
					: 'Closed chat',
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

/** Produces one session that has completed a real turn and is currently idle. */
function agentSession(
	id: string,
	closedAt: string | null = null,
): AgentSessionSnapshotWire {
	return {
		branchId: `branch-${id}`,
		closedAt,
		createdAt: '2026-01-01T00:00:00.000Z',
		cwd: '/tmp/workspace-1',
		id,
		label: null,
		lineage: {
			depth: 0,
			parentSessionId: null,
			rootSessionId: id,
		},
		model: null,
		openedTabs: [],
		provider: 'pi',
		runtimeOpen: closedAt === null,
		runtimeSessionId: `runtime-${id}`,
		status: 'idle',
		thinkingLevel: null,
		updatedAt: '2026-01-01T00:00:00.000Z',
		workspaceId: 'workspace-1',
	};
}

/** Mounts the real panel around its production query/state hook. */
function ProductionPanel({
	onDismiss,
	onRestore,
	onSelect,
	workspaceId = 'workspace-1',
}: {
	onDismiss: () => void;
	onRestore: (chatTabId: string) => Promise<boolean>;
	onSelect: (chatTabId: string) => void;
	workspaceId?: string;
}) {
	const props = useAgentsPanelState({
		onDismiss,
		onRestore,
		onSelect,
		selectedChatTabId: 'open-chat',
		workspaceId,
	});
	return <AgentsPanel {...props} />;
}

/** Seeds every query the production hook reads without polling the bridge. */
function renderProductionPanel(
	onRestore: (chatTabId: string) => Promise<boolean>,
) {
	const client = createTestQueryClient();
	const sessions = [
		agentSession('session-1'),
		agentSession('session-2', '2026-01-02T00:00:00.000Z'),
	];
	client.setQueryData(ensemblrQueryKeys.chatTabs('workspace-1'), {
		closed: [chatTab('closed-chat', '2026-01-02T00:00:00.000Z', 'session-2')],
		open: [
			chatTab('fresh-chat', null),
			chatTab('open-chat', null, 'session-1'),
		],
	});
	client.setQueryData(
		ensemblrQueryKeys.agentSessionsForWorkspace('workspace-1'),
		{ sessions },
	);
	client.setQueryData(ensemblrQueryKeys.agentModels(), {
		defaultModelId: null,
		defaultThinkingLevel: null,
		models: [],
	});
	const onDismiss = vi.fn();
	const onSelect = vi.fn();
	renderWithProviders(
		<Provider>
			<ProductionPanel
				onDismiss={onDismiss}
				onRestore={onRestore}
				onSelect={onSelect}
			/>
		</Provider>,
		{ client },
	);
	return { client, onDismiss, onSelect, sessions };
}

afterEach(() => {
	clearEnsemblrApi();
});

describe('production Agents panel navigation', () => {
	test('hides a fresh chat until its first real session starts', async () => {
		installEnsemblrApi({ onAgentSessionEvent: () => () => undefined });
		const { client, sessions } = renderProductionPanel(async () => true);

		expect(
			screen.queryByRole('button', { name: 'Open Fresh chat' }),
		).not.toBeInTheDocument();
		expect(
			screen.getByRole('button', { name: 'Open Open chat' }),
		).toBeInTheDocument();
		expect(
			screen.queryByRole('button', { name: 'Restore Closed chat' }),
		).not.toBeInTheDocument();

		client.setQueryData(ensemblrQueryKeys.chatTabs('workspace-1'), {
			closed: [chatTab('closed-chat', '2026-01-02T00:00:00.000Z', 'session-2')],
			open: [
				chatTab('fresh-chat', null, 'session-3'),
				chatTab('open-chat', null, 'session-1'),
			],
		});
		client.setQueryData(
			ensemblrQueryKeys.agentSessionsForWorkspace('workspace-1'),
			{ sessions: [...sessions, agentSession('session-3')] },
		);

		expect(
			await screen.findByRole('button', { name: 'Open Fresh chat' }),
		).toBeInTheDocument();
	});

	test('shows a placeholder until the spawned agent assigns its tab title', async () => {
		installEnsemblrApi({ onAgentSessionEvent: () => () => undefined });
		const { client } = renderProductionPanel(async () => true);
		const spawned = {
			...chatTab('spawned-chat', null, 'spawned-session'),
			fullTitle: '',
			title: '',
		};
		client.setQueryData(ensemblrQueryKeys.chatTabs('workspace-1'), {
			closed: [],
			open: [spawned],
		});

		const row = await screen.findByRole('button', { name: 'Open New chat' });
		expect(row).toHaveTextContent('New chat');
		expect(row).toHaveAttribute('title', expect.stringContaining('New chat'));

		client.setQueryData(ensemblrQueryKeys.chatTabs('workspace-1'), {
			closed: [],
			open: [
				{ ...spawned, fullTitle: 'Build the panel', title: 'Build panel' },
			],
		});
		expect(
			await screen.findByRole('button', { name: 'Open Build the panel' }),
		).toHaveTextContent('Build the panel');
		expect(screen.queryByText('New chat')).not.toBeInTheDocument();
	});

	test('selects an open chat and dismisses the narrow host', () => {
		installEnsemblrApi({ onAgentSessionEvent: () => () => undefined });
		const { onDismiss, onSelect } = renderProductionPanel(async () => true);

		fireEvent.click(screen.getByRole('button', { name: 'Open Open chat' }));

		expect(onSelect).toHaveBeenCalledWith('open-chat');
		expect(onDismiss).toHaveBeenCalledTimes(1);
	});

	test('applies a broadcast status before a snapshot refetch lands', async () => {
		let emitEvent: ((payload: AgentSessionEventBroadcast) => void) | undefined;
		installEnsemblrApi({
			onAgentSessionEvent: (
				listener: (payload: AgentSessionEventBroadcast) => void,
			) => {
				emitEvent = listener;
				return () => undefined;
			},
		});
		renderProductionPanel(async () => true);

		expect(screen.getByText('Idle')).toBeInTheDocument();
		emitEvent?.({
			event: {
				branchId: 'branch-session-1',
				createdAt: '2026-01-01T00:00:01.000Z',
				eventType: 'status',
				id: 'event-1',
				ordinal: 1,
				payload: { kind: 'status', previous: 'idle', status: 'streaming' },
				stream: 'protocol',
				turnId: null,
			},
			sessionId: 'session-1',
			workspaceId: 'workspace-1',
		});

		await screen.findByText('Working');
	});

	test('keeps live events over a stale refetch and refreshes missed workspace activity on return', async () => {
		let emitEvent: ((payload: AgentSessionEventBroadcast) => void) | undefined;
		installEnsemblrApi({
			onAgentSessionEvent: (
				listener: (payload: AgentSessionEventBroadcast) => void,
			) => {
				emitEvent = listener;
				return () => undefined;
			},
		});
		const client = createTestQueryClient();
		const initial = {
			...agentSession('session-1'),
			activityOrdinal: 1,
			contextUsage: {
				reading: 'live' as const,
				usage: { contextWindow: 1000, percent: 10, tokens: 100 },
			},
			currentTools: [
				{
					input: { path: 'README.md' },
					name: 'read',
					toolCallId: 'tool-1',
				},
			],
			status: 'streaming' as const,
		};
		client.setQueryData(ensemblrQueryKeys.chatTabs('workspace-1'), {
			closed: [],
			open: [chatTab('open-chat', null, 'session-1')],
		});
		client.setQueryData(
			ensemblrQueryKeys.agentSessionsForWorkspace('workspace-1'),
			{ sessions: [initial] },
		);
		client.setQueryData(ensemblrQueryKeys.chatTabs('workspace-2'), {
			closed: [],
			open: [],
		});
		client.setQueryData(
			ensemblrQueryKeys.agentSessionsForWorkspace('workspace-2'),
			{ sessions: [] },
		);
		client.setQueryData(ensemblrQueryKeys.agentModels(), {
			defaultModelId: null,
			defaultThinkingLevel: null,
			models: [],
		});
		const props = {
			onDismiss: vi.fn(),
			onRestore: async () => true,
			onSelect: vi.fn(),
		};
		const view = renderWithProviders(
			<Provider>
				<ProductionPanel {...props} />
			</Provider>,
			{ client },
		);

		expect(await screen.findByText('README.md')).toBeInTheDocument();
		emitEvent?.({
			event: {
				branchId: 'branch-session-1',
				createdAt: '2026-01-01T00:00:02.000Z',
				eventType: 'message',
				id: 'event-2',
				ordinal: 2,
				payload: {
					kind: 'message',
					payload: {
						input: { path: 'src/live.ts' },
						kind: 'tool-update',
						name: 'read',
						presentation: null,
						toolCallId: 'tool-1',
					},
					role: 'tool',
				},
				stream: 'protocol',
				turnId: null,
			},
			sessionId: 'session-1',
			workspaceId: 'workspace-1',
		});
		emitEvent?.({
			event: {
				branchId: 'branch-session-1',
				createdAt: '2026-01-01T00:00:03.000Z',
				eventType: 'context-usage',
				id: 'event-3',
				ordinal: 3,
				payload: {
					kind: 'context-usage',
					usage: { contextWindow: 1000, percent: 30, tokens: 300 },
				},
				stream: 'protocol',
				turnId: null,
			},
			sessionId: 'session-1',
			workspaceId: 'workspace-1',
		});
		await screen.findByText('src/live.ts');
		await screen.findByText('30%');

		client.setQueryData(
			ensemblrQueryKeys.agentSessionsForWorkspace('workspace-1'),
			{ sessions: [{ ...initial }] },
		);
		await waitFor(() => {
			expect(screen.getByText('src/live.ts')).toBeInTheDocument();
			expect(screen.getByText('30%')).toBeInTheDocument();
		});

		view.rerender(
			<Provider>
				<ProductionPanel {...props} workspaceId='workspace-2' />
			</Provider>,
		);
		await waitFor(() => {
			expect(screen.queryByText('src/live.ts')).not.toBeInTheDocument();
		});
		emitEvent?.({
			event: {
				branchId: 'branch-session-1',
				createdAt: '2026-01-01T00:00:04.000Z',
				eventType: 'context-usage',
				id: 'event-4',
				ordinal: 4,
				payload: {
					kind: 'context-usage',
					usage: { contextWindow: 1000, percent: 70, tokens: 700 },
				},
				stream: 'protocol',
				turnId: null,
			},
			sessionId: 'session-1',
			workspaceId: 'workspace-1',
		});
		client.setQueryData(
			ensemblrQueryKeys.agentSessionsForWorkspace('workspace-1'),
			{
				sessions: [
					{
						...initial,
						activityOrdinal: 4,
						contextUsage: {
							reading: 'live',
							usage: { contextWindow: 1000, percent: 70, tokens: 700 },
						},
						currentTools: [
							{
								input: { path: 'src/fresh.ts' },
								name: 'read',
								toolCallId: 'tool-1',
							},
						],
					},
				],
			},
		);
		view.rerender(
			<Provider>
				<ProductionPanel {...props} />
			</Provider>,
		);

		expect(await screen.findByText('src/fresh.ts')).toBeInTheDocument();
		expect(await screen.findByText('70%')).toBeInTheDocument();
	});

	test('keeps a failed restore retryable and dismisses only after success', async () => {
		installEnsemblrApi({ onAgentSessionEvent: () => () => undefined });
		const onRestore = vi
			.fn<(chatTabId: string) => Promise<boolean>>()
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(true);
		const { onDismiss } = renderProductionPanel(onRestore);
		fireEvent.click(screen.getByRole('button', { name: 'Closed 1' }));
		const restore = screen.getByRole('button', { name: 'Restore Closed chat' });

		fireEvent.click(restore);
		await screen.findByText('Restore failed. Try again.');
		expect(onDismiss).not.toHaveBeenCalled();

		fireEvent.click(restore);
		await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
		expect(onRestore).toHaveBeenCalledTimes(2);
	});
});
