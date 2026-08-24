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
		conciergePath: path.join(rootPath, 'concierge'),
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

/** Reads the rename bookkeeping a workspace's metadata blob now carries. */
function renameMetadata(
	harness: Harness,
	id: string,
): {
	branchNamed?: unknown;
	branchProvisional?: unknown;
	renamedAt?: unknown;
} {
	return JSON.parse(workspaceRow(harness, id)?.metadataJson ?? '{}') as {
		branchNamed?: unknown;
		branchProvisional?: unknown;
		renamedAt?: unknown;
	};
}

// A provisional name fills the board while an agent plans. It must move the row
// without settling anything, or the agent's own one-shot naming call would be
// refused as a second one and the guess would become permanent.
test('a provisional rename moves the workspace without closing the naming gates', async (t) => {
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
		provisional: true,
		requirePlaceholderName: true,
		workspaceId: workspace.id,
	});

	assert.equal(result.status, 'success');
	assert.equal(result.workspace?.name, 'add-dark-mode');
	assert.equal(branchExists(harness.repositoryPath, 'add-dark-mode'), true);
	const metadata = renameMetadata(harness, workspace.id);
	assert.equal(metadata.branchProvisional, true);
	assert.equal(metadata.renamedAt, undefined);
	assert.equal(metadata.branchNamed, undefined);
});

// The two standing gates stay open after a provisional rename by design, so the
// service re-checks the narrower one here. Without it a second namer racing the
// first would read an unsettled row and move the branch again.
test('a second provisional rename no-ops against the freshly-read row', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'Bach');
	setWorkspaceMetadata(harness, workspace.id, { placeholderName: true });
	const service = createRenameWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
	});

	await service.rename({
		name: 'add-dark-mode',
		provisional: true,
		requirePlaceholderName: true,
		workspaceId: workspace.id,
	});
	const second = await service.rename({
		name: 'theme-switcher',
		provisional: true,
		requirePlaceholderName: true,
		workspaceId: workspace.id,
	});

	assert.equal(second.changed, false);
	assert.equal(workspaceRow(harness, workspace.id)?.name, 'add-dark-mode');
	assert.equal(branchExists(harness.repositoryPath, 'theme-switcher'), false);
});

// Guessing is scoped to placeholders: a workspace the user only retitled still
// has a nameable branch, but the app moving it is a rename nobody asked for.
test('a provisional rename declines a workspace the user has titled', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'Bach');
	setWorkspaceMetadata(harness, workspace.id, {
		branchNamed: false,
		placeholderName: true,
		renamedAt: '2026-08-14T00:00:00.000Z',
	});
	const service = createRenameWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
	});

	const result = await service.rename({
		name: 'add-dark-mode',
		provisional: true,
		requirePlaceholderName: true,
		workspaceId: workspace.id,
	});

	assert.equal(result.changed, false);
	assert.equal(workspaceRow(harness, workspace.id)?.name, 'Bach');
	assert.equal(branchExists(harness.repositoryPath, 'add-dark-mode'), false);
});

test('a real rename over a provisional name settles it', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'Bach');
	setWorkspaceMetadata(harness, workspace.id, { placeholderName: true });
	const service = createRenameWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
	});

	await service.rename({
		name: 'add-dark-mode',
		provisional: true,
		requirePlaceholderName: true,
		workspaceId: workspace.id,
	});
	const settled = await service.rename({
		name: 'theme-switcher',
		requirePlaceholderName: true,
		workspaceId: workspace.id,
	});

	assert.equal(settled.status, 'success');
	assert.equal(settled.workspace?.name, 'theme-switcher');
	const metadata = renameMetadata(harness, workspace.id);
	assert.equal(metadata.branchProvisional, false);
	assert.equal(metadata.branchNamed, true);
	assert.equal(typeof metadata.renamedAt, 'string');
});

test('a rename that moves the branch records the branch as named', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'Bach');
	setWorkspaceMetadata(harness, workspace.id, { placeholderName: true });
	const service = createRenameWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
	});

	await service.rename({ name: 'add-dark-mode', workspaceId: workspace.id });

	assert.equal(renameMetadata(harness, workspace.id).branchNamed, true);
});

// Naming a branch the name it already carries is a settled outcome, not a
// no-op: leaving the gate open has the upkeep nudge ask an agent for the same
// name every turn, and every call report success.
test('re-submitting a branch its own name settles the naming gate', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'Bach');
	setWorkspaceMetadata(harness, workspace.id, { placeholderName: true });
	const service = createRenameWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
	});

	const result = await service.rename({
		branchName: workspace.branchName ?? undefined,
		name: 'My Feature',
		workspaceId: workspace.id,
	});

	assert.equal(result.changed, true);
	assert.equal(renameMetadata(harness, workspace.id).branchNamed, true);
	assert.equal(workspaceRow(harness, workspace.id)?.name, 'My Feature');
	assert.equal(
		workspaceRow(harness, workspace.id)?.branchName,
		workspace.branchName,
	);
});

