import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
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
import { buildWorkspaceTeardownStub } from './helpers/workspace-teardown-stub.ts';

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
		workspaceTeardownService: buildWorkspaceTeardownStub(),
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
		workspaceTeardownService: buildWorkspaceTeardownStub(),
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
		workspaceTeardownService: buildWorkspaceTeardownStub(),
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
		workspaceTeardownService: buildWorkspaceTeardownStub(),
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
		workspaceTeardownService: buildWorkspaceTeardownStub(),
	});

	const missing = await service.delete({ repositoryId: '' });
	assert.equal(missing.status, 'failure');
	assert.equal(missing.diagnostics[0]?.code, 'repository-id-required');

	const notFound = await service.delete({ repositoryId: 'repository-bogus' });
	assert.equal(notFound.status, 'failure');
	assert.equal(notFound.diagnostics[0]?.code, 'repository-not-found');
});

test('delete removes the repository folder and its workspaces directory when asked', async (t) => {
	const harness = createHarness(t);
	const ws = await seedWorkspace(harness, 'folder-delete');
	const slugDirectory = path.join(harness.workspacesPath, 'demo');
	assert.equal(existsSync(slugDirectory), true);

	const service = createDeleteRepositoryService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		rootDirectoryService: rootDirectoryStub(harness),
		workspaceTeardownService: buildWorkspaceTeardownStub(),
	});

	const result = await service.delete({
		deleteFolder: true,
		repositoryId: harness.repositoryId,
	});

	assert.equal(result.status, 'success');
	assert.equal(result.repository?.folderDeleted, true);
	assert.equal(existsSync(harness.repositoryPath), false);
	assert.equal(existsSync(slugDirectory), false);
	assert.equal(existsSync(ws.path), false);
	assert.deepEqual(
		result.diagnostics.filter(
			(diagnostic) => diagnostic.severity !== 'warning',
		),
		[],
	);
});

test('delete clears the workspaces directory even when the folder is kept', async (t) => {
	const harness = createHarness(t);
	await seedWorkspace(harness, 'residue');
	const slugDirectory = path.join(harness.workspacesPath, 'demo');
	writeFileSync(path.join(slugDirectory, 'stray.txt'), 'left behind\n');

	const service = createDeleteRepositoryService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		rootDirectoryService: rootDirectoryStub(harness),
		workspaceTeardownService: buildWorkspaceTeardownStub(),
	});

	const result = await service.delete({ repositoryId: harness.repositoryId });

	assert.equal(result.status, 'success');
	assert.equal(result.repository?.folderDeleted, false);
	assert.equal(existsSync(slugDirectory), false);
	assert.equal(existsSync(harness.repositoryPath), true);
	assert.equal(
		existsSync(path.join(harness.repositoryPath, '.ensemblr-archived')),
		true,
	);
});

test('delete refuses to remove a repository folder outside the managed root', async (t) => {
	const harness = createHarness(t);
	const outsidePath = mkdtempSync(path.join(tmpdir(), 'ensemblr-external-'));
	t.after(() => rmSync(outsidePath, { force: true, recursive: true }));

	runGit(outsidePath, ['init', '-b', 'main']);
	const timestamp = fixedNow().toISOString();
	const database = harness.databaseService.getConnection()
		?.database as DatabaseSync;
	database
		.prepare(
			`INSERT INTO repositories (id, slug, name, path, default_branch, created_at, updated_at, metadata_json)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			'repository-external',
			'external',
			'external',
			outsidePath,
			'main',
			timestamp,
			timestamp,
			'{}',
		);

	const service = createDeleteRepositoryService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		rootDirectoryService: rootDirectoryStub(harness),
		workspaceTeardownService: buildWorkspaceTeardownStub(),
	});

	const result = await service.delete({
		deleteFolder: true,
		repositoryId: 'repository-external',
	});

	assert.equal(result.status, 'success');
	assert.equal(result.repository?.folderDeleted, false);
	assert.equal(existsSync(outsidePath), true);
	assert.equal(
		result.diagnostics.some(
			(diagnostic) => diagnostic.code === 'repository-folder-external',
		),
		true,
	);
	assert.equal(
		existsSync(path.join(outsidePath, '.ensemblr-archived')),
		true,
		'a refused folder still gets the sentinel so it is not re-adopted',
	);
});

test('delete refuses a repository path that symlinks out of the managed root', async (t) => {
	const harness = createHarness(t);
	const outsidePath = mkdtempSync(path.join(tmpdir(), 'ensemblr-symlinked-'));
	t.after(() => rmSync(outsidePath, { force: true, recursive: true }));
	writeFileSync(path.join(outsidePath, 'precious.txt'), 'do not delete\n');

	const linkPath = path.join(harness.rootPath, 'repos', 'evil');
	symlinkSync(outsidePath, linkPath);

	const timestamp = fixedNow().toISOString();
	const database = harness.databaseService.getConnection()
		?.database as DatabaseSync;
	database
		.prepare(
			`INSERT INTO repositories (id, slug, name, path, default_branch, created_at, updated_at, metadata_json)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			'repository-symlinked',
			'evil',
			'evil',
			linkPath,
			'main',
			timestamp,
			timestamp,
			'{}',
		);

	const service = createDeleteRepositoryService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		rootDirectoryService: rootDirectoryStub(harness),
		workspaceTeardownService: buildWorkspaceTeardownStub(),
	});

	const result = await service.delete({
		deleteFolder: true,
		repositoryId: 'repository-symlinked',
	});

	assert.equal(result.repository?.folderDeleted, false);
	assert.equal(existsSync(path.join(outsidePath, 'precious.txt')), true);
	assert.equal(
		result.diagnostics.some(
			(diagnostic) => diagnostic.code === 'repository-folder-external',
		),
		true,
	);
});

test('delete purges the private ensemblr refs when the folder is kept', async (t) => {
	const harness = createHarness(t);
	runGit(harness.repositoryPath, [
		'update-ref',
		'refs/ensemblr/archived/workspace-x',
		'HEAD',
	]);

	const service = createDeleteRepositoryService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		rootDirectoryService: rootDirectoryStub(harness),
		workspaceTeardownService: buildWorkspaceTeardownStub(),
	});

	await service.delete({ repositoryId: harness.repositoryId });

	const refs = runGit(harness.repositoryPath, [
		'for-each-ref',
		'--format=%(refname)',
		'refs/ensemblr/',
	]);
	assert.equal(refs, '');
});

test('delete drops the repository-scoped Infisical link row', async (t) => {
	const harness = createHarness(t);
	const database = harness.databaseService.getConnection()
		?.database as DatabaseSync;
	database
		.prepare(
			`INSERT INTO infisical_links (scope, scope_id, project_id, environment_slug, folder_path, recursive, enabled)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		)
		.run('repository', harness.repositoryId, 'proj-1', 'dev', '/', 0, 1);

	const service = createDeleteRepositoryService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		rootDirectoryService: rootDirectoryStub(harness),
		workspaceTeardownService: buildWorkspaceTeardownStub(),
	});

	await service.delete({ repositoryId: harness.repositoryId });

	const remaining = database
		.prepare('SELECT * FROM infisical_links WHERE scope = ? AND scope_id = ?')
		.all('repository', harness.repositoryId);
	assert.equal(remaining.length, 0);
});
