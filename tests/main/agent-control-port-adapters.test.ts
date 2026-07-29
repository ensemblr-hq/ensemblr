import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
	createAgentControlPorts,
	createBoardStatusStore,
	type PortAdapterDeps,
} from '../../src/main/agent-control/index.ts';
import {
	getChatTabById,
	setChatTabMetadata,
} from '../../src/main/storage/repositories/chat-tab-repository.ts';
import {
	listAllWorkspaceRows,
	selectWorkspaceWithRepositoryById,
} from '../../src/main/storage/repositories/workspace-repository.ts';
import type { PiPersistedEnvelope } from '../../src/shared/ipc/contracts/pi-session';

vi.mock('../../src/main/storage/repositories/chat-tab-repository.ts', () => ({
	getChatTabById: vi.fn(() => ({ workspaceId: 'ws', metadata: {} })),
	setChatTabMetadata: vi.fn(),
}));

vi.mock('../../src/main/storage/repositories/workspace-repository.ts', () => ({
	listAllWorkspaceRows: vi.fn(() => []),
	selectWorkspaceWithRepositoryById: vi.fn(),
}));

/**
 * Builds port-adapter deps with the collaborators the tab port touches; the
 * remaining ports are constructed but never exercised here, so their deps stay
 * as light stand-ins.
 */
const makeDeps = (): {
	deps: PortAdapterDeps;
	broadcastTabsChanged: ReturnType<typeof vi.fn>;
	broadcastBoardStatus: ReturnType<typeof vi.fn>;
	boardStatusStore: ReturnType<typeof createBoardStatusStore>;
	openTab: ReturnType<typeof vi.fn>;
} => {
	const broadcastTabsChanged = vi.fn();
	const broadcastBoardStatus = vi.fn();
	const boardStatusStore = createBoardStatusStore();
	const openTab = vi.fn((input: { metadata?: unknown }) => ({
		id: 'tab-1',
		metadata: input.metadata ?? {},
	}));
	const deps = {
		databaseService: { getConnection: () => ({ database: {} }) },
		chatTabService: { openTab, closeTab: vi.fn(), listTabs: vi.fn() },
		piSessionService: {},
		terminalService: {},
		scriptLifecycleService: {},
		harnessDetectionService: {},
		piExecutableService: {},
		getPermissionMode: () => 'workspace-trusted',
		broadcastFocus: vi.fn(),
		broadcastTabsChanged,
		broadcastBoardStatus,
		boardStatusStore,
		ask: { ask: vi.fn(), releaseSession: vi.fn() },
		confirm: { confirm: vi.fn() },
	} as unknown as PortAdapterDeps;
	return {
		deps,
		broadcastTabsChanged,
		broadcastBoardStatus,
		boardStatusStore,
		openTab,
	};
};

describe('agent-control port adapters: tab-change broadcast', () => {
	let deps: PortAdapterDeps;
	let broadcastTabsChanged: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		const built = makeDeps();
		deps = built.deps;
		broadcastTabsChanged = built.broadcastTabsChanged;
	});

	it('broadcasts the workspace after spawning a chat tab', async () => {
		const ports = createAgentControlPorts(deps);
		await ports.tabs.spawnChatTab({ workspaceId: 'ws', title: 'New' });
		expect(broadcastTabsChanged).toHaveBeenCalledWith({ workspaceId: 'ws' });
	});

	it('broadcasts the workspace after opening a non-chat tab', async () => {
		const ports = createAgentControlPorts(deps);
		await ports.tabs.openNonChatTab({
			workspaceId: 'ws',
			variant: 'file',
			filePath: 'src/a.ts',
		});
		expect(broadcastTabsChanged).toHaveBeenCalledWith({ workspaceId: 'ws' });
	});

	it('broadcasts the owning workspace after closing a tab', async () => {
		const ports = createAgentControlPorts(deps);
		await ports.tabs.closeTab({ chatTabId: 'tab-1' });
		expect(broadcastTabsChanged).toHaveBeenCalledWith({ workspaceId: 'ws' });
	});
});

