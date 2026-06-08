import assert from 'node:assert/strict';
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';

import {
	type LoadedRepositoryConfig,
	loadRepositoryConfig,
} from '../../src/main/config/repository-config.ts';
import type {
	GitRepositoryProbe,
	GitRepositoryProbeFn,
} from '../../src/main/repository/git-probe.ts';
import {
	createLocalRepositoryRegistrationService,
	registerLocalRepository,
} from '../../src/main/repository/register-repository.ts';
import {
	createEnsembleDatabaseService,
	openEnsembleDatabase,
} from '../../src/main/storage/database.ts';

function createFixtureDirectory(t: TestContext): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemble-repo-fixture-'));

	t.after(() => {
		try {
			chmodSync(directory, 0o700);
		} catch {
			// Ignore chmod failures on cleanup; rmSync still attempts removal.
		}
		rmSync(directory, { force: true, recursive: true });
	});

	return directory;
}

function createDatabaseFixture(t: TestContext): DatabaseSync {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemble-repo-db-'));
	const connection = openEnsembleDatabase({
		databasePath: path.join(directory, 'ensemble-test.db'),
	});

	t.after(() => {
		connection.database.close();
		rmSync(directory, { force: true, recursive: true });
	});

	return connection.database;
}

function gitProbeStub(
	overrides: Partial<GitRepositoryProbe> & {
		isGitRepository: boolean;
	},
): GitRepositoryProbeFn {
	return async (repositoryPath) => ({
		defaultBranch: null,
		remoteUrl: null,
		topLevel: overrides.isGitRepository ? path.resolve(repositoryPath) : null,
		...overrides,
	});
}

const fixedNow = () => new Date('2026-06-07T12:00:00.000Z');

test('registers a valid git repository and writes an absolute path', async (t) => {
	const directory = createFixtureDirectory(t);
	const database = createDatabaseFixture(t);

	const result = await registerLocalRepository({
		database,
		gitProbe: gitProbeStub({
			defaultBranch: 'master',
			isGitRepository: true,
			remoteUrl: 'git@github.com:psoldunov/ensemble.git',
			topLevel: directory,
		}),
		loadConfig: loadRepositoryConfig,
		now: fixedNow,
		request: { path: directory },
	});

	assert.equal(result.registered, true);
	assert.equal(result.diagnostics.length, 0);
	assert.ok(result.repository);
	assert.equal(result.repository?.path, path.resolve(directory));
	assert.equal(result.repository?.defaultBranch, 'master');
	assert.equal(
		result.repository?.remoteUrl,
		'git@github.com:psoldunov/ensemble.git',
	);
	assert.equal(result.repository?.name, path.basename(directory));
	assert.equal(result.repository?.createdAt, '2026-06-07T12:00:00.000Z');

	const rawRow = database
		.prepare(
			'SELECT id, path, default_branch AS defaultBranch, metadata_json AS metadataJson FROM repositories WHERE path = ?',
		)
		.get(path.resolve(directory));
	assert.ok(
		typeof rawRow === 'object' && rawRow !== null,
		'expected a repositories row',
	);
	const row = rawRow as Record<string, unknown>;
	assert.equal(typeof row.id, 'string');
	assert.equal(typeof row.path, 'string');
	assert.equal(typeof row.metadataJson, 'string');
	assert.ok(
		row.defaultBranch === null || typeof row.defaultBranch === 'string',
		'defaultBranch must be string|null',
	);

	assert.equal(row.path, path.resolve(directory));
	assert.equal(row.defaultBranch, 'master');
	const metadata = JSON.parse(row.metadataJson as string) as Record<
		string,
		unknown
	>;
	assert.equal(metadata.adoptionMode, 'adopt-in-place');
	assert.equal(metadata.remoteUrl, 'git@github.com:psoldunov/ensemble.git');
	assert.equal(metadata.registeredAt, '2026-06-07T12:00:00.000Z');
	assert.ok(Array.isArray(metadata.settingsSources));
});

test('rejects a non-git directory without modifying SQLite', async (t) => {
	const directory = createFixtureDirectory(t);
	const database = createDatabaseFixture(t);

	const result = await registerLocalRepository({
		database,
		gitProbe: gitProbeStub({
			error: 'not a git repository',
			isGitRepository: false,
		}),
		loadConfig: loadRepositoryConfig,
		now: fixedNow,
		request: { path: directory },
	});

	assert.equal(result.registered, false);
	assert.equal(result.repository, null);
	assert.equal(
		result.diagnostics.some(
			(diagnostic) => diagnostic.code === 'path-not-a-git-repository',
		),
		true,
	);

	const rowCount = database
		.prepare('SELECT COUNT(*) AS count FROM repositories')
		.get() as { count: number };
	assert.equal(rowCount.count, 0);
});

test('rejects empty, relative, and non-existent paths', async (t) => {
	const database = createDatabaseFixture(t);

	const empty = await registerLocalRepository({
		database,
		gitProbe: gitProbeStub({ isGitRepository: true }),
		loadConfig: loadRepositoryConfig,
		now: fixedNow,
		request: { path: '   ' },
	});
	assert.equal(empty.registered, false);
	assert.equal(empty.diagnostics[0]?.code, 'repository-path-missing');

	const relative = await registerLocalRepository({
		database,
		gitProbe: gitProbeStub({ isGitRepository: true }),
		loadConfig: loadRepositoryConfig,
		now: fixedNow,
		request: { path: 'relative/path' },
	});
	assert.equal(relative.registered, false);
	assert.equal(relative.diagnostics[0]?.code, 'repository-path-relative');

	const missing = await registerLocalRepository({
		database,
		gitProbe: gitProbeStub({ isGitRepository: true }),
		loadConfig: loadRepositoryConfig,
		now: fixedNow,
		request: {
			path: path.join(tmpdir(), 'ensemble-missing-fixture-does-not-exist'),
		},
	});
	assert.equal(missing.registered, false);
	assert.equal(missing.diagnostics[0]?.code, 'repository-path-unreadable');
});

