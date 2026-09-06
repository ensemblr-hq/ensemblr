import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	createAgentControlPorts,
	createBoardStatusStore,
	type PortAdapterDeps,
} from '../../src/main/agent-control/index.ts';
import {
	getChatTabByAgentSessionId,
	getChatTabById,
	setChatTabMetadata,
} from '../../src/main/storage/repositories/chat-tab-repository.ts';
import { listProjectRows } from '../../src/main/storage/repositories/repository-row-repository.ts';
import {
	listAllWorkspaceRows,
	selectWorkspaceWithRepositoryById,
} from '../../src/main/storage/repositories/workspace-repository.ts';
import type { AgentPersistedEnvelope } from '../../src/shared/ipc/contracts/agent-session';
import type { CreateTerminalSessionResult } from '../../src/shared/ipc/contracts/terminal.ts';
import {
	DEFAULT_RUN_SCRIPT_ICON,
	type RunScriptDefinition,
} from '../../src/shared/scripts.ts';
import {
	fakeSpawnModelResolver,
	modelOption,
} from './support/spawn-model-resolver.ts';

vi.mock('../../src/main/storage/repositories/chat-tab-repository.ts', () => ({
	getChatTabById: vi.fn(() => ({
		agentSessionId: null,
		closedAt: null,
		id: 'tab-1',
		kind: 'chat',
		metadata: {},
		workspaceId: 'ws',
	})),
	getChatTabByAgentSessionId: vi.fn(() => null),
	setChatTabMetadata: vi.fn(),
}));

vi.mock(
	'../../src/main/storage/repositories/repository-row-repository.ts',
	() => ({
		listProjectRows: vi.fn(() => []),
	}),
);

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
	claimIdleChatTab: ReturnType<typeof vi.fn>;
	restoreTab: ReturnType<typeof vi.fn>;
	broadcastFocus: ReturnType<typeof vi.fn>;
} => {
	const broadcastTabsChanged = vi.fn();
	const broadcastBoardStatus = vi.fn();
	const broadcastFocus = vi.fn();
	const boardStatusStore = createBoardStatusStore();
	const openTab = vi.fn((input: { metadata?: unknown }) => ({
		id: 'tab-1',
		metadata: input.metadata ?? {},
	}));
	const claimIdleChatTab = vi.fn(() => null);
	const restoreTab = vi.fn(({ chatTabId }: { chatTabId: string }) => ({
		id: chatTabId,
	}));
	const deps = {
		databaseService: { getConnection: () => ({ database: {} }) },
		chatTabService: {
			claimIdleChatTab,
			openTab,
			closeTab: vi.fn(),
			listTabs: vi.fn(),
			restoreTab,
		},
		agentSessionService: {},
		terminalService: {},
		scriptLifecycleService: {},
		harnessDetectionService: {},
		piExecutableService: {},
		spawnModelResolver: fakeSpawnModelResolver([
			modelOption({ id: 'anthropic/sonnet', runtime: 'pi' }),
		]),
		getPermissionMode: () => 'workspace-trusted',
		broadcastFocus,
		broadcastTabsChanged,
		broadcastBoardStatus,
		broadcastAfkMode: vi.fn(),
		broadcastPlanMode: vi.fn(),
		boardStatusStore,
		ask: { ask: vi.fn(), releaseSession: vi.fn() },
		confirm: { confirm: vi.fn() },
		planMode: {
			activateForSpawn: vi.fn(),
			exit: vi.fn(),
			hasSubmittedPlan: vi.fn(() => false),
			isActive: vi.fn(() => false),
			releaseSession: vi.fn(),
		},
		afkMode: {
			activateForSpawn: vi.fn(),
			isActive: vi.fn(() => false),
			releaseSession: vi.fn(),
		},
	} as unknown as PortAdapterDeps;
	return {
		deps,
		broadcastFocus,
		broadcastTabsChanged,
		broadcastBoardStatus,
		boardStatusStore,
		claimIdleChatTab,
		openTab,
		restoreTab,
	};
};

/** Builds an open chat-tab row as the repository returns it. */
function openChatRow(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		agentSessionId: null,
		closedAt: null,
		id: 'tab-1',
		kind: 'chat',
		metadata: {},
		workspaceId: 'ws',
		...overrides,
	};
}

/**
 * Queues the rows the tab port reads before and after an attempted close, so a
 * refused close (the row is still open afterwards) can be told from a real one.
 * `after` is omitted where the port never gets that far.
 */
function stubCloseOutcome(
	before: Record<string, unknown> | null,
	after?: Record<string, unknown> | null,
): void {
	const asRow = (value: Record<string, unknown> | null) =>
		value as unknown as ReturnType<typeof getChatTabById>;
	vi.mocked(getChatTabById).mockReturnValueOnce(asRow(before));
	if (after !== undefined) {
		vi.mocked(getChatTabById).mockReturnValueOnce(asRow(after));
	}
}

beforeEach(() => {
	vi.mocked(getChatTabById).mockReset();
	vi.mocked(getChatTabById).mockImplementation(
		() => openChatRow() as unknown as ReturnType<typeof getChatTabById>,
	);
});

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
		stubCloseOutcome(openChatRow(), null);
		const ports = createAgentControlPorts(deps);
		await ports.tabs.closeTab({ chatTabId: 'tab-1' });
		expect(broadcastTabsChanged).toHaveBeenCalledWith({
			closedChat: { agentSessionId: null, chatTabId: 'tab-1' },
			workspaceId: 'ws',
		});
	});

	it('names the closed chat and its session so the renderer can retire its unread mark', async () => {
		stubCloseOutcome(openChatRow({ agentSessionId: 'session-a' }), {
			...openChatRow({ agentSessionId: 'session-a' }),
			closedAt: '2026-08-16T00:00:00.000Z',
		});
		const ports = createAgentControlPorts(deps);
		await ports.tabs.closeTab({ chatTabId: 'tab-1' });
		expect(broadcastTabsChanged).toHaveBeenCalledWith({
			closedChat: { agentSessionId: 'session-a', chatTabId: 'tab-1' },
			workspaceId: 'ws',
		});
	});

	it('stays silent when the closing tab has no row to name', async () => {
		vi.mocked(getChatTabById).mockReturnValueOnce(
			null as unknown as ReturnType<typeof getChatTabById>,
		);
		const ports = createAgentControlPorts(deps);
		await ports.tabs.closeTab({ chatTabId: 'tab-gone' });
		expect(broadcastTabsChanged).not.toHaveBeenCalled();
	});

	it('names no chat when the close was refused and the tab is still open', async () => {
		stubCloseOutcome(
			openChatRow({ agentSessionId: 'session-a' }),
			openChatRow({ agentSessionId: 'session-a' }),
		);
		const ports = createAgentControlPorts(deps);
		await ports.tabs.closeTab({ chatTabId: 'tab-1' });
		expect(broadcastTabsChanged).toHaveBeenCalledWith({ workspaceId: 'ws' });
	});

	it('names no chat when the closed tab was not a chat', async () => {
		stubCloseOutcome(
			openChatRow({ agentSessionId: 'session-a', kind: 'terminal' }),
		);
		const ports = createAgentControlPorts(deps);
		await ports.tabs.closeTab({ chatTabId: 'tab-1' });
		expect(broadcastTabsChanged).toHaveBeenCalledWith({ workspaceId: 'ws' });
	});
});

