import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import type { LocalCommandService } from '../commands/local-command';
import type { EnsemblrRootDirectoryService } from '../root';
import type { EnsemblrDatabaseService } from '../storage';
import { listAllWorkspaceRows } from '../storage/repositories/workspace-repository.ts';
import { measureDirectoryBytes } from './directory-bytes.ts';
import { canonicalPath, containmentRefusal } from './managed-path.ts';
import { removeDirectoryTree } from './remove-directory.ts';
import { isRecord } from './row-guards.ts';

/**
 * Entries a directory may hold and still count as empty. Finder writes
 * `.DS_Store` into any folder the user browses, which would otherwise keep an
 * emptied repository folder alive forever.
 */
const IGNORABLE_ENTRIES = new Set(['.DS_Store']);

/** How deep under the workspaces root a worktree directory sits. */
const WORKTREE_DEPTH = 2;

/** What one sweep reclaimed, and what it refused to touch. */
export interface WorkspaceDiskSweepReport {
	/** Bytes reclaimed across every removal that could be measured. */
	bytesFreed: number;
	/** English detail lines for anything that could not be swept. */
	failures: string[];
	removedEmptyRepositoryDirectories: number;
	removedOrphanDirectories: number;
	removedWorktrees: number;
}

/** Public surface of the startup workspace-disk sweep. */
export interface WorkspaceDiskSweepService {
	sweep: () => Promise<WorkspaceDiskSweepReport>;
}

/** Options for {@link createWorkspaceDiskSweepService}. */
export interface CreateWorkspaceDiskSweepServiceOptions {
	databaseService: EnsemblrDatabaseService;
	localCommandService: LocalCommandService;
	rootDirectoryService: EnsemblrRootDirectoryService;
}

/** A workspace directory the sweep decided it may remove, and why. */
interface SweepCandidate {
	kind: 'archived-worktree' | 'orphan';
	path: string;
}

/**
 * Builds the service that reclaims workspace directories the lifecycle believes
 * it already removed.
 *
 * Archiving prunes the worktree and records that it did, but the removal only
 * holds if nothing writes to the path afterwards — a build that outlived the
 * teardown, or a background write into `.context`, puts the directory back
 * minutes or hours later. Deleting a workspace loses the same race, and leaves
 * a directory with no row pointing at it at all. Nothing notices either, so the
 * disk is never reclaimed and, for an archive, `git worktree add` then refuses
 * to unarchive into the non-empty path.
 *
 * Startup is the one moment when nothing in the app is writing into a workspace,
 * so the sweep always wins here. It runs silently: reclaiming is what archiving
 * already claims to do, so there is nothing to report to the user, only
 * something to stop lying about.
 * @param options - Database, root directory, and command dependencies.
 * @returns A sweep service the composition root fires once per launch.
 */
export function createWorkspaceDiskSweepService({
	databaseService,
	localCommandService,
	rootDirectoryService,
}: CreateWorkspaceDiskSweepServiceOptions): WorkspaceDiskSweepService {
	return {
		sweep: async () => {
			const failures: string[] = [];
			const workspacesRoot = resolveWorkspacesRoot(rootDirectoryService);
			const database = databaseService.getConnection()?.database ?? null;

			if (!workspacesRoot || !database) {
				return emptyReport(failures);
			}

			const rows = readWorkspaceRows({ database, failures });
			if (rows === null) {
				return emptyReport(failures);
			}

			const candidates = collectCandidates({
				failures,
				rows,
				workspacesRoot,
			});

			const confirmRemoval = (candidate: SweepCandidate) =>
				removalRefusal({ candidate, database, workspacesRoot });

			let bytesFreed = 0;
			let removedOrphanDirectories = 0;
			let removedWorktrees = 0;

			for (const candidate of candidates) {
				// Sequential on purpose: each removal is an unlink storm over tens of
				// thousands of inodes, and running them together only contends for the
				// same disk while the app is still opening its window.
				// oxlint-disable-next-line react-doctor/async-await-in-loop
				const freed = await removeCandidate({
					candidate,
					confirmRemoval,
					failures,
					localCommandService,
				});
				if (freed === null) {
					continue;
				}

				bytesFreed += freed;
				if (candidate.kind === 'orphan') {
					removedOrphanDirectories += 1;
				} else {
					removedWorktrees += 1;
				}
			}

			return {
				bytesFreed,
				failures,
				removedEmptyRepositoryDirectories:
					await removeEmptyRepositoryDirectories({ failures, workspacesRoot }),
				removedOrphanDirectories,
				removedWorktrees,
			};
		},
	};
}

