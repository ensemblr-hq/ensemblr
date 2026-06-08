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
import { createArchiveRepositoryService } from '../../src/main/repository/archive-repository.ts';
import { createWorkspaceService } from '../../src/main/repository/create-workspace.ts';
import {
	type EnsembleDatabaseConnection,
	type EnsembleDatabaseService,
	openEnsembleDatabase,
} from '../../src/main/storage/database.ts';
import { buildRootDirectoryStub } from './helpers/root-directory-stub.ts';

const fixedNow = () => new Date('2026-06-08T12:00:00.000Z');

interface Harness {
	databaseService: EnsembleDatabaseService;
	repositoryId: string;
	repositoryPath: string;
	rootPath: string;
	workspacesPath: string;
}

function createHarness(t: TestContext): Harness {
	const rootPath = mkdtempSync(
		path.join(tmpdir(), 'ensemble-archive-repository-'),
	);
	const repositoriesPath = path.join(rootPath, 'repos');
	const workspacesPath = path.join(rootPath, 'workspaces');
	mkdirSync(repositoriesPath, { recursive: true });
	mkdirSync(workspacesPath, { recursive: true });

	const repositoryPath = path.join(repositoriesPath, 'demo');
	mkdirSync(repositoryPath);
	runGit(repositoryPath, ['init', '-b', 'main']);
	runGit(repositoryPath, ['config', 'user.email', 'test@ensemble.dev']);
	runGit(repositoryPath, ['config', 'user.name', 'Ensemble Test']);
	writeFileSync(path.join(repositoryPath, 'README.md'), '# demo\n');
	runGit(repositoryPath, ['add', '.']);
	runGit(repositoryPath, ['commit', '-m', 'init']);

	const connection = openEnsembleDatabase({ databasePath: ':memory:' });
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
		databaseService,
		repositoryId,
		repositoryPath,
		rootPath,
		workspacesPath,
	};
}

function wrapConnection(
	connection: EnsembleDatabaseConnection,
): EnsembleDatabaseService {
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

const rootDirectoryStub = (
	harness: Pick<Harness, 'rootPath' | 'workspacesPath'>,
) =>
	buildRootDirectoryStub({
		rootPath: harness.rootPath,
		workspacesPath: harness.workspacesPath,
	});

function runGit(cwd: string, args: string[]): string {
	return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function repositoryRow(
	databaseService: EnsembleDatabaseService,
	id: string,
): Record<string, unknown> | undefined {
	const database = databaseService.getConnection()?.database as DatabaseSync;
	const row = database
		.prepare('SELECT * FROM repositories WHERE id = ?')
		.get(id);
	return row as Record<string, unknown> | undefined;
}

function workspaceRowsForRepository(
	databaseService: EnsembleDatabaseService,
	repositoryId: string,
): Record<string, unknown>[] {
	const database = databaseService.getConnection()?.database as DatabaseSync;
	const rows = database
		.prepare('SELECT * FROM workspaces WHERE repository_id = ?')
		.all(repositoryId);
	return rows as Record<string, unknown>[];
}

function listBranches(repositoryPath: string): string[] {
	return runGit(repositoryPath, [
		'branch',
		'--list',
		'--format=%(refname:short)',
	])
		.split(/\r?\n/)
		.map((branch) => branch.trim())
		.filter((branch) => branch.length > 0);
}

function listWorktreePaths(repositoryPath: string): string[] {
	return runGit(repositoryPath, ['worktree', 'list', '--porcelain'])
		.split(/\r?\n/)
		.filter((line) => line.startsWith('worktree '))
		.map((line) => line.slice('worktree '.length));
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

test('archive drops every workspace and the repository row, preserves repo folder', async (t) => {
	const harness = createHarness(t);
	const ws1 = await seedWorkspace(harness, 'cleanup-one');
	const ws2 = await seedWorkspace(harness, 'cleanup-two');

	const service = createArchiveRepositoryService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
	});

	const result = await service.archive({ repositoryId: harness.repositoryId });

	assert.equal(result.status, 'success');
	assert.equal(result.workspacesArchived, 2);
	assert.deepEqual(
		result.repository?.archivedWorkspaceIds.sort(),
		[ws1.id, ws2.id].sort(),
	);

	assert.equal(
		repositoryRow(harness.databaseService, harness.repositoryId),
		undefined,
	);
	assert.equal(
		workspaceRowsForRepository(harness.databaseService, harness.repositoryId)
			.length,
		0,
	);

	assert.equal(existsSync(ws1.path), false);
	assert.equal(existsSync(ws2.path), false);
	// Repository folder itself is preserved on disk for later re-adoption.
	assert.equal(existsSync(harness.repositoryPath), true);

	const branches = listBranches(harness.repositoryPath);
	assert.equal(branches.includes('cleanup-one'), false);
	assert.equal(branches.includes('cleanup-two'), false);

	const worktrees = listWorktreePaths(harness.repositoryPath);
	assert.equal(worktrees.includes(ws1.path), false);
	assert.equal(worktrees.includes(ws2.path), false);
});

test('archive drops a sentinel file so the reconciler will not re-adopt the folder', async (t) => {
	const harness = createHarness(t);

	const service = createArchiveRepositoryService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
	});

	const result = await service.archive({ repositoryId: harness.repositoryId });
	assert.equal(result.status, 'success');

	const markerPath = path.join(harness.repositoryPath, '.ensemble-archived');
	assert.equal(existsSync(markerPath), true);
});

test('archive succeeds for a repository with no workspaces', async (t) => {
	const harness = createHarness(t);

	const service = createArchiveRepositoryService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
	});

	const result = await service.archive({ repositoryId: harness.repositoryId });

	assert.equal(result.status, 'success');
	assert.equal(result.workspacesArchived, 0);
	assert.equal(
		repositoryRow(harness.databaseService, harness.repositoryId),
		undefined,
	);
	assert.equal(existsSync(harness.repositoryPath), true);
});

test('archive succeeds even when a workspace directory was removed out-of-band', async (t) => {
	const harness = createHarness(t);
	const ws = await seedWorkspace(harness, 'already-gone');
	rmSync(ws.path, { force: true, recursive: true });
	assert.equal(existsSync(ws.path), false);

	const service = createArchiveRepositoryService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
	});

	const result = await service.archive({ repositoryId: harness.repositoryId });

	assert.equal(result.status, 'success');
	assert.equal(
		repositoryRow(harness.databaseService, harness.repositoryId),
		undefined,
	);
});

test('archive rejects when the repository id is missing or unknown', async (t) => {
	const harness = createHarness(t);
	const service = createArchiveRepositoryService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
	});

	const missing = await service.archive({ repositoryId: '' });
	assert.equal(missing.status, 'failure');
	assert.equal(missing.diagnostics[0]?.code, 'repository-id-required');

	const notFound = await service.archive({ repositoryId: 'repository-bogus' });
	assert.equal(notFound.status, 'failure');
	assert.equal(notFound.diagnostics[0]?.code, 'repository-not-found');
});
