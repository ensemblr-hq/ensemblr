import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';

import { createLocalCommandService } from '../../src/main/commands/local-command.ts';
import { createArchiveLifecycleService } from '../../src/main/repository/archive-lifecycle.ts';
import { createArchiveWorkspaceService } from '../../src/main/repository/archive-workspace.ts';
import { createWorkspaceService } from '../../src/main/repository/create-workspace.ts';
import { createListAllWorkspacesService } from '../../src/main/repository/list-all-workspaces.ts';
import {
	type EnsembleDatabaseConnection,
	type EnsembleDatabaseService,
	openEnsembleDatabase,
} from '../../src/main/storage/database.ts';
import { buildRootDirectoryStub } from './helpers/root-directory-stub.ts';

const fixedNow = () => new Date('2026-06-08T12:00:00.000Z');

interface RepoFixture {
	id: string;
	name: string;
	path: string;
	slug: string;
}

interface Harness {
	archivedContextsPath: string;
	databaseService: EnsembleDatabaseService;
	repositoriesPath: string;
	rootPath: string;
	workspacesPath: string;
}

function runGit(cwd: string, args: string[]): string {
	return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
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

function addRepository(
	connection: EnsembleDatabaseConnection,
	repositoriesPath: string,
	slug: string,
	name: string,
): RepoFixture {
	const repositoryPath = path.join(repositoriesPath, slug);
	mkdirSync(repositoryPath);
	runGit(repositoryPath, ['init', '-b', 'main']);
	runGit(repositoryPath, ['config', 'user.email', 'test@ensemble.dev']);
	runGit(repositoryPath, ['config', 'user.name', 'Ensemble Test']);
	writeFileSync(path.join(repositoryPath, 'README.md'), `# ${slug}\n`);
	runGit(repositoryPath, ['add', '.']);
	runGit(repositoryPath, ['commit', '-m', 'init']);

	const id = `repository-${slug}`;
	const timestamp = fixedNow().toISOString();
	connection.database
		.prepare(
			`INSERT INTO repositories (id, slug, name, path, default_branch, created_at, updated_at, metadata_json)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(id, slug, name, repositoryPath, 'main', timestamp, timestamp, '{}');

	return { id, name, path: repositoryPath, slug };
}

function createHarness(t: TestContext): Harness {
	const rootPath = mkdtempSync(path.join(tmpdir(), 'ensemble-history-'));
	const repositoriesPath = path.join(rootPath, 'repos');
	const workspacesPath = path.join(rootPath, 'workspaces');
	const archivedContextsPath = path.join(rootPath, 'archived-contexts');
	mkdirSync(repositoriesPath, { recursive: true });
	mkdirSync(workspacesPath, { recursive: true });
	mkdirSync(archivedContextsPath, { recursive: true });

	const connection = openEnsembleDatabase({ databasePath: ':memory:' });
	const databaseService = wrapConnection(connection);

	t.after(() => {
		connection.database.close();
		rmSync(rootPath, { force: true, recursive: true });
	});

	return {
		archivedContextsPath,
		databaseService,
		repositoriesPath,
		rootPath,
		workspacesPath,
	};
}

function rootDirectoryStub(harness: Harness) {
	return buildRootDirectoryStub({
		archivedContextsPath: harness.archivedContextsPath,
		repositoriesPath: harness.repositoriesPath,
		rootPath: harness.rootPath,
		workspacesPath: harness.workspacesPath,
	});
}

async function seedWorkspace(harness: Harness, repoId: string, name: string) {
	const service = createWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
		rootDirectoryService: rootDirectoryStub(harness),
	});
	const result = await service.create({ name, repositoryId: repoId });
	if (result.status !== 'success' || !result.workspace) {
		throw new Error(`failed to seed workspace ${name}`);
	}
	return result.workspace;
}

function makeArchiveService(harness: Harness) {
	const lifecycle = createArchiveLifecycleService();
	return createArchiveWorkspaceService({
		archiveLifecycleService: lifecycle,
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
		rootDirectoryService: rootDirectoryStub(harness),
	});
}

/** Forces a deterministic `updated_at` so ordering assertions are stable. */
function setUpdatedAt(harness: Harness, workspaceId: string, iso: string) {
	const database = harness.databaseService.getConnection()
		?.database as DatabaseSync;
	database
		.prepare('UPDATE workspaces SET updated_at = ? WHERE id = ?')
		.run(iso, workspaceId);
}

test('listAllWorkspaces aggregates active + archived across all repositories, newest activity first', async (t) => {
	const harness = createHarness(t);
	const connection = harness.databaseService.getConnection();
	if (!connection) {
		throw new Error('expected an in-memory database connection');
	}
	const alpha = addRepository(
		connection,
		harness.repositoriesPath,
		'alpha',
		'Alpha',
	);
	const beta = addRepository(
		connection,
		harness.repositoriesPath,
		'beta',
		'Beta',
	);

	const alphaActive = await seedWorkspace(harness, alpha.id, 'alpha-active');
	const alphaArchived = await seedWorkspace(
		harness,
		alpha.id,
		'alpha-archived',
	);
	const betaCleanup = await seedWorkspace(harness, beta.id, 'beta-cleanup');

	const archive = makeArchiveService(harness);
	await archive.archive({ workspaceId: alphaArchived.id });
	await archive.archive({ branchCleanup: true, workspaceId: betaCleanup.id });

	// Distinct activity timestamps → deterministic DESC order.
	setUpdatedAt(harness, alphaActive.id, '2026-06-10T08:00:00.000Z');
	setUpdatedAt(harness, alphaArchived.id, '2026-06-12T08:00:00.000Z');
	setUpdatedAt(harness, betaCleanup.id, '2026-06-14T08:00:00.000Z');

	const service = createListAllWorkspacesService({
		databaseService: harness.databaseService,
	});
	const { entries } = await service.list();

	assert.equal(entries.length, 3);
	assert.deepEqual(
		entries.map((entry) => entry.id),
		[betaCleanup.id, alphaArchived.id, alphaActive.id],
	);

	const byId = new Map(entries.map((entry) => [entry.id, entry]));

	// Active workspace: archivedAt null, no archive metadata, repo name carried.
	const active = byId.get(alphaActive.id);
	assert.equal(active?.archivedAt, null);
	assert.equal(active?.repositoryName, 'Alpha');
	assert.equal(active?.repositoryId, alpha.id);
	assert.equal(active?.branchCleanup, false);
	assert.equal(active?.baseBranch, null);

	// Archived without cleanup: archivedAt set, baseBranch recorded, no cleanup.
	const archived = byId.get(alphaArchived.id);
	assert.notEqual(archived?.archivedAt, null);
	assert.equal(archived?.repositoryName, 'Alpha');
	assert.equal(archived?.branchCleanup, false);
	assert.ok(archived?.baseBranch);

	// Archived with cleanup: archivedAt set, cleanup flag true, base branch recorded.
	const cleanup = byId.get(betaCleanup.id);
	assert.notEqual(cleanup?.archivedAt, null);
	assert.equal(cleanup?.repositoryName, 'Beta');
	assert.equal(cleanup?.branchCleanup, true);
	assert.ok(cleanup?.baseBranch);
});

test('listAllWorkspaces returns an empty list when the database is unavailable', async () => {
	const service = createListAllWorkspacesService({
		databaseService: {
			close: () => undefined,
			getConnection: () => undefined,
			getHealth: () => ({ path: null, schemaVersion: 0, status: 'closed' }),
			open: () => ({ path: null, schemaVersion: 0, status: 'closed' }),
		} as unknown as EnsembleDatabaseService,
	});

	const result = await service.list();
	assert.deepEqual(result.entries, []);
});
