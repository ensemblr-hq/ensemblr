import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
	createAgentControlPorts,
	type PortAdapterDeps,
} from '../../src/main/agent-control/index.ts';

// Simulate a machine whose Pi DEFAULT resolves to a local gemma (a different
// provider than the master) — the exact situation that mis-spawned children.
const CATALOG = {
	defaultModelId: 'ollama/gemma',
	defaultThinkingLevel: null,
	models: [
		{
			id: 'anthropic/sonnet',
			provider: 'anthropic',
			displayName: 'Sonnet',
			thinkingLevels: [],
		},
		{
			id: 'ollama/gemma',
			provider: 'ollama',
			displayName: 'Gemma',
			thinkingLevels: [],
		},
	],
};

vi.mock('../../src/main/pi-runtime/pi-provider-models.ts', () => ({
	resolvePiProviderModels: vi.fn(async () => ({})),
	presentPiModels: vi.fn(() => CATALOG),
}));

let openSession: ReturnType<typeof vi.fn>;
let sessions: Array<{ model: string | null; updatedAt: string }>;

const makeDeps = (): PortAdapterDeps => {
	openSession = vi.fn(async () => ({ id: 'pi-child', status: 'starting' }));
	return {
		databaseService: { getConnection: () => ({ database: {} }) },
		chatTabService: { openTab: vi.fn(() => ({ id: 'tab-1', metadata: {} })) },
		piSessionService: {
			openSession,
			submitPrompt: vi.fn(async () => ({})),
			getSession: vi.fn(() => null),
			listSessionsForWorkspace: vi.fn(() => sessions),
		},
		terminalService: {},
		scriptLifecycleService: {},
		harnessDetectionService: {},
		piExecutableService: {
			getSnapshot: vi.fn(async () => ({ status: 'ready', command: 'pi' })),
		},
		localCommandService: {},
		getPermissionMode: () => 'workspace-trusted',
		augmentHarnessCommand: (command: string) => command,
		broadcastFocus: vi.fn(),
		broadcastTabsChanged: vi.fn(),
		confirm: { confirm: vi.fn() },
	} as unknown as PortAdapterDeps;
};

const spawn = async (input: {
	model?: string;
	callerModel?: string;
}): Promise<string | null> => {
	const ports = createAgentControlPorts(makeDeps());
	await ports.conversations.startConversation({
		workspaceId: 'ws',
		workspaceCwd: '/ws',
		prompt: 'go',
		parentSessionId: 'ws:ws',
		...input,
	});
	return openSession.mock.calls[0][0].model;
};

describe('spawned-conversation model resolution', () => {
	beforeEach(() => {
		sessions = [];
	});

	it('rejects a valid but different-provider model in favor of the master model', async () => {
		const model = await spawn({
			model: 'ollama/gemma',
			callerModel: 'anthropic/sonnet',
		});
		expect(model).toBe('anthropic/sonnet');
	});

	it('honors a requested model that matches the master provider', async () => {
		const model = await spawn({
			model: 'anthropic/sonnet',
			callerModel: 'anthropic/sonnet',
		});
		expect(model).toBe('anthropic/sonnet');
	});

	it('inherits the caller model when none is requested', async () => {
		const model = await spawn({ callerModel: 'anthropic/sonnet' });
		expect(model).toBe('anthropic/sonnet');
	});

	it('falls back to the workspace master session when no caller model is sent', async () => {
		sessions = [
			{ model: 'anthropic/sonnet', updatedAt: '2026-01-01T00:00:00Z' },
		];
		const model = await spawn({ model: 'ollama/gemma' });
		expect(model).toBe('anthropic/sonnet');
	});
});

describe('startConversation rollback on submit failure', () => {
	const makeFailingDeps = (): {
		deps: PortAdapterDeps;
		stopSession: ReturnType<typeof vi.fn>;
		closeTab: ReturnType<typeof vi.fn>;
		openTab: ReturnType<typeof vi.fn>;
	} => {
		const stopSession = vi.fn(async () => {});
		const closeTab = vi.fn(() => ({ deleted: true }));
		const openTab = vi.fn(() => ({ id: 'tab-new', metadata: {} }));
		const deps = {
			databaseService: { getConnection: () => ({ database: {} }) },
			chatTabService: { openTab, closeTab },
			piSessionService: {
				openSession: vi.fn(async () => ({
					id: 'pi-child',
					status: 'starting',
				})),
				submitPrompt: vi.fn(async () => {
					throw new Error('submit failed');
				}),
				stopSession,
				getSession: vi.fn(() => null),
				listSessionsForWorkspace: vi.fn(() => []),
			},
			terminalService: {},
			scriptLifecycleService: {},
			harnessDetectionService: {},
			piExecutableService: {
				getSnapshot: vi.fn(async () => ({ status: 'ready', command: 'pi' })),
			},
			localCommandService: {},
			getPermissionMode: () => 'workspace-trusted',
			augmentHarnessCommand: (command: string) => command,
			broadcastFocus: vi.fn(),
			broadcastTabsChanged: vi.fn(),
			confirm: { confirm: vi.fn() },
		} as unknown as PortAdapterDeps;
		return { deps, stopSession, closeTab, openTab };
	};

	it('stops the session and closes the tab it opened when the first prompt fails', async () => {
		const { deps, stopSession, closeTab } = makeFailingDeps();
		const ports = createAgentControlPorts(deps);
		await expect(
			ports.conversations.startConversation({
				workspaceId: 'ws',
				workspaceCwd: '/ws',
				prompt: 'go',
				parentSessionId: 'ws:ws',
			}),
		).rejects.toThrow('submit failed');
		expect(stopSession).toHaveBeenCalledWith(
			expect.objectContaining({ sessionId: 'pi-child' }),
		);
		expect(closeTab).toHaveBeenCalledWith({ chatTabId: 'tab-new' });
	});

	it('does not close a caller-supplied tab on failure', async () => {
		const { deps, stopSession, closeTab, openTab } = makeFailingDeps();
		const ports = createAgentControlPorts(deps);
		await expect(
			ports.conversations.startConversation({
				workspaceId: 'ws',
				workspaceCwd: '/ws',
				chatTabId: 'caller-tab',
				prompt: 'go',
				parentSessionId: 'ws:ws',
			}),
		).rejects.toThrow('submit failed');
		expect(openTab).not.toHaveBeenCalled();
		expect(stopSession).toHaveBeenCalled();
		expect(closeTab).not.toHaveBeenCalled();
	});
});
