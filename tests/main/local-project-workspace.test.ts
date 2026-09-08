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
import test, { type TestContext } from 'node:test';

import { createLocalCommandService } from '../../src/main/commands/local-command.ts';
import { createWorkspaceService } from '../../src/main/repository/create-workspace.ts';
import { createLocalRepositoryRegistrationService } from '../../src/main/repository/register-repository.ts';
import {
	type EnsemblrDatabaseConnection,
	type EnsemblrDatabaseService,
	openEnsemblrDatabase,
} from '../../src/main/storage/database.ts';
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

function attachOrigin(harness: Harness): string {
	const remotePath = path.join(harness.rootPath, 'origin.git');
	runGit(harness.rootPath, ['init', '--bare', remotePath]);
	runGit(remotePath, ['symbolic-ref', 'HEAD', 'refs/heads/master']);
	runGit(harness.externalPath, ['remote', 'add', 'origin', remotePath]);
	runGit(harness.externalPath, ['push', '-u', 'origin', 'master']);
	return remotePath;
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

test('fast-forwards a local master checkout from its remote before creating a workspace', async (t) => {
	const harness = createHarness(t);
	const remotePath = attachOrigin(harness);
	const repository = await registerProject(harness);
	const remoteTip = publishRemoteCommit(harness, remotePath);

	const workspace = await createProjectWorkspace(
		harness,
		repository.id,
		'remote',
	);

	assert.equal(workspace.status, 'success');
	assert.equal(
		runGit(harness.externalPath, ['rev-parse', 'master']),
		remoteTip,
	);
	assert.equal(
		runGit(String(workspace.workspace?.path), ['rev-parse', 'HEAD']),
		remoteTip,
	);
});

test('does not overwrite a dirty local master checkout while syncing its remote', async (t) => {
	const harness = createHarness(t);
	const remotePath = attachOrigin(harness);
	const repository = await registerProject(harness);
	const localTip = runGit(harness.externalPath, ['rev-parse', 'master']);
	publishRemoteCommit(harness, remotePath);
	writeFileSync(
		path.join(harness.externalPath, 'README.md'),
		'# dirty local project\n',
	);

	const workspace = await createProjectWorkspace(
		harness,
		repository.id,
		'dirty',
	);

	assert.equal(workspace.status, 'success');
	assert.equal(runGit(harness.externalPath, ['rev-parse', 'master']), localTip);
	assert.equal(
		readFileSync(path.join(harness.externalPath, 'README.md'), 'utf8'),
		'# dirty local project\n',
	);
	assert.equal(
		runGit(String(workspace.workspace?.path), ['rev-parse', 'HEAD']),
		localTip,
	);
});

test('does not overwrite a diverged local master checkout while syncing its remote', async (t) => {
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

	assert.equal(workspace.status, 'success');
	assert.equal(runGit(harness.externalPath, ['rev-parse', 'master']), localTip);
	assert.equal(
		runGit(String(workspace.workspace?.path), ['rev-parse', 'HEAD']),
		localTip,
	);
});