describe('agent-control port adapters: board status', () => {
	it('setWorkspaceStatus updates the mirror and broadcasts', () => {
		const { deps, broadcastBoardStatus, boardStatusStore } = makeDeps();
		const ports = createAgentControlPorts(deps);
		ports.board.setWorkspaceStatus({ workspaceId: 'ws', status: 'in-review' });
		expect(broadcastBoardStatus).toHaveBeenCalledWith({
			workspaceId: 'ws',
			status: 'in-review',
		});
		expect(boardStatusStore.get('ws')).toBe('in-review');
		expect(ports.board.getWorkspaceStatus('ws')).toBe('in-review');
	});

	it('getWorkspaceStatus defaults to backlog for an unreported workspace', () => {
		const { deps } = makeDeps();
		const ports = createAgentControlPorts(deps);
		expect(ports.board.getWorkspaceStatus('unknown')).toBe('backlog');
	});

	it('listWorkspaces carries each workspace board status from the mirror', async () => {
		const { deps, boardStatusStore } = makeDeps();
		boardStatusStore.setOne('ws-1', 'done');
		vi.mocked(listAllWorkspaceRows).mockReturnValue([
			{ id: 'ws-1', name: 'One', path: '/one', archivedAt: null },
			{ id: 'ws-2', name: 'Two', path: '/two', archivedAt: null },
		] as ReturnType<typeof listAllWorkspaceRows>);
		const ports = createAgentControlPorts(deps);
		const workspaces = await ports.workspaces.listWorkspaces();
		expect(workspaces).toEqual([
			{ workspaceId: 'ws-1', name: 'One', cwd: '/one', boardStatus: 'done' },
			{ workspaceId: 'ws-2', name: 'Two', cwd: '/two', boardStatus: 'backlog' },
		]);
	});
});

describe('agent-control port adapters: conversation naming', () => {
	beforeEach(() => {
		vi.mocked(getChatTabById).mockReturnValue({
			workspaceId: 'ws',
			metadata: {},
		} as ReturnType<typeof getChatTabById>);
		vi.mocked(setChatTabMetadata).mockClear();
	});

	it('setName forwards to the pi session service and broadcasts', async () => {
		const setSessionName = vi.fn().mockResolvedValue({
			applied: true,
			chatTabId: 'tab-1',
			title: 'Refactor auth',
		});
		const { deps, broadcastTabsChanged } = makeDeps();
		(deps as { piSessionService: unknown }).piSessionService = {
			setSessionName,
			getSession: vi.fn(() => ({ workspaceId: 'ws' })),
		};
		const ports = createAgentControlPorts(deps);
		const result = await ports.conversations.setName({
			piSessionId: 'sess-1',
			name: 'Refactor auth',
		});
		expect(setSessionName).toHaveBeenCalledWith({
			name: 'Refactor auth',
			provenance: 'agent',
			sessionId: 'sess-1',
		});
		expect(result).toEqual({
			applied: true,
			chatTabId: 'tab-1',
			title: 'Refactor auth',
		});
		expect(broadcastTabsChanged).toHaveBeenCalledWith({ workspaceId: 'ws' });
	});

	it('setName does not broadcast when the user owns the title', async () => {
		const setSessionName = vi.fn().mockResolvedValue({
			applied: false,
			chatTabId: 'tab-1',
			title: 'Chosen by hand',
		});
		const { deps, broadcastTabsChanged } = makeDeps();
		(deps as { piSessionService: unknown }).piSessionService = {
			setSessionName,
			getSession: vi.fn(() => ({ workspaceId: 'ws' })),
		};
		const ports = createAgentControlPorts(deps);
		const result = await ports.conversations.setName({
			piSessionId: 'sess-1',
			name: 'Agent guess',
		});
		expect(result).toMatchObject({ applied: false, title: 'Chosen by hand' });
		expect(broadcastTabsChanged).not.toHaveBeenCalled();
	});

	it('setName returns null and does not broadcast for an inactive session', async () => {
		const setSessionName = vi.fn().mockResolvedValue(null);
		const { deps, broadcastTabsChanged } = makeDeps();
		(deps as { piSessionService: unknown }).piSessionService = {
			setSessionName,
			getSession: vi.fn(),
		};
		const ports = createAgentControlPorts(deps);
		const result = await ports.conversations.setName({
			piSessionId: 'gone',
			name: 'x',
		});
		expect(result).toBeNull();
		expect(broadcastTabsChanged).not.toHaveBeenCalled();
	});

	it('startConversation stamps the tab as a sub-agent and applies the title', async () => {
		const setSessionName = vi.fn().mockResolvedValue({
			applied: true,
			chatTabId: 'tab-1',
			title: 'Docs sweep',
		});
		const { deps } = makeDeps();
		(deps as { piSessionService: unknown }).piSessionService = {
			openSession: vi.fn().mockResolvedValue({ id: 'sess-1' }),
			submitPrompt: vi.fn().mockResolvedValue({}),
			setSessionName,
			getSession: vi.fn(),
			listSessionsForWorkspace: () => [],
		};
		(deps as { piExecutableService: unknown }).piExecutableService = {
			getSnapshot: vi
				.fn()
				.mockResolvedValue({ status: 'ready', command: 'pi' }),
		};
		(deps as { localCommandService: unknown }).localCommandService = {};
		const ports = createAgentControlPorts(deps);
		const result = await ports.conversations.startConversation({
			workspaceId: 'ws',
			workspaceCwd: '/ws',
			prompt: 'do it',
			title: 'Docs sweep',
			parentSessionId: 'parent-1',
		});
		expect(result).toEqual({ chatTabId: 'tab-1', piSessionId: 'sess-1' });
		expect(setChatTabMetadata).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'tab-1',
				metadata: expect.objectContaining({ agentRole: 'subagent' }),
			}),
		);
		expect(setSessionName).toHaveBeenCalledWith({
			name: 'Docs sweep',
			provenance: 'agent',
			sessionId: 'sess-1',
		});
	});
});

