import { describe, expect, it, vi } from 'vitest';

import {
	type AgentControlPorts,
	type AgentSpecies,
	createAgentControlService,
	createGuardrails,
	createOriginRegistry,
	type GuardrailConfig,
} from '../../src/main/agent-control/index.ts';
import {
	CONCIERGE_AWARENESS,
	PLAN_REFINEMENT_DIRECTIVE,
} from '../../src/shared/agent-control.ts';
import type { AppLanguage } from '../../src/shared/i18n.ts';
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
		planSubmitted: boolean;
		spawnedSubAgent: boolean;
		language: AppLanguage;
	}> = {},
): AgentControlPorts => ({
	workspaces: {
		listProjects: vi.fn().mockResolvedValue([]),
		listWorkspaces: vi.fn().mockResolvedValue([]),
	},
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
			.mockResolvedValue({ ok: true, chatTabId: 't', agentSessionId: 'pi-1' }),
		sendFollowUp: vi.fn().mockResolvedValue(undefined),
		setName: vi
			.fn()
			.mockResolvedValue({ chatTabId: 'named-tab', title: 'Named' }),
		waitForIdle: vi.fn().mockResolvedValue('completed'),
		getStatus: vi.fn().mockResolvedValue({
			agentSessionId: 'pi-1',
			status: 'idle',
			runtimeOpen: true,
		}),
		hasFinalMessage: vi.fn().mockResolvedValue(true),
		getLastMessage: vi.fn().mockResolvedValue('last'),
		readTranscript: vi.fn().mockResolvedValue({
			entries: [],
			entryCount: 0,
			firstOrdinal: null,
			lastOrdinal: null,
			nextOrdinal: null,
			agentSessionId: 'pi-1',
			turnCount: 0,
		}),
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
		startTerminal: vi
			.fn()
			.mockResolvedValue({ ok: true, terminalId: 'term-1' }),
		stopTerminal: vi.fn().mockResolvedValue(undefined),
		writeTerminal: vi.fn().mockResolvedValue(undefined),
		readOutput: vi.fn().mockResolvedValue('output'),
		listTerminals: vi.fn().mockResolvedValue([]),
		listRunScripts: vi.fn().mockResolvedValue({
			scripts: [
				{ command: 'npm run dev', isDefault: true, name: 'dev' },
				{
					command: 'npm run dev:playground',
					isDefault: false,
					name: 'playground',
				},
			],
		}),
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
		focusWorkspace: vi.fn(),
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
		resolveComments: vi.fn().mockResolvedValue({
			alreadyResolved: [],
			message: 'Resolved 1 review comment(s).',
			notFound: [],
			resolved: 1,
			resolvedIds: ['c-1'],
		}),
	},
	linear: {
		readLinkedIssue: vi.fn().mockReturnValue(null),
		listIssues: vi.fn().mockResolvedValue({
			issues: [],
			message: '0 issue(s).',
			omittedIssues: 0,
			source: 'cache',
			status: 'ok',
			truncated: false,
		}),
		getIssue: vi.fn().mockResolvedValue({
			comments: [],
			issue: null,
			message: 'read',
			omittedComments: 0,
			source: 'cache',
			status: 'ok',
			truncated: false,
		}),
		getMetadata: vi.fn().mockResolvedValue({
			labels: [],
			message: 'metadata',
			omittedResources: 0,
			projects: [],
			states: [],
			syncedAt: null,
			teams: [],
			truncated: false,
			status: 'ok',
			users: [],
		}),
		createComment: vi.fn().mockResolvedValue({
			commentId: 'lc-1',
			message: 'Comment posted.',
			status: 'ok',
		}),
		createIssue: vi.fn().mockResolvedValue({
			issue: null,
			message: 'Filed ENG-2.',
			status: 'ok',
		}),
		updateIssue: vi.fn().mockResolvedValue({
			issue: null,
			message: 'ENG-1 updated.',
			status: 'ok',
		}),
	},
	permissions: { getMode: () => overrides.mode ?? 'workspace-trusted' },
	commitCredit: { isCoAuthorEnabled: () => false },
	language: { getLanguage: () => overrides.language ?? 'en' },
	confirm: { confirm: vi.fn().mockResolvedValue(overrides.confirm ?? true) },
	ask: { ask: vi.fn(), releaseSession: vi.fn() },
	planMode: {
		activateForSpawn: vi.fn(),
		exit: vi.fn().mockResolvedValue({ planPath: 'p.md', summary: 'saved' }),
		hasSubmittedPlan: vi.fn().mockReturnValue(overrides.planSubmitted ?? false),
		isActive: vi.fn().mockReturnValue(overrides.planning ?? false),
		releaseSession: vi.fn(),
	},
	sessionNaming: {
		readBrief: vi.fn().mockResolvedValue({
			branch: { current: null, eligible: false },
			diagram: { components: [], stale: false },
			summaryStale: false,
			titleNeeded: false,
		}),
		setBranchName: vi.fn(),
		setSummary: vi.fn(),
	},
});

