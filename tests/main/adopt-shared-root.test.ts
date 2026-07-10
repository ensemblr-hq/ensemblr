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
import test, { type TestContext } from 'node:test';
import { reconcileSharedRoot } from '../../src/main/repository/adopt-shared-root/index.ts';
import {
	probeGitRepository,
	probeGitWorktreeMetadata,
} from '../../src/main/repository/git-probe.ts';
import {
	type EnsemblrDatabaseConnection,
	openEnsemblrDatabase,
} from '../../src/main/storage/database.ts';
import type { RootDirectorySnapshot } from '../../src/shared/ipc';

const fixedNow = () => new Date('2026-06-08T12:00:00.000Z');

interface Harness {
	connection: EnsemblrDatabaseConnection;
	rootPath: string;
	rootSnapshot: RootDirectorySnapshot;
}

function createHarness(t: TestContext): Harness {
	const rootPath = realpathSync(
		mkdtempSync(path.join(tmpdir(), 'ensemblr-adopt-')),
	);
	const repositoriesPath = path.join(rootPath, 'repos');
	const workspacesPath = path.join(rootPath, 'workspaces');
	const archivedContextsPath = path.join(rootPath, 'archived-contexts');
	mkdirSync(repositoriesPath, { recursive: true });
	mkdirSync(workspacesPath, { recursive: true });
	mkdirSync(archivedContextsPath, { recursive: true });

	const connection = openEnsemblrDatabase({ databasePath: ':memory:' });

	t.after(() => {
		connection.database.close();
		rmSync(rootPath, { force: true, recursive: true });
	});

	const rootSnapshot: RootDirectorySnapshot = {
		archivedContextsPath,
		createdPaths: [],
		diagnostics: [],
		managedPaths: [],
		path: rootPath,
		repositoriesPath,
		setting: null,
		source: null,
		status: 'ok',
		workspacesPath,
	};

	return { connection, rootPath, rootSnapshot };
}

