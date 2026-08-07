import type { WorkspaceGitDiffScope } from '@/shared/ipc/contracts/workspace-git';

/**
 * Last path segment of a workspace-relative path, used as a tab's short label.
 * @param path - The path to shorten
 * @returns The last segment, or the trimmed path when it has no separator
 */
export function basenameOf(path: string): string {
	const trimmed = path.replace(/\/+$/, '');
	return trimmed.split('/').at(-1) ?? trimmed;
}

/**
 * Tab title for a file diff, tagging the short hash when scoped to a commit. The
 * diff glyph on the tab already signals the kind, so the title is just the file
 * name (no "Diff:" prefix).
 * @param filePath - Workspace-relative path the diff is for
 * @param scope - Which diff is being shown; only a commit scope changes the title
 * @returns The tab's title
 */
export function diffTabTitle(
	filePath: string,
	scope?: WorkspaceGitDiffScope,
): string {
	const name = basenameOf(filePath);
	if (scope?.kind === 'commit') {
		return `${name} (${scope.commitHash.slice(0, 7)})`;
	}
	return name;
}