const setup = (
	options: {
		concierge?: boolean;
		ports?: AgentControlPorts;
		guardrails?: Partial<GuardrailConfig>;
		species?: AgentSpecies;
		dispatchTimeoutMs?: number;
		architectureDiagram?: boolean;
	} = {},
) => {
	const registry = createOriginRegistry({ generateToken: () => 'tok-caller' });
	registry.register({
		sessionId: 'caller',
		workspaceId: options.concierge ? '' : 'ws',
		concierge: options.concierge ?? false,
		workspaceCwd: '/ws',
		species: options.species ?? 'pi',
	});
	const ports = options.ports ?? makePorts();
	const service = createAgentControlService({
		dispatchTimeoutMs: options.dispatchTimeoutMs,
		ports,
		originRegistry: registry,
		guardrails: createGuardrails(options.guardrails),
		readArchitectureDiagramEnabled: () => options.architectureDiagram ?? true,
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

	// The prompt is native and cannot be taken off screen, so the user may well
	// click Allow an hour after the client gave up. The op must not run then:
	// spawning a tab for a caller that stopped listening is the same failure
	// `askUserQuestion` has, on the surface that fronts every gated write.
	it('runs nothing when the caller goes away before the prompt is answered', async () => {
		const controller = new AbortController();
		const ports = makePorts({ mode: 'approval-required' });
		ports.confirm.confirm = vi.fn(async ({ signal }) => {
			controller.abort();
			return !signal?.aborted;
		});
		const { service } = setup({ ports });

		const result = await service.invoke({
			op: 'spawnChatTab',
			rawArgs: {},
			signal: controller.signal,
			token: 'tok-caller',
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('timeout');
			expect(result.error).toMatch(/nothing was changed/i);
		}
		expect(ports.tabs.spawnChatTab).not.toHaveBeenCalled();
	});

	it('hands the prompt the caller’s signal so it can stop waiting', async () => {
		const controller = new AbortController();
		const ports = makePorts({ mode: 'approval-required', confirm: true });
		const { service } = setup({ ports });

		await service.invoke({
			op: 'spawnChatTab',
			rawArgs: {},
			signal: controller.signal,
			token: 'tok-caller',
		});

		expect(ports.confirm.confirm).toHaveBeenCalledWith(
			expect.objectContaining({ signal: controller.signal }),
		);
	});
});

// The client-side ceiling is a day and applies per server, so the app has to
// bound the ops that are not supposed to block — otherwise one wedged port holds
// the agent for that day while the progress heartbeat reports it healthy.
describe('agent-control service: the deadline on a non-blocking op', () => {
	it('answers a wedged op instead of blocking on it forever', async () => {
		const ports = makePorts();
		ports.workspaces.listWorkspaces = vi.fn(() => new Promise<never>(() => {}));
		const { service } = setup({ dispatchTimeoutMs: 20, ports });

		const result = await service.invoke({
			op: 'listWorkspaces',
			rawArgs: {},
			token: 'tok-caller',
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('timeout');
		}
	});

	it('leaves a wait that blocks by design alone', async () => {
		const ports = makePorts();
		ports.conversations.waitForIdle = vi.fn(async () => {
			await new Promise((tick) => setTimeout(tick, 60));
			return 'completed' as const;
		});
		const { service } = setup({ dispatchTimeoutMs: 20, ports });

		const result = await service.invoke({
			op: 'sendFollowUp',
			rawArgs: {
				agentSessionId: 'child',
				prompt: 'keep going',
				wait: true,
			},
			token: 'tok-caller',
		});

		expect(result.ok).toBe(true);
		expect(ports.conversations.waitForIdle).toHaveBeenCalledOnce();
	});

	it('stops a child wait once the caller goes away', async () => {
		const controller = new AbortController();
		const ports = makePorts();
		const { service } = setup({ ports });

		const call = service.invoke({
			op: 'sendFollowUp',
			rawArgs: { agentSessionId: 'child', prompt: 'keep going', wait: true },
			signal: controller.signal,
			token: 'tok-caller',
		});
		controller.abort();
		await call;

		expect(ports.conversations.waitForIdle).toHaveBeenCalledWith(
			'child',
			expect.any(Number),
			controller.signal,
		);
	});
});

describe('agent-control service: review comments', () => {
	// Both ops gained `workspaceId` so the Concierge can review a workspace it
	// does not live in, which retired the schema-level rejection that used to
	// stop a workspace agent naming another one. This is where that check landed.
	it.each(['addDiffComments', 'resolveDiffComments'] as const)(
		'refuses a workspace agent that names another workspace on %s',
		async (op) => {
			const ports = makePorts();
			const { service } = setup({ ports });

			const result = await service.invoke({
				op,
				token: 'tok-caller',
				rawArgs:
					op === 'addDiffComments'
						? {
								comments: [{ body: 'nit', filePath: 'src/a.ts' }],
								workspaceId: 'ws-other',
							}
						: { commentIds: ['c-1'], workspaceId: 'ws-other' },
			});

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.code).toBe('denied-scope');
			}
			expect(ports.review.addComments).not.toHaveBeenCalled();
			expect(ports.review.resolveComments).not.toHaveBeenCalled();
		},
	);

	// The comment roll-up lives in Checks, so the port pulls the user there
	// rather than leaving the behaviour to a model remembering to focus.
	it('lands the user in Checks after filing comments', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'addDiffComments',
			token: 'tok-caller',
			rawArgs: { comments: [{ body: 'nit', filePath: 'src/a.ts' }] },
		});
		expect(result.ok).toBe(true);
		expect(ports.focus.focusPanel).toHaveBeenCalledWith({
			panel: 'checks',
			workspaceId: 'ws',
		});
	});

	it('lands the user in Checks after resolving comments', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });
		await service.invoke({
			op: 'resolveDiffComments',
			token: 'tok-caller',
			rawArgs: { commentIds: ['c-1'] },
		});
		expect(ports.focus.focusPanel).toHaveBeenCalledWith({
			panel: 'checks',
			workspaceId: 'ws',
		});
	});

	// Nothing closed means nothing new to look at, so moving the user would be a
	// yank with no payload behind it.
	it('leaves the user where they are when a resolve batch closes nothing', async () => {
		const ports = makePorts();
		vi.mocked(ports.review.resolveComments).mockResolvedValue({
			alreadyResolved: ['c-1'],
			message: 'Resolved nothing.',
			notFound: [],
			resolved: 0,
			resolvedIds: [],
		});
		const { service } = setup({ ports });
		await service.invoke({
			op: 'resolveDiffComments',
			token: 'tok-caller',
			rawArgs: { commentIds: ['c-1'] },
		});
		expect(ports.focus.focusPanel).not.toHaveBeenCalled();
	});

	it('pulls focus once for a batch of comment ops in one turn', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });
		await service.invoke({
			op: 'addDiffComments',
			token: 'tok-caller',
			rawArgs: { comments: [{ body: 'nit', filePath: 'src/a.ts' }] },
		});
		await service.invoke({
			op: 'addDiffComments',
			token: 'tok-caller',
			rawArgs: { comments: [{ body: 'another', filePath: 'src/b.ts' }] },
		});
		await service.invoke({
			op: 'resolveDiffComments',
			token: 'tok-caller',
			rawArgs: { commentIds: ['c-1'] },
		});
		expect(ports.focus.focusPanel).toHaveBeenCalledTimes(1);
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
			rawArgs: { agentSessionId: 'ancestor', prompt: 'hi', wait: true },
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
		sendFollowUp: { agentSessionId: 'pi-1', prompt: 'hi' },
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
			['getConversationStatus', { agentSessionId: 'pi-1' }],
			['getLastMessage', { agentSessionId: 'pi-1' }],
			['readConversation', { agentSessionId: 'pi-1', stat: true }],
			['readTerminalOutput', { terminalId: 'term-1' }],
			['focusTab', { chatTabId: 'abc' }],
			['focusPanel', { panel: 'changes' }],
			['setName', { title: 'Investigating the composer' }],
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
				agentSessionId: 'pi-1',
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

	it('names the caller’s own runtime on the spawn, so a child cannot cross it', async () => {
		const ports = makePorts();
		const { service } = setup({ ports, species: 'claude' });
		await service.invoke({
			op: 'startConversation',
			token: 'tok-caller',
			rawArgs: { prompt: 'go' },
		});
		expect(ports.conversations.startConversation).toHaveBeenCalledWith(
			expect.objectContaining({ callerRuntime: 'claude' }),
		);
	});

	// A harness's control origin is minted per workspace and shared by every
	// terminal in it, so there is no runtime to inherit and the resolver says so.
	it('reports a harness caller as having no runtime rather than as Pi', async () => {
		const ports = makePorts();
		const { service } = setup({ ports, species: 'harness' });
		await service.invoke({
			op: 'startConversation',
			token: 'tok-caller',
			rawArgs: { prompt: 'go' },
		});
		expect(ports.conversations.startConversation).toHaveBeenCalledWith(
			expect.objectContaining({ callerRuntime: null }),
		);
	});

	// The agent can fix a refused model on its next turn, which an `internal`
	// envelope would read as a fault worth retrying verbatim.
	it('reports a cross-runtime model request as an argument failure', async () => {
		const ports = makePorts();
		ports.conversations.startConversation = vi
			.fn()
			.mockResolvedValue({ ok: false, reason: 'that model runs on Pi' });
		const { service } = setup({ ports, species: 'claude' });
		const result = await service.invoke({
			op: 'startConversation',
			token: 'tok-caller',
			rawArgs: { prompt: 'go', model: 'anthropic/sonnet' },
		});
		expect(result).toMatchObject({
			code: 'invalid-args',
			error: 'that model runs on Pi',
			ok: false,
		});
	});

	// A refused spawn never reached a runtime, so it must not eat a slot from the
	// fork-bomb budget the way a real one does.
	it('does not count a refused spawn against the spawn guardrail', async () => {
		const ports = makePorts();
		ports.conversations.startConversation = vi
			.fn()
			.mockResolvedValue({ ok: false, reason: 'name a model' });
		const { service } = setup({
			ports,
			guardrails: { maxSpawnsPerSession: 1 },
		});
		await service.invoke({
			op: 'startConversation',
			token: 'tok-caller',
			rawArgs: { prompt: 'go' },
		});
		ports.conversations.startConversation = vi
			.fn()
			.mockResolvedValue({ ok: true, chatTabId: 't', agentSessionId: 'pi-1' });
		const second = await service.invoke({
			op: 'startConversation',
			token: 'tok-caller',
			rawArgs: { prompt: 'go' },
		});

		expect(second).toMatchObject({ ok: true });
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
			rawArgs: { title: 'My task tab' },
		});
		expect(result.ok).toBe(true);
		expect(ports.conversations.setName).toHaveBeenCalledWith({
			agentSessionId: 'caller',
			name: 'My task tab',
		});
	});

	it('setName refuses a harness caller, whose tab titles itself', async () => {
		const ports = makePorts();
		const { service } = setup({ ports, species: 'harness' });
		const result = await service.invoke({
			op: 'setName',
			token: 'tok-caller',
			rawArgs: { title: 'My task tab' },
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
			rawArgs: { title: 'x' },
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
				completed: [{ agentSessionId: 'ghost', status: 'unknown' }],
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

	it('returns the workspace run scripts for listRunScripts', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'listRunScripts',
			token: 'tok-caller',
			rawArgs: {},
		});
		expect(ports.terminals.listRunScripts).toHaveBeenCalledWith({
			workspaceId: 'ws',
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toEqual({
				scripts: [
					{ command: 'npm run dev', isDefault: true, name: 'dev' },
					{
						command: 'npm run dev:playground',
						isDefault: false,
						name: 'playground',
					},
				],
			});
		}
	});

	// The whole point of naming a script: without this the port receives no name
	// and the lifecycle service falls back to the repository default.
	it('forwards the named run script to the terminal port', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'startTerminal',
			token: 'tok-caller',
			rawArgs: { kind: 'run', scriptName: 'playground' },
		});
		expect(result.ok).toBe(true);
		expect(ports.terminals.startTerminal).toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'run', scriptName: 'playground' }),
		);
	});

	it('rejects a run script name paired with a non-run terminal kind', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'startTerminal',
			token: 'tok-caller',
			rawArgs: { kind: 'spawn', scriptName: 'playground' },
		});
		expect(result.ok).toBe(false);
		expect(ports.terminals.startTerminal).not.toHaveBeenCalled();
	});

	// A launch nobody got used to answer with an empty terminal id inside a
	// success envelope, so the diagnostic naming the configured scripts — the one
	// thing that lets a caller correct a guess — never reached it.
	it('fails a startTerminal whose script never launched, with the reason', async () => {
		const ports = makePorts();
		vi.mocked(ports.terminals.startTerminal).mockResolvedValue({
			ok: false,
			code: 'script-not-configured',
			message:
				'No run script named "ghost" is configured for this repository. Configured run scripts: dev.',
		});
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'startTerminal',
			token: 'tok-caller',
			rawArgs: { kind: 'run', scriptName: 'ghost' },
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('not-found');
			expect(result.error).toContain('Configured run scripts: dev.');
		}
	});

	it('reports a run script already holding the workspace as a conflict', async () => {
		const ports = makePorts();
		vi.mocked(ports.terminals.startTerminal).mockResolvedValue({
			ok: false,
			code: 'script-already-running',
			message: 'The run script "dev" is already running.',
		});
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'startTerminal',
			token: 'tok-caller',
			rawArgs: { kind: 'run', scriptName: 'playground' },
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('conflict');
			expect(result.error).toContain('"dev"');
		}
	});

	// The refusal knows exactly which session it collided with, and an agent that
	// cannot see the dock has no other way to reach it. Withholding the id cost a
	// listTerminals round trip to recover what the refusal already knew.
	it('names the terminal a refused start collided with', async () => {
		const ports = makePorts();
		vi.mocked(ports.terminals.startTerminal).mockResolvedValue({
			ok: false,
			code: 'script-already-running',
			message: 'The run script "dev" is already running.',
			terminalId: 'term-dev',
		});
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'startTerminal',
			token: 'tok-caller',
			rawArgs: { kind: 'run', scriptName: 'playground' },
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain('term-dev');
			expect(result.error).toContain('restart: true');
		}
	});

	it('forwards restart to the terminal port', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });
		await service.invoke({
			op: 'startTerminal',
			token: 'tok-caller',
			rawArgs: { kind: 'run', restart: true, scriptName: 'dev' },
		});
		expect(ports.terminals.startTerminal).toHaveBeenCalledWith(
			expect.objectContaining({ restart: true, scriptName: 'dev' }),
		);
	});

	// A caller that just started a run script knows its kind, not its id. Making
	// it list every terminal to read the one it started is a round trip the start
	// call could have saved it.
	it('reads a script terminal by kind, echoing the id it resolved', async () => {
		const ports = makePorts();
		vi.mocked(ports.terminals.listTerminals).mockResolvedValue([
			{
				terminalId: 'term-stale',
				kind: 'run-script',
				scriptName: 'dev',
				status: 'exited',
				workspaceId: 'ws',
			},
			{
				terminalId: 'term-run',
				kind: 'run-script',
				scriptName: 'playground',
				status: 'running',
				workspaceId: 'ws',
			},
		]);
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'readTerminalOutput',
			token: 'tok-caller',
			rawArgs: { kind: 'run' },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toEqual({ terminalId: 'term-run', output: 'output' });
		}
		expect(ports.terminals.readOutput).toHaveBeenCalledWith({
			ansi: false,
			terminalId: 'term-run',
		});
	});

	it('answers not-found when no script of that kind is running', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'readTerminalOutput',
			token: 'tok-caller',
			rawArgs: { kind: 'setup' },
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('not-found');
		}
		expect(ports.terminals.readOutput).not.toHaveBeenCalled();
	});

	// Scrollback carries whatever the terminal has been shown, so reading one in
	// another workspace is the same crossing writing to it would be — and this op
	// is the one the surface withholds from nobody.
	it('refuses a terminal id belonging to another workspace', async () => {
		const ports = makePorts({ terminalWorkspace: 'ws-other' });
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'readTerminalOutput',
			token: 'tok-caller',
			rawArgs: { terminalId: 'term-elsewhere' },
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('denied-scope');
		}
		expect(ports.terminals.readOutput).not.toHaveBeenCalled();
	});

	it('does not resolve a workspace for a kind selector it scopes itself', async () => {
		const ports = makePorts({ terminalWorkspace: 'ws-other' });
		vi.mocked(ports.terminals.listTerminals).mockResolvedValue([
			{
				terminalId: 'term-run',
				kind: 'run-script',
				scriptName: 'dev',
				status: 'running',
				workspaceId: 'ws',
			},
		]);
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'readTerminalOutput',
			token: 'tok-caller',
			rawArgs: { kind: 'run' },
		});

		expect(result.ok).toBe(true);
		expect(ports.terminals.resolveTerminalWorkspace).not.toHaveBeenCalled();
	});

	it('passes ansi through to the port when the caller asks for raw bytes', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });
		await service.invoke({
			op: 'readTerminalOutput',
			token: 'tok-caller',
			rawArgs: { ansi: true, terminalId: 'term-1' },
		});
		expect(ports.terminals.readOutput).toHaveBeenCalledWith({
			ansi: true,
			terminalId: 'term-1',
		});
	});

	// A summary is the heaviest payload on the surface and the one whose whole
	// point is to survive the turn. Rejecting an over-long one spent a
	// multi-kilobyte re-emit per attempt and risked the record being dropped
	// rather than shortened.
	it('stores an over-long summary truncated rather than refusing it', async () => {
		const ports = makePorts();
		vi.mocked(ports.sessionNaming.setSummary).mockResolvedValue({
			capturedAtOrdinal: 4,
			message: 'Recorded.',
		});
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'setSummary',
			token: 'tok-caller',
			rawArgs: { summary: 'a'.repeat(4_200), title: 'Topic' },
		});

		expect(result.ok).toBe(true);
		expect(ports.sessionNaming.setSummary).toHaveBeenCalledWith(
			expect.objectContaining({ summary: 'a'.repeat(4_000) }),
		);
		if (result.ok) {
			expect(result.data).toMatchObject({
				truncated: [{ field: 'summary', limit: 4_000, submittedLength: 4_200 }],
			});
		}
	});

	// Fixing the one field it was told about and resubmitting would have got the
	// caller cut again on the other, which is the round trip truncation exists to
	// avoid in the first place.
	it('reports both fields when both are over their caps', async () => {
		const ports = makePorts();
		vi.mocked(ports.sessionNaming.setSummary).mockResolvedValue({
			capturedAtOrdinal: 4,
			message: 'Recorded.',
		});
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'setSummary',
			token: 'tok-caller',
			rawArgs: { summary: 'a'.repeat(4_200), title: 'T'.repeat(120) },
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toMatchObject({
				truncated: [
					{ field: 'summary', limit: 4_000, submittedLength: 4_200 },
					{ field: 'title', limit: 80, submittedLength: 120 },
				],
			});
			const { message } = result.data as { message: string };
			expect(message).toContain('4200');
			expect(message).toContain('120');
		}
	});

	// `slice` cuts by code unit, so a summary that ran over on an emoji stored a
	// lone surrogate — not a character anything reading the record can render.
	it('cuts a summary between characters, not through one', async () => {
		const ports = makePorts();
		vi.mocked(ports.sessionNaming.setSummary).mockResolvedValue({
			capturedAtOrdinal: 4,
			message: 'Recorded.',
		});
		const { service } = setup({ ports });
		await service.invoke({
			op: 'setSummary',
			token: 'tok-caller',
			rawArgs: { summary: 'Body.', title: `${'T'.repeat(79)}🙂` },
		});

		expect(ports.sessionNaming.setSummary).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'T'.repeat(79) }),
		);
	});

	it('names the limit and the length submitted in the message it returns', async () => {
		const ports = makePorts();
		vi.mocked(ports.sessionNaming.setSummary).mockResolvedValue({
			capturedAtOrdinal: 4,
			message: 'Recorded.',
		});
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'setSummary',
			token: 'tok-caller',
			rawArgs: { summary: 'Body.', title: 'T'.repeat(120) },
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			const { message } = result.data as { message: string };
			expect(message).toContain('120');
			expect(message).toContain('80');
		}
	});

	it('reports nothing truncated for a summary that fits', async () => {
		const ports = makePorts();
		vi.mocked(ports.sessionNaming.setSummary).mockResolvedValue({
			capturedAtOrdinal: 4,
			message: 'Recorded.',
		});
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'setSummary',
			token: 'tok-caller',
			rawArgs: { summary: 'Body.', title: 'Topic' },
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toEqual({
				capturedAtOrdinal: 4,
				message: 'Recorded.',
			});
		}
	});

	// A wrong guess is cheap to make and cheap to correct, so it must not cost a
	// spawn: the retry that names the right script has to still fit the quota.
	it('does not spend the spawn budget on a script that never launched', async () => {
		const ports = makePorts();
		vi.mocked(ports.terminals.startTerminal).mockResolvedValueOnce({
			ok: false,
			code: 'script-not-configured',
			message: 'No run script named "ghost" is configured for this repository.',
		});
		const { service } = setup({
			ports,
			guardrails: { maxSpawnsPerSession: 1 },
		});
		const guessed = await service.invoke({
			op: 'startTerminal',
			token: 'tok-caller',
			rawArgs: { kind: 'run', scriptName: 'ghost' },
		});
		const corrected = await service.invoke({
			op: 'startTerminal',
			token: 'tok-caller',
			rawArgs: { kind: 'run', scriptName: 'dev' },
		});
		expect(guessed.ok).toBe(false);
		expect(corrected.ok).toBe(true);
	});

	it('wraps the last assistant message for getLastMessage', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'getLastMessage',
			token: 'tok-caller',
			rawArgs: { agentSessionId: 'pi-1' },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toEqual({ message: 'last' });
		}
	});

	it('hands readConversation its page arguments rather than only the session', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'readConversation',
			token: 'tok-caller',
			rawArgs: { agentSessionId: 'pi-1', fromOrdinal: 12 },
		});
		expect(result.ok).toBe(true);
		expect(ports.conversations.readTranscript).toHaveBeenCalledWith({
			fromOrdinal: 12,
			agentSessionId: 'pi-1',
		});
	});

	it('rejects a readConversation cursor that is not a whole ordinal', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'readConversation',
			token: 'tok-caller',
			rawArgs: { agentSessionId: 'pi-1', fromOrdinal: -3 },
		});
		expect(result.ok).toBe(false);
		expect(ports.conversations.readTranscript).not.toHaveBeenCalled();
	});

	it('keeps a missing last message as an explicit null, not an empty envelope', async () => {
		const ports = makePorts();
		ports.conversations.getLastMessage = vi.fn().mockResolvedValue(null);
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'getLastMessage',
			token: 'tok-caller',
			rawArgs: { agentSessionId: 'pi-1' },
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
			rawArgs: { filePath: 'src/a.ts' },
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
			rawArgs: { filePath: 'src/a.ts' },
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

	it('resolves comments against the caller’s own workspace', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'resolveDiffComments',
			token: 'tok-caller',
			rawArgs: { commentIds: ['c-1', 'c-2'] },
		});
		expect(result.ok).toBe(true);
		expect(ports.review.resolveComments).toHaveBeenCalledWith({
			commentIds: ['c-1', 'c-2'],
			workspaceId: 'ws',
		});
	});

	// `workspaceId` is the Concierge's argument, not everyone's. This is the
	// assertion that would have caught the unscoped UPDATE the repository used to
	// run: even a caller that names another workspace never reaches the port.
	it('refuses a resolve that names another workspace', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'resolveDiffComments',
			token: 'tok-caller',
			rawArgs: { commentIds: ['c-1'], workspaceId: 'ws-other' },
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('denied-scope');
		}
		expect(ports.review.resolveComments).not.toHaveBeenCalled();
	});

	it('blocks the resolve in read-only mode', async () => {
		const ports = makePorts({ mode: 'read-only' });
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'resolveDiffComments',
			token: 'tok-caller',
			rawArgs: { commentIds: ['c-1'] },
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('denied-permission');
		}
		expect(ports.review.resolveComments).not.toHaveBeenCalled();
	});

	// An implementer child fixing review comments is the most likely caller of
	// this op in the whole app, so the sub-agent role must keep it.
	it('leaves the resolve available to a spawned sub-agent', async () => {
		const ports = makePorts({ spawnedSubAgent: true });
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'resolveDiffComments',
			token: 'tok-caller',
			rawArgs: { commentIds: ['c-1'] },
		});
		expect(result.ok).toBe(true);
	});

	// Resolving asserts "this is fixed", and `write`/`edit` are blocked while
	// planning — so every resolve from Plan Mode is a false claim by construction.
	it('refuses the resolve while planning, for either role', async () => {
		for (const spawnedSubAgent of [false, true]) {
			const ports = makePorts({ planning: true, spawnedSubAgent });
			const { service } = setup({ ports });
			const result = await service.invoke({
				op: 'resolveDiffComments',
				token: 'tok-caller',
				rawArgs: { commentIds: ['c-1'] },
			});
			expect(result.ok).toBe(false);
			expect(ports.review.resolveComments).not.toHaveBeenCalled();
		}
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

// Linear is an app-level integration bound to one account, so unlike the review
// ops none of these carries a workspace at all — which makes the permission mode
// and the sub-agent role the only two gates left to get right.
describe('agent-control service: linear', () => {
	const LINEAR_READS = {
		linearGetIssue: { issueId: 'ENG-106' },
		linearGetMetadata: {},
		linearListIssues: { query: 'composer' },
	} as const;

	const LINEAR_WRITES = {
		linearCreateComment: {
			commentBody: 'Done on the branch.',
			issueId: 'ENG-1',
		},
		linearUpdateIssue: { issueId: 'ENG-1', stateId: 's-review' },
	} as const;

	it('dispatches each read to its port with the args as sent', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });

		for (const [op, rawArgs] of Object.entries(LINEAR_READS)) {
			const result = await service.invoke({
				op: op as keyof typeof LINEAR_READS,
				token: 'tok-caller',
				rawArgs,
			});
			expect(result.ok, op).toBe(true);
		}
		// The calling workspace rides along on every Linear op: it is the default
		// account when the agent names none, and it is added at dispatch rather
		// than by the agent.
		expect(ports.linear.listIssues).toHaveBeenCalledWith({
			query: 'composer',
			workspaceId: 'ws',
		});
		expect(ports.linear.getIssue).toHaveBeenCalledWith({
			issueId: 'ENG-106',
			workspaceId: 'ws',
		});
		expect(ports.linear.getMetadata).toHaveBeenCalledWith({
			workspaceId: 'ws',
		});
	});

	it('dispatches each write to its port', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });

		for (const [op, rawArgs] of Object.entries(LINEAR_WRITES)) {
			const result = await service.invoke({
				op: op as keyof typeof LINEAR_WRITES,
				token: 'tok-caller',
				rawArgs,
			});
			expect(result.ok, op).toBe(true);
		}
		expect(ports.linear.createComment).toHaveBeenCalledWith({
			...LINEAR_WRITES.linearCreateComment,
			workspaceId: 'ws',
		});
		expect(ports.linear.updateIssue).toHaveBeenCalledWith({
			...LINEAR_WRITES.linearUpdateIssue,
			workspaceId: 'ws',
		});
	});

	it('rewrites the near-miss keys a model reaches for', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });

		await service.invoke({
			op: 'linearCreateComment',
			token: 'tok-caller',
			rawArgs: { body: 'Verified.', identifier: 'ENG-106' },
		});

		expect(ports.linear.createComment).toHaveBeenCalledWith({
			commentBody: 'Verified.',
			issueId: 'ENG-106',
			workspaceId: 'ws',
		});
	});

	// Every other guard on a filing is about the ticket's shape; only a search can
	// see that the issue already exists under somebody else's wording, and a
	// duplicate cannot be deleted from here. So the search is a precondition the
	// service enforces rather than a line in the tool description.
	it('refuses the first filing until the session has searched Linear', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });

		const refused = await service.invoke({
			op: 'linearCreateIssue',
			token: 'tok-caller',
			rawArgs: { teamId: 't-1', title: 'A follow-up' },
		});

		expect(refused.ok).toBe(false);
		if (!refused.ok) {
			expect(refused.code).toBe('denied-scope');
			expect(refused.error).toContain('ensemblr_linear_list_issues');
		}
		expect(ports.linear.createIssue).not.toHaveBeenCalled();
	});

	it('files once the session has searched, and stays open after that', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });

		await service.invoke({
			op: 'linearListIssues',
			token: 'tok-caller',
			rawArgs: { query: 'terminal drops a line' },
		});
		const first = await service.invoke({
			op: 'linearCreateIssue',
			token: 'tok-caller',
			rawArgs: { teamId: 't-1', title: 'A follow-up' },
		});
		const second = await service.invoke({
			op: 'linearCreateIssue',
			token: 'tok-caller',
			rawArgs: { teamId: 't-1', title: 'Another follow-up' },
		});

		expect(first.ok).toBe(true);
		expect(second.ok).toBe(true);
		expect(ports.linear.createIssue).toHaveBeenNthCalledWith(1, {
			teamId: 't-1',
			title: 'A follow-up',
			workspaceId: 'ws',
		});
	});

	// The gate is per session, not per app: one agent searching cannot clear the
	// precondition for a different conversation that never looked.
	it("does not let one session's search clear another session's first filing", async () => {
		const ports = makePorts();
		const { registry, service } = setup({ ports });

		await service.invoke({
			op: 'linearListIssues',
			token: 'tok-caller',
			rawArgs: { query: 'terminal' },
		});
		registry.register({
			sessionId: 'other',
			species: 'pi',
			workspaceCwd: '/ws',
			workspaceId: 'ws',
		});
		const result = await service.invoke({
			op: 'linearCreateIssue',
			token: 'tok-caller',
			rawArgs: { teamId: 't-1', title: 'A follow-up' },
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('denied-scope');
		}
		expect(ports.linear.createIssue).not.toHaveBeenCalled();
	});

	// An update carrying nothing but an id is a wasted round trip, and the reply
	// has to say which fields it could have set rather than only that it failed.
	it('rejects an update that changes nothing', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });

		const result = await service.invoke({
			op: 'linearUpdateIssue',
			token: 'tok-caller',
			rawArgs: { issueId: 'ENG-1' },
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('invalid-args');
			expect(result.error).toContain('stateId');
		}
		expect(ports.linear.updateIssue).not.toHaveBeenCalled();
	});

	it('allows every read in read-only mode', async () => {
		const { service } = setup({ ports: makePorts({ mode: 'read-only' }) });

		for (const [op, rawArgs] of Object.entries(LINEAR_READS)) {
			const result = await service.invoke({
				op: op as keyof typeof LINEAR_READS,
				token: 'tok-caller',
				rawArgs,
			});
			expect(result.ok, op).toBe(true);
		}
	});

	it('blocks both writes in read-only mode', async () => {
		const ports = makePorts({ mode: 'read-only' });
		const { service } = setup({ ports });

		for (const [op, rawArgs] of Object.entries(LINEAR_WRITES)) {
			const result = await service.invoke({
				op: op as keyof typeof LINEAR_WRITES,
				token: 'tok-caller',
				rawArgs,
			});
			expect(result.ok, op).toBe(false);
			if (!result.ok) {
				expect(result.code, op).toBe('denied-permission');
			}
		}
		expect(ports.linear.createComment).not.toHaveBeenCalled();
		expect(ports.linear.updateIssue).not.toHaveBeenCalled();
	});

	// A child briefed from a ticket has to be able to read it; writing to one is
	// the orchestrator's, because several children commenting on the same issue is
	// noise nobody can retract.
	it('keeps the reads for a spawned sub-agent and refuses the writes', async () => {
		const ports = makePorts({ spawnedSubAgent: true });
		const { service } = setup({ ports });

		for (const [op, rawArgs] of Object.entries(LINEAR_READS)) {
			const result = await service.invoke({
				op: op as keyof typeof LINEAR_READS,
				token: 'tok-caller',
				rawArgs,
			});
			expect(result.ok, op).toBe(true);
		}
		for (const [op, rawArgs] of Object.entries(LINEAR_WRITES)) {
			const result = await service.invoke({
				op: op as keyof typeof LINEAR_WRITES,
				token: 'tok-caller',
				rawArgs,
			});
			expect(result.ok, op).toBe(false);
			if (!result.ok) {
				expect(result.code, op).toBe('denied-scope');
				expect(result.error, op).toContain('report');
			}
		}
	});

	// Moving a ticket while planning claims an implementation that does not exist,
	// which is the `resolveDiffComments` argument exactly. Commenting is not.
	it('refuses the update while planning but leaves commenting alone', async () => {
		const ports = makePorts({ planning: true });
		const { service } = setup({ ports });

		const update = await service.invoke({
			op: 'linearUpdateIssue',
			token: 'tok-caller',
			rawArgs: { issueId: 'ENG-1', stateId: 's-review' },
		});
		const comment = await service.invoke({
			op: 'linearCreateComment',
			token: 'tok-caller',
			rawArgs: { commentBody: 'Found the seam.', issueId: 'ENG-1' },
		});

		expect(update.ok).toBe(false);
		if (!update.ok) {
			expect(update.code).toBe('denied-scope');
		}
		expect(comment.ok).toBe(true);
	});
});

