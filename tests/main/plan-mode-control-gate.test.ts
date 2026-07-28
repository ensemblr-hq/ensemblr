import { describe, expect, it, vi } from 'vitest';

import {
	type AgentControlPorts,
	createAgentControlService,
	createGuardrails,
	createOriginRegistry,
} from '../../src/main/agent-control/index.ts';
import type { AgentSpecies } from '../../src/main/agent-control/ports.ts';

const PLANNING_SESSION = 'caller';

const makePorts = (planning: boolean): AgentControlPorts =>
	({
		workspaces: { listWorkspaces: vi.fn().mockResolvedValue([]) },
		tabs: {
			spawnChatTab: vi.fn().mockResolvedValue({ chatTabId: 'new-tab' }),
			closeTab: vi.fn().mockResolvedValue(undefined),
			openNonChatTab: vi.fn().mockResolvedValue({ chatTabId: 'nc-tab' }),
			listTabs: vi.fn().mockResolvedValue([]),
			resolveTabWorkspace: vi.fn().mockResolvedValue('ws'),
		},
		conversations: {
			startConversation: vi
				.fn()
				.mockResolvedValue({ chatTabId: 't', piSessionId: 'pi-1' }),
			sendFollowUp: vi.fn().mockResolvedValue(undefined),
			setName: vi.fn().mockResolvedValue({ chatTabId: 't', title: 'Named' }),
			waitForIdle: vi.fn().mockResolvedValue('completed'),
			getStatus: vi.fn().mockResolvedValue(null),
			hasFinalMessage: vi.fn().mockResolvedValue(false),
			getLastMessage: vi.fn().mockResolvedValue('last'),
			listModels: vi
				.fn()
				.mockResolvedValue({ defaultModelId: 'm', models: [] }),
			resolveConversationWorkspace: vi.fn().mockResolvedValue('ws'),
		},
		terminals: {
			startTerminal: vi.fn().mockResolvedValue({ terminalId: 'term-1' }),
			stopTerminal: vi.fn().mockResolvedValue(undefined),
			writeTerminal: vi.fn().mockResolvedValue(undefined),
			readOutput: vi.fn().mockResolvedValue('output'),
			listTerminals: vi.fn().mockResolvedValue([]),
			resolveTerminalWorkspace: vi.fn().mockResolvedValue('ws'),
		},
		harnesses: {
			launchHarness: vi
				.fn()
				.mockResolvedValue({ chatTabId: 'h', terminalId: 'h-term' }),
		},
		focus: { focusTab: vi.fn(), focusDockTab: vi.fn(), focusPanel: vi.fn() },
		board: {
			setWorkspaceStatus: vi.fn(),
			getWorkspaceStatus: vi.fn().mockReturnValue('backlog'),
		},
		permissions: { getMode: () => 'workspace-trusted' },
		confirm: { confirm: vi.fn().mockResolvedValue(true) },
		ask: { ask: vi.fn(), releaseSession: vi.fn() },
		planMode: {
			exit: vi.fn().mockResolvedValue({ planPath: 'p.md', summary: 'saved' }),
			isActive: vi.fn((sessionId: string) =>
				planning ? sessionId === PLANNING_SESSION : false,
			),
			releaseSession: vi.fn(),
		},
	}) as unknown as AgentControlPorts;

const setup = (options: { planning: boolean; species?: AgentSpecies }) => {
	const registry = createOriginRegistry({ generateToken: () => 'tok-caller' });
	registry.register({
		sessionId: PLANNING_SESSION,
		species: options.species ?? 'pi',
		workspaceCwd: '/ws',
		workspaceId: 'ws',
	});
	const ports = makePorts(options.planning);
	const service = createAgentControlService({
		guardrails: createGuardrails(),
		originRegistry: registry,
		ports,
	});
	return { ports, service };
};

const invoke = (
	service: ReturnType<typeof setup>['service'],
	op: Parameters<typeof service.invoke>[0]['op'],
	rawArgs: Record<string, unknown> = {},
) => service.invoke({ op, rawArgs, token: 'tok-caller' });

const ARGS_BY_OP: Record<string, Record<string, unknown>> = {
	launchHarness: { harnessId: 'claude-code' },
	sendFollowUp: { piSessionId: 'pi-1', prompt: 'go' },
	startConversation: { prompt: 'implement it' },
	startTerminal: { kind: 'run' },
	writeTerminal: { input: 'rm -rf .\n', terminalId: 'term-1' },
};

