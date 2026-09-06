import { describe, expect, it, vi } from 'vitest';

import {
	type AgentControlPorts,
	createAgentControlService,
	createGuardrails,
	createOriginRegistry,
	type OriginRegistry,
} from '../../src/main/agent-control/index.ts';
import type { AgentControlResult } from '../../src/shared/agent-control.ts';
import { REVIEW_SUBAGENT_BRIEF_HEADER } from '../../src/shared/agent-control.ts';

const CALLER = 'caller';

/** One catalogue row, cut to the fields the review's model resolution reads. */
interface CatalogRow {
	id: string;
	runtime: string;
	thinkingLevels: readonly string[];
}

/**
 * The app's model catalogue, one entry per runtime. The default puts the pinned
 * review model on the runtime the caller does *not* run on, because honouring a
 * cross-runtime pin is the behaviour most of these cases are about.
 */
const CATALOG: Record<string, CatalogRow[]> = {
	claude: [
		{
			id: 'claude-opus-5',
			runtime: 'claude',
			thinkingLevels: ['off', 'low', 'medium', 'high'],
		},
	],
	pi: [
		{ id: 'pi/sonnet', runtime: 'pi', thinkingLevels: ['off', 'low', 'high'] },
	],
};

/**
 * The models `listModels` answers with for one runtime, or for all of them when
 * the caller passes none. The null case is the port's own contract rather than a
 * convenience for these tests — `modelsOn` returns the whole merged snapshot for
 * a null runtime, and the review's model lookup depends on it, so a stub that
 * answered an empty list there would pass a lookup that production fails. Pi
 * first, because that is the order `mergeCatalogs` produces.
 * @param catalog - The per-runtime catalogue this case is running against.
 * @param runtime - The runtime to narrow to, or null for every runtime's.
 * @returns The rows in scope.
 */
const modelsFor = (
	catalog: Record<string, CatalogRow[]>,
	runtime: string | null,
): CatalogRow[] =>
	runtime === null
		? [...(catalog.pi ?? []), ...(catalog.claude ?? [])]
		: (catalog[runtime] ?? []);

/** Options every stub in {@link makePorts} varies on. */
interface PortOptions {
	brief?: {
		model: string | null;
		prompt: string;
		source: 'renderer' | 'fallback';
		thinkingLevel: string | null;
	};
	catalog?: Record<string, CatalogRow[]>;
	composeBrief?: ReturnType<typeof vi.fn>;
	confirm: ReturnType<typeof vi.fn>;
	planning?: boolean;
	startConversation: ReturnType<typeof vi.fn>;
	terminals?: { kind: string; status: string; terminalId: string }[];
	unattended?: boolean;
}

