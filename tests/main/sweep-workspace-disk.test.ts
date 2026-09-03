import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';

import type { LocalCommandService } from '@/main/commands/local-command';
import { createWorkspaceDiskSweepService } from '@/main/repository/sweep-workspace-disk';
import type { EnsemblrRootDirectoryService } from '@/main/root';
import type {
	EnsemblrDatabaseConnection,
	EnsemblrDatabaseService,
} from '@/main/storage';
import { openEnsemblrDatabase } from '@/main/storage/database';
import { insertRepositoryRow } from '@/main/storage/repositories/repository-row-repository';
import { insertWorkspaceRow } from '@/main/storage/repositories/workspace-repository';

import { buildRootDirectoryStub } from './helpers/root-directory-stub.ts';

const NOW = '2026-09-03T00:00:00.000Z';
const REPOSITORY_ID = 'repo-1';
const REPOSITORY_SLUG = 'demo';

/** A managed root on disk plus the database describing what belongs in it. */
interface Harness {
	connection: EnsemblrDatabaseConnection;
	databaseService: EnsemblrDatabaseService;
	rootDirectoryService: EnsemblrRootDirectoryService;
	rootPath: string;
	workspacesPath: string;
}

/**
 * `du` is the only external command the sweep runs, and every removal is
 * reported as one kilobyte so a test can assert on the total rather than on
 * whatever the filesystem happens to allocate.
 */
const localCommandService = measuringCommandService();

/**
 * A `du` stub that runs `onMeasure` while it measures, which is the one window
 * in which the sweep is committed to a candidate but has not yet unlinked it —
 * exactly where a user hitting Restore lands.
 */
function measuringCommandService(onMeasure?: () => void): LocalCommandService {
	return {
		run: async () => {
			onMeasure?.();
			return {
				status: 'success' as const,
				stderr: '',
				stdout: '1\t/measured\n',
			};
		},
	} as unknown as LocalCommandService;
}

function createHarness(): Harness {
	const rootPath = mkdtempSync(path.join(tmpdir(), 'ensemblr-sweep-'));
	const workspacesPath = path.join(rootPath, 'workspaces');
	mkdirSync(workspacesPath, { recursive: true });

	const connection = openEnsemblrDatabase({ databasePath: ':memory:' });
	insertRepositoryRow({
		database: connection.database,
		defaultBranch: 'main',
		id: REPOSITORY_ID,
		metadataJson: '{}',
		name: REPOSITORY_SLUG,
		path: path.join(rootPath, 'repos', REPOSITORY_SLUG),
		remoteUrl: '',
		slug: REPOSITORY_SLUG,
		timestamp: NOW,
	});

	const databaseService = {
		close: () => connection.database.close(),
		getConnection: () => connection,
		getHealth: () => ({
			path: connection.path,
			schemaVersion: 0,
			status: 'ok',
		}),
		open: () => ({ path: connection.path, schemaVersion: 0, status: 'ok' }),
	} as unknown as EnsemblrDatabaseService;

	return {
		connection,
		databaseService,
		rootDirectoryService: buildRootDirectoryStub({ rootPath, workspacesPath }),
		rootPath,
		workspacesPath,
	};
}

/** Creates a workspace directory holding one file, so it is not empty. */
function seedDirectory(harness: Harness, slug: string): string {
	const directoryPath = path.join(
		harness.workspacesPath,
		REPOSITORY_SLUG,
		slug,
	);
	mkdirSync(path.join(directoryPath, '.build'), { recursive: true });
	writeFileSync(path.join(directoryPath, '.build', 'out.o'), 'object\n');

	return directoryPath;
}