// The chat-tab ops used to read `species !== 'pi'`, which denied every runtime
// that was not Pi rather than every caller without a tab to act on. Claude runs
// first-class in a real chat tab, so the four have somewhere to land; a harness
// owns a terminal tab that titles itself and still has nowhere.
describe('agent-control service: chat-tab ops by species', () => {
	const CHAT_TAB_CALLS = {
		setName: { title: 'Investigating the composer' },
		setSummary: { summary: 'Body.', title: 'Topic' },
		askUserQuestion: {
			questions: [
				{
					question: 'Which approach?',
					options: [{ label: 'Rewrite' }, { label: 'Patch' }],
				},
			],
		},
		exitPlanMode: { plan: '# Plan', title: 'The plan' },
	} as const;

	const ops = Object.keys(CHAT_TAB_CALLS) as Array<keyof typeof CHAT_TAB_CALLS>;

	it.each(ops)('allows %s from a first-class Claude caller', async (op) => {
		const ports = makePorts({ planning: true });
		const { service } = setup({ ports, species: 'claude' });

		const result = await service.invoke({
			op,
			token: 'tok-caller',
			rawArgs: CHAT_TAB_CALLS[op],
		});

		expect(result.ok, JSON.stringify(result)).toBe(true);
	});

	it.each(ops)('allows %s from a Pi caller', async (op) => {
		const ports = makePorts({ planning: true });
		const { service } = setup({ ports });

		const result = await service.invoke({
			op,
			token: 'tok-caller',
			rawArgs: CHAT_TAB_CALLS[op],
		});

		expect(result.ok, JSON.stringify(result)).toBe(true);
	});

	it.each(ops)('denies %s to a harness caller', async (op) => {
		const ports = makePorts({ planning: true });
		const { service } = setup({ ports, species: 'harness' });

		const result = await service.invoke({
			op,
			token: 'tok-caller',
			rawArgs: CHAT_TAB_CALLS[op],
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('denied-scope');
		}
	});

	// The Concierge runs on the same runtimes a chat tab does, so the species axis
	// reports a tab it has never had. Left to that axis alone, both calls reached
	// the services and came back `not-found` and `internal` — two errors in the
	// timeline on a turn that owed no bookkeeping at all.
	it.each(['setName', 'setSummary'] as const)(
		'denies %s to the Concierge, which has no tab to act on',
		async (op) => {
			const ports = makePorts();
			const { service } = setup({ concierge: true, ports });

			const result = await service.invoke({
				op,
				token: 'tok-caller',
				rawArgs: CHAT_TAB_CALLS[op],
			});

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.code).toBe('denied-scope');
			}
			expect(ports.conversations.setName).not.toHaveBeenCalled();
			expect(ports.sessionNaming.setSummary).not.toHaveBeenCalled();
		},
	);

	it('drives the chat-tab ports for a Claude caller, not just the gate', async () => {
		const ports = makePorts({ planning: true });
		const { service } = setup({ ports, species: 'claude' });

		await service.invoke({
			op: 'setName',
			token: 'tok-caller',
			rawArgs: CHAT_TAB_CALLS.setName,
		});
		await service.invoke({
			op: 'setSummary',
			token: 'tok-caller',
			rawArgs: CHAT_TAB_CALLS.setSummary,
		});
		await service.invoke({
			op: 'exitPlanMode',
			token: 'tok-caller',
			rawArgs: CHAT_TAB_CALLS.exitPlanMode,
		});

		expect(ports.conversations.setName).toHaveBeenCalledWith({
			agentSessionId: 'caller',
			name: 'Investigating the composer',
		});
		expect(ports.sessionNaming.setSummary).toHaveBeenCalled();
		expect(ports.planMode.exit).toHaveBeenCalled();
	});

	// Plan Mode governs the control surface, not just the exit call: a planning
	// Claude session must be refused the ops that would put an unrestricted writer
	// on its worktree, exactly as a planning Pi session is.
	it('gates a planning Claude caller out of the writer ops', async () => {
		const ports = makePorts({ planning: true });
		const { service } = setup({ ports, species: 'claude' });

		const result = await service.invoke({
			op: 'startTerminal',
			token: 'tok-caller',
			rawArgs: { kind: 'run' },
		});

		expect(result.ok).toBe(false);
		expect(ports.terminals.startTerminal).not.toHaveBeenCalled();
	});

	it('reports a Claude caller as planning in its session brief', async () => {
		const ports = makePorts({ planning: true });
		const { service } = setup({ ports, species: 'claude' });

		const result = await service.invoke({
			op: 'getSessionBrief',
			token: 'tok-caller',
			rawArgs: {},
		});

		expect(result).toMatchObject({ data: { planMode: true }, ok: true });
	});

	it('tells a planning caller whose plan is under review to submit again', async () => {
		const ports = makePorts({ planning: true, planSubmitted: true });
		const { service } = setup({ ports });

		const result = await service.invoke({
			op: 'getSessionBrief',
			token: 'tok-caller',
			rawArgs: {},
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toMatchObject({
				planRefinement: PLAN_REFINEMENT_DIRECTIVE,
			});
		}
	});

	// Pi holds no Concierge playbook of its own, so the brief is the only way one
	// reaches it — without this a Concierge runs on the orchestrator copy.
	it('sends the Concierge its playbook with the brief', async () => {
		const { service } = setup({ concierge: true, ports: makePorts() });

		const result = await service.invoke({
			op: 'getSessionBrief',
			token: 'tok-caller',
			rawArgs: {},
		});

		expect(result).toMatchObject({
			data: { rolePlaybook: CONCIERGE_AWARENESS },
			ok: true,
		});
	});

	it('sends a workspace agent no playbook, leaving its own copy in place', async () => {
		const { service } = setup({ ports: makePorts() });

		const result = await service.invoke({
			op: 'getSessionBrief',
			token: 'tok-caller',
			rawArgs: {},
		});

		expect(result).toMatchObject({ data: { rolePlaybook: null }, ok: true });
	});

	it('carries no refinement directive once the user turned Plan Mode off', async () => {
		const ports = makePorts({ planning: false, planSubmitted: true });
		const { service } = setup({ ports });

		const result = await service.invoke({
			op: 'getSessionBrief',
			token: 'tok-caller',
			rawArgs: {},
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toMatchObject({ planRefinement: null });
		}
	});
});

describe('agent-control service: audience resolution', () => {
	it('reports a Pi root as a chat-tab orchestrator', async () => {
		const { service } = setup({ ports: makePorts() });

		expect(await service.describeAudience('tok-caller')).toEqual({
			architectureDiagram: true,
			delegation: 'ensemblr',
			hasChatTab: true,
			role: 'orchestrator',
		});
	});

	it('reports a Claude root as a chat-tab orchestrator', async () => {
		const { service } = setup({ ports: makePorts(), species: 'claude' });

		expect(await service.describeAudience('tok-caller')).toEqual({
			architectureDiagram: true,
			delegation: 'ensemblr',
			hasChatTab: true,
			role: 'orchestrator',
		});
	});

	it('reports a harness as having no chat tab', async () => {
		const { service } = setup({ ports: makePorts(), species: 'harness' });

		expect(await service.describeAudience('tok-caller')).toEqual({
			architectureDiagram: true,
			delegation: 'ensemblr',
			hasChatTab: false,
			role: 'orchestrator',
		});
	});

	it('carries the durable sub-agent marker into the audience', async () => {
		const { service } = setup({
			ports: makePorts({ spawnedSubAgent: true }),
			species: 'claude',
		});

		expect(await service.describeAudience('tok-caller')).toEqual({
			architectureDiagram: true,
			delegation: 'ensemblr',
			hasChatTab: true,
			role: 'subagent',
		});
	});

	// An unresolvable token is refused by every op it goes on to call, so the list
	// it sees barely matters — but it must not be the widest one on offer.
	it('falls back to the narrowest surface for an unknown token', async () => {
		const { service } = setup({ ports: makePorts() });

		expect(await service.describeAudience('bogus')).toEqual({
			architectureDiagram: true,
			delegation: 'ensemblr',
			hasChatTab: false,
			role: 'orchestrator',
		});
	});
});

// The row `ensemblr_create_workspace` reports when the Concierge cuts one.
const CREATED_WORKSPACE = {
	branchName: 'psoldunov/beta-16',
	name: 'beta-16',
	path: '/repos/bruckner/beta-16',
	projectId: 'repo-1',
	workspaceId: 'ws-new',
};

/**
 * A Concierge origin plus the ports a supervising turn actually reaches: a home
 * to check writes against, and a workspace list to resolve a named id in.
 */
const setupConcierge = (
	workspaces: readonly { cwd: string; workspaceId: string }[] = [
		{ cwd: '/repos/bruckner', workspaceId: 'ws-a' },
		{ cwd: '/repos/other', workspaceId: 'ws' },
	],
) => {
	const ports = makePorts();
	const conciergePorts: AgentControlPorts = {
		...ports,
		concierge: {
			describeSession: () => ({
				model: 'anthropic/sonnet',
				thinkingLevel: null,
			}),
			homePath: () => '/root/concierge',
		},
		memory: { recall: vi.fn().mockReturnValue({ memories: [] }) },
		workspaceCreation: {
			createWorkspace: vi.fn().mockResolvedValue(CREATED_WORKSPACE),
		},
		workspaces: {
			listProjects: vi.fn().mockResolvedValue([
				{
					defaultBranch: 'main',
					name: 'Bruckner',
					path: '/repos/bruckner',
					projectId: 'repo-1',
					slug: 'bruckner',
					workspaceCount: 1,
				},
			]),
			listWorkspaces: vi.fn().mockResolvedValue(workspaces),
		},
	};
	return {
		...setup({ concierge: true, ports: conciergePorts }),
		ports: conciergePorts,
	};
};

// The Concierge is read-only in every workspace and delegates to change
// anything, so these are the two halves of that: the tool policy the extension
// asks about on every write, and the `workspaceId` every acting op needs because
// the caller's own is the empty string.
describe('agent-control service: the Concierge boundary', () => {
	it('hands the Concierge the project roster', async () => {
		const { service } = setupConcierge();

		const result = await service.invoke({
			op: 'listProjects',
			token: 'tok-caller',
			rawArgs: {},
		});

		expect(result).toMatchObject({
			data: {
				projects: [
					{
						name: 'Bruckner',
						projectId: 'repo-1',
						workspaceCount: 1,
					},
				],
			},
			ok: true,
		});
	});

	it('refuses the project roster to a workspace agent', async () => {
		const { service } = setup({ ports: makePorts() });

		const result = await service.invoke({
			op: 'listProjects',
			token: 'tok-caller',
			rawArgs: {},
		});

		expect(result).toMatchObject({ code: 'denied-scope', ok: false });
	});

	it('admits a write into the Concierge home', async () => {
		const { service } = setupConcierge();

		const result = await service.invoke({
			op: 'checkPlanModeTool',
			token: 'tok-caller',
			rawArgs: { path: 'memory/a-fact.md', tool: 'write' },
		});

		expect(result).toMatchObject({ data: { blocked: false }, ok: true });
	});

	it.each([
		['a workspace file', '/repos/bruckner/src/main/main.ts'],
		['a home-relative escape', '~/.ssh/authorized_keys'],
		['a variable the guard cannot resolve', '$HOME/notes.md'],
	])('blocks a write to %s', async (_label, path) => {
		const { service } = setupConcierge();

		const result = await service.invoke({
			op: 'checkPlanModeTool',
			token: 'tok-caller',
			rawArgs: { path, tool: 'write' },
		});

		expect(result).toMatchObject({ data: { blocked: true }, ok: true });
	});

	// The path is the whole question for a Concierge write, and the extension not
	// sending it is what made every one of them — including into its own
	// `memory/` — come back blocked.
	it('blocks a write whose path never arrived', async () => {
		const { service } = setupConcierge();

		const result = await service.invoke({
			op: 'checkPlanModeTool',
			token: 'tok-caller',
			rawArgs: { tool: 'write' },
		});

		expect(result).toMatchObject({ data: { blocked: true }, ok: true });
	});

	it('opens a delegated conversation in the workspace it names', async () => {
		const { ports, service } = setupConcierge();

		const result = await service.invoke({
			op: 'startConversation',
			token: 'tok-caller',
			rawArgs: { prompt: 'Fix the composer.', workspaceId: 'ws-a' },
		});

		expect(result.ok).toBe(true);
		expect(ports.conversations.startConversation).toHaveBeenCalledWith(
			expect.objectContaining({
				workspaceCwd: '/repos/bruckner',
				workspaceId: 'ws-a',
			}),
		);
	});

	// Without the argument the spawn landed on workspace `''`, whose cwd resolves
	// to nothing — so the child came up with no control token, no role, and no
	// guard at all.
	it('refuses to delegate without a workspace to delegate into', async () => {
		const { ports, service } = setupConcierge();

		const result = await service.invoke({
			op: 'startConversation',
			token: 'tok-caller',
			rawArgs: { prompt: 'Fix the composer.' },
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('invalid-args');
		}
		expect(ports.conversations.startConversation).not.toHaveBeenCalled();
	});

	it.each([
		['startConversation', { prompt: 'go', workspaceId: 'ws-gone' }],
		['setWorkspaceStatus', { status: 'in-review', workspaceId: 'ws-gone' }],
		['focusWorkspace', { workspaceId: 'ws-gone' }],
		[
			'addDiffComments',
			{
				comments: [{ body: 'look here', filePath: 'a.ts' }],
				workspaceId: 'ws-gone',
			},
		],
	] as const)(
		'refuses %s against a workspace that does not exist',
		async (op, rawArgs) => {
			const { ports, service } = setupConcierge();

			const result = await service.invoke({ op, rawArgs, token: 'tok-caller' });

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.code).toBe('not-found');
			}
			expect(ports.board.setWorkspaceStatus).not.toHaveBeenCalled();
			expect(ports.review.addComments).not.toHaveBeenCalled();
			expect(ports.focus.focusWorkspace).not.toHaveBeenCalled();
		},
	);

	// A workspace nobody is looking at is indistinguishable from one that was
	// never made: the shell's tree only refreshes on a poll, so without the focus
	// the Concierge reports a workspace that is on screen nowhere.
	it('moves the app to the workspace it just cut', async () => {
		const { ports, service } = setupConcierge();

		const result = await service.invoke({
			op: 'createWorkspace',
			rawArgs: { name: 'beta-16', projectId: 'repo-1' },
			token: 'tok-caller',
		});

		expect(result).toMatchObject({ data: CREATED_WORKSPACE, ok: true });
		expect(ports.focus.focusWorkspace).toHaveBeenCalledWith({
			workspaceId: CREATED_WORKSPACE.workspaceId,
		});
	});

	// The name is the git branch too, and omitting it is not neutral: the create
	// service falls back to the literal placeholder `workspace`, so the worktree
	// lands on `<prefix>/workspace` and the next one collides with it.
	it.each([
		['a missing name', { projectId: 'repo-1' }],
		['a blank name', { name: '   ', projectId: 'repo-1' }],
		['a name with no slug characters', { name: '///', projectId: 'repo-1' }],
		['a name too short to describe work', { name: 'ab', projectId: 'repo-1' }],
		// The slug of `a b` is `a-b` — three characters, but the dash describes
		// nothing, so the floor counts the two letters it actually holds.
		['two letters a separator pads out', { name: 'a b', projectId: 'repo-1' }],
		['the placeholder itself', { name: 'workspace', projectId: 'repo-1' }],
		[
			'a placeholder in disguise',
			{ name: 'New Workspace', projectId: 'repo-1' },
		],
		['a generic stand-in', { name: 'test', projectId: 'repo-1' }],
	])('refuses to cut a workspace with %s', async (_case, rawArgs) => {
		const { ports, service } = setupConcierge();

		const result = await service.invoke({
			op: 'createWorkspace',
			rawArgs,
			token: 'tok-caller',
		});

		expect(result).toMatchObject({ code: 'invalid-args', ok: false });
		expect(ports.workspaceCreation?.createWorkspace).not.toHaveBeenCalled();
	});

	it('cuts a workspace whose name describes the work', async () => {
		const { ports, service } = setupConcierge();

		const result = await service.invoke({
			op: 'createWorkspace',
			rawArgs: { name: 'Fix Linear OAuth callback', projectId: 'repo-1' },
			token: 'tok-caller',
		});

		expect(result).toMatchObject({ ok: true });
		expect(ports.workspaceCreation?.createWorkspace).toHaveBeenCalledWith({
			name: 'Fix Linear OAuth callback',
			projectId: 'repo-1',
		});
	});

	it.each(['addDiffComments', 'resolveDiffComments'] as const)(
		'files %s against the workspace it names, not the empty one',
		async (op) => {
			const { ports, service } = setupConcierge();

			const result = await service.invoke({
				op,
				token: 'tok-caller',
				rawArgs:
					op === 'addDiffComments'
						? {
								comments: [{ body: 'look here', filePath: 'a.ts' }],
								workspaceId: 'ws-a',
							}
						: { commentIds: ['c-1'], workspaceId: 'ws-a' },
			});

			expect(result.ok).toBe(true);
			const port =
				op === 'addDiffComments'
					? ports.review.addComments
					: ports.review.resolveComments;
			expect(port).toHaveBeenCalledWith(
				expect.objectContaining({ workspaceId: 'ws-a' }),
			);
		},
	);

	it('focuses a tab in the workspace that owns it', async () => {
		const { ports, service } = setupConcierge();

		const result = await service.invoke({
			op: 'focusTab',
			token: 'tok-caller',
			rawArgs: { chatTabId: 'tab-1' },
		});

		expect(result.ok).toBe(true);
		expect(ports.focus.focusTab).toHaveBeenCalledWith({
			chatTabId: 'tab-1',
			workspaceId: 'ws',
		});
	});

	it('focuses a script dock tab in the workspace it names', async () => {
		const { ports, service } = setupConcierge();

		const result = await service.invoke({
			op: 'focusDockTab',
			token: 'tok-caller',
			rawArgs: { kind: 'run', workspaceId: 'ws-a' },
		});

		expect(result.ok).toBe(true);
		expect(ports.focus.focusDockTab).toHaveBeenCalledWith({
			dock: 'run',
			workspaceId: 'ws-a',
		});
	});

	// Answering with an empty list reads to the model as "that workspace has no
	// tabs", which is a different claim from "you did not say which workspace".
	it.each(['listTabs', 'listTerminals'] as const)(
		'refuses %s rather than answering for the empty workspace',
		async (op) => {
			const { ports, service } = setupConcierge();

			const result = await service.invoke({
				op,
				token: 'tok-caller',
				rawArgs: {},
			});

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.code).toBe('invalid-args');
			}
			expect(ports.tabs.listTabs).not.toHaveBeenCalled();
			expect(ports.terminals.listTerminals).not.toHaveBeenCalled();
		},
	);

	// Both used to act on workspace `''` and report `ok`: `openTab` created a tab
	// nobody could see and spent spawn quota doing it, `listRunScripts` answered
	// with an empty list.
	it.each([
		['openTab', { filePath: 'a.ts', variant: 'file' }],
		['listRunScripts', {}],
	] as const)('denies %s to the Concierge outright', async (op, rawArgs) => {
		const { ports, service } = setupConcierge();

		const result = await service.invoke({ op, rawArgs, token: 'tok-caller' });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('denied-scope');
		}
		expect(ports.tabs.openNonChatTab).not.toHaveBeenCalled();
		expect(ports.terminals.listRunScripts).not.toHaveBeenCalled();
	});

	// The exemption that lets a Concierge act across workspaces must not become a
	// way for a workspace agent to name another one.
	it('still refuses a workspace agent that names another workspace', async () => {
		const { ports, service } = setup({ ports: makePorts() });

		const result = await service.invoke({
			op: 'addDiffComments',
			token: 'tok-caller',
			rawArgs: {
				comments: [{ body: 'look here', filePath: 'a.ts' }],
				workspaceId: 'ws-other',
			},
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('denied-scope');
		}
		expect(ports.review.addComments).not.toHaveBeenCalled();
	});
});

