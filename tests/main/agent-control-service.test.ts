import { describe, expect, it, vi } from 'vitest';

import {
	type AgentControlPorts,
	type AgentSpecies,
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
		planning: boolean;
		spawnedSubAgent: boolean;
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
		setName: vi
			.fn()
			.mockResolvedValue({ chatTabId: 'named-tab', title: 'Named' }),
		waitForIdle: vi.fn().mockResolvedValue('completed'),
		getStatus: vi.fn().mockResolvedValue({
			piSessionId: 'pi-1',
			status: 'idle',
			runtimeOpen: true,
		}),
		hasFinalMessage: vi.fn().mockResolvedValue(true),
		getLastMessage: vi.fn().mockResolvedValue('last'),
		isSpawnedSubAgent: vi
			.fn()
			.mockResolvedValue(overrides.spawnedSubAgent ?? false),
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
	board: {
		setWorkspaceStatus: vi.fn(),
		getWorkspaceStatus: vi.fn().mockReturnValue('backlog'),
	},
	diff: {
		readWorkspaceDiff: vi.fn().mockResolvedValue({
			baseRef: 'origin/master',
			diff: 'diff --git a/a.ts b/a.ts',
			omittedFiles: [],
			truncated: false,
		}),
	},
	review: {
		listComments: vi.fn().mockResolvedValue({ comments: [] }),
		addComments: vi.fn().mockResolvedValue({
			added: 1,
			commentIds: ['c-1'],
			message: 'Filed 1 review comment(s).',
		}),
	},
	permissions: { getMode: () => overrides.mode ?? 'workspace-trusted' },
	confirm: { confirm: vi.fn().mockResolvedValue(overrides.confirm ?? true) },
	ask: { ask: vi.fn(), releaseSession: vi.fn() },
	planMode: {
		activateForSpawn: vi.fn(),
		exit: vi.fn().mockResolvedValue({ planPath: 'p.md', summary: 'saved' }),
		isActive: vi.fn().mockReturnValue(overrides.planning ?? false),
		releaseSession: vi.fn(),
	},
	sessionNaming: {
		readBrief: vi.fn().mockResolvedValue({
			branch: { current: null, eligible: false },
			summaryStale: false,
			titleNeeded: false,
		}),
		setBranchName: vi.fn(),
		setSummary: vi.fn(),
	},
});

const setup = (
	options: {
		ports?: AgentControlPorts;
		guardrails?: Partial<GuardrailConfig>;
		species?: AgentSpecies;
	} = {},
) => {
	const registry = createOriginRegistry({ generateToken: () => 'tok-caller' });
	registry.register({
		sessionId: 'caller',
		workspaceId: 'ws',
		workspaceCwd: '/ws',
		species: options.species ?? 'pi',
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

describe('agent-control service: board status', () => {
	it('setWorkspaceStatus targets the caller own workspace and returns ok', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'setWorkspaceStatus',
			token: 'tok-caller',
			rawArgs: { status: 'in-review' },
		});
		expect(result.ok).toBe(true);
		expect(ports.board.setWorkspaceStatus).toHaveBeenCalledWith({
			workspaceId: 'ws',
			status: 'in-review',
		});
	});

	it('rejects an unknown board status', async () => {
		const { service } = setup();
		const result = await service.invoke({
			op: 'setWorkspaceStatus',
			token: 'tok-caller',
			rawArgs: { status: 'shipped' },
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('invalid-args');
		}
	});

	it('getWorkspaceStatus returns the caller own workspace status', async () => {
		const ports = makePorts();
		vi.mocked(ports.board.getWorkspaceStatus).mockReturnValue('done');
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'getWorkspaceStatus',
			token: 'tok-caller',
			rawArgs: {},
		});
		expect(ports.board.getWorkspaceStatus).toHaveBeenCalledWith('ws');
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toEqual({ status: 'done' });
		}
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

	// The workspace name and its git branch describe the whole body of work, so a
	// child naming them from inside one delegated unit would label the workspace
	// after a fragment. Marked-tab rather than depth, because lineage does not
	// survive a restart and a resumed child re-registers at depth 0.
	it('denies setBranchName to a caller whose tab is marked a sub-agent', async () => {
		const ports = makePorts({ spawnedSubAgent: true });
		const { service } = setup({ ports });

		const result = await service.invoke({
			op: 'setBranchName',
			token: 'tok-caller',
			rawArgs: { name: 'add-dark-mode' },
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('denied-scope');
		}
		expect(ports.sessionNaming.setBranchName).not.toHaveBeenCalled();
	});

	it('allows setBranchName from an unmarked root caller', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });

		const result = await service.invoke({
			op: 'setBranchName',
			token: 'tok-caller',
			rawArgs: { name: 'add-dark-mode' },
		});

		expect(result.ok).toBe(true);
		expect(ports.sessionNaming.setBranchName).toHaveBeenCalled();
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

	// The deadlock guard is now belt-and-braces: `sendFollowUp` is refused to a
	// sub-agent outright, and only a root — which has no ancestors — can reach it.
	// The role denial is the one a child actually meets, and it says something the
	// child can act on rather than naming a lineage it cannot see.
	it('refuses a sub-agent a follow-up on its ancestor, by role', async () => {
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
			expect(result.code).toBe('denied-scope');
			expect(result.error).toContain('no conversations of your own to steer');
		}
	});

	it('still refuses a wait targeting an ancestor at the guardrail', () => {
		const guardrails = createGuardrails();
		expect(guardrails.evaluateWaitTarget('ancestor', ['ancestor'])).toEqual({
			ok: false,
			code: 'denied-deadlock',
			reason: 'Refusing to wait on an ancestor session (would deadlock).',
		});
	});
});

