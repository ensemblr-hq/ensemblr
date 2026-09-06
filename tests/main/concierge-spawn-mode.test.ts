import { describe, expect, it, vi } from 'vitest';

import {
	type AgentControlPorts,
	createAgentControlService,
	createGuardrails,
	createOriginRegistry,
} from '../../src/main/agent-control/index.ts';
import { CONCIERGE_AWARENESS } from '../../src/shared/agent-control.ts';

const CONCIERGE = 'concierge-1';
const ORCHESTRATOR = 'orchestrator-1';
const WORKSPACE = 'ws';

/**
 * Ports with the collaborators a spawn touches. `conversations.startConversation`
 * is the assertion surface: the modes are resolved in the service and handed to
 * the port, so what the port was called with is the whole decision.
 */
const makePorts = (unattended: boolean): AgentControlPorts =>
	({
		workspaces: {
			listWorkspaces: vi
				.fn()
				.mockResolvedValue([{ cwd: '/ws', workspaceId: WORKSPACE }]),
		},
		tabs: { resolveTabWorkspace: vi.fn().mockResolvedValue(WORKSPACE) },
		conversations: {
			startConversation: vi.fn().mockResolvedValue({
				agentSessionId: 'child-1',
				chatTabId: 'tab-1',
				ok: true,
			}),
			waitForIdle: vi.fn().mockResolvedValue('completed'),
			isSpawnedSubAgent: vi.fn().mockResolvedValue(false),
		},
		focus: { focusTab: vi.fn(), focusDockTab: vi.fn(), focusPanel: vi.fn() },
		permissions: { getMode: () => 'workspace-trusted' },
		language: { getLanguage: () => 'en' },
		confirm: { confirm: vi.fn().mockResolvedValue(true) },
		ask: { ask: vi.fn(), releaseSession: vi.fn() },
		planMode: {
			exit: vi.fn(),
			hasSubmittedPlan: vi.fn(() => false),
			isActive: vi.fn(() => false),
			activateForSpawn: vi.fn(),
			releaseSession: vi.fn(),
		},
		afkMode: {
			isActive: vi.fn(() => unattended),
			activateForSpawn: vi.fn(),
			releaseSession: vi.fn(),
		},
		linear: { readLinkedIssue: vi.fn().mockReturnValue(null) },
	}) as unknown as AgentControlPorts;

const setup = (options: { unattended?: boolean } = {}) => {
	let issued = 0;
	const registry = createOriginRegistry({
		generateToken: () => {
			issued += 1;
			return `tok-${issued}`;
		},
	});
	registry.register({
		concierge: true,
		sessionId: CONCIERGE,
		species: 'pi',
		workspaceCwd: '/root/concierge',
		workspaceId: '',
	});
	registry.register({
		sessionId: ORCHESTRATOR,
		species: 'pi',
		workspaceCwd: '/ws',
		workspaceId: WORKSPACE,
	});
	const ports = makePorts(options.unattended ?? false);
	const service = createAgentControlService({
		guardrails: createGuardrails(),
		originRegistry: registry,
		ports,
	});
	return {
		ports,
		/** Dispatches a spawn as one of the two registered callers. */
		spawn: (sessionId: string, rawArgs: Record<string, unknown>) =>
			service.invoke({
				op: 'startConversation',
				rawArgs,
				token: registry.resolveBySession(sessionId)?.token ?? '',
			}),
		/** What the port was handed, for the spawn under test. */
		spawnedWith: () =>
			vi.mocked(ports.conversations.startConversation).mock.calls.at(0)?.[0],
	};
};

