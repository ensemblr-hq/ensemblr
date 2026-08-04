import { useCallback, useMemo } from 'react';

import {
	useReviewFilePreviewOpener,
	useWorkspaceFileDiffOpener,
} from '@/renderer/components/workbench-shell/conversation-panel/file-preview-context';
import { useOpenTargets } from '@/renderer/hooks/workbench-shell/use-open-targets';
import { diffNewSideIsWorkingTree } from '@/renderer/lib/diff/scope';
import { reviewFileRevision } from '@/renderer/lib/workbench/review-files';
import { useViewedChanges } from '@/renderer/state/workspace';
import type {
	ReviewFileActions,
	ReviewFileSummary,
} from '@/renderer/types/workbench';
import type { WorkspaceGitDiffScope } from '@/shared/ipc/contracts/workspace-git';
import { isPreviewableImagePath } from '@/shared/preview-image';

/**
 * Assembles the shared action bundle every review file row consumes through
 * context. The openers, open-in targets, and viewed marks are read once here
 * rather than per row, so a large change set does not create one subscription
 * per file.
 * @param diffScope - Which diff a row click opens — the active source's scope
 * @param discardablePaths - Paths that can be discarded; others hide the discard action
 * @param files - The change set's file rows
 * @param onDiscardFile - Discards one uncommitted file
 * @param workspaceId - Workspace the rows belong to
 * @returns The action bundle plus the viewed predicate the flat list sorts by
 */
export function useBuildReviewFileActions({
	diffScope,
	discardablePaths,
	files,
	onDiscardFile,
	workspaceId,
}: {
	diffScope: WorkspaceGitDiffScope | undefined;
	discardablePaths: ReadonlySet<string> | undefined;
	files: ReviewFileSummary[];
	onDiscardFile: (filePath: string) => void;
	workspaceId: string;
}): {
	actions: ReviewFileActions;
	isViewed: (file: ReviewFileSummary) => boolean;
} {
	const openDiff = useWorkspaceFileDiffOpener();
	const openPreview = useReviewFilePreviewOpener();
	const imagePreviewPaths = useMemo(
		() => previewableImagePathsIn(files, diffScope),
		[files, diffScope],
	);
	// Gated on the diff opener alone — the fallback every changed file has. A
	// preview-only mount would make this a callable that no-ops on source rows.
	const openFile = useMemo<ReviewFileActions['openFile']>(() => {
		if (!openDiff) {
			return null;
		}
		return (filePath, options) => {
			if (openPreview && imagePreviewPaths.has(filePath)) {
				openPreview(filePath, options);
				return;
			}
			openDiff(filePath, diffScope, options);
		};
	}, [openDiff, openPreview, imagePreviewPaths, diffScope]);

	const { copyTarget, invokeTarget, openInTargets } = useOpenTargets({
		workspaceId,
	});
	const isDiscardable = useMemo(
		() => (filePath: string) =>
			discardablePaths ? discardablePaths.has(filePath) : true,
		[discardablePaths],
	);

	// Marks are stored against the revision they were set at, so a row the agent
	// touched again reads as unviewed and climbs back out of the reviewed group.
	const { isViewed: isPathViewed } = useViewedChanges(workspaceId);
	const isViewed = useCallback(
		(file: ReviewFileSummary) =>
			isPathViewed(file.path, reviewFileRevision(file)),
		[isPathViewed],
	);

	const actions = useMemo<ReviewFileActions>(
		() => ({
			copyTarget,
			invokeTarget,
			isDiscardable,
			isViewed,
			onDiscardFile,
			openFile,
			openInTargets,
		}),
		[
			copyTarget,
			invokeTarget,
			isDiscardable,
			isViewed,
			onDiscardFile,
			openFile,
			openInTargets,
		],
	);

	return { actions, isViewed };
}

/**
 * Paths in a change set that belong in the image preview instead of a diff: a
 * previewable image the workspace still holds. Git renders a changed image as
 * "Binary files differ", so the preview is the only view that shows the change.
 * Only scopes whose new side is the working tree qualify — a commit's image is a
 * historical blob the preview cannot read from disk.
 * @param files - The change set's file rows.
 * @param diffScope - The scope those rows were listed at.
 * @returns Workspace-relative paths a row click should preview.
 */
function previewableImagePathsIn(
	files: ReviewFileSummary[],
	diffScope: WorkspaceGitDiffScope | undefined,
): ReadonlySet<string> {
	if (!diffNewSideIsWorkingTree(diffScope)) {
		return new Set();
	}

	const paths = new Set<string>();
	for (const file of files) {
		if (file.status !== 'deleted' && isPreviewableImagePath(file.path)) {
			paths.add(file.path);
		}
	}

	return paths;
}
