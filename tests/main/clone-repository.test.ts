import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import {
	type CloneCommandRunner,
	createGithubCloneService,
} from '../../src/main/repository/clone-repository.ts';
import type { LocalRepositoryRegistrationService } from '../../src/main/repository/register-repository.ts';
import type { EnsembleDatabaseService } from '../../src/main/storage/database.ts';
import { buildRegistrationStub } from './helpers/registration-stub.ts';
import { buildRootDirectoryStub } from './helpers/root-directory-stub.ts';

function createWorkspace(t: TestContext): {
	parentPath: string;
	repositoriesPath: string;
} {
	const root = mkdtempSync(path.join(tmpdir(), 'ensemble-clone-fixture-'));
	const repositoriesPath = path.join(root, 'repos');
	mkdirSync(repositoriesPath, { recursive: true });

	t.after(() => {
		rmSync(root, { force: true, recursive: true });
	});

	return { parentPath: root, repositoriesPath };
}

const rootDirectoryStub = (repositoriesPath: string) =>
	buildRootDirectoryStub({ repositoriesPath });

const registrationStub = (repositoryPath: string) =>
	buildRegistrationStub(repositoryPath);

function failingRegistrationStub(): LocalRepositoryRegistrationService {
	return {
		register: async () => ({
			diagnostics: [
				{
					code: 'path-not-a-git-repository',
					message: 'Not a git repo.',
					severity: 'error',
				},
			],
			registered: false,
			repository: null,
			settingsSources: [],
		}),
	};
}

const fixedNow = () => new Date('2026-06-07T12:00:00.000Z');

/** Stub that reports no SQLite connection — clone tests do not need the dup check. */
function databaseServiceStub(): EnsembleDatabaseService {
	const snapshot = {
		path: ':memory:',
		schemaVersion: 0,
		status: 'ok' as const,
	};
	return {
		close: () => undefined,
		getConnection: () => null,
		getHealth: () => snapshot,
		open: () => snapshot,
	};
}

test('prepare validates an https GitHub URL and resolves the default target', async (t) => {
	const { repositoriesPath } = createWorkspace(t);
	const service = createGithubCloneService({
		commandRunner: async () => ({ exitCode: 0, signal: null }),
		databaseService: databaseServiceStub(),
		now: fixedNow,
		registrationService: registrationStub(
			path.join(repositoriesPath, 'ensemble'),
		).service,
		rootDirectoryService: rootDirectoryStub(repositoriesPath),
	});

	const result = await service.prepare({
		url: 'https://github.com/psoldunov/ensemble.git',
	});

	assert.equal(result.ok, true);
	if (!result.ok) {
		throw new Error('expected ok preparation');
	}
	assert.equal(result.preparation.repositoryName, 'ensemble');
	assert.equal(
		result.preparation.sanitizedUrl,
		'https://github.com/psoldunov/ensemble.git',
	);
	assert.equal(result.preparation.validatedUrl, 'psoldunov/ensemble');
	assert.equal(
		result.preparation.targetPath,
		path.join(repositoriesPath, 'ensemble'),
	);
});

test('prepare accepts ssh and shorthand URL forms', async (t) => {
	const { repositoriesPath } = createWorkspace(t);
	const service = createGithubCloneService({
		commandRunner: async () => ({ exitCode: 0, signal: null }),
		databaseService: databaseServiceStub(),
		now: fixedNow,
		registrationService: registrationStub(
			path.join(repositoriesPath, 'ensemble'),
		).service,
		rootDirectoryService: rootDirectoryStub(repositoriesPath),
	});

	const ssh = await service.prepare({
		url: 'git@github.com:psoldunov/ensemble.git',
	});
	assert.equal(ssh.ok, true);
	if (ssh.ok) {
		assert.equal(ssh.preparation.validatedUrl, 'psoldunov/ensemble');
	}

	const shorthand = await service.prepare({ url: 'psoldunov/ensemble' });
	assert.equal(shorthand.ok, true);
	if (shorthand.ok) {
		assert.equal(shorthand.preparation.repositoryName, 'ensemble');
	}
});

test('prepare rejects empty, malformed, and non-GitHub URLs', async (t) => {
	const { repositoriesPath } = createWorkspace(t);
	const service = createGithubCloneService({
		commandRunner: async () => ({ exitCode: 0, signal: null }),
		databaseService: databaseServiceStub(),
		now: fixedNow,
		registrationService: registrationStub(
			path.join(repositoriesPath, 'ensemble'),
		).service,
		rootDirectoryService: rootDirectoryStub(repositoriesPath),
	});

	const empty = await service.prepare({ url: '' });
	assert.equal(empty.ok, false);
	assert.equal(empty.diagnostics[0]?.code, 'url-required');

	const garbage = await service.prepare({ url: 'not a url' });
	assert.equal(garbage.ok, false);
	assert.equal(garbage.diagnostics[0]?.code, 'url-invalid');

	const otherHost = await service.prepare({
		url: 'https://gitlab.com/foo/bar.git',
	});
	assert.equal(otherHost.ok, false);
	assert.equal(otherHost.diagnostics[0]?.code, 'url-invalid');
});