describe('the Concierge states the mode a spawn opens in', () => {
	it('opens an unattended orchestrator when it asks for one', async () => {
		const { spawn, spawnedWith } = setup();

		const result = await spawn(CONCIERGE, {
			afkMode: true,
			prompt: 'ship the Linear fix tonight',
			workspaceId: WORKSPACE,
		});

		expect(result.ok).toBe(true);
		expect(spawnedWith()).toMatchObject({ afkMode: true, planMode: false });
	});

	it('opens a planning orchestrator when it asks for one', async () => {
		const { spawn, spawnedWith } = setup();

		const result = await spawn(CONCIERGE, {
			planMode: true,
			prompt: 'work out how the migration should go',
			workspaceId: WORKSPACE,
		});

		expect(result.ok).toBe(true);
		expect(spawnedWith()).toMatchObject({ afkMode: false, planMode: true });
	});

	it('opens an ordinary orchestrator when it states neither', async () => {
		const { spawn, spawnedWith } = setup();

		await spawn(CONCIERGE, {
			prompt: 'take this on',
			workspaceId: WORKSPACE,
		});

		expect(spawnedWith()).toMatchObject({ afkMode: false, planMode: false });
	});

	// The IPC path resolves this collision in Plan Mode's favour because a stale
	// window has no turn to be corrected in. A model does, so it is told.
	it('refuses a spawn that states both modes', async () => {
		const { ports, spawn } = setup();

		const result = await spawn(CONCIERGE, {
			afkMode: true,
			planMode: true,
			prompt: 'both at once',
			workspaceId: WORKSPACE,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('invalid-args');
			expect(result.error).toContain('opposites');
		}
		expect(ports.conversations.startConversation).not.toHaveBeenCalled();
	});

	// `waitTimeoutMs` is five minutes and the unattended loop runs for hours, so
	// the wait could only ever return `timeout`.
	it('refuses an unattended spawn it also asks to wait on', async () => {
		const { ports, spawn } = setup();

		const result = await spawn(CONCIERGE, {
			afkMode: true,
			prompt: 'ship the Linear fix tonight',
			wait: true,
			workspaceId: WORKSPACE,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('invalid-args');
			expect(result.error).toContain('drop `wait`');
		}
		expect(ports.conversations.startConversation).not.toHaveBeenCalled();
	});
});

describe('every other caller passes its own mode down', () => {
	it.each(['afkMode', 'planMode'] as const)(
		'refuses `%s` from a workspace agent',
		async (flag) => {
			const { ports, spawn } = setup();

			const result = await spawn(ORCHESTRATOR, {
				[flag]: true,
				prompt: 'answer one question for me',
			});

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.code).toBe('invalid-args');
				expect(result.error).toContain('Only the Concierge');
			}
			expect(ports.conversations.startConversation).not.toHaveBeenCalled();
		},
	);

	it('still inherits AFK from an unattended caller that states nothing', async () => {
		const { spawn, spawnedWith } = setup({ unattended: true });

		await spawn(ORCHESTRATOR, { prompt: 'answer one question for me' });

		expect(spawnedWith()).toMatchObject({ afkMode: true });
	});

	// The unattended Concierge below is fabricated: the gate refuses both flags
	// from every caller that inherits a mode, and the Concierge has no composer
	// chip to inherit from, so no caller can reach this state yet. The test exists
	// so the OR guarding it is not quietly rewritten as a coalesce — which would
	// let a Concierge that later grows a chip of its own open a child less
	// restricted than itself.
	it('keeps an inherited mode when a future caller could hold one', async () => {
		const { spawn, spawnedWith } = setup({ unattended: true });

		await spawn(CONCIERGE, {
			afkMode: false,
			prompt: 'take this on',
			workspaceId: WORKSPACE,
		});

		expect(spawnedWith()).toMatchObject({ afkMode: true });
	});
});

describe('the Concierge playbook', () => {
	it('names both flags and says they are its alone', () => {
		expect(CONCIERGE_AWARENESS).toContain('`afkMode: true`');
		expect(CONCIERGE_AWARENESS).toContain('`planMode: true`');
		expect(CONCIERGE_AWARENESS).toContain('Both flags are yours alone');
	});

	it('says what AFK takes away and what it obliges in exchange', () => {
		expect(CONCIERGE_AWARENESS).toContain('ensemblr_ask_user_question');
		expect(CONCIERGE_AWARENESS).toContain('approved without being raised');
		expect(CONCIERGE_AWARENESS).toContain('opens a pull request');
	});

	it('ties the flag to the user saying they are going', () => {
		expect(CONCIERGE_AWARENESS).toContain(
			'only because the user has said they are going',
		);
	});

	it('states that the two modes cannot be combined', () => {
		expect(CONCIERGE_AWARENESS).toContain(
			'`planMode` and `afkMode` are opposites',
		);
	});

	// `notifyOrchestrator` answers `not-found` to anything whose role is not
	// `subagent`, and what the Concierge spawns is a root orchestrator.
	it('names the op that actually reaches it from a blocked child', () => {
		expect(CONCIERGE_AWARENESS).toContain(
			'`ensemblr_message_concierge` and reason `blocked`',
		);
	});
});
