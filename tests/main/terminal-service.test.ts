import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';

import type { WorkspaceEnvironmentService } from '../../src/main/environment/workspace-environment.ts';
import type { EnsemblrDatabaseService } from '../../src/main/storage/database.ts';
import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';
import { insertRepositoryRow } from '../../src/main/storage/repositories/repository-row-repository.ts';
import { insertWorkspaceRow } from '../../src/main/storage/repositories/workspace-repository.ts';
import type {
	AgentConversationInfo,
	ReadAgentConversationTitleOptions,
} from '../../src/main/terminal/agent-conversation-title.ts';
import type {
	PtyBackend,
	PtyProcess,
	PtySpawnOptions,
} from '../../src/main/terminal/pty-backend.ts';
import { createNodePtyBackend } from '../../src/main/terminal/pty-backend.ts';
import { createScrollbackBuffer } from '../../src/main/terminal/terminal-scrollback.ts';
import { createTerminalService } from '../../src/main/terminal/terminal-service.ts';
import { resolveUserShell } from '../../src/main/terminal/user-shell.ts';
import type { SessionLogSource } from '../../src/shared/agents/harness-registry.ts';
import type {
	TerminalLifecycleBroadcast,
	TerminalOutputBroadcast,
} from '../../src/shared/ipc';

const NOW = new Date('2026-06-11T00:00:00.000Z');
const WORKSPACE_ID = 'workspace-1';

function createDatabaseFixture(t: TestContext): DatabaseSync {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-terminal-'));
	const connection = openEnsemblrDatabase({
		databasePath: path.join(directory, 'ensemblr-test.db'),
	});

	t.after(() => {
		connection.database.close();
		rmSync(directory, { force: true, recursive: true });
	});

	insertRepositoryRow({
		database: connection.database,
		defaultBranch: 'main',
		id: 'repo-1',
		metadataJson: '{}',
		name: 'ensemblr',
		path: '/tmp/repo',
		remoteUrl: '',
		slug: 'ensemblr',
		timestamp: NOW.toISOString(),
	});
	insertWorkspaceRow({
		baseBranch: 'main',
		branchName: 'philipp/monterrey',
		database: connection.database,
		id: WORKSPACE_ID,
		metadataJson: '{}',
		name: 'monterrey',
		path: '/tmp/workspace',
		repositoryId: 'repo-1',
		slug: 'monterrey',
		timestamp: NOW.toISOString(),
	});

	return connection.database;
}

function createDatabaseServiceStub(
	database: DatabaseSync | null,
): EnsemblrDatabaseService {
	return {
		getConnection: () => (database ? { database } : null),
	} as unknown as EnsemblrDatabaseService;
}

function createWorkspaceEnvironmentStub(
	cwd = process.cwd(),
): WorkspaceEnvironmentService {
	return {
		assemble: async ({ workspaceId }) => ({
			cwd,
			diagnostics: [],
			env: {
				ENSEMBLR_PORT: '41000',
				ENSEMBLR_WORKSPACE_NAME: 'monterrey',
				ENSEMBLR_WORKSPACE_PATH: cwd,
			},
			port: 41_000,
			redactValues: [],
			workspaceId,
			workspaceName: 'monterrey',
			workspacePath: cwd,
		}),
	};
}

/** Controllable fake PTY for unit-style service tests. */
function createFakePty(): {
	pty: PtyProcess;
	emitData: (data: string) => void;
	emitExit: (exitCode: number) => void;
	killSignals: string[];
	writes: string[];
	resizes: Array<{ cols: number; rows: number }>;
} {
	const dataListeners = new Set<(data: string) => void>();
	const exitListeners = new Set<(event: { exitCode: number }) => void>();
	const killSignals: string[] = [];
	const writes: string[] = [];
	const resizes: Array<{ cols: number; rows: number }> = [];

	return {
		emitData: (data) => {
			for (const listener of dataListeners) {
				listener(data);
			}
		},
		emitExit: (exitCode) => {
			for (const listener of exitListeners) {
				listener({ exitCode });
			}
		},
		killSignals,
		pty: {
			kill: (signal) => {
				killSignals.push(signal ?? 'SIGTERM');
			},
			onData: (listener) => {
				dataListeners.add(listener);
				return { dispose: () => dataListeners.delete(listener) };
			},
			onExit: (listener) => {
				exitListeners.add(listener);
				return { dispose: () => exitListeners.delete(listener) };
			},
			pid: 4242,
			resize: (cols, rows) => {
				resizes.push({ cols, rows });
			},
			write: (data) => {
				writes.push(data);
			},
		},
		resizes,
		writes,
	};
}