/** Registers a workspace row pointing at `directoryPath`. */
function seedRow(
	harness: Harness,
	{
		archived,
		branchCleanup = false,
		directoryPath,
		slug,
		worktreePruned = true,
	}: {
		archived: boolean;
		branchCleanup?: boolean;
		directoryPath: string;
		slug: string;
		worktreePruned?: boolean;
	},
): void {
	const workspaceId = `workspace-${slug}`;
	insertWorkspaceRow({
		baseBranch: 'main',
		branchName: `octocat/${slug}`,
		database: harness.connection.database,
		id: workspaceId,
		metadataJson: '{}',
		name: slug,
		path: directoryPath,
		repositoryId: REPOSITORY_ID,
		slug,
		timestamp: NOW,
	});

	if (!archived) {
		return;
	}

	harness.connection.database
		.prepare('UPDATE workspaces SET archived_at = ? WHERE id = ?')
		.run(NOW, workspaceId);
	harness.connection.database
		.prepare(
			`INSERT INTO archive_records
				(id, record_type, repository_id, workspace_id, repository_slug, workspace_slug,
				 source_path, archived_at, branch_cleanup, worktree_pruned, pruned_wip_ref)
			 VALUES (?, 'workspace', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			`archive-${slug}`,
			REPOSITORY_ID,
			workspaceId,
			REPOSITORY_SLUG,
			slug,
			directoryPath,
			NOW,
			branchCleanup ? 1 : 0,
			worktreePruned ? 1 : 0,
			worktreePruned ? `refs/ensemblr/archived/${workspaceId}` : null,
		);
}

function sweep(harness: Harness, commandService = localCommandService) {
	return createWorkspaceDiskSweepService({
		databaseService: harness.databaseService,
		localCommandService: commandService,
		rootDirectoryService: harness.rootDirectoryService,
	}).sweep();
}

function cleanUp(harness: Harness): void {
	harness.connection.database.close();
	rmSync(harness.rootPath, { force: true, recursive: true });
}

test('reclaims an archived worktree the prune reported as removed', async () => {
	const harness = createHarness();
	const directoryPath = seedDirectory(harness, 'mantzaros');
	seedRow(harness, { archived: true, directoryPath, slug: 'mantzaros' });

	const report = await sweep(harness);

	expect(existsSync(directoryPath)).toBe(false);
	expect(report.removedWorktrees).toBe(1);
	expect(report.bytesFreed).toBe(1024);
	expect(report.failures).toEqual([]);
	cleanUp(harness);
});

// A prune that reported failure did so because it could not preserve something,
// so the directory may still hold the only copy of it.
test('leaves an archived worktree whose prune did not record a snapshot', async () => {
	const harness = createHarness();
	const directoryPath = seedDirectory(harness, 'kept');
	seedRow(harness, {
		archived: true,
		directoryPath,
		slug: 'kept',
		worktreePruned: false,
	});

	const report = await sweep(harness);

	expect(existsSync(directoryPath)).toBe(true);
	expect(report.removedWorktrees).toBe(0);
	cleanUp(harness);
});

test('leaves a live workspace alone', async () => {
	const harness = createHarness();
	const directoryPath = seedDirectory(harness, 'soken');
	seedRow(harness, { archived: false, directoryPath, slug: 'soken' });

	const report = await sweep(harness);

	expect(existsSync(directoryPath)).toBe(true);
	expect(report.removedWorktrees).toBe(0);
	expect(report.removedOrphanDirectories).toBe(0);
	cleanUp(harness);
});

// What a delete leaves behind: no row points at it, so nothing would ever
// reclaim it.
test('reclaims a directory no workspace row points at', async () => {
	const harness = createHarness();
	const directoryPath = seedDirectory(harness, 'wagner');

	const report = await sweep(harness);

	expect(existsSync(directoryPath)).toBe(false);
	expect(report.removedOrphanDirectories).toBe(1);
	cleanUp(harness);
});

// A `.git` means git may still own the checkout, or the user put a repository
// here by hand; either way the sweep is not the one to decide.
test('leaves an orphan that still looks like a git checkout', async () => {
	const harness = createHarness();
	const directoryPath = seedDirectory(harness, 'hand-cloned');
	writeFileSync(path.join(directoryPath, '.git'), 'gitdir: elsewhere\n');

	const report = await sweep(harness);

	expect(existsSync(directoryPath)).toBe(true);
	expect(report.removedOrphanDirectories).toBe(0);
	cleanUp(harness);
});

test('removes a repository folder left holding nothing but .DS_Store', async () => {
	const harness = createHarness();
	const repositoryDirectory = path.join(
		harness.workspacesPath,
		REPOSITORY_SLUG,
	);
	mkdirSync(repositoryDirectory, { recursive: true });
	writeFileSync(path.join(repositoryDirectory, '.DS_Store'), 'finder\n');

	const report = await sweep(harness);

	expect(existsSync(repositoryDirectory)).toBe(false);
	expect(report.removedEmptyRepositoryDirectories).toBe(1);
	cleanUp(harness);
});

test('keeps a repository folder that still holds a workspace', async () => {
	const harness = createHarness();
	const directoryPath = seedDirectory(harness, 'soken');
	seedRow(harness, { archived: false, directoryPath, slug: 'soken' });

	await sweep(harness);

	expect(existsSync(path.dirname(directoryPath))).toBe(true);
	cleanUp(harness);
});

// The containment check runs on the real path, so a row pointing through a
// symlink cannot walk a recursive removal out of the managed tree.
test('refuses a workspace row whose path resolves outside the managed root', async () => {
	const harness = createHarness();
	const outsidePath = path.join(harness.rootPath, 'outside');
	mkdirSync(outsidePath, { recursive: true });
	writeFileSync(path.join(outsidePath, 'precious.txt'), 'keep\n');

	const linkPath = path.join(harness.workspacesPath, REPOSITORY_SLUG, 'linked');
	mkdirSync(path.dirname(linkPath), { recursive: true });
	symlinkSync(outsidePath, linkPath);
	seedRow(harness, {
		archived: true,
		directoryPath: linkPath,
		slug: 'linked',
	});

	const report = await sweep(harness);

	expect(existsSync(path.join(outsidePath, 'precious.txt'))).toBe(true);
	expect(report.removedWorktrees).toBe(0);
	expect(report.failures.join()).toMatch(/resolves outside/);
	cleanUp(harness);
});

test('reports nothing to do when the root has no workspaces', async () => {
	const harness = createHarness();

	const report = await sweep(harness);

	expect(report).toEqual({
		bytesFreed: 0,
		failures: [],
		removedEmptyRepositoryDirectories: 0,
		removedOrphanDirectories: 0,
		removedWorktrees: 0,
	});
	cleanUp(harness);
});

// `.setup-smoke` is the Pi RPC startup check's own workspace, not a repository
// folder, and its being empty says nothing about whether its owner wants it.
test('leaves a dot-directory another concern owns at the workspaces root', async () => {
	const harness = createHarness();
	const smokePath = path.join(harness.workspacesPath, '.setup-smoke');
	mkdirSync(smokePath, { recursive: true });

	const report = await sweep(harness);

	expect(existsSync(smokePath)).toBe(true);
	expect(report.removedEmptyRepositoryDirectories).toBe(0);
	cleanUp(harness);
});

// An unarchive materializes the worktree before it clears `archived_at`, so a
// crash — or the handled failure of that clear — leaves a full checkout under a
// row that still reads archived. The `.git` is what says so.
test('leaves an archived worktree that a checkout has come back to', async () => {
	const harness = createHarness();
	const directoryPath = seedDirectory(harness, 'restored');
	writeFileSync(path.join(directoryPath, '.git'), 'gitdir: elsewhere\n');
	seedRow(harness, { archived: true, directoryPath, slug: 'restored' });

	const report = await sweep(harness);

	expect(existsSync(directoryPath)).toBe(true);
	expect(report.removedWorktrees).toBe(0);
	expect(report.failures.join()).toMatch(/holds a \.git entry/);
	cleanUp(harness);
});

// Branch cleanup takes the discard path, so it never records a prune — but it
// removed the worktree and deleted the branch, so nothing can rehydrate it and
// whatever is left at the path is residue like any other.
test('reclaims what a branch-cleanup archive left behind', async () => {
	const harness = createHarness();
	const directoryPath = seedDirectory(harness, 'dropped');
	seedRow(harness, {
		archived: true,
		branchCleanup: true,
		directoryPath,
		slug: 'dropped',
		worktreePruned: false,
	});

	const report = await sweep(harness);

	expect(existsSync(directoryPath)).toBe(false);
	expect(report.removedWorktrees).toBe(1);
	cleanUp(harness);
});

// The sweep is fired at launch and runs while the window opens, so the user can
// reach Restore before it finishes. Deciding on the collected snapshot would
// unlink the worktree the unarchive had just checked out.
test('refuses a candidate whose workspace was restored mid-sweep', async () => {
	const harness = createHarness();
	const directoryPath = seedDirectory(harness, 'raced');
	seedRow(harness, { archived: true, directoryPath, slug: 'raced' });

	const report = await sweep(
		harness,
		measuringCommandService(() => {
			harness.connection.database
				.prepare('UPDATE workspaces SET archived_at = NULL WHERE id = ?')
				.run('workspace-raced');
		}),
	);

	expect(existsSync(directoryPath)).toBe(true);
	expect(report.removedWorktrees).toBe(0);
	expect(report.bytesFreed).toBe(0);
	expect(report.failures.join()).toMatch(
		/no longer an archive without a worktree/,
	);
	cleanUp(harness);
});

test('refuses an orphan a workspace claimed mid-sweep', async () => {
	const harness = createHarness();
	const directoryPath = seedDirectory(harness, 'claimed');

	const report = await sweep(
		harness,
		measuringCommandService(() => {
			seedRow(harness, { archived: false, directoryPath, slug: 'claimed' });
		}),
	);

	expect(existsSync(directoryPath)).toBe(true);
	expect(report.removedOrphanDirectories).toBe(0);
	expect(report.failures.join()).toMatch(/a workspace now points at it/);
	cleanUp(harness);
});
