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
import { createWorkspaceService } from '../../src/main/repository/create-workspace.ts';
import { createDeleteRepositoryService } from '../../src/main/repository/delete-repository.ts';
import {
	type EnsemblrDatabaseConnection,
	type EnsemblrDatabaseService,
	openEnsemblrDatabase,
} from '../../src/main/storage/database.ts';
import { buildRootDirectoryStub } from './helpers/root-directory-stub.ts';

const fixedNow = () => new Date('2026-06-08T12:00:00.000Z');

interface Harness {
	databaseService: EnsemblrDatabaseService;
	repositoryId: string;
	repositoryPath: string;
	rootPath: string;
	workspacesPath: string;
}

function createHarness(t: TestContext): Harness {
	const rootPath = mkdtempSync(
		path.join(tmpdir(), 'ensemblr-delete-repository-'),
	);
	const repositoriesPath = path.join(rootPath, 'repos');
	const workspacesPath = path.join(rootPath, 'workspaces');
	mkdirSync(repositoriesPath, { recursive: true });
	mkdirSync(workspacesPath, { recursive: true });

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
	databaseService: EnsemblrDatabaseService,
	id: string,
): Record<string, unknown> | undefined {
	const database = databaseService.getConnection()?.database as DatabaseSync;
	const row = database
		.prepare('SELECT * FROM repositories WHERE id = ?')
		.get(id);
	return row as Record<string, unknown> | undefined;
}

function workspaceRowsForRepository(
	databaseService: EnsemblrDatabaseService,
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

test('delete drops every workspace and the repository row, preserves repo folder', async (t) => {
	const harness = createHarness(t);
	const ws1 = await seedWorkspace(harness, 'cleanup-one');
	const ws2 = await seedWorkspace(harness, 'cleanup-two');

	const service = createDeleteRepositoryService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		rootDirectoryService: rootDirectoryStub(harness),
	});

	const result = await service.delete({ repositoryId: harness.repositoryId });

	assert.equal(result.status, 'success');
	assert.equal(result.workspacesDeleted, 2);
	assert.deepEqual(
		result.repository?.deletedWorkspaceIds.sort(),
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
	assert.equal(existsSync(harness.repositoryPath), true);

	const branches = listBranches(harness.repositoryPath);
	assert.equal(branches.includes('cleanup-one'), false);
	assert.equal(branches.includes('cleanup-two'), false);

	const worktrees = listWorktreePaths(harness.repositoryPath);
	assert.equal(worktrees.includes(ws1.path), false);
	assert.equal(worktrees.includes(ws2.path), false);
});

test('delete drops a sentinel file so the reconciler will not re-adopt the folder', async (t) => {
	const harness = createHarness(t);

	const service = createDeleteRepositoryService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		rootDirectoryService: rootDirectoryStub(harness),
	});

	const result = await service.delete({ repositoryId: harness.repositoryId });
	assert.equal(result.status, 'success');

	const markerPath = path.join(harness.repositoryPath, '.ensemblr-archived');
	assert.equal(existsSync(markerPath), true);
});

test('delete succeeds for a repository with no workspaces', async (t) => {
	const harness = createHarness(t);

	const service = createDeleteRepositoryService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		rootDirectoryService: rootDirectoryStub(harness),
	});

	const result = await service.delete({ repositoryId: harness.repositoryId });

	assert.equal(result.status, 'success');
	assert.equal(result.workspacesDeleted, 0);
	assert.equal(
		repositoryRow(harness.databaseService, harness.repositoryId),
		undefined,
	);
	assert.equal(existsSync(harness.repositoryPath), true);
});

test('delete succeeds even when a workspace directory was removed out-of-band', async (t) => {
	const harness = createHarness(t);
	const ws = await seedWorkspace(harness, 'already-gone');
	rmSync(ws.path, { force: true, recursive: true });
	assert.equal(existsSync(ws.path), false);

	const service = createDeleteRepositoryService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		rootDirectoryService: rootDirectoryStub(harness),
	});

	const result = await service.delete({ repositoryId: harness.repositoryId });

	assert.equal(result.status, 'success');
	assert.equal(
		repositoryRow(harness.databaseService, harness.repositoryId),
		undefined,
	);
});

test('delete rejects when the repository id is missing or unknown', async (t) => {
	const harness = createHarness(t);
	const service = createDeleteRepositoryService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		rootDirectoryService: rootDirectoryStub(harness),
	});

	const missing = await service.delete({ repositoryId: '' });
	assert.equal(missing.status, 'failure');
	assert.equal(missing.diagnostics[0]?.code, 'repository-id-required');

	const notFound = await service.delete({ repositoryId: 'repository-bogus' });
	assert.equal(notFound.status, 'failure');
	assert.equal(notFound.diagnostics[0]?.code, 'repository-not-found');
});
