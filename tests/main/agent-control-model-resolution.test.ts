/**
 * What a delegated child is opened with. Omitted models stay on the caller's
 * runtime; explicit models may cross only under the user's live opt-in. A caller
 * the app cannot place still names a model rather than receiving Pi's default.
 */
import { describe, expect, it, vi } from 'vitest';
import {
	createAgentControlPorts,
	type PortAdapterDeps,
} from '../../src/main/agent-control/index.ts';
import type { ModelRoleAssignment } from '../../src/shared/model-role.ts';
import {
	fakeSpawnModelResolver,
	modelOption,
} from './support/spawn-model-resolver.ts';

const PI_MODEL = 'anthropic/claude-sonnet-4';
const PI_LOCAL_MODEL = 'ollama/gemma';
const CLAUDE_MODEL = 'opus[1m]';
const CLAUDE_ANTHROPIC_MODEL = 'sonnet[1m]';

const CLAUDE_LADDER = ['off', 'low', 'medium', 'high', 'xhigh', 'max'];

/**
 * Both runtimes serving Anthropic models. `PI_MODEL` and `CLAUDE_ANTHROPIC_MODEL`
 * carry the same `vendor` on purpose and differ only by runtime, so a check that
 * compared vendors — the one this module replaced — would wave either through
 * and only a runtime check can tell them apart.
 */
const CATALOG = [
	modelOption({ id: PI_MODEL, runtime: 'pi', vendor: 'anthropic' }),
	modelOption({ id: PI_LOCAL_MODEL, runtime: 'pi', vendor: 'ollama' }),
	modelOption({
		id: CLAUDE_MODEL,
		runtime: 'claude',
		thinkingLevels: CLAUDE_LADDER,
		vendor: 'claude-code',
	}),
	modelOption({
		id: CLAUDE_ANTHROPIC_MODEL,
		runtime: 'claude',
		thinkingLevels: CLAUDE_LADDER,
		vendor: 'anthropic',
	}),
];

/** The caller's own session, as the adapter reads it back off the session service. */
interface CallerSession {
	model: string | null;
	thinkingLevel: string | null;
}

const makeDeps = (input: {
	caller?: CallerSession;
	catalogDefaultModelId?: string;
	/**
	 * The Concierge's own open conversation, which lives in its own session store
	 * rather than in `agentSessionService`. `null` stands for a Concierge with no
	 * session the app can read a model off.
	 */
	conciergeSession?: CallerSession | null;
	models?: typeof CATALOG;
	openSession?: ReturnType<typeof vi.fn>;
	readCrossRuntimeDelegationEnabled?: () => boolean;
	readHiddenModelIds?: () => readonly string[];
	readModelRoleAssignments?: () => readonly ModelRoleAssignment[];
	piReady?: boolean;
}): PortAdapterDeps =>
	({
		conciergePorts: {
			concierge: {
				describeSession: () => input.conciergeSession ?? null,
				homePath: () => '/root/concierge',
			},
			memory: { recall: vi.fn() },
			workspaceCreation: { createWorkspace: vi.fn() },
		},
		agentSessionService: {
			getSession: vi.fn((id: string) =>
				id === 'parent' && input.caller ? input.caller : null,
			),
			openSession:
				input.openSession ??
				vi.fn(async () => ({ id: 'child-1', status: 'starting' })),
			submitPrompt: vi.fn(async () => ({})),
		},
		ask: { ask: vi.fn(), releaseSession: vi.fn() },
		augmentHarnessCommand: (command: string) => command,
		broadcastFocus: vi.fn(),
		broadcastAfkMode: vi.fn(),
		broadcastPlanMode: vi.fn(),
		broadcastTabsChanged: vi.fn(),
		chatTabService: {
			claimPlaceholderChatTab: vi.fn(() => null),
			openTab: vi.fn(() => ({ id: 'tab-1', metadata: {} })),
		},
		confirm: { confirm: vi.fn() },
		databaseService: { getConnection: () => ({ database: {} }) },
		getPermissionMode: () => 'workspace-trusted',
		harnessDetectionService: {},
		piExecutableService: {
			getSnapshot: vi.fn(async () =>
				input.piReady === false
					? { command: null, diagnostics: [], status: 'error' }
					: { command: 'pi', status: 'ready' },
			),
		},
		planMode: {
			activateForSpawn: vi.fn(),
			exit: vi.fn(),
			hasSubmittedPlan: vi.fn(() => false),
			isActive: vi.fn(() => false),
			releaseSession: vi.fn(),
		},
		afkMode: {
			activateForSpawn: vi.fn(),
			isActive: vi.fn(() => false),
			releaseSession: vi.fn(),
		},
		scriptLifecycleService: {},
		spawnModelResolver: fakeSpawnModelResolver(
			input.models ?? CATALOG,
			input.catalogDefaultModelId,
			input.readHiddenModelIds,
			input.readCrossRuntimeDelegationEnabled,
			input.readModelRoleAssignments,
		),
		terminalService: {},
	}) as unknown as PortAdapterDeps;