test('prepare rejects a relative destination override', async (t) => {
	const { repositoriesPath } = createWorkspace(t);
	const service = createGithubCloneService({
		commandRunner: async () => ({ exitCode: 0, signal: null }),
		databaseService: databaseServiceStub(),
		now: fixedNow,
		registrationService: registrationStub(
			path.join(repositoriesPath, 'ensemble'),
		).service,
		rootDirectoryService: rootDirectoryStub(repositoriesPath),
	});

	const result = await service.prepare({
		destinationPath: 'relative/path',
		url: 'https://github.com/psoldunov/ensemble.git',
	});

	assert.equal(result.ok, false);
	assert.equal(result.diagnostics[0]?.code, 'destination-path-relative');
});

test('prepare auto-suffixes the target when the default path is already on disk', async (t) => {
	const { repositoriesPath } = createWorkspace(t);
	const existing = path.join(repositoriesPath, 'ensemble');
	mkdirSync(existing, { recursive: true });

	const service = createGithubCloneService({
		commandRunner: async () => ({ exitCode: 0, signal: null }),
		databaseService: databaseServiceStub(),
		now: fixedNow,
		registrationService: registrationStub(existing).service,
		rootDirectoryService: rootDirectoryStub(repositoriesPath),
	});

	const result = await service.prepare({
		url: 'https://github.com/psoldunov/ensemble.git',
	});

	assert.equal(result.ok, true);
	assert.equal(
		result.preparation?.targetPath,
		path.join(repositoriesPath, 'ensemble-2'),
	);
});

