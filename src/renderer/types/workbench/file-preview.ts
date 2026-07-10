import type { WorkspaceGitDiffScope } from '@/shared/ipc/contracts/workspace-git';

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
) => void;

/** Opens (or re-focuses) a read-only file preview tab from review surfaces. */
export type ReviewFilePreviewOpener = (filePath: string) => void;