describe('plan mode: control-op gate', () => {
	for (const op of Object.keys(ARGS_BY_OP)) {
		it(`blocks \`${op}\` while planning`, async () => {
			const { ports, service } = setup({ planning: true });

			const result = await invoke(
				service,
				op as 'startTerminal',
				ARGS_BY_OP[op],
			);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.code).toBe('denied-scope');
				expect(result.error).toContain('Plan Mode is on');
				expect(result.error).toContain('ensemblr_exit_plan_mode');
			}
			expect(ports.terminals.startTerminal).not.toHaveBeenCalled();
			expect(ports.terminals.writeTerminal).not.toHaveBeenCalled();
			expect(ports.harnesses.launchHarness).not.toHaveBeenCalled();
			expect(ports.conversations.startConversation).not.toHaveBeenCalled();
			expect(ports.conversations.sendFollowUp).not.toHaveBeenCalled();
		});

		it(`allows \`${op}\` when the session is not planning`, async () => {
			const { service } = setup({ planning: false });

			const result = await invoke(
				service,
				op as 'startTerminal',
				ARGS_BY_OP[op],
			);

			expect(result.ok).toBe(true);
		});
	}

	// Reads and the plan hand-off itself must survive the gate, or a planning
	// agent has no way to gather context and no way to leave plan mode.
	it('leaves reads alone while planning', async () => {
		const { service } = setup({ planning: true });

		expect((await invoke(service, 'listTabs')).ok).toBe(true);
		expect((await invoke(service, 'listTerminals')).ok).toBe(true);
		expect(
			(await invoke(service, 'readTerminalOutput', { terminalId: 't' })).ok,
		).toBe(true);
	});

	it('does not gate a harness caller, which has no Plan Mode', async () => {
		const { service } = setup({ planning: true, species: 'harness' });

		const result = await invoke(service, 'startTerminal', { kind: 'run' });

		expect(result.ok).toBe(true);
	});
});

describe('plan mode: getPlanMode', () => {
	it('reports the planning session as active', async () => {
		const { service } = setup({ planning: true });

		const result = await invoke(service, 'getPlanMode');

		expect(result).toMatchObject({ data: { active: true }, ok: true });
	});

	it('reports a harness caller as never planning', async () => {
		const { service } = setup({ planning: true, species: 'harness' });

		const result = await invoke(service, 'getPlanMode');

		expect(result).toMatchObject({ data: { active: false }, ok: true });
	});
});

describe('plan mode: checkPlanModeTool', () => {
	it('blocks `write` while planning', async () => {
		const { service } = setup({ planning: true });

		const result = await invoke(service, 'checkPlanModeTool', {
			tool: 'write',
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toMatchObject({ blocked: true });
		}
	});

	it('blocks a `bash` command that is not read-only', async () => {
		const { service } = setup({ planning: true });

		const result = await invoke(service, 'checkPlanModeTool', {
			command: 'npm run build',
			tool: 'bash',
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toMatchObject({ blocked: true });
		}
	});

	it('allows a read-only `bash` command', async () => {
		const { service } = setup({ planning: true });

		const result = await invoke(service, 'checkPlanModeTool', {
			command: 'git log --oneline',
			tool: 'bash',
		});

		expect(result).toMatchObject({ data: { blocked: false }, ok: true });
	});

	it('allows everything when the session is not planning', async () => {
		const { service } = setup({ planning: false });

		const result = await invoke(service, 'checkPlanModeTool', {
			tool: 'write',
		});

		expect(result).toMatchObject({ data: { blocked: false }, ok: true });
	});
});

describe('plan mode: exitPlanMode', () => {
	it('submits the plan for a planning Pi session', async () => {
		const { ports, service } = setup({ planning: true });

		const result = await invoke(service, 'exitPlanMode', {
			plan: '# Plan\n\nDo the thing.',
			title: 'Add Plan Mode',
		});

		expect(result.ok).toBe(true);
		expect(ports.planMode.exit).toHaveBeenCalledWith(
			expect.objectContaining({
				args: { plan: '# Plan\n\nDo the thing.', title: 'Add Plan Mode' },
			}),
		);
	});

	// Without this an agent nobody asked to plan could drop a file in
	// `.context/plans/` and put a decision panel in front of the user.
	it('refuses when the session is not in Plan Mode', async () => {
		const { ports, service } = setup({ planning: false });

		const result = await invoke(service, 'exitPlanMode', {
			plan: 'unsolicited',
			title: 'Unsolicited',
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('denied-scope');
		}
		expect(ports.planMode.exit).not.toHaveBeenCalled();
	});

	it('refuses a harness caller', async () => {
		const { ports, service } = setup({ planning: true, species: 'harness' });

		const result = await invoke(service, 'exitPlanMode', {
			plan: 'from a harness',
			title: 'Harness',
		});

		expect(result.ok).toBe(false);
		expect(ports.planMode.exit).not.toHaveBeenCalled();
	});
});
