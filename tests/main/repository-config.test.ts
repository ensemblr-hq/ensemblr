import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import {
	ENSEMBLR_CONFIG_SCHEMA_VERSION,
	type EnsemblrConfig,
} from '../../src/main/config/config-loader.ts';
import { resolveSettings } from '../../src/main/config/config-resolution.ts';
import { isRepositoryConfigPathAllowed } from '../../src/main/config/index.ts';
import { loadRepositoryConfig } from '../../src/main/config/repository-config.ts';
import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';
import type {
	RepositoryConfigSnapshot,
	SettingsResolutionGroupSnapshot,
	SettingsResolutionSource,
} from '../../src/shared/ipc/index.ts';

let settingCounter = 0;

function createConfig(overrides: Partial<EnsemblrConfig> = {}): EnsemblrConfig {
	return {
		app: {},
		environment: {},
		managed: {},
		repositoryDefaults: {},
		repositoryRules: [],
		schemaVersion: ENSEMBLR_CONFIG_SCHEMA_VERSION,
		security: {},
		ui: {},
		...overrides,
	};
}

function createRepositoryFixture(t: TestContext): {
	repositoryPath: string;
	write: (relativePath: string, source: string) => void;
} {
	const repositoryPath = mkdtempSync(path.join(tmpdir(), 'ensemblr-repo-'));

	t.after(() => {
		rmSync(repositoryPath, { force: true, recursive: true });
	});

	return {
		repositoryPath,
		write: (relativePath, source) => {
			const targetPath = path.join(repositoryPath, relativePath);
			mkdirSync(path.dirname(targetPath), { recursive: true });
			writeFileSync(targetPath, source);
		},
	};
}

function createDatabaseFixture(t: TestContext): DatabaseSync {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-repo-db-'));
	const connection = openEnsemblrDatabase({
		databasePath: path.join(directory, 'ensemblr-test.db'),
	});

	t.after(() => {
		connection.database.close();
		rmSync(directory, { force: true, recursive: true });
	});

	return connection.database;
}

function insertSetting({
	database,
	key,
	scopeId,
	valueJson,
}: {
	database: DatabaseSync;
	key: string;
	scopeId: string;
	valueJson: string;
}): void {
	settingCounter += 1;
	database
		.prepare(
			`INSERT INTO settings (id, scope, scope_id, key, value_json)
			 VALUES (?, 'repository', ?, ?, ?)`,
		)
		.run(`repo-setting-${settingCounter}`, scopeId, key, valueJson);
}

function getRepositorySetting(
	group: SettingsResolutionGroupSnapshot,
	key: string,
) {
	const setting = group.settings.find((candidate) => candidate.key === key);

	if (!setting) {
		assert.fail(`Expected resolved setting "${key}"`);
	}

	return setting;
}

function getSource(
	snapshot: RepositoryConfigSnapshot,
	source: SettingsResolutionSource,
) {
	const match = snapshot.sources.find(
		(candidate) => candidate.source === source,
	);

	if (!match) {
		assert.fail(`Expected repository config source "${source}"`);
	}

	return match;
}

test('parses .ensemblr/settings.toml repository settings into Ensemblr keys', (t) => {
	const fixture = createRepositoryFixture(t);
	fixture.write(
		'.ensemblr/settings.toml',
		`
enterprise_data_privacy = true
file_include_globs = [".env.local", "config/*.json"]
claude_executable_path = "/opt/homebrew/bin/claude"

[scripts]
setup = "bun install"
run = "bun run dev"
archive = "bun run archive"
run_mode = "nonconcurrent"

[prompts]
review = "Check repository contracts."

[git]
branch_prefix = "ensemblr/"

[environment_variables]
DEBUG = "ensemblr:*"

[spotlight_testing]
enabled = true
`,
	);

	const loaded = loadRepositoryConfig({
		repositoryPath: fixture.repositoryPath,
	});
	const source = getSource(loaded.snapshot, 'ensemblr-config');

	assert.equal(source.status, 'loaded');
	assert.deepEqual(source.settings, {
		claudeExecutablePath: '/opt/homebrew/bin/claude',
		enterpriseDataPrivacy: true,
		environmentVariables: { DEBUG: 'ensemblr:*' },
		filesToCopy: ['.env.local', 'config/*.json'],
		git: { branch_prefix: 'ensemblr/' },
		prompts: { review: 'Check repository contracts.' },
		runScriptMode: 'nonconcurrent',
		scripts: {
			archive: 'bun run archive',
			run: 'bun run dev',
			setup: 'bun install',
		},
		spotlightTesting: { enabled: true },
	});
	assert.deepEqual(loaded.snapshot.diagnostics, []);
});

