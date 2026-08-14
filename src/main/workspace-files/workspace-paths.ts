/**
 * Path-safety helpers shared by the workspace file lister and the attachment
 * store. Both resolve caller-supplied paths against a workspace root and must
 * agree on what "inside the workspace" means, so the checks live here rather
 * than being duplicated on either side.
 *
 * Two policies live here, and the difference is the point. Anything that feeds
 * an agent's context goes through {@link resolveWorkspacePath} and is confined
 * to the workspace; the read-only file preview goes through
 * {@link resolvePreviewPath} and may look outside it.
 */

import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
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

/** Whether a resolved path stayed inside the workspace or escaped it. */
export type PreviewPathScope = 'external' | 'workspace';

/** A path cleared for preview reading, or the reason it was refused. */
export type ResolvedPreviewPath =
	| {
			absolutePath: string;
			displayPath: string;
			ok: true;
			scope: PreviewPathScope;
	  }
	| { message: string; ok: false };

/**
 * Expands a leading `~` to the current user's home directory, since agents write
 * paths like `~/.claude/plans/notes.md` that no filesystem call resolves itself.
 * @param rawPath - Trimmed path as the caller supplied it.
 * @returns The path with any leading `~` replaced by the home directory.
 */
function expandHomePath(rawPath: string): string {
	if (rawPath === '~') {
		return homedir();
	}
	return rawPath.startsWith('~/')
		? path.join(homedir(), rawPath.slice(2))
		: rawPath;
}

/**
 * Resolves a path for the read-only file preview, which — unlike the attachment
 * store — may look outside the workspace. Agents routinely write to `/tmp` or
 * `~/.claude/`, and refusing to show the user a file their own agent just wrote
 * helps nobody; the agent already reads the whole disk through its own tools.
 * Paths that do resolve inside the workspace still report as `workspace` so the
 * caller keeps applying symlink containment to them.
 *
 * Scope is decided by where the path lands, not by the form it arrived in:
 * `../sibling/notes.md` and the absolute path it denotes both resolve external.
 * Treating the two differently would refuse a file by the shape of its spelling
 * while reading the same bytes one line down.
 *
 * {@link resolveWorkspacePath} is deliberately left alone rather than relaxed:
 * it still guards the attachment store, which decides what an agent can pull
 * into its own context, and that must stay workspace-only.
 * @param pathValue - Absolute, `~`-prefixed, or repo-relative path to preview.
 * @param workspaceCwd - Absolute workspace root.
 * @returns The absolute path plus the path to echo back, or a failure message.
 */
export function resolvePreviewPath({
	pathValue,
	workspaceCwd,
}: {
	pathValue: string;
	workspaceCwd: string;
}): ResolvedPreviewPath {
	const rawPath = expandHomePath(pathValue.trim());
	if (!rawPath) {
		return { message: 'Preview path must not be empty.', ok: false };
	}
	const absolutePath = path.resolve(workspaceCwd, rawPath);
	const relativePath = path.relative(workspaceCwd, absolutePath);
	if (
		relativePath === '..' ||
		relativePath.startsWith(`..${path.sep}`) ||
		path.isAbsolute(relativePath)
	) {
		return {
			absolutePath,
			displayPath: absolutePath,
			ok: true,
			scope: 'external',
		};
	}
	return {
		absolutePath,
		displayPath: relativePath.split(path.sep).join('/'),
		ok: true,
		scope: 'workspace',
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
