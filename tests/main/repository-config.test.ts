import assert from 'node:assert/strict';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import {
	ENSEMBLE_CONFIG_SCHEMA_VERSION,
	type EnsembleConfig,
} from '../../src/main/config/config-loader.ts';
import { resolveSettings } from '../../src/main/config/config-resolution.ts';
import {
	isRepositoryConfigPathAllowed,
	loadRepositoryConfig,
} from '../../src/main/config/repository-config.ts';
import {
	applyRepositoryConfigMigration,
	previewRepositoryConfigMigration,
} from '../../src/main/config/repository-config-migration.ts';
import { openEnsembleDatabase } from '../../src/main/storage/database.ts';
import type {
	RepositoryConfigSnapshot,
	SettingsResolutionGroupSnapshot,
	SettingsResolutionSource,
} from '../../src/shared/ipc.ts';

let settingCounter = 0;

function createConfig(overrides: Partial<EnsembleConfig> = {}): EnsembleConfig {
	return {
		app: {},
		environment: {},
		managed: {},
		repositoryDefaults: {},
		repositoryRules: [],
		schemaVersion: ENSEMBLE_CONFIG_SCHEMA_VERSION,
		security: {},
		ui: {},
		...overrides,
	};
}

function createRepositoryFixture(t: TestContext): {
	readJson: (relativePath: string) => Record<string, unknown>;
	repositoryPath: string;
	write: (relativePath: string, source: string) => void;
} {
	const repositoryPath = mkdtempSync(path.join(tmpdir(), 'ensemble-repo-'));

	t.after(() => {
		rmSync(repositoryPath, { force: true, recursive: true });
	});

	return {
		readJson: (relativePath) =>
			JSON.parse(
				readFileSync(path.join(repositoryPath, relativePath), 'utf8'),
			) as Record<string, unknown>,
		repositoryPath,
		write: (relativePath, source) => {
			const targetPath = path.join(repositoryPath, relativePath);
			mkdirSync(path.dirname(targetPath), { recursive: true });
			writeFileSync(targetPath, source);
		},
	};
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

test('parses Conductor TOML repository settings into Ensemble keys', (t) => {
	const fixture = createRepositoryFixture(t);
	fixture.write(
		'.conductor/settings.toml',
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
branch_prefix = "ensemble/"

[environment_variables]
DEBUG = "ensemble:*"

[spotlight_testing]
enabled = true
`,
	);

	const loaded = loadRepositoryConfig({
		repositoryPath: fixture.repositoryPath,
	});
	const source = getSource(loaded.snapshot, 'conductor-config');

	assert.equal(source.status, 'loaded');
	assert.deepEqual(source.settings, {
		claudeExecutablePath: '/opt/homebrew/bin/claude',
		conductorCompatibility: true,
		enterpriseDataPrivacy: true,
		environmentVariables: { DEBUG: 'ensemble:*' },
		filesToCopy: ['.env.local', 'config/*.json'],
		git: { branch_prefix: 'ensemble/' },
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

test('Conductor local TOML overrides shared TOML in repository resolution', (t) => {
	const fixture = createRepositoryFixture(t);
	fixture.write(
		'.conductor/settings.toml',
		'[scripts]\nrun = "bun run shared"\n',
	);
	fixture.write(
		'.conductor/settings.local.toml',
		'[scripts]\nrun = "bun run local"\n',
	);

	const snapshot = resolveSettings({
		config: createConfig(),
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
		{ source: 'conductor-local-config', value: 'bun run local' },
	);
});

test('ensemble.json overrides shared Conductor TOML', (t) => {
	const fixture = createRepositoryFixture(t);
	fixture.write(
		'.conductor/settings.toml',
		'[scripts]\nrun = "bun run shared"\n',
	);
	fixture.write(
		'ensemble.json',
		JSON.stringify({ scripts: { run: 'bun run ensemble' } }),
	);

	const snapshot = resolveSettings({
		config: createConfig(),
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
		{ source: 'ensemble-config', value: 'bun run ensemble' },
	);
});

test('shared Conductor TOML suppresses legacy conductor.json', (t) => {
	const fixture = createRepositoryFixture(t);
	fixture.write(
		'.conductor/settings.toml',
		'[scripts]\nrun = "bun run shared"\n',
	);
	fixture.write(
		'conductor.json',
		JSON.stringify({ scripts: { run: 'bun run legacy' } }),
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
		getSource(loaded.snapshot, 'conductor-legacy-config').status,
		'ignored',
	);
	assert.equal(
		loaded.snapshot.diagnostics.some(
			(diagnostic) => diagnostic.code === 'legacy-conductor-json-ignored',
		),
		true,
	);
	assert.ok(snapshot.repository);
	assert.deepEqual(
		{
			source: getRepositorySetting(snapshot.repository, 'scripts.run').source,
			value: getRepositorySetting(snapshot.repository, 'scripts.run').value,
		},
		{ source: 'conductor-config', value: 'bun run shared' },
	);
});

test('migrates shared Conductor TOML into a new ensemble.json', (t) => {
	const fixture = createRepositoryFixture(t);
	fixture.write(
		'.conductor/settings.toml',
		`
enterprise_data_privacy = true
file_include_globs = [".env.local"]

[scripts]
setup = "bun install"
run = "bun run dev"
`,
	);

	const preview = previewRepositoryConfigMigration({
		repositoryPath: fixture.repositoryPath,
	});
	const result = applyRepositoryConfigMigration({
		repositoryPath: fixture.repositoryPath,
	});

	assert.equal(preview.canApply, true);
	assert.equal(preview.targetExists, false);
	assert.deepEqual(
		preview.changes.map((change) => [change.key, change.status]),
		[
			['enterpriseDataPrivacy', 'added'],
			['filesToCopy', 'added'],
			['scripts.run', 'added'],
			['scripts.setup', 'added'],
		],
	);
	assert.equal(result.applied, true);
	assert.deepEqual(fixture.readJson('ensemble.json'), {
		enterpriseDataPrivacy: true,
		filesToCopy: ['.env.local'],
		scripts: {
			run: 'bun run dev',
			setup: 'bun install',
		},
	});
});

test('migration preserves existing ensemble.json values unless overwrite is requested', (t) => {
	const fixture = createRepositoryFixture(t);
	fixture.write(
		'.conductor/settings.toml',
		'[scripts]\nsetup = "bun install"\nrun = "bun run conductor"\n',
	);
	fixture.write(
		'ensemble.json',
		JSON.stringify({ scripts: { run: 'bun run ensemble' } }),
	);

	const preview = previewRepositoryConfigMigration({
		repositoryPath: fixture.repositoryPath,
	});
	const result = applyRepositoryConfigMigration({
		repositoryPath: fixture.repositoryPath,
	});
	const overwriteResult = applyRepositoryConfigMigration({
		overwrite: true,
		repositoryPath: fixture.repositoryPath,
	});

	assert.deepEqual(
		preview.changes.map((change) => [change.key, change.status]),
		[
			['scripts.run', 'conflict'],
			['scripts.setup', 'added'],
		],
	);
	assert.equal(result.applied, true);
	assert.deepEqual(result.resultingConfig, {
		scripts: {
			run: 'bun run ensemble',
			setup: 'bun install',
		},
	});
	assert.equal(overwriteResult.applied, true);
	assert.deepEqual(fixture.readJson('ensemble.json'), {
		scripts: {
			run: 'bun run conductor',
			setup: 'bun install',
		},
	});
});

test('migration treats incompatible target parents as conflicts', (t) => {
	const fixture = createRepositoryFixture(t);
	fixture.write(
		'.conductor/settings.toml',
		'[scripts]\nrun = "bun run conductor"\n',
	);
	fixture.write(
		'ensemble.json',
		JSON.stringify({ scripts: 'bun run ensemble' }),
	);

	const preview = previewRepositoryConfigMigration({
		repositoryPath: fixture.repositoryPath,
	});
	const result = applyRepositoryConfigMigration({
		repositoryPath: fixture.repositoryPath,
	});

	assert.deepEqual(
		preview.changes.map((change) => [
			change.key,
			change.status,
			change.existingValue,
		]),
		[['scripts.run', 'conflict', 'bun run ensemble']],
	);
	assert.equal(result.applied, false);
	assert.deepEqual(fixture.readJson('ensemble.json'), {
		scripts: 'bun run ensemble',
	});

	const overwriteResult = applyRepositoryConfigMigration({
		overwrite: true,
		repositoryPath: fixture.repositoryPath,
	});

	assert.equal(overwriteResult.applied, true);
	assert.deepEqual(fixture.readJson('ensemble.json'), {
		scripts: {
			run: 'bun run conductor',
		},
	});
});

test('repository config path authorization allows only known repositories and workspaces', (t) => {
	const fixture = createRepositoryFixture(t);
	const database = createDatabaseFixture(t);
	const workspacePath = path.join(fixture.repositoryPath, 'workspace-a');

	database
		.prepare(
			`INSERT INTO repositories (id, slug, name, path, default_branch)
			 VALUES ('repo-1', 'ensemble', 'Ensemble', ?, 'master')`,
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

test('invalid repository config and unsupported fields are diagnostic-only', (t) => {
	const fixture = createRepositoryFixture(t);
	fixture.write('ensemble.json', '{"scripts":');
	fixture.write(
		'.conductor/settings.toml',
		'unsupported_field = true\n[scripts]\nrun = "bun run conductor"\n',
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
			(diagnostic) => diagnostic.code === 'invalid-repository-json',
		),
		true,
	);
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
		{ source: 'conductor-config', value: 'bun run conductor' },
	);
});

test('invalid shared Conductor TOML falls back to built-in defaults', (t) => {
	const fixture = createRepositoryFixture(t);
	fixture.write('.conductor/settings.toml', '[scripts]\nrun = ');

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
