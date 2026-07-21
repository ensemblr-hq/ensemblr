import { describe, expect, it, vi } from 'vitest';

import {
	type AgentControlPorts,
	createAgentControlService,
	createGuardrails,
	createOriginRegistry,
	type GuardrailConfig,
} from '../../src/main/agent-control/index.ts';
import type { PermissionMode } from '../../src/shared/permissions.ts';

/**
 * Builds a fully-stubbed port surface with sensible in-workspace defaults;
 * individual tests override just the ports they exercise.
 */
const makePorts = (
	overrides: Partial<{
		mode: PermissionMode;
		confirm: boolean;
		tabWorkspace: string | null;
		conversationWorkspace: string | null;
		terminalWorkspace: string | null;
	}> = {},
): AgentControlPorts => ({
	workspaces: { listWorkspaces: vi.fn().mockResolvedValue([]) },
	tabs: {
		spawnChatTab: vi.fn().mockResolvedValue({ chatTabId: 'new-tab' }),
		closeTab: vi.fn().mockResolvedValue(undefined),
		openNonChatTab: vi.fn().mockResolvedValue({ chatTabId: 'nc-tab' }),
		listTabs: vi.fn().mockResolvedValue([]),
		resolveTabWorkspace: vi
			.fn()
			.mockResolvedValue(
				overrides.tabWorkspace === undefined ? 'ws' : overrides.tabWorkspace,
			),
	},
	conversations: {
		startConversation: vi
			.fn()
			.mockResolvedValue({ chatTabId: 't', piSessionId: 'pi-1' }),
		sendFollowUp: vi.fn().mockResolvedValue(undefined),
		waitForIdle: vi.fn().mockResolvedValue('completed'),
		getStatus: vi.fn().mockResolvedValue({
			piSessionId: 'pi-1',
			status: 'idle',
			runtimeOpen: true,
		}),
		getLastMessage: vi.fn().mockResolvedValue('last'),
		listModels: vi
			.fn()
			.mockResolvedValue({ defaultModelId: 'm-default', models: [] }),
		resolveConversationWorkspace: vi
			.fn()
			.mockResolvedValue(
				overrides.conversationWorkspace === undefined
					? 'ws'
					: overrides.conversationWorkspace,
			),
	},
	terminals: {
		startTerminal: vi.fn().mockResolvedValue({ terminalId: 'term-1' }),
		stopTerminal: vi.fn().mockResolvedValue(undefined),
		writeTerminal: vi.fn().mockResolvedValue(undefined),
		readOutput: vi.fn().mockResolvedValue('output'),
		listTerminals: vi.fn().mockResolvedValue([]),
		resolveTerminalWorkspace: vi
			.fn()
			.mockResolvedValue(
				overrides.terminalWorkspace === undefined
					? 'ws'
					: overrides.terminalWorkspace,
			),
	},
	harnesses: {
		launchHarness: vi
			.fn()
			.mockResolvedValue({ chatTabId: 'h', terminalId: 'h-term' }),
	},
	focus: {
		focusTab: vi.fn(),
		focusDockTab: vi.fn(),
		focusPanel: vi.fn(),
	},
	permissions: { getMode: () => overrides.mode ?? 'workspace-trusted' },
	confirm: { confirm: vi.fn().mockResolvedValue(overrides.confirm ?? true) },
});

const setup = (
	options: {
		ports?: AgentControlPorts;
		guardrails?: Partial<GuardrailConfig>;
	} = {},
) => {
	const registry = createOriginRegistry({ generateToken: () => 'tok-caller' });
	registry.register({
		sessionId: 'caller',
		workspaceId: 'ws',
		workspaceCwd: '/ws',
		species: 'pi',
	});
	const ports = options.ports ?? makePorts();
	const service = createAgentControlService({
		ports,
		originRegistry: registry,
		guardrails: createGuardrails(options.guardrails),
	});
	return { service, ports, registry };
};

