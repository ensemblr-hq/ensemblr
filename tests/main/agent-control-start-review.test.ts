import { describe, expect, it, vi } from 'vitest';

import {
	type AgentControlPorts,
	createAgentControlService,
	createGuardrails,
	createOriginRegistry,
	type OriginRegistry,
} from '../../src/main/agent-control/index.ts';
import type { AgentControlResult } from '../../src/shared/agent-control.ts';
import { REVIEW_PEER_BRIEF_HEADER } from '../../src/shared/agent-control.ts';

const CALLER = 'caller';

/** Options every stub in {@link makePorts} varies on. */
interface PortOptions {
	brief?: {
		model: string | null;
		prompt: string;
		source: 'renderer' | 'fallback';
		thinkingLevel: string | null;
	};
	confirm: ReturnType<typeof vi.fn>;
	planning?: boolean;
	runtimeModels?: { id: string }[];
	startConversation: ReturnType<typeof vi.fn>;
	terminals?: { kind: string; status: string; terminalId: string }[];
	unattended?: boolean;
}

/**
 * Ports for the review-launch cases. Only `reviewLaunch`, `conversations`, and
 * `terminals` carry real behavior: the brief the renderer composed, the spawn
 * the op delegates to, and the harness terminals that count against the
 * workspace's co-tenancy allowance.
 */
const makePorts = (options: PortOptions): AgentControlPorts =>
	({
		afkMode: {
			activateForSpawn: vi.fn(),
			isActive: vi.fn(() => options.unattended === true),
			releaseSession: vi.fn(),
		},
		ask: { ask: vi.fn(), releaseSession: vi.fn() },
		board: {
			getWorkspaceStatus: vi.fn().mockReturnValue('backlog'),
			setWorkspaceStatus: vi.fn(),
		},
		commitCredit: { isCoAuthorEnabled: () => false },
		confirm: { confirm: options.confirm },
		conversations: {
			getLastMessage: vi.fn().mockResolvedValue('last'),
			getStatus: vi.fn().mockResolvedValue(null),
			hasFinalMessage: vi.fn().mockResolvedValue(false),
			isSpawnedSubAgent: vi.fn().mockResolvedValue(false),
			listModels: vi.fn().mockResolvedValue({
				defaultModelId: 'm',
				models: options.runtimeModels ?? [{ id: 'claude-opus-5' }],
			}),
			readTranscript: vi.fn(),
			resolveConversationWorkspace: vi.fn().mockResolvedValue('ws'),
			sendFollowUp: vi.fn().mockResolvedValue(undefined),
			setName: vi.fn().mockResolvedValue(null),
			startConversation: options.startConversation,
			waitForIdle: vi.fn().mockResolvedValue('completed'),
		},
		diff: { readWorkspaceDiff: vi.fn() },
		focus: {
			focusDockTab: vi.fn(),
			focusPanel: vi.fn(),
			focusTab: vi.fn(),
			focusWorkspace: vi.fn(),
		},
		harnesses: { launchHarness: vi.fn() },
		language: { getLanguage: () => 'en' },
		linear: { readLinkedIssue: vi.fn().mockReturnValue(null) },
		permissions: { getMode: () => 'workspace-trusted' },
		planMode: {
			activateForSpawn: vi.fn(),
			exit: vi.fn(),
			hasSubmittedPlan: vi.fn(() => false),
			isActive: vi.fn(() => options.planning === true),
			releaseSession: vi.fn(),
		},
		review: {
			addComments: vi.fn(),
			listComments: vi.fn(),
			resolveComments: vi.fn(),
		},
		reviewLaunch: {
			composeBrief: vi.fn().mockResolvedValue(
				options.brief ?? {
					model: 'claude-opus-5',
					prompt: 'THE REVIEW PROMPT',
					source: 'renderer',
					thinkingLevel: 'high',
				},
			),
		},
		sessionNaming: {
			readBrief: vi.fn().mockResolvedValue({
				branch: { current: null, eligible: false },
				diagram: { components: [], stale: false },
				summaryStale: false,
				titleNeeded: false,
			}),
		},
		tabs: {
			closeTab: vi.fn(),
			listTabs: vi.fn().mockResolvedValue([]),
			openNonChatTab: vi.fn(),
			resolveTabWorkspace: vi.fn().mockResolvedValue('ws'),
			spawnChatTab: vi.fn().mockResolvedValue({ chatTabId: 'new-tab' }),
		},
		terminals: {
			listRunScripts: vi.fn().mockResolvedValue({ scripts: [] }),
			listTerminals: vi.fn().mockResolvedValue(options.terminals ?? []),
			readOutput: vi.fn(),
			resolveTerminalWorkspace: vi.fn().mockResolvedValue('ws'),
			startTerminal: vi.fn(),
			stopTerminal: vi.fn(),
			writeTerminal: vi.fn(),
		},
		workspaces: {
			listProjects: vi.fn().mockResolvedValue([]),
			listWorkspaces: vi.fn().mockResolvedValue([]),
		},
	}) as unknown as AgentControlPorts;

