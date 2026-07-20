/// <reference types="node" />

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';

import type { EnsemblrConfigResolutionService } from '../../src/main/config/config-resolution.ts';
import { createScriptLifecycleService } from '../../src/main/scripts/script-lifecycle-service.ts';
import { computeSetupFingerprint } from '../../src/main/scripts/setup-fingerprint.ts';
import type { EnsemblrDatabaseService } from '../../src/main/storage/database.ts';
import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';
import { insertRepositoryRow } from '../../src/main/storage/repositories/repository-row-repository.ts';
import { insertWorkspaceRow } from '../../src/main/storage/repositories/workspace-repository.ts';
import type {
	CreateTerminalSessionOptions,
	TerminalService,
} from '../../src/main/terminal';
import type {
	SettingsResolutionRequest,
	TerminalSessionSnapshot,
} from '../../src/shared/ipc';

const NOW = '2026-06-11T00:00:00.000Z';
const WORKSPACE_ID = 'workspace-1';

function createDatabaseFixture(t: TestContext): DatabaseSync {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-scripts-'));
	const worktreePath = path.join(directory, 'worktree');
	mkdirSync(worktreePath, { recursive: true });
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
		timestamp: NOW,
	});
	insertWorkspaceRow({
		baseBranch: 'main',
		branchName: 'philipp/monterrey',
		database: connection.database,
		id: WORKSPACE_ID,
		metadataJson: '{}',
		name: 'monterrey',
		path: worktreePath,
		repositoryId: 'repo-1',
		slug: 'monterrey',
		timestamp: NOW,
	});

	return connection.database;
}

function createDatabaseServiceStub(
	database: DatabaseSync,
): EnsemblrDatabaseService {
	return {
		getConnection: () => ({ database }),
	} as unknown as EnsemblrDatabaseService;
}

function createSettingsStub(
	settings: {
		archive?: string;
		autoRunAfterSetup?: boolean;
		run?: string;
		runScriptMode?: string;
		setup?: string;
	},
	onResolve?: (
		request: Parameters<EnsemblrConfigResolutionService['resolve']>[0],
	) => void,
): EnsemblrConfigResolutionService {
	const entries: Array<{ key: string; value: unknown }> = [];

	for (const kind of ['archive', 'run', 'setup'] as const) {
		entries.push({ key: `scripts.${kind}`, value: settings[kind] ?? null });
	}

	entries.push({
		key: 'runScriptMode',
		value: settings.runScriptMode ?? 'concurrent',
	});
	entries.push({
		key: 'autoRunAfterSetup',
		value: settings.autoRunAfterSetup ?? false,
	});

	return {
		resolve: (request) => {
			onResolve?.(request);

			return {
				app: { diagnostics: [], settings: [] },
				repository: {
					diagnostics: [],
					settings: entries.map((entry) => ({
						candidates: [],
						key: entry.key,
						locked: false,
						source: 'built-in-default' as const,
						value: entry.value,
					})),
				},
			};
		},
	};
}