describe('agent-control port adapters: branch naming', () => {
	const origin = {
		depth: 0,
		parentSessionId: null,
		sessionId: 'sess-1',
		species: 'pi' as const,
		token: 'tok',
		workspaceCwd: '/ws',
		workspaceId: 'ws',
	};

	const withNamingSetting = (renameWorkspaceOnBranch: boolean) => {
		const { deps, broadcastTabsChanged } = makeDeps();
		const renameWorkspace = vi.fn().mockResolvedValue({
			diagnostics: [],
			status: 'success',
			workspace: {
				branchName: 'psoldunov/add-dark-mode',
				name: 'add-dark-mode',
			},
		});
		Object.assign(deps, {
			appSettingsService: {
				read: () => ({ git: { renameWorkspaceOnBranch } }),
			},
			piSessionService: { appendWorkspaceRenamed: vi.fn() },
			renameWorkspace,
		});
		vi.mocked(selectWorkspaceWithRepositoryById).mockReturnValue({
			branchName: 'psoldunov/bach',
			metadataJson: JSON.stringify({ placeholderName: true }),
			name: 'bach',
		} as ReturnType<typeof selectWorkspaceWithRepositoryById>);
		return {
			broadcastTabsChanged,
			ports: createAgentControlPorts(deps),
			renameWorkspace,
		};
	};

	it('names a placeholder workspace while the user allows it', async () => {
		const { broadcastTabsChanged, ports, renameWorkspace } =
			withNamingSetting(true);

		const result = await ports.sessionNaming.setBranchName({
			origin,
			slug: 'add-dark-mode',
		});

		expect(renameWorkspace).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'add-dark-mode', workspaceId: 'ws' }),
		);
		expect(result).toMatchObject({ applied: true, name: 'add-dark-mode' });
		expect(broadcastTabsChanged).toHaveBeenCalledWith({ workspaceId: 'ws' });
	});

	it('refuses to name a placeholder workspace when the user turned naming off', async () => {
		const { broadcastTabsChanged, ports, renameWorkspace } =
			withNamingSetting(false);

		const result = await ports.sessionNaming.setBranchName({
			origin,
			slug: 'add-dark-mode',
		});

		expect(renameWorkspace).not.toHaveBeenCalled();
		expect(result).toMatchObject({ applied: false, name: 'bach' });
		expect(result.message).toContain('do not call this tool again');
		expect(broadcastTabsChanged).not.toHaveBeenCalled();
	});
});

