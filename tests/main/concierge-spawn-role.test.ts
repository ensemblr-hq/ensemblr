import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
	BrowserWindow: { getFocusedWindow: () => null },
	dialog: { showMessageBox: vi.fn() },
}));

vi.mock('../../src/main/storage/repositories/chat-tab-repository.ts', () => ({
	getChatTabById: vi.fn(),
	getChatTabByAgentSessionId: vi.fn(() => null),
	setChatTabMetadata: vi.fn(),
}));

import {
	createAgentControlIntegration,
	createAgentControlPorts,
	createOriginRegistry,
	type PortAdapterDeps,
} from '../../src/main/agent-control/index.ts';
import {
	getChatTabById,
	setChatTabMetadata,
} from '../../src/main/storage/repositories/chat-tab-repository.ts';
import {
	fakeSpawnModelResolver,
	modelOption,
} from './support/spawn-model-resolver.ts';

const WORKSPACE = 'ws-1';
const CWD = '/tmp/ws-1';
const CONCIERGE_CWD = '/tmp/root/concierge';
const PI_MODEL = 'anthropic/sonnet';
const CONCIERGE_MODEL = 'anthropic/opus';

/**
 * A chat-tab metadata store the mocked repository reads and writes, so the
 * marker a spawn stamps is the same one the role overlay reads back. A map
 * rather than a stub return value: the point of the test is that one write is
 * observed by a second reader.
 */
const createTabStore = (seed: Record<string, Record<string, unknown>> = {}) => {
	const tabs = new Map<string, Record<string, unknown>>(
		Object.entries(seed).map(([id, metadata]) => [id, { ...metadata }]),
	);
	vi.mocked(getChatTabById).mockImplementation(({ id }) =>
		tabs.has(id)
			? ({
					agentSessionId: null,
					closedAt: null,
					id,
					kind: 'chat',
					metadata: tabs.get(id),
					workspaceId: WORKSPACE,
				} as unknown as ReturnType<typeof getChatTabById>)
			: null,
	);
	vi.mocked(setChatTabMetadata).mockImplementation(({ id, metadata }) => {
		tabs.set(id, { ...(metadata as Record<string, unknown>) });
		return undefined as unknown as ReturnType<typeof setChatTabMetadata>;
	});
	return {
		/** Registers a tab the chat-tab service opened, so the marker has a row. */
		open: (id: string) => {
			tabs.set(id, {});
			return { id };
		},
		/** The role the tab carries now, as `isTabMarkedSubAgent` reads it. */
		roleOf: (id: string) => tabs.get(id)?.agentRole ?? null,
	};
};

/** Port-adapter deps with the collaborators a spawn touches, and nothing else. */
const makeDeps = (
	tabs: ReturnType<typeof createTabStore>,
	options: { conciergeModel?: string | null } = {},
): PortAdapterDeps =>
	({
		agentSessionService: {
			getSession: vi.fn(() => null),
			listSessionsForWorkspace: () => [],
			openSession: vi.fn(async () => ({ id: 'child-session' })),
			setSessionName: vi.fn(async () => ({ applied: true })),
			submitPrompt: vi.fn(async () => ({})),
		},
		broadcastFocus: vi.fn(),
		broadcastPlanMode: vi.fn(),
		broadcastTabsChanged: vi.fn(),
		chatTabService: {
			claimIdleChatTab: vi.fn(() => null),
			closeTab: vi.fn(),
			listTabs: vi.fn(),
			openTab: vi.fn(() => tabs.open('tab-opened')),
		},
		conciergePorts: {
			concierge: {
				describeSession: () =>
					options.conciergeModel === undefined
						? { model: CONCIERGE_MODEL, thinkingLevel: null }
						: options.conciergeModel === null
							? null
							: { model: options.conciergeModel, thinkingLevel: null },
				homePath: () => CONCIERGE_CWD,
			},
			memory: { recall: vi.fn() },
			workspaceCreation: { createWorkspace: vi.fn() },
		},
		databaseService: { getConnection: () => ({ database: {} }) },
		piExecutableService: {
			getSnapshot: vi.fn(async () => ({ command: 'pi', status: 'ready' })),
		},
		planMode: {
			activateForSpawn: vi.fn(),
			exit: vi.fn(),
			hasSubmittedPlan: vi.fn(() => false),
			isActive: vi.fn(() => false),
			releaseSession: vi.fn(),
		},
		spawnModelResolver: fakeSpawnModelResolver([
			modelOption({ id: PI_MODEL, runtime: 'pi' }),
			modelOption({ id: CONCIERGE_MODEL, runtime: 'pi' }),
		]),
	}) as unknown as PortAdapterDeps;

