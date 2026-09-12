import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import { createLocalCommandService } from '../../src/main/commands/local-command.ts';
import { createWorkspaceService } from '../../src/main/repository/create-workspace.ts';
import { resolveFreshForkRef } from '../../src/main/repository/git-ops.ts';
import { createLocalRepositoryRegistrationService } from '../../src/main/repository/register-repository.ts';
import {
	type EnsemblrDatabaseConnection,
	type EnsemblrDatabaseService,
	openEnsemblrDatabase,
} from '../../src/main/storage/database.ts';
import { createWorkspaceGitService } from '../../src/main/workspace-git/workspace-git-status.ts';
import { buildRootDirectoryStub } from './helpers/root-directory-stub.ts';

const fixedNow = () => new Date('2026-06-08T12:00:00.000Z');

interface Harness {
	databaseService: EnsemblrDatabaseService;
	externalPath: string;
	repositoriesPath: string;
	rootPath: string;
	workspacesPath: string;
}

function createHarness(t: TestContext): Harness {
	const rootPath = mkdtempSync(path.join(tmpdir(), 'ensemblr-local-project-'));
	const repositoriesPath = path.join(rootPath, 'repos');
	const workspacesPath = path.join(rootPath, 'workspaces');
	const externalPath = path.join(rootPath, 'external-source');
	mkdirSync(repositoriesPath, { recursive: true });
	mkdirSync(workspacesPath, { recursive: true });
	mkdirSync(externalPath);
	const canonicalExternalPath = realpathSync(externalPath);

	runGit(canonicalExternalPath, ['init', '-b', 'master']);
	runGit(canonicalExternalPath, ['config', 'user.email', 'test@ensemblr.dev']);
	runGit(canonicalExternalPath, ['config', 'user.name', 'Ensemblr Test']);
	writeFileSync(
		path.join(canonicalExternalPath, 'README.md'),
		'# local project\n',
	);
	runGit(canonicalExternalPath, ['add', 'README.md']);
	runGit(canonicalExternalPath, ['commit', '-m', 'init']);

	const connection = openEnsemblrDatabase({ databasePath: ':memory:' });
	t.after(() => {
		connection.database.close();
		rmSync(rootPath, { force: true, recursive: true });
	});

	return {
		databaseService: wrapConnection(connection),
		externalPath: canonicalExternalPath,
		repositoriesPath,
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

function runGit(cwd: string, args: string[]): string {
	return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

async function registerProject(
	harness: Harness,
): Promise<{ id: string; path: string }> {
	const registration = await createLocalRepositoryRegistrationService({
		databaseService: harness.databaseService,
		now: fixedNow,
	}).register({ path: harness.externalPath });
	assert.equal(
		registration.registered,
		true,
		JSON.stringify(registration.diagnostics),
	);
	if (!registration.repository) {
		throw new Error('registered project is missing its repository snapshot');
	}
	return {
		id: registration.repository.id,
		path: registration.repository.path,
	};
}

async function createProjectWorkspace(
	harness: Harness,
	repositoryId: string,
	name: string,
) {
	return createWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
		rootDirectoryService: buildRootDirectoryStub({
			rootPath: harness.rootPath,
			workspacesPath: harness.workspacesPath,
		}),
	}).create({ name, repositoryId });
}

function attachRemote(harness: Harness, remote = 'origin'): string {
	const remotePath = path.join(harness.rootPath, `${remote}.git`);
	runGit(harness.rootPath, ['init', '--bare', remotePath]);
	runGit(remotePath, ['symbolic-ref', 'HEAD', 'refs/heads/master']);
	runGit(harness.externalPath, ['remote', 'add', remote, remotePath]);
	runGit(harness.externalPath, ['push', '-u', remote, 'master']);
	return remotePath;
}

function attachOrigin(harness: Harness): string {
	return attachRemote(harness);
}

function publishRemoteCommit(harness: Harness, remotePath: string): string {
	const collaboratorPath = path.join(harness.rootPath, 'collaborator');
	runGit(harness.rootPath, ['clone', remotePath, collaboratorPath]);
	runGit(collaboratorPath, ['config', 'user.email', 'test@ensemblr.dev']);
	runGit(collaboratorPath, ['config', 'user.name', 'Ensemblr Test']);
	writeFileSync(path.join(collaboratorPath, 'remote.md'), 'remote advance\n');
	runGit(collaboratorPath, ['add', 'remote.md']);
	runGit(collaboratorPath, ['commit', '-m', 'remote advance']);
	runGit(collaboratorPath, ['push', 'origin', 'master']);
	return runGit(collaboratorPath, ['rev-parse', 'HEAD']);
}

test('registers the selected master checkout in place and reads its settings', async (t) => {
	const harness = createHarness(t);
	mkdirSync(path.join(harness.externalPath, '.ensemblr'));
	writeFileSync(
		path.join(harness.externalPath, '.ensemblr', 'settings.toml'),
		'[git]\nbranch_prefix = "local/"\n',
	);
	runGit(harness.externalPath, ['add', '.ensemblr/settings.toml']);
	runGit(harness.externalPath, ['commit', '-m', 'configure project']);

	const repository = await registerProject(harness);
	const workspace = await createProjectWorkspace(
		harness,
		repository.id,
		'configured',
	);

	assert.equal(workspace.status, 'success');
	assert.equal(workspace.workspace?.branchName, 'local/configured');
	assert.equal(workspace.workspace?.baseBranch, 'master');
	assert.equal(repository.path, realpathSync(harness.externalPath));
	assert.equal(workspace.workspace?.repositoryId, repository.id);
	assert.equal(
		existsSync(path.join(harness.repositoriesPath, 'external-source')),
		false,
		'opening a local project must not clone a managed repository copy',
	);
});

test('uses commits added to the local master checkout after registration', async (t) => {
	const harness = createHarness(t);
	const repository = await registerProject(harness);
	writeFileSync(
		path.join(harness.externalPath, 'after-registration.md'),
		'local\n',
	);
	runGit(harness.externalPath, ['add', 'after-registration.md']);
	runGit(harness.externalPath, ['commit', '-m', 'local advance']);
	const localTip = runGit(harness.externalPath, ['rev-parse', 'master']);

	const workspace = await createProjectWorkspace(
		harness,
		repository.id,
		'local',
	);

	assert.equal(workspace.status, 'success');
	assert.equal(
		runGit(String(workspace.workspace?.path), ['rev-parse', 'HEAD']),
		localTip,
	);
	assert.equal(
		readFileSync(
			path.join(String(workspace.workspace?.path), 'after-registration.md'),
			'utf8',
		),
		'local\n',
	);
});

test('fresh fork resolution pins the fetched upstream to a commit', async (t) => {
	const harness = createHarness(t);
	const remotePath = attachOrigin(harness);
	const localTip = runGit(harness.externalPath, ['rev-parse', 'master']);
	const remoteTip = publishRemoteCommit(harness, remotePath);

	const resolution = await resolveFreshForkRef({
		baseBranch: 'master',
		localCommandService: createLocalCommandService(),
		repositoryPath: harness.externalPath,
	});

	assert.equal(resolution.status, 'fresh');
	assert.equal(resolution.ref, remoteTip);
	assert.equal(runGit(harness.externalPath, ['rev-parse', 'master']), localTip);
});

test('forks from a newer remote without moving the clean root checkout', async (t) => {
	const harness = createHarness(t);
	const remotePath = attachOrigin(harness);
	const repository = await registerProject(harness);
	const localTip = runGit(harness.externalPath, ['rev-parse', 'master']);
	const remoteTip = publishRemoteCommit(harness, remotePath);

	const workspace = await createProjectWorkspace(
		harness,
		repository.id,
		'remote',
	);

	assert.equal(workspace.status, 'success');
	assert.equal(runGit(harness.externalPath, ['rev-parse', 'master']), localTip);
	assert.equal(
		runGit(String(workspace.workspace?.path), ['rev-parse', 'HEAD']),
		remoteTip,
	);
});

test('forks from the fetched upstream without touching a dirty root checkout', async (t) => {
	const harness = createHarness(t);
	mkdirSync(path.join(harness.externalPath, '.ensemblr'));
	const settingsPath = path.join(
		harness.externalPath,
		'.ensemblr',
		'settings.toml',
	);
	writeFileSync(settingsPath, '[git]\nbranch_prefix = "local/"\n');
	runGit(harness.externalPath, ['add', '.ensemblr/settings.toml']);
	runGit(harness.externalPath, ['commit', '-m', 'configure project']);
	const remotePath = attachOrigin(harness);
	const repository = await registerProject(harness);
	const localTip = runGit(harness.externalPath, ['rev-parse', 'master']);
	writeFileSync(path.join(harness.externalPath, 'staged.txt'), 'staged root\n');
	runGit(harness.externalPath, ['add', 'staged.txt']);
	const indexBefore = runGit(harness.externalPath, ['diff', '--cached']);
	const remoteTip = publishRemoteCommit(harness, remotePath);
	const dirtySettings = '[git]\nbranch_prefix = "dirty/"\n';
	writeFileSync(settingsPath, dirtySettings);

	const workspace = await createProjectWorkspace(
		harness,
		repository.id,
		'dirty',
	);

	assert.equal(workspace.status, 'success');
	assert.match(indexBefore, /staged\.txt/);
	assert.equal(runGit(harness.externalPath, ['rev-parse', 'HEAD']), localTip);
	assert.equal(runGit(harness.externalPath, ['diff', '--cached']), indexBefore);
	assert.equal(readFileSync(settingsPath, 'utf8'), dirtySettings);
	assert.equal(
		runGit(String(workspace.workspace?.path), ['rev-parse', 'HEAD']),
		remoteTip,
	);
	assert.equal(
		runGit(String(workspace.workspace?.path), [
			'for-each-ref',
			'--format=%(upstream)',
			`refs/heads/${workspace.workspace?.branchName}`,
		]),
		'',
	);

	const comparison = await createWorkspaceGitService({
		localCommandService: createLocalCommandService(),
	}).getStatus({
		scope: { baseRef: 'master', kind: 'branch' },
		workspaceCwd: String(workspace.workspace?.path),
	});
	assert.equal(comparison.error, undefined);
	assert.deepEqual(comparison.files, []);
});

test('requires an explicit source when the local base and upstream diverge', async (t) => {
	const harness = createHarness(t);
	const remotePath = attachOrigin(harness);
	const repository = await registerProject(harness);
	writeFileSync(
		path.join(harness.externalPath, 'local.md'),
		'local divergence\n',
	);
	runGit(harness.externalPath, ['add', 'local.md']);
	runGit(harness.externalPath, ['commit', '-m', 'local divergence']);
	const localTip = runGit(harness.externalPath, ['rev-parse', 'master']);
	publishRemoteCommit(harness, remotePath);

	const workspace = await createProjectWorkspace(
		harness,
		repository.id,
		'diverged',
	);

	assert.equal(workspace.status, 'failure');
	assert.equal(workspace.diagnostics[0]?.code, 'base-branch-diverged');
	assert.match(String(workspace.diagnostics[0]?.message), /origin\/master/);
	assert.equal(runGit(harness.externalPath, ['rev-parse', 'master']), localTip);
	assert.equal(workspace.workspace, null);
});

test('preserves a locally-ahead base and compares against that local source', async (t) => {
	const harness = createHarness(t);
	attachOrigin(harness);
	const repository = await registerProject(harness);
	writeFileSync(path.join(harness.externalPath, 'local.md'), 'local ahead\n');
	runGit(harness.externalPath, ['add', 'local.md']);
	runGit(harness.externalPath, ['commit', '-m', 'local ahead']);
	const localTip = runGit(harness.externalPath, ['rev-parse', 'master']);

	const workspace = await createProjectWorkspace(
		harness,
		repository.id,
		'ahead',
	);

	assert.equal(workspace.status, 'success');
	assert.equal(
		runGit(String(workspace.workspace?.path), ['rev-parse', 'HEAD']),
		localTip,
	);
	const comparison = await createWorkspaceGitService({
		localCommandService: createLocalCommandService(),
	}).getStatus({
		scope: { baseRef: 'master', kind: 'branch' },
		workspaceCwd: String(workspace.workspace?.path),
	});
	assert.deepEqual(comparison.files, []);
});

test('explicit fork refs resolve divergence without changing the merge target', async (t) => {
	const harness = createHarness(t);
	const remotePath = attachOrigin(harness);
	const repository = await registerProject(harness);
	writeFileSync(path.join(harness.externalPath, 'local.md'), 'local\n');
	runGit(harness.externalPath, ['add', 'local.md']);
	runGit(harness.externalPath, ['commit', '-m', 'local']);
	const localTip = runGit(harness.externalPath, ['rev-parse', 'master']);
	const remoteTip = publishRemoteCommit(harness, remotePath);
	const service = createWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
		rootDirectoryService: buildRootDirectoryStub({
			rootPath: harness.rootPath,
			workspacesPath: harness.workspacesPath,
		}),
	});

	const localWorkspace = await service.create({
		branchPlan: { forkRef: 'master', kind: 'create' },
		name: 'choose local',
		repositoryId: repository.id,
	});
	const remoteWorkspace = await service.create({
		branchPlan: { forkRef: 'origin/master', kind: 'create' },
		name: 'choose remote',
		repositoryId: repository.id,
	});

	assert.equal(localWorkspace.status, 'success');
	assert.equal(remoteWorkspace.status, 'success');
	assert.equal(localWorkspace.workspace?.baseBranch, 'master');
	assert.equal(remoteWorkspace.workspace?.baseBranch, 'master');
	assert.equal(
		runGit(String(localWorkspace.workspace?.path), ['rev-parse', 'HEAD']),
		localTip,
	);
	assert.equal(
		runGit(String(remoteWorkspace.workspace?.path), ['rev-parse', 'HEAD']),
		remoteTip,
	);
});