/** Fake terminal service that records created sessions and kill calls. */
function createTerminalServiceFake({ killStops = true } = {}): {
	createCalls: CreateTerminalSessionOptions[];
	endSession: (terminalId: string, status: 'exited' | 'failed') => void;
	killedIds: string[];
	terminalService: TerminalService;
} {
	const createCalls: CreateTerminalSessionOptions[] = [];
	const killedIds: string[] = [];
	const sessions = new Map<string, TerminalSessionSnapshot>();
	let counter = 0;

	const terminalService: TerminalService = {
		create: async (options) => {
			createCalls.push(options);
			counter += 1;
			const session: TerminalSessionSnapshot = {
				agentBusy: false,
				agentTitle: null,
				cols: 80,
				commandLabel: options.command ?? '/bin/zsh',
				createdAt: NOW,
				endedAt: null,
				exitCode: null,
				id: `session-${counter}`,
				kind: options.kind ?? 'terminal',
				previewUrl: null,
				rows: 24,
				status: 'running',
				title: options.title ?? 'Terminal',
				workspaceId: options.workspaceId,
			};
			sessions.set(session.id, session);

			return { diagnostics: [], session };
		},
		disposeAll: () => undefined,
		getSnapshot: (terminalId) => ({
			lastSeq: 0,
			scrollback: '',
			session: sessions.get(terminalId) ?? null,
		}),
		kill: (terminalId) => {
			killedIds.push(terminalId);
			const session = sessions.get(terminalId);

			if (session && killStops) {
				const stopped = { ...session, status: 'stopped' as const };
				sessions.set(terminalId, stopped);

				return stopped;
			}

			return session ?? null;
		},
		list: (workspaceId) =>
			Array.from(sessions.values()).filter(
				(session) => session.workspaceId === workspaceId,
			),
		recoverStaleSessions: () => undefined,
		resize: () => undefined,
		waitForExit: (terminalId, timeoutMs) =>
			new Promise((resolve) => {
				const start = Date.now();
				// Tests cap the wait so a kill-resistant fake cannot hang the suite.
				const effectiveTimeout = Math.min(timeoutMs ?? 500, 500);
				const check = () => {
					const session = sessions.get(terminalId);

					if (session?.status !== 'running') {
						resolve(true);
						return;
					}

					if (Date.now() - start >= effectiveTimeout) {
						resolve(false);
						return;
					}

					setTimeout(check, 10);
				};

				check();
			}),
		write: () => undefined,
	};

	return {
		createCalls,
		endSession: (terminalId, status) => {
			const session = sessions.get(terminalId);

			if (session) {
				sessions.set(terminalId, {
					...session,
					exitCode: status === 'exited' ? 0 : 1,
					status,
				});
			}
		},
		killedIds,
		terminalService,
	};
}

function createServiceFixture(
	t: TestContext,
	settings: Parameters<typeof createSettingsStub>[0],
	fakeOptions?: Parameters<typeof createTerminalServiceFake>[0],
) {
	const database = createDatabaseFixture(t);
	const fake = createTerminalServiceFake(fakeOptions);
	const service = createScriptLifecycleService({
		databaseService: createDatabaseServiceStub(database),
		settingsResolutionService: createSettingsStub(settings),
		terminalService: fake.terminalService,
	});

	return { ...fake, service };
}

test('runScript starts the configured setup script in a workspace PTY', async (t) => {
	const { createCalls, service } = createServiceFixture(t, {
		setup: 'bun install',
	});

	const result = await service.runScript({
		kind: 'setup',
		workspaceId: WORKSPACE_ID,
	});

	assert.ok(result.session);
	assert.equal(result.session.kind, 'setup-script');
	assert.equal(createCalls[0]?.command, 'bun install');
	assert.equal(createCalls[0]?.kind, 'setup-script');
});

test('runScript resolves committed config from the workspace worktree', async (t) => {
	const database = createDatabaseFixture(t);
	const fake = createTerminalServiceFake();
	const requests: unknown[] = [];
	const service = createScriptLifecycleService({
		databaseService: createDatabaseServiceStub(database),
		settingsResolutionService: createSettingsStub(
			{ setup: 'bun install' },
			(request) => {
				requests.push(request);
			},
		),
		terminalService: fake.terminalService,
	});

	await service.runScript({
		kind: 'setup',
		workspaceId: WORKSPACE_ID,
	});

	const request = requests[0] as SettingsResolutionRequest | undefined;
	assert.equal(request?.repository?.repositoryId, 'repo-1');
	assert.match(request?.repository?.repositoryPath ?? '', /worktree$/);
});

test('runScript reports unconfigured scripts without spawning', async (t) => {
	const { createCalls, service } = createServiceFixture(t, {});

	const result = await service.runScript({
		kind: 'run',
		workspaceId: WORKSPACE_ID,
	});

	assert.equal(result.session, null);
	assert.equal(result.diagnostics[0]?.code, 'script-not-configured');
	assert.equal(createCalls.length, 0);
});

test('nonconcurrent mode blocks duplicate active runs', async (t) => {
	const { createCalls, service } = createServiceFixture(t, {
		run: 'bun dev',
		runScriptMode: 'nonconcurrent',
	});

	const first = await service.runScript({
		kind: 'run',
		workspaceId: WORKSPACE_ID,
	});
	assert.ok(first.session);

	const second = await service.runScript({
		kind: 'run',
		workspaceId: WORKSPACE_ID,
	});
	assert.equal(second.session, null);
	assert.equal(second.diagnostics[0]?.code, 'script-already-running');
	assert.equal(createCalls.length, 1);
});

