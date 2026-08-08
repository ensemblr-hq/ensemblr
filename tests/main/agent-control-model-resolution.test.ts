/**
 * What a delegated child is opened with. The rule the whole suite defends: a
 * spawn never crosses the agent runtime axis. A Claude Code orchestrator's
 * children run on Claude, a Pi orchestrator's on Pi, and a caller the app cannot
 * place on either is told to name a model rather than quietly handed Pi's
 * default — which is exactly what used to happen, because the spawn path read a
 * Pi-only catalog and compared *inference vendors* (`anthropic`) while calling
 * them providers.
 */
import { describe, expect, it, vi } from 'vitest';

import {
	createAgentControlPorts,
	type PortAdapterDeps,
} from '../../src/main/agent-control/index.ts';
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
	models?: typeof CATALOG;
	openSession?: ReturnType<typeof vi.fn>;
	piReady?: boolean;
}): PortAdapterDeps =>
	({
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
		broadcastPlanMode: vi.fn(),
		broadcastTabsChanged: vi.fn(),
		chatTabService: { openTab: vi.fn(() => ({ id: 'tab-1', metadata: {} })) },
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
			isActive: vi.fn(() => false),
			releaseSession: vi.fn(),
		},
		scriptLifecycleService: {},
		spawnModelResolver: fakeSpawnModelResolver(
			input.models ?? CATALOG,
			input.catalogDefaultModelId,
		),
		terminalService: {},
	}) as unknown as PortAdapterDeps;

/** Spawns a child and hands back the open request the port built. */
const spawn = async (input: {
	caller?: CallerSession;
	callerModel?: string;
	callerRuntime: 'pi' | 'claude' | null;
	catalogDefaultModelId?: string;
	model?: string;
	models?: typeof CATALOG;
	piReady?: boolean;
	thinkingLevel?: string;
}): Promise<Record<string, unknown>> => {
	const openSession: ReturnType<typeof vi.fn> = vi.fn(async () => ({
		id: 'child-1',
		status: 'starting',
	}));
	const ports = createAgentControlPorts(makeDeps({ ...input, openSession }));
	const outcome = await ports.conversations.startConversation({
		callerModel: input.callerModel,
		callerRuntime: input.callerRuntime,
		model: input.model,
		parentSessionId: 'parent',
		planMode: false,
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
		callerModel: input.callerModel,
		callerRuntime: input.callerRuntime,
		model: input.model,
		parentSessionId: 'parent',
		planMode: false,
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

describe('a Claude orchestrator never spawns a Pi child', () => {
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
		expect(message).toContain('cannot cross runtimes');
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

describe('a Pi orchestrator never spawns a Claude child', () => {
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

	it('refuses a requested Claude model', async () => {
		const message = await refusal({
			caller: { model: PI_MODEL, thinkingLevel: 'high' },
			callerRuntime: 'pi',
			model: CLAUDE_MODEL,
		});

		expect(message).toContain(CLAUDE_MODEL);
		expect(message).toContain('cannot cross runtimes');
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
		expect(message).toContain('cannot cross runtimes');
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
});

describe('the model list a caller is served', () => {
	const listFor = async (
		runtime: 'pi' | 'claude' | null,
		catalogDefaultModelId?: string,
	) =>
		createAgentControlPorts(
			makeDeps({ catalogDefaultModelId }),
		).conversations.listModels({ runtime });

	it('carries only the caller’s own runtime’s models', async () => {
		const listing = await listFor('claude');

		expect(listing.models.map((model) => model.id)).toEqual([
			CLAUDE_MODEL,
			CLAUDE_ANTHROPIC_MODEL,
		]);
		expect(listing.runtime).toBe('claude');
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
		expect(listing.runtime).toBeNull();
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
			chatTabService: { closeTab, openTab },
			planMode: {
				activateForSpawn: vi.fn(),
				exit: vi.fn(),
				isActive: vi.fn(() => false),
				releaseSession: releasePlanMode,
			},
		} as unknown as PortAdapterDeps;
		return { closeTab, deps, openTab, releasePlanMode, stopSession };
	};

	it('stops the session and closes the tab it opened when the first prompt fails', async () => {
		const { deps, stopSession, closeTab } = makeFailingDeps();
		const ports = createAgentControlPorts(deps);
		await expect(
			ports.conversations.startConversation({
				callerRuntime: 'pi',
				parentSessionId: 'parent',
				planMode: false,
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
				callerRuntime: 'pi',
				chatTabId: 'caller-tab',
				parentSessionId: 'parent',
				planMode: false,
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
					callerRuntime: 'pi',
					parentSessionId: 'parent',
					planMode,
					prompt: 'go',
					workspaceCwd: '/ws',
					workspaceId: 'ws',
				}),
			).rejects.toThrow('submit failed');
			expect(releasePlanMode).toHaveBeenCalledWith('pi-child');
		}
	});
});