test('prepare rejects the clone when another repository already tracks the remote', async (t) => {
	const { repositoriesPath } = createWorkspace(t);
	// Real in-memory DB with one pre-existing repo whose remote matches.
	const { openEnsembleDatabase } = await import(
		'../../src/main/storage/database.ts'
	);
	const connection = openEnsembleDatabase({ databasePath: ':memory:' });
	t.after(() => connection.database.close());
	connection.database
		.prepare(
			`INSERT INTO repositories (id, slug, name, path, default_branch, created_at, updated_at, metadata_json)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			'repository-existing',
			'ensemble',
			'ensemble',
			path.join(repositoriesPath, 'ensemble'),
			'main',
			fixedNow().toISOString(),
			fixedNow().toISOString(),
			JSON.stringify({
				remoteUrl: 'git@github.com:psoldunov/ensemble.git',
			}),
		);

	const databaseService: EnsembleDatabaseService = {
		close: () => connection.database.close(),
		getConnection: () => connection,
		getHealth: () => ({
			path: connection.path,
			schemaVersion: connection.schemaVersion,
			status: 'ok',
		}),
		open: () => ({
			path: connection.path,
			schemaVersion: connection.schemaVersion,
			status: 'ok',
		}),
	};

	const service = createGithubCloneService({
		commandRunner: async () => ({ exitCode: 0, signal: null }),
		databaseService,
		now: fixedNow,
		registrationService: registrationStub(
			path.join(repositoriesPath, 'ensemble'),
		).service,
		rootDirectoryService: rootDirectoryStub(repositoriesPath),
	});

	const result = await service.prepare({
		// HTTPS form of the existing SSH remote — pre-flight should still match.
		url: 'https://github.com/psoldunov/ensemble.git',
	});

	assert.equal(result.ok, false);
	assert.equal(result.diagnostics[0]?.code, 'remote-already-registered');
});

test('start refuses an unknown jobId', async (t) => {
	const { repositoriesPath } = createWorkspace(t);
	const service = createGithubCloneService({
		commandRunner: async () => ({ exitCode: 0, signal: null }),
		databaseService: databaseServiceStub(),
		now: fixedNow,
		registrationService: registrationStub(
			path.join(repositoriesPath, 'ensemble'),
		).service,
		rootDirectoryService: rootDirectoryStub(repositoriesPath),
	});

	const result = await service.start({ jobId: 'clone-missing' });
	assert.equal(result.status, 'failure');
	assert.equal(result.diagnostics[0]?.code, 'job-unknown');
});

test('start spawns gh, streams progress, and registers on success', async (t) => {
	const { repositoriesPath } = createWorkspace(t);
	const target = path.join(repositoriesPath, 'ensemble');
	const registration = registrationStub(target);
	const events: string[] = [];

	const runner: CloneCommandRunner = async ({ command }, { onStderr }) => {
		assert.equal(command, 'gh');
		onStderr(
			"Cloning into 'ensemble'...\nReceiving objects: 100% (50/50), done.\n",
		);
		// Materialise the cloned directory so the registration stub sees it.
		mkdirSync(target, { recursive: true });
		writeFileSync(path.join(target, 'README.md'), '# test\n');
		return { exitCode: 0, signal: null };
	};

	const service = createGithubCloneService({
		commandRunner: runner,
		databaseService: databaseServiceStub(),
		now: fixedNow,
		registrationService: registration.service,
		rootDirectoryService: rootDirectoryStub(repositoriesPath),
	});

	const preparation = await service.prepare({
		url: 'https://github.com/psoldunov/ensemble.git',
	});
	assert.equal(preparation.ok, true);
	if (!preparation.ok) {
		throw new Error('expected ok preparation');
	}

	const result = await service.start(
		{ jobId: preparation.preparation.jobId },
		{
			onProgress: (event) => {
				events.push(`${event.kind}:${event.text}`);
			},
		},
	);

	assert.equal(result.status, 'success');
	assert.ok(result.repository);
	assert.equal(result.repository?.path, target);
	assert.equal(registration.calls.length, 1);
	assert.equal(registration.calls[0]?.path, target);
	assert.ok(events.some((line) => line.includes('Cloning into')));
	assert.ok(events.some((line) => line.startsWith('status:')));
});

test('start classifies an authentication failure', async (t) => {
	const { repositoriesPath } = createWorkspace(t);
	const runner: CloneCommandRunner = async (_, { onStderr }) => {
		onStderr(
			'fatal: Authentication failed for https://github.com/foo/bar.git\n',
		);
		return { exitCode: 128, signal: null };
	};

	const service = createGithubCloneService({
		commandRunner: runner,
		databaseService: databaseServiceStub(),
		now: fixedNow,
		registrationService: registrationStub(
			path.join(repositoriesPath, 'ensemble'),
		).service,
		rootDirectoryService: rootDirectoryStub(repositoriesPath),
	});

	const preparation = await service.prepare({
		url: 'https://github.com/foo/bar.git',
	});
	assert.equal(preparation.ok, true);
	if (!preparation.ok) {
		throw new Error('expected ok preparation');
	}

	const result = await service.start({
		jobId: preparation.preparation.jobId,
	});

	assert.equal(result.status, 'failure');
	assert.equal(result.diagnostics[0]?.code, 'auth');
});

test('start falls back to git when gh is not installed', async (t) => {
	const { repositoriesPath } = createWorkspace(t);
	const target = path.join(repositoriesPath, 'ensemble');
	const registration = registrationStub(target);
	const observed: string[] = [];

	const runner: CloneCommandRunner = async ({ command }, _) => {
		observed.push(command);
		if (command === 'gh') {
			return {
				exitCode: null,
				failure: 'command-not-found',
				failureMessage: 'gh not found',
				signal: null,
			};
		}
		mkdirSync(target, { recursive: true });
		return { exitCode: 0, signal: null };
	};

	const service = createGithubCloneService({
		commandRunner: runner,
		databaseService: databaseServiceStub(),
		now: fixedNow,
		registrationService: registration.service,
		rootDirectoryService: rootDirectoryStub(repositoriesPath),
	});

	const preparation = await service.prepare({
		url: 'https://github.com/psoldunov/ensemble.git',
	});
	assert.equal(preparation.ok, true);
	if (!preparation.ok) {
		throw new Error('expected ok preparation');
	}

	const result = await service.start({
		jobId: preparation.preparation.jobId,
	});

	assert.deepEqual(observed, ['gh', 'git']);
	assert.equal(result.status, 'success');
});

test('start reports git-not-installed when both binaries are missing', async (t) => {
	const { repositoriesPath } = createWorkspace(t);
	const runner: CloneCommandRunner = async () => ({
		exitCode: null,
		failure: 'command-not-found',
		failureMessage: 'missing',
		signal: null,
	});

	const service = createGithubCloneService({
		commandRunner: runner,
		databaseService: databaseServiceStub(),
		now: fixedNow,
		registrationService: registrationStub(
			path.join(repositoriesPath, 'ensemble'),
		).service,
		rootDirectoryService: rootDirectoryStub(repositoriesPath),
	});

	const preparation = await service.prepare({
		url: 'https://github.com/psoldunov/ensemble.git',
	});
	assert.equal(preparation.ok, true);
	if (!preparation.ok) {
		throw new Error('expected ok preparation');
	}

	const result = await service.start({
		jobId: preparation.preparation.jobId,
	});

	assert.equal(result.status, 'failure');
	assert.equal(result.diagnostics[0]?.code, 'git-not-installed');
});

test('start surfaces register-failed when registration rejects the cloned repo', async (t) => {
	const { repositoriesPath } = createWorkspace(t);
	const target = path.join(repositoriesPath, 'ensemble');

	const runner: CloneCommandRunner = async () => {
		mkdirSync(target, { recursive: true });
		return { exitCode: 0, signal: null };
	};

	const service = createGithubCloneService({
		commandRunner: runner,
		databaseService: databaseServiceStub(),
		now: fixedNow,
		registrationService: failingRegistrationStub(),
		rootDirectoryService: rootDirectoryStub(repositoriesPath),
	});

	const preparation = await service.prepare({
		url: 'https://github.com/psoldunov/ensemble.git',
	});
	assert.equal(preparation.ok, true);
	if (!preparation.ok) {
		throw new Error('expected ok preparation');
	}

	const result = await service.start({
		jobId: preparation.preparation.jobId,
	});

	assert.equal(result.status, 'failure');
	assert.equal(result.diagnostics[0]?.code, 'register-failed');
});