function requireSpawnOptions(options: PtySpawnOptions | null): PtySpawnOptions {
	assert.ok(options);

	return options;
}

function requireSpawnEnv(
	env: Record<string, string> | null,
): Record<string, string> {
	assert.ok(env);

	return env;
}

function createServiceFixture(
	t: TestContext,
	{
		backend,
		killGraceMs = 50,
		readConversationInfo = async () => ({ sessionId: null, title: null }),
	}: {
		backend: PtyBackend;
		killGraceMs?: number;
		readConversationInfo?: (
			source: SessionLogSource,
			cwd: string,
			options?: ReadAgentConversationTitleOptions,
		) => Promise<AgentConversationInfo>;
	},
) {
	const database = createDatabaseFixture(t);
	const lifecycleEvents: TerminalLifecycleBroadcast[] = [];
	const outputEvents: TerminalOutputBroadcast[] = [];
	const service = createTerminalService({
		backend,
		databaseService: createDatabaseServiceStub(database),
		killGraceMs,
		now: () => NOW,
		onLifecycle: (event) => lifecycleEvents.push(event),
		onOutput: (event) => outputEvents.push(event),
		readConversationInfo,
		workspaceEnvironmentService: createWorkspaceEnvironmentStub(),
	});

	return { database, lifecycleEvents, outputEvents, service };
}

test('create spawns a PTY in the workspace cwd with the assembled env', async (t) => {
	let spawned: {
		args: string[];
		cwd: string;
		env: Record<string, string>;
		file: string;
	} | null = null;
	const fake = createFakePty();
	const backend: PtyBackend = {
		spawn: (options) => {
			spawned = options;
			return fake.pty;
		},
	};
	const { service } = createServiceFixture(t, { backend });

	const result = await service.create({ workspaceId: WORKSPACE_ID });

	assert.ok(result.session);
	assert.equal(result.session.status, 'running');
	assert.equal(result.session.kind, 'terminal');
	const spawnOptions = requireSpawnOptions(spawned);
	assert.equal(spawnOptions.cwd, process.cwd());
	assert.deepEqual(spawnOptions.args, ['-l']);
	assert.equal(spawnOptions.env.ENSEMBLR_WORKSPACE_NAME, 'monterrey');
	assert.equal(spawnOptions.env.ENSEMBLR_PORT, '41000');
});

test('output streams broadcast and accumulate as scrollback', async (t) => {
	const fake = createFakePty();
	const backend: PtyBackend = { spawn: () => fake.pty };
	const { outputEvents, service } = createServiceFixture(t, { backend });

	const result = await service.create({ workspaceId: WORKSPACE_ID });
	const terminalId = result.session?.id ?? '';

	fake.emitData('hello ');
	fake.emitData('world');

	assert.equal(outputEvents.length, 2);
	assert.equal(outputEvents[1]?.data, 'world');
	assert.equal(service.getSnapshot(terminalId).scrollback, 'hello world');
});

test('detects a run-script preview URL split across two output chunks', async (t) => {
	const fake = createFakePty();
	const backend: PtyBackend = { spawn: () => fake.pty };
	const { lifecycleEvents, service } = createServiceFixture(t, { backend });

	const result = await service.create({
		kind: 'run-script',
		workspaceId: WORKSPACE_ID,
	});
	const terminalId = result.session?.id ?? '';

	fake.emitData('  ➜  Local:   http://localh');
	fake.emitData('ost:5173/\r\n');

	assert.equal(
		service.getSnapshot(terminalId).session?.previewUrl,
		'http://localhost:5173/',
	);
	assert.ok(
		lifecycleEvents.some(
			(event) => event.session.previewUrl === 'http://localhost:5173/',
		),
	);
});