test('concurrent mode allows multiple named run sessions', async (t) => {
	const { createCalls, service } = createServiceFixture(t, {
		run: 'bun dev',
		runScriptMode: 'concurrent',
	});

	const first = await service.runScript({
		kind: 'run',
		workspaceId: WORKSPACE_ID,
	});
	const second = await service.runScript({
		kind: 'run',
		workspaceId: WORKSPACE_ID,
	});

	assert.ok(first.session);
	assert.ok(second.session);
	assert.notEqual(first.session.id, second.session.id);
	assert.equal(createCalls.length, 2);
});

test('restart stops the active run before starting a new one', async (t) => {
	const { createCalls, killedIds, service } = createServiceFixture(t, {
		run: 'bun dev',
		runScriptMode: 'nonconcurrent',
	});

	const first = await service.runScript({
		kind: 'run',
		workspaceId: WORKSPACE_ID,
	});
	const restarted = await service.runScript({
		kind: 'run',
		restart: true,
		workspaceId: WORKSPACE_ID,
	});

	assert.ok(restarted.session);
	assert.deepEqual(killedIds, [first.session?.id]);
	assert.equal(createCalls.length, 2);
});

test('restart aborts when the active run refuses to die', async (t) => {
	const { createCalls, killedIds, service } = createServiceFixture(
		t,
		{ run: 'bun dev', runScriptMode: 'nonconcurrent' },
		{ killStops: false },
	);

	const first = await service.runScript({
		kind: 'run',
		workspaceId: WORKSPACE_ID,
	});
	const restarted = await service.runScript({
		kind: 'run',
		restart: true,
		workspaceId: WORKSPACE_ID,
	});

	assert.equal(restarted.session, null);
	assert.equal(restarted.diagnostics[0]?.code, 'script-restart-timeout');
	assert.deepEqual(killedIds, [first.session?.id]);
	assert.equal(createCalls.length, 1);
});

test('setup never runs twice in parallel even in concurrent mode', async (t) => {
	const { service } = createServiceFixture(t, {
		runScriptMode: 'concurrent',
		setup: 'bun install',
	});

	await service.runScript({ kind: 'setup', workspaceId: WORKSPACE_ID });
	const second = await service.runScript({
		kind: 'setup',
		workspaceId: WORKSPACE_ID,
	});

	assert.equal(second.diagnostics[0]?.code, 'script-already-running');
});

test('stopScript kills the active session and reports idle otherwise', async (t) => {
	const { killedIds, service } = createServiceFixture(t, { run: 'bun dev' });

	const idle = await service.stopScript({
		kind: 'run',
		workspaceId: WORKSPACE_ID,
	});
	assert.equal(idle.diagnostics[0]?.code, 'script-not-running');

	const started = await service.runScript({
		kind: 'run',
		workspaceId: WORKSPACE_ID,
	});
	const stopped = await service.stopScript({
		kind: 'run',
		workspaceId: WORKSPACE_ID,
	});

	assert.equal(stopped.session?.status, 'stopped');
	assert.deepEqual(killedIds, [started.session?.id]);
});

test('runArchiveScriptAndWait returns once the script finishes', async (t) => {
	const fixture = createServiceFixture(t, { archive: 'bun run archive' });

	const waitPromise = fixture.service.runArchiveScriptAndWait({
		timeoutMs: 2_000,
		workspaceId: WORKSPACE_ID,
	});

	// Let runScript spawn, then finish the session.
	await new Promise((resolve) => setTimeout(resolve, 50));
	const archiveSession = fixture.createCalls[0];
	assert.ok(archiveSession);
	fixture.endSession('session-1', 'exited');

	await waitPromise;
	assert.equal(fixture.killedIds.length, 0);
});

test('runArchiveScriptAndWait kills a hung script at the timeout', async (t) => {
	const fixture = createServiceFixture(t, { archive: 'sleep 9999' });

	await fixture.service.runArchiveScriptAndWait({
		timeoutMs: 300,
		workspaceId: WORKSPACE_ID,
	});

	assert.deepEqual(fixture.killedIds, ['session-1']);
});

test('unknown workspace yields workspace-not-found', async (t) => {
	const { service } = createServiceFixture(t, { setup: 'bun install' });

	const result = await service.runScript({
		kind: 'setup',
		workspaceId: 'missing',
	});

	assert.equal(result.session, null);
	assert.equal(result.diagnostics[0]?.code, 'workspace-not-found');
});

