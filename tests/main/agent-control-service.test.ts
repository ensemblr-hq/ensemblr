import { describe, expect, it, vi } from 'vitest';

import {
	type AgentControlPorts,
	type AgentSpecies,
	type ConciergePort,
	createAgentControlService,
	createGuardrails,
	createOriginRegistry,
	type GuardrailConfig,
} from '../../src/main/agent-control/index.ts';
import {
	type AgentSessionLineage,
	conciergeAwareness,
	PLAN_REFINEMENT_DIRECTIVE,
	type SubagentMechanism,
} from '../../src/shared/agent-control.ts';
import {
	type AppSettings,
	DEFAULT_APP_SETTINGS,
} from '../../src/shared/config.ts';
import type { AppLanguage } from '../../src/shared/i18n.ts';
import type { PermissionMode } from '../../src/shared/permissions.ts';

const controlProjection = (settings: AppSettings) => {
	const { onboarding: _onboarding, ...projection } = settings;
	return projection;
};

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
		deliverMessage: ConciergePort['deliverMessage'];
		appSettings: AppSettings;
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
		resolveTabAgentSession: vi.fn().mockResolvedValue('pi-1'),
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
		listImmediateChildren: vi.fn().mockReturnValue([]),
	},
	terminals: {
		startTerminal: vi
			.fn()
			.mockResolvedValue({ ok: true, shell: '/bin/zsh', terminalId: 'term-1' }),
		stopTerminal: vi.fn().mockResolvedValue({ ok: true }),
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
	// Present on the default ports, not only on the Concierge variant below: a
	// workspace agent messaging upward reaches this port, and a build without one
	// is a different answer ("no Concierge in this build") from an empty panel.
	appSettings: {
		get: vi
			.fn()
			.mockReturnValue(
				controlProjection(overrides.appSettings ?? DEFAULT_APP_SETTINGS),
			),
		update: vi
			.fn()
			.mockImplementation((patch) =>
				controlProjection({ ...DEFAULT_APP_SETTINGS, ...patch }),
			),
	},
	concierge: {
		deliverMessage:
			overrides.deliverMessage ??
			vi.fn().mockResolvedValue({
				conciergeSessionId: 'concierge-1',
				delivered: true,
			}),
		describeContextUsage: () => null,
		describeSession: () => null,
		homePath: () => null,
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
	afkMode: {
		activateForSpawn: vi.fn(),
		isActive: vi.fn(() => false),
		releaseSession: vi.fn(),
	},
	reviewLaunch: {
		composeBrief: vi.fn().mockResolvedValue({
			model: null,
			prompt: 'REVIEW',
			source: 'fallback',
			thinkingLevel: null,
		}),
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
		delegation?: SubagentMechanism;
		dispatchTimeoutMs?: number;
		architectureDiagram?: boolean;
		tuiHarnesses?: boolean;
		lineage?: AgentSessionLineage;
	} = {},
) => {
	// The caller keeps `tok-caller`; anything a test registers afterwards gets its
	// own token. One fixed token for every registration silently re-pointed
	// `tok-caller` at the last session registered, so a test that added a second
	// agent to the workspace was quietly testing that agent instead of the caller.
	let minted = 0;
	const registry = createOriginRegistry({
		generateToken: () => (minted++ === 0 ? 'tok-caller' : `tok-${minted}`),
	});
	registry.register({
		sessionId: 'caller',
		workspaceId: options.concierge ? '' : 'ws',
		concierge: options.concierge ?? false,
		delegation: options.delegation,
		workspaceCwd: '/ws',
		species: options.species ?? 'pi',
		lineage: options.lineage,
	});
	const ports = options.ports ?? makePorts();
	const service = createAgentControlService({
		dispatchTimeoutMs: options.dispatchTimeoutMs,
		ports,
		originRegistry: registry,
		guardrails: createGuardrails(options.guardrails),
		readArchitectureDiagramEnabled: () => options.architectureDiagram ?? true,
		readTuiHarnessesEnabled: () => options.tuiHarnesses ?? true,
	});
	return { service, ports, registry };
};

/**
 * Starts a spawn terminal through the service so the session that owns the
 * returned id is on record. Closing is refused for a terminal the caller did not
 * start, so a stop-with-close test has to open one rather than name an id.
 */
const startTerminalAs = (
	service: ReturnType<typeof setup>['service'],
	token: string,
) => service.invoke({ op: 'startTerminal', token, rawArgs: { kind: 'spawn' } });

describe('agent-control service: app settings', () => {
	it.each([
		{
			confirm: true,
			confirmAsked: true,
			mode: 'workspace-trusted',
			updateAllowed: true,
		},
		{
			confirm: true,
			confirmAsked: true,
			mode: 'approval-required',
			updateAllowed: true,
		},
		{
			confirm: false,
			confirmAsked: false,
			mode: 'read-only',
			updateAllowed: false,
		},
	] as const)(
		'requires confirmation for app settings writes in $mode mode',
		async ({ confirm, confirmAsked, mode, updateAllowed }) => {
			const ports = makePorts({ mode, confirm });
			const { service } = setup({ concierge: true, ports });

			const read = await service.invoke({
				op: 'getAppSettings',
				token: 'tok-caller',
				rawArgs: {},
			});
			const update = await service.invoke({
				op: 'updateAppSettings',
				token: 'tok-caller',
				rawArgs: { general: { automaticUpdates: false } },
			});

			expect(read.ok).toBe(true);
			expect(update.ok).toBe(updateAllowed);
			expect(ports.confirm.confirm).toHaveBeenCalledTimes(confirmAsked ? 1 : 0);
			expect(ports.appSettings.update).toHaveBeenCalledTimes(
				updateAllowed ? 1 : 0,
			);
		},
	);

	it('lets the active Concierge read and update editable app settings', async () => {
		const { service, ports } = setup({ concierge: true });
		const result = await service.invoke({
			op: 'getAppSettings',
			token: 'tok-caller',
			rawArgs: {},
		});
		expect(result).toMatchObject({ ok: true });
		if (result.ok) {
			expect(result.data).not.toHaveProperty('onboarding');
		}

		const updated = await service.invoke({
			op: 'updateAppSettings',
			token: 'tok-caller',
			rawArgs: { general: { automaticUpdates: false } },
		});
		expect(updated.ok).toBe(true);
		expect(ports.appSettings.update).toHaveBeenCalledWith({
			general: { automaticUpdates: false },
		});
	});

	it.each([
		{ label: 'workspace agent', options: {} },
		{
			label: 'sub-agent',
			options: { ports: makePorts({ spawnedSubAgent: true }) },
		},
		{ label: 'harness', options: { species: 'harness' as const } },
	] as const)(
		'rejects app settings access for a $label',
		async ({ options }) => {
			const { service, ports } = setup(options);
			const read = await service.invoke({
				op: 'getAppSettings',
				token: 'tok-caller',
				rawArgs: {},
			});
			const update = await service.invoke({
				op: 'updateAppSettings',
				token: 'tok-caller',
				rawArgs: { general: { automaticUpdates: false } },
			});

			expect(read).toMatchObject({ ok: false, code: 'denied-scope' });
			expect(update).toMatchObject({ ok: false, code: 'denied-scope' });
			expect(ports.appSettings.get).not.toHaveBeenCalled();
			expect(ports.appSettings.update).not.toHaveBeenCalled();
		},
	);

	it('rejects app settings access for a retired Concierge', async () => {
		const retired = setup({ concierge: true });
		retired.registry.retire('caller');
		const read = await retired.service.invoke({
			op: 'getAppSettings',
			token: 'tok-caller',
			rawArgs: {},
		});
		const update = await retired.service.invoke({
			op: 'updateAppSettings',
			token: 'tok-caller',
			rawArgs: { general: { automaticUpdates: false } },
		});
		expect(read).toMatchObject({ ok: false, code: 'denied-scope' });
		expect(update).toMatchObject({ ok: false, code: 'denied-scope' });
		expect(retired.ports.appSettings.get).not.toHaveBeenCalled();
		expect(retired.ports.appSettings.update).not.toHaveBeenCalled();
	});

	it('does not mutate settings when approval is declined', async () => {
		const ports = makePorts({ mode: 'approval-required', confirm: false });
		const { service } = setup({ concierge: true, ports });
		const result = await service.invoke({
			op: 'updateAppSettings',
			token: 'tok-caller',
			rawArgs: { general: { automaticUpdates: false } },
		});

		expect(result).toMatchObject({ ok: false, code: 'denied-permission' });
		expect(ports.appSettings.update).not.toHaveBeenCalled();
	});

	it('rejects a mixed allowed and excluded patch before mutation', async () => {
		const { service, ports } = setup({ concierge: true });
		const result = await service.invoke({
			op: 'updateAppSettings',
			token: 'tok-caller',
			rawArgs: {
				general: { automaticUpdates: false },
				onboarding: { completedAt: null },
			},
		});

		expect(result).toMatchObject({ ok: false, code: 'invalid-args' });
		expect(ports.appSettings.update).not.toHaveBeenCalled();
	});

	it('rejects a Concierge retirement that happens during approval', async () => {
		const ports = makePorts({ mode: 'approval-required' });
		let approve!: (value: boolean) => void;
		ports.confirm.confirm = vi.fn(
			() =>
				new Promise<boolean>((resolve) => {
					approve = resolve;
				}),
		);
		const {
			service,
			ports: servicePorts,
			registry,
		} = setup({ concierge: true, ports });
		const pending = service.invoke({
			op: 'updateAppSettings',
			token: 'tok-caller',
			rawArgs: { general: { automaticUpdates: false } },
		});
		await vi.waitFor(() =>
			expect(ports.confirm.confirm).toHaveBeenCalledOnce(),
		);
		registry.retire('caller');
		approve(true);

		const result = await pending;
		expect(result).toMatchObject({ ok: false, code: 'denied-scope' });
		expect(servicePorts.appSettings.update).not.toHaveBeenCalled();
	});

	it('rejects invalid app settings before the update port is called', async () => {
		const { service, ports } = setup({ concierge: true });
		const result = await service.invoke({
			op: 'updateAppSettings',
			token: 'tok-caller',
			rawArgs: { onboarding: { completedAt: null } },
		});
		expect(result).toMatchObject({ ok: false, code: 'invalid-args' });
		expect(ports.appSettings.update).not.toHaveBeenCalled();
	});
});

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

	it('resolves the mode for the calling origin workspace', async () => {
		const getMode = vi.fn().mockReturnValue('workspace-trusted');
		const ports = makePorts();
		const { service } = setup({
			ports: { ...ports, permissions: { getMode } },
		});
		await service.invoke({ op: 'listTabs', token: 'tok-caller', rawArgs: {} });
		expect(getMode).toHaveBeenCalledWith('ws');
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
	// after a fragment. The marker case stays as a fail-closed legacy regression.
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
			expect(result.code).toBe('denied-deadlock');
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

// Legacy sessions may still carry only a tab marker. A missing lineage record
// must fail closed rather than handing that marked descendant root privileges.
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

// Every caller here models a legacy marked descendant with unprovable lineage.
// It must retain the leaf surface rather than being promoted to a root.
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

describe('agent-control service: notifying the orchestrator', () => {
	it('accepts a signal from either verified descendant level', async () => {
		for (const depth of [1, 2] as const) {
			const ports = makePorts({ spawnedSubAgent: true });
			const { service } = setup({
				ports,
				lineage: {
					depth,
					parentSessionId: `parent-${depth}`,
					rootSessionId: 'root',
				},
			});

			const result = await service.invoke({
				op: 'notifyOrchestrator',
				token: 'tok-caller',
				rawArgs: { message: 'which framework?', reason: 'need_decision' },
			});

			expect(result.ok).toBe(true);
		}
	});

	it('fails closed when a marked legacy descendant has no verified parent', async () => {
		const ports = makePorts({ spawnedSubAgent: true });
		const { service } = setup({ ports });

		const result = await service.invoke({
			op: 'notifyOrchestrator',
			token: 'tok-caller',
			rawArgs: { message: 'which framework?', reason: 'need_decision' },
		});

		expect(result).toMatchObject({ code: 'not-found', ok: false });
	});

	it('keeps a child signal until its immediate parent consumes it', async () => {
		const ports = makePorts();
		ports.conversations.isSpawnedSubAgent = vi
			.fn()
			.mockImplementation(async (sessionId) => sessionId === 'child');
		const { registry, service } = setup({ ports });
		const child = registry.register({
			lineage: {
				depth: 1,
				parentSessionId: 'caller',
				rootSessionId: 'caller',
			},
			sessionId: 'child',
			species: 'pi',
			workspaceCwd: '/ws',
			workspaceId: 'ws',
		});
		const outsider = registry.register({
			lineage: {
				depth: 0,
				parentSessionId: null,
				rootSessionId: 'outsider',
			},
			sessionId: 'outsider',
			species: 'pi',
			workspaceCwd: '/ws',
			workspaceId: 'ws',
		});
		await service.invoke({
			op: 'notifyOrchestrator',
			token: child.token,
			rawArgs: { message: 'decision', reason: 'need_decision' },
		});
		const unrelated = await service.invoke({
			op: 'waitForAgents',
			token: outsider.token,
			rawArgs: { targets: ['child'] },
		});
		service.releaseSession('child');

		const result = await service.invoke({
			op: 'waitForAgents',
			token: 'tok-caller',
			rawArgs: { targets: ['child'] },
		});

		expect(unrelated).toMatchObject({
			data: { completed: [{ signal: null }] },
			ok: true,
		});
		expect(result).toMatchObject({
			data: {
				completed: [
					{ signal: { message: 'decision', reason: 'need_decision' } },
				],
			},
			ok: true,
		});
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
	it('lets a verified depth-1 manager list models and open a fresh leaf', async () => {
		const ports = makePorts({ spawnedSubAgent: true });
		const { service } = setup({
			ports,
			lineage: {
				depth: 1,
				parentSessionId: 'root',
				rootSessionId: 'root',
			},
		});

		const models = await service.invoke({
			op: 'listModels',
			token: 'tok-caller',
			rawArgs: {},
		});
		const spawn = await service.invoke({
			op: 'startConversation',
			token: 'tok-caller',
			rawArgs: { model: 'm-default', prompt: 'leaf work' },
		});

		expect(models.ok).toBe(true);
		expect(spawn.ok).toBe(true);
		expect(ports.conversations.startConversation).toHaveBeenCalledWith(
			expect.objectContaining({
				asPeer: false,
				parentSessionId: 'caller',
			}),
		);
	});

	it('lets a planning depth-1 manager spawn a leaf that inherits Plan Mode', async () => {
		const ports = makePorts({ planning: true, spawnedSubAgent: true });
		const { service } = setup({
			ports,
			lineage: {
				depth: 1,
				parentSessionId: 'root',
				rootSessionId: 'root',
			},
		});

		const result = await service.invoke({
			op: 'startConversation',
			token: 'tok-caller',
			rawArgs: { prompt: 'plan leaf' },
		});

		expect(result.ok).toBe(true);
		expect(ports.conversations.startConversation).toHaveBeenCalledWith(
			expect.objectContaining({ planMode: true }),
		);
	});

	it('denies delegation and model selection at depth 2', async () => {
		const ports = makePorts({ spawnedSubAgent: true });
		const { service } = setup({
			ports,
			lineage: {
				depth: 2,
				parentSessionId: 'manager',
				rootSessionId: 'root',
			},
		});

		for (const [op, rawArgs] of [
			['listModels', {}],
			['startConversation', { prompt: 'third level' }],
		] as const) {
			const result = await service.invoke({ op, rawArgs, token: 'tok-caller' });
			expect(result).toMatchObject({ code: 'denied-scope', ok: false });
		}
		expect(ports.conversations.startConversation).not.toHaveBeenCalled();
	});

	it('limits a depth-1 manager wait, follow-up, and close to durable immediate children', async () => {
		const ports = makePorts({ spawnedSubAgent: true });
		vi.mocked(ports.conversations.listImmediateChildren).mockReturnValue([
			'leaf',
		]);
		vi.mocked(ports.tabs.resolveTabAgentSession).mockImplementation(
			async (chatTabId) => (chatTabId === 'leaf-tab' ? 'leaf' : 'sibling'),
		);
		const { service } = setup({
			ports,
			lineage: {
				depth: 1,
				parentSessionId: 'root',
				rootSessionId: 'root',
			},
		});

		const waited = await service.invoke({
			op: 'waitForAgents',
			token: 'tok-caller',
			rawArgs: { mode: 'all' },
		});
		const followed = await service.invoke({
			op: 'sendFollowUp',
			token: 'tok-caller',
			rawArgs: { agentSessionId: 'leaf', prompt: 'continue' },
		});
		const closed = await service.invoke({
			op: 'closeTab',
			token: 'tok-caller',
			rawArgs: { chatTabId: 'leaf-tab' },
		});

		expect(waited.ok).toBe(true);
		expect(followed.ok).toBe(true);
		expect(closed.ok).toBe(true);
		expect(ports.conversations.getStatus).toHaveBeenCalledWith('leaf');

		for (const [op, rawArgs] of [
			['waitForAgents', { targets: ['sibling'] }],
			['sendFollowUp', { agentSessionId: 'sibling', prompt: 'continue' }],
			['closeTab', { chatTabId: 'sibling-tab' }],
		] as const) {
			const result = await service.invoke({ op, rawArgs, token: 'tok-caller' });
			expect(result).toMatchObject({ code: 'denied-scope', ok: false });
		}
	});

	it('denies peer creation and tab reuse from a depth-1 manager', async () => {
		const ports = makePorts({ spawnedSubAgent: true });
		const { service } = setup({
			ports,
			lineage: {
				depth: 1,
				parentSessionId: 'root',
				rootSessionId: 'root',
			},
		});

		const peer = await service.invoke({
			op: 'startConversation',
			token: 'tok-caller',
			rawArgs: { peer: true, prompt: 'peer', title: 'peer' },
		});
		const reused = await service.invoke({
			op: 'startConversation',
			token: 'tok-caller',
			rawArgs: { chatTabId: 'existing', prompt: 'reuse' },
		});

		expect(peer).toMatchObject({ code: 'denied-scope', ok: false });
		expect(reused).toMatchObject({ code: 'denied-scope', ok: false });
		expect(ports.conversations.startConversation).not.toHaveBeenCalled();
	});

	it('atomically refuses a competing spawn at capacity', async () => {
		const ports = makePorts();
		let releaseFirst = (): void => {};
		const firstOpening = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		vi.mocked(ports.tabs.spawnChatTab).mockImplementationOnce(async () => {
			await firstOpening;
			return { chatTabId: 'first' };
		});
		const { service } = setup({
			guardrails: { maxSpawnsPerSession: 1 },
			ports,
		});

		const first = service.invoke({
			op: 'spawnChatTab',
			token: 'tok-caller',
			rawArgs: {},
		});
		const second = await service.invoke({
			op: 'spawnChatTab',
			token: 'tok-caller',
			rawArgs: {},
		});
		releaseFirst();

		expect(second).toMatchObject({ code: 'denied-quota', ok: false });
		expect((await first).ok).toBe(true);
		expect(ports.tabs.spawnChatTab).toHaveBeenCalledOnce();
	});

	it('shares one spawn budget between a root and its depth-1 child', async () => {
		const ports = makePorts();
		ports.conversations.isSpawnedSubAgent = vi
			.fn()
			.mockImplementation(async (sessionId) => sessionId === 'child');
		const { registry, service } = setup({
			guardrails: { maxSpawnsPerSession: 2, maxSpawnsPerMinute: 10 },
			ports,
		});
		const child = registry.register({
			lineage: {
				depth: 1,
				parentSessionId: 'caller',
				rootSessionId: 'caller',
			},
			sessionId: 'child',
			species: 'pi',
			workspaceCwd: '/ws',
			workspaceId: 'ws',
		});

		expect(
			(
				await service.invoke({
					op: 'startConversation',
					token: 'tok-caller',
					rawArgs: { prompt: 'child' },
				})
			).ok,
		).toBe(true);
		expect(
			(
				await service.invoke({
					op: 'startConversation',
					token: child.token,
					rawArgs: { prompt: 'leaf' },
				})
			).ok,
		).toBe(true);
		const exhausted = await service.invoke({
			op: 'startConversation',
			token: 'tok-caller',
			rawArgs: { prompt: 'over budget' },
		});
		expect(exhausted).toMatchObject({ code: 'denied-quota', ok: false });
	});

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
			expect.objectContaining({
				callerRuntime: null,
				callerSpecies: 'harness',
				parentSessionId: 'caller',
			}),
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

	// The shell is what tells a caller which syntax its next `writeTerminal` has
	// to be in — an interactive terminal runs the user's login shell, which may
	// be fish, where a POSIX line is a syntax error rather than a command.
	it('answers a start with the shell that terminal runs', async () => {
		const ports = makePorts();
		vi.mocked(ports.terminals.startTerminal).mockResolvedValue({
			ok: true,
			shell: '/opt/homebrew/bin/fish',
			terminalId: 'term-1',
		});
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'startTerminal',
			token: 'tok-caller',
			rawArgs: { kind: 'spawn' },
		});
		expect(result).toMatchObject({
			ok: true,
			data: { shell: '/opt/homebrew/bin/fish', terminalId: 'term-1' },
		});
	});

	// Cleaning up is the point of `close`, so the flag has to reach the port
	// rather than being dropped into an ordinary stop that leaves the tab.
	it('forwards a close request to the terminal port', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });
		await startTerminalAs(service, 'tok-caller');
		const result = await service.invoke({
			op: 'stopTerminal',
			token: 'tok-caller',
			rawArgs: { terminalId: 'term-1', close: true },
		});
		expect(result.ok).toBe(true);
		expect(ports.terminals.stopTerminal).toHaveBeenCalledWith(
			expect.objectContaining({ close: true, terminalId: 'term-1' }),
		);
	});

	// The service refuses to close anything but an interactive terminal. Reported
	// as a correctable argument error, since the caller picked the wrong id.
	it('reports a refused close as invalid args, not as a silent success', async () => {
		const ports = makePorts();
		vi.mocked(ports.terminals.startTerminal).mockResolvedValue({
			ok: true,
			shell: '/bin/zsh',
			terminalId: 'term-run',
		});
		vi.mocked(ports.terminals.stopTerminal).mockResolvedValue({
			ok: false,
			message:
				'Only a dock terminal can be closed; term-run is a run-script session.',
		});
		const { service } = setup({ ports });
		await startTerminalAs(service, 'tok-caller');
		const result = await service.invoke({
			op: 'stopTerminal',
			token: 'tok-caller',
			rawArgs: { terminalId: 'term-run', close: true },
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('invalid-args');
			expect(result.error).toContain('run-script session');
		}
	});

	// A stale id is a correctable argument error on both stop paths. Before the
	// two shared one refusal handler, a bare kill let the terminal service's throw
	// escape into the outer catch, which answers `internal` — a fault the caller
	// is told to retry, for an id no retry will fix.
	it('reports a stale id the same way whether or not close is set', async () => {
		const ports = makePorts();
		vi.mocked(ports.terminals.stopTerminal).mockResolvedValue({
			ok: false,
			message: 'No terminal session is registered with id term-gone.',
		});
		const { service } = setup({ ports });
		await startTerminalAs(service, 'tok-caller');
		const result = await service.invoke({
			op: 'stopTerminal',
			token: 'tok-caller',
			rawArgs: { terminalId: 'term-1' },
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('invalid-args');
		}
	});

	// Closing discards the scrollback for good, and the workspace scope check
	// cannot tell an agent's own spawn terminal from the one the user is working
	// in — both sit in the same workspace. So ownership is enforced rather than
	// asked for in the playbook.
	it('refuses a close on a terminal this session did not start', async () => {
		const ports = makePorts();
		const { service, registry } = setup({ ports });
		const other = registry.register({
			sessionId: 'other',
			workspaceId: 'ws',
			workspaceCwd: '/ws',
			species: 'pi',
		});
		await startTerminalAs(service, 'tok-caller');
		const result = await service.invoke({
			op: 'stopTerminal',
			token: other.token,
			rawArgs: { terminalId: 'term-1', close: true },
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('denied-scope');
			expect(result.error).toContain('yours to close');
		}
		expect(ports.terminals.stopTerminal).not.toHaveBeenCalled();
	});

	// Stopping is recoverable — the tab stays and its output stays readable — so
	// it keeps the workspace-scope check it always had and gains no owner check.
	it('leaves an ordinary stop open to any session in the workspace', async () => {
		const ports = makePorts();
		const { service, registry } = setup({ ports });
		const other = registry.register({
			sessionId: 'other',
			workspaceId: 'ws',
			workspaceCwd: '/ws',
			species: 'pi',
		});
		await startTerminalAs(service, 'tok-caller');
		const result = await service.invoke({
			op: 'stopTerminal',
			token: other.token,
			rawArgs: { terminalId: 'term-1' },
		});
		expect(result.ok).toBe(true);
		expect(ports.terminals.stopTerminal).toHaveBeenCalledWith(
			expect.objectContaining({ terminalId: 'term-1' }),
		);
	});

	// The record is dropped with the tab, so a later id that happens to repeat one
	// an earlier session closed does not inherit that session's ownership.
	it('forgets a terminal once its close succeeds', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });
		await startTerminalAs(service, 'tok-caller');
		await service.invoke({
			op: 'stopTerminal',
			token: 'tok-caller',
			rawArgs: { terminalId: 'term-1', close: true },
		});
		const again = await service.invoke({
			op: 'stopTerminal',
			token: 'tok-caller',
			rawArgs: { terminalId: 'term-1', close: true },
		});
		expect(again.ok).toBe(false);
		if (!again.ok) {
			expect(again.code).toBe('denied-scope');
		}
	});

	// Closing a script by kind would take away a tab the user is watching, and
	// the kind selector cannot name which terminal that is.
	it('refuses a close that names a kind rather than a terminal', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'stopTerminal',
			token: 'tok-caller',
			rawArgs: { kind: 'run', close: true },
		});
		expect(result.ok).toBe(false);
		expect(ports.terminals.stopTerminal).not.toHaveBeenCalled();
	});

	// A terminal an agent started behind whatever dock tab was already open is one
	// the user never sees, so starting one focuses it.
	it('brings a spawned terminal forward in the dock', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });
		const result = await service.invoke({
			op: 'startTerminal',
			token: 'tok-caller',
			rawArgs: { kind: 'spawn' },
		});
		expect(result.ok).toBe(true);
		expect(ports.focus.focusDockTab).toHaveBeenCalledWith({
			workspaceId: 'ws',
			dock: 'terminal:term-1',
		});
	});

	it('brings a started script forward by its fixed dock tab', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });
		await service.invoke({
			op: 'startTerminal',
			token: 'tok-caller',
			rawArgs: { kind: 'run', scriptName: 'playground' },
		});
		expect(ports.focus.focusDockTab).toHaveBeenCalledWith({
			workspaceId: 'ws',
			dock: 'run',
		});
	});

	it('focuses nothing when the start was refused', async () => {
		const ports = makePorts();
		vi.mocked(ports.terminals.startTerminal).mockResolvedValue({
			ok: false,
			code: 'script-already-running',
			message: 'A run script is already running.',
		});
		const { service } = setup({ ports });
		await service.invoke({
			op: 'startTerminal',
			token: 'tok-caller',
			rawArgs: { kind: 'run' },
		});
		expect(ports.focus.focusDockTab).not.toHaveBeenCalled();
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
				shell: '/bin/zsh',
				foregroundCommand: null,
				status: 'exited',
				workspaceId: 'ws',
			},
			{
				terminalId: 'term-run',
				kind: 'run-script',
				scriptName: 'playground',
				shell: '/bin/zsh',
				foregroundCommand: null,
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
				shell: '/bin/zsh',
				foregroundCommand: null,
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

// Two orchestrators in one workspace are two writers on one git checkout, and the
// app cannot arbitrate that. So every gate here is about the two things it CAN
// do: make the user authorize the second writer rather than take the agent's word
// that they asked, and bound how many there can be.
describe('agent-control service: peer orchestrators', () => {
	const PEER = {
		peer: true,
		prompt: 'Take the renderer half.',
		title: 'Renderer half',
	};

	it('opens a peer as a root, with no parent and the co-tenancy contract in its prompt', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });

		const result = await service.invoke({
			op: 'startConversation',
			token: 'tok-caller',
			rawArgs: PEER,
		});

		expect(result.ok).toBe(true);
		const call = vi
			.mocked(ports.conversations.startConversation)
			.mock.calls.at(0)?.[0];
		expect(call?.asPeer).toBe(true);
		expect(call?.prompt).toContain('YOU ARE A PEER ORCHESTRATOR');
		expect(call?.prompt).toContain('caller');
		expect(call?.prompt).toContain('Take the renderer half.');
	});

	// "The user explicitly asked for this" is not something a model can establish
	// about its own prompt, so the flag states an intent and the confirmation is
	// what turns it into authority.
	it('asks the user even in a mode that confirms nothing else', async () => {
		const ports = makePorts({ mode: 'workspace-trusted' });
		const { service } = setup({ ports });

		await service.invoke({
			op: 'startConversation',
			token: 'tok-caller',
			rawArgs: PEER,
		});
		const ordinary = makePorts({ mode: 'workspace-trusted' });
		await setup({ ports: ordinary }).service.invoke({
			op: 'startConversation',
			token: 'tok-caller',
			rawArgs: { prompt: 'go' },
		});

		expect(ports.confirm.confirm).toHaveBeenCalledTimes(1);
		expect(ordinary.confirm.confirm).not.toHaveBeenCalled();
	});

	it('opens nothing when the user declines', async () => {
		const ports = makePorts({ confirm: false });
		const { service } = setup({ ports });

		const result = await service.invoke({
			op: 'startConversation',
			token: 'tok-caller',
			rawArgs: PEER,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('denied-permission');
			expect(result.error).toContain('do not ask again');
		}
		expect(ports.conversations.startConversation).not.toHaveBeenCalled();
	});

	// The cap is what bounds the recursion: a peer is a root and looks like one to
	// every gate, so a peer opening a peer is refused because the workspace is
	// full rather than by a rule about who may open what.
	it('refuses a third orchestrator in one workspace and names the two already there', async () => {
		const ports = makePorts();
		const { registry, service } = setup({ ports });
		registry.register({
			sessionId: 'peer',
			species: 'pi',
			workspaceCwd: '/ws',
			workspaceId: 'ws',
		});

		const result = await service.invoke({
			op: 'startConversation',
			token: 'tok-caller',
			rawArgs: PEER,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('denied-quota');
			expect(result.error).toContain('caller');
			expect(result.error).toContain('peer');
		}
		expect(ports.conversations.startConversation).not.toHaveBeenCalled();
	});

	// A resumed sub-agent re-registers at depth 0 and would otherwise be counted
	// as a second orchestrator, refusing a peer the workspace has room for.
	it('does not count a spawned sub-agent towards the cap', async () => {
		const ports = makePorts();
		vi.mocked(ports.conversations.isSpawnedSubAgent).mockImplementation(
			async (sessionId) => sessionId === 'child',
		);
		const { registry, service } = setup({ ports });
		registry.register({
			sessionId: 'child',
			species: 'pi',
			workspaceCwd: '/ws',
			workspaceId: 'ws',
		});

		const result = await service.invoke({
			op: 'startConversation',
			token: 'tok-caller',
			rawArgs: PEER,
		});

		expect(result.ok).toBe(true);
	});

	// Every terminal — a dev server included — mints one workspace-scoped
	// `harness` origin so a CLI the user starts by hand can reach the control
	// server, and nothing releases it. Counting that as an orchestrator spent the
	// workspace's whole allowance on a run script somebody opened once.
	it('does not count the origin a terminal launch registers', async () => {
		const ports = makePorts();
		const { registry, service } = setup({ ports });
		registry.register({
			sessionId: 'ws:ws',
			species: 'harness',
			workspaceCwd: '/ws',
			workspaceId: 'ws',
		});

		const result = await service.invoke({
			op: 'startConversation',
			token: 'tok-caller',
			rawArgs: PEER,
		});

		expect(result.ok).toBe(true);
	});

	// A harness is an unrestricted writer on the same checkout, so it counts for
	// the reason the cap exists — but it is counted live, from the terminal list,
	// rather than from an origin that only says one was opened here once.
	it('counts a running harness terminal, and says only the user can close it', async () => {
		const ports = makePorts();
		vi.mocked(ports.terminals.listTerminals).mockResolvedValue([
			{
				kind: 'agent',
				scriptName: null,
				shell: '/bin/zsh',
				foregroundCommand: null,
				status: 'running',
				terminalId: 'term-claude',
				workspaceId: 'ws',
			},
		]);
		const { service } = setup({ ports });

		const result = await service.invoke({
			op: 'startConversation',
			token: 'tok-caller',
			rawArgs: PEER,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('denied-quota');
			expect(result.error).toContain('term-claude');
			expect(result.error).toContain('only the user can close');
		}
		expect(ports.confirm.confirm).not.toHaveBeenCalled();
	});

	it('ignores a harness that has exited and a run script that is still going', async () => {
		const ports = makePorts();
		vi.mocked(ports.terminals.listTerminals).mockResolvedValue([
			{
				kind: 'agent',
				scriptName: null,
				shell: '/bin/zsh',
				foregroundCommand: null,
				status: 'exited',
				terminalId: 'term-dead',
				workspaceId: 'ws',
			},
			{
				kind: 'run-script',
				scriptName: 'dev',
				shell: '/bin/zsh',
				foregroundCommand: null,
				status: 'running',
				terminalId: 'term-dev',
				workspaceId: 'ws',
			},
		]);
		const { service } = setup({ ports });

		const result = await service.invoke({
			op: 'startConversation',
			token: 'tok-caller',
			rawArgs: PEER,
		});

		expect(result.ok).toBe(true);
	});

	// The cap is read before a prompt that blocks with no time limit, and the peer
	// registers an origin only once it is open, so without a reservation two
	// spawns issued in one parallel block both read the same count and both pass.
	it('refuses a second peer issued while the first is still opening', async () => {
		const ports = makePorts();
		let releaseFirstSpawn = (): void => {};
		const firstSpawnOpening = new Promise<void>((resolve) => {
			releaseFirstSpawn = resolve;
		});
		vi.mocked(ports.conversations.startConversation).mockImplementation(
			async () => {
				await firstSpawnOpening;
				return { agentSessionId: 'pi-peer', chatTabId: 't', ok: true };
			},
		);
		const { service } = setup({ ports });

		const first = service.invoke({
			op: 'startConversation',
			token: 'tok-caller',
			rawArgs: PEER,
		});
		const second = await service.invoke({
			op: 'startConversation',
			token: 'tok-caller',
			rawArgs: { ...PEER, title: 'Third half' },
		});

		expect(second.ok).toBe(false);
		if (!second.ok) {
			expect(second.code).toBe('denied-quota');
		}
		releaseFirstSpawn();
		expect((await first).ok).toBe(true);
	});

	it('gives the slot back when the user declines, so the next ask still works', async () => {
		const ports = makePorts({ confirm: false });
		const { service } = setup({ ports });

		const declined = await service.invoke({
			op: 'startConversation',
			token: 'tok-caller',
			rawArgs: PEER,
		});
		vi.mocked(ports.confirm.confirm).mockResolvedValue(true);
		const retried = await service.invoke({
			op: 'startConversation',
			token: 'tok-caller',
			rawArgs: PEER,
		});

		expect(declined.ok).toBe(false);
		expect(retried.ok).toBe(true);
	});

	it('refuses a peer while planning', async () => {
		const ports = makePorts({ planning: true });
		const { service } = setup({ ports });

		const result = await service.invoke({
			op: 'startConversation',
			token: 'tok-caller',
			rawArgs: PEER,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('denied-scope');
		}
		expect(ports.confirm.confirm).not.toHaveBeenCalled();
	});

	it('tells the Concierge that what it opens is already a root', async () => {
		const ports = makePorts();
		ports.workspaces.listWorkspaces = vi
			.fn()
			.mockResolvedValue([{ cwd: '/ws', name: 'ws', workspaceId: 'ws' }]);
		const { service } = setup({ concierge: true, ports });

		const result = await service.invoke({
			op: 'startConversation',
			token: 'tok-caller',
			rawArgs: { ...PEER, workspaceId: 'ws' },
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('invalid-args');
		}
	});

	it('rejects a peer with no title, and a peer asked to be waited on', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });

		const untitled = await service.invoke({
			op: 'startConversation',
			token: 'tok-caller',
			rawArgs: { peer: true, prompt: 'go' },
		});
		const waited = await service.invoke({
			op: 'startConversation',
			token: 'tok-caller',
			rawArgs: { ...PEER, wait: true },
		});

		expect(untitled.ok).toBe(false);
		expect(waited.ok).toBe(false);
		if (!waited.ok) {
			expect(waited.error).toContain('not a child to wait on');
		}
		expect(ports.conversations.startConversation).not.toHaveBeenCalled();
	});

	it('leaves an ordinary spawn a sub-agent, with its lineage intact', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });

		await service.invoke({
			op: 'startConversation',
			token: 'tok-caller',
			rawArgs: { prompt: 'go' },
		});

		const call = vi
			.mocked(ports.conversations.startConversation)
			.mock.calls.at(0)?.[0];
		expect(call?.asPeer).toBe(false);
		expect(call?.parentSessionId).toBe('caller');
		expect(call?.prompt).toBe('go');
	});
});

