import { dirname, isAbsolute, join, normalize, sep } from 'node:path';

import type { WorkspaceOpenTargetKind } from '@/shared/ipc/contracts/open-target';

/**
 * Normalizes a renderer-supplied workspace-relative path, rejecting anything
 * that escapes the workspace.
 * @param relativePath - Raw path from the renderer, or undefined for the root.
 * @returns The normalized path, `undefined` when none was provided (open the
 *   workspace root), or `null` when the path is unsafe.
 */
export function sanitizeWorkspaceRelativePath(
	relativePath: string | undefined,
): string | null | undefined {
	if (!relativePath) {
		return undefined;
	}

	const normalized = normalize(relativePath);
	if (
		isAbsolute(normalized) ||
		normalized === '..' ||
		normalized.startsWith(`..${sep}`)
	) {
		return null;
	}

	return normalized;
}

/**
 * Resolves the absolute path an open target should act on. With no
 * `relativePath`, that's the workspace root (the header's original behavior).
 * Terminal and source-control targets operate on a directory, so a selected
 * file resolves to its parent; editors and file managers open the file itself.
 * @returns The absolute filesystem path to hand to the target.
 */
export function resolveOpenTargetPath({
	kind,
	relativePath,
	relativePathKind,
	workspacePath,
}: {
	kind: WorkspaceOpenTargetKind;
	relativePath?: string;
	relativePathKind?: 'directory' | 'file';
	workspacePath: string;
}): string {
	if (!relativePath) {
		return workspacePath;
	}

	const absolutePath = join(workspacePath, relativePath);
	const wantsContainingDirectory =
		kind === 'terminal' || kind === 'source-control';

	return wantsContainingDirectory && relativePathKind === 'file'
		? dirname(absolutePath)
		: absolutePath;
}
