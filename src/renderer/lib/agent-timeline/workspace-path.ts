import type {
	WorkspaceFileSummary,
	WorkspacePathMatch,
	WorkspacePathResolver,
} from '@/renderer/types/workbench';

/**
 * Normalizes a tool-reported file path to workspace-relative form. Tool
 * inputs may carry absolute paths; the read-file IPC expects paths relative
 * to the workspace cwd, so the cwd prefix is stripped when present.
 * @param filePath - Absolute or workspace-relative path from a tool call.
 * @param workspaceCwd - Absolute workspace root when known.
 * @returns The path relative to the workspace root.
 */
function toWorkspaceRelativePath(
	filePath: string,
	workspaceCwd: string | null,
): string {
	if (workspaceCwd && filePath.startsWith(`${workspaceCwd}/`)) {
		return filePath.slice(workspaceCwd.length + 1);
	}
	return filePath;
}

/**
 * Canonicalizes a path into the workspace-relative, trailing-slash-free shape
 * the file tree keys on, so chip lookups and directory reveals compare equal.
 * @param filePath - Absolute or workspace-relative path from a chip.
 * @param workspaceCwd - Absolute workspace root when known.
 * @returns Workspace-relative path without trailing slashes.
 */
export function toWorkspaceLookupPath(
	filePath: string,
	workspaceCwd: string | null,
): string {
	return toWorkspaceRelativePath(filePath, workspaceCwd).replace(/\/+$/, '');
}

/**
 * Whether a path names a location the workspace file tree can never hold, so it
 * should go straight to the preview rather than through a tree lookup. `~/` is
 * included because the main process expands it against the home directory.
 * @param filePath - Path already stripped of any workspace-root prefix.
 * @returns True when the path is absolute or home-relative.
 */
export function isOutsideWorkspacePath(filePath: string): boolean {
	return filePath.startsWith('/') || filePath.startsWith('~/');
}

/**
 * Reduces a lookup path to plain workspace-relative segments, dropping the `./`
 * prefix an agent may write and resolving `.`/`..` away. A climb that escapes
 * the workspace root is re-anchored on the root and reported as external, so
 * `../sibling-worktree/file.ts` names something the preview can still read.
 * @param lookupPath - Workspace-relative path as the agent reported it
 * @param workspaceCwd - Absolute workspace root, needed to anchor an escaping climb
 * @returns The normalized path and its scope, or null when it is empty or cannot be anchored
 */
function normalizeLookupPath(
	lookupPath: string,
	workspaceCwd: string | null,
): { path: string; scope: 'external' | 'workspace' } | null {
	const segments: string[] = [];
	let climbedOut = 0;
	for (const segment of lookupPath.split('/')) {
		if (segment === '' || segment === '.') {
			continue;
		}
		if (segment !== '..') {
			segments.push(segment);
			continue;
		}
		if (segments.length === 0) {
			climbedOut += 1;
			continue;
		}
		segments.pop();
	}
	if (climbedOut === 0) {
		return segments.length > 0
			? { path: segments.join('/'), scope: 'workspace' }
			: null;
	}
	const rootSegments = (workspaceCwd ?? '').split('/').filter(Boolean);
	if (rootSegments.length < climbedOut) {
		return null;
	}
	const anchored = [
		...rootSegments.slice(0, rootSegments.length - climbedOut),
		...segments,
	];
	return anchored.length > 0
		? { path: `/${anchored.join('/')}`, scope: 'external' }
		: null;
}

/**
 * Narrows basename candidates to the ones whose trailing path segments are
 * exactly `suffix`, so `components/message.tsx` matches
 * `src/renderer/components/message.tsx` but `age.tsx` matches nothing.
 * @param candidates - Entries sharing the looked-up basename
 * @param suffix - Trailing path fragment the entry must end with
 * @returns The candidates matching on a segment boundary
 */
function entriesEndingWith(
	candidates: readonly WorkspacePathMatch[],
	suffix: string,
): readonly WorkspacePathMatch[] {
	return candidates.filter(
		(candidate) =>
			candidate.path === suffix || candidate.path.endsWith(`/${suffix}`),
	);
}

/**
 * Builds a resolver that maps a path an agent wrote in prose onto the entry the
 * workspace file tree actually holds.
 *
 * Agents misreport paths in two ways this has to survive. They reference a file
 * they deleted or moved earlier in the same turn, which must not open a preview
 * tab onto an error; and some models (Mistral notably) print a trailing
 * fragment of the path — `components/message.tsx` — instead of the full
 * workspace-relative one. A fragment resolves only when exactly one entry ends
 * with it on a segment boundary; an ambiguous fragment stays unresolved rather
 * than opening the wrong file.
 *
 * An empty tree means "not loaded yet" or "not a git repo", not "nothing
 * exists", so the resolver answers optimistically there.
 *
 * A path outside the workspace root bypasses the tree entirely. Agents write to
 * `/tmp` and `~/.claude/` constantly, and the tree can never hold those, so a
 * miss there must not read as "this file does not exist" — it resolves as
 * external and the preview reads it by absolute path.
 *
 * An external match is always reported as `kind: 'file'`. Nothing here can tell
 * a file from a directory off-tree, and the two guesses fail differently: a
 * directory guessed as a file opens a preview that says so, while a file
 * guessed as a directory reveals nothing and loses the content the user asked
 * for. The recoverable guess wins.
 *
 * @param files - Current workspace file tree.
 * @param workspaceCwd - Absolute workspace root, used to relativize absolute paths.
 * @returns A resolver returning the matching entry, or null when the tree does not hold the path.
 */
export function createWorkspacePathResolver(
	files: readonly WorkspaceFileSummary[],
	workspaceCwd: string | null,
): WorkspacePathResolver {
	const byPath = new Map<string, WorkspacePathMatch>();
	const byName = new Map<string, WorkspacePathMatch[]>();
	for (const file of files) {
		const entry: WorkspacePathMatch = {
			kind: file.kind,
			path: file.path,
			scope: 'workspace',
		};
		byPath.set(file.path, entry);
		const name = file.path.split('/').at(-1) ?? file.path;
		byName.set(name, [...(byName.get(name) ?? []), entry]);
	}
	const isTreeKnown = byPath.size > 0;

	return (filePath: string) => {
		const relativized = toWorkspaceLookupPath(filePath, workspaceCwd);
		if (isOutsideWorkspacePath(relativized)) {
			return { kind: 'file', path: relativized, scope: 'external' };
		}
		const normalized = normalizeLookupPath(relativized, workspaceCwd);
		if (normalized === null) {
			return null;
		}
		if (normalized.scope === 'external') {
			return { kind: 'file', path: normalized.path, scope: 'external' };
		}
		const lookupPath = normalized.path;
		if (!isTreeKnown) {
			return { kind: 'file', path: lookupPath, scope: 'workspace' };
		}
		const exact = byPath.get(lookupPath);
		if (exact) {
			return exact;
		}
		const name = lookupPath.split('/').at(-1) ?? lookupPath;
		const matches = entriesEndingWith(byName.get(name) ?? [], lookupPath);
		return matches.length === 1 ? (matches[0] ?? null) : null;
	};
}
