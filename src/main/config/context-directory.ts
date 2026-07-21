import { sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Name of the per-worktree, machine-local handoff directory. Root-gitignored, it
 * holds state that must survive workspace reopen but never enters the user's
 * repository: Pi session transcripts, composer attachments, and the setup marker
 * and terminal output this app persists.
 */
export const CONTEXT_DIRECTORY = '.context';

/** Converts a filesystem directory path into a file URL with a trailing slash. */
function directoryUrl(directoryPath: string): URL {
	const directory = directoryPath.endsWith(sep)
		? directoryPath
		: `${directoryPath}${sep}`;

	return pathToFileURL(directory);
}

/**
 * Resolves the absolute path of a file or subdirectory inside a worktree's
 * {@link CONTEXT_DIRECTORY}.
 * @param worktreePath - Absolute path to the workspace worktree root.
 * @param segments - Path segments appended under `.context`, joined with `/`.
 * @returns The absolute path under the worktree's `.context` directory.
 */
export function resolveContextPath(
	worktreePath: string,
	...segments: string[]
): string {
	const relative = [CONTEXT_DIRECTORY, ...segments].join('/');

	return fileURLToPath(new URL(relative, directoryUrl(worktreePath)));
}
