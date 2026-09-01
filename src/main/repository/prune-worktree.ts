import { existsSync } from 'node:fs';
import path from 'node:path';

import {
	captureWorkspaceCheckpoint,
	sanitizeRefSegment,
} from '../checkpoints/index.ts';
import type { LocalCommandService } from '../commands/local-command';
import { loadRepositoryConfig } from '../config/index.ts';
import {
	copyOneFile,
	listFilesToCopyMatches,
	resolveFilesToCopyPatterns,
} from './files-to-copy.ts';
import { runWorktreeRemove } from './git-ops.ts';

/**
 * Directory inside a preserved archive context holding the workspace's
 * files-to-copy matches, mirroring their layout relative to the worktree root.
 */
export const ARCHIVED_FILES_TO_COPY_DIRECTORY = 'files-to-copy';

const DISK_USAGE_TIMEOUT_MS = 60_000;

/**
 * What a prune left behind for the rehydrate to work from. `status` is
 * `skipped` when the worktree was already gone, so a caller can stamp the
 * record without treating an absent directory as a failure.
 */
export interface PruneWorktreeOutcome {
	/** Bytes the removal reclaimed, or null when the measurement could not run. */
	bytesFreed: number | null;
	/** Branch tip at prune time, so a branch deleted out of band stays recreatable. */
	headCommit: string | null;
	/** Present only on `failure`. */
	message?: string;
	status: 'failure' | 'pruned' | 'skipped';
	/** Snapshot commit holding the removed working tree. */
	wipCommit: string | null;
	/** Private ref pinning the snapshot, and through it the branch history. */
	wipRef: string | null;
}

/**
 * Private ref a pruned workspace is re-derived from. The snapshot commit it
 * points at has the branch tip as its parent, so this single ref pins both the
 * captured working tree and the branch's whole history against `git gc` — even
 * if the branch itself is later deleted outside the app.
 * @param workspaceId - Workspace whose prune this ref belongs to.
 * @returns The fully-qualified ref name.
 */
export function archivedWorktreeRefFor(workspaceId: string): string {
	return `refs/ensemblr/archived/${sanitizeRefSegment(workspaceId)}`;
}

/**
 * Removes a workspace's worktree directory while keeping its branch, capturing
 * everything the directory held that git does not already store.
 *
 * A worktree is overwhelmingly gitignored dependencies and build output, all of
 * which the setup script rebuilds; what is not recoverable is uncommitted work
 * and the locally-edited files-to-copy matches, so both are preserved before
 * anything is deleted. Both captures run first and either one failing aborts
 * the prune: refusing to reclaim disk is always better than reclaiming work.
 * @param options - Workspace and repository paths plus git dependencies.
 * @returns What was preserved, and how much disk the removal freed.
 */
export async function pruneWorktree({
	archivedContextPath,
	localCommandService,
	repositoryPath,
	workspaceId,
	workspacePath,
}: {
	/** Preserved archive directory the files-to-copy matches are copied under. */
	archivedContextPath: string | null;
	localCommandService: LocalCommandService;
	repositoryPath: string;
	workspaceId: string;
	workspacePath: string;
}): Promise<PruneWorktreeOutcome> {
	if (!existsSync(workspacePath)) {
		return {
			bytesFreed: null,
			headCommit: null,
			status: 'skipped',
			wipCommit: null,
			wipRef: null,
		};
	}

	const captured = await captureWorkingTree({ workspaceId, workspacePath });
	if ('message' in captured) {
		return {
			bytesFreed: null,
			headCommit: null,
			message: captured.message,
			status: 'failure',
			wipCommit: null,
			wipRef: null,
		};
	}
	const headCommit = captured.parentHash;

	// Neither reads what the other writes, and both walk the tree the removal is
	// about to unlink, so the user waits for one pass rather than two.
	const [preserved, bytesFreed] = await Promise.all([
		preserveFilesToCopy({
			archivedContextPath,
			localCommandService,
			workspacePath,
		}),
		measureDirectoryBytes({
			directoryPath: workspacePath,
			localCommandService,
		}),
	]);

	if (preserved !== null) {
		return {
			bytesFreed: null,
			headCommit,
			message: preserved.message,
			status: 'failure',
			wipCommit: captured.commitHash,
			wipRef: captured.ref,
		};
	}

	// The ordering dependency here runs through the filesystem rather than a
	// value, so it is invisible to the analyzer: the removal deletes the very
	// files the copy above reads, and the directory `du` above measures.
	// oxlint-disable-next-line react-doctor/server-sequential-independent-await
	const removal = await runWorktreeRemove({
		localCommandService,
		repositoryPath,
		workspacePath,
	});
	if (removal.status === 'failure') {
		return {
			bytesFreed: null,
			headCommit,
			message: removal.message,
			status: 'failure',
			wipCommit: captured.commitHash,
			wipRef: captured.ref,
		};
	}

	return {
		bytesFreed,
		headCommit,
		status: 'pruned',
		wipCommit: captured.commitHash,
		wipRef: captured.ref,
	};
}

