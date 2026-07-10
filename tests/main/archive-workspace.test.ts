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
import {
	type EnsemblrDatabaseConnection,
	type EnsemblrDatabaseService,
	openEnsemblrDatabase,
} from '../../src/main/storage/database.ts';
import { buildRootDirectoryStub } from './helpers/root-directory-stub.ts';

const fixedNow = () => new Date('2026-06-08T12:00:00.000Z');

interface Harness {
	archivedContextsPath: string;
	databaseService: EnsemblrDatabaseService;
	repositoryId: string;
	repositoryPath: string;
	repositorySlug: string;
	rootPath: string;
	workspacesPath: string;
}

function createHarness(t: TestContext): Harness {
	const rootPath = mkdtempSync(
		path.join(tmpdir(), 'ensemblr-archive-lifecycle-'),
	);
	const repositoriesPath = path.join(rootPath, 'repos');
	const workspacesPath = path.join(rootPath, 'workspaces');
	const archivedContextsPath = path.join(rootPath, 'archived-contexts');
	mkdirSync(repositoriesPath, { recursive: true });
	mkdirSync(workspacesPath, { recursive: true });
	mkdirSync(archivedContextsPath, { recursive: true });

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

function workspaceRow(
	databaseService: EnsemblrDatabaseService,
	id: string,
): Record<string, unknown> | undefined {
	const database = databaseService.getConnection()?.database as DatabaseSync;
	const row = database.prepare('SELECT * FROM workspaces WHERE id = ?').get(id);
	return row as Record<string, unknown> | undefined;
}

function archiveRecord(
	databaseService: EnsemblrDatabaseService,
	id: string,
): Record<string, unknown> | undefined {
	const database = databaseService.getConnection()?.database as DatabaseSync;
	const row = database
		.prepare('SELECT * FROM archive_records WHERE id = ?')
		.get(id);
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

function makeArchiveService(
	harness: Harness,
	lifecycle = createArchiveLifecycleService(),
) {
	return {
		lifecycle,
		service: createArchiveWorkspaceService({
			archiveLifecycleService: lifecycle,
			databaseService: harness.databaseService,
			localCommandService: createLocalCommandService(),
			now: fixedNow,
			rootDirectoryService: rootDirectoryStub(harness),
		}),
	};
}

test('lifecycle archive preserves .context/, stamps archived_at, leaves worktree + branch alone', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'handoff');

	const handoffPath = path.join(workspace.path, '.context', 'handoff.md');
	mkdirSync(path.dirname(handoffPath), { recursive: true });
	writeFileSync(handoffPath, '# Handoff\nremember to push\n');

	const { service } = makeArchiveService(harness);

	const result = await service.archive({ workspaceId: workspace.id });

	assert.equal(result.status, 'success');
	assert.ok(result.workspace);
	assert.equal(result.workspace?.archivedAt, fixedNow().toISOString());
	assert.equal(result.workspace?.branchCleanup, false);
	assert.equal(result.workspace?.branchDeleted, false);

	const preservedRoot = result.workspace?.archivedContextPath;
	assert.ok(preservedRoot);
	if (!preservedRoot) {
		return;
	}
	assert.equal(
		existsSync(path.join(preservedRoot, '.context/handoff.md')),
		true,
	);
	assert.equal(
		readFileSync(path.join(preservedRoot, '.context/handoff.md'), 'utf8'),
		'# Handoff\nremember to push\n',
	);

	const metadataPath = path.join(preservedRoot, 'archive-metadata.json');
	assert.equal(existsSync(metadataPath), true);
	const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
	assert.equal(metadata.archiveRecordId, result.archiveRecordId);
	assert.equal(metadata.workspace.slug, workspace.slug);
	assert.equal(metadata.branchCleanup, false);

	const row = workspaceRow(harness.databaseService, workspace.id);
	assert.equal(row?.archived_at, fixedNow().toISOString());
	assert.equal(existsSync(workspace.path), true);

	assert.equal(
		listBranches(harness.repositoryPath).includes(workspace.branchName ?? ''),
		true,
	);

	const archiveRow = result.archiveRecordId
		? archiveRecord(harness.databaseService, result.archiveRecordId)
		: undefined;
	assert.ok(archiveRow);
	assert.equal(archiveRow?.record_type, 'workspace');
	assert.equal(archiveRow?.workspace_id, workspace.id);
	assert.equal(archiveRow?.repository_id, harness.repositoryId);
	assert.equal(archiveRow?.branch_cleanup, 0);
});

test('branchCleanup opt-in removes the worktree registration and drops the local branch', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'cleanup-branch');

	const handoffPath = path.join(workspace.path, '.context', 'handoff.md');
	mkdirSync(path.dirname(handoffPath), { recursive: true });
	writeFileSync(handoffPath, 'pushed work\n');

	const { service } = makeArchiveService(harness);

	const result = await service.archive({
		branchCleanup: true,
		workspaceId: workspace.id,
	});

	assert.equal(result.status, 'success');
	assert.equal(result.workspace?.branchCleanup, true);
	assert.equal(result.workspace?.branchDeleted, true);

	// Branch and worktree registration are both gone — `.context/` survives
	// under archived-contexts/ because we copy it before tearing down the
	// worktree.
	assert.equal(
		listBranches(harness.repositoryPath).includes(workspace.branchName ?? ''),
		false,
	);
	assert.equal(existsSync(workspace.path), false);

	const preservedRoot = result.workspace?.archivedContextPath;
	assert.ok(preservedRoot);
	if (preservedRoot) {
		assert.equal(
			existsSync(path.join(preservedRoot, '.context/handoff.md')),
			true,
		);
	}

	const archiveRow = result.archiveRecordId
		? archiveRecord(harness.databaseService, result.archiveRecordId)
		: undefined;
	assert.equal(archiveRow?.branch_cleanup, 1);
});

test('pre-archive hook abort short-circuits the lifecycle without stamping archived_at', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'guarded');

	const lifecycle = createArchiveLifecycleService();
	lifecycle.subscribe('pre-archive-workspace', () => ({
		abort: {
			code: 'workspace-busy',
			message: 'Pi session is still running.',
		},
	}));

	const { service } = makeArchiveService(harness, lifecycle);

	const result = await service.archive({ workspaceId: workspace.id });

	assert.equal(result.status, 'aborted');
	assert.equal(result.archiveRecordId, null);
	assert.equal(result.workspace, null);
	assert.equal(
		result.diagnostics.some(
			(diagnostic) => diagnostic.code === 'archive-aborted-by-hook',
		),
		true,
	);

	const row = workspaceRow(harness.databaseService, workspace.id);
	assert.equal(row?.archived_at, null);
});

test('archiving the same workspace twice is rejected with workspace-already-archived', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'already-archived');

	const { service } = makeArchiveService(harness);

	const first = await service.archive({ workspaceId: workspace.id });
	assert.equal(first.status, 'success');

	const second = await service.archive({ workspaceId: workspace.id });
	assert.equal(second.status, 'failure');
	assert.equal(second.diagnostics[0]?.code, 'workspace-already-archived');
});

test('archive validates the workspace id and rejects unknown ids', async (t) => {
	const harness = createHarness(t);
	const { service } = makeArchiveService(harness);

	const missingId = await service.archive({ workspaceId: '' });
	assert.equal(missingId.status, 'failure');
	assert.equal(missingId.diagnostics[0]?.code, 'workspace-id-required');

	const notFound = await service.archive({
		workspaceId: 'workspace-not-real',
	});
	assert.equal(notFound.status, 'failure');
	assert.equal(notFound.diagnostics[0]?.code, 'workspace-not-found');
});
