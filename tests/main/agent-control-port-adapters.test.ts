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
import { listAllWorkspaceRows } from '../../src/main/storage/repositories/workspace-repository.ts';

vi.mock('../../src/main/storage/repositories/chat-tab-repository.ts', () => ({
	getChatTabById: vi.fn(() => ({ workspaceId: 'ws', metadata: {} })),
	setChatTabMetadata: vi.fn(),
}));

vi.mock('../../src/main/storage/repositories/workspace-repository.ts', () => ({
	listAllWorkspaceRows: vi.fn(() => []),
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
		const setSessionName = vi
			.fn()
			.mockResolvedValue({ chatTabId: 'tab-1', title: 'Refactor auth' });
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
			sessionId: 'sess-1',
			name: 'Refactor auth',
		});
		expect(result).toEqual({ chatTabId: 'tab-1', title: 'Refactor auth' });
		expect(broadcastTabsChanged).toHaveBeenCalledWith({ workspaceId: 'ws' });
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
		const setSessionName = vi
			.fn()
			.mockResolvedValue({ chatTabId: 'tab-1', title: 'Docs sweep' });
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
			sessionId: 'sess-1',
			name: 'Docs sweep',
		});
	});
});
