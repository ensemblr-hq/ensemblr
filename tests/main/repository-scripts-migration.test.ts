import assert from 'node:assert/strict';
import {
	chmodSync,
	existsSync,
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

import { load } from 'js-toml';

import {
	migrateAllRepositoryScriptSettings,
	migrateRepositoryScriptSettings,
} from '../../src/main/config/repository-scripts-migration.ts';
import { readSettingJson } from '../../src/main/environment/settings-table.ts';
import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';
import { insertRepositoryRow } from '../../src/main/storage/repositories/repository-row-repository.ts';

const REPOSITORY_ID = 'repo-1';

const LEGACY_KEYS = [
	'autoRunAfterSetup',
	'runScriptMode',
	'scripts.archive',
	'scripts.run',
	'scripts.runScripts',
	'scripts.setup',
] as const;

interface MigrationFixture {
	configPath: string;
	database: DatabaseSync;
	readRecord: () => Record<string, unknown>;
	repositoryPath: string;
	seed: (key: string, value: unknown) => void;
	storedKeys: () => string[];
	writeConfig: (source: string) => void;
}

function createFixture(t: TestContext): MigrationFixture {
	const repositoryPath = mkdtempSync(path.join(tmpdir(), 'ensemblr-migrate-'));
	const databaseDirectory = mkdtempSync(
		path.join(tmpdir(), 'ensemblr-mig-db-'),
	);
	const connection = openEnsemblrDatabase({
		databasePath: path.join(databaseDirectory, 'ensemblr-test.db'),
	});
	const configPath = path.join(repositoryPath, '.ensemblr', 'settings.toml');

	t.after(() => {
		connection.database.close();
		rmSync(databaseDirectory, { force: true, recursive: true });
		rmSync(repositoryPath, { force: true, recursive: true });
	});

	return {
		configPath,
		database: connection.database,
		readRecord: () =>
			JSON.parse(
				JSON.stringify(load(readFileSync(configPath, 'utf8'))),
			) as Record<string, unknown>,
		repositoryPath,
		seed: (key, value) => {
			connection.database
				.prepare(
					`INSERT INTO settings (id, scope, scope_id, key, value_json, source, locked, updated_at)
					 VALUES (?, 'repository', ?, ?, ?, 'sqlite', 0, ?)`,
				)
				.run(
					`setting-${key}`,
					REPOSITORY_ID,
					key,
					JSON.stringify(value),
					new Date().toISOString(),
				);
		},
		storedKeys: () =>
			LEGACY_KEYS.filter(
				(key) =>
					readSettingJson({
						database: connection.database,
						key,
						scope: { scope: 'repository', scopeId: REPOSITORY_ID },
					}) !== null,
			),
		writeConfig: (source) => {
			mkdirSync(path.dirname(configPath), { recursive: true });
			writeFileSync(configPath, source, 'utf8');
		},
	};
}

function migrate(fixture: MigrationFixture) {
	return migrateRepositoryScriptSettings({
		database: fixture.database,
		repositoryId: REPOSITORY_ID,
		repositoryPath: fixture.repositoryPath,
	});
}

test('does not touch the config when no legacy rows exist', (t) => {
	const fixture = createFixture(t);

	const result = migrate(fixture);

	assert.equal(result.status, 'skipped');
	assert.equal(existsSync(fixture.configPath), false);
});

test('moves personal script rows into the committed config', (t) => {
	const fixture = createFixture(t);
	fixture.seed('scripts.setup', 'npm ci');
	fixture.seed('scripts.archive', 'rm -rf dist');
	fixture.seed('runScriptMode', 'nonconcurrent');
	fixture.seed('autoRunAfterSetup', true);
	fixture.seed('scripts.runScripts', [
		{
			availableIn: ['local'],
			command: 'npm run dev',
			icon: 'server',
			isDefault: true,
			name: 'dev',
		},
	]);

	const result = migrate(fixture);

	assert.equal(result.status, 'migrated');
	assert.deepEqual(fixture.readRecord(), {
		scripts: {
			archive: 'rm -rf dist',
			auto_run_after_setup: true,
			run: {
				dev: {
					available_in: ['local'],
					command: 'npm run dev',
					default: true,
					icon: 'server',
				},
			},
			run_mode: 'nonconcurrent',
			setup: 'npm ci',
		},
	});
	assert.deepEqual(fixture.storedKeys(), []);
});

test('keeps committed values when both sources define a key', (t) => {
	const fixture = createFixture(t);
	fixture.writeConfig('[scripts]\nsetup = "committed setup"\n');
	fixture.seed('scripts.setup', 'personal setup');
	fixture.seed('scripts.archive', 'personal archive');

	migrate(fixture);

	const scripts = fixture.readRecord().scripts as Record<string, unknown>;

	assert.equal(scripts.setup, 'committed setup');
	assert.equal(scripts.archive, 'personal archive');
	assert.deepEqual(fixture.storedKeys(), []);
});

test('upgrades a legacy scripts.run row into a named run script', (t) => {
	const fixture = createFixture(t);
	fixture.seed('scripts.run', 'npm run dev');

	migrate(fixture);

	const scripts = fixture.readRecord().scripts as Record<string, unknown>;

	assert.deepEqual(scripts.run, {
		run: { command: 'npm run dev', default: true },
	});
	assert.deepEqual(fixture.storedKeys(), []);
});

test('leaves auto_run_after_setup unset when no row defines it', (t) => {
	const fixture = createFixture(t);
	fixture.seed('scripts.setup', 'npm ci');

	migrate(fixture);

	const scripts = fixture.readRecord().scripts as Record<string, unknown>;

	assert.equal('auto_run_after_setup' in scripts, false);
	assert.equal('run_mode' in scripts, false);
});

test('keeps the rows when the config cannot be written', (t) => {
	const fixture = createFixture(t);
	fixture.seed('scripts.setup', 'npm ci');
	const directory = path.dirname(fixture.configPath);
	mkdirSync(directory, { recursive: true });
	chmodSync(directory, 0o500);

	const result = migrate(fixture);
	chmodSync(directory, 0o700);

	assert.equal(result.status, 'failed');
	assert.deepEqual(fixture.storedKeys(), ['scripts.setup']);
});

test('the pass retries a repository whose earlier attempt failed', (t) => {
	const fixture = createFixture(t);
	insertRepositoryRow({
		database: fixture.database,
		defaultBranch: 'main',
		id: REPOSITORY_ID,
		metadataJson: '{}',
		name: REPOSITORY_ID,
		path: fixture.repositoryPath,
		remoteUrl: '',
		slug: REPOSITORY_ID,
		timestamp: new Date().toISOString(),
	});
	fixture.seed('scripts.setup', 'npm ci');
	const directory = path.dirname(fixture.configPath);
	mkdirSync(directory, { recursive: true });
	chmodSync(directory, 0o500);

	assert.deepEqual(migrateAllRepositoryScriptSettings(fixture.database), []);
	assert.deepEqual(fixture.storedKeys(), ['scripts.setup']);

	chmodSync(directory, 0o700);

	assert.deepEqual(migrateAllRepositoryScriptSettings(fixture.database), [
		REPOSITORY_ID,
	]);
	assert.deepEqual(fixture.storedKeys(), []);
});

test('the pass is a no-op once every repository is drained', (t) => {
	const fixture = createFixture(t);
	insertRepositoryRow({
		database: fixture.database,
		defaultBranch: 'main',
		id: REPOSITORY_ID,
		metadataJson: '{}',
		name: REPOSITORY_ID,
		path: fixture.repositoryPath,
		remoteUrl: '',
		slug: REPOSITORY_ID,
		timestamp: new Date().toISOString(),
	});
	fixture.seed('scripts.setup', 'npm ci');

	assert.deepEqual(migrateAllRepositoryScriptSettings(fixture.database), [
		REPOSITORY_ID,
	]);
	assert.deepEqual(migrateAllRepositoryScriptSettings(fixture.database), []);
	assert.equal(
		(fixture.readRecord().scripts as Record<string, unknown>).setup,
		'npm ci',
	);
});