/** Spawns a child and hands back the open request the port built. */
const spawn = async (input: {
	caller?: CallerSession;
	callerConcierge?: boolean;
	callerModel?: string;
	callerRuntime: 'pi' | 'claude' | null;
	conciergeSession?: CallerSession | null;
	catalogDefaultModelId?: string;
	afkMode?: boolean;
	model?: string;
	models?: typeof CATALOG;
	piReady?: boolean;
	planMode?: boolean;
	readCrossRuntimeDelegationEnabled?: () => boolean;
	readHiddenModelIds?: () => readonly string[];
	readModelRoleAssignments?: () => readonly ModelRoleAssignment[];
	thinkingLevel?: string;
}): Promise<Record<string, unknown>> => {
	const openSession: ReturnType<typeof vi.fn> = vi.fn(async () => ({
		id: 'child-1',
		status: 'starting',
	}));
	const ports = createAgentControlPorts(makeDeps({ ...input, openSession }));
	const outcome = await ports.conversations.startConversation({
		asPeer: false,
		callerConcierge: input.callerConcierge ?? false,
		callerModel: input.callerModel,
		callerRuntime: input.callerRuntime,
		model: input.model,
		parentSessionId: 'parent',
		planMode: input.planMode ?? false,
		afkMode: input.afkMode ?? false,
		prompt: 'go',
		thinkingLevel: input.thinkingLevel,
		workspaceCwd: '/ws',
		workspaceId: 'ws',
	});
	if (!outcome.ok) {
		throw new Error(`the spawn was refused: ${outcome.reason}`);
	}
	return openSession.mock.calls[0]?.[0] as Record<string, unknown>;
};

/**
 * Attempts a spawn and hands back the refusal prose. A refused spawn is a
 * modelled outcome rather than a throw, and it must leave no session behind.
 */
const refusal = async (input: Parameters<typeof spawn>[0]): Promise<string> => {
	const openSession: ReturnType<typeof vi.fn> = vi.fn(async () => ({
		id: 'child-1',
		status: 'starting',
	}));
	const ports = createAgentControlPorts(makeDeps({ ...input, openSession }));
	const outcome = await ports.conversations.startConversation({
		asPeer: false,
		callerConcierge: input.callerConcierge ?? false,
		callerModel: input.callerModel,
		callerRuntime: input.callerRuntime,
		model: input.model,
		parentSessionId: 'parent',
		planMode: false,
		afkMode: false,
		prompt: 'go',
		thinkingLevel: input.thinkingLevel,
		workspaceCwd: '/ws',
		workspaceId: 'ws',
	});
	if (outcome.ok) {
		throw new Error('the spawn was accepted, but it should have been refused');
	}
	expect(openSession).not.toHaveBeenCalled();
	return outcome.reason;
};

describe('a Claude orchestrator defaults to its own runtime', () => {
	it('opens the child on the caller’s own Claude model when none is requested', async () => {
		const request = await spawn({
			caller: { model: CLAUDE_MODEL, thinkingLevel: 'max' },
			callerRuntime: 'claude',
		});

		expect(request.model).toBe(CLAUDE_MODEL);
		expect(request.provider).toBe('claude');
	});

	it('refuses an explicit Pi model by name instead of coercing it', async () => {
		const message = await refusal({
			caller: { model: CLAUDE_MODEL, thinkingLevel: 'max' },
			callerRuntime: 'claude',
			model: PI_MODEL,
		});

		expect(message).toContain(PI_MODEL);
		expect(message).toContain('Pi');
		expect(message).toContain('Claude Code');
		expect(message).toContain('Cross-runtime delegation is off');
	});

	it('spawns an explicitly selected Pi child when the user opts in', async () => {
		const request = await spawn({
			caller: { model: CLAUDE_MODEL, thinkingLevel: 'max' },
			callerRuntime: 'claude',
			model: PI_MODEL,
			planMode: true,
			readCrossRuntimeDelegationEnabled: () => true,
		});

		expect(request.model).toBe(PI_MODEL);
		expect(request.provider).toBe('pi');
		expect(request.thinkingLevel).toBe('medium');
		expect(request.planMode).toBe(true);
	});

	it('does not require a working Pi executable to spawn on Claude', async () => {
		const request = await spawn({
			caller: { model: CLAUDE_MODEL, thinkingLevel: 'max' },
			callerRuntime: 'claude',
			piReady: false,
		});

		expect(request.provider).toBe('claude');
	});

	it('falls back to the Claude catalog rather than the app default', async () => {
		const request = await spawn({ callerRuntime: 'claude' });

		expect(request.model).toBe(CLAUDE_MODEL);
		expect(request.provider).toBe('claude');
	});
});

