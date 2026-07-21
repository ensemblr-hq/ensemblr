import { describe, expect, it, vi } from 'vitest';
import type { WaitScheduler } from '../../src/main/agent-control/agent-control-service.ts';
import {
	type AgentControlPorts,
	createAgentControlService,
	createGuardrails,
	createOriginRegistry,
	type OriginRegistry,
} from '../../src/main/agent-control/index.ts';
import type { WaitForAgentsResult } from '../../src/shared/agent-control.ts';

/**
 * A deterministic scheduler: `sleep` advances a virtual clock so the wait loop's
 * deadline logic is exercised without real timers.
 */
const makeScheduler = (): WaitScheduler => {
	let clock = 0;
	return {
		now: () => clock,
		sleep: async (ms) => {
			clock += ms;
		},
	};
};

/**
 * Stub ports whose only live behavior is `getStatus` (driven by a per-session
 * status map) and `getLastMessage`. Everything else is a resolved no-op.
 */
const makePorts = (statuses: Map<string, string>): AgentControlPorts => ({
	workspaces: { listWorkspaces: vi.fn().mockResolvedValue([]) },
	tabs: {
		spawnChatTab: vi.fn().mockResolvedValue({ chatTabId: 't' }),
		closeTab: vi.fn().mockResolvedValue(undefined),
		openNonChatTab: vi.fn().mockResolvedValue({ chatTabId: 't' }),
		listTabs: vi.fn().mockResolvedValue([]),
		resolveTabWorkspace: vi.fn().mockResolvedValue('ws'),
	},
	conversations: {
		startConversation: vi
			.fn()
			.mockResolvedValue({ chatTabId: 't', piSessionId: 'p' }),
		sendFollowUp: vi.fn().mockResolvedValue(undefined),
		waitForIdle: vi.fn().mockResolvedValue('completed'),
		getStatus: vi.fn(async (piSessionId: string) => {
			const status = statuses.get(piSessionId);
			return status ? { piSessionId, status, runtimeOpen: true } : null;
		}),
		getLastMessage: vi.fn(async (piSessionId: string) => `msg:${piSessionId}`),
		listModels: vi.fn().mockResolvedValue({ defaultModelId: null, models: [] }),
		resolveConversationWorkspace: vi.fn().mockResolvedValue('ws'),
	},
	terminals: {
		startTerminal: vi.fn().mockResolvedValue({ terminalId: 't' }),
		stopTerminal: vi.fn().mockResolvedValue(undefined),
		writeTerminal: vi.fn().mockResolvedValue(undefined),
		readOutput: vi.fn().mockResolvedValue(''),
		listTerminals: vi.fn().mockResolvedValue([]),
		resolveTerminalWorkspace: vi.fn().mockResolvedValue('ws'),
	},
	harnesses: {
		launchHarness: vi
			.fn()
			.mockResolvedValue({ chatTabId: 't', terminalId: 't' }),
	},
	focus: { focusTab: vi.fn(), focusDockTab: vi.fn(), focusPanel: vi.fn() },
	permissions: { getMode: () => 'workspace-trusted' },
	confirm: { confirm: vi.fn().mockResolvedValue(true) },
});

/**
 * Registers an orchestrator (`master`) plus `childCount` children, minting a
 * predictable token per session (`tok-<session>`).
 */
const setup = (options: {
	statuses: Map<string, string>;
	children: string[];
	guardrails?: Parameters<typeof createGuardrails>[0];
}) => {
	const registry: OriginRegistry = createOriginRegistry({
		generateToken: () => `tok-${Math.random()}`,
	});
	const master = registry.register({
		sessionId: 'master',
		workspaceId: 'ws',
		workspaceCwd: '/ws',
		species: 'pi',
	});
	const childOrigins = options.children.map((sessionId) =>
		registry.register({
			sessionId,
			workspaceId: 'ws',
			workspaceCwd: '/ws',
			species: 'pi',
			parentSessionId: 'master',
		}),
	);
	const service = createAgentControlService({
		ports: makePorts(options.statuses),
		originRegistry: registry,
		guardrails: createGuardrails(options.guardrails),
		scheduler: makeScheduler(),
	});
	return { service, registry, master, childOrigins };
};