function runGit(cwd: string, args: string[]): string {
	return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function createGitRepository(repositoryPath: string): void {
	mkdirSync(repositoryPath, { recursive: true });
	runGit(repositoryPath, ['init', '-b', 'main']);
	runGit(repositoryPath, ['config', 'user.email', 'test@ensemblr.dev']);
	runGit(repositoryPath, ['config', 'user.name', 'Ensemblr Test']);
	writeFileSync(path.join(repositoryPath, 'README.md'), '# demo\n');
	runGit(repositoryPath, ['add', '.']);
	runGit(repositoryPath, ['commit', '-m', 'init']);
}

function addWorktree(
	repositoryPath: string,
	workspacePath: string,
	branchName: string,
): void {
	mkdirSync(path.dirname(workspacePath), { recursive: true });
	runGit(repositoryPath, [
		'worktree',
		'add',
		'-b',
		branchName,
		workspacePath,
		'main',
	]);
}

async function runReconcile(harness: Harness) {
	return reconcileSharedRoot({
		database: harness.connection.database,
		gitProbe: probeGitRepository,
		loadConfig: () => ({
			snapshot: {
				diagnostics: [],
				loadedAt: fixedNow().toISOString(),
				repositoryPath: '',
				sources: [],
			},
		}),
		now: fixedNow,
		root: harness.rootSnapshot,
		worktreeProbe: probeGitWorktreeMetadata,
	});
}

function repositoryRow(
	harness: Harness,
	path: string,
): Record<string, unknown> | null {
	return harness.connection.database
		.prepare('SELECT * FROM repositories WHERE path = ?')
		.get(path) as Record<string, unknown> | null;
}

function workspaceRow(
	harness: Harness,
	path: string,
): Record<string, unknown> | null {
	return harness.connection.database
		.prepare('SELECT * FROM workspaces WHERE path = ?')
		.get(path) as Record<string, unknown> | null;
}

test('an empty managed root produces no adoptions or diagnostics', async (t) => {
	const harness = createHarness(t);

	const snapshot = await runReconcile(harness);

	assert.equal(snapshot.status, 'ok');
	assert.deepEqual(snapshot.adopted.repositories, []);
	assert.deepEqual(snapshot.adopted.workspaces, []);
	assert.deepEqual(snapshot.diagnostics, []);
});

test('adopts a valid repository and its worktree workspace', async (t) => {
	const harness = createHarness(t);
	const repositoryPath = path.join(
		harness.rootSnapshot.repositoriesPath,
		'demo',
	);
	createGitRepository(repositoryPath);
	const workspacePath = path.join(
		harness.rootSnapshot.workspacesPath,
		'demo',
		'feature-login',
	);
	addWorktree(repositoryPath, workspacePath, 'feature-login');

	const snapshot = await runReconcile(harness);

	assert.equal(snapshot.status, 'ok');
	assert.equal(snapshot.adopted.repositories.length, 1);
	assert.equal(snapshot.adopted.workspaces.length, 1);
	const repository = snapshot.adopted.repositories[0];
	const workspace = snapshot.adopted.workspaces[0];
	assert.ok(repository);
	assert.ok(workspace);
	assert.equal(repository.path, repositoryPath);
	assert.equal(repository.slug, 'demo');
	assert.equal(repository.defaultBranch, 'main');
	assert.equal(workspace.path, workspacePath);
	assert.equal(workspace.branchName, 'feature-login');
	assert.equal(workspace.baseBranch, 'main');
	assert.equal(workspace.repositoryId, repository.id);

	const repoRow = repositoryRow(harness, repositoryPath);
	assert.ok(repoRow);
	const repoMetadata = JSON.parse(repoRow?.metadata_json as string) as Record<
		string,
		unknown
	>;
	assert.equal(repoMetadata.adoptionMode, 'adopted-from-shared-root');
	const adoption = repoMetadata.adoption as Record<string, unknown>;
	assert.equal(adoption.origin, 'shared-root');
	assert.equal(adoption.adoptedAt, fixedNow().toISOString());

	const workspaceRowResult = workspaceRow(harness, workspacePath);
	assert.ok(workspaceRowResult);
	assert.equal(workspaceRowResult?.branch_name, 'feature-login');
	const workspaceMetadata = JSON.parse(
		workspaceRowResult?.metadata_json as string,
	) as Record<string, unknown>;
	assert.equal(workspaceMetadata.adoptionMode, 'adopted-from-shared-root');
});

test('reconcile is idempotent; second run refreshes lastSeenAt without duplicates', async (t) => {
	const harness = createHarness(t);
	const repositoryPath = path.join(
		harness.rootSnapshot.repositoriesPath,
		'demo',
	);
	createGitRepository(repositoryPath);

	const first = await runReconcile(harness);
	const second = await runReconcile(harness);

	const count = harness.connection.database
		.prepare('SELECT COUNT(*) AS count FROM repositories')
		.get() as { count: number };
	assert.equal(count.count, 1);
	assert.equal(first.adopted.repositories.length, 1);
	assert.equal(second.adopted.repositories.length, 0);
	assert.equal(second.refreshed.repositoryIds.length, 1);
});

test('rejects directories under repos/ that are not git repositories', async (t) => {
	const harness = createHarness(t);
	const invalidPath = path.join(harness.rootSnapshot.repositoriesPath, 'plain');
	mkdirSync(invalidPath, { recursive: true });
	writeFileSync(path.join(invalidPath, 'README.md'), 'not a git repo\n');

	const snapshot = await runReconcile(harness);

	assert.equal(snapshot.status, 'warning');
	assert.equal(snapshot.adopted.repositories.length, 0);
	const codes = snapshot.diagnostics.map((diagnostic) => diagnostic.code);
	assert.ok(codes.includes('invalid-repository'));
	const repoCount = harness.connection.database
		.prepare('SELECT COUNT(*) AS count FROM repositories')
		.get() as { count: number };
	assert.equal(repoCount.count, 0);
});

test('rejects workspace directories that are not git worktrees', async (t) => {
	const harness = createHarness(t);
	const repositoryPath = path.join(
		harness.rootSnapshot.repositoriesPath,
		'demo',
	);
	createGitRepository(repositoryPath);

	const stubPath = path.join(
		harness.rootSnapshot.workspacesPath,
		'demo',
		'not-a-worktree',
	);
	mkdirSync(stubPath, { recursive: true });
	writeFileSync(path.join(stubPath, 'note.txt'), 'placeholder\n');

	const snapshot = await runReconcile(harness);

	assert.equal(snapshot.adopted.workspaces.length, 0);
	const codes = snapshot.diagnostics.map((diagnostic) => diagnostic.code);
	assert.ok(codes.includes('invalid-worktree'));
});

test('marks stale repository rows but auto-deletes stale workspace rows', async (t) => {
	const harness = createHarness(t);
	const ghostRepoPath = path.join(
		harness.rootSnapshot.repositoriesPath,
		'ghost',
	);
	const ghostWorkspacePath = path.join(
		harness.rootSnapshot.workspacesPath,
		'ghost',
		'ghost-feature',
	);
	const timestamp = fixedNow().toISOString();
	harness.connection.database
		.prepare(
			`INSERT INTO repositories (id, slug, name, path, default_branch, created_at, updated_at, metadata_json)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			'repository-ghost',
			'ghost',
			'ghost',
			ghostRepoPath,
			'main',
			timestamp,
			timestamp,
			JSON.stringify({ adoptionMode: 'adopted-from-shared-root' }),
		);
	harness.connection.database
		.prepare(
			`INSERT INTO workspaces (id, repository_id, slug, name, path, branch_name, base_branch, created_at, updated_at, metadata_json)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			'workspace-ghost',
			'repository-ghost',
			'ghost-feature',
			'ghost-feature',
			ghostWorkspacePath,
			'ghost-feature',
			'main',
			timestamp,
			timestamp,
			'{}',
		);

	const snapshot = await runReconcile(harness);

	assert.equal(snapshot.stale.repositories.length, 1);
	assert.equal(snapshot.stale.workspaces.length, 1);
	assert.equal(snapshot.stale.repositories[0]?.id, 'repository-ghost');
	assert.equal(snapshot.stale.workspaces[0]?.id, 'workspace-ghost');

	const repoRow = repositoryRow(harness, ghostRepoPath);
	assert.ok(repoRow);
	const repoMetadata = JSON.parse(repoRow?.metadata_json as string) as Record<
		string,
		unknown
	>;
	const adoption = repoMetadata.adoption as Record<string, unknown>;
	assert.equal(adoption.missingSince, fixedNow().toISOString());

	const wsRow = workspaceRow(harness, ghostWorkspacePath);
	assert.ok(!wsRow, 'stale workspace row deleted');
});

test('flags two workspaces sharing the same branch as a collision', async (t) => {
	const harness = createHarness(t);
	const repositoryPath = path.join(
		harness.rootSnapshot.repositoriesPath,
		'demo',
	);
	createGitRepository(repositoryPath);
	const firstWorkspace = path.join(
		harness.rootSnapshot.workspacesPath,
		'demo',
		'alpha',
	);
	const secondWorkspace = path.join(
		harness.rootSnapshot.workspacesPath,
		'demo',
		'beta',
	);
	addWorktree(repositoryPath, firstWorkspace, 'shared-branch');
	// Second worktree on its own branch; rewrite HEAD to share the branch without
	// touching the index.
	addWorktree(repositoryPath, secondWorkspace, 'shared-branch-other');
	runGit(secondWorkspace, ['symbolic-ref', 'HEAD', 'refs/heads/shared-branch']);

	const snapshot = await runReconcile(harness);
	const codes = snapshot.diagnostics.map((diagnostic) => diagnostic.code);
	assert.ok(codes.includes('workspace-branch-collision'));
});

test('skips repository folders carrying the .ensemblr-archived marker', async (t) => {
	const harness = createHarness(t);
	const repositoryPath = path.join(
		harness.rootSnapshot.repositoriesPath,
		'archived-demo',
	);
	createGitRepository(repositoryPath);
	writeFileSync(
		path.join(repositoryPath, '.ensemblr-archived'),
		'Archived by Ensemblr.\n',
	);

	const snapshot = await runReconcile(harness);

	assert.equal(snapshot.adopted.repositories.length, 0);
	assert.equal(repositoryRow(harness, repositoryPath) ?? null, null);
});

test('leaves unmanaged sibling files inside repos/ alone', async (t) => {
	const harness = createHarness(t);
	const unmanagedFile = path.join(
		harness.rootSnapshot.repositoriesPath,
		'NOTES.md',
	);
	writeFileSync(unmanagedFile, 'hands off\n');
	const repositoryPath = path.join(
		harness.rootSnapshot.repositoriesPath,
		'demo',
	);
	createGitRepository(repositoryPath);

	const snapshot = await runReconcile(harness);

	assert.equal(snapshot.adopted.repositories.length, 1);
	assert.equal(existsSync(unmanagedFile), true);
});