describe('a Pi orchestrator defaults to its own runtime', () => {
	it('inherits the caller’s Pi model when none is requested', async () => {
		const request = await spawn({
			caller: { model: PI_MODEL, thinkingLevel: 'high' },
			callerRuntime: 'pi',
		});

		expect(request.model).toBe(PI_MODEL);
		expect(request.provider).toBe('pi');
	});

	it('honours a requested model from its own runtime', async () => {
		const request = await spawn({
			caller: { model: PI_MODEL, thinkingLevel: 'high' },
			callerRuntime: 'pi',
			model: PI_LOCAL_MODEL,
		});

		expect(request.model).toBe(PI_LOCAL_MODEL);
		expect(request.provider).toBe('pi');
	});

	it('refuses an explicitly requested hidden model without opening a session', async () => {
		const message = await refusal({
			caller: { model: PI_MODEL, thinkingLevel: 'high' },
			callerRuntime: 'pi',
			model: PI_LOCAL_MODEL,
			readHiddenModelIds: () => [PI_LOCAL_MODEL],
		});

		expect(message).toContain(PI_LOCAL_MODEL);
		expect(message).toContain('No model');
	});

	it('still inherits an active hidden parent model when none is requested', async () => {
		const request = await spawn({
			caller: { model: PI_MODEL, thinkingLevel: 'high' },
			callerRuntime: 'pi',
			readHiddenModelIds: () => [PI_MODEL],
		});

		expect(request.model).toBe(PI_MODEL);
		expect(request.provider).toBe('pi');
	});

	it('refuses a requested Claude model while cross-runtime delegation is off', async () => {
		const message = await refusal({
			caller: { model: PI_MODEL, thinkingLevel: 'high' },
			callerRuntime: 'pi',
			model: CLAUDE_MODEL,
		});

		expect(message).toContain(CLAUDE_MODEL);
		expect(message).toContain('Cross-runtime delegation is off');
	});

	it('spawns an explicitly selected Claude child when the user opts in', async () => {
		const request = await spawn({
			caller: { model: PI_MODEL, thinkingLevel: 'high' },
			callerRuntime: 'pi',
			afkMode: true,
			model: CLAUDE_MODEL,
			readCrossRuntimeDelegationEnabled: () => true,
		});

		expect(request.model).toBe(CLAUDE_MODEL);
		expect(request.provider).toBe('claude');
		expect(request.thinkingLevel).toBe('high');
		expect(request.afkMode).toBe(true);
	});

	it('keeps omitted-model inheritance on Pi when cross-runtime delegation is enabled', async () => {
		const request = await spawn({
			caller: { model: PI_MODEL, thinkingLevel: 'high' },
			callerRuntime: 'pi',
			readCrossRuntimeDelegationEnabled: () => true,
		});

		expect(request.model).toBe(PI_MODEL);
		expect(request.provider).toBe('pi');
	});

	it('enforces a setting change between spawn calls on the same resolver', async () => {
		let enabled = false;
		const openSession = vi.fn(async (_input: unknown) => ({
			id: 'child-1',
			status: 'starting',
		}));
		const ports = createAgentControlPorts(
			makeDeps({
				caller: { model: PI_MODEL, thinkingLevel: 'high' },
				openSession,
				readCrossRuntimeDelegationEnabled: () => enabled,
			}),
		);
		const input = {
			afkMode: false,
			asPeer: false,
			callerConcierge: false,
			callerModel: PI_MODEL,
			callerRuntime: 'pi' as const,
			model: CLAUDE_MODEL,
			parentSessionId: 'parent',
			planMode: false,
			prompt: 'go',
			workspaceCwd: '/ws',
			workspaceId: 'ws',
		};

		const refused = await ports.conversations.startConversation(input);
		enabled = true;
		const accepted = await ports.conversations.startConversation(input);

		expect(refused.ok).toBe(false);
		expect(accepted.ok).toBe(true);
		expect(openSession).toHaveBeenCalledTimes(1);
		expect(openSession.mock.calls[0]?.[0]).toMatchObject({
			model: CLAUDE_MODEL,
			provider: 'claude',
		});
	});

	// With nothing to inherit the child takes the model the app itself would open,
	// not whichever row `pi --list-models` printed first.
	it('lands on the catalog’s own default when there is nothing to inherit', async () => {
		const request = await spawn({
			callerRuntime: 'pi',
			catalogDefaultModelId: PI_LOCAL_MODEL,
		});

		expect(request.model).toBe(PI_LOCAL_MODEL);
		expect(request.provider).toBe('pi');
	});

	it('skips a hidden catalog default when there is nothing to inherit', async () => {
		const request = await spawn({
			callerRuntime: 'pi',
			catalogDefaultModelId: PI_MODEL,
			readHiddenModelIds: () => [PI_MODEL],
		});

		expect(request.model).toBe(PI_LOCAL_MODEL);
		expect(request.provider).toBe('pi');
	});

	// The exact shape of the bug this module replaced: `anthropic` on both sides,
	// so the old vendor comparison saw a match and opened a Claude model on Pi.
	// Only the runtime axis separates these two ids.
	it('refuses a Claude model that shares its own vendor', async () => {
		const message = await refusal({
			caller: { model: PI_MODEL, thinkingLevel: 'high' },
			callerRuntime: 'pi',
			model: CLAUDE_ANTHROPIC_MODEL,
		});

		expect(message).toContain(CLAUDE_ANTHROPIC_MODEL);
		expect(message).toContain('Cross-runtime delegation is off');
	});

	// A session row the catalog places on the other runtime is a data fault, not a
	// licence to open the child there.
	it('drops an inherited model the catalog places on the other runtime', async () => {
		const request = await spawn({
			caller: { model: CLAUDE_MODEL, thinkingLevel: 'high' },
			callerRuntime: 'pi',
		});

		expect(request.model).toBe(PI_MODEL);
		expect(request.provider).toBe('pi');
	});

	it('falls back to the extension’s forwarded model when the session is gone', async () => {
		const request = await spawn({
			callerModel: PI_LOCAL_MODEL,
			callerRuntime: 'pi',
		});

		expect(request.model).toBe(PI_LOCAL_MODEL);
		expect(request.provider).toBe('pi');
	});

	// The row only learns a new model when a prompt goes through Ensemblr, so an
	// agent that switched model inside pi is described by the forwarded value and
	// by nothing else.
	it('prefers the live forwarded model over a staler session row', async () => {
		const request = await spawn({
			caller: { model: PI_MODEL, thinkingLevel: 'high' },
			callerModel: PI_LOCAL_MODEL,
			callerRuntime: 'pi',
		});

		expect(request.model).toBe(PI_LOCAL_MODEL);
	});

	// Forwarded or not, the value is still only a hint: it never moves a child
	// onto a runtime the caller is not on.
	it('ignores a forwarded model belonging to the other runtime', async () => {
		const request = await spawn({
			caller: { model: PI_LOCAL_MODEL, thinkingLevel: 'high' },
			callerModel: CLAUDE_MODEL,
			callerRuntime: 'pi',
		});

		expect(request.model).toBe(PI_LOCAL_MODEL);
		expect(request.provider).toBe('pi');
	});
});

