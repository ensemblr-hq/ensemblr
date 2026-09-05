import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAgentControlPorts } from '../../src/main/agent-control/index.ts';
import type { PortAdapterDeps } from '../../src/main/agent-control/port-adapters.ts';
import {
	fakeSpawnModelResolver,
	modelOption,
} from './support/spawn-model-resolver.ts';

vi.mock('../../src/main/storage/repositories/chat-tab-repository.ts', () => ({
	getChatTabById: vi.fn(() => ({ id: 'tab-1', metadata: {} })),
	getChatTabByAgentSessionId: vi.fn(() => null),
	setChatTabMetadata: vi.fn(),
}));

/**
 * Builds spawn deps that record every collaborator call into one ordered log, so
 * a test can assert not just that AFK was registered but *when*. The mirror of
 * `plan-mode-spawn-inheritance.test.ts`, because the two inherit down the same
 * path and the ordering that matters is the same one.
 */
const makeDeps = () => {
	const calls: string[] = [];
	const activateForSpawn = vi.fn(() => {
		calls.push('activateForSpawn');
	});
	const broadcastAfkMode = vi.fn(() => {
		calls.push('broadcastAfkMode');
	});
	const submitPrompt = vi.fn(async () => {
		calls.push('submitPrompt');
		return {};
	});
	const deps = {
		databaseService: { getConnection: () => ({ database: {} }) },
		chatTabService: {
			claimIdleChatTab: vi.fn(() => null),
			openTab: vi.fn(() => ({ id: 'tab-1', metadata: {} })),
			closeTab: vi.fn(),
		},
		agentSessionService: {
			openSession: vi.fn(async () => {
				calls.push('openSession');
				return { id: 'agent-child', status: 'starting' };
			}),
			submitPrompt,
			getSession: vi.fn(() => null),
			listSessionsForWorkspace: vi.fn(() => []),
		},
		terminalService: {},
		scriptLifecycleService: {},
		harnessDetectionService: {},
		piExecutableService: {
			getSnapshot: vi.fn(async () => ({ status: 'ready', command: 'pi' })),
		},
		spawnModelResolver: fakeSpawnModelResolver([
			modelOption({ id: 'anthropic/sonnet', runtime: 'pi' }),
		]),
		getPermissionMode: () => 'workspace-trusted',
		augmentHarnessCommand: (command: string) => command,
		broadcastFocus: vi.fn(),
		broadcastTabsChanged: vi.fn(),
		broadcastPlanMode: vi.fn(),
		broadcastAfkMode,
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
			activateForSpawn,
			isActive: vi.fn(() => false),
			releaseSession: vi.fn(),
		},
	} as unknown as PortAdapterDeps;
	return { activateForSpawn, broadcastAfkMode, calls, deps };
};

const spawn = (deps: PortAdapterDeps, afkMode: boolean, chatTabId?: string) =>
	createAgentControlPorts(deps).conversations.startConversation({
		afkMode,
		asPeer: false,
		callerConcierge: false,
		callerRuntime: 'pi',
		chatTabId,
		parentSessionId: 'parent',
		planMode: false,
		prompt: 'get it done',
		workspaceCwd: '/ws',
		workspaceId: 'ws',
	});

describe('afk mode: spawn inheritance', () => {
	let built: ReturnType<typeof makeDeps>;

	beforeEach(() => {
		built = makeDeps();
	});

	it('registers the child as unattended when it inherits AFK', async () => {
		await spawn(built.deps, true);

		expect(built.activateForSpawn).toHaveBeenCalledTimes(1);
		expect(built.activateForSpawn).toHaveBeenCalledWith('agent-child');
	});

	// The child is a separate process and can ask the app for its brief before
	// `submitPrompt` resolves in main. Registering after that would hand it a turn
	// with the ask tool live, which is the one thing an unattended spawn must not
	// have.
	it('registers AFK before the prompt reaches the child', async () => {
		await spawn(built.deps, true);

		expect(built.calls).toEqual([
			'openSession',
			'activateForSpawn',
			'broadcastAfkMode',
			'submitPrompt',
		]);
	});

	it('leaves an attended spawn untouched', async () => {
		await spawn(built.deps, false);

		expect(built.activateForSpawn).not.toHaveBeenCalled();
		expect(built.broadcastAfkMode).not.toHaveBeenCalled();
	});

	it('tells the renderer which chat tab now hosts an unattended session', async () => {
		await spawn(built.deps, true);

		expect(built.broadcastAfkMode).toHaveBeenCalledWith({
			afkMode: true,
			agentSessionId: 'agent-child',
			chatTabId: 'tab-1',
			workspaceId: 'ws',
		});
	});

	it('mirrors into a caller-supplied tab as well', async () => {
		await spawn(built.deps, true, 'caller-tab');

		expect(built.broadcastAfkMode).toHaveBeenCalledWith(
			expect.objectContaining({ chatTabId: 'caller-tab' }),
		);
	});
});
