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
 * Builds spawn deps that record every collaborator call into one ordered log, so a
 * test can assert not just that Plan Mode was registered but *when*.
 */
const makeDeps = () => {
	const calls: string[] = [];
	const activateForSpawn = vi.fn(() => {
		calls.push('activateForSpawn');
	});
	const submitPrompt = vi.fn(async () => {
		calls.push('submitPrompt');
		return {};
	});
	const broadcastPlanMode = vi.fn(() => {
		calls.push('broadcastPlanMode');
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
		broadcastPlanMode,
		ask: { ask: vi.fn(), releaseSession: vi.fn() },
		confirm: { confirm: vi.fn() },
		planMode: {
			activateForSpawn,
			exit: vi.fn(),
			hasSubmittedPlan: vi.fn(() => false),
			isActive: vi.fn(() => false),
			releaseSession: vi.fn(),
		},
	} as unknown as PortAdapterDeps;
	return { activateForSpawn, broadcastPlanMode, calls, deps };
};

const spawn = (deps: PortAdapterDeps, planMode: boolean, chatTabId?: string) =>
	createAgentControlPorts(deps).conversations.startConversation({
		asPeer: false,
		callerConcierge: false,
		callerRuntime: 'pi',
		chatTabId,
		parentSessionId: 'parent',
		planMode,
		prompt: 'find out how X works',
		workspaceCwd: '/ws',
		workspaceId: 'ws',
	});

describe('plan mode: spawn inheritance', () => {
	let built: ReturnType<typeof makeDeps>;

	beforeEach(() => {
		built = makeDeps();
	});

	it('registers the child as planning when it inherits Plan Mode', async () => {
		await spawn(built.deps, true);

		expect(built.activateForSpawn).toHaveBeenCalledTimes(1);
		expect(built.activateForSpawn).toHaveBeenCalledWith('agent-child');
	});

	// The child is a separate process: it can reach `before_agent_start` and ask the
	// app for its playbook before `submitPrompt` resolves in main. Registering after
	// that would hand the child the implementing playbook and then deny the edits it
	// was just told to make. This ordering is the enforcement, not a nicety.
	it('registers Plan Mode before the prompt reaches the child', async () => {
		await spawn(built.deps, true);

		expect(built.calls).toEqual([
			'openSession',
			'activateForSpawn',
			'broadcastPlanMode',
			'submitPrompt',
		]);
	});

	it('leaves a non-planning spawn untouched', async () => {
		await spawn(built.deps, false);

		expect(built.activateForSpawn).not.toHaveBeenCalled();
		expect(built.broadcastPlanMode).not.toHaveBeenCalled();
	});

	it('tells the renderer which chat tab now hosts a planning session', async () => {
		await spawn(built.deps, true);

		expect(built.broadcastPlanMode).toHaveBeenCalledWith({
			chatTabId: 'tab-1',
			agentSessionId: 'agent-child',
			planMode: true,
			workspaceId: 'ws',
		});
	});

	// A reused tab now hosts a planning session just as a fresh one does, and the
	// same path already restamps its metadata, so the mirror applies either way.
	it('mirrors into a caller-supplied tab as well', async () => {
		await spawn(built.deps, true, 'caller-tab');

		expect(built.broadcastPlanMode).toHaveBeenCalledWith(
			expect.objectContaining({ chatTabId: 'caller-tab' }),
		);
	});
});
