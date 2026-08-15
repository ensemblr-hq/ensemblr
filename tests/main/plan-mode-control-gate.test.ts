import { describe, expect, it, vi } from 'vitest';

import {
	type AgentControlPorts,
	createAgentControlService,
	createGuardrails,
	createOriginRegistry,
} from '../../src/main/agent-control/index.ts';
import type { AgentSpecies } from '../../src/main/agent-control/ports.ts';

const PLANNING_SESSION = 'caller';
const PARENT_SESSION = 'parent';
const TARGET_SESSION = 'pi-1';

const makePorts = (planningSessions: ReadonlySet<string>): AgentControlPorts =>
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
			startConversation: vi.fn().mockResolvedValue({
				ok: true,
				chatTabId: 't',
				agentSessionId: 'pi-1',
			}),
			sendFollowUp: vi.fn().mockResolvedValue(undefined),
			setName: vi.fn().mockResolvedValue({ chatTabId: 't', title: 'Named' }),
			waitForIdle: vi.fn().mockResolvedValue('completed'),
			getStatus: vi.fn().mockResolvedValue(null),
			hasFinalMessage: vi.fn().mockResolvedValue(false),
			getLastMessage: vi.fn().mockResolvedValue('last'),
			isSpawnedSubAgent: vi.fn().mockResolvedValue(false),
			listModels: vi
				.fn()
				.mockResolvedValue({ defaultModelId: 'm', models: [] }),
			resolveConversationWorkspace: vi.fn().mockResolvedValue('ws'),
		},
		terminals: {
			startTerminal: vi
				.fn()
				.mockResolvedValue({ ok: true, terminalId: 'term-1' }),
			stopTerminal: vi.fn().mockResolvedValue(undefined),
			writeTerminal: vi.fn().mockResolvedValue(undefined),
			readOutput: vi.fn().mockResolvedValue('output'),
			listTerminals: vi.fn().mockResolvedValue([]),
			listRunScripts: vi.fn().mockResolvedValue({ scripts: [] }),
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
		language: { getLanguage: () => 'en' },
		confirm: { confirm: vi.fn().mockResolvedValue(true) },
		ask: { ask: vi.fn(), releaseSession: vi.fn() },
		planMode: {
			exit: vi.fn().mockResolvedValue({ planPath: 'p.md', summary: 'saved' }),
			hasSubmittedPlan: vi.fn(() => false),
			isActive: vi.fn((sessionId: string) => planningSessions.has(sessionId)),
			activateForSpawn: vi.fn(),
			releaseSession: vi.fn(),
		},
		sessionNaming: {
			readBrief: vi.fn().mockResolvedValue({
				branch: { current: null, eligible: false },
				summaryStale: false,
				titleNeeded: false,
			}),
			setBranchName: vi.fn().mockResolvedValue({
				applied: true,
				branchName: 'b',
				message: 'ok',
				name: 'n',
			}),
			setSummary: vi
				.fn()
				.mockResolvedValue({ capturedAtOrdinal: 3, message: 'ok' }),
		},
	}) as unknown as AgentControlPorts;

/**
 * Builds a service whose caller is `PLANNING_SESSION`. `subAgent` registers a
 * parent first so the caller resolves at depth 1, which is what selects the
 * sub-agent half of the plan-mode policy. `planningTargets` marks other sessions
 * as planning, for the follow-up cases that turn on the target's state.
 */
