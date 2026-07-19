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
import { upsertRepositorySettings } from '../../src/main/environment/repository-settings.ts';
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
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-repo-settings-'));
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

test('upsertRepositorySettings persists rows the resolver reads as sqlite', (t) => {
	const database = createDatabaseFixture(t);

	upsertRepositorySettings({
		database,
		repositoryId: REPO_ID,
		settings: {
			archiveAfterMerge: true,
			branchFrom: 'develop',
			deleteLocalBranchOnArchive: true,
			filesToCopy: ['.env', 'config/*.json'],
			previewUrls: [{ name: 'Dev', url: 'http://localhost:3000' }],
			remoteOrigin: 'upstream',
		},
	});

	const resolved = resolvedRepository(database);

	assert.deepEqual(
		{
			archiveAfterMerge: resolved('archiveAfterMerge')?.value,
			branchFrom: resolved('branchFrom')?.value,
			deleteLocalBranchOnArchive: resolved('deleteLocalBranchOnArchive')?.value,
			filesToCopy: resolved('filesToCopy')?.value,
			previewUrls: resolved('previewUrls')?.value,
			remoteOrigin: resolved('remoteOrigin')?.value,
			source: resolved('branchFrom')?.source,
		},
		{
			archiveAfterMerge: true,
			branchFrom: 'develop',
			deleteLocalBranchOnArchive: true,
			filesToCopy: ['.env', 'config/*.json'],
			previewUrls: [{ name: 'Dev', url: 'http://localhost:3000' }],
			remoteOrigin: 'upstream',
			source: 'sqlite',
		},
	);
});

test('null / blank / empty patch fields delete their row and fall back to defaults', (t) => {
	const database = createDatabaseFixture(t);

	upsertRepositorySettings({
		database,
		repositoryId: REPO_ID,
		settings: {
			archiveAfterMerge: true,
			branchFrom: 'develop',
			filesToCopy: ['a.txt'],
		},
	});
	upsertRepositorySettings({
		database,
		repositoryId: REPO_ID,
		settings: {
			archiveAfterMerge: null,
			branchFrom: '   ',
			filesToCopy: [],
		},
	});

	const resolved = resolvedRepository(database);

	assert.deepEqual(
		{
			archiveAfterMerge: resolved('archiveAfterMerge')?.value,
			archiveSource: resolved('archiveAfterMerge')?.source,
			branchFrom: resolved('branchFrom')?.value,
			branchSource: resolved('branchFrom')?.source,
			filesToCopy: resolved('filesToCopy')?.value,
			filesSource: resolved('filesToCopy')?.source,
		},
		{
			archiveAfterMerge: false,
			archiveSource: 'built-in-default',
			branchFrom: null,
			branchSource: 'built-in-default',
			filesToCopy: ['.env*'],
			filesSource: 'built-in-default',
		},
	);
});

test('omitted patch fields leave existing rows untouched', (t) => {
	const database = createDatabaseFixture(t);

	upsertRepositorySettings({
		database,
		repositoryId: REPO_ID,
		settings: { branchFrom: 'develop', remoteOrigin: 'upstream' },
	});
	upsertRepositorySettings({
		database,
		repositoryId: REPO_ID,
		settings: { remoteOrigin: 'fork' },
	});

	const resolved = resolvedRepository(database);

	assert.equal(resolved('branchFrom')?.value, 'develop');
	assert.equal(resolved('remoteOrigin')?.value, 'fork');
});