describe('agent-control port adapters: last message', () => {
	const agentMessage = (text: string): PiPersistedEnvelope => ({
		kind: 'message',
		role: 'agent',
		payload: {
			kind: 'message',
			role: 'assistant',
			parts: [
				{ kind: 'reasoning', text: 'internal thoughts' },
				{ kind: 'text', text },
			],
		},
	});

	const withPayloads = (payloads: readonly (PiPersistedEnvelope | null)[]) => {
		const { deps } = makeDeps();
		(deps as { piSessionService: unknown }).piSessionService = {
			getSession: vi.fn(() => ({ branchId: 'branch-1' })),
			iterateEventPayloadsDescending: vi.fn(() => payloads),
		};
		return createAgentControlPorts(deps);
	};

	it('extracts the text parts of a completed agent message, skipping reasoning', async () => {
		const ports = withPayloads([agentMessage('The build is green.')]);
		const result = await ports.conversations.getLastMessage('sess-1');
		expect(result).toBe('The build is green.');
	});

	it('returns the newest assistant answer, skipping a later non-text event', async () => {
		const ports = withPayloads([
			{ kind: 'status', previous: 'idle', status: 'idle' },
			agentMessage('newest answer'),
			agentMessage('older answer'),
		]);
		const result = await ports.conversations.getLastMessage('sess-1');
		expect(result).toBe('newest answer');
	});

	it('reads a standalone text payload', async () => {
		const ports = withPayloads([
			{
				kind: 'message',
				role: 'agent',
				payload: { kind: 'text', text: 'hello' },
			},
		]);
		const result = await ports.conversations.getLastMessage('sess-1');
		expect(result).toBe('hello');
	});

	it('skips streaming deltas that were never finalized into a message', async () => {
		const ports = withPayloads([
			{
				kind: 'message',
				role: 'agent',
				payload: { kind: 'text-delta', text: 'partial' },
			},
			{
				kind: 'message',
				role: 'agent',
				payload: { kind: 'reasoning-delta', text: 'thinking' },
			},
		]);
		const result = await ports.conversations.getLastMessage('sess-1');
		expect(result).toBeNull();
	});

	it('ignores user and tool envelopes', async () => {
		const ports = withPayloads([
			{
				kind: 'message',
				role: 'tool',
				payload: {
					kind: 'tool-result',
					isError: false,
					output: 'ok',
					toolCallId: 'call-1',
				},
			},
			{
				kind: 'message',
				role: 'user',
				payload: { kind: 'text', text: 'the question' },
			},
		]);
		const result = await ports.conversations.getLastMessage('sess-1');
		expect(result).toBeNull();
	});

	it('returns null for an unknown session', async () => {
		const { deps } = makeDeps();
		(deps as { piSessionService: unknown }).piSessionService = {
			getSession: vi.fn(() => undefined),
			iterateEventPayloadsDescending: vi.fn(() => []),
		};
		const ports = createAgentControlPorts(deps);
		const result = await ports.conversations.getLastMessage('gone');
		expect(result).toBeNull();
	});
});

describe('agent-control port adapters: conversation status', () => {
	const withStatus = (
		snapshot: unknown,
		payloads: readonly (PiPersistedEnvelope | null)[] = [],
	) => {
		const { deps } = makeDeps();
		(deps as { piSessionService: unknown }).piSessionService = {
			getSession: vi.fn(() => snapshot),
			iterateEventPayloadsDescending: vi.fn(() => payloads),
		};
		return createAgentControlPorts(deps);
	};

	it('returns the live snapshot without scanning persisted events', async () => {
		const { deps } = makeDeps();
		const iterateEventPayloadsDescending = vi.fn(() => []);
		(deps as { piSessionService: unknown }).piSessionService = {
			getSession: vi.fn(() => ({
				id: 'sess-1',
				branchId: 'b1',
				status: 'closed',
				runtimeOpen: false,
			})),
			iterateEventPayloadsDescending,
		};
		const ports = createAgentControlPorts(deps);
		const result = await ports.conversations.getStatus('sess-1');
		expect(result).toEqual({
			piSessionId: 'sess-1',
			status: 'closed',
			runtimeOpen: false,
		});
		// The `waitForAgents` poll loop calls this every 250ms per child, so it
		// must never touch the event store.
		expect(iterateEventPayloadsDescending).not.toHaveBeenCalled();
	});

	it('reports hasFinalMessage true when a persisted assistant answer exists', async () => {
		const ports = withStatus(
			{ id: 'sess-1', branchId: 'b1', status: 'closed', runtimeOpen: false },
			[
				{
					kind: 'message',
					role: 'agent',
					payload: { kind: 'text', text: 'the report' },
				},
			],
		);
		expect(await ports.conversations.hasFinalMessage('sess-1')).toBe(true);
	});

	it('reports hasFinalMessage false when the branch has no assistant answer', async () => {
		const ports = withStatus(
			{ id: 'sess-2', branchId: 'b2', status: 'idle', runtimeOpen: true },
			[{ kind: 'status', previous: 'idle', status: 'idle' }],
		);
		expect(await ports.conversations.hasFinalMessage('sess-2')).toBe(false);
	});

	it('reports hasFinalMessage false for an unknown session', async () => {
		const ports = withStatus(undefined);
		expect(await ports.conversations.hasFinalMessage('gone')).toBe(false);
	});

	it('returns null for an unknown session', async () => {
		const ports = withStatus(undefined);
		expect(await ports.conversations.getStatus('gone')).toBeNull();
	});
});
