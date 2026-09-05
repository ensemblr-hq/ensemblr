import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import type {
	Options,
	Query,
	SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import {
	type AgentClient,
	type AgentSession,
	createAgentClient,
} from '../../src/main/agent-runtime/agent-client.ts';
import { createSessionOpener } from '../../src/main/agent-runtime/session/session-open.ts';
import { createClaudeAgentAdapter } from '../../src/main/claude-agent/claude-agent-adapter.ts';
import { createPiCliRpcAdapter } from '../../src/main/pi-agent/pi-cli-rpc-adapter.ts';
import type { PiExecutableSnapshot } from '../../src/main/pi-runtime/pi-executable.ts';
import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';
import {
	createAgentSession,
	getAgentSessionById,
} from '../../src/main/storage/repositories/agent-session-repository.ts';
import type { AgentProviderId } from '../../src/shared/agent-provider.ts';
import { CONTEXT_USAGE } from './helpers/claude-context-usage.ts';

const WORKSPACE_ID = 'ws-continuity';
const WORKSPACE_CWD = '/tmp/ensemblr/continuity/ws';

const cleanups: Array<() => void> = [];

afterEach(() => {
	while (cleanups.length > 0) {
		cleanups.pop()?.();
	}
});

/** A database holding one workspace, torn down after the test. */
function openTestDatabase(): DatabaseSync {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-continuity-'));
	const connection = openEnsemblrDatabase({
		databasePath: path.join(directory, 'continuity-test.db'),
	});
	cleanups.push(() => {
		connection.database.close();
		rmSync(directory, { force: true, recursive: true });
	});
	connection.database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch)
VALUES ('repo-continuity', 'continuity', 'Continuity', '/tmp/ensemblr/continuity', 'main');
INSERT INTO workspaces (id, repository_id, slug, name, path)
VALUES ('${WORKSPACE_ID}', 'repo-continuity', 'continuity', 'Continuity', '${WORKSPACE_CWD}');
`);
	return connection.database;
}

/** A Pi executable snapshot the opener accepts without probing anything. */
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

/**
 * A `Query` that never yields. The adapter treats the query completing as a
 * shutdown, which would close the session before the opener subscribes.
 */
function createPendingQuery(): Query {
	const iterator = (async function* (): AsyncGenerator<SDKMessage, void> {
		await new Promise<void>(() => undefined);
	})();
	return Object.assign(iterator, {
		applyFlagSettings: async () => undefined,
		close: () => undefined,
		getContextUsage: async () => CONTEXT_USAGE,
		interrupt: async () => undefined,
		setMaxThinkingTokens: async () => undefined,
		setModel: async () => undefined,
		setPermissionMode: async () => undefined,
	}) as unknown as Query;
}

/**
 * A Claude runtime wired the way the app wires it, plus the SDK options it
 * builds. Each call is a separate `AgentClient`, so opening through one and
 * resuming through another is exactly an app restart over one database.
 */
function createClaudeRuntime(): {
	agentClient: AgentClient;
	options: Options[];
} {
	const options: Options[] = [];
	const agentClient = createAgentClient({
		adapters: {
			claude: createClaudeAgentAdapter({
				queryFn: ({ options: sdkOptions }) => {
					if (sdkOptions) {
						options.push(sdkOptions);
					}
					return createPendingQuery();
				},
				resolveBaseEnv: () => ({ PATH: '/usr/bin' }),
			}),
		},
	});
	cleanups.push(() => {
		void agentClient.shutdown();
	});
	return { agentClient, options };
}

/**
 * A Pi runtime plus the argv it spawns with. The spawner throws so no child is
 * created; the adapter turns that into a spawn-failure session and the argv is
 * captured first.
 */
function createPiRuntime(): { agentClient: AgentClient; argv: string[][] } {
	const argv: string[][] = [];
	const agentClient = createAgentClient({
		adapters: {
			pi: createPiCliRpcAdapter({
				resolveBaseEnv: () => ({ PATH: '/usr/bin' }),
				spawn: (input) => {
					argv.push([...input.args]);
					throw new Error('no child in this test');
				},
			}),
		},
	});
	cleanups.push(() => {
		void agentClient.shutdown();
	});
	return { agentClient, argv };
}

/** The production opener over a runtime, with a fresh active-session map. */
function createOpener({
	agentClient,
	onRuntimeSession,
}: {
	agentClient: AgentClient;
	onRuntimeSession?: (session: AgentSession) => void;
}) {
	return createSessionOpener({
		activeSessions: new Map(),
		agentClient,
		eventSink: undefined,
		isPlanModeActive: () => false,
		isAfkModeActive: () => false,
		now: () => new Date('2026-08-07T00:00:00.000Z'),
		queueNaming: () => undefined,
		resolvePermissionMode: () => 'workspace-trusted',
		subscribeToRuntime: ({ runtimeSession }) => {
			onRuntimeSession?.(runtimeSession);
			return { unsubscribe: () => undefined };
		},
	});
}

/** Opens a brand-new session for a provider and returns its `agent_sessions.id`. */
async function openFresh({
	agentClient,
	database,
	provider,
}: {
	agentClient: AgentClient;
	database: DatabaseSync;
	provider: AgentProviderId;
}): Promise<string> {
	const snapshot = await createOpener({ agentClient }).openSession({
		database,
		request: {
			executable: createReadyExecutable(),
			provider,
			workspaceCwd: WORKSPACE_CWD,
			workspaceId: WORKSPACE_ID,
		},
	});
	return snapshot.id;
}

/** Resumes a persisted row through a runtime that has not opened it yet. */
async function resumeRow({
	agentClient,
	database,
	provider,
	sessionId,
}: {
	agentClient: AgentClient;
	database: DatabaseSync;
	provider: AgentProviderId;
	sessionId: string;
}): Promise<void> {
	await createOpener({ agentClient }).openSession({
		database,
		request: {
			executable: createReadyExecutable(),
			provider,
			resumeSessionId: sessionId,
			workspaceCwd: WORKSPACE_CWD,
			workspaceId: WORKSPACE_ID,
		},
	});
}

/**
 * Persists a session row that no runtime has ever run for — the shape another
 * surface leaves behind, and the case a naive "we are resuming, so resume"
 * branch gets wrong.
 */
function createUnopenedRow(
	database: DatabaseSync,
	provider: AgentProviderId,
): string {
	const { session } = createAgentSession({
		database,
		input: { cwd: WORKSPACE_CWD, provider, workspaceId: WORKSPACE_ID },
	});
	return session.id;
}

/** The runtime session id the row carries after an open. */
function readRuntimeSessionId(
	database: DatabaseSync,
	sessionId: string,
): string | null {
	return (
		getAgentSessionById({ database, id: sessionId })?.runtimeSessionId ?? null
	);
}

describe('a Claude session Claude has never seen is created, not resumed', () => {
	it('names its own session id on a brand-new open', async () => {
		const database = openTestDatabase();
		const { agentClient, options } = createClaudeRuntime();

		const sessionId = await openFresh({
			agentClient,
			database,
			provider: 'claude',
		});

		expect(options[0]?.sessionId).toBe(
			readRuntimeSessionId(database, sessionId),
		);
		expect(options[0]?.resume).toBeUndefined();
	});

	it('treats a row that exists but was never opened as a fresh session', async () => {
		const database = openTestDatabase();
		const sessionId = createUnopenedRow(database, 'claude');
		const { agentClient, options } = createClaudeRuntime();

		await resumeRow({ agentClient, database, provider: 'claude', sessionId });

		expect(options[0]?.sessionId).toBe(
			readRuntimeSessionId(database, sessionId),
		);
		expect(options[0]?.resume).toBeUndefined();
	});
});

describe('a Claude session Claude already ran is resumed, not recreated', () => {
	it('reloads the conversation the earlier open left behind', async () => {
		const database = openTestDatabase();
		const first = createClaudeRuntime();
		const sessionId = await openFresh({
			agentClient: first.agentClient,
			database,
			provider: 'claude',
		});
		const runtimeSessionId = readRuntimeSessionId(database, sessionId);

		const second = createClaudeRuntime();
		await resumeRow({
			agentClient: second.agentClient,
			database,
			provider: 'claude',
			sessionId,
		});

		expect(second.options[0]?.resume).toBe(runtimeSessionId);
		expect(second.options[0]?.sessionId).toBeUndefined();
	});

	it('never sets both, which the SDK refuses without forkSession', async () => {
		const database = openTestDatabase();
		const fresh = createClaudeRuntime();
		const sessionId = await openFresh({
			agentClient: fresh.agentClient,
			database,
			provider: 'claude',
		});
		const resumed = createClaudeRuntime();
		await resumeRow({
			agentClient: resumed.agentClient,
			database,
			provider: 'claude',
			sessionId,
		});
		const unopened = createClaudeRuntime();
		await resumeRow({
			agentClient: unopened.agentClient,
			database,
			provider: 'claude',
			sessionId: createUnopenedRow(database, 'claude'),
		});

		for (const options of [
			fresh.options[0],
			resumed.options[0],
			unopened.options[0],
		]) {
			expect(
				[options?.resume, options?.sessionId].filter(Boolean),
			).toHaveLength(1);
			expect(options?.forkSession).toBeUndefined();
		}
	});
});

describe('Pi is untouched: --session-id is create-or-resume there', () => {
	it('spawns the same argv fresh, resumed, and for a row nothing opened', async () => {
		const database = openTestDatabase();
		const fresh = createPiRuntime();
		const sessionId = await openFresh({
			agentClient: fresh.agentClient,
			database,
			provider: 'pi',
		});
		const runtimeSessionId = readRuntimeSessionId(database, sessionId);

		const resumed = createPiRuntime();
		await resumeRow({
			agentClient: resumed.agentClient,
			database,
			provider: 'pi',
			sessionId,
		});

		const unopened = createPiRuntime();
		await resumeRow({
			agentClient: unopened.agentClient,
			database,
			provider: 'pi',
			sessionId: createUnopenedRow(database, 'pi'),
		});

		for (const argv of [fresh.argv[0], resumed.argv[0], unopened.argv[0]]) {
			expect(argv).toEqual([
				'--mode',
				'rpc',
				'--session-id',
				expect.any(String),
			]);
		}
		expect(resumed.argv[0]?.at(-1)).toBe(runtimeSessionId);
		expect(unopened.argv[0]?.at(-1)).not.toBe(runtimeSessionId);
	});
});

describe('one session id, not two', () => {
	it('registers the runtime session under the agent_sessions.id row key', async () => {
		const database = openTestDatabase();
		const { agentClient } = createClaudeRuntime();
		let runtimeSession: AgentSession | null = null;

		const snapshot = await createOpener({
			agentClient,
			onRuntimeSession: (session) => {
				runtimeSession = session;
			},
		}).openSession({
			database,
			request: {
				executable: createReadyExecutable(),
				provider: 'claude',
				workspaceCwd: WORKSPACE_CWD,
				workspaceId: WORKSPACE_ID,
			},
		});

		const opened = runtimeSession as AgentSession | null;
		expect(opened?.id).toBe(snapshot.id);
		expect(opened?.getMetadata().id).toBe(snapshot.id);
		expect(agentClient.listSessions().map((session) => session.id)).toEqual([
			snapshot.id,
		]);
	});

	it('keeps the runtime session id apart from the row key', async () => {
		const database = openTestDatabase();
		const { agentClient } = createClaudeRuntime();
		let runtimeSession: AgentSession | null = null;

		const snapshot = await createOpener({
			agentClient,
			onRuntimeSession: (session) => {
				runtimeSession = session;
			},
		}).openSession({
			database,
			request: {
				executable: createReadyExecutable(),
				provider: 'claude',
				workspaceCwd: WORKSPACE_CWD,
				workspaceId: WORKSPACE_ID,
			},
		});

		const opened = runtimeSession as AgentSession | null;
		expect(opened?.getMetadata().sessionId).toBe(
			readRuntimeSessionId(database, snapshot.id),
		);
		expect(opened?.getMetadata().sessionId).not.toBe(snapshot.id);
	});
});
