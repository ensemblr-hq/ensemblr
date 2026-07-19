/// <reference types="node" />

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
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
import {
	type EnsemblrDatabaseConnection,
	type EnsemblrDatabaseService,
	openEnsemblrDatabase,
} from '../../src/main/storage/database.ts';
import type { GitSettings } from '../../src/shared/config/app-settings.ts';
import { buildRootDirectoryStub } from './helpers/root-directory-stub.ts';

const fixedNow = () => new Date('2026-06-08T12:00:00.000Z');

function gitDefaults(overrides: Partial<GitSettings> = {}): GitSettings {
	return {
		branchPrefixSource: 'github-username',
		branchPrefixCustom: '',
		renameWorkspaceOnBranch: true,
		deleteLocalBranchOnArchive: false,
		archiveAfterMerge: false,
		setUpstreamOnPush: true,
		...overrides,
	};
}

interface Harness {
	databaseService: EnsemblrDatabaseService;
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
	const rootPath = mkdtempSync(path.join(tmpdir(), 'ensemblr-workspace-'));
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

function listWorktrees(repositoryPath: string): string[] {
	return runGit(repositoryPath, ['worktree', 'list', '--porcelain'])
		.split(/\r?\n/)
		.filter((line) => line.startsWith('worktree '))
		.map((line) => line.slice('worktree '.length));
}

/** Reads the worktree's shared git exclude (`<git-common-dir>/info/exclude`). */
function readGitExclude(workspacePath: string): string {
	const commonDir = runGit(workspacePath, ['rev-parse', '--git-common-dir']);
	const resolved = path.isAbsolute(commonDir)
		? commonDir
		: path.resolve(workspacePath, commonDir);
	const excludePath = path.join(resolved, 'info', 'exclude');
	return existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : '';
}

function workspaceRow(
	databaseService: EnsemblrDatabaseService,
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
	// `.context/` is no longer created eagerly: the workspace root stays empty
	// so first-turn scaffolders (e.g. create-next-app) can run against it. It is
	// instead registered in the worktree's local git exclude.
	assert.equal(existsSync(path.join(workspace.path, '.context')), false);
	assert.match(readGitExclude(workspace.path), /^\.context\/$/m);

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

test('registers .context/ in the git exclude exactly once across workspaces', async (t) => {
	const harness = createHarness(t);
	const service = createWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
		rootDirectoryService: rootDirectoryStub(harness),
	});

	const first = await service.create({
		name: 'alpha',
		repositoryId: harness.repositoryId,
	});
	const second = await service.create({
		name: 'beta',
		repositoryId: harness.repositoryId,
	});
	assert.equal(first.status, 'success');
	assert.equal(second.status, 'success');
	if (!first.workspace || !second.workspace) {
		throw new Error('workspace missing');
	}

	// Both worktrees share the repo's common git dir, so the idempotent writer
	// must leave a single `.context/` rule rather than one per workspace.
	const exclude = readGitExclude(second.workspace.path);
	const occurrences = exclude
		.split('\n')
		.filter((line) => line.trim() === '.context/').length;
	assert.equal(occurrences, 1);
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

test('create keeps a placeholder name that no workspace uses', async (t) => {
	const harness = createHarness(t);
	const service = createWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
		rootDirectoryService: rootDirectoryStub(harness),
	});

	const result = await service.create({
		name: 'Bach',
		placeholderName: true,
		repositoryId: harness.repositoryId,
	});

	assert.equal(result.status, 'success');
	assert.equal(result.workspace?.name, 'Bach');
	assert.equal(result.workspace?.slug, 'bach');
});

test('create repicks a placeholder name an active workspace already uses', async (t) => {
	const harness = createHarness(t);
	const service = createWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
		rootDirectoryService: rootDirectoryStub(harness),
	});

	const first = await service.create({
		name: 'Bach',
		placeholderName: true,
		repositoryId: harness.repositoryId,
	});
	const second = await service.create({
		name: 'Bach',
		placeholderName: true,
		repositoryId: harness.repositoryId,
	});

	assert.equal(first.workspace?.name, 'Bach');
	assert.equal(second.status, 'success');
	assert.notEqual(second.workspace?.name, 'Bach');
	assert.notEqual(second.workspace?.slug, 'bach');
});

test('create repicks a placeholder name a workspace used before a rename', async (t) => {
	const harness = createHarness(t);
	const service = createWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
		rootDirectoryService: rootDirectoryStub(harness),
	});

	const first = await service.create({
		name: 'Bach',
		placeholderName: true,
		repositoryId: harness.repositoryId,
	});
	if (!first.workspace) {
		throw new Error('first workspace missing');
	}
	// Rename keeps the original slug ("bach") while the display name changes, so
	// the slug is the only trace of the pre-rename name. Mimic that here.
	const database = harness.databaseService.getConnection()
		?.database as DatabaseSync;
	database
		.prepare('UPDATE workspaces SET name = ? WHERE id = ?')
		.run('Feature login', first.workspace.id);

	const second = await service.create({
		name: 'Bach',
		placeholderName: true,
		repositoryId: harness.repositoryId,
	});

	assert.equal(second.status, 'success');
	assert.notEqual(second.workspace?.name, 'Bach');
	assert.notEqual(second.workspace?.slug, 'bach');
});

