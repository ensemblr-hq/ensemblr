import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';

import {
	ENSEMBLR_CONFIG_SCHEMA_VERSION,
	type EnsemblrConfig,
} from '../../src/main/config/config-loader.ts';
import { resolveSettings } from '../../src/main/config/config-resolution.ts';
import { upsertRepositoryScriptSettings } from '../../src/main/environment/repository-script-settings.ts';
import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';

const REPO_ID = 'repo-1';

function createConfig(): EnsemblrConfig {
	return {
		app: {},
		environment: {},
		managed: {},
		repositoryDefaults: {},
		repositoryRules: [],
		schemaVersion: ENSEMBLR_CONFIG_SCHEMA_VERSION,
		security: {},
		ui: {},
	};
}

function createDatabaseFixture(t: TestContext): DatabaseSync {
	const directory = mkdtempSync(
		path.join(tmpdir(), 'ensemblr-script-settings-'),
	);
	const connection = openEnsemblrDatabase({
		databasePath: path.join(directory, 'ensemblr-test.db'),
	});

	t.after(() => {
		connection.database.close();
		rmSync(directory, { force: true, recursive: true });
	});

	return connection.database;
}

function resolvedRepository(database: DatabaseSync) {
	const snapshot = resolveSettings({
		config: createConfig(),
		database,
		repository: { repositoryId: REPO_ID },
	});

	if (!snapshot.repository) {
		assert.fail('Expected repository settings resolution');
	}

	return (key: string) =>
		snapshot.repository?.settings.find((setting) => setting.key === key);
}

test('upsertRepositoryScriptSettings persists rows the resolver reads as sqlite', (t) => {
	const database = createDatabaseFixture(t);

	upsertRepositoryScriptSettings({
		archive: 'bun run archive',
		autoRunAfterSetup: true,
		database,
		repositoryId: REPO_ID,
		run: 'bun run dev',
		runScriptMode: 'nonconcurrent',
		setup: 'bun install',
	});

	const resolved = resolvedRepository(database);

	assert.deepEqual(
		{
			archive: resolved('scripts.archive')?.value,
			autoRun: resolved('autoRunAfterSetup')?.value,
			run: resolved('scripts.run')?.value,
			runMode: resolved('runScriptMode')?.value,
			setup: resolved('scripts.setup')?.value,
			source: resolved('scripts.run')?.source,
		},
		{
			archive: 'bun run archive',
			autoRun: true,
			run: 'bun run dev',
			runMode: 'nonconcurrent',
			setup: 'bun install',
			source: 'sqlite',
		},
	);
});

test('blank script commands delete their row and fall back to defaults', (t) => {
	const database = createDatabaseFixture(t);

	upsertRepositoryScriptSettings({
		archive: 'bun run archive',
		autoRunAfterSetup: false,
		database,
		repositoryId: REPO_ID,
		run: 'bun run dev',
		runScriptMode: 'concurrent',
		setup: 'bun install',
	});
	// Clearing run removes its stored row.
	upsertRepositoryScriptSettings({
		archive: 'bun run archive',
		autoRunAfterSetup: false,
		database,
		repositoryId: REPO_ID,
		run: '   ',
		runScriptMode: 'concurrent',
		setup: 'bun install',
	});

	const resolved = resolvedRepository(database);

	assert.deepEqual(
		{
			run: resolved('scripts.run')?.value,
			runSource: resolved('scripts.run')?.source,
			setup: resolved('scripts.setup')?.value,
			setupSource: resolved('scripts.setup')?.source,
		},
		{
			run: null,
			runSource: 'built-in-default',
			setup: 'bun install',
			setupSource: 'sqlite',
		},
	);
});