/**
 * Reads the managed workspaces root, which the sweep never steps outside of.
 * @param rootDirectoryService - Service owning the managed root.
 * @returns The real path of the workspaces root, or null when it is unusable.
 */
function resolveWorkspacesRoot(
	rootDirectoryService: EnsemblrRootDirectoryService,
): string | null {
	const snapshot = rootDirectoryService.getSnapshot();
	if (!snapshot || snapshot.status === 'error' || !snapshot.workspacesPath) {
		return null;
	}

	return canonicalPath(snapshot.workspacesPath);
}

/** Fields the sweep needs from a workspace row. */
interface SweepWorkspaceRow {
	archivedAt: string | null;
	branchCleanup: boolean;
	path: string;
	worktreePruned: boolean;
}

/**
 * Reads every workspace row, narrowed to the four fields the sweep decides on.
 * A read that throws answers null, so a sweep never removes anything on the
 * strength of an incomplete picture of what is registered.
 * @param options - Database handle and diagnostics sink.
 * @returns The rows, or null when they could not be read.
 */
function readWorkspaceRows({
	database,
	failures,
}: {
	database: Parameters<typeof listAllWorkspaceRows>[0]['database'];
	failures: string[];
}): SweepWorkspaceRow[] | null {
	try {
		return listAllWorkspaceRows({ database }).flatMap((row) =>
			isRecord(row) && typeof row.path === 'string'
				? [
						{
							archivedAt:
								typeof row.archivedAt === 'string' ? row.archivedAt : null,
							branchCleanup: row.branchCleanupRaw === 1,
							path: row.path,
							worktreePruned: row.worktreePrunedRaw === 1,
						},
					]
				: [],
		);
	} catch (error) {
		failures.push(`Could not read the workspace rows: ${errorMessage(error)}`);
		return null;
	}
}

/**
 * Reports whether an archived workspace's worktree is definitively gone, so
 * whatever is left at its path is residue rather than the checkout.
 *
 * Two archives qualify. A pruned one recorded that `git worktree remove`
 * succeeded and kept the tree recoverable behind a ref. A branch-cleanup one
 * never records a prune — it takes the discard path instead — but it removed
 * the worktree and deleted the branch, so nothing can rehydrate it either.
 * @param row - Workspace row to classify.
 * @returns True when the row's directory can only hold residue.
 */
function isArchivedWithoutWorktree(row: SweepWorkspaceRow): boolean {
	return row.archivedAt !== null && (row.worktreePruned || row.branchCleanup);
}

/**
 * Decides which directories under the workspaces root may be removed: those
 * belonging to an archive whose worktree is definitively gone, and those
 * belonging to no row at all.
 * @param options - Diagnostics sink, workspace rows, and the workspaces root.
 * @returns Every candidate, worktrees before orphans.
 */
function collectCandidates({
	failures,
	rows,
	workspacesRoot,
}: {
	failures: string[];
	rows: readonly SweepWorkspaceRow[];
	workspacesRoot: string;
}): SweepCandidate[] {
	const registered = new Set(rows.map((row) => canonicalPath(row.path)));

	const archivedWorktrees = rows.flatMap<SweepCandidate>((row) =>
		isArchivedWithoutWorktree(row) &&
		isSweepable({ candidatePath: row.path, failures, workspacesRoot })
			? [{ kind: 'archived-worktree', path: row.path }]
			: [],
	);

	// `isSweepable` refuses a `.git` too, and loudly. Short-circuiting here keeps
	// a repository the user cloned into `workspaces/` by hand from reporting
	// itself on every launch — for an orphan a checkout is ordinary, where under
	// an archived row it means the worktree came back and someone should know.
	const orphans = listWorktreeDirectories({
		failures,
		workspacesRoot,
	}).flatMap<SweepCandidate>((directoryPath) =>
		!registered.has(canonicalPath(directoryPath)) &&
		!isGitWorktreeDirectory(directoryPath) &&
		isSweepable({ candidatePath: directoryPath, failures, workspacesRoot })
			? [{ kind: 'orphan', path: directoryPath }]
			: [],
	);

	return [...archivedWorktrees, ...orphans];
}

/**
 * Guards every removal the sweep makes: the path must exist, must hold no
 * `.git`, and must resolve to a directory exactly {@link WORKTREE_DEPTH} levels
 * inside the managed workspaces root, after symlinks.
 * @param options - Candidate path, diagnostics sink, and the workspaces root.
 * @returns True when the path is safe to remove.
 */