describe('agent-control service: gating', () => {
	it('rejects an unknown token', async () => {
		const { service } = setup();
		const result = await service.invoke({
			op: 'listTabs',
			token: 'bogus',
			rawArgs: {},
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('denied-permission');
		}
	});

	it('rejects invalid args', async () => {
		const { service } = setup();
		const result = await service.invoke({
			op: 'startConversation',
			token: 'tok-caller',
			rawArgs: { wait: true },
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('invalid-args');
		}
	});

	it('rejects unknown/misspelled arg keys instead of silently dropping them', async () => {
		const { service } = setup();
		const result = await service.invoke({
			op: 'closeTab',
			token: 'tok-caller',
			rawArgs: { chatTabId: 'x', workspceId: 'typo' },
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('invalid-args');
		}
	});

	it('allows reads in read-only mode', async () => {
		const { service } = setup({ ports: makePorts({ mode: 'read-only' }) });
		const result = await service.invoke({
			op: 'listTabs',
			token: 'tok-caller',
			rawArgs: {},
		});
		expect(result.ok).toBe(true);
	});

	it('blocks writes in read-only mode', async () => {
		const { service } = setup({ ports: makePorts({ mode: 'read-only' }) });
		const result = await service.invoke({
			op: 'spawnChatTab',
			token: 'tok-caller',
			rawArgs: {},
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('denied-permission');
		}
	});

	it('runs a write when approval is granted', async () => {
		const ports = makePorts({ mode: 'approval-required', confirm: true });
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'spawnChatTab',
			token: 'tok-caller',
			rawArgs: {},
		});
		expect(result.ok).toBe(true);
		expect(ports.confirm.confirm).toHaveBeenCalledOnce();
		expect(ports.tabs.spawnChatTab).toHaveBeenCalledOnce();
	});

	it('denies a write when approval is declined', async () => {
		const ports = makePorts({ mode: 'approval-required', confirm: false });
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'spawnChatTab',
			token: 'tok-caller',
			rawArgs: {},
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('denied-permission');
		}
		expect(ports.tabs.spawnChatTab).not.toHaveBeenCalled();
	});
});

describe('agent-control service: scope', () => {
	it('denies closing a tab in another workspace', async () => {
		const ports = makePorts({ tabWorkspace: 'other-ws' });
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'closeTab',
			token: 'tok-caller',
			rawArgs: { chatTabId: 'x' },
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('denied-scope');
		}
		expect(ports.tabs.closeTab).not.toHaveBeenCalled();
	});

	it('reports not-found for a missing target', async () => {
		const ports = makePorts({ tabWorkspace: null });
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'closeTab',
			token: 'tok-caller',
			rawArgs: { chatTabId: 'x' },
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('not-found');
		}
	});

	it('passes an explicit workspace through for reads', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });
		await service.invoke({
			op: 'listTabs',
			token: 'tok-caller',
			rawArgs: { workspaceId: 'elsewhere' },
		});
		expect(ports.tabs.listTabs).toHaveBeenCalledWith({
			workspaceId: 'elsewhere',
		});
	});
});