/** Registers one orchestrator behind a predictable token and builds the service. */
const setup = (
	options: Partial<PortOptions> & { concierge?: boolean } = {},
) => {
	const confirm = options.confirm ?? vi.fn().mockResolvedValue(true);
	const startConversation =
		options.startConversation ??
		vi.fn().mockResolvedValue({
			agentSessionId: 'review-1',
			chatTabId: 'review-tab',
			ok: true,
		});
	const registry: OriginRegistry = createOriginRegistry({
		generateToken: () => 'tok-caller',
	});
	registry.register({
		concierge: options.concierge === true,
		sessionId: CALLER,
		species: 'pi',
		workspaceCwd: '/ws',
		workspaceId: options.concierge === true ? '' : 'ws',
	});
	const ports = makePorts({ ...options, confirm, startConversation });
	const service = createAgentControlService({
		guardrails: createGuardrails(),
		originRegistry: registry,
		ports,
	});
	return { confirm, ports, registry, service, startConversation };
};

const startReview = (
	service: ReturnType<typeof setup>['service'],
	rawArgs: Record<string, unknown> = {},
) => service.invoke({ op: 'startReview', rawArgs, token: 'tok-caller' });

/** Narrows a control envelope to its success side, failing the case otherwise. */
const succeeded = (result: AgentControlResult<unknown>) => {
	expect(result.ok).toBe(true);
	if (!result.ok) {
		throw new Error(result.error);
	}
	return result.data as {
		agentSessionId: string;
		chatTabId: string;
		message: string;
	};
};

/** Narrows a control envelope to its failure side, failing the case otherwise. */
const refused = (result: AgentControlResult<unknown>) => {
	expect(result.ok).toBe(false);
	if (result.ok) {
		throw new Error('Expected the call to be refused.');
	}
	return result;
};

