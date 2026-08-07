import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentSessionService } from '../../src/main/agent-runtime/agent-session-service.ts';
import type { PiExecutableSnapshot } from '../../src/main/pi-runtime/pi-executable.ts';
import type { AgentModelOption } from '../../src/shared/ipc/contracts/agent-models.ts';

const handle = vi.fn();

vi.mock('electron', () => ({
	BrowserWindow: { fromWebContents: () => null },
	dialog: { showOpenDialog: vi.fn() },
	ipcMain: { handle },
}));

const { createAgentControlPorts } = await import(
	'../../src/main/agent-control/index.ts'
);
const { createAgentClient } = await import(
	'../../src/main/agent-runtime/agent-client.ts'
);
const { createAgentSessionService } = await import(
	'../../src/main/agent-runtime/agent-session-service.ts'
);
const { AgentSessionServiceError } = await import(
	'../../src/main/agent-runtime/agent-session-service-error.ts'
);
const { createFakeAgentAdapter } = await import(
	'../../src/main/agent-runtime/fake-agent-adapter.ts'
);
const { registerAgentSessionHandlers } = await import(
	'../../src/main/ipc/handlers/agent-session.ts'
);
const { createEnsemblrDatabaseService } = await import(
	'../../src/main/storage/database.ts'
);
const { createAgentSession } = await import(
	'../../src/main/storage/repositories/agent-session-repository.ts'
);

const WORKSPACE_ID = 'ws-pin';
const WORKSPACE_CWD = '/tmp/ensemblr/pin/ws';
const PI_MODEL = 'anthropic/claude-sonnet-4';
const CLAUDE_MODEL = 'opus[1m]';

const cleanups: Array<() => void> = [];

afterEach(() => {
	while (cleanups.length > 0) {
		cleanups.pop()?.();
	}
});

function createReadyExecutable(): PiExecutableSnapshot {
	return {
		command: '/usr/local/bin/pi',
		diagnostics: [],
		displayPath: '/usr/local/bin/pi',
		path: '/usr/local/bin/pi',
		probe: null,
		setting: null,
		source: null,
		status: 'ok',
		updatedAt: '2026-08-07T00:00:00.000Z',
	};
}

/** The Claude half of the merged catalog, as `Query.supportedModels()` presents it. */
const CLAUDE_MODELS: readonly AgentModelOption[] = [
	{
		agentProvider: 'claude',
		displayName: 'Opus 4.5 (1M)',
		id: CLAUDE_MODEL,
		provider: 'claude-code',
		thinkingLevels: ['low', 'high'],
	},
];

/** The Pi half, as `presentPiModels` presents `pi --list-models`. */
const PI_MODELS: readonly AgentModelOption[] = [
	{
		agentProvider: 'pi',
		displayName: 'Sonnet 4',
		id: PI_MODEL,
		provider: 'anthropic',
		thinkingLevels: ['off', 'high'],
	},
];

vi.mock('../../src/main/pi-runtime/pi-provider-models.ts', () => ({
	presentPiModels: vi.fn(() => ({
		defaultModelId: PI_MODEL,
		defaultThinkingLevel: 'medium',
		models: PI_MODELS,
	})),
	resolvePiProviderModels: vi.fn(async () => ({ status: 'success' })),
}));

// ---------------------------------------------------------------------------
// Part A — the derivation happens in main, off main's own catalog.
// ---------------------------------------------------------------------------

/** Records every call the handler makes into the session service. */
interface RecordedService {
	openSession: ReturnType<typeof vi.fn>;
	submitPrompt: ReturnType<typeof vi.fn>;
}

let recorded: RecordedService;

/**
 * Registers the agent-session handlers over a recording session service and a
 * Pi executable in the given state, then returns the registered channel map.
 */
