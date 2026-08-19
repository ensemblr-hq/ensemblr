import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';

/** Outcome of an attempted recursive directory removal. */
export interface RemoveDirectoryOutcome {
	/** A message describing the throw, or null when the attempt did not throw. */
	error: string | null;
	/** True when the path no longer exists afterwards. */
	removed: boolean;
}

const REMOVE_MAX_RETRIES = 3;
const REMOVE_RETRY_DELAY_MS = 100;
const UNKNOWN_REMOVE_ERROR = 'Failed to remove the directory.';

/**
 * Removes a directory tree without blocking the main event loop. A worktree
 * carries tens of thousands of `node_modules` entries, and the synchronous form
 * held the Electron main thread — every IPC handler and the native menu with it
 * — for the whole unlink storm, which reads as a frozen app. The retries absorb
 * the `ENOTEMPTY` a concurrent writer provokes by recreating a directory
 * mid-walk, which `rmSync` reported as a partial-removal warning instead.
 * @param directoryPath - Absolute path of the tree to remove
 * @returns Whether the path is gone afterwards, and the error message when the attempt threw
 */
export async function removeDirectoryTree(
	directoryPath: string,
): Promise<RemoveDirectoryOutcome> {
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