/**
 * Copies the workspace's files-to-copy matches into the preserved archive
 * directory, so a `.env` the user edited inside the worktree survives the
 * removal rather than reverting to the repository root's copy on rehydrate.
 *
 * These are the one class of file the working-tree snapshot cannot hold: it
 * stages with `git add -A`, which honours `.gitignore`, and a files-to-copy
 * match is gitignored by definition. Nothing else restores them either —
 * unarchive has no files-to-copy step — so a failure here is not best-effort,
 * it is the whole reason the prune has to stop.
 *
 * Patterns resolve from the worktree's own committed config plus the built-in
 * default. A personal (SQLite) pattern override is not applied here — reading it
 * would need a settings resolver this path does not have — so a purely personal
 * pattern is restored from the repository root instead of preserved verbatim.
 * @param options - Archive destination, workspace path, and git dependencies.
 * @returns Null when everything matched was preserved, or the message naming
 * what could not be.
 */
async function preserveFilesToCopy({
	archivedContextPath,
	localCommandService,
	workspacePath,
}: {
	archivedContextPath: string | null;
	localCommandService: LocalCommandService;
	workspacePath: string;
}): Promise<{ message: string } | null> {
	const { patterns } = resolveFilesToCopyPatterns(
		loadRepositoryConfig({ repositoryPath: workspacePath }),
	);

	const listed = await listFilesToCopyMatches({
		cwd: workspacePath,
		localCommandService,
		patterns,
	});
	if (listed.error !== null) {
		return {
			message: `The workspace's files-to-copy matches could not be listed, so the worktree was kept: ${listed.error}`,
		};
	}

	if (listed.relativePaths.length === 0) {
		return null;
	}

	if (!archivedContextPath) {
		return {
			message: `This archive has no preserved context directory to hold ${listed.relativePaths.length} gitignored files-to-copy file(s), which nothing else would restore, so the worktree was kept.`,
		};
	}

	const destinationRoot = path.join(
		archivedContextPath,
		ARCHIVED_FILES_TO_COPY_DIRECTORY,
	);
	for (const relativePath of listed.relativePaths) {
		const outcome = copyOneFile(
			path.join(workspacePath, relativePath),
			path.join(destinationRoot, relativePath),
		);
		if (outcome.status === 'failed') {
			return {
				message: `${relativePath} could not be preserved, so the worktree was kept: ${outcome.message}`,
			};
		}
	}

	return null;
}

/**
 * Captures the worktree's full working state into the workspace's private
 * archive ref, translating a thrown {@link GitCheckpointError} into a message.
 * The parent it reports is HEAD at capture time — the branch tip a rehydrate
 * recreates the branch at, so nothing has to read it a second time.
 * @param options - Workspace id and path.
 * @returns The capture identifiers, or the message explaining the failure.
 */
async function captureWorkingTree({
	workspaceId,
	workspacePath,
}: {
	workspaceId: string;
	workspacePath: string;
}): Promise<
	| { commitHash: string; parentHash: string | null; ref: string }
	| { message: string }
> {
	try {
		const captured = await captureWorkspaceCheckpoint({
			cwd: workspacePath,
			message: `Ensemblr archive snapshot for workspace ${workspaceId}`,
			ref: archivedWorktreeRefFor(workspaceId),
		});
		return {
			commitHash: captured.commitHash,
			parentHash: captured.parentHash,
			ref: captured.ref,
		};
	} catch (error) {
		return {
			message:
				error instanceof Error
					? `The working tree could not be snapshotted, so the worktree was kept: ${error.message}`
					: 'The working tree could not be snapshotted, so the worktree was kept.',
		};
	}
}

/**
 * Measures a directory with `du -sk` so the caller can report bytes reclaimed.
 *
 * The walk is the same one the removal is about to do, and it is the only way
 * to report a real number rather than an estimate. Best-effort: an unavailable
 * or slow `du` reports null and the caller says nothing about size, which is
 * never a reason to skip the removal itself.
 * @param options - Directory to measure and the command runner.
 * @returns Size in bytes, or null when the measurement did not complete.
 */
async function measureDirectoryBytes({
	directoryPath,
	localCommandService,
}: {
	directoryPath: string;
	localCommandService: LocalCommandService;
}): Promise<number | null> {
	try {
		const result = await localCommandService.run({
			args: ['-sk', directoryPath],
			command: 'du',
			cwd: directoryPath,
			maxOutputBytes: 4 * 1024,
			timeoutMs: DISK_USAGE_TIMEOUT_MS,
		});
		if (result.status !== 'success') {
			return null;
		}
		const kilobytes = Number.parseInt(result.stdout.trim().split(/\s+/)[0], 10);
		return Number.isFinite(kilobytes) ? kilobytes * 1024 : null;
	} catch {
		return null;
	}
}
