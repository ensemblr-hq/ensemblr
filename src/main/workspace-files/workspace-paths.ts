/**
 * Path-safety helpers shared by the workspace file lister and the attachment
 * store. Both resolve caller-supplied paths against a workspace root and must
 * agree on what "inside the workspace" means, so the checks live here rather
 * than being duplicated on either side.
 */

import { realpath } from 'node:fs/promises';
import path from 'node:path';
import type { WorkspaceFileEntryWire } from '../../shared/ipc/contracts/workspace-files';

/**
 * Resolves a caller-supplied repo-relative path against the workspace root,
 * rejecting absolute paths and any traversal that escapes the tree.
 * @param pathValue - Repo-relative path supplied by the caller.
 * @param workspaceCwd - Absolute workspace root.
 * @returns The absolute and normalized repo-relative path, or a failure message.
 */
export function resolveWorkspacePath({
	pathValue,
	workspaceCwd,
}: {
	pathValue: string;
	workspaceCwd: string;
}):
	| { absolutePath: string; ok: true; relativePath: string }
	| { message: string; ok: false } {
	const rawPath = pathValue.trim();
	if (!rawPath || path.isAbsolute(rawPath)) {
		return { message: 'Workspace file path must be relative.', ok: false };
	}
	const normalized = path.normalize(rawPath);
	if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
		return {
			message: 'Workspace file path must stay inside the workspace.',
			ok: false,
		};
	}
	const absolutePath = path.resolve(workspaceCwd, normalized);
	const relativePath = path.relative(workspaceCwd, absolutePath);
	if (relativePath === '..' || relativePath.startsWith(`..${path.sep}`)) {
		return {
			message: 'Workspace file path must stay inside the workspace.',
			ok: false,
		};
	}
	return {
		absolutePath,
		ok: true,
		relativePath: relativePath.split(path.sep).join('/'),
	};
}

/**
 * Confirms a path resolves — through any symlinks — to a location still inside
 * the workspace. {@link resolveWorkspacePath} blocks `..` lexically, but a
 * symlink whose target escapes the workspace would slip past it, so reads must
 * realpath both sides and re-check before touching disk. Both ends are
 * realpath'd so a workspace whose own root is symlinked (e.g. macOS `/tmp` →
 * `/private/tmp`) still resolves legitimate in-tree paths. The target must
 * already exist (callers `stat` first); a realpath failure resolves to "outside".
 * @param workspaceCwd - Absolute workspace root.
 * @param absolutePath - Absolute path to test.
 * @returns True when the realpath of the target stays under the realpath of the root.
 */
export async function isWithinWorkspaceReal(
	workspaceCwd: string,
	absolutePath: string,
): Promise<boolean> {
	try {
		const [realRoot, realTarget] = await Promise.all([
			realpath(workspaceCwd),
			realpath(absolutePath),
		]);
		if (realTarget === realRoot) {
			return true;
		}
		const relative = path.relative(realRoot, realTarget);
		return (
			relative !== '' &&
			relative !== '..' &&
			!relative.startsWith(`..${path.sep}`) &&
			!path.isAbsolute(relative)
		);
	} catch {
		return false;
	}
}

/**
 * Builds an ignored tree entry of the given kind from a repo-relative path.
 * @param entryPath - Repo-relative path of the entry.
 * @param kind - Whether the entry is a file or a directory.
 * @returns The wire row for the entry, flagged as git-ignored.
 */
export function ignoredEntry(
	entryPath: string,
	kind: 'directory' | 'file',
): WorkspaceFileEntryWire {
	return {
		isIgnored: true,
		kind,
		name: entryPath.split('/').pop() ?? entryPath,
		path: entryPath,
	};
}

/**
 * Checks unknown thrown values for a Node-style error code.
 * @param cause - The thrown value to inspect.
 * @param code - The `code` property to match, such as `EEXIST`.
 * @returns True when the value carries that code.
 */
export function hasErrorCode(cause: unknown, code: string): boolean {
	return (
		typeof cause === 'object' &&
		cause !== null &&
		'code' in cause &&
		cause.code === code
	);
}