test('captures an agent OSC title terminated by BEL', async (t) => {
	const fake = createFakePty();
	const backend: PtyBackend = { spawn: () => fake.pty };
	const { lifecycleEvents, service } = createServiceFixture(t, { backend });

	const result = await service.create({
		kind: 'agent',
		workspaceId: WORKSPACE_ID,
	});
	const terminalId = result.session?.id ?? '';

	const ESC = String.fromCharCode(27);
	const BEL = String.fromCharCode(7);
	fake.emitData(`${ESC}]0;Fix the login bug${BEL}`);

	assert.equal(
		service.getSnapshot(terminalId).session?.title,
		'Fix the login bug',
	);
	assert.ok(
		lifecycleEvents.some(
			(event) => event.session.title === 'Fix the login bug',
		),
	);
});

test('captures an agent OSC title terminated by ST split across chunks', async (t) => {
	const fake = createFakePty();
	const backend: PtyBackend = { spawn: () => fake.pty };
	const { service } = createServiceFixture(t, { backend });

	const result = await service.create({
		kind: 'agent',
		workspaceId: WORKSPACE_ID,
	});
	const terminalId = result.session?.id ?? '';

	const ESC = String.fromCharCode(27);
	fake.emitData(`${ESC}]2;Refactor the parser`);
	fake.emitData(`${ESC}\\`);

	assert.equal(
		service.getSnapshot(terminalId).session?.title,
		'Refactor the parser',
	);
});

test('ignores OSC titles for non-agent terminal sessions', async (t) => {
	const fake = createFakePty();
	const backend: PtyBackend = { spawn: () => fake.pty };
	const { service } = createServiceFixture(t, { backend });

	const result = await service.create({ workspaceId: WORKSPACE_ID });
	const terminalId = result.session?.id ?? '';

	const ESC = String.fromCharCode(27);
	const BEL = String.fromCharCode(7);
	fake.emitData(`${ESC}]0;should not stick${BEL}`);

	assert.notEqual(
		service.getSnapshot(terminalId).session?.title,
		'should not stick',
	);
});

test('flags a pty-spinner agent busy on braille spinner output', async (t) => {
	const fake = createFakePty();
	const backend: PtyBackend = { spawn: () => fake.pty };
	const { lifecycleEvents, service } = createServiceFixture(t, { backend });

	const result = await service.create({
		harnessId: 'vibe',
		kind: 'agent',
		workspaceId: WORKSPACE_ID,
	});
	const terminalId = result.session?.id ?? '';

	assert.equal(service.getSnapshot(terminalId).session?.agentBusy, false);

	fake.emitData('⠋ Generating (2s Esc to interrupt)');

	assert.equal(service.getSnapshot(terminalId).session?.agentBusy, true);
	assert.ok(lifecycleEvents.some((event) => event.session.agentBusy === true));
});

test('does not flag busy for an osc-title agent on braille output', async (t) => {
	const fake = createFakePty();
	const backend: PtyBackend = { spawn: () => fake.pty };
	const { service } = createServiceFixture(t, { backend });

	const result = await service.create({
		harnessId: 'codex',
		kind: 'agent',
		workspaceId: WORKSPACE_ID,
	});
	const terminalId = result.session?.id ?? '';

	fake.emitData('⠋ working');

	assert.equal(service.getSnapshot(terminalId).session?.agentBusy, false);
});

test('a fresh agent gates its conversation-title read by the launch time', async (t) => {
	const fake = createFakePty();
	const backend: PtyBackend = { spawn: () => fake.pty };
	const sinceValues: (string | undefined)[] = [];
	const { service } = createServiceFixture(t, {
		backend,
		readConversationInfo: async (_source, _cwd, options) => {
			sinceValues.push(options?.since);
			return { sessionId: null, title: null };
		},
	});

	await service.create({
		harnessId: 'codex',
		kind: 'agent',
		workspaceId: WORKSPACE_ID,
	});

	assert.equal(sinceValues[0], NOW.toISOString());
});