// A clear hands the user a fresh conversation and leaves the child it replaced
// running to write its memories, so that child keeps a live Concierge token
// behind a transcript the renderer no longer draws anywhere. Anything it does to
// the app from there happens with no visible cause, which is why the authority
// narrows to the file-writing turn rather than being left to the prompt.
describe('agent-control service: a retired Concierge child', () => {
	it('can still have its writes cleared against the home', async () => {
		const { service } = setupConcierge();
		service.retireSession('caller');

		const result = await service.invoke({
			op: 'checkPlanModeTool',
			token: 'tok-caller',
			rawArgs: { path: '/root/concierge/memory/a-fact.md', tool: 'write' },
		});

		expect(result).toMatchObject({ data: { blocked: false }, ok: true });
	});

	it('can still search its own memory index', async () => {
		const { service } = setupConcierge();
		service.retireSession('caller');

		const result = await service.invoke({
			op: 'recallMemory',
			token: 'tok-caller',
			rawArgs: { query: 'what did we decide' },
		});

		expect(result.ok).toBe(true);
	});

	// The dialog would render nowhere — the panel keys pending questionnaires off
	// its own session id — while still firing a desktop notification, and the
	// coordinator has no timeout to unwedge the child afterwards.
	it('may not raise a questionnaire', async () => {
		const { ports, service } = setupConcierge();
		service.retireSession('caller');

		const result = await service.invoke({
			op: 'askUserQuestion',
			token: 'tok-caller',
			rawArgs: {
				questions: [
					{
						header: 'Pick',
						options: [{ label: 'a' }, { label: 'b' }],
						question: 'Which?',
					},
				],
			},
		});

		expect(result).toMatchObject({ code: 'denied-scope', ok: false });
		expect(ports.ask.ask).not.toHaveBeenCalled();
	});

	it('drops a questionnaire already open when it is retired', () => {
		const { ports, service } = setupConcierge();

		service.retireSession('caller');

		expect(ports.ask.releaseSession).toHaveBeenCalledWith('caller');
	});

	it.each([
		{
			op: 'createWorkspace',
			rawArgs: { name: 'beta-16', projectId: 'repo-1' },
		},
		{ op: 'focusWorkspace', rawArgs: { workspaceId: 'ws-1' } },
		{ op: 'listProjects', rawArgs: {} },
		{
			op: 'setWorkspaceStatus',
			rawArgs: { status: 'in-review', workspaceId: 'ws-1' },
		},
		{
			op: 'startConversation',
			rawArgs: { prompt: 'do the thing', workspaceId: 'ws-1' },
		},
	] as const)('may not act on the app through $op', async ({ op, rawArgs }) => {
		const { service } = setupConcierge();
		service.retireSession('caller');

		const result = await service.invoke({ op, rawArgs, token: 'tok-caller' });

		expect(result).toMatchObject({ code: 'denied-scope', ok: false });
	});

	// Retirement is one-way and idempotent, but it must not leak onto a Concierge
	// that has not been through a clear.
	it('leaves a live Concierge holding everything it had', async () => {
		const { service } = setupConcierge();

		const result = await service.invoke({
			op: 'listProjects',
			token: 'tok-caller',
			rawArgs: {},
		});

		expect(result.ok).toBe(true);
	});
});