test('runSetupScriptWithAutoRun chains the run script after a clean setup exit', async (t) => {
	const fixture = createServiceFixture(t, {
		autoRunAfterSetup: true,
		run: 'bun run dev',
		setup: 'bun install',
	});

	// Setup exits successfully shortly after it starts.
	setTimeout(() => fixture.endSession('session-1', 'exited'), 20);

	await fixture.service.runSetupScriptWithAutoRun({
		workspaceId: WORKSPACE_ID,
	});

	assert.deepEqual(
		fixture.createCalls.map((call) => call.kind),
		['setup-script', 'run-script'],
	);
});

test('runSetupScriptWithAutoRun does not run when auto-run is disabled', async (t) => {
	const fixture = createServiceFixture(t, {
		autoRunAfterSetup: false,
		run: 'bun run dev',
		setup: 'bun install',
	});

	setTimeout(() => fixture.endSession('session-1', 'exited'), 20);

	await fixture.service.runSetupScriptWithAutoRun({
		workspaceId: WORKSPACE_ID,
	});

	assert.deepEqual(
		fixture.createCalls.map((call) => call.kind),
		['setup-script'],
	);
});

test('runSetupScriptWithAutoRun skips the run script when setup fails', async (t) => {
	const fixture = createServiceFixture(t, {
		autoRunAfterSetup: true,
		run: 'bun run dev',
		setup: 'bun install',
	});

	setTimeout(() => fixture.endSession('session-1', 'failed'), 20);

	await fixture.service.runSetupScriptWithAutoRun({
		workspaceId: WORKSPACE_ID,
	});

	assert.deepEqual(
		fixture.createCalls.map((call) => call.kind),
		['setup-script'],
	);
});

test('runSetupScriptWithAutoRun skips the run script when setup is stopped mid-flight', async (t) => {
	const fixture = createServiceFixture(t, {
		autoRunAfterSetup: true,
		run: 'bun run dev',
		setup: 'bun install',
	});

	// The user manually stops setup before it can exit cleanly.
	setTimeout(() => fixture.terminalService.kill('session-1'), 20);

	await fixture.service.runSetupScriptWithAutoRun({
		workspaceId: WORKSPACE_ID,
	});

	assert.deepEqual(
		fixture.createCalls.map((call) => call.kind),
		['setup-script'],
	);
	assert.deepEqual(fixture.killedIds, ['session-1']);
});

test('runSetupScriptIfNeeded runs setup when nothing is recorded yet', async (t) => {
	const { createCalls, service } = createServiceFixture(t, {
		setup: 'npm install',
	});

	const result = await service.runSetupScriptIfNeeded({
		workspaceId: WORKSPACE_ID,
	});

	assert.ok(result.session);
	assert.equal(result.session.kind, 'setup-script');
	assert.equal(createCalls.length, 1);
});

test('runSetupScriptIfNeeded skips a second run once setup is recorded', async (t) => {
	const fixture = createServiceFixture(t, { setup: 'npm install' });

	setTimeout(() => fixture.endSession('session-1', 'exited'), 20);
	await fixture.service.runSetupScriptWithAutoRun({
		workspaceId: WORKSPACE_ID,
	});
	assert.equal(fixture.createCalls.length, 1);

	const result = await fixture.service.runSetupScriptIfNeeded({
		workspaceId: WORKSPACE_ID,
	});

	assert.equal(result.session, null);
	assert.equal(result.diagnostics[0]?.code, 'setup-already-current');
	assert.equal(fixture.createCalls.length, 1);
});

test('runSetupScriptIfNeeded re-runs setup when the command changes', async (t) => {
	const database = createDatabaseFixture(t);
	const first = createTerminalServiceFake();
	const serviceA = createScriptLifecycleService({
		databaseService: createDatabaseServiceStub(database),
		settingsResolutionService: createSettingsStub({ setup: 'npm install' }),
		terminalService: first.terminalService,
	});

	setTimeout(() => first.endSession('session-1', 'exited'), 20);
	await serviceA.runSetupScriptWithAutoRun({ workspaceId: WORKSPACE_ID });

	const second = createTerminalServiceFake();
	const serviceB = createScriptLifecycleService({
		databaseService: createDatabaseServiceStub(database),
		settingsResolutionService: createSettingsStub({ setup: 'npm ci' }),
		terminalService: second.terminalService,
	});

	const result = await serviceB.runSetupScriptIfNeeded({
		workspaceId: WORKSPACE_ID,
	});

	assert.ok(result.session);
	assert.equal(second.createCalls.length, 1);
});

