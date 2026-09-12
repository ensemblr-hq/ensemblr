import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';

import { isSymbolicLinkPath } from '../safe-fs/index.ts';
import { containmentRefusal } from './managed-path.ts';

/** Outcome of an attempted recursive directory removal. */
export interface RemoveDirectoryOutcome {
	/** A message describing the throw, or null when the attempt did not throw. */
	error: string | null;
	/** True when the path no longer exists afterwards. */
	removed: boolean;
}

/**
 * How deep a workspace worktree sits under the managed workspaces root:
 * `<workspaces>/<repository-slug>/<workspace-slug>`.
 */
export const WORKTREE_DEPTH = 2;

/**
 * How deep a preserved archive sits under the managed archived-contexts root:
 * `<archived-contexts>/<repository-slug>/<workspace-slug>-<timestamp>`.
 */
export const ARCHIVED_CONTEXT_DEPTH = 2;

const REMOVE_MAX_RETRIES = 3;
const REMOVE_RETRY_DELAY_MS = 100;
const UNKNOWN_REMOVE_ERROR = 'Failed to remove the directory.';

/**
 * Shallowest path this will recurse into: a target must sit at least this many
 * levels below the filesystem root, so no caller can hand it `/` or `/Users`.
 */
const MINIMUM_REMOVAL_DEPTH = 2;

/**
 * States why a path is not a directory tree this module may recurse into, on
 * the grounds that hold whatever root the caller had in mind.
 *
 * Every caller passes a path read from SQLite or composed from one, and a
 * recursive removal is the least recoverable thing the app does — so the shape
 * of the path is checked rather than assumed. A symlink is refused rather than
 * unlinked: `fs.rm` happens to unlink one instead of descending, but that is
 * `rm`'s semantics rather than a guarantee this module made, and a workspace
 * row pointing at a link is a corrupt row worth reporting.
 * @param directoryPath - Path the caller asked to remove.
 * @returns The refusal sentence, or null when the path may be removed.
 */
function removalRefusal(directoryPath: string): string | null {
	if (!path.isAbsolute(directoryPath)) {
		return `Refused to remove ${directoryPath}: it is not an absolute path.`;
	}

	const normalized = path.resolve(directoryPath);
	const depth = normalized.split(path.sep).filter(Boolean).length;
	if (depth < MINIMUM_REMOVAL_DEPTH) {
		return `Refused to remove ${directoryPath}: it is too close to the filesystem root.`;
	}

	if (isSymbolicLinkPath(normalized)) {
		return `Refused to remove ${directoryPath}: it is a symbolic link, not a directory.`;
	}

	return null;
}

/**
 * Removes a directory tree without blocking the main event loop. A worktree
 * carries tens of thousands of `node_modules` entries, and the synchronous form
 * held the Electron main thread — every IPC handler and the native menu with it
 * — for the whole unlink storm, which reads as a frozen app. The retries absorb
 * the `ENOTEMPTY` a concurrent writer provokes by recreating a directory
 * mid-walk, which `rmSync` reported as a partial-removal warning instead.
 *
 * A caller that knows the managed root its target must sit under should use
 * {@link removeManagedDirectory} instead; this applies only the shape checks
 * every caller shares.
 * @param directoryPath - Absolute path of the tree to remove
 * @returns Whether the path is gone afterwards, and the error message when the attempt threw
 */
export async function removeDirectoryTree(
	directoryPath: string,
): Promise<RemoveDirectoryOutcome> {
	const refusal = removalRefusal(directoryPath);
	if (refusal !== null) {
		return { error: refusal, removed: false };
	}

	try {
		await rm(directoryPath, {
			force: true,
			maxRetries: REMOVE_MAX_RETRIES,
			recursive: true,
			retryDelay: REMOVE_RETRY_DELAY_MS,
		});
	} catch (error) {
		return {
			error: error instanceof Error ? error.message : UNKNOWN_REMOVE_ERROR,
			removed: !existsSync(directoryPath),
		};
	}

	return { error: null, removed: !existsSync(directoryPath) };
}

/**
 * Removes a directory tree only after both sides canonicalize to a path exactly
 * `expectedDepth` levels inside the managed `root`.
 *
 * Pairing the containment test with the removal is what keeps it from being
 * something a new call site can forget: the guard used to live at three of the
 * seven call sites, and the four without it removed whatever path a SQLite row
 * happened to carry.
 * @param options - Candidate path, the managed root it must sit under, and how deep
 * @returns Whether the path is gone afterwards, and the refusal or error when it is not
 */
export async function removeManagedDirectory({
	candidatePath,
	expectedDepth,
	root,
}: {
	candidatePath: string;
	expectedDepth: number;
	root: string;
}): Promise<RemoveDirectoryOutcome> {
	const refusal = containmentRefusal({ candidatePath, expectedDepth, root });

	return refusal === null
		? await removeDirectoryTree(candidatePath)
		: { error: refusal, removed: false };
}
