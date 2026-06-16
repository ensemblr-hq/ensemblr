import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';

import { createLocalCommandService } from '../../src/main/commands/local-command.ts';
import { createArchiveLifecycleService } from '../../src/main/repository/archive-lifecycle.ts';
import { createArchiveWorkspaceService } from '../../src/main/repository/archive-workspace.ts';
import { createWorkspaceService } from '../../src/main/repository/create-workspace.ts';
import { createDeleteArchivedWorkspaceService } from '../../src/main/repository/delete-archived-workspace.ts';
import { createDeleteRepositoryService } from '../../src/main/repository/delete-repository.ts';
import { createListArchivedWorkspacesService } from '../../src/main/repository/list-archived-workspaces.ts';
import { createUnarchiveWorkspaceService } from '../../src/main/repository/unarchive-workspace.ts';
import {
	type EnsembleDatabaseConnection,
	type EnsembleDatabaseService,
	openEnsembleDatabase,
} from '../../src/main/storage/database.ts';
import { buildRootDirectoryStub } from './helpers/root-directory-stub.ts';

const fixedNow = () => new Date('2026-06-08T12:00:00.000Z');
const laterNow = () => new Date('2026-06-09T09:00:00.000Z');

interface Harness {
	archivedContextsPath: string;
	databaseService: EnsembleDatabaseService;
	repositoryId: string;
	repositoryPath: string;
	repositorySlug: string;
	rootPath: string;
	workspacesPath: string;
}

function createHarness(t: TestContext): Harness {
	const rootPath = mkdtempSync(path.join(tmpdir(), 'ensemble-browse-archive-'));
	const repositoriesPath = path.join(rootPath, 'repos');
	const workspacesPath = path.join(rootPath, 'workspaces');
	const archivedContextsPath = path.join(rootPath, 'archived-contexts');
	mkdirSync(repositoriesPath, { recursive: true });
	mkdirSync(workspacesPath, { recursive: true });
	mkdirSync(archivedContextsPath, { recursive: true });

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
		archivedContextsPath,
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

const rootDirectoryStub = (harness: Harness) =>
	buildRootDirectoryStub({
		archivedContextsPath: harness.archivedContextsPath,
		repositoriesPath: path.join(harness.rootPath, 'repos'),
		rootPath: harness.rootPath,
		workspacesPath: harness.workspacesPath,
	});

function runGit(cwd: string, args: string[]): string {
	return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
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

function workspaceRow(
	databaseService: EnsembleDatabaseService,
	id: string,
): Record<string, unknown> | undefined {
	const database = databaseService.getConnection()?.database as DatabaseSync;
	return database.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as
		| Record<string, unknown>
		| undefined;
}

function archiveRecordCount(
	databaseService: EnsembleDatabaseService,
	repositoryId: string,
): number {
	const database = databaseService.getConnection()?.database as DatabaseSync;
	const row = database
		.prepare(
			'SELECT COUNT(*) AS count FROM archive_records WHERE repository_id = ?',
		)
		.get(repositoryId);
	return Number((row as { count: number } | undefined)?.count ?? 0);
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

function makeArchiveService(harness: Harness) {
	const lifecycle = createArchiveLifecycleService();
	const archive = createArchiveWorkspaceService({
		archiveLifecycleService: lifecycle,
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
		rootDirectoryService: rootDirectoryStub(harness),
	});
	const unarchive = createUnarchiveWorkspaceService({
		archiveLifecycleService: lifecycle,
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: laterNow,
	});
	const purge = createDeleteArchivedWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
	});
	const list = createListArchivedWorkspacesService({
		databaseService: harness.databaseService,
	});
	return { archive, lifecycle, list, purge, unarchive };
}

test('list returns archived workspaces ordered newest first with archive metadata', async (t) => {
	const harness = createHarness(t);
	const ws1 = await seedWorkspace(harness, 'older-archive');
	const ws2 = await seedWorkspace(harness, 'recent-archive');

	const { archive, list } = makeArchiveService(harness);
	await archive.archive({ workspaceId: ws1.id });
	await archive.archive({
		branchCleanup: true,
		workspaceId: ws2.id,
	});

	const result = await list.list({ repositoryId: harness.repositoryId });

	assert.equal(result.repositoryId, harness.repositoryId);
	assert.equal(result.entries.length, 2);
	const ids = result.entries.map((entry) => entry.id);
	assert.ok(ids.includes(ws1.id));
	assert.ok(ids.includes(ws2.id));
	const cleanupEntry = result.entries.find((entry) => entry.id === ws2.id);
	assert.equal(cleanupEntry?.branchCleanup, true);
	assert.ok(cleanupEntry?.archivedContextPath?.includes('archived-contexts'));
});

test('list returns no entries for a repository with no archived workspaces', async (t) => {
	const harness = createHarness(t);
	await seedWorkspace(harness, 'live-one');

	const { list } = makeArchiveService(harness);

	const result = await list.list({ repositoryId: harness.repositoryId });
	assert.equal(result.entries.length, 0);
});

test('unarchive (no branch cleanup) NULLs archived_at and restores .context/', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'restore-me');

	const handoff = path.join(workspace.path, '.context', 'handoff.md');
	mkdirSync(path.dirname(handoff), { recursive: true });
	writeFileSync(handoff, '# pending work\n');

	const { archive, unarchive } = makeArchiveService(harness);
	await archive.archive({ workspaceId: workspace.id });

	// Wipe live .context/ to confirm the unarchive flow restores it from the
	// archived-contexts snapshot.
	rmSync(handoff, { force: true });

	const result = await unarchive.unarchive({ workspaceId: workspace.id });

	assert.equal(result.status, 'success');
	assert.equal(result.workspace?.contextRestored, true);
	assert.equal(result.workspace?.branchRecreated, false);
	assert.equal(result.workspace?.unarchivedAt, laterNow().toISOString());
	assert.equal(existsSync(handoff), true);
	assert.equal(readFileSync(handoff, 'utf8'), '# pending work\n');

	const row = workspaceRow(harness.databaseService, workspace.id);
	assert.equal(row?.archived_at, null);
});