test('create repicks a multi-word placeholder name whose slug is taken', async (t) => {
	const harness = createHarness(t);
	const service = createWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
		rootDirectoryService: rootDirectoryStub(harness),
	});

	const first = await service.create({
		name: 'Saint Saens',
		placeholderName: true,
		repositoryId: harness.repositoryId,
	});
	if (!first.workspace) {
		throw new Error('first workspace missing');
	}
	assert.equal(first.workspace.slug, 'saint-saens');
	// Rename away from the spaced name so only the dashed slug ("saint-saens")
	// remains. The repick must match the candidate's slug form, not just its
	// lowercased spaced form, or it would re-offer "Saint Saens".
	const database = harness.databaseService.getConnection()
		?.database as DatabaseSync;
	database
		.prepare('UPDATE workspaces SET name = ? WHERE id = ?')
		.run('Feature login', first.workspace.id);

	const second = await service.create({
		name: 'Saint Saens',
		placeholderName: true,
		repositoryId: harness.repositoryId,
	});

	assert.equal(second.status, 'success');
	assert.notEqual(second.workspace?.name, 'Saint Saens');
	assert.notEqual(second.workspace?.slug, 'saint-saens');
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

test('create removes its branch when the workspace row insert fails', async (t) => {
	const harness = createHarness(t);
	const database = harness.databaseService.getConnection()
		?.database as DatabaseSync;
	database.exec(`
		CREATE TRIGGER fail_workspace_insert
		BEFORE INSERT ON workspaces
		BEGIN
			SELECT RAISE(ABORT, 'forced workspace insert failure');
		END;
	`);
	const service = createWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
		rootDirectoryService: rootDirectoryStub(harness),
	});

	const result = await service.create({
		name: 'insert-failure',
		repositoryId: harness.repositoryId,
	});

	assert.equal(result.status, 'failure');
	assert.equal(result.diagnostics[0]?.code, 'workspace-insert-failed');
	assert.equal(
		existsSync(
			path.join(
				harness.workspacesPath,
				harness.repositorySlug,
				'insert-failure',
			),
		),
		false,
	);
	const branches = runGit(harness.repositoryPath, [
		'branch',
		'--format=%(refname:short)',
	]).split(/\r?\n/);
	assert.equal(branches.includes('insert-failure'), false);
});

test('create records files-to-copy snapshot in the success result', async (t) => {
	const harness = createHarness(t);
	writeFileSync(path.join(harness.repositoryPath, '.gitignore'), '.env*\n');
	mkdirSync(path.join(harness.repositoryPath, 'src'), { recursive: true });
	writeFileSync(
		path.join(harness.repositoryPath, 'src', 'index.ts'),
		'export {};\n',
	);
	runGit(harness.repositoryPath, ['add', 'src/index.ts']);
	runGit(harness.repositoryPath, ['commit', '-m', 'add source file']);
	writeFileSync(
		path.join(harness.repositoryPath, '.env.local'),
		'API_KEY=secret\n',
	);

	const service = createWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
		rootDirectoryService: rootDirectoryStub(harness),
	});

	const result = await service.create({
		name: 'with-copies',
		repositoryId: harness.repositoryId,
	});

	assert.equal(result.status, 'success');
	assert.ok(result.filesToCopy);
	assert.equal(result.filesToCopy?.source, 'default');
	assert.deepEqual(result.filesToCopy?.patterns, ['.env*']);
	assert.equal(result.filesToCopy?.copied.length, 1);
	assert.equal(result.filesToCopy?.copied[0]?.relativePath, '.env.local');
	if (!result.workspace) {
		throw new Error('workspace missing');
	}
	assert.equal(
		existsSync(path.join(result.workspace.path, '.env.local')),
		true,
	);

	const filesToCopyMetadata = result.workspace.metadata.filesToCopy;
	assert.equal(typeof filesToCopyMetadata, 'object');
	assert.notEqual(filesToCopyMetadata, null);
	assert.equal(result.workspace.metadata.workspaceFileCount, 3);
});

