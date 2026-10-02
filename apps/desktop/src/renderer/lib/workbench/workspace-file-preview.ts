import type { SymlinkTargetKind } from '@/shared/ipc/contracts/workspace-files';

/**
 * The row identity the preview decision needs. `kind` is optional because a
 * changed-file row never declares one — every row in the changes list is a file
 * — while a files-tree row always does.
 */
interface PreviewCandidate {
	kind?: 'directory' | 'file';
	symlinkTargetKind?: SymlinkTargetKind;
}

/**
 * Reports whether a row names bytes the file preview can show. A symlink to a
 * directory is excluded even though both listings carry it as a file row: the
 * preview renders bytes, and following the link is the one thing these surfaces
 * deliberately never do, so such a row never reaches a viewer that could only
 * report the path is a directory. A link whose target never resolved stays
 * previewable — an unknown target is as likely to be a file, and the main
 * process refuses the read if it is not.
 * @param file - A files-tree or changed-file row.
 * @returns True when the row may be opened in the preview pane.
 */
export function isPreviewableWorkspaceFile(file: PreviewCandidate): boolean {
	return file.kind !== 'directory' && file.symlinkTargetKind !== 'directory';
}