function registerHandlers({
	listClaudeModels = async () => CLAUDE_MODELS,
	piExecutable = createReadyExecutable(),
}: {
	listClaudeModels?: () => Promise<readonly AgentModelOption[]>;
	piExecutable?: PiExecutableSnapshot;
} = {}): Map<string, (event: unknown, raw: unknown) => Promise<unknown>> {
	handle.mockReset();
	recorded = {
		openSession: vi.fn(async () => ({
			branchId: 'branch-1',
			closedAt: null,
			createdAt: '2026-08-07T00:00:00.000Z',
			cwd: WORKSPACE_CWD,
			id: 'session-1',
			label: null,
			model: null,
			openedTabs: [],
			provider: 'pi',
			runtimeOpen: true,
			runtimeSessionId: null,
			status: 'starting',
			thinkingLevel: null,
			updatedAt: '2026-08-07T00:00:00.000Z',
			workspaceId: WORKSPACE_ID,
		})),
		submitPrompt: vi.fn(async () => ({
			acceptedAt: '2026-08-07T00:00:00.000Z',
			turnId: 'turn-1',
		})),
	};

	registerAgentSessionHandlers({
		agentSessionService: recorded as unknown as AgentSessionService,
		listClaudeModels,
		localCommandService: {} as never,
		piExecutableService: {
			clearOverride: () => ({ canceled: false }),
			getSnapshot: async () => piExecutable,
			saveOverride: () => ({ canceled: false }),
		},
		planModeRegistry: {
			isActive: () => false,
			release: () => undefined,
			setActive: () => undefined,
		},
		withPermissionGate: () => undefined,
	});

	const channels = new Map<
		string,
		(event: unknown, raw: unknown) => Promise<unknown>
	>();
	for (const call of handle.mock.calls) {
		channels.set(call[0], call[1]);
	}
	return channels;
}

/** Opens a session through the IPC channel and returns the request main built. */
async function openThroughIpc(
	request: Record<string, unknown>,
	options?: Parameters<typeof registerHandlers>[0],
): Promise<{
	openRequest: Record<string, unknown> | undefined;
	result: { error?: string };
}> {
	const channels = registerHandlers(options);
	const open = channels.get('ensemblr:open-agent-session');
	if (!open) {
		throw new Error('The open-agent-session channel was never registered.');
	}
	const result = (await open(null, {
		workspaceCwd: WORKSPACE_CWD,
		workspaceId: WORKSPACE_ID,
		...request,
	})) as { error?: string };
	return { openRequest: recorded.openSession.mock.calls[0]?.[0], result };
}

describe('main derives a session provider from its own merged catalog', () => {
	it('opens a Claude session when the user picked a Claude model', async () => {
		const { openRequest } = await openThroughIpc({ model: CLAUDE_MODEL });

		expect(openRequest?.provider).toBe('claude');
	});

	it('opens a Pi session when the user picked a Pi model', async () => {
		const { openRequest } = await openThroughIpc({ model: PI_MODEL });

		expect(openRequest?.provider).toBe('pi');
	});

	it('states no opinion for a model no catalog claims, so the opener defaults to Pi', async () => {
		const { openRequest } = await openThroughIpc({ model: 'ghost/model-9' });

		expect(openRequest).not.toHaveProperty('provider');
	});

	it('states no opinion when the Claude catalog cannot be read', async () => {
		const { openRequest } = await openThroughIpc(
			{ model: CLAUDE_MODEL },
			{
				listClaudeModels: async () => {
					throw new Error('claude is not logged in');
				},
			},
		);

		expect(openRequest).not.toHaveProperty('provider');
	});

	it('states no opinion when the request names no model at all', async () => {
		const { openRequest } = await openThroughIpc({});

		expect(openRequest).not.toHaveProperty('provider');
	});

	it('never reads a provider off the wire, even when the renderer sends one', async () => {
		const { openRequest } = await openThroughIpc({
			model: PI_MODEL,
			provider: 'claude',
		});

		expect(openRequest?.provider).toBe('pi');
	});

	it('derives the provider for a submit too, so a mid-chat switch is checked', async () => {
		const channels = registerHandlers();
		const submit = channels.get('ensemblr:submit-agent-prompt');

		await submit?.(null, {
			model: CLAUDE_MODEL,
			prompt: 'hello',
			sessionId: 'session-1',
		});

		expect(recorded.submitPrompt.mock.calls[0]?.[0].provider).toBe('claude');
	});
});

