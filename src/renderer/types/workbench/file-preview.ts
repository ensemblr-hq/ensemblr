import type { WorkspaceGitDiffScope } from '@/shared/ipc/contracts/workspace-git';

/**
 * How an open should treat the workspace's ephemeral preview slot. Omitting it
 * (or passing `preview: true`) reuses the slot, so browsing files never grows
 * the tab strip; `preview: false` opens a permanent tab the next preview skips.
 */
export interface FileOpenOptions {
	preview?: boolean;
}

/**
 * Opens (or re-focuses) a diff tab for a changed file. Provided at the workbench
 * level so the review panel (right sidebar) can open diffs in the main
 * conversation surface. The optional `scope` selects which diff to show — the
 * working tree (default), a specific commit, or the whole branch — so a file
 * opened from a commit view shows that commit's diff, not the working tree.
 */
export type WorkspaceFileDiffOpener = (
	filePath: string,
	scope?: WorkspaceGitDiffScope,
	options?: FileOpenOptions,
) => void;

/** Opens (or re-focuses) a read-only file preview tab from review surfaces. */
export type ReviewFilePreviewOpener = (
	filePath: string,
	options?: FileOpenOptions,
) => void;