// `parentSessionId` is never persisted, so a resumed conversation re-registers
// with no parent and lands at depth 0 — while its Plan Mode comes back from the
// renderer's per-tab store. Resolving the role from lineage alone would hand a
// restored investigator the orchestrator policy after a restart, or after its tab
// was closed and restored, and let it reach the three ops that policy denies.
describe('agent-control service: role of a resumed sub-agent', () => {
	const DENIED_WHILE_PLANNING: Record<string, Record<string, unknown>> = {
		exitPlanMode: { plan: '# Findings', title: 'Findings' },
		askUserQuestion: {
			questions: [
				{ options: [{ label: 'A' }, { label: 'B' }], question: 'Q?' },
			],
		},
		startConversation: { prompt: 'go' },
	};

	for (const op of Object.keys(DENIED_WHILE_PLANNING)) {
		it(`denies \`${op}\` to a planning depth-0 caller whose tab is marked a sub-agent`, async () => {
			const ports = makePorts({ planning: true, spawnedSubAgent: true });
			const { service } = setup({ ports });

			const result = await service.invoke({
				op: op as 'exitPlanMode',
				token: 'tok-caller',
				rawArgs: DENIED_WHILE_PLANNING[op],
			});

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.code).toBe('denied-scope');
			}
			expect(ports.planMode.exit).not.toHaveBeenCalled();
			expect(ports.ask.ask).not.toHaveBeenCalled();
			expect(ports.conversations.startConversation).not.toHaveBeenCalled();
		});

		it(`still allows \`${op}\` to a planning root with no sub-agent marker`, async () => {
			const ports = makePorts({ planning: true, spawnedSubAgent: false });
			const { service } = setup({ ports });

			const result = await service.invoke({
				op: op as 'exitPlanMode',
				token: 'tok-caller',
				rawArgs: DENIED_WHILE_PLANNING[op],
			});

			expect(result.ok).toBe(true);
		});
	}

	it('reads the marker for the caller’s own session', async () => {
		const ports = makePorts({ planning: true, spawnedSubAgent: true });
		const { service } = setup({ ports });

		await service.invoke({
			op: 'exitPlanMode',
			token: 'tok-caller',
			rawArgs: { plan: '# Findings', title: 'Findings' },
		});

		expect(ports.conversations.isSpawnedSubAgent).toHaveBeenCalledWith(
			'caller',
		);
	});
});