describe("the Pi readiness gate no longer blocks a runtime that does not use Pi's binary", () => {
	const brokenPi: PiExecutableSnapshot = {
		...createReadyExecutable(),
		command: '',
		status: 'error',
	};

	it('opens a Claude session on a machine with no usable Pi', async () => {
		const { openRequest, result } = await openThroughIpc(
			{ model: CLAUDE_MODEL },
			{ piExecutable: brokenPi },
		);

		expect(result.error).toBeUndefined();
		expect(openRequest?.provider).toBe('claude');
	});

	it('still refuses a Pi session when Pi is not ready', async () => {
		const { result } = await openThroughIpc(
			{ model: PI_MODEL },
			{ piExecutable: brokenPi },
		);

		expect(result.error).toBe(
			'Pi executable is not ready. Resolve setup checks first.',
		);
	});
});

describe("Plan Mode reaches the opener on a chat's first session", () => {
	it('puts the toggle on the open request, not only in the registry', async () => {
		const { openRequest } = await openThroughIpc({
			model: PI_MODEL,
			planMode: true,
		});

		expect(openRequest?.planMode).toBe(true);
	});

	it('forwards an explicit off just as faithfully', async () => {
		const { openRequest } = await openThroughIpc({
			model: PI_MODEL,
			planMode: false,
		});

		expect(openRequest?.planMode).toBe(false);
	});

	it('leaves the field absent when the chat states no opinion', async () => {
		const { openRequest } = await openThroughIpc({ model: PI_MODEL });

		expect(openRequest?.planMode).toBeUndefined();
	});
});