/**
 * Ports for the review-launch cases. Only `reviewLaunch`, `conversations`, and
 * `terminals` carry real behavior: the brief the renderer composed, the spawn
 * the op delegates to, and the harness terminals that fill the workspace's
 * co-tenancy allowance without refusing a review.
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
			listModels: vi.fn(({ runtime }: { runtime: string | null }) =>
				Promise.resolve({
					defaultModelId: 'm',
					models: modelsFor(options.catalog ?? CATALOG, runtime),
					runtime,
				}),
			),
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
			composeBrief:
				options.composeBrief ??
				vi.fn().mockResolvedValue(
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

	// A review opened as a root spends one of the workspace's two co-tenancy
	// slots and holds it for as long as the review is open, which the unattended
	// loop runs into first and hardest. As the caller's child it is bounded by the
	// per-session spawn guardrails instead.
	it('opens a sub-agent of the caller rather than a peer', async () => {
		const { service, startConversation } = setup();

		await startReview(service);

		expect(startConversation.mock.calls[0][0]).toMatchObject({
			asPeer: false,
			parentSessionId: CALLER,
			planMode: false,
		});
	});

	it('names the workspace review when the caller supplies no title', async () => {
		const { service, startConversation } = setup();

		await startReview(service);

		expect(startConversation.mock.calls[0][0].title).toBe('Review');
	});

	// The reviewer answers to the orchestrator, not to a user reading its tab, so
	// that contract has to be in front of the review prompt.
	it('fronts the review prompt with the reviewer’s own contract', async () => {
		const { service, startConversation } = setup();

		await startReview(service);
		const { prompt } = startConversation.mock.calls[0][0];

		expect(prompt).toContain(REVIEW_SUBAGENT_BRIEF_HEADER);
		expect(prompt).toContain(CALLER);
		expect(prompt.indexOf(REVIEW_SUBAGENT_BRIEF_HEADER)).toBeLessThan(
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

	// The review model and its level are one app-level preference the user sets
	// once, and nothing ties either to the runtime a given workspace agent happens
	// to run on. Withholding the caller's runtime is what lets the spawn open on
	// the model's own: `resolveRequested` refuses a cross-runtime model only
	// against a caller runtime it can see.
	it('opens the review on the pinned model’s runtime rather than the caller’s', async () => {
		const { service, startConversation } = setup();

		const { message } = succeeded(await startReview(service));

		expect(startConversation.mock.calls[0][0]).toMatchObject({
			callerRuntime: null,
			model: 'claude-opus-5',
		});
		expect(message).toContain('Claude Code');
		expect(message).toContain('Say so in your report');
	});

	// The runtime is withheld whenever a pin resolved, because the check it feeds
	// has nothing to say about a model on the caller's own runtime either. What
	// changes is the caveat: there is nothing to report when the review runs where
	// the caller does.
	it('raises no runtime caveat when the pinned model is already on the caller’s', async () => {
		const { service, startConversation } = setup({
			brief: {
				model: 'pi/sonnet',
				prompt: 'THE REVIEW PROMPT',
				source: 'renderer',
				thinkingLevel: 'high',
			},
		});

		const { message } = succeeded(await startReview(service));

		expect(startConversation.mock.calls[0][0].model).toBe('pi/sonnet');
		expect(message).not.toContain('Say so in your report');
	});

	// A stale preference must not sink the review: the caller's own model is a
	// weaker review than the one configured, and no review at all is weaker still.
	it('falls back to the caller’s model when the catalogue has lost the pin, and says so', async () => {
		const { service, startConversation } = setup({ catalog: { pi: [] } });

		const { message } = succeeded(await startReview(service));

		expect(startConversation.mock.calls[0][0]).toMatchObject({
			callerRuntime: 'pi',
			model: undefined,
		});
		expect(message).toContain("no longer in this app's catalogue");
		expect(message).toContain('Say so in your report');
	});

	// The two are independent settings and the Review button applies each behind
	// its own check, so coupling the level to the model pin loses it for a user
	// who set only the level.
	it('keeps the pinned thinking level when the user pinned no review model', async () => {
		const { service, startConversation } = setup({
			brief: {
				model: null,
				prompt: 'THE REVIEW PROMPT',
				source: 'renderer',
				thinkingLevel: 'high',
			},
		});

		await startReview(service);

		expect(startConversation.mock.calls[0][0].thinkingLevel).toBe('high');
	});

	it('keeps the pinned thinking level when the model pin is dropped', async () => {
		const { service, startConversation } = setup({ catalog: { pi: [] } });

		await startReview(service);

		expect(startConversation.mock.calls[0][0].thinkingLevel).toBe('high');
	});

	// The two runtimes do not share a thinking ladder, so a level set beside one
	// runtime's model is routinely absent from the other's. `selectionFor` refuses
	// such a spawn outright rather than coercing it, so forwarding the level would
	// cost the user the review to save the setting.
	it('drops a configured level the pinned model’s ladder has no rung for', async () => {
		const { service, startConversation } = setup({
			catalog: {
				claude: [
					{
						id: 'claude-opus-5',
						runtime: 'claude',
						thinkingLevels: ['off', 'low'],
					},
				],
			},
		});

		await startReview(service);

		expect(startConversation.mock.calls[0][0].thinkingLevel).toBeUndefined();
	});

	// Dropping it is a degradation of a setting the user chose, exactly as falling
	// back off their pinned model is. Reported rather than absorbed, or the caller
	// reports a review it believes ran at the level they set.
	it('says so when it drops the configured level', async () => {
		const { service } = setup({
			catalog: {
				claude: [
					{
						id: 'claude-opus-5',
						runtime: 'claude',
						thinkingLevels: ['off', 'low'],
					},
				],
			},
		});

		const { message } = succeeded(await startReview(service));

		expect(message).toContain('"high" thinking level');
		expect(message).toContain('Say so in your report');
	});

	// The level is only degraded when a model resolved to check it against. A user
	// who set a level and no model keeps it, and must not read a caveat saying
	// otherwise.
	it('raises no level caveat when the brief pinned no model', async () => {
		const { service, startConversation } = setup({
			brief: {
				model: null,
				prompt: 'THE REVIEW PROMPT',
				source: 'renderer',
				thinkingLevel: 'high',
			},
		});

		const { message } = succeeded(await startReview(service));

		expect(startConversation.mock.calls[0][0].thinkingLevel).toBe('high');
		expect(message).not.toContain('thinking level');
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

		expect(message).toContain('one of your sub-agents');
		expect(message).toContain('targets: ["review-1"]');
		expect(message).toContain('ensemblr_send_follow_up');
		expect(message).toContain('leave the files alone');
	});

	// The reviewer trades fanning readers out for costing no co-tenancy slot, and
	// an orchestrator that does not know it reads alone will cut its wait short on
	// a wide diff.
	it('says the reviewer reads the diff alone', async () => {
		const { service } = setup();

		expect(succeeded(await startReview(service)).message).toContain(
			'cannot spawn readers of its own',
		);
	});

	// Two reviewers are two writers over the same whole diff, so their files are
	// guaranteed to overlap — and the unattended loop's re-entry path walks back
	// through a step that says to call this op. The co-tenancy cap used to make
	// the second call impossible; this is what replaced it.
	it('hands back the review the caller already has', async () => {
		const { service, startConversation } = setup();

		const first = succeeded(await startReview(service));
		const second = succeeded(await startReview(service));

		expect(second).toMatchObject({
			agentSessionId: first.agentSessionId,
			chatTabId: first.chatTabId,
		});
		expect(startConversation).toHaveBeenCalledTimes(1);
	});

	// It is a settled outcome rather than a refusal, so the message has to say
	// which reviewer the caller is holding and how to reach it — otherwise the
	// caller reads an `ok` naming a session it did not just open as a fresh one.
	it('names the reused review and how to steer it', async () => {
		const { service } = setup();

		await startReview(service);
		const { message } = succeeded(await startReview(service));

		expect(message).toContain('already have a review open');
		expect(message).toContain('review-1');
		expect(message).toContain('ensemblr_send_follow_up');
	});

	// Reuse spends neither, so a caller out of spawn quota still reaches the
	// reviewer it already has.
	it('spends no spawn quota and composes no brief when it reuses', async () => {
		const composeBrief = vi.fn().mockResolvedValue({
			model: 'claude-opus-5',
			prompt: 'THE REVIEW PROMPT',
			source: 'renderer',
			thinkingLevel: 'high',
		});
		const { service } = setup({ composeBrief });

		await startReview(service);
		await startReview(service);

		expect(composeBrief).toHaveBeenCalledTimes(1);
	});

	// The session row outlives the reviewer going idle and outlives its tab being
	// closed, and `sendFollowUp` reaches it in both. Only a session that no longer
	// exists at all is not a reviewer the caller still has.
	it('opens a fresh review once the first no longer resolves', async () => {
		const startConversation = vi
			.fn()
			.mockResolvedValueOnce({
				agentSessionId: 'review-1',
				chatTabId: 'review-tab',
				ok: true,
			})
			.mockResolvedValueOnce({
				agentSessionId: 'review-2',
				chatTabId: 'review-tab-2',
				ok: true,
			});
		const { ports, service } = setup({ startConversation });

		expect(succeeded(await startReview(service)).agentSessionId).toBe(
			'review-1',
		);
		vi.mocked(
			ports.conversations.resolveConversationWorkspace,
		).mockResolvedValue(null);

		expect(succeeded(await startReview(service)).agentSessionId).toBe(
			'review-2',
		);
		expect(startConversation).toHaveBeenCalledTimes(2);
	});

	// A probe that throws says nothing about the reviewer. Handing back an id whose
	// follow-up then fails costs a turn and a `not-found` the caller can act on;
	// a duplicate reviewer over the same whole diff is what this guard exists to
	// stop, and nothing downstream notices one.
	it('keeps the review when the probe itself fails', async () => {
		const { ports, service, startConversation } = setup();

		await startReview(service);
		vi.mocked(
			ports.conversations.resolveConversationWorkspace,
		).mockRejectedValue(new Error('database is locked'));

		expect(succeeded(await startReview(service)).agentSessionId).toBe(
			'review-1',
		);
		expect(startConversation).toHaveBeenCalledTimes(1);
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

	// The cap counts uncoordinated writers, and a child its orchestrator blocks on
	// is not one. An unattended run whose workspace happens to hold a harness would
	// otherwise be refused the second reading the whole loop is built around.
	it('opens even when the workspace already holds its co-tenancy limit', async () => {
		const { service } = setup({
			terminals: [
				{ kind: 'agent', status: 'running', terminalId: 'term-1' },
				{ kind: 'agent', status: 'running', terminalId: 'term-2' },
			],
		});

		expect((await startReview(service)).ok).toBe(true);
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

	// A refused spawn leaves nothing sticky behind, so the retry that follows it in
	// an unattended run is answered on its own merits.
	it('lets a later review open after a refused spawn', async () => {
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

	// The compose reads the workspace row, the git status, and the repository's
	// settings, none of which is enveloped. A throw there is the caller's answer
	// for that one call and nothing more — the retry an unattended loop makes next
	// has to be able to succeed.
	it('recovers when composing the brief throws', async () => {
		const composeBrief = vi
			.fn()
			.mockRejectedValueOnce(new Error('git status failed'))
			.mockResolvedValue({
				model: null,
				prompt: 'FALLBACK PROMPT',
				source: 'fallback',
				thinkingLevel: null,
			});
		const { service } = setup({ composeBrief });

		const failed = await startReview(service);
		const retried = await startReview(service);

		expect(refused(failed).code).toBe('internal');
		expect(retried.ok).toBe(true);
	});

	it('rejects an argument the schema does not accept', async () => {
		const { service } = setup();

		const result = await startReview(service, { focus: 'the error paths' });

		expect(refused(result).code).toBe('invalid-args');
	});
});
