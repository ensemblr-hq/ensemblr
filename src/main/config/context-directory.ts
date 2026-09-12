import { existsSync } from 'node:fs';
import { sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ensureContainedDirectory, isSingleSegment } from '../safe-fs/index.ts';

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
 *
 * Every segment must name exactly one child entry. `new URL(...)` collapses a
 * `..` rather than rejecting it, so a segment carrying one would resolve above
 * the worktree and hand a caller a path it believes is contained — the reason
 * the refusal lives in this shared primitive rather than in each caller.
 * @param worktreePath - Absolute path to the workspace worktree root.
 * @param segments - Path segments appended under `.context`, one child each.
 * @returns The absolute path under the worktree's `.context` directory, or null
 * when a segment does not name a single child entry.
 */
export function resolveContextPath(
	worktreePath: string,
	...segments: string[]
): string | null {
	if (!segments.every(isSingleSegment)) {
		return null;
	}

	const relative = [CONTEXT_DIRECTORY, ...segments].join('/');

	return fileURLToPath(new URL(relative, directoryUrl(worktreePath)));
}

/**
 * Resolves a writable path under a worktree's {@link CONTEXT_DIRECTORY},
 * creating its parent directory, and refuses when the worktree root itself is
 * gone or when any level of the chain resolves outside it.
 *
 * A plain recursive `mkdir` on the resolved path would materialize the whole
 * chain — worktree root included — under a directory archiving already pruned,
 * putting that directory back on disk as a side effect of a routine background
 * write. It would also follow a `.context` the repository committed as a
 * symlink, redirecting every write out of the worktree, which is why each level
 * is re-checked against the worktree's real path after it is created. Every
 * writer that persists into `.context` must go through this rather than
 * resolving and creating the path itself.
 * @param worktreePath - Absolute path to the workspace worktree root.
 * @param segments - Path segments appended under `.context`; the last names the file.
 * @returns The absolute path, or null when the worktree root no longer exists,
 * a segment is unusable, or a level escaped the worktree.
 */
export function ensureContextPath(
	worktreePath: string,
	...segments: string[]
): string | null {
	if (!existsSync(worktreePath) || !segments.every(isSingleSegment)) {
		return null;
	}

	const fileName = segments.at(-1);
	if (fileName === undefined) {
		return null;
	}

	const directory = ensureContainedDirectory(worktreePath, [
		CONTEXT_DIRECTORY,
		...segments.slice(0, -1),
	]);

	return directory === null ? null : `${directory}${sep}${fileName}`;
}
