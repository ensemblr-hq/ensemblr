import { cp } from 'node:fs/promises';

/** Outcome of an attempted recursive directory copy. */
export interface CopyDirectoryOutcome {
	/** A message describing the last failed attempt, or null when one succeeded. */
	error: string | null;
}

/** The copy primitive {@link copyDirectoryTree} retries; overridden in tests. */
export type CopyTree = (
	sourcePath: string,
	targetPath: string,
) => Promise<void>;

const COPY_MAX_ATTEMPTS = 3;
const COPY_RETRY_DELAY_MS = 100;
const UNKNOWN_COPY_ERROR = 'Failed to copy the directory.';

/**
 * Copies a directory tree verbatim — symlinks, timestamps, and all — retrying a
 * walk that failed.
 *
 * `fs.cp` has no `maxRetries` of its own and the trees this copies are live: a
 * workspace's `.context/` holds terminal scrollback a debounced flush rewrites
 * and rotates, so a file can vanish between the walk that listed it and the read
 * that would have copied it. A retry re-walks without the entry that has already
 * gone, which is why one failed attempt is not the answer.
 * @param sourcePath - Absolute path of the tree to copy
 * @param targetPath - Absolute path to copy it to
 * @param copyTree - Copy primitive to retry; defaults to a verbatim recursive `fs.cp`
 * @returns The last attempt's error message, or null once an attempt succeeded
 */
export async function copyDirectoryTree(
	sourcePath: string,
	targetPath: string,
	copyTree: CopyTree = defaultCopyTree,
): Promise<CopyDirectoryOutcome> {
	let lastError = UNKNOWN_COPY_ERROR;

	for (let attempt = 1; attempt <= COPY_MAX_ATTEMPTS; attempt += 1) {
		try {
			await copyTree(sourcePath, targetPath);
			return { error: null };
		} catch (error) {
			lastError = error instanceof Error ? error.message : UNKNOWN_COPY_ERROR;
		}

		if (attempt < COPY_MAX_ATTEMPTS) {
			await delay(COPY_RETRY_DELAY_MS);
		}
	}

	return { error: lastError };
}

/**
 * Default {@link CopyTree}: a recursive `fs.cp` that reproduces the source
 * rather than resolving it — symlinks stay symlinks and timestamps survive, so a
 * restored `.context/` is the one that was archived.
 * @param sourcePath - Absolute path of the tree to copy
 * @param targetPath - Absolute path to copy it to
 */
function defaultCopyTree(
	sourcePath: string,
	targetPath: string,
): Promise<void> {
	return cp(sourcePath, targetPath, {
		dereference: false,
		errorOnExist: false,
		force: true,
		preserveTimestamps: true,
		recursive: true,
		verbatimSymlinks: true,
	});
}

/**
 * Waits before the next copy attempt, giving a concurrent writer time to finish
 * the flush that removed the entry underneath the last walk.
 * @param milliseconds - How long to wait
 */
function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, milliseconds);
	});
}