// Every caller here is registered at depth 0 with no parent and is NOT planning,
// which is exactly how a sub-agent comes back after a restart: the in-memory
// lineage is gone, so the spawn guardrail no longer denies it anything. Only the
// durable tab marker still says what it is, and these are the ops that used to
// unlock when it stopped saying so.
describe('agent-control service: sub-agent role gate outside plan mode', () => {
	const BLOCKED: Record<string, Record<string, unknown>> = {
		spawnChatTab: {},
		startConversation: { prompt: 'go' },
		sendFollowUp: { piSessionId: 'pi-1', prompt: 'hi' },
		launchHarness: { harnessId: 'claude' },
		startTerminal: { kind: 'spawn' },
		stopTerminal: { kind: 'run' },
		writeTerminal: { input: 'ls\n', terminalId: 'term-1' },
		openTab: { filePath: 'src/a.ts', variant: 'file' },
		closeTab: { chatTabId: 'abc' },
		setBranchName: { name: 'add-dark-mode' },
		setWorkspaceStatus: { status: 'done' },
		askUserQuestion: {
			questions: [
				{ options: [{ label: 'A' }, { label: 'B' }], question: 'Q?' },
			],
		},
		exitPlanMode: { plan: '# Findings', title: 'Findings' },
	};

	for (const op of Object.keys(BLOCKED)) {
		it(`denies \`${op}\` to a marked sub-agent that is not planning`, async () => {
			const ports = makePorts({ planning: false, spawnedSubAgent: true });
			const { service } = setup({ ports });

			const result = await service.invoke({
				op: op as 'closeTab',
				token: 'tok-caller',
				rawArgs: BLOCKED[op],
			});

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.code).toBe('denied-scope');
			}
		});
	}

	// The four ops with no gate of their own before this one: nothing else in the
	// service was checking the caller's role, its depth, or its lineage for them.
	it('performs none of the side effects it denies', async () => {
		const ports = makePorts({ planning: false, spawnedSubAgent: true });
		const { service } = setup({ ports });

		for (const op of Object.keys(BLOCKED)) {
			await service.invoke({
				op: op as 'closeTab',
				token: 'tok-caller',
				rawArgs: BLOCKED[op],
			});
		}

		expect(ports.board.setWorkspaceStatus).not.toHaveBeenCalled();
		expect(ports.tabs.closeTab).not.toHaveBeenCalled();
		expect(ports.terminals.stopTerminal).not.toHaveBeenCalled();
		expect(ports.terminals.writeTerminal).not.toHaveBeenCalled();
		expect(ports.harnesses.launchHarness).not.toHaveBeenCalled();
		expect(ports.conversations.startConversation).not.toHaveBeenCalled();
	});

	it('leaves the same ops open to an unmarked root', async () => {
		const ports = makePorts({ planning: false, spawnedSubAgent: false });
		const { service } = setup({ ports });

		for (const op of ['setWorkspaceStatus', 'closeTab', 'stopTerminal']) {
			const result = await service.invoke({
				op: op as 'closeTab',
				token: 'tok-caller',
				rawArgs: BLOCKED[op],
			});
			expect(result.ok).toBe(true);
		}
		expect(ports.board.setWorkspaceStatus).toHaveBeenCalled();
		expect(ports.tabs.closeTab).toHaveBeenCalled();
		expect(ports.terminals.stopTerminal).toHaveBeenCalled();
	});

	// A harness registers under a per-workspace session id with no parent, so it is
	// always a root and this policy never touches it. That matters because
	// `HARNESS_AWARENESS` advertises the whole surface and has no sub-agent
	// variant — narrowing a harness by role would leave its playbook describing
	// tools the service refuses.
	it('never narrows a harness caller, which is always a root', async () => {
		const ports = makePorts({ spawnedSubAgent: false });
		const { service } = setup({ ports, species: 'harness' });

		for (const op of ['setWorkspaceStatus', 'stopTerminal', 'closeTab']) {
			const result = await service.invoke({
				op: op as 'closeTab',
				token: 'tok-caller',
				rawArgs: BLOCKED[op],
			});
			expect(result.ok, `expected \`${op}\` to be allowed`).toBe(true);
		}
	});

	it('leaves a sub-agent every read it is promised', async () => {
		const ports = makePorts({ planning: false, spawnedSubAgent: true });
		const { service } = setup({ ports });

		for (const [op, rawArgs] of [
			['listTabs', {}],
			['listTerminals', {}],
			['listWorkspaces', {}],
			['getWorkspaceStatus', {}],
			['getConversationStatus', { piSessionId: 'pi-1' }],
			['getLastMessage', { piSessionId: 'pi-1' }],
			['readTerminalOutput', { terminalId: 'term-1' }],
			['focusTab', { chatTabId: 'abc' }],
			['focusPanel', { panel: 'changes' }],
			['setName', { name: 'Investigating the composer' }],
		] as const) {
			const result = await service.invoke({
				op: op as 'listTabs',
				token: 'tok-caller',
				rawArgs,
			});
			expect(result.ok, `expected \`${op}\` to be allowed`).toBe(true);
		}
	});
});

