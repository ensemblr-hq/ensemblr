import { realpathSync } from 'node:fs';
import path from 'node:path';

import { classifyManagedChild } from '../../shared/managed-path.ts';

/**
 * Resolves a path through symlinks, falling back to its normalized form when it
 * cannot be resolved. `/tmp` and `/private/tmp` compare equal afterwards, which
 * is what lets a written path be matched against one git printed.
 * @param candidate - Path to canonicalize.
 * @returns The real path when it resolves, or the normalized path.
 */
export function canonicalPath(candidate: string): string {
	const normalized = path.resolve(candidate);
	try {
		return realpathSync.native(normalized);
	} catch {
		return normalized;
	}
}

/**
 * States why a path may not be removed as a managed directory, on the two
 * grounds every caller shares: it must resolve inside `root`, and it must sit
 * exactly `expectedDepth` levels in.
 *
 * Both sides are canonicalized before the shared classifier sees them, so a row
 * pointing through a symlink — or a symlink planted inside the managed root —
 * cannot walk a recursive removal out of the tree. Nothing here inspects the
 * directory's contents: a caller that must also refuse a git checkout owns that
 * clause itself, because the repository-delete path removes one on purpose.
 * @param options - Candidate path, the managed root it must sit under, and how deep.
 * @returns The refusal sentence, or null when the path is safe to remove.
 */
export function containmentRefusal({
	candidatePath,
	expectedDepth,
	root,
}: {
	candidatePath: string;
	expectedDepth: number;
	root: string;
}): string | null {
	const verdict = classifyManagedChild({
		candidatePath: canonicalPath(candidatePath),
		expectedDepth,
		root: canonicalPath(root),
	});

	if (verdict === 'outside') {
		return `Refused to remove ${candidatePath}: it resolves outside ${root}.`;
	}

	if (verdict === 'wrong-depth') {
		return `Refused to remove ${candidatePath}: it is not a directory ${expectedDepth} level(s) under ${root}.`;
	}

	return null;
}
