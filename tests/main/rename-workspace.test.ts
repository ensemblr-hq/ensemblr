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

import { createLocalCommandService } from '../../src/main/commands/local-command.ts';
import { createWorkspaceService } from '../../src/main/repository/create-workspace.ts';
import { createRenameWorkspaceService } from '../../src/main/repository/rename-workspace.ts';
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
		mkdtempSync(path.join(tmpdir(), 'ensemblr-rename-')),
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

function workspaceRow(harness: Harness, id: string) {
	const database = harness.databaseService.getConnection()?.database;
	if (!database) {
		throw new Error('database unavailable');
	}
	return database
		.prepare(
			'SELECT id, name, slug, path, branch_name AS branchName, metadata_json AS metadataJson FROM workspaces WHERE id = ?',
		)
		.get(id) as
		| {
				branchName: string | null;
				id: string;
				metadataJson: string;
				name: string;
				path: string;
				slug: string;
		  }
		| undefined;
}

function branchExists(repositoryPath: string, branch: string): boolean {
	try {
		runGit(repositoryPath, ['show-ref', '--verify', `refs/heads/${branch}`]);
		return true;
	} catch {
		return false;
	}
}

test('rename keeps slug + path + folder, updates name and derived branch', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'Bach');
	const service = createRenameWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
	});

	const result = await service.rename({
		name: 'Mozart',
		workspaceId: workspace.id,
	});

	assert.equal(result.status, 'success');
	assert.equal(result.workspace?.name, 'Mozart');
	assert.equal(result.workspace?.slug, workspace.slug);
	assert.equal(result.workspace?.path, workspace.path);
	assert.equal(result.workspace?.branchName, 'mozart');

	const row = workspaceRow(harness, workspace.id);
	assert.ok(row);
	assert.equal(row?.name, 'Mozart');
	assert.equal(row?.slug, workspace.slug);
	assert.equal(row?.path, workspace.path);
	assert.equal(row?.branchName, 'mozart');
	assert.equal(existsSync(workspace.path), true);
	assert.equal(branchExists(harness.repositoryPath, 'mozart'), true);
	assert.equal(branchExists(harness.repositoryPath, 'bach'), false);
});

test('rename honors an explicit branchName override', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'Bach');
	const service = createRenameWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
	});

	const result = await service.rename({
		branchName: 'feature/custom-branch',
		name: 'Mozart',
		workspaceId: workspace.id,
	});

	assert.equal(result.status, 'success');
	assert.equal(result.workspace?.branchName, 'feature/custom-branch');
	assert.equal(
		branchExists(harness.repositoryPath, 'feature/custom-branch'),
		true,
	);
	assert.equal(branchExists(harness.repositoryPath, 'bach'), false);
});

test('rename rejects a name already used by another workspace in the repo', async (t) => {
	const harness = createHarness(t);
	await seedWorkspace(harness, 'Bach');
	const target = await seedWorkspace(harness, 'Mozart');
	const service = createRenameWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
	});

	const result = await service.rename({
		name: 'Bach',
		workspaceId: target.id,
	});

	assert.equal(result.status, 'failure');
	assert.equal(result.diagnostics[0]?.code, 'name-already-in-use');
});

test('rename fails when the derived branch already exists in the repo', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'Bach');
	runGit(harness.repositoryPath, ['branch', 'mozart']);
	const service = createRenameWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
	});

	const result = await service.rename({
		name: 'Mozart',
		workspaceId: workspace.id,
	});

	assert.equal(result.status, 'failure');
	assert.equal(result.diagnostics[0]?.code, 'branch-already-exists');
	// The original branch should still exist because the rename rolled back.
	assert.equal(branchExists(harness.repositoryPath, 'bach'), true);
});

test('rename is a no-op when the inputs match the current state', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'Bach');
	const service = createRenameWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
	});

	const result = await service.rename({
		name: workspace.name,
		workspaceId: workspace.id,
	});

	assert.equal(result.status, 'success');
	assert.equal(result.workspace?.name, workspace.name);
	assert.equal(result.workspace?.branchName, workspace.branchName);
});

function setWorkspaceMetadata(
	harness: Harness,
	id: string,
	metadata: Record<string, unknown>,
): void {
	const database = harness.databaseService.getConnection()?.database;
	if (!database) {
		throw new Error('database unavailable');
	}
	database
		.prepare('UPDATE workspaces SET metadata_json = ? WHERE id = ?')
		.run(JSON.stringify(metadata), id);
}

test('requirePlaceholderName no-ops (no branch rename) when the workspace is not a placeholder', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'Bach');
	setWorkspaceMetadata(harness, workspace.id, {});
	const service = createRenameWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
	});

	const result = await service.rename({
		name: 'mozart-suggested',
		requirePlaceholderName: true,
		workspaceId: workspace.id,
	});

	assert.equal(result.status, 'success');
	assert.equal(result.workspace?.name, workspace.name);
	const row = workspaceRow(harness, workspace.id);
	assert.equal(row?.name, workspace.name);
	assert.equal(row?.branchName, workspace.branchName);
	assert.equal(branchExists(harness.repositoryPath, 'bach'), true);
	assert.equal(branchExists(harness.repositoryPath, 'mozart-suggested'), false);
});

test('requirePlaceholderName no-ops when the workspace was already renamed', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'Bach');
	setWorkspaceMetadata(harness, workspace.id, {
		placeholderName: true,
		renamedAt: '2026-06-08T11:00:00.000Z',
	});
	const service = createRenameWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
	});

	const result = await service.rename({
		name: 'mozart-suggested',
		requirePlaceholderName: true,
		workspaceId: workspace.id,
	});

	assert.equal(result.status, 'success');
	assert.equal(result.workspace?.name, workspace.name);
	assert.equal(branchExists(harness.repositoryPath, 'bach'), true);
});

test('requirePlaceholderName renames a placeholder workspace and stamps renamedAt', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'Bach');
	setWorkspaceMetadata(harness, workspace.id, { placeholderName: true });
	const service = createRenameWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
	});

	const result = await service.rename({
		name: 'add-dark-mode',
		requirePlaceholderName: true,
		workspaceId: workspace.id,
	});

	assert.equal(result.status, 'success');
	assert.equal(result.workspace?.name, 'add-dark-mode');
	assert.equal(result.workspace?.branchName, 'add-dark-mode');
	assert.equal(branchExists(harness.repositoryPath, 'add-dark-mode'), true);
	const row = workspaceRow(harness, workspace.id);
	const metadata = JSON.parse(row?.metadataJson ?? '{}') as {
		renamedAt?: unknown;
	};
	assert.equal(typeof metadata.renamedAt, 'string');
});

test('rename rejects an unknown workspace id', async (t) => {
	const harness = createHarness(t);
	const service = createRenameWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
	});

	const result = await service.rename({
		name: 'whatever',
		workspaceId: 'workspace-does-not-exist',
	});

	assert.equal(result.status, 'failure');
	assert.equal(result.diagnostics[0]?.code, 'workspace-not-found');
});