describe('a caller whose runtime the app cannot name', () => {
	it('is refused rather than defaulted onto Pi', async () => {
		const message = await refusal({ callerRuntime: null });

		expect(message).toContain('ensemblr_list_models');
	});

	it('may still spawn by naming a model outright', async () => {
		const request = await spawn({ callerRuntime: null, model: CLAUDE_MODEL });

		expect(request.model).toBe(CLAUDE_MODEL);
		expect(request.provider).toBe('claude');
	});

	it('is refused a model no runtime publishes', async () => {
		const message = await refusal({
			callerRuntime: null,
			model: 'made/up-model',
		});

		expect(message).toContain('made/up-model');
	});
});

describe('the child’s thinking level', () => {
	it('carries the caller’s level when the child’s runtime has that rung', async () => {
		const request = await spawn({
			caller: { model: CLAUDE_MODEL, thinkingLevel: 'max' },
			callerRuntime: 'claude',
		});

		expect(request.thinkingLevel).toBe('max');
	});

	// `max` is Claude's ladder only. Persisting it on a Pi child is what left the
	// composer's chip reading "<axis> pending" — the level resolved to something
	// the child's own runtime cannot name.
	it('drops a level from the other runtime’s vocabulary', async () => {
		const request = await spawn({
			caller: { model: PI_MODEL, thinkingLevel: 'max' },
			callerRuntime: 'pi',
		});

		expect(request.thinkingLevel).toBe('medium');
	});

	it('never leaves the child with no level at all', async () => {
		const request = await spawn({
			caller: { model: PI_MODEL, thinkingLevel: null },
			callerRuntime: 'pi',
		});

		expect(request.thinkingLevel).toBe('medium');
	});

	it('prefers an explicitly requested level the child accepts', async () => {
		const request = await spawn({
			caller: { model: PI_MODEL, thinkingLevel: 'high' },
			callerRuntime: 'pi',
			thinkingLevel: 'low',
		});

		expect(request.thinkingLevel).toBe('low');
	});

	// A level the orchestrator *asked* for is a decision, so a rung the child's
	// runtime does not have is refused by name rather than dropped back to the
	// caller's own — which is what let a deliberate choice run as its opposite
	// with nothing said.
	it('refuses a requested level the child’s runtime does not have', async () => {
		const message = await refusal({
			caller: { model: PI_MODEL, thinkingLevel: 'high' },
			callerRuntime: 'pi',
			thinkingLevel: 'max',
		});

		expect(message).toContain('"max"');
		expect(message).toContain('minimal');
		expect(message).toContain('xhigh');
	});

	it('refuses a level the child’s model does not publish', async () => {
		const message = await refusal({
			caller: { model: CLAUDE_MODEL, thinkingLevel: 'high' },
			callerRuntime: 'claude',
			thinkingLevel: 'minimal',
		});

		expect(message).toContain('"minimal"');
		expect(message).toContain(CLAUDE_LADDER.join(', '));
	});
});