describe('agent-control service: guardrails', () => {
	it('denies a spawn that exceeds the depth limit', async () => {
		const { service } = setup({ guardrails: { maxSpawnDepth: 0 } });
		const result = await service.invoke({
			op: 'spawnChatTab',
			token: 'tok-caller',
			rawArgs: {},
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('denied-depth');
		}
	});

	it('does not consume spawn quota when the create fails', async () => {
		const ports = makePorts();
		const spawn = vi
			.fn()
			.mockRejectedValueOnce(new Error('boom'))
			.mockResolvedValue({ chatTabId: 'recovered' });
		ports.tabs.spawnChatTab = spawn;
		const { service } = setup({
			ports,
			guardrails: { maxSpawnsPerSession: 1 },
		});
		const failed = await service.invoke({
			op: 'spawnChatTab',
			token: 'tok-caller',
			rawArgs: {},
		});
		expect(failed.ok).toBe(false);
		const retried = await service.invoke({
			op: 'spawnChatTab',
			token: 'tok-caller',
			rawArgs: {},
		});
		expect(retried.ok).toBe(true);
		expect(spawn).toHaveBeenCalledTimes(2);
	});

	it('releaseSession invalidates the token so later calls are denied', async () => {
		const { service } = setup();
		const before = await service.invoke({
			op: 'listTabs',
			token: 'tok-caller',
			rawArgs: {},
		});
		expect(before.ok).toBe(true);
		service.releaseSession('caller');
		const after = await service.invoke({
			op: 'listTabs',
			token: 'tok-caller',
			rawArgs: {},
		});
		expect(after.ok).toBe(false);
		if (!after.ok) {
			expect(after.code).toBe('denied-permission');
		}
	});

	it('blocks a follow-up wait on an ancestor session', async () => {
		const registry = createOriginRegistry({
			generateToken: () => 'tok-child',
		});
		registry.register({
			sessionId: 'ancestor',
			workspaceId: 'ws',
			workspaceCwd: '/ws',
			species: 'pi',
		});
		registry.register({
			sessionId: 'caller',
			workspaceId: 'ws',
			workspaceCwd: '/ws',
			species: 'pi',
			parentSessionId: 'ancestor',
		});
		const ports = makePorts();
		const service = createAgentControlService({
			ports,
			originRegistry: registry,
			guardrails: createGuardrails(),
		});
		const result = await service.invoke({
			op: 'sendFollowUp',
			token: 'tok-child',
			rawArgs: { piSessionId: 'ancestor', prompt: 'hi', wait: true },
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('denied-deadlock');
		}
	});
});

describe('agent-control service: focus', () => {
	it('focuses a session tab in the caller workspace', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'focusTab',
			token: 'tok-caller',
			rawArgs: { chatTabId: 'abc' },
		});
		expect(result.ok).toBe(true);
		expect(ports.focus.focusTab).toHaveBeenCalledWith({
			workspaceId: 'ws',
			chatTabId: 'abc',
		});
	});

	it('denies focusing a tab in another workspace', async () => {
		const ports = makePorts({ tabWorkspace: 'other' });
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'focusTab',
			token: 'tok-caller',
			rawArgs: { chatTabId: 'abc' },
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('denied-scope');
		}
		expect(ports.focus.focusTab).not.toHaveBeenCalled();
	});

	it('maps a dock terminal id to a terminal:<id> focus target', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });
		await service.invoke({
			op: 'focusDockTab',
			token: 'tok-caller',
			rawArgs: { terminalId: 'term-9' },
		});
		expect(ports.focus.focusDockTab).toHaveBeenCalledWith({
			workspaceId: 'ws',
			dock: 'terminal:term-9',
		});
	});

	it('focuses a review panel', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });
		await service.invoke({
			op: 'focusPanel',
			token: 'tok-caller',
			rawArgs: { panel: 'checks' },
		});
		expect(ports.focus.focusPanel).toHaveBeenCalledWith({
			workspaceId: 'ws',
			panel: 'checks',
		});
	});
});

describe('agent-control service: delegation', () => {
	it('waits for the child conversation when asked', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'startConversation',
			token: 'tok-caller',
			rawArgs: { prompt: 'go', wait: true },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toMatchObject({
				piSessionId: 'pi-1',
				result: 'completed',
			});
		}
		expect(ports.conversations.waitForIdle).toHaveBeenCalledOnce();
	});

	it('does not wait by default', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });
		await service.invoke({
			op: 'startConversation',
			token: 'tok-caller',
			rawArgs: { prompt: 'go' },
		});
		expect(ports.conversations.waitForIdle).not.toHaveBeenCalled();
	});

	it('threads the caller model to a spawned conversation', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });
		await service.invoke({
			op: 'startConversation',
			token: 'tok-caller',
			rawArgs: { prompt: 'go' },
			callerModel: 'master-model',
		});
		expect(ports.conversations.startConversation).toHaveBeenCalledWith(
			expect.objectContaining({ callerModel: 'master-model' }),
		);
	});

	it('settles an unknown wait target as status "unknown", not "closed"', async () => {
		const ports = makePorts();
		ports.conversations.getStatus = vi.fn().mockResolvedValue(null);
		ports.conversations.getLastMessage = vi.fn().mockResolvedValue(null);
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'waitForAgents',
			token: 'tok-caller',
			rawArgs: { targets: ['ghost'], mode: 'all' },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toMatchObject({
				completed: [{ piSessionId: 'ghost', status: 'unknown' }],
				timedOut: false,
			});
		}
	});

	it('returns the model catalog for listModels', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'listModels',
			token: 'tok-caller',
			rawArgs: {},
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toEqual({ defaultModelId: 'm-default', models: [] });
		}
	});

	it('maps a delegate failure to an internal error', async () => {
		const ports = makePorts();
		ports.tabs.spawnChatTab = vi.fn().mockRejectedValue(new Error('boom'));
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'spawnChatTab',
			token: 'tok-caller',
			rawArgs: {},
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('internal');
			expect(result.error).toContain('boom');
		}
	});
});