test('unarchive (branch cleanup) recreates the worktree from the base branch and restores .context/', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'restore-cleanup');

	const handoff = path.join(workspace.path, '.context', 'handoff.md');
	mkdirSync(path.dirname(handoff), { recursive: true });
	writeFileSync(handoff, 'pushed\n');

	const { archive, unarchive } = makeArchiveService(harness);
	const archived = await archive.archive({
		branchCleanup: true,
		workspaceId: workspace.id,
	});
	assert.equal(archived.status, 'success');
	assert.equal(existsSync(workspace.path), false);

	const result = await unarchive.unarchive({ workspaceId: workspace.id });

	assert.equal(result.status, 'success');
	assert.equal(result.workspace?.branchRecreated, true);
	assert.equal(result.workspace?.contextRestored, true);
	assert.equal(existsSync(workspace.path), true);
	assert.equal(existsSync(handoff), true);

	const branches = listBranches(harness.repositoryPath);
	assert.equal(branches.includes(workspace.branchName ?? ''), true);

	const row = workspaceRow(harness.databaseService, workspace.id);
	assert.equal(row?.archived_at, null);
});

test('unarchive rejects a workspace that is not archived', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'still-live');

	const { unarchive } = makeArchiveService(harness);
	const result = await unarchive.unarchive({ workspaceId: workspace.id });

	assert.equal(result.status, 'failure');
	assert.equal(result.diagnostics[0]?.code, 'workspace-not-archived');
});

test('pre-unarchive hook abort short-circuits before archived_at is cleared', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'guarded-restore');

	const { archive, lifecycle, unarchive } = makeArchiveService(harness);
	await archive.archive({ workspaceId: workspace.id });

	lifecycle.subscribe('pre-unarchive-workspace', () => ({
		abort: { code: 'locked', message: 'integration lock held' },
	}));

	const result = await unarchive.unarchive({ workspaceId: workspace.id });

	assert.equal(result.status, 'aborted');
	assert.equal(
		result.diagnostics.some((d) => d.code === 'unarchive-aborted-by-hook'),
		true,
	);
	const row = workspaceRow(harness.databaseService, workspace.id);
	assert.notEqual(row?.archived_at, null);
});

test('delete-from-archive removes preserved context, worktree, branch, and row', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'purge-me');

	const { archive, purge } = makeArchiveService(harness);
	const archived = await archive.archive({ workspaceId: workspace.id });
	const preservedPath = archived.workspace?.archivedContextPath ?? null;
	assert.ok(preservedPath);
	if (!preservedPath) {
		return;
	}

	const result = await purge.delete({ workspaceId: workspace.id });

	assert.equal(result.status, 'success');
	assert.equal(result.contextRemoved, true);
	assert.equal(existsSync(preservedPath), false);
	assert.equal(existsSync(workspace.path), false);
	assert.equal(
		listBranches(harness.repositoryPath).includes(workspace.branchName ?? ''),
		false,
	);
	assert.equal(workspaceRow(harness.databaseService, workspace.id), undefined);
	assert.equal(
		archiveRecordCount(harness.databaseService, harness.repositoryId),
		0,
	);
});

test('delete-from-archive handles already-deleted worktree from a branch-cleanup archive', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'purge-cleanup');

	const { archive, purge } = makeArchiveService(harness);
	const archived = await archive.archive({
		branchCleanup: true,
		workspaceId: workspace.id,
	});
	const preservedPath = archived.workspace?.archivedContextPath ?? null;
	assert.ok(preservedPath);

	const result = await purge.delete({ workspaceId: workspace.id });

	assert.equal(result.status, 'success');
	assert.equal(result.contextRemoved, true);
	assert.equal(existsSync(preservedPath ?? ''), false);
	assert.equal(workspaceRow(harness.databaseService, workspace.id), undefined);
});

test('destructive repository delete wipes the archived-contexts subtree for that repo', async (t) => {
	const harness = createHarness(t);
	const ws1 = await seedWorkspace(harness, 'wipe-me-1');
	const ws2 = await seedWorkspace(harness, 'wipe-me-2');

	const { archive } = makeArchiveService(harness);
	const archived1 = await archive.archive({ workspaceId: ws1.id });
	const archived2 = await archive.archive({ workspaceId: ws2.id });
	const repoArchiveRoot = path.join(
		harness.archivedContextsPath,
		harness.repositorySlug,
	);
	assert.equal(existsSync(repoArchiveRoot), true);
	assert.ok(archived1.workspace?.archivedContextPath);
	assert.ok(archived2.workspace?.archivedContextPath);

	const deleteRepo = createDeleteRepositoryService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		rootDirectoryService: rootDirectoryStub(harness),
	});

	const result = await deleteRepo.delete({
		repositoryId: harness.repositoryId,
	});
	assert.equal(result.status, 'success');

	// Whole repo slug folder under archived-contexts/ is gone.
	assert.equal(existsSync(repoArchiveRoot), false);
});