// A caller with nothing to inherit is the one path onto a model that nobody
// chose, and Claude's catalog orders the costliest family first — so the
// fallback steps over the frontier tier rather than landing a child on it.
describe('the catalog default a spawn falls through to', () => {
	const FRONTIER_MODEL = 'claude-fable-5-1';
	const FRONTIER_CATALOG = [
		modelOption({
			id: FRONTIER_MODEL,
			runtime: 'claude',
			thinkingLevels: CLAUDE_LADDER,
			vendor: 'claude-code',
		}),
		modelOption({
			id: CLAUDE_MODEL,
			runtime: 'claude',
			thinkingLevels: CLAUDE_LADDER,
			vendor: 'claude-code',
		}),
	];

	it('steps over a frontier model the catalog calls default', async () => {
		const request = await spawn({
			callerRuntime: 'claude',
			catalogDefaultModelId: FRONTIER_MODEL,
			models: FRONTIER_CATALOG,
		});

		expect(request.model).toBe(CLAUDE_MODEL);
	});

	it('still opens on a frontier model when the runtime publishes nothing else', async () => {
		const request = await spawn({
			callerRuntime: 'claude',
			catalogDefaultModelId: FRONTIER_MODEL,
			models: [FRONTIER_CATALOG[0] as (typeof CATALOG)[number]],
		});

		expect(request.model).toBe(FRONTIER_MODEL);
	});

	it('reports the model it would fall through to as the listed default', async () => {
		const ports = createAgentControlPorts(
			makeDeps({
				catalogDefaultModelId: FRONTIER_MODEL,
				models: FRONTIER_CATALOG,
			}),
		);
		const listing = await ports.conversations.listModels({
			runtime: 'claude',
		});

		expect(listing.defaultModelId).toBe(CLAUDE_MODEL);
		expect(listing.models.map((model) => model.tier)).toEqual([
			'frontier',
			'standard',
		]);
	});

	// A terminal harness cannot be narrowed to a runtime and is the one caller
	// required to name a model, so an unnarrowed listing advertising the frontier
	// row as its default would send it straight into the gate. Both branches read
	// the same helper rather than only the narrowed one stepping over the tier.
	it('steps over it for a caller whose runtime cannot be narrowed', async () => {
		const ports = createAgentControlPorts(
			makeDeps({
				catalogDefaultModelId: FRONTIER_MODEL,
				models: FRONTIER_CATALOG,
			}),
		);
		const listing = await ports.conversations.listModels({ runtime: null });

		expect(listing.defaultModelId).toBe(CLAUDE_MODEL);
		expect(listing.models.map((model) => model.id)).toEqual([
			FRONTIER_MODEL,
			CLAUDE_MODEL,
		]);
	});

	it('publishes each model’s thinking ladder and axis', async () => {
		const ports = createAgentControlPorts(makeDeps({}));
		const listing = await ports.conversations.listModels({ runtime: 'claude' });

		expect(listing.models[0]?.thinkingLevels).toEqual(CLAUDE_LADDER);
		expect(listing.models[0]?.thinkingAxis).toBe('effort');
	});

	// Pi's rows publish no ladder of their own, so the runtime's canonical one
	// stands in — an empty list would leave the caller with nothing to choose from
	// and a guess is what the refusal above exists to stop.
	it('falls back to the runtime ladder for a model that publishes none', async () => {
		const ports = createAgentControlPorts(makeDeps({}));
		const listing = await ports.conversations.listModels({ runtime: 'pi' });

		expect(listing.models[0]?.thinkingLevels).toContain('minimal');
		expect(listing.models[0]?.thinkingLevels).not.toContain('max');
		expect(listing.models[0]?.thinkingAxis).toBe('thinking');
	});
});