describe('agent-control waitForAgents', () => {
	it('returns immediately when a child is already terminal (mode first)', async () => {
		const statuses = new Map([['c1', 'idle']]);
		const { service, master } = setup({ statuses, children: ['c1'] });
		const result = await service.invoke({
			op: 'waitForAgents',
			token: master.token,
			rawArgs: { mode: 'first' },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			const data = result.data as WaitForAgentsResult;
			expect(data.timedOut).toBe(false);
			expect(data.completed).toHaveLength(1);
			expect(data.completed[0]).toMatchObject({
				piSessionId: 'c1',
				status: 'idle',
				lastMessage: 'msg:c1',
			});
		}
	});

	it('defaults its targets to the caller’s children', async () => {
		const statuses = new Map([
			['c1', 'idle'],
			['c2', 'idle'],
		]);
		const { service, master } = setup({ statuses, children: ['c1', 'c2'] });
		const result = await service.invoke({
			op: 'waitForAgents',
			token: master.token,
			rawArgs: { mode: 'all' },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			const data = result.data as WaitForAgentsResult;
			expect(data.timedOut).toBe(false);
			expect(data.completed.map((c) => c.piSessionId).sort()).toEqual([
				'c1',
				'c2',
			]);
		}
	});

	it('times out when a child never settles (mode all)', async () => {
		const statuses = new Map([
			['c1', 'idle'],
			['c2', 'streaming'],
		]);
		const { service, master } = setup({ statuses, children: ['c1', 'c2'] });
		const result = await service.invoke({
			op: 'waitForAgents',
			token: master.token,
			rawArgs: { mode: 'all', timeoutMs: 1000 },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			const data = result.data as WaitForAgentsResult;
			expect(data.timedOut).toBe(true);
			expect(data.completed.map((c) => c.piSessionId)).toEqual(['c1']);
		}
	});

	it('is woken early by a child need_decision signal', async () => {
		const statuses = new Map([
			['c1', 'streaming'],
			['c2', 'streaming'],
		]);
		const { service, master, childOrigins } = setup({
			statuses,
			children: ['c1', 'c2'],
		});
		const notify = await service.invoke({
			op: 'notifyOrchestrator',
			token: childOrigins[1].token,
			rawArgs: { reason: 'need_decision', message: 'which framework?' },
		});
		expect(notify.ok).toBe(true);
		const result = await service.invoke({
			op: 'waitForAgents',
			token: master.token,
			rawArgs: { mode: 'first', timeoutMs: 1000 },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			const data = result.data as WaitForAgentsResult;
			expect(data.timedOut).toBe(false);
			expect(data.completed).toHaveLength(1);
			expect(data.completed[0]).toMatchObject({
				piSessionId: 'c2',
				signal: { reason: 'need_decision', message: 'which framework?' },
			});
		}
	});

	it('refuses to wait on an ancestor session (deadlock)', async () => {
		const statuses = new Map([['master', 'streaming']]);
		const { service, childOrigins } = setup({
			statuses,
			children: ['c1'],
		});
		const result = await service.invoke({
			op: 'waitForAgents',
			token: childOrigins[0].token,
			rawArgs: { targets: ['master'] },
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('denied-deadlock');
		}
	});

	it('returns an empty result when the caller has no children', async () => {
		const { service, master } = setup({ statuses: new Map(), children: [] });
		const result = await service.invoke({
			op: 'waitForAgents',
			token: master.token,
			rawArgs: {},
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toEqual({ completed: [], timedOut: false });
		}
	});
});

describe('agent-control notifyOrchestrator', () => {
	it('fails for a root session with no orchestrator', async () => {
		const { service, master } = setup({ statuses: new Map(), children: [] });
		const result = await service.invoke({
			op: 'notifyOrchestrator',
			token: master.token,
			rawArgs: { reason: 'blocked', message: 'stuck' },
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('not-found');
		}
	});
});