test('a resumed agent drops the title gate so it re-adopts its prior conversation', async (t) => {
	const fake = createFakePty();
	const backend: PtyBackend = { spawn: () => fake.pty };
	const sinceValues: (string | undefined)[] = [];
	const { service } = createServiceFixture(t, {
		backend,
		readConversationInfo: async (_source, _cwd, options) => {
			sinceValues.push(options?.since);
			return { sessionId: null, title: null };
		},
	});

	await service.create({
		harnessId: 'codex',
		kind: 'agent',
		resumed: true,
		workspaceId: WORKSPACE_ID,
	});

	assert.equal(sinceValues[0], undefined);
});

test('does not detect a preview URL for interactive terminal sessions', async (t) => {
	const fake = createFakePty();
	const backend: PtyBackend = { spawn: () => fake.pty };
	const { service } = createServiceFixture(t, { backend });

	const result = await service.create({ workspaceId: WORKSPACE_ID });
	const terminalId = result.session?.id ?? '';

	fake.emitData('http://localhost:5173/\r\n');

	assert.equal(service.getSnapshot(terminalId).session?.previewUrl, null);
});

test('output broadcasts carry monotonic seq mirrored by snapshot lastSeq', async (t) => {
	const fake = createFakePty();
	const backend: PtyBackend = { spawn: () => fake.pty };
	const { outputEvents, service } = createServiceFixture(t, { backend });

	const result = await service.create({ workspaceId: WORKSPACE_ID });
	const terminalId = result.session?.id ?? '';

	assert.equal(service.getSnapshot(terminalId).lastSeq, 0);

	fake.emitData('a');
	fake.emitData('b');

	assert.deepEqual(
		outputEvents.map((event) => event.seq),
		[1, 2],
	);
	assert.equal(service.getSnapshot(terminalId).lastSeq, 2);
	assert.equal(service.getSnapshot('missing').lastSeq, 0);
});

test('waitForExit resolves on session end and false on timeout', async (t) => {
	const fake = createFakePty();
	const backend: PtyBackend = { spawn: () => fake.pty };
	const { service } = createServiceFixture(t, { backend });

	const result = await service.create({ workspaceId: WORKSPACE_ID });
	const terminalId = result.session?.id ?? '';

	assert.equal(await service.waitForExit('missing'), true);

	const timedOut = await service.waitForExit(terminalId, 20);
	assert.equal(timedOut, false);

	const waiting = service.waitForExit(terminalId, 1_000);
	fake.emitExit(0);
	assert.equal(await waiting, true);

	// Already-ended sessions resolve immediately.
	assert.equal(await service.waitForExit(terminalId), true);
});

test('write and resize forward to the PTY and update the snapshot', async (t) => {
	const fake = createFakePty();
	const backend: PtyBackend = { spawn: () => fake.pty };
	const { service } = createServiceFixture(t, { backend });

	const result = await service.create({ workspaceId: WORKSPACE_ID });
	const terminalId = result.session?.id ?? '';

	service.write(terminalId, 'ls\r');
	service.resize(terminalId, 120, 40);

	assert.deepEqual(fake.writes, ['ls\r']);
	assert.deepEqual(fake.resizes, [{ cols: 120, rows: 40 }]);
	assert.equal(service.getSnapshot(terminalId).session?.cols, 120);
	assert.equal(service.getSnapshot(terminalId).session?.rows, 40);
});

test('clean exit maps to exited; non-zero exit maps to failed', async (t) => {
	const fakeClean = createFakePty();
	const fakeFailed = createFakePty();
	const ptys = [fakeClean.pty, fakeFailed.pty];
	const backend: PtyBackend = { spawn: () => ptys.shift() as PtyProcess };
	const { lifecycleEvents, service } = createServiceFixture(t, { backend });

	const clean = await service.create({ workspaceId: WORKSPACE_ID });
	const failed = await service.create({ workspaceId: WORKSPACE_ID });

	fakeClean.emitExit(0);
	fakeFailed.emitExit(1);

	assert.equal(
		service.getSnapshot(clean.session?.id ?? '').session?.status,
		'exited',
	);
	const failedSnapshot = service.getSnapshot(failed.session?.id ?? '').session;
	assert.equal(failedSnapshot?.status, 'failed');
	assert.equal(failedSnapshot?.exitCode, 1);
	assert.ok(lifecycleEvents.some((event) => event.session.status === 'failed'));
});