test('.ensemblr/settings.toml overrides personal SQLite per-key', (t) => {
	const fixture = createRepositoryFixture(t);
	const database = createDatabaseFixture(t);
	fixture.write(
		'.ensemblr/settings.toml',
		'[scripts]\nrun = "bun run committed"\n',
	);
	insertSetting({
		database,
		key: 'scripts.run',
		scopeId: 'repo-1',
		valueJson: JSON.stringify('bun run personal'),
	});

	const snapshot = resolveSettings({
		config: createConfig(),
		database,
		repository: {
			repositoryId: 'repo-1',
			repositoryPath: fixture.repositoryPath,
		},
	});

	assert.ok(snapshot.repository);
	assert.deepEqual(
		{
			source: getRepositorySetting(snapshot.repository, 'scripts.run').source,
			value: getRepositorySetting(snapshot.repository, 'scripts.run').value,
		},
		{ source: 'ensemblr-config', value: 'bun run committed' },
	);
});

test('personal SQLite fills keys .ensemblr/settings.toml omits', (t) => {
	const fixture = createRepositoryFixture(t);
	const database = createDatabaseFixture(t);
	fixture.write(
		'.ensemblr/settings.toml',
		'[scripts]\nrun = "bun run committed"\n',
	);
	insertSetting({
		database,
		key: 'scripts.setup',
		scopeId: 'repo-1',
		valueJson: JSON.stringify('bun install personal'),
	});

	const snapshot = resolveSettings({
		config: createConfig(),
		database,
		repository: {
			repositoryId: 'repo-1',
			repositoryPath: fixture.repositoryPath,
		},
	});

	assert.ok(snapshot.repository);
	assert.deepEqual(
		{
			run: getRepositorySetting(snapshot.repository, 'scripts.run').source,
			setup: getRepositorySetting(snapshot.repository, 'scripts.setup').source,
			setupValue: getRepositorySetting(snapshot.repository, 'scripts.setup')
				.value,
		},
		{
			run: 'ensemblr-config',
			setup: 'sqlite',
			setupValue: 'bun install personal',
		},
	);
});

test('legacy conductor.json / ensemblr.json on disk are ignored', (t) => {
	const fixture = createRepositoryFixture(t);
	fixture.write(
		'conductor.json',
		JSON.stringify({ scripts: { run: 'legacy' } }),
	);
	fixture.write(
		'ensemblr.json',
		JSON.stringify({ scripts: { run: 'old-native' } }),
	);
	fixture.write(
		'.conductor/settings.toml',
		'[scripts]\nrun = "bun run conductor"\n',
	);

	const loaded = loadRepositoryConfig({
		repositoryPath: fixture.repositoryPath,
	});
	const snapshot = resolveSettings({
		config: createConfig(),
		repository: {
			repositoryId: 'repo-1',
			repositoryPath: fixture.repositoryPath,
		},
	});

	// Only worktreeinclude + ensemblr-config sources are inspected; the old
	// files are never read.
	assert.deepEqual(
		loaded.snapshot.sources.map((source) => source.source).sort(),
		['ensemblr-config', 'worktreeinclude'],
	);
	assert.ok(snapshot.repository);
	assert.deepEqual(
		{
			source: getRepositorySetting(snapshot.repository, 'scripts.run').source,
			value: getRepositorySetting(snapshot.repository, 'scripts.run').value,
		},
		{ source: 'built-in-default', value: null },
	);
});

