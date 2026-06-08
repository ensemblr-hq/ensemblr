import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';

import { createLocalCommandService } from '../../src/main/commands/local-command.ts';
import { createWorkspaceService } from '../../src/main/repository/create-workspace.ts';
import type { EnsembleRootDirectoryService } from '../../src/main/root';
import {
	type EnsembleDatabaseConnection,
	type EnsembleDatabaseService,
	openEnsembleDatabase,
} from '../../src/main/storage/database.ts';
import type { RootDirectorySnapshot } from '../../src/shared/ipc';

const fixedNow = () => new Date('2026-06-08T12:00:00.000Z');

interface Harness {
	databaseService: EnsembleDatabaseService;
	repositoryId: string;
	repositoryPath: string;
	repositorySlug: string;
	rootPath: string;
	workspacesPath: string;
}

/**
 * Builds a sandbox: tmp root with `workspaces/`, a real git repo with one
 * commit on `main`, an in-memory SQLite seeded with that repository row.
 */
function createHarness(t: TestContext): Harness {
	const rootPath = mkdtempSync(path.join(tmpdir(), 'ensemble-workspace-'));
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

function rootDirectoryStub(
	harness: Pick<Harness, 'rootPath' | 'workspacesPath'>,
): EnsembleRootDirectoryService {
	const snapshot: RootDirectorySnapshot = {
		archivedContextsPath: path.join(harness.rootPath, 'archived-contexts'),
		createdPaths: [],
		diagnostics: [],
		managedPaths: [],
		path: harness.rootPath,
		repositoriesPath: path.join(harness.rootPath, 'repos'),
		setting: null,
		source: null,
		status: 'ok',
		workspacesPath: harness.workspacesPath,
	};
	return {
		applyChange: () => ({
			applied: false,
			newRoot: snapshot,
			oldRoot: snapshot,
			oldRootPreserved: true,
			reconciliation: null,
		}),
		ensure: () => snapshot,
		getSnapshot: () => snapshot,
		previewChange: () => ({
			canApply: false,
			diagnostics: [],
			newRoot: snapshot,
			oldRoot: snapshot,
			oldRootPreserved: true,
		}),
	};
}

function runGit(cwd: string, args: string[]): string {
	return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function listWorktrees(repositoryPath: string): string[] {
	return runGit(repositoryPath, ['worktree', 'list', '--porcelain'])
		.split(/\r?\n/)
		.filter((line) => line.startsWith('worktree '))
		.map((line) => line.slice('worktree '.length));
}

function workspaceRow(
	databaseService: EnsembleDatabaseService,
	id: string,
): Record<string, unknown> | null {
	const database = databaseService.getConnection()?.database as DatabaseSync;
	const row = database.prepare('SELECT * FROM workspaces WHERE id = ?').get(id);
	return row as Record<string, unknown> | null;
}

test('create produces a git worktree on a new branch from the configured base', async (t) => {
	const harness = createHarness(t);
	const service = createWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
		rootDirectoryService: rootDirectoryStub(harness),
	});

	const result = await service.create({
		name: 'feature-login',
		repositoryId: harness.repositoryId,
	});

	assert.equal(result.status, 'success');
	assert.ok(result.workspace);
	const { workspace } = result;
	if (!workspace) {
		throw new Error('workspace missing');
	}
	assert.equal(workspace.slug, 'feature-login');
	assert.equal(workspace.name, 'feature-login');
	assert.equal(workspace.branchName, 'feature-login');
	assert.equal(workspace.baseBranch, 'main');
	assert.equal(workspace.repositoryId, harness.repositoryId);
	assert.equal(
		workspace.path,
		path.join(harness.workspacesPath, harness.repositorySlug, 'feature-login'),
	);
	assert.equal(existsSync(workspace.path), true);
	assert.equal(existsSync(path.join(workspace.path, '.context')), true);

	const worktrees = listWorktrees(harness.repositoryPath).map((entry) =>
		realpathSync(entry),
	);
	assert.ok(worktrees.includes(realpathSync(workspace.path)));

	const headBranch = runGit(workspace.path, [
		'rev-parse',
		'--abbrev-ref',
		'HEAD',
	]);
	assert.equal(headBranch, 'feature-login');

	const row = workspaceRow(harness.databaseService, workspace.id);
	assert.ok(row);
	assert.equal(row?.path, workspace.path);
	assert.equal(row?.slug, 'feature-login');
	assert.equal(row?.branch_name, 'feature-login');
	assert.equal(row?.base_branch, 'main');
});