test('kill sends SIGHUP, escalates to SIGKILL, and maps exit to stopped', async (t) => {
	const fake = createFakePty();
	const backend: PtyBackend = { spawn: () => fake.pty };
	const { service } = createServiceFixture(t, { backend, killGraceMs: 10 });

	const result = await service.create({ workspaceId: WORKSPACE_ID });
	const terminalId = result.session?.id ?? '';

	service.kill(terminalId);
	assert.deepEqual(fake.killSignals, ['SIGHUP']);

	// Process ignores SIGHUP; the grace timer escalates.
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.deepEqual(fake.killSignals, ['SIGHUP', 'SIGKILL']);

	fake.emitExit(137);
	assert.equal(service.getSnapshot(terminalId).session?.status, 'stopped');
});

test('terminal session metadata is persisted across the lifecycle', async (t) => {
	const fake = createFakePty();
	const backend: PtyBackend = { spawn: () => fake.pty };
	const { database, service } = createServiceFixture(t, { backend });

	const result = await service.create({ workspaceId: WORKSPACE_ID });
	const terminalId = result.session?.id ?? '';

	const runningRow = database
		.prepare('SELECT status FROM terminal_sessions WHERE id = ?')
		.get(terminalId) as { status: string };
	assert.equal(runningRow.status, 'running');

	service.kill(terminalId);
	fake.emitExit(1);

	const endedRow = database
		.prepare(
			'SELECT status, ended_at AS endedAt, metadata_json AS metadataJson FROM terminal_sessions WHERE id = ?',
		)
		.get(terminalId) as {
		endedAt: string | null;
		metadataJson: string;
		status: string;
	};
	assert.equal(endedRow.status, 'exited');
	assert.ok(endedRow.endedAt);
	assert.equal(JSON.parse(endedRow.metadataJson).stopped, true);
});

test('list scopes sessions to the requested workspace', async (t) => {
	const fake = createFakePty();
	const backend: PtyBackend = { spawn: () => fake.pty };
	const { service } = createServiceFixture(t, { backend });

	await service.create({ workspaceId: WORKSPACE_ID });

	assert.equal(service.list(WORKSPACE_ID).length, 1);
	assert.equal(service.list('other-workspace').length, 0);
});

test('interactive sessions use the user shell; script commands use the script shell', async (t) => {
	const spawnedArgs: string[][] = [];
	const spawnedFiles: string[] = [];
	const spawnedEnvs: Record<string, string>[] = [];
	const fakes = [createFakePty(), createFakePty()];
	const backend: PtyBackend = {
		spawn: (options) => {
			spawnedArgs.push(options.args);
			spawnedFiles.push(options.file);
			spawnedEnvs.push(options.env);
			return (fakes.shift() as ReturnType<typeof createFakePty>).pty;
		},
	};
	const database = createDatabaseFixture(t);
	const service = createTerminalService({
		backend,
		databaseService: createDatabaseServiceStub(database),
		defaultShell: '/usr/local/bin/fish',
		onLifecycle: () => undefined,
		onOutput: () => undefined,
		scriptShell: '/bin/zsh',
		workspaceEnvironmentService: createWorkspaceEnvironmentStub(),
	});

	await service.create({ workspaceId: WORKSPACE_ID });
	await service.create({
		command: 'bun install',
		kind: 'setup-script',
		workspaceId: WORKSPACE_ID,
	});

	assert.deepEqual(spawnedFiles, ['/usr/local/bin/fish', '/bin/zsh']);
	assert.deepEqual(spawnedArgs, [['-l'], ['-c', 'bun install']]);
	assert.equal(spawnedEnvs[0]?.COLORTERM, 'truecolor');
	assert.equal(spawnedEnvs[0]?.TERM_PROGRAM, 'Ensemblr');
	assert.ok(spawnedEnvs[0]?.LANG);
});