describe('agent-control port adapters: non-chat tab titles', () => {
	let deps: PortAdapterDeps;
	let openTab: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		const built = makeDeps();
		deps = built.deps;
		openTab = built.openTab;
	});

	it('names a file tab after the file it opens', async () => {
		const ports = createAgentControlPorts(deps);
		await ports.tabs.openNonChatTab({
			workspaceId: 'ws',
			variant: 'file',
			filePath: 'src/renderer/components/message.tsx',
		});
		expect(openTab).toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'file', title: 'message.tsx' }),
		);
	});

	it('names a diff tab after the file it diffs', async () => {
		const ports = createAgentControlPorts(deps);
		await ports.tabs.openNonChatTab({
			workspaceId: 'ws',
			variant: 'diff',
			filePath: 'src/main/main.ts',
		});
		expect(openTab).toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'diff', title: 'main.ts' }),
		);
	});

	it('leaves a comment tab untitled for the renderer to label', async () => {
		const ports = createAgentControlPorts(deps);
		await ports.tabs.openNonChatTab({
			workspaceId: 'ws',
			variant: 'comment',
			commentBody: 'Looks good',
			prNumber: 12,
		});
		expect(openTab).toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'document', title: '' }),
		);
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

	it('listProjects reports every project with its live workspace count', async () => {
		const { deps } = makeDeps();
		vi.mocked(listProjectRows).mockReturnValue([
			{
				defaultBranch: 'main',
				id: 'repo-1',
				name: 'Ensemblr',
				path: '/repos/ensemblr',
				slug: 'ensemblr',
				workspaceCount: 2,
			},
			{
				defaultBranch: null,
				id: 'repo-2',
				name: 'Playground',
				path: '/repos/playground',
				slug: 'playground',
				workspaceCount: 0,
			},
		]);
		const ports = createAgentControlPorts(deps);
		expect(await ports.workspaces.listProjects()).toEqual([
			{
				defaultBranch: 'main',
				name: 'Ensemblr',
				path: '/repos/ensemblr',
				projectId: 'repo-1',
				slug: 'ensemblr',
				workspaceCount: 2,
			},
			{
				defaultBranch: null,
				name: 'Playground',
				path: '/repos/playground',
				projectId: 'repo-2',
				slug: 'playground',
				workspaceCount: 0,
			},
		]);
	});

	it('listProjects answers empty rather than throwing with no database', async () => {
		const { deps } = makeDeps();
		const ports = createAgentControlPorts({
			...deps,
			databaseService: {
				getConnection: () => null,
			} as PortAdapterDeps['databaseService'],
		});
		expect(await ports.workspaces.listProjects()).toEqual([]);
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

	it('setName forwards to the agent session service and broadcasts', async () => {
		const setSessionName = vi.fn().mockResolvedValue({
			applied: true,
			chatTabId: 'tab-1',
			title: 'Refactor auth',
		});
		const { deps, broadcastTabsChanged } = makeDeps();
		(deps as { agentSessionService: unknown }).agentSessionService = {
			setSessionName,
			getSession: vi.fn(() => ({ workspaceId: 'ws' })),
		};
		const ports = createAgentControlPorts(deps);
		const result = await ports.conversations.setName({
			agentSessionId: 'sess-1',
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
		(deps as { agentSessionService: unknown }).agentSessionService = {
			setSessionName,
			getSession: vi.fn(() => ({ workspaceId: 'ws' })),
		};
		const ports = createAgentControlPorts(deps);
		const result = await ports.conversations.setName({
			agentSessionId: 'sess-1',
			name: 'Agent guess',
		});
		expect(result).toMatchObject({ applied: false, title: 'Chosen by hand' });
		expect(broadcastTabsChanged).not.toHaveBeenCalled();
	});

	it('setName returns null and does not broadcast for an inactive session', async () => {
		const setSessionName = vi.fn().mockResolvedValue(null);
		const { deps, broadcastTabsChanged } = makeDeps();
		(deps as { agentSessionService: unknown }).agentSessionService = {
			setSessionName,
			getSession: vi.fn(),
		};
		const ports = createAgentControlPorts(deps);
		const result = await ports.conversations.setName({
			agentSessionId: 'gone',
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
		(deps as { agentSessionService: unknown }).agentSessionService = {
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
		const ports = createAgentControlPorts(deps);
		const result = await ports.conversations.startConversation({
			workspaceId: 'ws',
			workspaceCwd: '/ws',
			prompt: 'do it',
			title: 'Docs sweep',
			asPeer: false,
			callerConcierge: false,
			callerRuntime: 'pi',
			parentSessionId: 'parent-1',
			planMode: false,
			afkMode: false,
		});
		expect(result).toEqual({
			ok: true,
			chatTabId: 'tab-1',
			agentSessionId: 'sess-1',
		});
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

	// The renderer opens an empty chat tab for every workspace that has none, so a
	// spawn that always opened its own left a freshly created workspace showing
	// two tabs, one of them permanently blank.
	it('startConversation claims the workspace’s idle chat tab', async () => {
		const { claimIdleChatTab, deps, openTab } = makeDeps();
		claimIdleChatTab.mockReturnValue({ id: 'tab-idle', kind: 'chat' });
		(deps as { agentSessionService: unknown }).agentSessionService = {
			openSession: vi.fn().mockResolvedValue({ id: 'sess-1' }),
			submitPrompt: vi.fn().mockResolvedValue({}),
			setSessionName: vi.fn().mockResolvedValue({ applied: true }),
			getSession: vi.fn(),
			listSessionsForWorkspace: () => [],
		};
		(deps as { piExecutableService: unknown }).piExecutableService = {
			getSnapshot: vi
				.fn()
				.mockResolvedValue({ status: 'ready', command: 'pi' }),
		};
		const ports = createAgentControlPorts(deps);

		const result = await ports.conversations.startConversation({
			workspaceId: 'ws',
			workspaceCwd: '/ws',
			prompt: 'do it',
			asPeer: false,
			callerConcierge: false,
			callerRuntime: 'pi',
			parentSessionId: 'parent-1',
			planMode: false,
			afkMode: false,
		});

		expect(result).toMatchObject({ chatTabId: 'tab-idle', ok: true });
		expect(openTab).not.toHaveBeenCalled();
	});

	// Rollback closes what the spawn created, and a tab that was already there is
	// not that — closing it would take the user's own empty tab away with it.
	it('startConversation leaves a claimed tab open when the submit fails', async () => {
		const { claimIdleChatTab, deps } = makeDeps();
		claimIdleChatTab.mockReturnValue({ id: 'tab-idle', kind: 'chat' });
		const closeTab = vi.fn();
		(deps.chatTabService as { closeTab: unknown }).closeTab = closeTab;
		(deps as { agentSessionService: unknown }).agentSessionService = {
			openSession: vi.fn().mockResolvedValue({ id: 'sess-1' }),
			submitPrompt: vi.fn().mockRejectedValue(new Error('runtime refused')),
			setSessionName: vi.fn().mockResolvedValue({ applied: true }),
			getSession: vi.fn(),
			listSessionsForWorkspace: () => [],
			stopSession: vi.fn().mockResolvedValue(undefined),
		};
		(deps as { piExecutableService: unknown }).piExecutableService = {
			getSnapshot: vi
				.fn()
				.mockResolvedValue({ status: 'ready', command: 'pi' }),
		};
		const ports = createAgentControlPorts(deps);

		await expect(
			ports.conversations.startConversation({
				workspaceId: 'ws',
				workspaceCwd: '/ws',
				prompt: 'do it',
				asPeer: false,
				callerConcierge: false,
				callerRuntime: 'pi',
				parentSessionId: 'parent-1',
				planMode: false,
				afkMode: false,
			}),
		).rejects.toThrow('runtime refused');
		expect(closeTab).not.toHaveBeenCalled();
	});

	// The renderer resolves a tab's branch id out of the session list, so until the
	// binding is announced the timeline has no branch to query and the tab renders
	// blank. `submitPrompt` captures a git checkpoint first, which makes that gap
	// seconds long — so the announcement has to come first.
	it('startConversation announces the tab-to-session binding before submitting', async () => {
		const submitPrompt = vi.fn().mockResolvedValue({});
		const { broadcastTabsChanged, deps } = makeDeps();
		(deps as { agentSessionService: unknown }).agentSessionService = {
			openSession: vi.fn().mockResolvedValue({ id: 'sess-1' }),
			submitPrompt,
			setSessionName: vi.fn().mockResolvedValue({ applied: true }),
			getSession: vi.fn(),
			listSessionsForWorkspace: () => [],
		};
		(deps as { piExecutableService: unknown }).piExecutableService = {
			getSnapshot: vi
				.fn()
				.mockResolvedValue({ status: 'ready', command: 'pi' }),
		};
		const ports = createAgentControlPorts(deps);

		await ports.conversations.startConversation({
			workspaceId: 'ws',
			workspaceCwd: '/ws',
			prompt: 'do it',
			asPeer: false,
			callerConcierge: false,
			callerRuntime: 'pi',
			parentSessionId: 'parent-1',
			planMode: false,
			afkMode: false,
		});

		const markedAt = vi.mocked(setChatTabMetadata).mock.invocationCallOrder[0];
		const submittedAt = submitPrompt.mock.invocationCallOrder[0];
		expect(markedAt).toBeLessThan(submittedAt);
		const announcedBetween =
			broadcastTabsChanged.mock.invocationCallOrder.filter(
				(order) => order > markedAt && order < submittedAt,
			);
		expect(announcedBetween).toHaveLength(1);
	});

	// The marker now lands before the submit that can fail. A tab this call opened
	// is closed on rollback, but a tab the caller passed in survives — and would
	// keep a locked composer forever if the marker stayed behind.
	it('startConversation clears the sub-agent marker when a reused tab fails to submit', async () => {
		const { deps } = makeDeps();
		(deps as { agentSessionService: unknown }).agentSessionService = {
			openSession: vi.fn().mockResolvedValue({ id: 'sess-1' }),
			submitPrompt: vi.fn().mockRejectedValue(new Error('pi is not ready')),
			stopSession: vi.fn().mockResolvedValue(undefined),
			setSessionName: vi.fn(),
			getSession: vi.fn(),
			listSessionsForWorkspace: () => [],
		};
		(deps as { piExecutableService: unknown }).piExecutableService = {
			getSnapshot: vi
				.fn()
				.mockResolvedValue({ status: 'ready', command: 'pi' }),
		};
		vi.mocked(getChatTabById)
			.mockReturnValueOnce({
				metadata: { pinned: true },
				workspaceId: 'ws',
			} as unknown as ReturnType<typeof getChatTabById>)
			.mockReturnValueOnce({
				metadata: { agentRole: 'subagent', pinned: true },
				workspaceId: 'ws',
			} as unknown as ReturnType<typeof getChatTabById>);
		const ports = createAgentControlPorts(deps);

		await expect(
			ports.conversations.startConversation({
				workspaceId: 'ws',
				workspaceCwd: '/ws',
				chatTabId: 'tab-reused',
				prompt: 'do it',
				asPeer: false,
				callerConcierge: false,
				callerRuntime: 'pi',
				parentSessionId: 'parent-1',
				planMode: false,
				afkMode: false,
			}),
		).rejects.toThrow('pi is not ready');

		expect(setChatTabMetadata).toHaveBeenLastCalledWith(
			expect.objectContaining({
				id: 'tab-reused',
				metadata: { pinned: true },
			}),
		);
	});

	// The other half of that rollback. Reusing an already-marked tab writes
	// nothing, so clearing the marker on failure would strip a live sub-agent of
	// its role — and after a restart the depth counter reads it as a root, handing
	// back the whole surface the role policy exists to deny it.
	it('startConversation leaves a pre-existing sub-agent marker alone when the submit fails', async () => {
		const { deps } = makeDeps();
		(deps as { agentSessionService: unknown }).agentSessionService = {
			openSession: vi.fn().mockResolvedValue({ id: 'sess-2' }),
			submitPrompt: vi.fn().mockRejectedValue(new Error('pi is not ready')),
			stopSession: vi.fn().mockResolvedValue(undefined),
			setSessionName: vi.fn(),
			getSession: vi.fn(),
			listSessionsForWorkspace: () => [],
		};
		(deps as { piExecutableService: unknown }).piExecutableService = {
			getSnapshot: vi
				.fn()
				.mockResolvedValue({ status: 'ready', command: 'pi' }),
		};
		vi.mocked(getChatTabById).mockReturnValue({
			metadata: { agentRole: 'subagent', pinned: true },
			workspaceId: 'ws',
		} as unknown as ReturnType<typeof getChatTabById>);
		const ports = createAgentControlPorts(deps);

		await expect(
			ports.conversations.startConversation({
				workspaceId: 'ws',
				workspaceCwd: '/ws',
				chatTabId: 'tab-already-subagent',
				prompt: 'do it',
				asPeer: false,
				callerConcierge: false,
				callerRuntime: 'pi',
				parentSessionId: 'parent-1',
				planMode: false,
				afkMode: false,
			}),
		).rejects.toThrow('pi is not ready');

		expect(setChatTabMetadata).not.toHaveBeenCalled();
	});
});

describe('agent-control port adapters: reopening a closed chat tab', () => {
	const asRow = (
		value: Record<string, unknown> | null,
	): ReturnType<typeof getChatTabById> =>
		value as unknown as ReturnType<typeof getChatTabById>;

	const closedChatRow = (overrides: Record<string, unknown> = {}) =>
		openChatRow({ closedAt: '2026-09-01T00:00:00.000Z', ...overrides });

	const withSession = (deps: PortAdapterDeps, submitPrompt = vi.fn()) => {
		(deps as { agentSessionService: unknown }).agentSessionService = {
			getSession: vi.fn(() => ({ status: 'idle', workspaceId: 'ws' })),
			submitPrompt,
		};
		return submitPrompt;
	};

	beforeEach(() => {
		vi.mocked(getChatTabByAgentSessionId).mockReset();
		vi.mocked(getChatTabByAgentSessionId).mockReturnValue(asRow(null));
	});

	it('reopens the closed chat a follow-up steers, before submitting the prompt', async () => {
		vi.mocked(getChatTabByAgentSessionId).mockReturnValue(
			asRow(closedChatRow({ agentSessionId: 'sess-1' })),
		);
		const { deps, broadcastTabsChanged, restoreTab } = makeDeps();
		const submitPrompt = withSession(deps);
		const ports = createAgentControlPorts(deps);

		await ports.conversations.sendFollowUp({
			agentSessionId: 'sess-1',
			prompt: 'keep going',
		});

		expect(restoreTab).toHaveBeenCalledWith({ chatTabId: 'tab-1' });
		expect(broadcastTabsChanged).toHaveBeenCalledWith({ workspaceId: 'ws' });
		expect(restoreTab.mock.invocationCallOrder[0]).toBeLessThan(
			submitPrompt.mock.invocationCallOrder[0],
		);
	});

	it('leaves a chat that is already open alone', async () => {
		vi.mocked(getChatTabByAgentSessionId).mockReturnValue(
			asRow(openChatRow({ agentSessionId: 'sess-1' })),
		);
		const { deps, broadcastTabsChanged, restoreTab } = makeDeps();
		const submitPrompt = withSession(deps);
		const ports = createAgentControlPorts(deps);

		await ports.conversations.sendFollowUp({
			agentSessionId: 'sess-1',
			prompt: 'keep going',
		});

		expect(restoreTab).not.toHaveBeenCalled();
		expect(broadcastTabsChanged).not.toHaveBeenCalled();
		expect(submitPrompt).toHaveBeenCalled();
	});

	it('leaves a closed terminal tab shut, since only the renderer can respawn its harness', async () => {
		vi.mocked(getChatTabByAgentSessionId).mockReturnValue(
			asRow(closedChatRow({ agentSessionId: 'sess-1', kind: 'terminal' })),
		);
		const { deps, broadcastTabsChanged, restoreTab } = makeDeps();
		const submitPrompt = withSession(deps);
		const ports = createAgentControlPorts(deps);

		await ports.conversations.sendFollowUp({
			agentSessionId: 'sess-1',
			prompt: 'keep going',
		});

		expect(restoreTab).not.toHaveBeenCalled();
		expect(broadcastTabsChanged).not.toHaveBeenCalled();
		expect(submitPrompt).toHaveBeenCalled();
	});

	it('still steers the conversation when the tab cannot be reopened', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.mocked(getChatTabByAgentSessionId).mockReturnValue(
			asRow(closedChatRow({ agentSessionId: 'sess-1' })),
		);
		const { deps, broadcastTabsChanged, restoreTab } = makeDeps();
		restoreTab.mockImplementation(() => {
			throw new Error('database is closed');
		});
		const submitPrompt = withSession(deps);
		const ports = createAgentControlPorts(deps);

		await ports.conversations.sendFollowUp({
			agentSessionId: 'sess-1',
			prompt: 'keep going',
		});

		expect(submitPrompt).toHaveBeenCalledWith({
			prompt: 'keep going',
			sessionId: 'sess-1',
			streamingBehavior: undefined,
		});
		expect(broadcastTabsChanged).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});

	it('steers a conversation whose tab has gone', async () => {
		const { deps, broadcastTabsChanged, restoreTab } = makeDeps();
		const submitPrompt = withSession(deps);
		const ports = createAgentControlPorts(deps);

		await ports.conversations.sendFollowUp({
			agentSessionId: 'sess-1',
			prompt: 'keep going',
		});

		expect(restoreTab).not.toHaveBeenCalled();
		expect(broadcastTabsChanged).not.toHaveBeenCalled();
		expect(submitPrompt).toHaveBeenCalled();
	});

	it('reopens a closed chat before focusing it', () => {
		vi.mocked(getChatTabById).mockReturnValue(asRow(closedChatRow()));
		const { deps, broadcastFocus, broadcastTabsChanged, restoreTab } =
			makeDeps();
		const ports = createAgentControlPorts(deps);

		ports.focus.focusTab({ workspaceId: 'ws', chatTabId: 'tab-1' });

		expect(restoreTab).toHaveBeenCalledWith({ chatTabId: 'tab-1' });
		expect(broadcastTabsChanged.mock.invocationCallOrder[0]).toBeLessThan(
			broadcastFocus.mock.invocationCallOrder[0],
		);
		expect(broadcastFocus).toHaveBeenCalledWith({
			target: { chatTabId: 'tab-1', kind: 'tab' },
			workspaceId: 'ws',
		});
	});

	it('focuses an open tab without reopening anything', () => {
		vi.mocked(getChatTabById).mockReturnValue(asRow(openChatRow()));
		const { deps, broadcastFocus, restoreTab } = makeDeps();
		const ports = createAgentControlPorts(deps);

		ports.focus.focusTab({ workspaceId: 'ws', chatTabId: 'tab-1' });

		expect(restoreTab).not.toHaveBeenCalled();
		expect(broadcastFocus).toHaveBeenCalledWith({
			target: { chatTabId: 'tab-1', kind: 'tab' },
			workspaceId: 'ws',
		});
	});

	it('still focuses, without reopening, an archived chat whose session an open tab now holds', () => {
		vi.mocked(getChatTabById).mockReturnValue(
			asRow(closedChatRow({ agentSessionId: 'sess-1' })),
		);
		vi.mocked(getChatTabByAgentSessionId).mockReturnValue(
			asRow(openChatRow({ agentSessionId: 'sess-1', id: 'tab-2' })),
		);
		const { deps, broadcastFocus, broadcastTabsChanged, restoreTab } =
			makeDeps();
		const ports = createAgentControlPorts(deps);

		ports.focus.focusTab({ workspaceId: 'ws', chatTabId: 'tab-1' });

		expect(restoreTab).not.toHaveBeenCalled();
		expect(broadcastTabsChanged).not.toHaveBeenCalled();
		expect(broadcastFocus).toHaveBeenCalledWith({
			target: { chatTabId: 'tab-1', kind: 'tab' },
			workspaceId: 'ws',
		});
	});

	it('leaves a closed diff tab shut, since only a chat is reopened', () => {
		vi.mocked(getChatTabById).mockReturnValue(
			asRow(closedChatRow({ kind: 'diff' })),
		);
		const { deps, broadcastFocus, broadcastTabsChanged, restoreTab } =
			makeDeps();
		const ports = createAgentControlPorts(deps);

		ports.focus.focusTab({ workspaceId: 'ws', chatTabId: 'tab-1' });

		expect(restoreTab).not.toHaveBeenCalled();
		expect(broadcastTabsChanged).not.toHaveBeenCalled();
		expect(broadcastFocus).toHaveBeenCalledWith({
			target: { chatTabId: 'tab-1', kind: 'tab' },
			workspaceId: 'ws',
		});
	});

	it('reopens an archived chat when the only other tab naming its session is closed too', () => {
		vi.mocked(getChatTabById).mockReturnValue(
			asRow(closedChatRow({ agentSessionId: 'sess-1' })),
		);
		vi.mocked(getChatTabByAgentSessionId).mockReturnValue(
			asRow(closedChatRow({ agentSessionId: 'sess-1', id: 'tab-2' })),
		);
		const { deps, broadcastTabsChanged, restoreTab } = makeDeps();
		const ports = createAgentControlPorts(deps);

		ports.focus.focusTab({ workspaceId: 'ws', chatTabId: 'tab-1' });

		expect(restoreTab).toHaveBeenCalledWith({ chatTabId: 'tab-1' });
		expect(broadcastTabsChanged).toHaveBeenCalledWith({ workspaceId: 'ws' });
	});
});

describe('agent-control port adapters: branch naming', () => {
	const origin = {
		delegation: 'ensemblr' as const,
		concierge: false,
		retired: false,
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
			changed: true,
			diagnostics: [],
			status: 'success',
			workspace: {
				branchName: 'octocat/add-dark-mode',
				name: 'add-dark-mode',
			},
		});
		Object.assign(deps, {
			appSettingsService: {
				read: () => ({
					experimental: { architectureDiagram: true },
					git: { renameWorkspaceOnBranch },
				}),
			},
			agentSessionService: { appendWorkspaceRenamed: vi.fn() },
			renameWorkspace,
		});
		vi.mocked(selectWorkspaceWithRepositoryById).mockReturnValue({
			branchName: 'octocat/bach',
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
			userRequested: false,
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
			userRequested: false,
		});

		expect(renameWorkspace).not.toHaveBeenCalled();
		expect(result).toMatchObject({ applied: false, name: 'bach' });
		expect(result.message).toContain('do not call this tool again');
		expect(broadcastTabsChanged).not.toHaveBeenCalled();
	});
});

describe('agent-control port adapters: diagram upkeep', () => {
	const origin = {
		delegation: 'ensemblr' as const,
		concierge: false,
		retired: false,
		depth: 0,
		parentSessionId: null,
		sessionId: 'sess-1',
		species: 'pi' as const,
		token: 'tok',
		workspaceCwd: '/ws',
		workspaceId: 'ws',
	};

	let workspaceCwd: string;

	beforeEach(async () => {
		workspaceCwd = await mkdtemp(path.join(tmpdir(), 'diagram-port-'));
	});

	afterEach(async () => {
		await rm(workspaceCwd, { force: true, recursive: true });
	});

	/** Stores a diagram in the temp workspace, so the first gate lets a read past. */
	async function storeDiagram(): Promise<void> {
		await mkdir(path.join(workspaceCwd, '.ensemblr'), { recursive: true });
		await writeFile(
			path.join(workspaceCwd, '.ensemblr', 'architecture.json'),
			JSON.stringify({
				generatedAt: '2026-09-01T12:00:00.000Z',
				ir: {
					boundaries: [],
					components: [
						{
							id: 'storage',
							label: 'storage',
							sources: [{ path: 'src' }],
							type: 'database',
						},
					],
					connections: [],
					meta: { title: 'repo' },
					schemaVersion: 1,
				},
			}),
			'utf8',
		);
	}

	const withCaller = (
		overrides: Partial<typeof origin> & { depth?: number } = {},
	) => {
		const { deps } = makeDeps();
		const listChangedPaths = vi.fn().mockResolvedValue([]);
		Object.assign(deps, {
			appSettingsService: {
				read: () => ({
					experimental: { architectureDiagram: true },
					git: { renameWorkspaceOnBranch: true },
				}),
			},
			workspaceGitService: { listChangedPaths },
		});
		vi.mocked(selectWorkspaceWithRepositoryById).mockReturnValue({
			branchName: 'octocat/bach',
			metadataJson: '{}',
			name: 'bach',
			path: workspaceCwd,
		} as ReturnType<typeof selectWorkspaceWithRepositoryById>);
		return {
			listChangedPaths,
			ports: createAgentControlPorts(deps),
			origin: { ...origin, ...overrides },
		};
	};

	it('reads the change set for a root that may redraw', async () => {
		await storeDiagram();
		const { listChangedPaths, ports, origin: caller } = withCaller();

		await ports.sessionNaming.readBrief(caller);

		expect(listChangedPaths).toHaveBeenCalledWith(workspaceCwd);
	});

	// The whole point of the first gate: a workspace nobody has drawn must not be
	// nudged into having a diagram, and must not pay for a git read to find out.
	it('never reads the change set for a workspace with no diagram', async () => {
		const { listChangedPaths, ports, origin: caller } = withCaller();

		const brief = await ports.sessionNaming.readBrief(caller);

		expect(listChangedPaths).not.toHaveBeenCalled();
		expect(brief.diagram).toEqual({ components: [], stale: false });
	});

	// Both diagram ops are refused for the Concierge, so a bullet asking it to
	// redraw would only spend a turn discovering the denial.
	it('never reads the change set for the Concierge', async () => {
		await storeDiagram();
		const {
			listChangedPaths,
			ports,
			origin: caller,
		} = withCaller({
			concierge: true,
		});

		const brief = await ports.sessionNaming.readBrief(caller);

		expect(listChangedPaths).not.toHaveBeenCalled();
		expect(brief.diagram).toEqual({ components: [], stale: false });
	});

	it('never reads the change set for a spawned child', async () => {
		await storeDiagram();
		const {
			listChangedPaths,
			ports,
			origin: caller,
		} = withCaller({ depth: 1 });

		const brief = await ports.sessionNaming.readBrief(caller);

		expect(listChangedPaths).not.toHaveBeenCalled();
		expect(brief.diagram).toEqual({ components: [], stale: false });
	});

	// The brief builds a turn's system prompt, so an unreadable workspace row is
	// a reason to say nothing about the diagram rather than to fail the turn.
	it('reports nothing outstanding when the workspace row cannot be read', async () => {
		await storeDiagram();
		const { listChangedPaths, ports, origin: caller } = withCaller();
		vi.mocked(selectWorkspaceWithRepositoryById).mockImplementation(() => {
			throw new Error('storage is down');
		});

		const brief = await ports.sessionNaming.readBrief(caller);

		expect(listChangedPaths).not.toHaveBeenCalled();
		expect(brief.diagram).toEqual({ components: [], stale: false });
	});
});

describe('agent-control port adapters: last message', () => {
	const agentMessage = (text: string): AgentPersistedEnvelope => ({
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

	const userPrompt = (text: string): AgentPersistedEnvelope => ({
		kind: 'message',
		role: 'user',
		payload: { kind: 'prompt', prompt: text },
	});

	const withPayloads = (
		payloads: readonly (AgentPersistedEnvelope | null)[],
	) => {
		const { deps } = makeDeps();
		(deps as { agentSessionService: unknown }).agentSessionService = {
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

	it('joins every assistant message of the final turn in the order it was written', async () => {
		const ports = withPayloads([
			{ kind: 'status', previous: 'idle', status: 'idle' },
			agentMessage('Report delivered above.'),
			agentMessage('The full findings.'),
			userPrompt('investigate the backend'),
		]);
		const result = await ports.conversations.getLastMessage('sess-1');
		expect(result).toBe('The full findings.\n\nReport delivered above.');
	});

	it('stops at the prompt that opened the final turn, leaving earlier turns out', async () => {
		const ports = withPayloads([
			agentMessage('this turn'),
			userPrompt('the follow-up'),
			agentMessage('the previous turn'),
			userPrompt('the first prompt'),
		]);
		const result = await ports.conversations.getLastMessage('sess-1');
		expect(result).toBe('this turn');
	});

	it('falls back to the newest turn that answered when the final one has not yet', async () => {
		const ports = withPayloads([
			userPrompt('the follow-up it is still working on'),
			agentMessage('the report it already filed'),
			userPrompt('the first prompt'),
		]);
		const result = await ports.conversations.getLastMessage('sess-1');
		expect(result).toBe('the report it already filed');
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

	it('sheds the oldest messages of a turn that runs past the report ceiling', async () => {
		const filler = 'x'.repeat(11_000);
		const ports = withPayloads([
			agentMessage('the answer'),
			agentMessage(filler),
			agentMessage(filler),
			agentMessage(filler),
			agentMessage('the narration that opened the turn'),
			userPrompt('do the work'),
		]);
		const result = await ports.conversations.getLastMessage('sess-1');
		expect(result).toContain('the answer');
		expect(result).not.toContain('the narration that opened the turn');
		expect((result ?? '').length).toBeLessThanOrEqual(32_000);
	});

	// The ceiling exists so one child cannot flood its orchestrator's context from a
	// single pasted tool result, which it could while the newest message skipped the
	// cap. A report states its answer first, so the clamp keeps the opening.
	it('clamps a single answer that busts the ceiling on its own', async () => {
		const huge = `the answer${'y'.repeat(40_000)}`;
		const ports = withPayloads([agentMessage(huge), userPrompt('do the work')]);
		const result = await ports.conversations.getLastMessage('sess-1');
		expect(result).toHaveLength(32_000);
		expect(result).toBe(huge.slice(0, 32_000));
	});

	it('returns null for an unknown session', async () => {
		const { deps } = makeDeps();
		(deps as { agentSessionService: unknown }).agentSessionService = {
			getSession: vi.fn(() => undefined),
			iterateEventPayloadsDescending: vi.fn(() => []),
		};
		const ports = createAgentControlPorts(deps);
		const result = await ports.conversations.getLastMessage('gone');
		expect(result).toBeNull();
	});
});

describe('agent-control port adapters: readTranscript', () => {
	const prompt = (text: string): AgentPersistedEnvelope => ({
		kind: 'message',
		payload: { kind: 'prompt', prompt: text },
		role: 'user',
	});

	const answer = (text: string): AgentPersistedEnvelope => ({
		kind: 'message',
		payload: { kind: 'text', text },
		role: 'agent',
	});

	const withEvents = (
		events: readonly { ordinal: number; payload: AgentPersistedEnvelope }[],
		session: { branchId: string } | null = { branchId: 'branch-1' },
	) => {
		const listEvents = vi.fn(() =>
			events.map((event) => ({ ...event, stream: 'protocol' as const })),
		);
		const { deps } = makeDeps();
		(deps as { agentSessionService: unknown }).agentSessionService = {
			getSession: vi.fn(() => session),
			listEvents,
		};
		return { listEvents, ports: createAgentControlPorts(deps) };
	};

	it('projects the session’s branch into a transcript page', async () => {
		const { listEvents, ports } = withEvents([
			{ ordinal: 1, payload: prompt('audit the parser') },
			{ ordinal: 2, payload: answer('parser looks sound') },
		]);

		const result = await ports.conversations.readTranscript({
			agentSessionId: 'sess-1',
		});

		expect(listEvents).toHaveBeenCalledWith('branch-1');
		expect(result.entries).toEqual([
			{ kind: 'prompt', ordinal: 1, text: 'audit the parser' },
			{ kind: 'message', ordinal: 2, text: 'parser looks sound' },
		]);
		expect(result.agentSessionId).toBe('sess-1');
		expect(result.turnCount).toBe(1);
	});

	it('forwards the read mode rather than always paging from the start', async () => {
		const { ports } = withEvents([
			{ ordinal: 1, payload: prompt('go') },
			{ ordinal: 2, payload: answer('done') },
		]);

		const result = await ports.conversations.readTranscript({
			agentSessionId: 'sess-1',
			stat: true,
		});

		expect(result.entries).toEqual([]);
		expect(result.entryCount).toBe(2);
	});

	// An auditor has to be able to tell a child that did nothing from a call that
	// failed, so a session the app no longer knows reads as an empty branch.
	it('reads an unknown session as an empty branch', async () => {
		const { listEvents, ports } = withEvents([], null);

		const result = await ports.conversations.readTranscript({
			agentSessionId: 'gone',
		});

		expect(listEvents).not.toHaveBeenCalled();
		expect(result).toEqual({
			entries: [],
			entryCount: 0,
			firstOrdinal: null,
			lastOrdinal: null,
			nextOrdinal: null,
			agentSessionId: 'gone',
			turnCount: 0,
		});
	});
});

describe('agent-control port adapters: sub-agent marker', () => {
	const tab = (metadata: Record<string, unknown>) =>
		({ id: 'tab-1', metadata }) as ReturnType<
			typeof getChatTabByAgentSessionId
		>;

	beforeEach(() => {
		vi.mocked(getChatTabByAgentSessionId).mockReset();
	});

	it('reports the marker a spawn stamped on the session’s tab', async () => {
		vi.mocked(getChatTabByAgentSessionId).mockReturnValue(
			tab({ agentRole: 'subagent' }),
		);
		const { deps } = makeDeps();
		const ports = createAgentControlPorts(deps);
		expect(await ports.conversations.isSpawnedSubAgent?.('sess-1')).toBe(true);
		expect(getChatTabByAgentSessionId).toHaveBeenCalledWith(
			expect.objectContaining({ agentSessionId: 'sess-1' }),
		);
	});

	it('reports no marker for a tab that was never spawned into', async () => {
		vi.mocked(getChatTabByAgentSessionId).mockReturnValue(tab({}));
		const { deps } = makeDeps();
		const ports = createAgentControlPorts(deps);
		expect(await ports.conversations.isSpawnedSubAgent?.('sess-1')).toBe(false);
	});

	it('reports no marker for a session with no tab', async () => {
		vi.mocked(getChatTabByAgentSessionId).mockReturnValue(null);
		const { deps } = makeDeps();
		const ports = createAgentControlPorts(deps);
		expect(await ports.conversations.isSpawnedSubAgent?.('gone')).toBe(false);
	});

	// Role resolution falls back to live lineage when the marker cannot be read, so
	// a storage failure must not throw out of the plan-mode gate.
	it('reports no marker when the read fails', async () => {
		vi.mocked(getChatTabByAgentSessionId).mockImplementation(() => {
			throw new Error('database is closed');
		});
		const { deps } = makeDeps();
		const ports = createAgentControlPorts(deps);
		expect(await ports.conversations.isSpawnedSubAgent?.('sess-1')).toBe(false);
	});
});

describe('agent-control port adapters: conversation status', () => {
	const withStatus = (
		snapshot: unknown,
		payloads: readonly (AgentPersistedEnvelope | null)[] = [],
	) => {
		const { deps } = makeDeps();
		(deps as { agentSessionService: unknown }).agentSessionService = {
			getSession: vi.fn(() => snapshot),
			iterateEventPayloadsDescending: vi.fn(() => payloads),
		};
		return createAgentControlPorts(deps);
	};

	it('returns the live snapshot without scanning persisted events', async () => {
		const { deps } = makeDeps();
		const iterateEventPayloadsDescending = vi.fn(() => []);
		(deps as { agentSessionService: unknown }).agentSessionService = {
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
			agentSessionId: 'sess-1',
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

/** Builds a run-script definition with the fields the terminal port reads. */
const runScript = (
	name: string,
	command: string,
	isDefault = false,
): RunScriptDefinition => ({
	availableIn: null,
	command,
	icon: DEFAULT_RUN_SCRIPT_ICON,
	isDefault,
	name,
});

/**
 * Builds ports over a script-lifecycle stub, so the terminal port's own mapping
 * is what the assertions see.
 */
const withScripts = (script: {
	listRunScripts?: readonly RunScriptDefinition[];
	runScript?: CreateTerminalSessionResult;
}): ReturnType<typeof createAgentControlPorts> => {
	const { deps } = makeDeps();
	return createAgentControlPorts({
		...deps,
		scriptLifecycleService: {
			listRunScripts: () => script.listRunScripts ?? [],
			runScript: async () =>
				script.runScript ?? { diagnostics: [], session: null },
		},
	} as unknown as PortAdapterDeps);
};

describe('agent-control port adapters: run scripts', () => {
	it('marks the script the repository flags as default', async () => {
		const ports = withScripts({
			listRunScripts: [
				runScript('dev', 'npm run dev'),
				runScript('playground', 'npm run dev:playground', true),
			],
		});
		expect(await ports.terminals.listRunScripts({ workspaceId: 'ws' })).toEqual(
			{
				scripts: [
					{ command: 'npm run dev', isDefault: false, name: 'dev' },
					{
						command: 'npm run dev:playground',
						isDefault: true,
						name: 'playground',
					},
				],
			},
		);
	});

	// The effective default is what `startTerminal` runs with no name, which is
	// the first declared script when the repository flags none — so reporting
	// every script as non-default would tell an agent nothing would start.
	it('falls back to the first declared script when none is flagged', async () => {
		const ports = withScripts({
			listRunScripts: [
				runScript('dev', 'npm run dev'),
				runScript('playground', 'npm run dev:playground'),
			],
		});
		const { scripts } = await ports.terminals.listRunScripts({
			workspaceId: 'ws',
		});
		expect(scripts.map((script) => [script.name, script.isDefault])).toEqual([
			['dev', true],
			['playground', false],
		]);
	});

	it('reports no scripts, and so no default, for a repository configuring none', async () => {
		const ports = withScripts({ listRunScripts: [] });
		expect(await ports.terminals.listRunScripts({ workspaceId: 'ws' })).toEqual(
			{
				scripts: [],
			},
		);
	});

	it('returns the session id when the run script starts', async () => {
		const ports = withScripts({
			runScript: {
				diagnostics: [],
				session: { id: 'term-1' } as CreateTerminalSessionResult['session'],
			},
		});
		expect(
			await ports.terminals.startTerminal({
				kind: 'run',
				scriptName: 'playground',
				workspaceCwd: '/tmp/ws',
				workspaceId: 'ws',
			}),
		).toEqual({ ok: true, terminalId: 'term-1' });
	});

	// A launch that starts nothing used to answer with an empty terminal id,
	// which reads as success to every caller that only checks for a throw.
	it('surfaces the lifecycle diagnostic when no session starts', async () => {
		const ports = withScripts({
			runScript: {
				diagnostics: [
					{
						code: 'script-not-configured',
						message:
							'No run script named "ghost" is configured for this repository. Configured run scripts: dev.',
						severity: 'info',
					},
				],
				session: null,
			},
		});
		expect(
			await ports.terminals.startTerminal({
				kind: 'run',
				scriptName: 'ghost',
				workspaceCwd: '/tmp/ws',
				workspaceId: 'ws',
			}),
		).toEqual({
			ok: false,
			code: 'script-not-configured',
			message:
				'No run script named "ghost" is configured for this repository. Configured run scripts: dev.',
		});
	});

	it('falls back to a kind-specific message when a failure carries no diagnostic', async () => {
		const ports = withScripts({
			runScript: { diagnostics: [], session: null },
		});
		expect(
			await ports.terminals.startTerminal({
				kind: 'setup',
				workspaceCwd: '/tmp/ws',
				workspaceId: 'ws',
			}),
		).toEqual({
			ok: false,
			code: 'terminal-not-started',
			message: 'The setup script could not be started.',
		});
	});

	// The lifecycle service knows which session refused the launch. Dropping it
	// here is what left a caller with a conflict it could not act on.
	it('carries the colliding terminal id out of the refusal', async () => {
		const ports = withScripts({
			runScript: {
				diagnostics: [
					{
						code: 'script-already-running',
						message: 'The run script "dev" is already running.',
						severity: 'warning',
						terminalId: 'term-dev',
					},
				],
				session: null,
			},
		});
		expect(
			await ports.terminals.startTerminal({
				kind: 'run',
				workspaceCwd: '/tmp/ws',
				workspaceId: 'ws',
			}),
		).toMatchObject({ ok: false, terminalId: 'term-dev' });
	});
});

/**
 * Builds ports over a terminal-service stub holding one session's scrollback.
 */
const withScrollback = (
	scrollback: string | null,
): ReturnType<typeof createAgentControlPorts> => {
	const { deps } = makeDeps();
	return createAgentControlPorts({
		...deps,
		terminalService: { getSnapshot: () => ({ scrollback, session: null }) },
	} as unknown as PortAdapterDeps);
};

const ESC = String.fromCharCode(27);

describe('agent-control port adapters: terminal output', () => {
	it('renders scrollback readable by default', async () => {
		const ports = withScrollback(
			`${ESC}[32mLocal${ESC}[39m: http://localhost:5199/\r\n`,
		);
		expect(
			await ports.terminals.readOutput({ ansi: false, terminalId: 'term-1' }),
		).toBe('Local: http://localhost:5199/');
	});

	it('hands back the raw bytes when the caller asks for ansi', async () => {
		const raw = `${ESC}[32mLocal${ESC}[39m: http://localhost:5199/\r\n`;
		const ports = withScrollback(raw);
		expect(
			await ports.terminals.readOutput({ ansi: true, terminalId: 'term-1' }),
		).toBe(raw);
	});

	it('reports a buffer of nothing but escapes as no output', async () => {
		const ports = withScrollback(`${ESC}[2J${ESC}[H`);
		expect(
			await ports.terminals.readOutput({ ansi: false, terminalId: 'term-1' }),
		).toBeNull();
	});
});