describe('an unreadable model catalog', () => {
	it('still lets a caller inherit its own model rather than blocking the spawn', async () => {
		const request = await spawn({
			caller: { model: CLAUDE_MODEL, thinkingLevel: 'high' },
			callerRuntime: 'claude',
			models: [],
		});

		expect(request.model).toBe(CLAUDE_MODEL);
		expect(request.provider).toBe('claude');
	});

	it('refuses when there is nothing left to inherit', async () => {
		const message = await refusal({ callerRuntime: 'pi', models: [] });

		expect(message).toContain('No Pi models are available');
	});

	// Each runtime's listing degrades on its own, so a `pi --list-models` that
	// failed leaves a Pi caller unable to name any Pi model. Telling it the model
	// does not exist sends it to ensemblr_list_models for a listing that is empty
	// for the same reason, which is the loop this message exists to break.
	it('names the empty runtime rather than claiming the model does not exist', async () => {
		const message = await refusal({
			caller: { model: PI_MODEL, thinkingLevel: null },
			callerRuntime: 'pi',
			model: 'openai-codex/gpt-5.6-sol',
			models: [
				modelOption({ id: CLAUDE_MODEL, runtime: 'claude' }),
				modelOption({ id: CLAUDE_ANTHROPIC_MODEL, runtime: 'claude' }),
			],
		});

		expect(message).toContain('lists no Pi models');
		expect(message).toContain('Omit "model" to inherit');
		expect(message).not.toContain('is available in this app');
	});

	// Emptiness is measured over the listing the caller is actually served rather
	// than its own runtime's rows. With cross-runtime delegation on, the other
	// runtime's models are on offer, so claiming ensemblr_list_models has nothing
	// would deny the one recovery that works — the same loop, one setting over.
	it('keeps pointing at the listing when cross-runtime delegation offers one', async () => {
		const message = await refusal({
			caller: { model: PI_MODEL, thinkingLevel: null },
			callerRuntime: 'pi',
			model: 'openai-codex/gpt-5.6-sol',
			models: [
				modelOption({ id: CLAUDE_MODEL, runtime: 'claude' }),
				modelOption({ id: CLAUDE_ANTHROPIC_MODEL, runtime: 'claude' }),
			],
			readCrossRuntimeDelegationEnabled: () => true,
		});

		expect(message).toContain(
			'No model "openai-codex/gpt-5.6-sol" is available in this app',
		);
		expect(message).not.toContain('lists no Pi models');
	});

	it('still names the empty runtime when crossing would reach nothing either', async () => {
		const message = await refusal({
			caller: { model: PI_MODEL, thinkingLevel: null },
			callerRuntime: 'pi',
			model: 'openai-codex/gpt-5.6-sol',
			models: [],
			readCrossRuntimeDelegationEnabled: () => true,
		});

		expect(message).toContain('lists no Pi models');
		expect(message).toContain('Omit "model" to inherit');
	});

	it('still reports an unknown id plainly while that runtime lists models', async () => {
		const message = await refusal({
			caller: { model: PI_MODEL, thinkingLevel: null },
			callerRuntime: 'pi',
			model: 'anthropic/not-a-model',
		});

		expect(message).toContain(
			'No model "anthropic/not-a-model" is available in this app',
		);
	});
});

