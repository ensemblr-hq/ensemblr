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
import { createDeleteWorkspaceService } from '../../src/main/repository/delete-workspace.ts';
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
	repositorySlug: string;
	rootPath: string;
	workspacesPath: string;
}

function createHarness(t: TestContext): Harness {
	const rootPath = mkdtempSync(path.join(tmpdir(), 'ensemble-delete-'));
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
	const repositorySlug = 'demo';
	const timestamp = fixedNow().toISOString();
	connection.database
		.prepare(
			`INSERT INTO repositories (id, slug, name, path, default_branch, created_at, updated_at, metadata_json)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			repositoryId,
			repositorySlug,
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
		repositorySlug,
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

function workspaceRow(
	databaseService: EnsembleDatabaseService,
	id: string,
): Record<string, unknown> | undefined {
	const database = databaseService.getConnection()?.database as DatabaseSync;
	const row = database.prepare('SELECT * FROM workspaces WHERE id = ?').get(id);
	return row as Record<string, unknown> | undefined;
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

test('delete removes the worktree, drops the branch, and deletes the row', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'cleanup-me');

	const deleteService = createDeleteWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
	});

	const result = await deleteService.delete({ workspaceId: workspace.id });

	assert.equal(result.status, 'success');
	assert.ok(result.workspace);
	assert.equal(result.workspace?.id, workspace.id);
	assert.equal(result.pathRemoved, true);
	assert.equal(result.branchDeleted, true);
	assert.equal(existsSync(workspace.path), false);
	assert.equal(workspaceRow(harness.databaseService, workspace.id), undefined);

	const remainingBranches = listBranches(harness.repositoryPath);
	assert.equal(remainingBranches.includes('cleanup-me'), false);

	const remainingWorktrees = listWorktreePaths(harness.repositoryPath);
	assert.equal(remainingWorktrees.includes(workspace.path), false);
});

test('delete succeeds even when the worktree directory was already removed', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'already-gone');

	rmSync(workspace.path, { force: true, recursive: true });
	assert.equal(existsSync(workspace.path), false);

	const deleteService = createDeleteWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
	});

	const result = await deleteService.delete({ workspaceId: workspace.id });

	assert.equal(result.status, 'success');
	assert.equal(result.pathRemoved, true);
	assert.equal(workspaceRow(harness.databaseService, workspace.id), undefined);
});

test('delete rejects when the workspace id is missing or unknown', async (t) => {
	const harness = createHarness(t);
	const deleteService = createDeleteWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
	});

	const missingId = await deleteService.delete({ workspaceId: '' });
	assert.equal(missingId.status, 'failure');
	assert.equal(missingId.diagnostics[0]?.code, 'workspace-id-required');

	const notFound = await deleteService.delete({
		workspaceId: 'workspace-not-real',
	});
	assert.equal(notFound.status, 'failure');
	assert.equal(notFound.diagnostics[0]?.code, 'workspace-not-found');
});
