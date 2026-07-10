import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';

import { createLocalCommandService } from '../../src/main/commands/local-command.ts';
import { createArchiveLifecycleService } from '../../src/main/repository/archive-lifecycle.ts';
import { createArchiveRepositoryService } from '../../src/main/repository/archive-repository.ts';
import { createArchiveWorkspaceService } from '../../src/main/repository/archive-workspace.ts';
import { createWorkspaceService } from '../../src/main/repository/create-workspace.ts';
import {
	type EnsemblrDatabaseConnection,
	type EnsemblrDatabaseService,
	openEnsemblrDatabase,
} from '../../src/main/storage/database.ts';
import { buildRootDirectoryStub } from './helpers/root-directory-stub.ts';

const fixedNow = () => new Date('2026-06-08T12:00:00.000Z');

interface Harness {
	archivedContextsPath: string;
	databaseService: EnsemblrDatabaseService;
	repositoryId: string;
	repositoryPath: string;
	rootPath: string;
	workspacesPath: string;
}

function createHarness(t: TestContext): Harness {
	const rootPath = mkdtempSync(
		path.join(tmpdir(), 'ensemblr-archive-repo-lifecycle-'),
	);
	const repositoriesPath = path.join(rootPath, 'repos');
	const workspacesPath = path.join(rootPath, 'workspaces');
	const archivedContextsPath = path.join(rootPath, 'archived-contexts');
	mkdirSync(repositoriesPath, { recursive: true });
	mkdirSync(workspacesPath, { recursive: true });
	mkdirSync(archivedContextsPath, { recursive: true });

	const repositoryPath = path.join(repositoriesPath, 'demo');
	mkdirSync(repositoryPath);
	runGit(repositoryPath, ['init', '-b', 'main']);
	runGit(repositoryPath, ['config', 'user.email', 'test@ensemblr.dev']);
	runGit(repositoryPath, ['config', 'user.name', 'Ensemblr Test']);
	writeFileSync(path.join(repositoryPath, 'README.md'), '# demo\n');
	runGit(repositoryPath, ['add', '.']);
	runGit(repositoryPath, ['commit', '-m', 'init']);

	const connection = openEnsemblrDatabase({ databasePath: ':memory:' });
	const repositoryId = 'repository-demo';
	const timestamp = fixedNow().toISOString();
	connection.database
		.prepare(
			`INSERT INTO repositories (id, slug, name, path, default_branch, created_at, updated_at, metadata_json)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			repositoryId,
			'demo',
			'demo',
			repositoryPath,
			'main',
			timestamp,
			timestamp,
			'{}',
		);

	const databaseService = wrapConnection(connection);

	t.after(() => {
		connection.database.close();
		rmSync(rootPath, { force: true, recursive: true });
	});

	return {
		archivedContextsPath,
		databaseService,
		repositoryId,
		repositoryPath,
		rootPath,
		workspacesPath,
	};
}

function wrapConnection(
	connection: EnsemblrDatabaseConnection,
): EnsemblrDatabaseService {
	return {
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
}

const rootDirectoryStub = (harness: Harness) =>
	buildRootDirectoryStub({
		archivedContextsPath: harness.archivedContextsPath,
		rootPath: harness.rootPath,
		workspacesPath: harness.workspacesPath,
	});

function runGit(cwd: string, args: string[]): string {
	return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function repositoryRow(
	databaseService: EnsemblrDatabaseService,
	id: string,
): Record<string, unknown> | undefined {
	const database = databaseService.getConnection()?.database as DatabaseSync;
	const row = database
		.prepare('SELECT * FROM repositories WHERE id = ?')
		.get(id);
	return row as Record<string, unknown> | undefined;
}

function workspaceRow(
	databaseService: EnsemblrDatabaseService,
	id: string,
): Record<string, unknown> | undefined {
	const database = databaseService.getConnection()?.database as DatabaseSync;
	const row = database.prepare('SELECT * FROM workspaces WHERE id = ?').get(id);
	return row as Record<string, unknown> | undefined;
}

function archiveRecords(
	databaseService: EnsemblrDatabaseService,
	repositoryId: string,
): Record<string, unknown>[] {
	const database = databaseService.getConnection()?.database as DatabaseSync;
	return database
		.prepare('SELECT * FROM archive_records WHERE repository_id = ?')
		.all(repositoryId) as Record<string, unknown>[];
}

async function seedWorkspace(harness: Harness, name: string) {
	const service = createWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
		rootDirectoryService: rootDirectoryStub(harness),
	});
	const result = await service.create({
		name,
		repositoryId: harness.repositoryId,
	});
	if (result.status !== 'success' || !result.workspace) {
		throw new Error(`failed to seed workspace ${name}`);
	}
	return result.workspace;
}

function makeArchiveService(
	harness: Harness,
	lifecycle = createArchiveLifecycleService(),
) {
	const archiveWorkspaceService = createArchiveWorkspaceService({
		archiveLifecycleService: lifecycle,
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
		rootDirectoryService: rootDirectoryStub(harness),
	});
	const service = createArchiveRepositoryService({
		archiveLifecycleService: lifecycle,
		archiveWorkspaceService,
		databaseService: harness.databaseService,
		now: fixedNow,
	});
	return { lifecycle, service };
}

test('lifecycle archive cascades to every workspace, stamps both rows, records two archive_records', async (t) => {
	const harness = createHarness(t);
	const ws1 = await seedWorkspace(harness, 'cleanup-one');
	const ws2 = await seedWorkspace(harness, 'cleanup-two');

	const { service } = makeArchiveService(harness);

	const result = await service.archive({ repositoryId: harness.repositoryId });

	assert.equal(result.status, 'success');
	assert.equal(result.workspacesArchived, 2);
	assert.deepEqual(
		result.repository?.archivedWorkspaceIds.sort(),
		[ws1.id, ws2.id].sort(),
	);

	assert.equal(
		repositoryRow(harness.databaseService, harness.repositoryId)?.archived_at,
		fixedNow().toISOString(),
	);
	assert.equal(
		workspaceRow(harness.databaseService, ws1.id)?.archived_at,
		fixedNow().toISOString(),
	);
	assert.equal(
		workspaceRow(harness.databaseService, ws2.id)?.archived_at,
		fixedNow().toISOString(),
	);

	// Worktree folders + repo folder are preserved.
	assert.equal(existsSync(ws1.path), true);
	assert.equal(existsSync(ws2.path), true);
	assert.equal(existsSync(harness.repositoryPath), true);

	const records = archiveRecords(harness.databaseService, harness.repositoryId);
	assert.equal(records.length, 3);
	const types = records.map((row) => row.record_type).sort();
	assert.deepEqual(types, ['repository', 'workspace', 'workspace']);
});

test('repository with no workspaces still flips archived_at and records the repository row', async (t) => {
	const harness = createHarness(t);
	const { service } = makeArchiveService(harness);

	const result = await service.archive({ repositoryId: harness.repositoryId });

	assert.equal(result.status, 'success');
	assert.equal(result.workspacesArchived, 0);
	assert.equal(
		repositoryRow(harness.databaseService, harness.repositoryId)?.archived_at,
		fixedNow().toISOString(),
	);
	const records = archiveRecords(harness.databaseService, harness.repositoryId);
	assert.equal(records.length, 1);
	assert.equal(records[0]?.record_type, 'repository');
});

test('archiving a repository twice is rejected once it carries archived_at', async (t) => {
	const harness = createHarness(t);
	const { service } = makeArchiveService(harness);

	const first = await service.archive({ repositoryId: harness.repositoryId });
	assert.equal(first.status, 'success');

	const second = await service.archive({ repositoryId: harness.repositoryId });
	assert.equal(second.status, 'failure');
	assert.equal(second.diagnostics[0]?.code, 'repository-already-archived');
});

test('pre-archive-repository hook abort stops the cascade before any workspace flips', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'guarded');

	const lifecycle = createArchiveLifecycleService();
	lifecycle.subscribe('pre-archive-repository', () => ({
		abort: {
			code: 'repository-busy',
			message: 'Open Pi sessions in this repository.',
		},
	}));

	const { service } = makeArchiveService(harness, lifecycle);

	const result = await service.archive({ repositoryId: harness.repositoryId });

	assert.equal(result.status, 'aborted');
	assert.equal(result.workspacesArchived, 0);
	assert.equal(
		result.diagnostics.some(
			(diagnostic) => diagnostic.code === 'archive-aborted-by-hook',
		),
		true,
	);
	assert.equal(
		repositoryRow(harness.databaseService, harness.repositoryId)?.archived_at,
		null,
	);
	assert.equal(
		workspaceRow(harness.databaseService, workspace.id)?.archived_at,
		null,
	);
});

test('archive rejects when the repository id is missing or unknown', async (t) => {
	const harness = createHarness(t);
	const { service } = makeArchiveService(harness);

	const missing = await service.archive({ repositoryId: '' });
	assert.equal(missing.status, 'failure');
	assert.equal(missing.diagnostics[0]?.code, 'repository-id-required');

	const notFound = await service.archive({ repositoryId: 'repository-bogus' });
	assert.equal(notFound.status, 'failure');
	assert.equal(notFound.diagnostics[0]?.code, 'repository-not-found');
});