describe('the model list a caller is served', () => {
	const listFor = async (
		runtime: 'pi' | 'claude' | null,
		catalogDefaultModelId?: string,
	) =>
		createAgentControlPorts(
			makeDeps({ catalogDefaultModelId }),
		).conversations.listModels({ runtime });

	it('reads hidden model settings live and excludes those rows', async () => {
		let hiddenModels: readonly string[] = [CLAUDE_ANTHROPIC_MODEL];
		const ports = createAgentControlPorts(
			makeDeps({ readHiddenModelIds: () => hiddenModels }),
		);

		const hidden = await ports.conversations.listModels({ runtime: 'claude' });
		hiddenModels = [];
		const revealed = await ports.conversations.listModels({
			runtime: 'claude',
		});

		expect(hidden.models.map((model) => model.id)).toEqual([CLAUDE_MODEL]);
		expect(revealed.models.map((model) => model.id)).toEqual([
			CLAUDE_MODEL,
			CLAUDE_ANTHROPIC_MODEL,
		]);
	});

	it('carries only the caller’s own runtime’s models', async () => {
		const listing = await listFor('claude');

		expect(listing.models.map((model) => model.id)).toEqual([
			CLAUDE_MODEL,
			CLAUDE_ANTHROPIC_MODEL,
		]);
		expect(listing.callerRuntime).toBe('claude');
		expect(listing.allowedRuntimes).toEqual(['claude']);
		expect(listing.crossRuntimeDelegationEnabled).toBe(false);
	});

	// "Default" means the model the app itself would open, not whichever row the
	// runtime happened to print first.
	it('reports the catalog’s own default when that runtime publishes it', async () => {
		const listing = await listFor('claude', CLAUDE_ANTHROPIC_MODEL);

		expect(listing.defaultModelId).toBe(CLAUDE_ANTHROPIC_MODEL);
	});

	it('falls back to the runtime’s first model when the default is another runtime’s', async () => {
		const listing = await listFor('claude', PI_MODEL);

		expect(listing.defaultModelId).toBe(CLAUDE_MODEL);
	});

	it('reports each model’s runtime beside its vendor', async () => {
		const listing = await listFor('pi');

		expect(listing.models[0]).toMatchObject({
			id: PI_MODEL,
			runtime: 'pi',
			vendor: 'anthropic',
		});
	});

	it('cannot be narrowed for a caller with no runtime, so it carries both', async () => {
		const listing = await listFor(null);

		expect(listing.models).toHaveLength(CATALOG.length);
		expect(listing.callerRuntime).toBeNull();
		expect(listing.allowedRuntimes).toEqual(['pi', 'claude']);
	});

	it('reads the cross-runtime policy live for every listing', async () => {
		let enabled = false;
		const ports = createAgentControlPorts(
			makeDeps({ readCrossRuntimeDelegationEnabled: () => enabled }),
		);

		const sameRuntime = await ports.conversations.listModels({ runtime: 'pi' });
		enabled = true;
		const crossRuntime = await ports.conversations.listModels({
			runtime: 'pi',
		});

		expect(sameRuntime.models.map((model) => model.runtime)).toEqual([
			'pi',
			'pi',
		]);
		expect(sameRuntime.allowedRuntimes).toEqual(['pi']);
		expect(crossRuntime.models).toHaveLength(CATALOG.length);
		expect(crossRuntime.allowedRuntimes).toEqual(['pi', 'claude']);
		expect(crossRuntime.defaultModelId).toBe(PI_MODEL);
	});

	it('publishes independent advisory roles for each runtime-and-model pair', async () => {
		const ports = createAgentControlPorts(
			makeDeps({
				readCrossRuntimeDelegationEnabled: () => true,
				readModelRoleAssignments: () => [
					{ modelId: PI_MODEL, roles: ['coder', 'sage'], runtime: 'pi' },
					{
						modelId: CLAUDE_ANTHROPIC_MODEL,
						roles: ['builder'],
						runtime: 'claude',
					},
				],
			}),
		);

		const listing = await ports.conversations.listModels({ runtime: 'pi' });

		expect(
			listing.models.find((model) => model.id === PI_MODEL)?.roles,
		).toEqual(['sage', 'coder']);
		expect(
			listing.models.find((model) => model.id === CLAUDE_ANTHROPIC_MODEL)
				?.roles,
		).toEqual(['builder']);
	});
});

describe('startConversation rollback on submit failure', () => {
	const makeFailingDeps = (): {
		deps: PortAdapterDeps;
		stopSession: ReturnType<typeof vi.fn>;
		closeTab: ReturnType<typeof vi.fn>;
		openTab: ReturnType<typeof vi.fn>;
		releasePlanMode: ReturnType<typeof vi.fn>;
	} => {
		const stopSession = vi.fn(async () => {});
		const closeTab = vi.fn(() => ({ deleted: true }));
		const openTab = vi.fn(() => ({ id: 'tab-new', metadata: {} }));
		const releasePlanMode = vi.fn();
		const deps = {
			...makeDeps({ caller: { model: PI_MODEL, thinkingLevel: 'high' } }),
			agentSessionService: {
				getSession: vi.fn(() => ({ model: PI_MODEL, thinkingLevel: 'high' })),
				openSession: vi.fn(async () => ({
					id: 'pi-child',
					status: 'starting',
				})),
				stopSession,
				submitPrompt: vi.fn(async () => {
					throw new Error('submit failed');
				}),
			},
			chatTabService: {
				claimPlaceholderChatTab: vi.fn(() => null),
				closeTab,
				openTab,
			},
			planMode: {
				activateForSpawn: vi.fn(),
				exit: vi.fn(),
				hasSubmittedPlan: vi.fn(() => false),
				isActive: vi.fn(() => false),
				releaseSession: releasePlanMode,
			},
			afkMode: {
				activateForSpawn: vi.fn(),
				isActive: vi.fn(() => false),
				releaseSession: vi.fn(),
			},
		} as unknown as PortAdapterDeps;
		return { closeTab, deps, openTab, releasePlanMode, stopSession };
	};

	it('stops the session and closes the tab it opened when the first prompt fails', async () => {
		const { deps, stopSession, closeTab } = makeFailingDeps();
		const ports = createAgentControlPorts(deps);
		await expect(
			ports.conversations.startConversation({
				asPeer: false,
				callerConcierge: false,
				callerRuntime: 'pi',
				parentSessionId: 'parent',
				planMode: false,
				afkMode: false,
				prompt: 'go',
				workspaceCwd: '/ws',
				workspaceId: 'ws',
			}),
		).rejects.toThrow('submit failed');
		expect(stopSession).toHaveBeenCalledWith(
			expect.objectContaining({ sessionId: 'pi-child' }),
		);
		expect(closeTab).toHaveBeenCalledWith({ chatTabId: 'tab-new' });
	});

	it('does not close a caller-supplied tab on failure', async () => {
		const { deps, stopSession, closeTab, openTab } = makeFailingDeps();
		const ports = createAgentControlPorts(deps);
		await expect(
			ports.conversations.startConversation({
				asPeer: false,
				callerConcierge: false,
				callerRuntime: 'pi',
				chatTabId: 'caller-tab',
				parentSessionId: 'parent',
				planMode: false,
				afkMode: false,
				prompt: 'go',
				workspaceCwd: '/ws',
				workspaceId: 'ws',
			}),
		).rejects.toThrow('submit failed');
		expect(openTab).not.toHaveBeenCalled();
		expect(stopSession).toHaveBeenCalled();
		expect(closeTab).not.toHaveBeenCalled();
	});

	// Unconditional on purpose: releasing a session that never planned is a no-op
	// `Set.delete`, and the shutdown path cannot be relied on here because rollback
	// swallows a failed `stopSession`.
	it('releases the child from Plan Mode on rollback, planning or not', async () => {
		for (const planMode of [true, false]) {
			const { deps, releasePlanMode } = makeFailingDeps();
			const ports = createAgentControlPorts(deps);
			await expect(
				ports.conversations.startConversation({
					asPeer: false,
					callerConcierge: false,
					callerRuntime: 'pi',
					parentSessionId: 'parent',
					planMode,
					afkMode: false,
					prompt: 'go',
					workspaceCwd: '/ws',
					workspaceId: 'ws',
				}),
			).rejects.toThrow('submit failed');
			expect(releasePlanMode).toHaveBeenCalledWith('pi-child');
		}
	});
});