test('create defaults the workspace name to a placeholder slug', async (t) => {
	const harness = createHarness(t);
	const service = createWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
		rootDirectoryService: rootDirectoryStub(harness),
	});

	const first = await service.create({ repositoryId: harness.repositoryId });
	const second = await service.create({ repositoryId: harness.repositoryId });

	assert.equal(first.status, 'success');
	assert.equal(second.status, 'success');
	assert.equal(first.workspace?.slug, 'workspace');
	assert.equal(second.workspace?.slug, 'workspace-2');
	assert.notEqual(first.workspace?.path, second.workspace?.path);
});

test('create rejects an unknown repository id', async (t) => {
	const harness = createHarness(t);
	const service = createWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
		rootDirectoryService: rootDirectoryStub(harness),
	});

	const result = await service.create({
		name: 'orphan',
		repositoryId: 'repository-missing',
	});

	assert.equal(result.status, 'failure');
	assert.equal(result.diagnostics[0]?.code, 'repository-not-found');
});

test('create rejects a missing repository id', async (t) => {
	const harness = createHarness(t);
	const service = createWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
		rootDirectoryService: rootDirectoryStub(harness),
	});

	const result = await service.create({ repositoryId: '   ' });
	assert.equal(result.status, 'failure');
	assert.equal(result.diagnostics[0]?.code, 'repository-id-required');
});

test('create rejects names that contain unsafe characters', async (t) => {
	const harness = createHarness(t);
	const service = createWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
		rootDirectoryService: rootDirectoryStub(harness),
	});

	const slashed = await service.create({
		name: 'foo/bar',
		repositoryId: harness.repositoryId,
	});
	assert.equal(slashed.status, 'failure');
	assert.equal(slashed.diagnostics[0]?.code, 'name-invalid');

	const dotted = await service.create({
		name: '.hidden',
		repositoryId: harness.repositoryId,
	});
	assert.equal(dotted.status, 'failure');
	assert.equal(dotted.diagnostics[0]?.code, 'name-invalid');
});

test('create fails when the workspace path already exists on disk', async (t) => {
	const harness = createHarness(t);
	const existingPath = path.join(
		harness.workspacesPath,
		harness.repositorySlug,
		'collision',
	);
	mkdirSync(existingPath, { recursive: true });

	const service = createWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
		rootDirectoryService: rootDirectoryStub(harness),
	});

	const result = await service.create({
		name: 'collision',
		repositoryId: harness.repositoryId,
	});

	assert.equal(result.status, 'failure');
	assert.equal(result.diagnostics[0]?.code, 'destination-exists');

	const database = harness.databaseService.getConnection()
		?.database as DatabaseSync;
	const count = database
		.prepare('SELECT COUNT(*) AS count FROM workspaces')
		.get() as { count: number };
	assert.equal(count.count, 0);
});

test('create rolls back the directory and skips the SQLite row when git fails', async (t) => {
	const harness = createHarness(t);
	const service = createWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
		rootDirectoryService: rootDirectoryStub(harness),
	});

	const result = await service.create({
		baseBranch: 'does-not-exist',
		name: 'bad-base',
		repositoryId: harness.repositoryId,
	});

	assert.equal(result.status, 'failure');
	assert.equal(result.diagnostics[0]?.code, 'git-worktree-failed');
	assert.equal(
		existsSync(
			path.join(harness.workspacesPath, harness.repositorySlug, 'bad-base'),
		),
		false,
	);

	const database = harness.databaseService.getConnection()
		?.database as DatabaseSync;
	const count = database
		.prepare('SELECT COUNT(*) AS count FROM workspaces')
		.get() as { count: number };
	assert.equal(count.count, 0);
});

test('create honors caller-supplied branchName and baseBranch', async (t) => {
	const harness = createHarness(t);
	runGit(harness.repositoryPath, ['branch', 'develop']);

	const service = createWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
		rootDirectoryService: rootDirectoryStub(harness),
	});

	const result = await service.create({
		baseBranch: 'develop',
		branchName: 'philipp/the-121',
		name: 'ticket',
		repositoryId: harness.repositoryId,
	});

	assert.equal(result.status, 'success');
	assert.equal(result.workspace?.branchName, 'philipp/the-121');
	assert.equal(result.workspace?.baseBranch, 'develop');
	if (!result.workspace) {
		throw new Error('workspace missing');
	}
	const headBranch = runGit(result.workspace.path, [
		'rev-parse',
		'--abbrev-ref',
		'HEAD',
	]);
	assert.equal(headBranch, 'philipp/the-121');
});