function isSweepable({
	candidatePath,
	failures,
	workspacesRoot,
}: {
	candidatePath: string;
	failures: string[];
	workspacesRoot: string;
}): boolean {
	if (!existsSync(candidatePath)) {
		return false;
	}

	const refusal = sweepRefusal({ candidatePath, workspacesRoot });
	if (refusal !== null) {
		failures.push(refusal);
		return false;
	}

	return true;
}

/**
 * States why a directory may not be swept, on the two grounds that hold however
 * the candidate was classified.
 *
 * The containment check is on the real path rather than the written one, so a
 * workspace row pointing through a symlink — or a symlink planted in the
 * workspaces root — cannot walk a recursive removal out of the managed tree.
 * The `.git` check is what keeps the sweep off a checkout: no candidate is ever
 * a directory git still owns, whether because git never dropped it or because
 * an unarchive has already checked one back out at the path.
 * @param options - Candidate path and the workspaces root.
 * @returns The refusal sentence, or null when the path is safe to remove.
 */
function sweepRefusal({
	candidatePath,
	workspacesRoot,
}: {
	candidatePath: string;
	workspacesRoot: string;
}): string | null {
	const refusal = containmentRefusal({
		candidatePath,
		expectedDepth: WORKTREE_DEPTH,
		root: workspacesRoot,
	});
	if (refusal !== null) {
		return refusal;
	}

	if (isGitWorktreeDirectory(candidatePath)) {
		return `Refused to sweep ${candidatePath}: it holds a .git entry, so a checkout lives there.`;
	}

	return null;
}

/**
 * Re-checks a candidate against the live database and filesystem in the instant
 * before its removal, and refuses anything that has moved since it was
 * collected.
 *
 * The sweep is fired at launch and runs while the window is opening, so the
 * user can reach Restore before it finishes — and an unarchive materializes the
 * worktree *before* it clears `archived_at`, which means a crash or a failed
 * clear leaves a full checkout under a row that still reads archived. Deciding
 * on the collected snapshot would unlink it. Every doubt refuses: an unreadable
 * database, a row that changed, a `.git` that appeared.
 * @param options - The candidate, database handle, and the workspaces root.
 * @returns The refusal sentence, or null when the removal may still proceed.
 */
function removalRefusal({
	candidate,
	database,
	workspacesRoot,
}: {
	candidate: SweepCandidate;
	database: Parameters<typeof listAllWorkspaceRows>[0]['database'];
	workspacesRoot: string;
}): string | null {
	const refusal = sweepRefusal({
		candidatePath: candidate.path,
		workspacesRoot,
	});
	if (refusal !== null) {
		return refusal;
	}

	const recheck: string[] = [];
	const rows = readWorkspaceRows({ database, failures: recheck });
	if (rows === null) {
		return `Refused to sweep ${candidate.path}: ${recheck.join(' ')}`;
	}

	const resolved = canonicalPath(candidate.path);
	const owner = rows.find((row) => canonicalPath(row.path) === resolved);

	if (candidate.kind === 'orphan') {
		return owner
			? `Refused to sweep ${candidate.path}: a workspace now points at it.`
			: null;
	}

	return owner && isArchivedWithoutWorktree(owner)
		? null
		: `Refused to sweep ${candidate.path}: its workspace is no longer an archive without a worktree.`;
}

/**
 * Lists every `<repository>/<workspace>` directory under the workspaces root.
 * @param options - Diagnostics sink and the workspaces root.
 * @returns Absolute paths of the workspace-level directories.
 */
function listWorktreeDirectories({
	failures,
	workspacesRoot,
}: {
	failures: string[];
	workspacesRoot: string;
}): string[] {
	return listDirectories({ directoryPath: workspacesRoot, failures }).flatMap(
		(repositoryDirectory) =>
			listDirectories({ directoryPath: repositoryDirectory, failures }),
	);
}

/**
 * Lists a directory's child directories, reporting an unreadable one rather
 * than throwing out of the sweep.
 * @param options - Directory to read and the diagnostics sink.
 * @returns Absolute paths of the child directories.
 */
function listDirectories({
	directoryPath,
	failures,
}: {
	directoryPath: string;
	failures: string[];
}): string[] {
	try {
		return readdirSync(directoryPath, { withFileTypes: true }).flatMap(
			(entry) =>
				entry.isDirectory() ? [path.join(directoryPath, entry.name)] : [],
		);
	} catch (error) {
		failures.push(`Could not read ${directoryPath}: ${errorMessage(error)}`);
		return [];
	}
}