describe('a spawned sub-agent starts in Plan Mode rather than joining it late', () => {
	/**
	 * Spawns a conversation through the control layer and returns the open
	 * request the port built, plus the session ids the plan-mode registry was
	 * told about after the fact.
	 */
	const spawn = async (
		planMode: boolean,
	): Promise<{
		activatedFor: readonly string[];
		openRequest: Record<string, unknown>;
	}> => {
		const openSession: ReturnType<typeof vi.fn> = vi.fn(async () => ({
			id: 'child-1',
			status: 'starting',
		}));
		const activateForSpawn = vi.fn();
		const ports = createAgentControlPorts({
			agentSessionService: {
				getSession: vi.fn(() => null),
				listSessionsForWorkspace: vi.fn(() => []),
				openSession,
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
			localCommandService: {},
			piExecutableService: {
				getSnapshot: vi.fn(async () => ({ command: 'pi', status: 'ok' })),
			},
			planMode: {
				activateForSpawn,
				exit: vi.fn(),
				isActive: vi.fn(() => false),
				releaseSession: vi.fn(),
			},
			scriptLifecycleService: {},
			terminalService: {},
		} as never);

		await ports.conversations.startConversation({
			parentSessionId: 'ws:ws',
			planMode,
			prompt: 'go',
			workspaceCwd: '/ws',
			workspaceId: 'ws',
		});

		return {
			activatedFor: activateForSpawn.mock.calls.map((call) => call[0]),
			openRequest: openSession.mock.calls[0]?.[0],
		};
	};

	it('carries the flag into the open, where the runtime can act on it', async () => {
		const { openRequest } = await spawn(true);

		expect(openRequest.planMode).toBe(true);
	});

	it('still registers the child so the control layer agrees with the runtime', async () => {
		const { activatedFor } = await spawn(true);

		expect(activatedFor).toEqual(['child-1']);
	});

	it('leaves an unrestricted spawn unrestricted', async () => {
		const { activatedFor, openRequest } = await spawn(false);

		expect(openRequest.planMode).toBe(false);
		expect(activatedFor).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Part B — the pin is enforced by the runtime, not just by a disabled picker.
// ---------------------------------------------------------------------------

/** A live session service over a real database and an in-memory adapter pair. */
interface PinHarness {
	service: AgentSessionService;
	seedSession: (provider: 'claude' | 'pi') => string;
}

/**
 * Builds the production session service over a temp SQLite file, with the fake
 * adapter registered for both runtimes so a session can be opened and submitted
 * to without any real process.
 */
function createPinHarness(): PinHarness {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-pin-'));
	const databaseService = createEnsemblrDatabaseService({
		databasePath: path.join(directory, 'pin.db'),
	});
	databaseService.open();
	cleanups.push(() => {
		databaseService.close();
		rmSync(directory, { force: true, recursive: true });
	});
	const database = databaseService.getConnection()?.database;
	if (!database) {
		throw new Error('The test database did not open.');
	}
	database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch)
VALUES ('repo-pin', 'pin', 'Pin', '/tmp/ensemblr/pin', 'main');
INSERT INTO workspaces (id, repository_id, slug, name, path)
VALUES ('${WORKSPACE_ID}', 'repo-pin', 'pin', 'Pin', '${WORKSPACE_CWD}');
`);

	const service = createAgentSessionService({
		agentClient: createAgentClient({
			adapters: {
				claude: createFakeAgentAdapter().adapter,
				pi: createFakeAgentAdapter().adapter,
			},
		}),
		captureCheckpoint: async () => null,
		databaseService,
		queueNaming: () => undefined,
	});
	cleanups.push(() => {
		void service.shutdown();
	});

	return {
		seedSession: (provider) =>
			createAgentSession({
				database,
				input: { cwd: WORKSPACE_CWD, provider, workspaceId: WORKSPACE_ID },
			}).session.id,
		service,
	};
}

describe('resuming a session across providers is rejected, not coerced', () => {
	let harness: PinHarness;

	beforeEach(() => {
		harness = createPinHarness();
	});

	/** Resumes a seeded session with the derived provider a model implies. */
	const resume = (
		resumeSessionId: string,
		provider?: 'claude' | 'pi',
	): Promise<unknown> =>
		harness.service.openSession({
			executable: createReadyExecutable(),
			resumeSessionId,
			workspaceCwd: WORKSPACE_CWD,
			workspaceId: WORKSPACE_ID,
			...(provider ? { provider } : {}),
		});

	it('refuses a Claude model against a Pi chat with provider-mismatch', async () => {
		const sessionId = harness.seedSession('pi');

		await expect(resume(sessionId, 'claude')).rejects.toMatchObject({
			code: 'provider-mismatch',
		});
	});

	it('refuses a Pi model against a Claude chat with provider-mismatch', async () => {
		const sessionId = harness.seedSession('claude');

		await expect(resume(sessionId, 'pi')).rejects.toMatchObject({
			code: 'provider-mismatch',
		});
	});

	it('raises the typed service error, not a bare Error', async () => {
		const sessionId = harness.seedSession('pi');

		await expect(resume(sessionId, 'claude')).rejects.toBeInstanceOf(
			AgentSessionServiceError,
		);
	});

	it('resumes normally when the model matches the pin', async () => {
		const sessionId = harness.seedSession('claude');

		await expect(resume(sessionId, 'claude')).resolves.toMatchObject({
			provider: 'claude',
		});
	});

	it('resumes a Claude chat when the model is unknown to every catalog', async () => {
		const sessionId = harness.seedSession('claude');

		await expect(resume(sessionId)).resolves.toMatchObject({
			provider: 'claude',
		});
	});
});

describe('submitting a cross-provider model mid-chat is rejected', () => {
	let harness: PinHarness;

	beforeEach(() => {
		harness = createPinHarness();
	});

	/** Opens a live session on one runtime and returns its id. */
	const openOn = async (provider: 'claude' | 'pi'): Promise<string> => {
		const snapshot = await harness.service.openSession({
			executable: createReadyExecutable(),
			provider,
			workspaceCwd: WORKSPACE_CWD,
			workspaceId: WORKSPACE_ID,
		});
		return snapshot.id;
	};

	it('refuses a Claude model on a live Pi session', async () => {
		const sessionId = await openOn('pi');

		await expect(
			harness.service.submitPrompt({
				prompt: 'switch me',
				provider: 'claude',
				sessionId,
			}),
		).rejects.toMatchObject({ code: 'provider-mismatch' });
	});

	it('accepts a model that stays on the pinned runtime', async () => {
		const sessionId = await openOn('claude');

		await expect(
			harness.service.submitPrompt({
				prompt: 'stay',
				provider: 'claude',
				sessionId,
			}),
		).resolves.toMatchObject({ turnId: expect.any(String) });
	});

	it('accepts a submit whose model no catalog claims', async () => {
		const sessionId = await openOn('claude');

		await expect(
			harness.service.submitPrompt({ prompt: 'unknown model', sessionId }),
		).resolves.toMatchObject({ turnId: expect.any(String) });
	});
});