// The escape hatch used to key off `origin.parentSessionId`, which lives only in
// the in-memory registry — so a restart took it away at exactly the moment the
// depth counter stopped denying the child everything else.
describe('agent-control service: notifying the orchestrator', () => {
	it('accepts a signal from a marked sub-agent with no live lineage', async () => {
		const ports = makePorts({ spawnedSubAgent: true });
		const { service } = setup({ ports });

		const result = await service.invoke({
			op: 'notifyOrchestrator',
			token: 'tok-caller',
			rawArgs: { message: 'which framework?', reason: 'need_decision' },
		});

		expect(result.ok).toBe(true);
	});

	it('refuses a signal from a caller nobody spawned', async () => {
		const ports = makePorts({ spawnedSubAgent: false });
		const { service } = setup({ ports });

		const result = await service.invoke({
			op: 'notifyOrchestrator',
			token: 'tok-caller',
			rawArgs: { message: 'anyone there?', reason: 'progress' },
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('not-found');
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

	it('threads a spawn title through to startConversation', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });
		await service.invoke({
			op: 'startConversation',
			token: 'tok-caller',
			rawArgs: { prompt: 'go', title: 'Refactor auth' },
		});
		expect(ports.conversations.startConversation).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'Refactor auth' }),
		);
	});

	it('setName targets the caller’s own session', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'setName',
			token: 'tok-caller',
			rawArgs: { name: 'My task tab' },
		});
		expect(result.ok).toBe(true);
		expect(ports.conversations.setName).toHaveBeenCalledWith({
			piSessionId: 'caller',
			name: 'My task tab',
		});
	});

	it('setName refuses a harness caller, whose tab titles itself', async () => {
		const ports = makePorts();
		const { service } = setup({ ports, species: 'harness' });
		const result = await service.invoke({
			op: 'setName',
			token: 'tok-caller',
			rawArgs: { name: 'My task tab' },
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('denied-scope');
		}
		expect(ports.conversations.setName).not.toHaveBeenCalled();
	});

	it('setName reports not-found when the caller session is inactive', async () => {
		const ports = makePorts();
		(ports.conversations.setName as ReturnType<typeof vi.fn>).mockResolvedValue(
			null,
		);
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'setName',
			token: 'tok-caller',
			rawArgs: { name: 'x' },
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('not-found');
		}
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

	it('wraps the last assistant message for getLastMessage', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'getLastMessage',
			token: 'tok-caller',
			rawArgs: { piSessionId: 'pi-1' },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toEqual({ message: 'last' });
		}
	});

	it('keeps a missing last message as an explicit null, not an empty envelope', async () => {
		const ports = makePorts();
		ports.conversations.getLastMessage = vi.fn().mockResolvedValue(null);
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'getLastMessage',
			token: 'tok-caller',
			rawArgs: { piSessionId: 'pi-1' },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toEqual({ message: null });
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

describe('agent-control service: review', () => {
	it('reads the diff for the caller’s own workspace', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'getWorkspaceDiff',
			token: 'tok-caller',
			rawArgs: { stat: true },
		});
		expect(result.ok).toBe(true);
		expect(ports.diff.readWorkspaceDiff).toHaveBeenCalledWith({
			file: undefined,
			stat: true,
			workspaceCwd: '/ws',
			workspaceId: 'ws',
		});
	});

	it('passes a single-file request straight through', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });
		await service.invoke({
			op: 'getWorkspaceDiff',
			token: 'tok-caller',
			rawArgs: { file: 'src/a.ts' },
		});
		expect(ports.diff.readWorkspaceDiff).toHaveBeenCalledWith(
			expect.objectContaining({ file: 'src/a.ts', stat: undefined }),
		);
	});

	it('narrows a comment read to one file', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });
		await service.invoke({
			op: 'getDiffComments',
			token: 'tok-caller',
			rawArgs: { file: 'src/a.ts' },
		});
		expect(ports.review.listComments).toHaveBeenCalledWith({
			file: 'src/a.ts',
			workspaceId: 'ws',
		});
	});

	// The write takes no workspace argument at all, so a cross-workspace comment
	// is unreachable by construction rather than by a check that could be missed.
	it('binds a comment write to the caller’s workspace', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'addDiffComments',
			token: 'tok-caller',
			rawArgs: {
				comments: [{ body: 'nit', filePath: 'src/a.ts', lineNumber: 3 }],
			},
		});
		expect(result.ok).toBe(true);
		expect(ports.review.addComments).toHaveBeenCalledWith({
			comments: [{ body: 'nit', filePath: 'src/a.ts', lineNumber: 3 }],
			workspaceId: 'ws',
		});
	});

	it('allows both review reads in read-only mode', async () => {
		const { service } = setup({ ports: makePorts({ mode: 'read-only' }) });
		for (const op of ['getWorkspaceDiff', 'getDiffComments'] as const) {
			expect(
				(await service.invoke({ op, token: 'tok-caller', rawArgs: {} })).ok,
			).toBe(true);
		}
	});

	it('blocks the comment write in read-only mode', async () => {
		const ports = makePorts({ mode: 'read-only' });
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'addDiffComments',
			token: 'tok-caller',
			rawArgs: { comments: [{ body: 'nit', filePath: 'src/a.ts' }] },
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('denied-permission');
		}
		expect(ports.review.addComments).not.toHaveBeenCalled();
	});

	// A delegated reviewer filing comments is the point of the op, so the
	// sub-agent role must not withhold any of the three.
	it('leaves all three available to a spawned sub-agent', async () => {
		const ports = makePorts({ spawnedSubAgent: true });
		const { service } = setup({ ports });
		const results = await Promise.all([
			service.invoke({
				op: 'getWorkspaceDiff',
				token: 'tok-caller',
				rawArgs: {},
			}),
			service.invoke({
				op: 'getDiffComments',
				token: 'tok-caller',
				rawArgs: {},
			}),
			service.invoke({
				op: 'addDiffComments',
				token: 'tok-caller',
				rawArgs: { comments: [{ body: 'nit', filePath: 'src/a.ts' }] },
			}),
		]);
		expect(results.every((result) => result.ok)).toBe(true);
	});

	it('leaves all three available while planning', async () => {
		const ports = makePorts({ planning: true });
		const { service } = setup({ ports });
		const results = await Promise.all([
			service.invoke({
				op: 'getWorkspaceDiff',
				token: 'tok-caller',
				rawArgs: {},
			}),
			service.invoke({
				op: 'getDiffComments',
				token: 'tok-caller',
				rawArgs: {},
			}),
			service.invoke({
				op: 'addDiffComments',
				token: 'tok-caller',
				rawArgs: { comments: [{ body: 'nit', filePath: 'src/a.ts' }] },
			}),
		]);
		expect(results.every((result) => result.ok)).toBe(true);
	});

	it('reports a git failure as an internal error rather than an empty diff', async () => {
		const ports = makePorts();
		ports.diff.readWorkspaceDiff = vi
			.fn()
			.mockRejectedValue(new Error('fatal: not a git repository'));
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'getWorkspaceDiff',
			token: 'tok-caller',
			rawArgs: {},
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain('not a git repository');
		}
	});
});