test('create succeeds when workspace file counting throws unexpectedly', async (t) => {
	const harness = createHarness(t);
	const commandService = createLocalCommandService();
	const service = createWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: {
			getEnvironment: commandService.getEnvironment,
			run: async (request, options) => {
				if (
					request.command === 'git' &&
					request.args?.[0] === 'ls-files' &&
					request.args[1] === '-z'
				) {
					throw new Error('forced file-count failure');
				}
				return commandService.run(request, options);
			},
		},
		now: fixedNow,
		rootDirectoryService: rootDirectoryStub(harness),
	});

	const result = await service.create({
		name: 'count-failure',
		repositoryId: harness.repositoryId,
	});

	assert.equal(result.status, 'success');
	assert.ok(result.workspace);
	assert.equal(result.workspace?.metadata.workspaceFileCount, undefined);
});

test('create returns null filesToCopy snapshot when it fails before copying', async (t) => {
	const harness = createHarness(t);
	const service = createWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
		rootDirectoryService: rootDirectoryStub(harness),
	});

	const result = await service.create({
		baseBranch: 'does-not-exist',
		name: 'bad-base-copies',
		repositoryId: harness.repositoryId,
	});

	assert.equal(result.status, 'failure');
	assert.equal(result.filesToCopy, null);
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

test('create applies the user custom branch prefix', async (t) => {
	const harness = createHarness(t);
	const service = createWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
		readGitDefaults: () =>
			gitDefaults({
				// No trailing slash — joinBranchName inserts the separator.
				branchPrefixCustom: 'feat',
				branchPrefixSource: 'custom',
			}),
		rootDirectoryService: rootDirectoryStub(harness),
	});

	const result = await service.create({
		name: 'login',
		repositoryId: harness.repositoryId,
	});

	assert.equal(result.status, 'success');
	assert.equal(result.workspace?.slug, 'login'); // slug unaffected by prefix
	assert.equal(result.workspace?.branchName, 'feat/login');
});

test('create applies the github username branch prefix', async (t) => {
	const harness = createHarness(t);
	const service = createWorkspaceService({
		databaseService: harness.databaseService,
		githubUsernameResolver: { resolve: async () => 'octocat' },
		localCommandService: createLocalCommandService(),
		now: fixedNow,
		readGitDefaults: () =>
			gitDefaults({ branchPrefixSource: 'github-username' }),
		rootDirectoryService: rootDirectoryStub(harness),
	});

	const result = await service.create({
		name: 'login',
		repositoryId: harness.repositoryId,
	});

	assert.equal(result.status, 'success');
	assert.equal(result.workspace?.branchName, 'octocat/login');
});

test('create omits the prefix when the github username is unavailable', async (t) => {
	const harness = createHarness(t);
	const service = createWorkspaceService({
		databaseService: harness.databaseService,
		githubUsernameResolver: { resolve: async () => null },
		localCommandService: createLocalCommandService(),
		now: fixedNow,
		readGitDefaults: () =>
			gitDefaults({ branchPrefixSource: 'github-username' }),
		rootDirectoryService: rootDirectoryStub(harness),
	});

	const result = await service.create({
		name: 'login',
		repositoryId: harness.repositoryId,
	});

	assert.equal(result.status, 'success');
	assert.equal(result.workspace?.branchName, 'login');
});

test('repository git.branchPrefix overrides the user branch prefix', async (t) => {
	const harness = createHarness(t);
	mkdirSync(path.join(harness.repositoryPath, '.ensemblr'), {
		recursive: true,
	});
	writeFileSync(
		path.join(harness.repositoryPath, '.ensemblr', 'settings.toml'),
		'[git]\nbranchPrefix = "team/"\n',
	);
	const service = createWorkspaceService({
		databaseService: harness.databaseService,
		githubUsernameResolver: { resolve: async () => 'octocat' },
		localCommandService: createLocalCommandService(),
		now: fixedNow,
		readGitDefaults: () =>
			gitDefaults({ branchPrefixSource: 'github-username' }),
		rootDirectoryService: rootDirectoryStub(harness),
	});

	const result = await service.create({
		name: 'login',
		repositoryId: harness.repositoryId,
	});

	assert.equal(result.status, 'success');
	assert.equal(result.workspace?.branchName, 'team/login');
});

test('always branches from the live root, ignoring HEAD and a stale stored default', async (t) => {
	const harness = createHarness(t);
	// Source repo is parked on a feature branch...
	runGit(harness.repositoryPath, ['checkout', '-b', 'feature/x']);
	// ...and the stored default is stale (points at that feature branch).
	const database = harness.databaseService.getConnection()
		?.database as DatabaseSync;
	database
		.prepare('UPDATE repositories SET default_branch = ? WHERE id = ?')
		.run('feature/x', harness.repositoryId);

	const service = createWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
		rootDirectoryService: rootDirectoryStub(harness),
	});

	const result = await service.create({
		name: 'login',
		repositoryId: harness.repositoryId,
	});

	assert.equal(result.status, 'success');
	// Live root ('main') wins over the current HEAD and the stale stored default.
	assert.equal(result.workspace?.baseBranch, 'main');
});

