import { existsSync, mkdirSync } from 'node:fs';
import { dirname, sep } from 'node:path';
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

/**
 * Resolves a writable path under a worktree's {@link CONTEXT_DIRECTORY},
 * creating its parent directory, and refuses when the worktree root itself is
 * gone.
 *
 * A plain recursive `mkdir` on the resolved path would materialize the whole
 * chain — worktree root included — under a directory archiving already pruned,
 * putting that directory back on disk as a side effect of a routine background
 * write. Every writer that persists into `.context` must go through this rather
 * than resolving and creating the path itself.
 * @param worktreePath - Absolute path to the workspace worktree root.
 * @param segments - Path segments appended under `.context`, joined with `/`.
 * @returns The absolute path, or null when the worktree root no longer exists.
 */
export function ensureContextPath(
	worktreePath: string,
	...segments: string[]
): string | null {
	if (!existsSync(worktreePath)) {
		return null;
	}

	const contextPath = resolveContextPath(worktreePath, ...segments);
	mkdirSync(dirname(contextPath), { recursive: true });

	return contextPath;
}