describe('agent-control startReview', () => {
	it('opens the review and reports the session to wait on', async () => {
		const { service, startConversation } = setup();

		const result = await startReview(service, { title: 'Review: the loop' });

		expect(succeeded(result)).toMatchObject({
			agentSessionId: 'review-1',
			chatTabId: 'review-tab',
		});
		expect(startConversation).toHaveBeenCalledWith(
			expect.objectContaining({
				title: 'Review: the loop',
				workspaceCwd: '/ws',
				workspaceId: 'ws',
			}),
		);
	});

	// A reviewer that cannot spawn its own readers reads a fifty-file diff in one
	// pass or not at all, so the root-orchestrator shape is the feature.
	it('opens a root orchestrator rather than a sub-agent', async () => {
		const { service, startConversation } = setup();

		await startReview(service);

		expect(startConversation.mock.calls[0][0]).toMatchObject({
			asPeer: true,
			planMode: false,
		});
	});

	it('names the workspace review when the caller supplies no title', async () => {
		const { service, startConversation } = setup();

		await startReview(service);

		expect(startConversation.mock.calls[0][0].title).toBe('Review');
	});

	// The reviewer answers to the orchestrator, not to a user reading its tab, so
	// the co-tenancy contract has to be in front of the review prompt.
	it('fronts the review prompt with the reviewer’s own contract', async () => {
		const { service, startConversation } = setup();

		await startReview(service);
		const { prompt } = startConversation.mock.calls[0][0];

		expect(prompt).toContain(REVIEW_PEER_BRIEF_HEADER);
		expect(prompt).toContain(CALLER);
		expect(prompt.indexOf(REVIEW_PEER_BRIEF_HEADER)).toBeLessThan(
			prompt.indexOf('THE REVIEW PROMPT'),
		);
	});

	it('runs the review on the model the user pinned for reviews', async () => {
		const { service, startConversation } = setup();

		await startReview(service);

		expect(startConversation.mock.calls[0][0]).toMatchObject({
			model: 'claude-opus-5',
			thinkingLevel: 'high',
		});
	});

	// The review model is one app-level preference set once, and nothing ties it
	// to the runtime a given workspace agent runs. A spawn refuses a model from
	// the other runtime outright, and this op takes no model argument — so
	// forwarding it unchecked would dead-end the caller on an unanswerable
	// refusal.
	it('drops a review model the caller cannot spawn on, and says so', async () => {
		const { service, startConversation } = setup({
			runtimeModels: [{ id: 'anthropic/sonnet' }],
		});

		const { message } = succeeded(await startReview(service));

		expect(startConversation.mock.calls[0][0]).toMatchObject({
			model: undefined,
			thinkingLevel: undefined,
		});
		expect(message).toContain('the other agent runtime');
		expect(message).toContain('Say so in your report');
	});

	it('says nothing about the model when the pin was honoured', async () => {
		const { service } = setup();

		expect(succeeded(await startReview(service)).message).not.toContain(
			'Say so in your report',
		);
	});

	// A review opened without the user's own instructions is a weaker review than
	// the one they configured, and the agent's report should be able to say so.
	it('tells the caller when main composed the brief on its own', async () => {
		const { service } = setup({
			brief: {
				model: null,
				prompt: 'FALLBACK PROMPT',
				source: 'fallback',
				thinkingLevel: null,
			},
		});

		const result = await startReview(service);

		expect(succeeded(result).message).toContain(
			'No Ensemblr window answered in time',
		);
	});

	it('tells the caller how to wait on and steer what it opened', async () => {
		const { service } = setup();

		const { message } = succeeded(await startReview(service));

		expect(message).toContain('targets: ["review-1"]');
		expect(message).toContain('ensemblr_send_follow_up');
		expect(message).toContain('leave the files alone');
	});

	// A reviewer spawned by an unattended agent must not raise a questionnaire in
	// a tab nobody is watching.
	it('passes AFK down to the review it opens', async () => {
		const { service, startConversation } = setup({ unattended: true });

		await startReview(service);

		expect(startConversation.mock.calls[0][0].afkMode).toBe(true);
	});

	// The peer confirmation exists because "the user asked for a second writer"
	// cannot be established from an agent's own prompt. This is the Review action
	// the user already has a button for, so there is nothing to establish.
	it('raises no confirmation', async () => {
		const { confirm, service } = setup();

		await startReview(service);

		expect(confirm).not.toHaveBeenCalled();
	});

	// It is a second writer on one checkout for exactly the reason a peer is, so
	// it answers a full workspace the same way.
	it('refuses when the workspace already holds its co-tenancy limit', async () => {
		const { service } = setup({
			terminals: [
				{ kind: 'agent', status: 'running', terminalId: 'term-1' },
				{ kind: 'agent', status: 'running', terminalId: 'term-2' },
			],
		});

		expect(refused(await startReview(service)).code).toBe('denied-quota');
	});

	it('refuses while the caller is planning', async () => {
		const { service, startConversation } = setup({ planning: true });

		expect(refused(await startReview(service)).code).toBe('denied-scope');
		expect(startConversation).not.toHaveBeenCalled();
	});

	it('refuses the Concierge, which has no change of its own to review', async () => {
		const { service, startConversation } = setup({ concierge: true });

		expect(refused(await startReview(service)).error).toContain(
			'none of your own',
		);
		expect(startConversation).not.toHaveBeenCalled();
	});

	// The reservation is released whatever the spawn did, or one failed launch
	// would spend a co-tenancy slot the workspace never gets back.
	it('frees the co-tenancy slot when the spawn is refused', async () => {
		const startConversation = vi
			.fn()
			.mockResolvedValueOnce({ ok: false, reason: 'no model' })
			.mockResolvedValue({
				agentSessionId: 'review-2',
				chatTabId: 'review-tab',
				ok: true,
			});
		const { service } = setup({ startConversation });

		const refused = await startReview(service);
		const retried = await startReview(service);

		expect(refused.ok).toBe(false);
		expect(retried.ok).toBe(true);
	});

	it('rejects an argument the schema does not accept', async () => {
		const { service } = setup();

		const result = await startReview(service, { focus: 'the error paths' });

		expect(refused(result).code).toBe('invalid-args');
	});
});