test('syncs the default branch from origin before creating a workspace', async (t) => {
	const harness = createHarness(t);
	const remotePath = path.join(harness.rootPath, 'remote.git');
	const collaboratorPath = path.join(harness.rootPath, 'collaborator');
	runGit(harness.rootPath, ['init', '--bare', remotePath]);
	runGit(remotePath, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
	runGit(harness.repositoryPath, ['remote', 'add', 'origin', remotePath]);
	runGit(harness.repositoryPath, ['push', '-u', 'origin', 'main']);
	runGit(harness.rootPath, ['clone', remotePath, collaboratorPath]);
	runGit(collaboratorPath, ['config', 'user.email', 'test@ensemblr.dev']);
	runGit(collaboratorPath, ['config', 'user.name', 'Ensemblr Test']);
	writeFileSync(
		path.join(collaboratorPath, 'README.md'),
		'# demo\nlatest remote change\n',
	);
	runGit(collaboratorPath, ['commit', '-am', 'remote change']);
	runGit(collaboratorPath, ['push', 'origin', 'main']);

	const service = createWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
		rootDirectoryService: rootDirectoryStub(harness),
	});

	const result = await service.create({
		name: 'login',
		repositoryId: harness.repositoryId,
	});

	assert.equal(result.status, 'success');
	if (!result.workspace) {
		throw new Error('workspace missing');
	}
	assert.match(
		readFileSync(path.join(result.workspace.path, 'README.md'), 'utf8'),
		/latest remote change/,
	);
	assert.equal(
		runGit(harness.repositoryPath, ['rev-parse', 'main']),
		runGit(collaboratorPath, ['rev-parse', 'main']),
	);
});

test('syncs origin default branch even when local branch has no upstream', async (t) => {
	const harness = createHarness(t);
	const remotePath = path.join(harness.rootPath, 'remote.git');
	const collaboratorPath = path.join(harness.rootPath, 'collaborator');
	runGit(harness.rootPath, ['init', '--bare', remotePath]);
	runGit(remotePath, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
	runGit(harness.repositoryPath, ['remote', 'add', 'origin', remotePath]);
	runGit(harness.repositoryPath, ['push', '-u', 'origin', 'main']);
	runGit(harness.repositoryPath, ['branch', '--unset-upstream', 'main']);
	runGit(harness.rootPath, ['clone', remotePath, collaboratorPath]);
	runGit(collaboratorPath, ['config', 'user.email', 'test@ensemblr.dev']);
	runGit(collaboratorPath, ['config', 'user.name', 'Ensemblr Test']);
	writeFileSync(
		path.join(collaboratorPath, 'README.md'),
		'# demo\nlatest no-upstream change\n',
	);
	runGit(collaboratorPath, ['commit', '-am', 'remote change']);
	runGit(collaboratorPath, ['push', 'origin', 'main']);

	const service = createWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
		rootDirectoryService: rootDirectoryStub(harness),
	});

	const result = await service.create({
		name: 'login-no-upstream',
		repositoryId: harness.repositoryId,
	});

	assert.equal(result.status, 'success');
	if (!result.workspace) {
		throw new Error('workspace missing');
	}
	assert.match(
		readFileSync(path.join(result.workspace.path, 'README.md'), 'utf8'),
		/latest no-upstream change/,
	);
	assert.equal(
		runGit(harness.repositoryPath, ['rev-parse', 'main']),
		runGit(collaboratorPath, ['rev-parse', 'main']),
	);
});

test('creates a workspace from the local base when the remote is unreachable', async (t) => {
	const harness = createHarness(t);
	const remotePath = path.join(harness.rootPath, 'remote.git');
	runGit(harness.rootPath, ['init', '--bare', remotePath]);
	runGit(remotePath, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
	runGit(harness.repositoryPath, ['remote', 'add', 'origin', remotePath]);
	runGit(harness.repositoryPath, ['push', '-u', 'origin', 'main']);
	writeFileSync(
		path.join(harness.repositoryPath, 'README.md'),
		'# demo\nlocal offline change\n',
	);
	runGit(harness.repositoryPath, ['commit', '-am', 'local change']);
	rmSync(remotePath, { force: true, recursive: true });

	const service = createWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
		rootDirectoryService: rootDirectoryStub(harness),
	});

	const result = await service.create({
		name: 'offline',
		repositoryId: harness.repositoryId,
	});

	assert.equal(result.status, 'success');
	if (!result.workspace) {
		throw new Error('workspace missing');
	}
	assert.match(
		readFileSync(path.join(result.workspace.path, 'README.md'), 'utf8'),
		/local offline change/,
	);
});

test('an explicit base branch still overrides the live root', async (t) => {
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
		name: 'login',
		repositoryId: harness.repositoryId,
	});

	assert.equal(result.status, 'success');
	assert.equal(result.workspace?.baseBranch, 'develop');
});