/**
 * The Concierge keeps its own session store, so `agentSessionService` has no row
 * to read its model off. On Pi the extension forwards a live model and the spawn
 * inherits it whatever the store says; on Claude Code the MCP transport carries
 * no such hint, which left the Concierge with neither signal and every model-less
 * spawn landing on the catalog default.
 */
describe('a conversation the Concierge opens inherits the Concierge’s model', () => {
	it('reads the Concierge’s own session when MCP forwards no live model', async () => {
		const request = await spawn({
			callerConcierge: true,
			callerRuntime: 'claude',
			catalogDefaultModelId: CLAUDE_MODEL,
			conciergeSession: {
				model: CLAUDE_ANTHROPIC_MODEL,
				thinkingLevel: 'high',
			},
		});

		expect(request.model).toBe(CLAUDE_ANTHROPIC_MODEL);
		expect(request.provider).toBe('claude');
		expect(request.thinkingLevel).toBe('high');
	});

	it('honours an explicit model from the Concierge’s own runtime', async () => {
		const request = await spawn({
			callerConcierge: true,
			callerRuntime: 'claude',
			conciergeSession: { model: CLAUDE_ANTHROPIC_MODEL, thinkingLevel: null },
			model: CLAUDE_MODEL,
		});

		expect(request.model).toBe(CLAUDE_MODEL);
		expect(request.provider).toBe('claude');
	});

	// The Pi Concierge already worked, because the extension forwards its live
	// model on every call. Pinned so a fix aimed at the MCP path cannot cost it.
	it('still prefers the live model a Pi Concierge forwards', async () => {
		const request = await spawn({
			callerConcierge: true,
			callerModel: PI_LOCAL_MODEL,
			callerRuntime: 'pi',
			conciergeSession: { model: PI_MODEL, thinkingLevel: null },
		});

		expect(request.model).toBe(PI_LOCAL_MODEL);
		expect(request.provider).toBe('pi');
	});

	// Silently defaulting is the bug, so a Concierge whose own model the app
	// cannot name is refused with something it can act on rather than opened on
	// whatever the catalog calls default.
	it('refuses rather than defaulting when it cannot name its own model', async () => {
		const message = await refusal({
			callerConcierge: true,
			callerRuntime: 'claude',
			catalogDefaultModelId: CLAUDE_MODEL,
			conciergeSession: null,
		});

		expect(message).toContain('model');
		expect(message).toContain('ensemblr_list_models');
	});

	it('opens on an explicit model even with no Concierge session to read', async () => {
		const request = await spawn({
			callerConcierge: true,
			callerRuntime: 'claude',
			conciergeSession: null,
			model: CLAUDE_MODEL,
		});

		expect(request.model).toBe(CLAUDE_MODEL);
	});
});
