import { describe, expect, it, vi } from 'vitest';

import {
	type AgentControlPorts,
	createAgentControlService,
	createGuardrails,
	createOriginRegistry,
} from '../../src/main/agent-control/index.ts';

const CALLER = 'caller';

/**
 * The ports an unattended caller runs behind. `permissions` and `confirm` are
 * the two the AFK cases turn on: the mode decides which boundary an op lands on,
 * and the spy is what proves no dialog was raised.
 */
const makePorts = (options: {
	unattended: boolean;
	permissionMode: 'approval-required' | 'read-only' | 'workspace-trusted';
	confirm: ReturnType<typeof vi.fn>;
	ask: ReturnType<typeof vi.fn>;
}): AgentControlPorts =>
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
				agentSessionId: 'pi-1',
				chatTabId: 't',
				ok: true,
			}),
			sendFollowUp: vi.fn().mockResolvedValue(undefined),
			setName: vi.fn().mockResolvedValue({ chatTabId: 't', title: 'Named' }),
			waitForIdle: vi.fn().mockResolvedValue('completed'),
			getStatus: vi.fn().mockResolvedValue(null),
			hasFinalMessage: vi.fn().mockResolvedValue(false),
			getLastMessage: vi.fn().mockResolvedValue('last'),
			listModels: vi
				.fn()
				.mockResolvedValue({ defaultModelId: 'm', models: [] }),
			isSpawnedSubAgent: vi.fn().mockResolvedValue(false),
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
		permissions: { getMode: () => options.permissionMode },
		language: { getLanguage: () => 'en' },
		confirm: { confirm: options.confirm },
		ask: { ask: options.ask, releaseSession: vi.fn() },
		planMode: {
			exit: vi.fn(),
			hasSubmittedPlan: vi.fn(() => false),
			isActive: vi.fn(() => false),
			activateForSpawn: vi.fn(),
			releaseSession: vi.fn(),
		},
		afkMode: {
			isActive: vi.fn(() => options.unattended),
			activateForSpawn: vi.fn(),
			releaseSession: vi.fn(),
		},
		sessionNaming: {
			readBrief: vi.fn().mockResolvedValue({
				branch: { current: null, eligible: false },
				diagram: { components: [], stale: false },
				summaryStale: false,
				titleNeeded: false,
			}),
		},
		linear: { readLinkedIssue: vi.fn().mockReturnValue(null) },
	}) as unknown as AgentControlPorts;

const setup = (options: {
	unattended: boolean;
	permissionMode?: 'approval-required' | 'read-only' | 'workspace-trusted';
}) => {
	const confirm = vi.fn().mockResolvedValue(true);
	const ask = vi.fn().mockResolvedValue({ answers: [], cancelled: false });
	const registry = createOriginRegistry({ generateToken: () => 'tok-caller' });
	registry.register({
		sessionId: CALLER,
		species: 'pi',
		workspaceCwd: '/ws',
		workspaceId: 'ws',
	});
	const ports = makePorts({
		ask,
		confirm,
		permissionMode: options.permissionMode ?? 'workspace-trusted',
		unattended: options.unattended,
	});
	const service = createAgentControlService({
		guardrails: createGuardrails(),
		originRegistry: registry,
		ports,
	});
	return { ask, confirm, ports, service };
};

const invoke = (
	service: ReturnType<typeof setup>['service'],
	op: Parameters<typeof service.invoke>[0]['op'],
	rawArgs: Record<string, unknown> = {},
) => service.invoke({ op, rawArgs, token: 'tok-caller' });

const QUESTIONS = {
	questions: [
		{
			question: 'Which approach?',
			options: [{ label: 'A' }, { label: 'B' }],
		},
	],
};

describe('afk mode: the ask tool', () => {
	it('refuses `askUserQuestion` and never raises the dialog', async () => {
		const { ask, service } = setup({ unattended: true });

		const result = await invoke(service, 'askUserQuestion', QUESTIONS);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('denied-scope');
		}
		expect(ask).not.toHaveBeenCalled();
	});

	it('tells the agent what to do instead of asking', async () => {
		const { service } = setup({ unattended: true });

		const result = await invoke(service, 'askUserQuestion', QUESTIONS);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain('they are away');
			expect(result.error).toContain('assumption');
		}
	});

	it('leaves the tool alone while the user is present', async () => {
		const { ask, service } = setup({ unattended: false });

		const result = await invoke(service, 'askUserQuestion', QUESTIONS);

		expect(result.ok).toBe(true);
		expect(ask).toHaveBeenCalledOnce();
	});

	it('refuses nothing else', async () => {
		const { service } = setup({ unattended: true });

		const result = await invoke(service, 'listWorkspaces');

		expect(result.ok).toBe(true);
	});
});

describe('afk mode: permission confirmations', () => {
	it('approves a confirmation-required op without raising a dialog', async () => {
		const { confirm, ports, service } = setup({
			permissionMode: 'approval-required',
			unattended: true,
		});

		const result = await invoke(service, 'startTerminal', { kind: 'run' });

		expect(result.ok).toBe(true);
		expect(confirm).not.toHaveBeenCalled();
		expect(ports.terminals.startTerminal).toHaveBeenCalledOnce();
	});

	it('still raises the dialog while the user is present', async () => {
		const { confirm, service } = setup({
			permissionMode: 'approval-required',
			unattended: false,
		});

		const result = await invoke(service, 'startTerminal', { kind: 'run' });

		expect(result.ok).toBe(true);
		expect(confirm).toHaveBeenCalledOnce();
	});

	it('leaves a blocked boundary blocked — AFK answers, it never widens', async () => {
		const { ports, service } = setup({
			permissionMode: 'read-only',
			unattended: true,
		});

		const result = await invoke(service, 'startTerminal', { kind: 'run' });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('denied-permission');
		}
		expect(ports.terminals.startTerminal).not.toHaveBeenCalled();
	});
});

describe('afk mode: the peer-orchestrator confirmation', () => {
	it('refuses a peer spawn instead of waiting on a dialog nobody will answer', async () => {
		const { confirm, ports, service } = setup({ unattended: true });

		const result = await invoke(service, 'startConversation', {
			peer: true,
			prompt: 'take the other half',
			title: 'Peer',
			workspaceId: 'ws',
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('denied-permission');
			expect(result.error).toContain('they are away');
		}
		// Not auto-approved the way the permission gate's dialog is: a peer is only
		// ever opened because the user asked for one.
		expect(confirm).not.toHaveBeenCalled();
		expect(ports.tabs.spawnChatTab).not.toHaveBeenCalled();
	});

	it('still asks the user while they are present', async () => {
		const { confirm, service } = setup({ unattended: false });

		await invoke(service, 'startConversation', {
			peer: true,
			prompt: 'take the other half',
			title: 'Peer',
			workspaceId: 'ws',
		});

		expect(confirm).toHaveBeenCalledOnce();
	});
});