// The gate is separately the branch's and the name's, so a race that closes one
// must narrow the rename rather than reject it or clobber the other.
test('requirePlaceholderName moves the branch but keeps a title the user chose', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'Bach');
	setWorkspaceMetadata(harness, workspace.id, {
		branchNamed: false,
		placeholderName: true,
		renamedAt: '2026-06-08T11:00:00.000Z',
	});
	const service = createRenameWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
	});

	const result = await service.rename({
		branchName: 'add-dark-mode',
		name: 'agent-slug',
		requirePlaceholderName: true,
		workspaceId: workspace.id,
	});

	assert.equal(result.status, 'success');
	assert.equal(result.workspace?.name, workspace.name);
	assert.equal(result.workspace?.branchName, 'add-dark-mode');
	assert.equal(workspaceRow(harness, workspace.id)?.name, workspace.name);
});

test('the auto-naming gate still opens for a workspace the user only retitled', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'Bach');
	setWorkspaceMetadata(harness, workspace.id, {
		branchNamed: false,
		placeholderName: true,
		renamedAt: '2026-06-08T11:00:00.000Z',
	});
	const service = createRenameWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
	});

	const result = await service.rename({
		branchName: 'add-dark-mode',
		name: workspace.name,
		requirePlaceholderName: true,
		workspaceId: workspace.id,
	});

	assert.equal(result.status, 'success');
	assert.equal(result.changed, true);
	assert.equal(result.workspace?.branchName, 'add-dark-mode');
	assert.equal(branchExists(harness.repositoryPath, 'add-dark-mode'), true);
	assert.equal(renameMetadata(harness, workspace.id).branchNamed, true);
});

// The gate closing between the caller's pre-flight read and the write is the
// case `requirePlaceholderName` exists for, and it reports success without
// having written so the caller can tell the two apart.
test('requirePlaceholderName reports a blocked rename as unchanged', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'Bach');
	setWorkspaceMetadata(harness, workspace.id, { branchNamed: true });
	const service = createRenameWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
	});

	const result = await service.rename({
		branchName: 'add-dark-mode',
		name: 'agent-slug',
		requirePlaceholderName: true,
		workspaceId: workspace.id,
	});

	assert.equal(result.status, 'success');
	assert.equal(result.changed, false);
	assert.equal(workspaceRow(harness, workspace.id)?.name, workspace.name);
});

test('rename leaves an adopted branch alone and only moves the display name', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'Bach');
	setWorkspaceMetadata(harness, workspace.id, { adoptedBranch: true });
	const originalBranch = workspace.branchName;
	const service = createRenameWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
	});

	const result = await service.rename({
		name: 'add-dark-mode',
		workspaceId: workspace.id,
	});

	assert.equal(result.status, 'success');
	assert.equal(result.workspace?.name, 'add-dark-mode');
	// The branch predates the workspace and usually backs a pull request:
	// renaming it here would orphan that PR.
	assert.equal(result.workspace?.branchName, originalBranch);
	assert.equal(branchExists(harness.repositoryPath, 'add-dark-mode'), false);
	assert.equal(
		branchExists(harness.repositoryPath, String(originalBranch)),
		true,
	);
});

test('an explicit branch rename on an adopted branch is rejected, not dropped', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'Bach');
	setWorkspaceMetadata(harness, workspace.id, { adoptedBranch: true });
	const originalBranch = workspace.branchName;
	const service = createRenameWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
	});

	const result = await service.rename({
		branchName: 'renamed-branch',
		name: 'add-dark-mode',
		workspaceId: workspace.id,
	});

	// Reporting success while silently discarding the branch the user typed is
	// worse than refusing: the dialog would close on a rename that never happened.
	assert.equal(result.status, 'failure');
	assert.equal(result.diagnostics[0]?.code, 'branch-adopted');
	assert.match(String(result.diagnostics[0]?.message), /took over/);
	assert.equal(branchExists(harness.repositoryPath, 'renamed-branch'), false);
	assert.equal(
		branchExists(harness.repositoryPath, String(originalBranch)),
		true,
	);
});

test('a branch-only rename on an adopted branch never reports success', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'Bach');
	setWorkspaceMetadata(harness, workspace.id, { adoptedBranch: true });
	const service = createRenameWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
	});

	const result = await service.rename({
		branchName: 'renamed-branch',
		workspaceId: workspace.id,
	});

	assert.equal(result.status, 'failure');
	assert.equal(result.diagnostics[0]?.code, 'branch-adopted');
});

test('re-submitting an adopted workspace’s own branch name is not a rejection', async (t) => {
	const harness = createHarness(t);
	const workspace = await seedWorkspace(harness, 'Bach');
	setWorkspaceMetadata(harness, workspace.id, { adoptedBranch: true });
	const service = createRenameWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
	});

	const result = await service.rename({
		branchName: String(workspace.branchName),
		name: 'add-dark-mode',
		workspaceId: workspace.id,
	});

	assert.equal(result.status, 'success');
	assert.equal(result.workspace?.name, 'add-dark-mode');
	assert.equal(result.workspace?.branchName, workspace.branchName);
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
