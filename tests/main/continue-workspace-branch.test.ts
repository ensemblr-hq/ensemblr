import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
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
import type { LocalCommandService } from '../../src/main/commands/local-command.ts';
import { createLocalCommandService } from '../../src/main/commands/local-command.ts';
import {
	readCachedPullRequestSnapshot,
	writeCachedPullRequestSnapshot,
} from '../../src/main/github/pr-cache.ts';
import { createContinueWorkspaceBranchService } from '../../src/main/repository/continue-workspace-branch.ts';
import { readContinuedBranches } from '../../src/main/repository/continued-branches.ts';
import { createWorkspaceService } from '../../src/main/repository/create-workspace.ts';
import type { EnsemblrRootDirectoryService } from '../../src/main/root';
import {
	type EnsemblrDatabaseConnection,
	type EnsemblrDatabaseService,
	openEnsemblrDatabase,
} from '../../src/main/storage/database.ts';
import type { RootDirectorySnapshot } from '../../src/shared/ipc';

const fixedNow = () => new Date('2026-06-08T12:00:00.000Z');

interface Harness {
	databaseService: EnsemblrDatabaseService;
	repositoryId: string;
	repositoryPath: string;
	rootPath: string;
	rootService: EnsemblrRootDirectoryService;
	workspacesPath: string;
}

function createHarness(t: TestContext): Harness {
	const rootPath = realpathSync(
		mkdtempSync(path.join(tmpdir(), 'ensemblr-continue-')),
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

	t.after(() => {
		connection.database.close();
		rmSync(rootPath, { force: true, recursive: true });
	});

	return {
		databaseService: wrapConnection(connection),
		repositoryId,
		repositoryPath,
		rootPath,
		rootService: rootDirectoryStub({ rootPath, workspacesPath }),
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

function rootDirectoryStub({
	rootPath,
	workspacesPath,
}: {
	rootPath: string;
	workspacesPath: string;
}): EnsemblrRootDirectoryService {
	const snapshot: RootDirectorySnapshot = {
		archivedContextsPath: path.join(rootPath, 'archived-contexts'),
		createdPaths: [],
		diagnostics: [],
		managedPaths: [],
		path: rootPath,
		repositoriesPath: path.join(rootPath, 'repos'),
		setting: null,
		source: null,
		status: 'ok',
		workspacesPath,
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

function currentBranch(cwd: string): string {
	return runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
}

function branchExists(repositoryPath: string, branch: string): boolean {
	try {
		runGit(repositoryPath, ['show-ref', '--verify', `refs/heads/${branch}`]);
		return true;
	} catch {
		return false;
	}
}

function commitFile(cwd: string, name: string, contents: string): void {
	writeFileSync(path.join(cwd, name), contents);
	runGit(cwd, ['add', name]);
	runGit(cwd, ['commit', '-m', `add ${name}`]);
}

/** Squash-merges `branch` into `main`, mirroring `gh pr merge --squash`. */
function squashMergeIntoMain(repositoryPath: string, branch: string): void {
	runGit(repositoryPath, ['merge', '--squash', branch]);
	runGit(repositoryPath, ['commit', '-m', `${branch} (#1)`]);
}

async function seedWorkspace(harness: Harness, name: string) {
	const service = createWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
		rootDirectoryService: harness.rootService,
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

function createService(
	harness: Harness,
	overrides: {
		databaseService?: EnsemblrDatabaseService;
		localCommandService?: LocalCommandService;
	} = {},
) {
	return createContinueWorkspaceBranchService({
		databaseService: overrides.databaseService ?? harness.databaseService,
		localCommandService:
			overrides.localCommandService ?? createLocalCommandService(),
		now: fixedNow,
	});
}

/**
 * Git args that always exit non-zero without touching the repository, so a
 * forced failure still travels through the real command service and carries a
 * genuine result shape.
 */
const FORCED_GIT_FAILURE_ARGS = [
	'rev-parse',
	'--verify',
	'--quiet',
	'refs/heads/__ensemblr_forced_failure__',
];

/** Wraps the real command service, failing every git call the predicate picks. */
function gitServiceFailing(
	shouldFail: (args: readonly string[]) => boolean,
): LocalCommandService {
	const real = createLocalCommandService();
	return {
		getEnvironment: (cwd) => real.getEnvironment(cwd),
		run: (request, options) =>
			real.run(
				request.command === 'git' && shouldFail(request.args ?? [])
					? { ...request, args: FORCED_GIT_FAILURE_ARGS }
					: request,
				options,
			),
	};
}

/** Database service whose `workspaces` UPDATE always throws, to force a rollback. */
function databaseServiceRejectingWorkspaceUpdate(
	harness: Harness,
): EnsemblrDatabaseService {
	const connection = harness.databaseService.getConnection();
	if (!connection) {
		throw new Error('database unavailable');
	}
	const guarded = new Proxy(connection.database, {
		get(target, property, receiver) {
			if (property === 'prepare') {
				return (sql: string) => {
					if (sql.includes('UPDATE workspaces')) {
						throw new Error('workspaces row is locked');
					}
					return target.prepare(sql);
				};
			}
			const value = Reflect.get(target, property, receiver);
			return typeof value === 'function' ? value.bind(target) : value;
		},
	}) as DatabaseSync;
	return {
		...harness.databaseService,
		getConnection: () => ({ ...connection, database: guarded }),
	};
}

function workspaceRow(
	harness: Harness,
	id: string,
): { branchName: string | null; metadataJson: string } {
	const database = harness.databaseService.getConnection()?.database;
	if (!database) {
		throw new Error('database unavailable');
	}
	const row = database
		.prepare(
			'SELECT branch_name AS branchName, metadata_json AS metadataJson FROM workspaces WHERE id = ?',
		)
		.get(id) as { branchName: string | null; metadataJson: string } | undefined;
	if (!row) {
		throw new Error(`workspace ${id} not found`);
	}
	return row;
}

test('continue branches onto -v1 and leaves the merged branch in place', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'Bach');

	const result = await createService(harness).continueBranch({
		workspaceId: workspace.id,
	});

	assert.equal(result.status, 'success');
	assert.equal(result.branchName, 'bach-v1');
	assert.equal(result.previousBranchName, 'bach');
	assert.deepEqual(result.diagnostics, []);
	assert.equal(currentBranch(workspace.path), 'bach-v1');
	assert.equal(workspaceRow(harness, workspace.id).branchName, 'bach-v1');
	assert.equal(branchExists(harness.repositoryPath, 'bach'), true);
});

test('continue bumps the marker on a repeat instead of stacking', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'Bach');
	const service = createService(harness);

	await service.continueBranch({ workspaceId: workspace.id });
	const second = await service.continueBranch({ workspaceId: workspace.id });

	assert.equal(second.status, 'success');
	assert.equal(second.branchName, 'bach-v2');
	assert.equal(second.previousBranchName, 'bach-v1');
	assert.equal(currentBranch(workspace.path), 'bach-v2');
});

test('continue records every branch it moved off for later cleanup', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'Bach');
	const service = createService(harness);

	await service.continueBranch({ workspaceId: workspace.id });
	await service.continueBranch({ workspaceId: workspace.id });

	assert.deepEqual(
		readContinuedBranches(workspaceRow(harness, workspace.id).metadataJson),
		['bach', 'bach-v1'],
	);
});