/**
 * Reports whether a directory still looks like a git checkout.
 *
 * An orphan the sweep is about to remove has no row vouching that its contents
 * are recoverable, so a `.git` entry — which means git may still own the
 * worktree, or that the user put a repository here by hand — is where the sweep
 * stops and leaves the directory to a person.
 * @param directoryPath - Candidate directory.
 * @returns True when the directory holds a `.git` entry.
 */
function isGitWorktreeDirectory(directoryPath: string): boolean {
	return existsSync(path.join(directoryPath, '.git'));
}

/**
 * Measures and removes one candidate, re-confirming it after the measurement.
 *
 * `du` walks the whole tree and is given a minute, so the confirmation has to
 * sit between it and the unlink rather than before both: that is the last
 * instant at which the sweep can still notice the user restored the workspace
 * while it was counting.
 * @param options - The candidate, the last-instant re-check, diagnostics sink, and the command runner.
 * @returns Bytes reclaimed, or null when the removal did not happen.
 */
async function removeCandidate({
	candidate,
	confirmRemoval,
	failures,
	localCommandService,
}: {
	candidate: SweepCandidate;
	confirmRemoval: (candidate: SweepCandidate) => string | null;
	failures: string[];
	localCommandService: LocalCommandService;
}): Promise<number | null> {
	const bytes = await measureDirectoryBytes({
		directoryPath: candidate.path,
		localCommandService,
	});

	const refusal = confirmRemoval(candidate);
	if (refusal !== null) {
		failures.push(refusal);
		return null;
	}

	// The measurement walks the very tree this unlinks, so it has to finish first.
	// oxlint-disable-next-line react-doctor/server-sequential-independent-await
	const removal = await removeDirectoryTree(candidate.path);
	if (!removal.removed) {
		failures.push(
			`Could not sweep ${candidate.path}${removal.error ? `: ${removal.error}` : '.'}`,
		);
		return null;
	}

	return bytes ?? 0;
}

/**
 * Removes repository folders left holding nothing once their workspaces are
 * gone, so the workspaces root does not accumulate a folder per repository the
 * user has finished with.
 * @param options - Diagnostics sink and the workspaces root.
 * @returns How many folders were removed.
 */
async function removeEmptyRepositoryDirectories({
	failures,
	workspacesRoot,
}: {
	failures: string[];
	workspacesRoot: string;
}): Promise<number> {
	const empty = listDirectories({
		directoryPath: workspacesRoot,
		failures,
	}).filter(
		(directoryPath) =>
			// A dot-directory at this level is not a repository folder but another
			// concern's own scratch space — `.setup-smoke`, which the Pi RPC startup
			// check creates and runs in. Emptiness says nothing about whether its
			// owner still wants it.
			!path.basename(directoryPath).startsWith('.') &&
			isEffectivelyEmpty({ directoryPath, failures }),
	);

	const removals = await Promise.all(
		empty.map(async (directoryPath) => ({
			directoryPath,
			outcome: await removeDirectoryTree(directoryPath),
		})),
	);

	for (const { directoryPath, outcome } of removals) {
		if (!outcome.removed) {
			failures.push(
				`Could not sweep ${directoryPath}${outcome.error ? `: ${outcome.error}` : '.'}`,
			);
		}
	}

	return removals.filter(({ outcome }) => outcome.removed).length;
}

/**
 * Reports whether a directory holds nothing but entries no one would miss.
 * @param options - Directory to test and the diagnostics sink.
 * @returns True when the directory can be removed without losing anything.
 */
function isEffectivelyEmpty({
	directoryPath,
	failures,
}: {
	directoryPath: string;
	failures: string[];
}): boolean {
	try {
		return readdirSync(directoryPath).every((entry) =>
			IGNORABLE_ENTRIES.has(entry),
		);
	} catch (error) {
		failures.push(`Could not read ${directoryPath}: ${errorMessage(error)}`);
		return false;
	}
}

/**
 * Builds the report of a sweep that could not run.
 * @param failures - Whatever stopped it.
 * @returns A report claiming nothing was reclaimed.
 */
function emptyReport(failures: string[]): WorkspaceDiskSweepReport {
	return {
		bytesFreed: 0,
		failures,
		removedEmptyRepositoryDirectories: 0,
		removedOrphanDirectories: 0,
		removedWorktrees: 0,
	};
}

/**
 * Reads a thrown value's message.
 * @param error - The thrown value.
 * @returns Its message, or a generic sentence when it is not an `Error`.
 */
function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : 'an unexpected error';
}