test('uses the configured custom upstream remote for a fresh default fork', async (t) => {
	const harness = createHarness(t);
	const remotePath = attachRemote(harness, 'upstream');
	const repository = await registerProject(harness);
	const remoteTip = publishRemoteCommit(harness, remotePath);

	const workspace = await createProjectWorkspace(
		harness,
		repository.id,
		'custom',
	);

	assert.equal(workspace.status, 'success');
	assert.equal(
		runGit(String(workspace.workspace?.path), ['rev-parse', 'HEAD']),
		remoteTip,
	);
	const comparison = await createWorkspaceGitService({
		localCommandService: createLocalCommandService(),
	}).getStatus({
		scope: { baseRef: 'master', kind: 'branch' },
		workspaceCwd: String(workspace.workspace?.path),
	});
	assert.deepEqual(comparison.files, []);
});

test('creates from the cached base with a warning when its upstream is offline', async (t) => {
	const harness = createHarness(t);
	const remotePath = attachOrigin(harness);
	const repository = await registerProject(harness);
	const cachedTip = runGit(harness.externalPath, ['rev-parse', 'master']);
	renameSync(remotePath, `${remotePath}.offline`);

	const workspace = await createProjectWorkspace(
		harness,
		repository.id,
		'offline',
	);

	assert.equal(workspace.status, 'success');
	assert.equal(workspace.diagnostics[0]?.code, 'base-refresh-failed');
	assert.equal(workspace.diagnostics[0]?.severity, 'warning');
	assert.equal(
		runGit(String(workspace.workspace?.path), ['rev-parse', 'HEAD']),
		cachedTip,
	);
});
