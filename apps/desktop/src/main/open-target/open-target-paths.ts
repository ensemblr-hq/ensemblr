import { dirname, isAbsolute, join, normalize, sep } from 'node:path';

import type { WorkspaceOpenTargetKind } from '@/shared/ipc/contracts/open-target';

/**
 * Normalizes a renderer-supplied target path. A relative path must stay inside
 * the workspace; an absolute one is passed through, because the file preview
 * opens files an agent wrote outside the root (`/tmp`, `~/.claude/`) and the
 * toolbar has to hand the same file to an editor. That mirrors the policy
 * `resolvePreviewPath` already applies to reads — the renderer can reach those
 * bytes either way, so refusing to open them only breaks the button.
 * @param targetPath - Raw path from the renderer, or undefined for the root.
 * @returns The normalized path, `undefined` when none was provided (open the
 *   workspace root), or `null` when a relative path escapes the workspace.
 */
export function sanitizeOpenTargetPath(
	targetPath: string | undefined,
): string | null | undefined {
	if (!targetPath) {
		return undefined;
	}

	const normalized = normalize(targetPath);
	if (isAbsolute(normalized)) {
		return normalized;
	}
	if (normalized === '..' || normalized.startsWith(`..${sep}`)) {
		return null;
	}

	return normalized;
}

/**
 * Resolves the absolute path an open target should act on. With no
 * `relativePath`, that's the workspace root (the header's original behavior).
 * An already-absolute path is used as-is — joining it onto the workspace root
 * would point at `<workspace>/tmp/scratch.md` for a file preview showing
 * `/tmp/scratch.md`. Terminal and source-control targets operate on a
 * directory, so a selected file resolves to its parent; editors and file
 * managers open the file itself.
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

	const absolutePath = isAbsolute(relativePath)
		? relativePath
		: join(workspacePath, relativePath);
	const wantsContainingDirectory =
		kind === 'terminal' || kind === 'source-control';

	return wantsContainingDirectory && relativePathKind === 'file'
		? dirname(absolutePath)
		: absolutePath;
}