// The Concierge never reads a workspace on its own initiative, so this is the one
// channel by which anything an orchestrator finds reaches it at all. Every failure
// mode here is the same failure — a discovery that reaches nobody — so what
// matters is that a refusal says where to put it instead, and that the header
// says who is speaking: the Concierge acts on other workspaces on the strength of
// it, and cannot otherwise tell an agent's message from the user's.
describe('agent-control service: messaging the Concierge', () => {
	it('delivers the message with the sender the app resolved, not one it was told', async () => {
		const deliverMessage = vi.fn().mockResolvedValue({
			conciergeSessionId: 'concierge-1',
			delivered: true,
		});
		const { service } = setup({ ports: makePorts({ deliverMessage }) });

		const result = await service.invoke({
			op: 'messageConcierge',
			token: 'tok-caller',
			rawArgs: {
				message: 'The brief names a file that does not exist.',
				reason: 'brief_wrong',
			},
		});

		expect(result.ok).toBe(true);
		const prompt = deliverMessage.mock.calls.at(0)?.[0].prompt ?? '';
		expect(prompt).toContain('MESSAGE FROM AN AGENT');
		expect(prompt).toContain('brief it was given is wrong');
		expect(prompt).toContain('caller');
		expect(prompt).toContain('The brief names a file that does not exist.');
	});

	it('reports which Concierge conversation took it, which the agent could not know', async () => {
		const ports = makePorts();
		const { service } = setup({ ports });

		const result = await service.invoke({
			op: 'messageConcierge',
			token: 'tok-caller',
			rawArgs: { message: 'Finished.', reason: 'done' },
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toMatchObject({ conciergeSessionId: 'concierge-1' });
		}
	});

	// Queueing was the alternative and is worse: delivered hours later, into a
	// conversation that has since been cleared, it is context nobody can place.
	it('refuses when no Concierge conversation is open and names what to do instead', async () => {
		const deliverMessage = vi.fn().mockResolvedValue({
			cause: 'no-session',
			delivered: false,
			detail: '',
		});
		const { service } = setup({ ports: makePorts({ deliverMessage }) });

		const result = await service.invoke({
			op: 'messageConcierge',
			token: 'tok-caller',
			rawArgs: { message: 'Blocked on the API key.', reason: 'blocked' },
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('not-found');
			expect(result.error).toContain('not queued');
			expect(result.error).toContain('last message');
		}
	});

	// Concierge → orchestrator → Concierge has no natural end, so the cap is what
	// stops one workspace's agent from driving the supervisor in a circle.
	it('caps how many messages one conversation may send', async () => {
		const deliverMessage = vi.fn().mockResolvedValue({
			conciergeSessionId: 'concierge-1',
			delivered: true,
		});
		const { service } = setup({
			guardrails: { maxConciergeMessagesPerSession: 2 },
			ports: makePorts({ deliverMessage }),
		});
		const send = () =>
			service.invoke({
				op: 'messageConcierge',
				token: 'tok-caller',
				rawArgs: { message: 'Still going.', reason: 'progress' },
			});

		expect((await send()).ok).toBe(true);
		expect((await send()).ok).toBe(true);
		const third = await send();

		expect(third.ok).toBe(false);
		if (!third.ok) {
			expect(third.code).toBe('denied-quota');
		}
		expect(deliverMessage).toHaveBeenCalledTimes(2);
	});

	// `no-session` returns before the port attaches anything, so it costs nothing
	// and stays free: an agent that could not reach the Concierge has said
	// nothing, and burning its budget on the attempt would silence it for the
	// rest of the run.
	it('does not spend the allowance when no conversation was there to take it', async () => {
		const deliverMessage = vi
			.fn()
			.mockResolvedValueOnce({
				cause: 'no-session',
				delivered: false,
				detail: '',
			})
			.mockResolvedValue({
				conciergeSessionId: 'concierge-1',
				delivered: true,
			});
		const { service } = setup({
			guardrails: { maxConciergeMessagesPerSession: 1 },
			ports: makePorts({ deliverMessage }),
		});

		const refused = await service.invoke({
			op: 'messageConcierge',
			token: 'tok-caller',
			rawArgs: { message: 'Blocked.', reason: 'blocked' },
		});
		const later = await service.invoke({
			op: 'messageConcierge',
			token: 'tok-caller',
			rawArgs: { message: 'Blocked.', reason: 'blocked' },
		});

		expect(refused.ok).toBe(false);
		expect(later.ok).toBe(true);
	});

	// `failed` is the other half and is not free: it got as far as attaching, so
	// it may have spent two runtime children. Left uncounted, an agent looping
	// against a broken runtime spawns a process per attempt with nothing to stop
	// it — the allowance is the only thing that bounds this op.
	it('spends the allowance on a delivery that failed after attaching', async () => {
		const deliverMessage = vi.fn().mockResolvedValue({
			cause: 'failed',
			delivered: false,
			detail: 'The runtime could not start a child.',
		});
		const { service } = setup({
			guardrails: { maxConciergeMessagesPerSession: 1 },
			ports: makePorts({ deliverMessage }),
		});
		const send = () =>
			service.invoke({
				op: 'messageConcierge',
				token: 'tok-caller',
				rawArgs: { message: 'Blocked.', reason: 'blocked' },
			});

		const first = await send();
		const second = await send();

		expect(first.ok).toBe(false);
		if (!first.ok) {
			expect(first.code).toBe('internal');
		}
		expect(second.ok).toBe(false);
		if (!second.ok) {
			expect(second.code).toBe('denied-quota');
		}
		expect(deliverMessage).toHaveBeenCalledTimes(1);
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

	// A search that came back `not-connected` never read the backlog, so it is not
	// the looking the precondition is about — clearing the gate on the attempt
	// would let the duplicate guard be satisfied by a call that saw nothing.
	it('does not let a search that failed clear the first filing', async () => {
		const ports = makePorts();
		vi.mocked(ports.linear.listIssues).mockResolvedValue({
			issues: [],
			message: 'Linear is not connected.',
			omittedIssues: 0,
			source: null,
			status: 'not-connected',
			truncated: false,
		});
		const { service } = setup({ ports });

		const searched = await service.invoke({
			op: 'linearListIssues',
			token: 'tok-caller',
			rawArgs: { query: 'terminal drops a line' },
		});
		const filed = await service.invoke({
			op: 'linearCreateIssue',
			token: 'tok-caller',
			rawArgs: { teamId: 't-1', title: 'A follow-up' },
		});

		expect(searched.ok).toBe(true);
		expect(filed.ok).toBe(false);
		if (!filed.ok) {
			expect(filed.code).toBe('denied-scope');
		}
		expect(ports.linear.createIssue).not.toHaveBeenCalled();
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
		const other = registry.register({
			sessionId: 'other',
			species: 'pi',
			workspaceCwd: '/ws',
			workspaceId: 'ws',
		});
		const result = await service.invoke({
			op: 'linearCreateIssue',
			token: other.token,
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
			data: {
				rolePlaybook: conciergeAwareness({
					architectureDiagram: true,
					tuiHarnesses: true,
				}),
			},
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
			tuiHarnesses: true,
			delegation: 'ensemblr',
			depth: 0,
			hasChatTab: true,
			retired: false,
			role: 'orchestrator',
		});
	});

	it('reports a Claude root as a chat-tab orchestrator', async () => {
		const { service } = setup({ ports: makePorts(), species: 'claude' });

		expect(await service.describeAudience('tok-caller')).toEqual({
			architectureDiagram: true,
			tuiHarnesses: true,
			delegation: 'ensemblr',
			depth: 0,
			hasChatTab: true,
			retired: false,
			role: 'orchestrator',
		});
	});

	it('reports a harness as having no chat tab', async () => {
		const { service } = setup({ ports: makePorts(), species: 'harness' });

		expect(await service.describeAudience('tok-caller')).toEqual({
			architectureDiagram: true,
			tuiHarnesses: true,
			delegation: 'ensemblr',
			hasChatTab: false,
			retired: false,
			role: 'orchestrator',
			depth: 0,
		});
	});

	it('carries the durable sub-agent marker into the audience', async () => {
		const { service } = setup({
			ports: makePorts({ spawnedSubAgent: true }),
			species: 'claude',
		});

		expect(await service.describeAudience('tok-caller')).toEqual({
			architectureDiagram: true,
			tuiHarnesses: true,
			delegation: 'ensemblr',
			hasChatTab: true,
			retired: false,
			role: 'subagent',
			depth: 0,
		});
	});

	it('reports a retired Concierge audience', async () => {
		const { service, registry } = setup({ concierge: true });
		registry.retire('caller');

		expect(await service.describeAudience('tok-caller')).toEqual({
			architectureDiagram: true,
			tuiHarnesses: true,
			delegation: 'ensemblr',
			hasChatTab: true,
			retired: true,
			role: 'concierge',
			depth: 0,
		});
	});

	// An unresolvable token is refused by every op it goes on to call, so the list
	// it sees barely matters — but it must not be the widest one on offer.
	it('falls back to the narrowest surface for an unknown token', async () => {
		const { service } = setup({ ports: makePorts() });

		expect(await service.describeAudience('bogus')).toEqual({
			architectureDiagram: true,
			tuiHarnesses: true,
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
			deliverMessage: vi.fn().mockResolvedValue({
				conciergeSessionId: 'concierge-1',
				delivered: true,
			}),
			describeContextUsage: () => null,
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

// How full a window is is the one thing an agent cannot learn by naming an id:
// it does not know which id it is. `getConversationStatus` is therefore the only
// op whose target argument is optional, and these cover both readings.
describe('agent-control service: reporting context usage', () => {
	const usage = { contextWindow: 200_000, percent: 71.4, tokens: 142_800 };

	it('reports the caller’s own conversation when no session is named', async () => {
		const ports = makePorts();
		ports.conversations.getStatus = vi.fn().mockResolvedValue({
			agentSessionId: 'caller',
			contextUsage: usage,
			runtimeOpen: true,
			status: 'streaming',
		});
		const { service } = setup({ ports });

		const result = await service.invoke({
			op: 'getConversationStatus',
			token: 'tok-caller',
			rawArgs: {},
		});

		expect(ports.conversations.getStatus).toHaveBeenCalledWith('caller');
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toMatchObject({
				agentSessionId: 'caller',
				contextUsage: usage,
			});
		}
	});

	// The two readings prompt different moves, so a caller must not be handed the
	// advice meant for the other: a conversation cannot retire itself.
	it('gives a caller reading itself the inward-facing advice', async () => {
		const ports = makePorts();
		ports.conversations.getStatus = vi.fn().mockResolvedValue({
			agentSessionId: 'caller',
			contextUsage: usage,
			runtimeOpen: true,
			status: 'streaming',
		});
		const { service } = setup({ ports });

		const own = await service.invoke({
			op: 'getConversationStatus',
			token: 'tok-caller',
			rawArgs: {},
		});
		const other = await service.invoke({
			op: 'getConversationStatus',
			token: 'tok-caller',
			rawArgs: { agentSessionId: 'child-1' },
		});

		expect(own.ok && other.ok).toBe(true);
		if (own.ok && other.ok) {
			const ownNote = (own.data as { note?: string }).note;
			const otherNote = (other.data as { note?: string }).note;
			expect(ownNote).toContain('Your own context window is 71% full');
			expect(otherNote).toContain('Context pressure');
			expect(otherNote).not.toEqual(ownNote);
		}
	});

	it('attaches no note while the window still has room', async () => {
		const ports = makePorts();
		ports.conversations.getStatus = vi.fn().mockResolvedValue({
			agentSessionId: 'child-1',
			contextUsage: { contextWindow: 200_000, percent: 8, tokens: 16_000 },
			runtimeOpen: true,
			status: 'idle',
		});
		const { service } = setup({ ports });

		const result = await service.invoke({
			op: 'getConversationStatus',
			token: 'tok-caller',
			rawArgs: { agentSessionId: 'child-1' },
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).not.toHaveProperty('note');
		}
	});

	// The Concierge keeps its own session store, so the agent-session lookup holds
	// no row for the caller most likely to ask.
	it('resolves the Concierge’s own reading through the Concierge port', async () => {
		const { service, ports } = setupConcierge();
		const concierge = ports.concierge;
		if (!concierge) {
			throw new Error('the Concierge fixture must wire its own ports');
		}
		concierge.describeContextUsage = vi.fn().mockReturnValue(usage);

		const result = await service.invoke({
			op: 'getConversationStatus',
			token: 'tok-caller',
			rawArgs: {},
		});

		expect(concierge.describeContextUsage).toHaveBeenCalled();
		expect(ports.conversations.getStatus).not.toHaveBeenCalled();
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toMatchObject({ contextUsage: usage });
		}
	});

	// `getConversationStatus` is held by every role, including the two whose lists
	// have `startConversation` withheld. Naming it to them sends a model after a
	// tool it does not hold, which is the one way this op can mislead.
	it('does not tell a spawned sub-agent to spawn its way out', async () => {
		const ports = makePorts();
		ports.conversations.getStatus = vi.fn().mockResolvedValue({
			agentSessionId: 'caller',
			contextUsage: usage,
			runtimeOpen: true,
			status: 'streaming',
		});
		vi.mocked(ports.conversations.isSpawnedSubAgent).mockResolvedValue(true);
		const { service } = setup({ ports });

		const result = await service.invoke({
			op: 'getConversationStatus',
			token: 'tok-caller',
			rawArgs: {},
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			const { note } = result.data as { note?: string };
			expect(note).toContain('71% full');
			expect(note).toContain('cannot delegate onward');
			expect(note).not.toContain('ensemblr_start_conversation');
		}
	});

	it('gives a depth-1 manager delegation-aware context advice', async () => {
		const ports = makePorts({ spawnedSubAgent: true });
		ports.conversations.getStatus = vi.fn().mockResolvedValue({
			agentSessionId: 'caller',
			contextUsage: usage,
			runtimeOpen: true,
			status: 'streaming',
		});
		const { service } = setup({
			ports,
			lineage: {
				depth: 1,
				parentSessionId: 'root',
				rootSessionId: 'root',
			},
		});

		const result = await service.invoke({
			op: 'getConversationStatus',
			token: 'tok-caller',
			rawArgs: {},
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			const { note } = result.data as { note?: string };
			expect(note).toContain('ensemblr_start_conversation');
		}
	});

	// A root delegating through its own runtime has the same op withheld, and is
	// the case NATIVE_CONTEXT_PRESSURE_GUIDANCE already covers in the playbook.
	it('points a natively-delegating root at its own runtime', async () => {
		const ports = makePorts();
		ports.conversations.getStatus = vi.fn().mockResolvedValue({
			agentSessionId: 'caller',
			contextUsage: usage,
			runtimeOpen: true,
			status: 'streaming',
		});
		const { service } = setup({ delegation: 'native', ports });

		const result = await service.invoke({
			op: 'getConversationStatus',
			token: 'tok-caller',
			rawArgs: {},
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			const { note } = result.data as { note?: string };
			expect(note).toContain("your own runtime's sub-agent tool");
			expect(note).not.toContain('ensemblr_start_conversation');
		}
	});

	// The delegate-facing note needs the same treatment: a sub-agent can name any
	// conversation id, and cannot act on advice to spawn or to follow up.
	it('does not tell a sub-agent to spawn when it reads another conversation', async () => {
		const ports = makePorts();
		ports.conversations.getStatus = vi.fn().mockResolvedValue({
			agentSessionId: 'child-1',
			contextUsage: usage,
			runtimeOpen: true,
			status: 'idle',
		});
		vi.mocked(ports.conversations.isSpawnedSubAgent).mockResolvedValue(true);
		const { service } = setup({ ports });

		const result = await service.invoke({
			op: 'getConversationStatus',
			token: 'tok-caller',
			rawArgs: { agentSessionId: 'child-1' },
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			const { note } = result.data as { note?: string };
			expect(note).toContain('Context pressure');
			expect(note).not.toContain('ensemblr_start_conversation');
			expect(note).toContain('report');
		}
	});

	// A harness origin is minted per workspace and shared by every terminal in it,
	// so there is no conversation behind it — and a null there would read as "no
	// usage" rather than "wrong question".
	it('refuses a self-read from a terminal harness rather than answering null', async () => {
		const { service } = setup({ species: 'harness' });

		const result = await service.invoke({
			op: 'getConversationStatus',
			token: 'tok-caller',
			rawArgs: {},
		});

		expect(result).toMatchObject({ code: 'not-found', ok: false });
	});
});