test('continue carries uncommitted work onto the new branch', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'Bach');
	writeFileSync(path.join(workspace.path, 'draft.txt'), 'in progress\n');

	await createService(harness).continueBranch({ workspaceId: workspace.id });

	assert.match(runGit(workspace.path, ['status', '--porcelain']), /draft\.txt/);
});

test('continue forks from the base once the work is squash-merged', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'Bach');
	commitFile(workspace.path, 'feature.txt', 'shipped\n');
	squashMergeIntoMain(harness.repositoryPath, 'bach');

	const result = await createService(harness).continueBranch({
		workspaceId: workspace.id,
	});

	assert.equal(result.status, 'success');
	assert.deepEqual(result.diagnostics, []);
	assert.equal(
		runGit(workspace.path, ['diff', '--name-only', 'main...bach-v1']),
		'',
	);
	assert.equal(
		runGit(workspace.path, ['rev-parse', 'bach-v1']),
		runGit(harness.repositoryPath, ['rev-parse', 'main']),
	);
});

test('continue forking from the base keeps edits to already-merged files', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'Bach');
	commitFile(workspace.path, 'feature.txt', 'shipped\n');
	squashMergeIntoMain(harness.repositoryPath, 'bach');
	writeFileSync(path.join(workspace.path, 'feature.txt'), 'edited again\n');

	const result = await createService(harness).continueBranch({
		workspaceId: workspace.id,
	});

	assert.equal(result.status, 'success');
	assert.equal(
		runGit(workspace.path, ['diff', '--name-only']),
		'feature.txt',
		'the uncommitted edit must survive the fork onto the base',
	);
});

test('continue keeps commits the base has not taken and warns about them', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'Bach');
	commitFile(workspace.path, 'feature.txt', 'shipped\n');
	squashMergeIntoMain(harness.repositoryPath, 'bach');
	commitFile(workspace.path, 'followup.txt', 'not merged yet\n');

	const result = await createService(harness).continueBranch({
		workspaceId: workspace.id,
	});

	assert.equal(result.status, 'success');
	assert.equal(result.diagnostics[0]?.code, 'base-branch-unsynced');
	assert.equal(result.diagnostics[0]?.severity, 'warning');
	assert.equal(
		runGit(workspace.path, ['rev-parse', 'bach-v1']),
		runGit(workspace.path, ['rev-parse', 'bach']),
	);
	assert.match(
		runGit(workspace.path, ['diff', '--name-only', 'main...bach-v1']),
		/followup\.txt/,
	);
});