const setup = (options: {
	planning: boolean;
	species?: AgentSpecies;
	subAgent?: boolean;
	planningTargets?: readonly string[];
}) => {
	const tokens = options.subAgent
		? ['tok-parent', 'tok-caller']
		: ['tok-caller'];
	let issued = 0;
	const registry = createOriginRegistry({
		generateToken: () => tokens[issued++] ?? `tok-${issued}`,
	});
	if (options.subAgent) {
		registry.register({
			sessionId: PARENT_SESSION,
			species: 'pi',
			workspaceCwd: '/ws',
			workspaceId: 'ws',
		});
	}
	registry.register({
		parentSessionId: options.subAgent ? PARENT_SESSION : undefined,
		sessionId: PLANNING_SESSION,
		species: options.species ?? 'pi',
		workspaceCwd: '/ws',
		workspaceId: 'ws',
	});
	const ports = makePorts(
		new Set([
			...(options.planning ? [PLANNING_SESSION] : []),
			...(options.planningTargets ?? []),
		]),
	);
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

// Ops no planning agent may reach, whatever its role: a harness has no Plan Mode
// and skips approval prompts, and a terminal is a shell the bash guard cannot see
// into. Neither can be made safe by inheritance the way a spawned Pi child can.
const ARGS_BY_OP: Record<string, Record<string, unknown>> = {
	launchHarness: { harnessId: 'claude-code' },
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

		it(`blocks \`${op}\` for a planning sub-agent too`, async () => {
			const { service } = setup({ planning: true, subAgent: true });

			const result = await invoke(
				service,
				op as 'startTerminal',
				ARGS_BY_OP[op],
			);

			expect(result.ok).toBe(false);
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

describe('plan mode: spawning while planning', () => {
	// The whole point of the feature: a planning orchestrator may fan out, and the
	// child it spawns is planning too, so the delegation cannot become an edit.
	it('spawns a planning child from a planning orchestrator', async () => {
		const { ports, service } = setup({ planning: true });

		const result = await invoke(service, 'startConversation', {
			prompt: 'find out how X works',
		});

		expect(result.ok).toBe(true);
		expect(ports.conversations.startConversation).toHaveBeenCalledWith(
			expect.objectContaining({ planMode: true }),
		);
	});

	it('spawns a non-planning child from a non-planning orchestrator', async () => {
		const { ports, service } = setup({ planning: false });

		const result = await invoke(service, 'startConversation', {
			prompt: 'implement it',
		});

		expect(result.ok).toBe(true);
		expect(ports.conversations.startConversation).toHaveBeenCalledWith(
			expect.objectContaining({ planMode: false }),
		);
	});

	// Plan Mode is a native chat feature, so a harness never inherits it however
	// its session id happens to resolve in the registry.
	it('never marks a harness caller as planning when it spawns', async () => {
		const { ports, service } = setup({ planning: true, species: 'harness' });

		await invoke(service, 'startConversation', { prompt: 'go' });

		expect(ports.conversations.startConversation).toHaveBeenCalledWith(
			expect.objectContaining({ planMode: false }),
		);
	});

	// The depth cap already stops nested delegation, so the sub-agent policy never
	// has to reason about a grandchild inheriting anything.
	it('refuses a planning sub-agent the spawn route', async () => {
		const { ports, service } = setup({ planning: true, subAgent: true });

		const result = await invoke(service, 'startConversation', { prompt: 'go' });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('denied-scope');
		}
		expect(ports.conversations.startConversation).not.toHaveBeenCalled();
	});
});

describe('plan mode: sendFollowUp', () => {
	it('steers a target that is itself planning', async () => {
		const { ports, service } = setup({
			planning: true,
			planningTargets: [TARGET_SESSION],
		});

		const result = await invoke(service, 'sendFollowUp', {
			agentSessionId: TARGET_SESSION,
			prompt: 'dig deeper',
		});

		expect(result.ok).toBe(true);
		expect(ports.conversations.sendFollowUp).toHaveBeenCalled();
	});

	// A target that is not planning is an unrestricted writer, so driving it would
	// launder the planning agent's instructions into an edit.
	it('refuses a target that is not planning, and names the spawn route instead', async () => {
		const { ports, service } = setup({ planning: true });

		const result = await invoke(service, 'sendFollowUp', {
			agentSessionId: TARGET_SESSION,
			prompt: 'go implement this',
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('denied-scope');
			expect(result.error).toContain('ensemblr_start_conversation');
		}
		expect(ports.conversations.sendFollowUp).not.toHaveBeenCalled();
	});

	it('leaves a non-planning caller alone', async () => {
		const { ports, service } = setup({ planning: false });

		const result = await invoke(service, 'sendFollowUp', {
			agentSessionId: TARGET_SESSION,
			prompt: 'go',
		});

		expect(result.ok).toBe(true);
		expect(ports.conversations.sendFollowUp).toHaveBeenCalled();
	});

	// Answering the plan-mode question before the scope check would tell a caller
	// in another workspace whether a session it cannot see is planning.
	it('reports the scope failure, not the plan-mode one, for a foreign target', async () => {
		const { ports, service } = setup({ planning: true });
		vi.mocked(
			ports.conversations.resolveConversationWorkspace,
		).mockResolvedValue('other-ws');

		const result = await invoke(service, 'sendFollowUp', {
			agentSessionId: TARGET_SESSION,
			prompt: 'go',
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).not.toContain('Plan Mode is on');
		}
		expect(ports.planMode.isActive).not.toHaveBeenCalledWith(TARGET_SESSION);
	});

	it('refuses a planning sub-agent, which has no conversations to steer', async () => {
		const { ports, service } = setup({
			planning: true,
			planningTargets: [TARGET_SESSION],
			subAgent: true,
		});

		const result = await invoke(service, 'sendFollowUp', {
			agentSessionId: TARGET_SESSION,
			prompt: 'go',
		});

		expect(result.ok).toBe(false);
		expect(ports.conversations.sendFollowUp).not.toHaveBeenCalled();
	});
});

describe('plan mode: getSessionBrief', () => {
	it('reports the planning session as active', async () => {
		const { service } = setup({ planning: true });

		const result = await invoke(service, 'getSessionBrief');

		expect(result).toMatchObject({ data: { planMode: true }, ok: true });
	});

	it('reports a harness caller as never planning', async () => {
		const { service } = setup({ planning: true, species: 'harness' });

		const result = await invoke(service, 'getSessionBrief');

		expect(result).toMatchObject({ data: { planMode: false }, ok: true });
	});

	it('leaves the naming ops available while planning', async () => {
		const { service } = setup({ planning: true });

		expect(
			await invoke(service, 'setBranchName', { name: 'add-dark-mode' }),
		).toMatchObject({ ok: true });
		expect(
			await invoke(service, 'setSummary', { summary: 'Body.', title: 'Topic' }),
		).toMatchObject({ ok: true });
		expect(await invoke(service, 'setName', { title: 'Topic' })).toMatchObject({
			ok: true,
		});
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

	// A plan submitted by a sub-agent posts into the sub-agent's own tab and renders
	// an Approve button there, whose handler clears that tab's Plan Mode and submits
	// an implementation prompt — one click turns a read-only investigator into a
	// writer while the orchestrator is still planning. The denial must also avoid the
	// shared escape hatch, which would name the tool that just refused it.
	it('refuses a planning sub-agent without sending it back to the exit tool', async () => {
		const { ports, service } = setup({ planning: true, subAgent: true });

		const result = await invoke(service, 'exitPlanMode', {
			plan: '# Findings',
			title: 'Findings',
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('denied-scope');
			expect(result.error).not.toContain('finish the plan and call');
			expect(result.error).toContain('last message');
		}
		expect(ports.planMode.exit).not.toHaveBeenCalled();
	});
});

describe('plan mode: askUserQuestion', () => {
	it('lets a planning orchestrator interview the user', async () => {
		const { ports, service } = setup({ planning: true });

		const result = await invoke(service, 'askUserQuestion', {
			questions: [
				{ options: [{ label: 'A' }, { label: 'B' }], question: 'Q?' },
			],
		});

		expect(result.ok).toBe(true);
		expect(ports.ask.ask).toHaveBeenCalled();
	});

	// The modal would render in the sub-agent's tab while the orchestrator sits in
	// `wait_for_agents`, so nobody is watching it and the child hangs to the wait
	// timeout. `notifyOrchestrator` is the channel that actually reaches someone.
	it('refuses a planning sub-agent and points it at its orchestrator', async () => {
		const { ports, service } = setup({ planning: true, subAgent: true });

		const result = await invoke(service, 'askUserQuestion', {
			questions: [
				{ options: [{ label: 'A' }, { label: 'B' }], question: 'Q?' },
			],
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain('ensemblr_notify_orchestrator');
		}
		expect(ports.ask.ask).not.toHaveBeenCalled();
	});

	// This used to be allowed, and the reason it was denied while planning never
	// depended on Plan Mode: the orchestrator owns the conversation with the user
	// and is blocked in `waitForAgents` either way, so a dialog opened here waits
	// in a tab nobody is watching. The denial is unconditional now, in
	// `src/shared/agent-control/subagent-policy.ts`.
	it('refuses a non-planning sub-agent too, for the same reason', async () => {
		const { ports, service } = setup({ planning: false, subAgent: true });

		const result = await invoke(service, 'askUserQuestion', {
			questions: [
				{ options: [{ label: 'A' }, { label: 'B' }], question: 'Q?' },
			],
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('denied-scope');
			expect(result.error).toContain('ensemblr_notify_orchestrator');
			expect(result.error).toContain('Open questions');
		}
		expect(ports.ask.ask).not.toHaveBeenCalled();
	});
});