test('repository config path authorization allows only known repositories and workspaces', (t) => {
	const fixture = createRepositoryFixture(t);
	const database = createDatabaseFixture(t);
	const workspacePath = path.join(fixture.repositoryPath, 'workspace-a');

	database
		.prepare(
			`INSERT INTO repositories (id, slug, name, path, default_branch)
			 VALUES ('repo-1', 'ensemblr', 'Ensemblr', ?, 'master')`,
		)
		.run(fixture.repositoryPath);
	database
		.prepare(
			`INSERT INTO workspaces (id, repository_id, slug, name, path)
			 VALUES ('workspace-1', 'repo-1', 'workspace-a', 'Workspace A', ?)`,
		)
		.run(workspacePath);

	assert.equal(
		isRepositoryConfigPathAllowed({
			database,
			repositoryPath: fixture.repositoryPath,
		}),
		true,
	);
	assert.equal(
		isRepositoryConfigPathAllowed({
			database,
			repositoryPath: workspacePath,
		}),
		true,
	);
	assert.equal(
		isRepositoryConfigPathAllowed({
			database,
			repositoryPath: path.dirname(fixture.repositoryPath),
		}),
		false,
	);
	assert.equal(
		isRepositoryConfigPathAllowed({
			database: null,
			repositoryPath: fixture.repositoryPath,
		}),
		false,
	);
});

test('unsupported .ensemblr/settings.toml fields are diagnostic-only', (t) => {
	const fixture = createRepositoryFixture(t);
	fixture.write(
		'.ensemblr/settings.toml',
		'unsupported_field = true\n[scripts]\nrun = "bun run dev"\n',
	);

	const loaded = loadRepositoryConfig({
		repositoryPath: fixture.repositoryPath,
	});
	const snapshot = resolveSettings({
		config: createConfig(),
		repository: {
			repositoryId: 'repo-1',
			repositoryPath: fixture.repositoryPath,
		},
	});

	assert.equal(
		loaded.snapshot.diagnostics.some(
			(diagnostic) => diagnostic.code === 'unsupported-repository-config-field',
		),
		true,
	);
	assert.ok(snapshot.repository);
	assert.deepEqual(
		{
			source: getRepositorySetting(snapshot.repository, 'scripts.run').source,
			value: getRepositorySetting(snapshot.repository, 'scripts.run').value,
		},
		{ source: 'ensemblr-config', value: 'bun run dev' },
	);
});

test('invalid .ensemblr/settings.toml falls back to built-in defaults', (t) => {
	const fixture = createRepositoryFixture(t);
	fixture.write('.ensemblr/settings.toml', '[scripts]\nrun = ');

	const loaded = loadRepositoryConfig({
		repositoryPath: fixture.repositoryPath,
	});
	const snapshot = resolveSettings({
		config: createConfig(),
		repository: {
			repositoryId: 'repo-1',
			repositoryPath: fixture.repositoryPath,
		},
	});

	assert.equal(
		loaded.snapshot.diagnostics.some(
			(diagnostic) => diagnostic.code === 'invalid-repository-toml',
		),
		true,
	);
	assert.ok(snapshot.repository);
	assert.deepEqual(
		{
			source: getRepositorySetting(snapshot.repository, 'scripts.run').source,
			value: getRepositorySetting(snapshot.repository, 'scripts.run').value,
		},
		{ source: 'built-in-default', value: null },
	);
});

test('.worktreeinclude filesToCopy wins over SQLite repository settings', (t) => {
	const fixture = createRepositoryFixture(t);
	const database = createDatabaseFixture(t);
	fixture.write(
		'.worktreeinclude',
		'# copied files\n.env.local\n\\#literal-file\n',
	);
	insertSetting({
		database,
		key: 'filesToCopy',
		scopeId: 'repo-1',
		valueJson: JSON.stringify(['sqlite.env']),
	});

	const snapshot = resolveSettings({
		config: createConfig(),
		database,
		repository: {
			repositoryId: 'repo-1',
			repositoryPath: fixture.repositoryPath,
		},
	});

	assert.ok(snapshot.repository);
	assert.deepEqual(
		{
			source: getRepositorySetting(snapshot.repository, 'filesToCopy').source,
			value: getRepositorySetting(snapshot.repository, 'filesToCopy').value,
		},
		{ source: 'worktreeinclude', value: ['.env.local', '#literal-file'] },
	);
});