test('continue skips a name that survives only as a remote-tracking ref', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'Bach');
	const head = runGit(harness.repositoryPath, ['rev-parse', 'main']);
	runGit(harness.repositoryPath, [
		'update-ref',
		'refs/remotes/origin/bach-v1',
		head,
	]);

	const result = await createService(harness).continueBranch({
		workspaceId: workspace.id,
	});

	assert.equal(result.status, 'success');
	assert.equal(result.branchName, 'bach-v2');
	assert.equal(branchExists(harness.repositoryPath, 'bach-v1'), false);
});

test('continue drops the cached pull-request snapshot', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'Bach');
	const database = harness.databaseService.getConnection()?.database;
	assert.ok(database);
	writeCachedPullRequestSnapshot({
		database,
		snapshot: {
			branchSync: null,
			pullRequest: null,
			syncedAt: fixedNow().toISOString(),
		},
		workspaceId: workspace.id,
	});

	await createService(harness).continueBranch({ workspaceId: workspace.id });

	assert.equal(
		readCachedPullRequestSnapshot({ database, workspaceId: workspace.id }),
		null,
	);
});

test('continue reports a diagnostic for an unknown workspace', async (t) => {
	const harness = createHarness(t);

	const result = await createService(harness).continueBranch({
		workspaceId: 'missing-workspace',
	});

	assert.equal(result.status, 'failure');
	assert.equal(result.branchName, null);
	assert.equal(result.diagnostics[0]?.code, 'workspace-not-found');
});

test('continue reports a diagnostic when SQLite is unavailable', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'Bach');

	const result = await createService(harness, {
		databaseService: { ...harness.databaseService, getConnection: () => null },
	}).continueBranch({ workspaceId: workspace.id });

	assert.equal(result.status, 'failure');
	assert.equal(result.diagnostics[0]?.code, 'database-unavailable');
	assert.equal(currentBranch(workspace.path), 'bach');
});

test('continue reports a diagnostic when the branch cannot be resolved', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'Bach');
	const database = harness.databaseService.getConnection()?.database;
	assert.ok(database);
	database
		.prepare('UPDATE workspaces SET branch_name = NULL WHERE id = ?')
		.run(workspace.id);
	runGit(workspace.path, ['checkout', '--detach']);

	const result = await createService(harness).continueBranch({
		workspaceId: workspace.id,
	});

	assert.equal(result.status, 'failure');
	assert.equal(result.diagnostics[0]?.code, 'branch-unresolved');
});

test('continue reports a diagnostic when the checkout fails', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'Bach');

	const result = await createService(harness, {
		localCommandService: gitServiceFailing(
			(args) => args[0] === 'checkout' && args[1] === '-b',
		),
	}).continueBranch({ workspaceId: workspace.id });

	assert.equal(result.status, 'failure');
	assert.equal(result.diagnostics[0]?.code, 'branch-checkout-failed');
	assert.equal(currentBranch(workspace.path), 'bach');
	assert.equal(workspaceRow(harness, workspace.id).branchName, 'bach');
});

test('continue rolls the worktree back when the SQLite write fails', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'Bach');

	const result = await createService(harness, {
		databaseService: databaseServiceRejectingWorkspaceUpdate(harness),
	}).continueBranch({ workspaceId: workspace.id });

	assert.equal(result.status, 'failure');
	assert.equal(result.diagnostics[0]?.code, 'workspace-update-failed');
	assert.equal(result.diagnostics.length, 1);
	assert.equal(currentBranch(workspace.path), 'bach');
	assert.equal(branchExists(harness.repositoryPath, 'bach-v1'), false);
	assert.equal(workspaceRow(harness, workspace.id).branchName, 'bach');
});

test('continue warns when the rollback itself cannot restore the worktree', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'Bach');

	const result = await createService(harness, {
		databaseService: databaseServiceRejectingWorkspaceUpdate(harness),
		localCommandService: gitServiceFailing(
			(args) => args[0] === 'checkout' && args[1] !== '-b',
		),
	}).continueBranch({ workspaceId: workspace.id });

	assert.equal(result.status, 'failure');
	assert.equal(result.diagnostics[0]?.code, 'workspace-update-failed');
	assert.equal(result.diagnostics[1]?.code, 'branch-rollback-failed');
	assert.equal(result.diagnostics[1]?.severity, 'warning');
	assert.match(result.diagnostics[1]?.message ?? '', /bach-v1/);
	assert.equal(currentBranch(workspace.path), 'bach-v1');
});