test('rejects a duplicate registration with a clear diagnostic', async (t) => {
	const directory = createFixtureDirectory(t);
	const database = createDatabaseFixture(t);
	const probe = gitProbeStub({
		defaultBranch: null,
		isGitRepository: true,
		topLevel: directory,
	});

	const first = await registerLocalRepository({
		database,
		gitProbe: probe,
		loadConfig: loadRepositoryConfig,
		now: fixedNow,
		request: { path: directory },
	});
	assert.equal(first.registered, true);

	const second = await registerLocalRepository({
		database,
		gitProbe: probe,
		loadConfig: loadRepositoryConfig,
		now: fixedNow,
		request: { path: directory },
	});
	assert.equal(second.registered, false);
	assert.equal(second.diagnostics[0]?.code, 'repository-already-registered');
});

test('honours an explicit name override so folder suffixes do not leak into the row', async (t) => {
	const directory = mkdtempSync(
		path.join(tmpdir(), 'ensemble-repo-fixture-suffix-'),
	);
	t.after(() => {
		rmSync(directory, { force: true, recursive: true });
	});
	const suffixed = path.join(directory, 'haartz-next-2');
	mkdirSync(suffixed);
	const database = createDatabaseFixture(t);

	const result = await registerLocalRepository({
		database,
		gitProbe: gitProbeStub({
			defaultBranch: 'main',
			isGitRepository: true,
			remoteUrl: 'git@github.com:psoldunov/haartz-next.git',
			topLevel: suffixed,
		}),
		loadConfig: loadRepositoryConfig,
		now: fixedNow,
		request: { name: 'haartz-next', path: suffixed },
	});

	assert.equal(result.registered, true);
	assert.equal(result.repository?.name, 'haartz-next');
	assert.equal(result.repository?.slug, 'haartz-next');
	assert.equal(result.repository?.path, suffixed);
});

test('rejects a re-add when another repository tracks the same remote URL', async (t) => {
	const first = createFixtureDirectory(t);
	const second = createFixtureDirectory(t);
	const database = createDatabaseFixture(t);

	const initial = await registerLocalRepository({
		database,
		gitProbe: gitProbeStub({
			isGitRepository: true,
			remoteUrl: 'https://github.com/psoldunov/haartz-next.git',
			topLevel: first,
		}),
		loadConfig: loadRepositoryConfig,
		now: fixedNow,
		request: { path: first },
	});
	assert.equal(initial.registered, true);

	const reAdd = await registerLocalRepository({
		database,
		gitProbe: gitProbeStub({
			isGitRepository: true,
			// Equivalent SSH form of the same upstream — should still collide.
			remoteUrl: 'git@github.com:psoldunov/haartz-next',
			topLevel: second,
		}),
		loadConfig: loadRepositoryConfig,
		now: fixedNow,
		request: { path: second },
	});
	assert.equal(reAdd.registered, false);
	assert.equal(
		reAdd.diagnostics[0]?.code,
		'repository-remote-already-registered',
	);
});

test('captures settings-source diagnostics in metadata_json', async (t) => {
	const directory = createFixtureDirectory(t);
	const database = createDatabaseFixture(t);

	const conductorDirectory = path.join(directory, '.conductor');
	mkdirSync(conductorDirectory, { recursive: true });
	writeFileSync(
		path.join(conductorDirectory, 'settings.toml'),
		'[scripts]\nrun = "bun run dev"\n',
	);
	writeFileSync(
		path.join(directory, 'ensemble.json'),
		JSON.stringify({ scripts: { run: 'bun run ensemble' } }),
	);

	const result = await registerLocalRepository({
		database,
		gitProbe: gitProbeStub({
			defaultBranch: 'master',
			isGitRepository: true,
			topLevel: directory,
		}),
		loadConfig: (options) =>
			loadRepositoryConfig(options) as LoadedRepositoryConfig,
		now: fixedNow,
		request: { path: directory },
	});

	assert.equal(result.registered, true);
	const sources = result.settingsSources.map((source) => source.source);
	assert.equal(sources.includes('ensemble-config'), true);
	assert.equal(sources.includes('conductor-config'), true);
});

test('createLocalRepositoryRegistrationService wires the database service', async (t) => {
	const directory = createFixtureDirectory(t);
	const databaseDirectory = mkdtempSync(
		path.join(tmpdir(), 'ensemble-repo-svc-'),
	);

	t.after(() => {
		rmSync(databaseDirectory, { force: true, recursive: true });
	});

	const databaseService = createEnsembleDatabaseService({
		databasePath: path.join(databaseDirectory, 'ensemble-test.db'),
	});
	t.after(databaseService.close);
	databaseService.open();

	const service = createLocalRepositoryRegistrationService({
		databaseService,
		gitProbe: gitProbeStub({
			defaultBranch: 'main',
			isGitRepository: true,
			remoteUrl: null,
			topLevel: directory,
		}),
		now: fixedNow,
	});

	const result = await service.register({ path: directory });
	assert.equal(result.registered, true);
	assert.equal(result.repository?.defaultBranch, 'main');
});
