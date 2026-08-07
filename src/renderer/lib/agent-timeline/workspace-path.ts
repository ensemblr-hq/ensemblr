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
 * Reduces a lookup path to plain workspace-relative segments, dropping the `./`
 * and `/` prefixes an agent may write and resolving `.`/`..` away so no chip can
 * name a file outside the workspace root.
 * @param lookupPath - Workspace-relative path as the agent reported it
 * @returns The segment-normalized path, or null when it is empty or climbs above the root
 */
function toContainedLookupPath(lookupPath: string): string | null {
	const segments: string[] = [];
	for (const segment of lookupPath.split('/')) {
		if (segment === '' || segment === '.') {
			continue;
		}
		if (segment !== '..') {
			segments.push(segment);
			continue;
		}
		if (segments.length === 0) {
			return null;
		}
		segments.pop();
	}
	return segments.length > 0 ? segments.join('/') : null;
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
 * exists", so the resolver answers optimistically there — still only for a path
 * that stays inside the workspace root.
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
		const entry: WorkspacePathMatch = { kind: file.kind, path: file.path };
		byPath.set(file.path, entry);
		const name = file.path.split('/').at(-1) ?? file.path;
		byName.set(name, [...(byName.get(name) ?? []), entry]);
	}
	const isTreeKnown = byPath.size > 0;

	return (filePath: string) => {
		const lookupPath = toContainedLookupPath(
			toWorkspaceLookupPath(filePath, workspaceCwd),
		);
		if (lookupPath === null) {
			return null;
		}
		if (!isTreeKnown) {
			return { kind: 'file', path: lookupPath };
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
