import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';

import { workspaceGitStatusQuery } from '@/renderer/api/ensemblr-queries';
import { findReviewFileRevision } from '@/renderer/lib/workbench/review-files';
import { useViewedChanges } from '@/renderer/state/workspace';
import type { WorkspaceGitDiffScope } from '@/shared/ipc/contracts/workspace-git';

/** The Viewed control's state, or nothing to offer when the file is unmarkable. */
interface FileViewedMark {
	/** Absent when the change set does not hold the file, which hides the control. */
	onViewedChange: ((viewed: boolean) => void) | undefined;
	viewed: boolean;
}

/**
 * The Viewed marker for one file in a diff panel, resolved against the same
 * change set the Changes list reads.
 *
 * Reading the status query back here is a cache hit rather than a second git
 * call, and it keeps the revision a mark is stored against identical to the one
 * the list compares it to — the two surfaces would otherwise be free to disagree
 * about whether a file had been signed off.
 * @param input - The file on screen and the workspace and scope it belongs to
 * @returns The control's checked state and its setter, or no setter when unmarkable
 */
export function useFileViewedMark({
	filePath,
	scope,
	workspaceCwd,
	workspaceId,
}: {
	filePath: string;
	scope: WorkspaceGitDiffScope | undefined;
	workspaceCwd: string | null;
	workspaceId: string;
}): FileViewedMark {
	const { data } = useQuery(workspaceGitStatusQuery(workspaceCwd, scope));
	const files = data && !data.error ? data.files : undefined;
	const { isViewed, setViewed } = useViewedChanges(workspaceId);
	const revision = files ? findReviewFileRevision(files, filePath) : null;

	const onViewedChange = useCallback(
		(viewed: boolean) => {
			if (revision) {
				setViewed(filePath, revision, viewed);
			}
		},
		[filePath, revision, setViewed],
	);

	return {
		onViewedChange: revision ? onViewedChange : undefined,
		viewed: revision ? isViewed(filePath, revision) : false,
	};
}