test('computeSetupFingerprint changes when the lockfile changes', (t) => {
	const worktreePath = mkdtempSync(path.join(tmpdir(), 'ensemblr-fp-'));
	t.after(() => rmSync(worktreePath, { force: true, recursive: true }));

	const command = 'npm install';
	const noLockfile = computeSetupFingerprint({ command, worktreePath });

	writeFileSync(
		path.join(worktreePath, 'package-lock.json'),
		'{"lockfileVersion":3,"packages":{}}',
	);
	const withLockfile = computeSetupFingerprint({ command, worktreePath });

	writeFileSync(
		path.join(worktreePath, 'package-lock.json'),
		'{"lockfileVersion":3,"packages":{"node_modules/left-pad":{}}}',
	);
	const changedLockfile = computeSetupFingerprint({ command, worktreePath });

	assert.notEqual(noLockfile, withLockfile);
	assert.notEqual(withLockfile, changedLockfile);
});

test('computeSetupFingerprint covers non-npm lockfiles', (t) => {
	const worktreePath = mkdtempSync(path.join(tmpdir(), 'ensemblr-fp-'));
	t.after(() => rmSync(worktreePath, { force: true, recursive: true }));

	const command = 'cargo build';
	const before = computeSetupFingerprint({ command, worktreePath });

	writeFileSync(
		path.join(worktreePath, 'Cargo.lock'),
		'[[package]]\nname = "serde"\nversion = "1.0.0"\n',
	);
	const withCargo = computeSetupFingerprint({ command, worktreePath });

	writeFileSync(
		path.join(worktreePath, 'Cargo.lock'),
		'[[package]]\nname = "serde"\nversion = "1.0.1"\n',
	);
	const changedCargo = computeSetupFingerprint({ command, worktreePath });

	assert.notEqual(before, withCargo);
	assert.notEqual(withCargo, changedCargo);
});

test('computeSetupFingerprint reflects every present lockfile', (t) => {
	const worktreePath = mkdtempSync(path.join(tmpdir(), 'ensemblr-fp-'));
	t.after(() => rmSync(worktreePath, { force: true, recursive: true }));

	const command = 'npm install';
	writeFileSync(path.join(worktreePath, 'package-lock.json'), '{"v":1}');
	const npmOnly = computeSetupFingerprint({ command, worktreePath });

	writeFileSync(
		path.join(worktreePath, 'go.sum'),
		'example.com/mod v1.0.0 h1:x=\n',
	);
	const npmPlusGo = computeSetupFingerprint({ command, worktreePath });

	assert.notEqual(npmOnly, npmPlusGo);
});

test('runSetupScriptIfNeeded reports database-unavailable without a connection', async () => {
	const fake = createTerminalServiceFake();
	const service = createScriptLifecycleService({
		databaseService: {
			getConnection: () => null,
		} as unknown as EnsemblrDatabaseService,
		settingsResolutionService: createSettingsStub({ setup: 'npm install' }),
		terminalService: fake.terminalService,
	});

	const result = await service.runSetupScriptIfNeeded({
		workspaceId: WORKSPACE_ID,
	});

	assert.equal(result.session, null);
	assert.equal(result.diagnostics[0]?.code, 'database-unavailable');
	assert.equal(fake.createCalls.length, 0);
});

test('runSetupScriptIfNeeded reports info when no setup script is configured', async (t) => {
	const { createCalls, service } = createServiceFixture(t, {});

	const result = await service.runSetupScriptIfNeeded({
		workspaceId: WORKSPACE_ID,
	});

	assert.equal(result.session, null);
	assert.equal(result.diagnostics[0]?.code, 'script-not-configured');
	assert.equal(result.diagnostics[0]?.severity, 'info');
	assert.equal(createCalls.length, 0);
});

test('runSetupScriptIfNeeded reports workspace-not-found for an unknown id', async (t) => {
	const { createCalls, service } = createServiceFixture(t, {
		setup: 'npm install',
	});

	const result = await service.runSetupScriptIfNeeded({
		workspaceId: 'missing',
	});

	assert.equal(result.session, null);
	assert.equal(result.diagnostics[0]?.code, 'workspace-not-found');
	assert.equal(createCalls.length, 0);
});