/** The env overlay, over a real registry whose depth comes from real lineage. */
const makeOverlay = (markedSubAgent: (sessionId: string) => boolean) => {
	const registry = createOriginRegistry({ generateToken: () => 'tok' });
	const { resolveAgentControlEnv } = createAgentControlIntegration({
		app: {
			getAppPath: () => process.cwd(),
			getPath: () => '/tmp/userData',
			isPackaged: false,
		} as never,
		getLanguage: () => 'en' as const,
		getServerUrl: () => 'http://127.0.0.1:1234',
		isSpawnedSubAgent: markedSubAgent,
		originRegistry: registry,
		resolveConciergeCwd: () => CONCIERGE_CWD,
		resolveWorkspaceCwd: (workspaceId) =>
			workspaceId === WORKSPACE ? CWD : null,
	});
	return { registry, resolveAgentControlEnv };
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe('a conversation the Concierge opens is a root orchestrator', () => {
	// The whole contract, across both axes that carry it: the spawn writes no
	// sub-agent marker, and the child registers at depth 0 behind its Concierge
	// parent — so the overlay it launches with says orchestrator.
	it('leaves the child unmarked and hands it the orchestrator role', async () => {
		const tabs = createTabStore();
		const ports = createAgentControlPorts(makeDeps(tabs));

		const outcome = await ports.conversations.startConversation({
			asPeer: false,
			callerConcierge: true,
			callerRuntime: 'pi',
			parentSessionId: 'concierge-1',
			planMode: false,
			prompt: 'take this on',
			workspaceCwd: CWD,
			workspaceId: WORKSPACE,
		});

		expect(outcome.ok).toBe(true);
		expect(tabs.roleOf('tab-opened')).toBeNull();

		const { resolveAgentControlEnv } = makeOverlay(
			() => tabs.roleOf('tab-opened') === 'subagent',
		);
		resolveAgentControlEnv({
			concierge: true,
			sessionId: 'concierge-1',
			species: 'pi',
			workspaceId: '',
		});
		expect(
			resolveAgentControlEnv({
				parentSessionId: 'concierge-1',
				sessionId: 'child-session',
				workspaceId: WORKSPACE,
			}).ENSEMBLR_CONTROL_ROLE,
		).toBe('orchestrator');
	});

	// A peer reaches the same answer by the other route: an ordinary orchestrator
	// opened it, but the user asked for a second orchestrator rather than a helper.
	// Both axes have to agree, and the lineage has to be absent rather than
	// exempted — depth is resolved from a parent this spawn deliberately does not
	// record, and `resolveDelegation` reads any parent at all as proof of a child.
	it('opens a peer as a root, recording no parent at all', async () => {
		const tabs = createTabStore();
		const deps = makeDeps(tabs);
		const ports = createAgentControlPorts(deps);

		const outcome = await ports.conversations.startConversation({
			asPeer: true,
			callerConcierge: false,
			callerRuntime: 'pi',
			parentSessionId: 'orchestrator-1',
			planMode: false,
			prompt: 'take the renderer half',
			title: 'Renderer half',
			workspaceCwd: CWD,
			workspaceId: WORKSPACE,
		});

		expect(outcome.ok).toBe(true);
		expect(tabs.roleOf('tab-opened')).toBeNull();
		expect(
			vi.mocked(deps.agentSessionService.openSession).mock.calls.at(0)?.[0],
		).not.toHaveProperty('parentSessionId');

		const { resolveAgentControlEnv } = makeOverlay(
			() => tabs.roleOf('tab-opened') === 'subagent',
		);
		expect(
			resolveAgentControlEnv({
				sessionId: 'child-session',
				workspaceId: WORKSPACE,
			}).ENSEMBLR_CONTROL_ROLE,
		).toBe('orchestrator');
	});

	// The regression that must survive the fix: an ordinary orchestrator still
	// produces a sub-agent, on both axes.
	it('still marks and demotes a child an orchestrator opens', async () => {
		const tabs = createTabStore();
		const ports = createAgentControlPorts(makeDeps(tabs));

		await ports.conversations.startConversation({
			asPeer: false,
			callerConcierge: false,
			callerRuntime: 'pi',
			parentSessionId: 'root-1',
			planMode: false,
			prompt: 'take this on',
			workspaceCwd: CWD,
			workspaceId: WORKSPACE,
		});

		expect(tabs.roleOf('tab-opened')).toBe('subagent');

		const { resolveAgentControlEnv } = makeOverlay(
			(sessionId) =>
				sessionId === 'child-session' &&
				tabs.roleOf('tab-opened') === 'subagent',
		);
		resolveAgentControlEnv({ sessionId: 'root-1', workspaceId: WORKSPACE });
		expect(
			resolveAgentControlEnv({
				parentSessionId: 'root-1',
				sessionId: 'child-session',
				workspaceId: WORKSPACE,
			}).ENSEMBLR_CONTROL_ROLE,
		).toBe('subagent');
	});

	// A tab handed back to the Concierge now hosts a root, so the marker its last
	// tenant left behind has to go — otherwise the marker axis outranks depth and
	// the child comes back a sub-agent on a tab that reads as one.
	it('clears a sub-agent marker off a chat tab the Concierge reuses', async () => {
		const tabs = createTabStore({
			'tab-reused': { agentRole: 'subagent', pinned: true },
		});
		const ports = createAgentControlPorts(makeDeps(tabs));

		await ports.conversations.startConversation({
			asPeer: false,
			callerConcierge: true,
			callerRuntime: 'pi',
			chatTabId: 'tab-reused',
			parentSessionId: 'concierge-1',
			planMode: false,
			prompt: 'take this on',
			workspaceCwd: CWD,
			workspaceId: WORKSPACE,
		});

		expect(tabs.roleOf('tab-reused')).toBeNull();
		expect(setChatTabMetadata).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'tab-reused', metadata: { pinned: true } }),
		);
	});

	// Rollback restores what the tab carried before the spawn touched it, rather
	// than assuming the previous role was the one this spawn was about to write.
	it('puts a reused tab’s marker back when the first prompt fails', async () => {
		const tabs = createTabStore({ 'tab-reused': { agentRole: 'subagent' } });
		const deps = makeDeps(tabs);
		Object.assign(deps.agentSessionService, {
			stopSession: vi.fn(async () => undefined),
			submitPrompt: vi.fn(async () => {
				throw new Error('pi is not ready');
			}),
		});
		const ports = createAgentControlPorts(deps);

		await expect(
			ports.conversations.startConversation({
				asPeer: false,
				callerConcierge: true,
				callerRuntime: 'pi',
				chatTabId: 'tab-reused',
				parentSessionId: 'concierge-1',
				planMode: false,
				prompt: 'take this on',
				workspaceCwd: CWD,
				workspaceId: WORKSPACE,
			}),
		).rejects.toThrow('pi is not ready');

		expect(tabs.roleOf('tab-reused')).toBe('subagent');
	});
});