/** Verifies script PTYs inherit the same shell-derived PATH as diagnostics. */
test('script sessions merge the resolved base environment before workspace vars', async (t) => {
	let spawnedEnv: Record<string, string> | null = null;
	const fake = createFakePty();
	const backend: PtyBackend = {
		spawn: (options) => {
			spawnedEnv = options.env;
			return fake.pty;
		},
	};
	const database = createDatabaseFixture(t);
	const service = createTerminalService({
		backend,
		databaseService: createDatabaseServiceStub(database),
		onLifecycle: () => undefined,
		onOutput: () => undefined,
		resolveBaseEnv: async () => ({
			__CFBundleIdentifier: 'dev.ensemblr.app',
			PATH: '/mise/shims:/opt/homebrew/bin:/usr/bin',
			SHELL_MARKER: 'from-login-shell',
		}),
		scriptShell: '/bin/zsh',
		workspaceEnvironmentService:
			createWorkspaceEnvironmentStub('/tmp/workspace'),
	});

	await service.create({
		command: 'npm ci',
		kind: 'setup-script',
		workspaceId: WORKSPACE_ID,
	});

	const env = requireSpawnEnv(spawnedEnv);
	assert.equal(env.PATH, '/mise/shims:/opt/homebrew/bin:/usr/bin');
	assert.equal(env.SHELL_MARKER, 'from-login-shell');
	assert.equal(env.ENSEMBLR_WORKSPACE_PATH, '/tmp/workspace');
	assert.equal(env.__CFBundleIdentifier, undefined);
});

test('resolveUserShell returns an existing shell binary', () => {
	const shell = resolveUserShell();

	assert.ok(shell.startsWith('/'));
	assert.ok(shell.length > 1);
});

test('scrollback buffer trims from the front past its limit', () => {
	const buffer = createScrollbackBuffer(8);

	buffer.append('12345');
	buffer.append('6789');

	assert.equal(buffer.read(), '23456789');
});

test('integration: real PTY runs a shell command, accepts input, and terminates', async () => {
	const backend = createNodePtyBackend();
	const outputs: string[] = [];
	const exits: TerminalLifecycleBroadcast[] = [];
	const integrationService = createTerminalService({
		backend,
		databaseService: createDatabaseServiceStub(null),
		killGraceMs: 200,
		onLifecycle: (event) => exits.push(event),
		onOutput: (event) => outputs.push(event.data),
		workspaceEnvironmentService: createWorkspaceEnvironmentStub(),
	});

	const echo = await integrationService.create({
		command: 'echo "pty-says:$ENSEMBLR_WORKSPACE_NAME"',
		workspaceId: WORKSPACE_ID,
	});
	assert.ok(echo.session);

	await waitFor(
		() =>
			integrationService.getSnapshot(echo.session?.id ?? '').session?.status ===
			'exited',
	);
	assert.match(outputs.join(''), /pty-says:monterrey/);

	// Interactive input: `cat` echoes stdin back, then a stop maps to 'stopped'.
	const interactive = await integrationService.create({
		command: 'cat',
		workspaceId: WORKSPACE_ID,
	});
	const interactiveId = interactive.session?.id ?? '';
	integrationService.write(interactiveId, 'ping\r');
	await waitFor(() =>
		integrationService.getSnapshot(interactiveId).scrollback.includes('ping'),
	);

	integrationService.resize(interactiveId, 100, 30);
	integrationService.kill(interactiveId);
	await waitFor(
		() =>
			integrationService.getSnapshot(interactiveId).session?.status !==
			'running',
	);
	assert.equal(
		integrationService.getSnapshot(interactiveId).session?.status,
		'stopped',
	);
});

async function waitFor(
	predicate: () => boolean,
	timeoutMs = 5_000,
): Promise<void> {
	const start = Date.now();

	while (!predicate()) {
		if (Date.now() - start > timeoutMs) {
			throw new Error('Timed out waiting for condition.');
		}

		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}
