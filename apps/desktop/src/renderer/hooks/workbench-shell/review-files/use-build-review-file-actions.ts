import { useCallback, useMemo, useState } from 'react';

import {
	useReviewFilePreviewOpener,
	useWorkspaceFileDiffOpener,
} from '@/renderer/components/workbench-shell/conversation-panel/file-preview-context';
import { useAttachToChat } from '@/renderer/hooks/workbench-shell/composer/use-attach-to-chat';
import { useOpenTargets } from '@/renderer/hooks/workbench-shell/use-open-targets';
import { diffNewSideIsWorkingTree } from '@/renderer/lib/diff/scope';
import { isPreviewableWorkspaceFile } from '@/renderer/lib/workbench';
import { reviewFileRevision } from '@/renderer/lib/workbench/review-files';
import { useViewedChanges } from '@/renderer/state/workspace';
import type {
	ReviewFileActions,
	ReviewFileSummary,
} from '@/renderer/types/workbench';
import type { WorkspaceGitDiffScope } from '@/shared/ipc/contracts/workspace-git';
import { isPreviewableImagePath } from '@/shared/preview-media';

/** Joins paths into a comparable key; NUL cannot occur in a file path. */
const PATH_SEPARATOR = '\0';

/**
 * Assembles the shared action bundle every review file row consumes through
 * context. The openers, open-in targets, and viewed marks are read once here
 * rather than per row, so a large change set does not create one subscription
 * per file.
 * @param diffScope - Which diff a row click opens — the active source's scope
 * @param discardablePaths - Paths that can be discarded; others hide the discard action
 * @param files - The change set's file rows
 * @param onDiscardFile - Discards one uncommitted file
 * @param pendingDiscardPaths - Paths a discard is currently running against
 * @param workspaceCwd - Absolute workspace root attached diffs are written under
 * @param workspaceId - Workspace the rows belong to
 * @returns The action bundle plus the viewed predicate the flat list sorts by
 */
export function useBuildReviewFileActions({
	diffScope,
	discardablePaths,
	files,
	onDiscardFile,
	pendingDiscardPaths,
	workspaceCwd,
	workspaceId,
}: {
	diffScope: WorkspaceGitDiffScope | undefined;
	discardablePaths: ReadonlySet<string> | undefined;
	files: ReviewFileSummary[];
	onDiscardFile: (filePath: string) => void;
	pendingDiscardPaths: ReadonlySet<string> | undefined;
	workspaceCwd: string;
	workspaceId: string;
}): {
	actions: ReviewFileActions;
	isViewed: (file: ReviewFileSummary) => boolean;
} {
	const openDiff = useWorkspaceFileDiffOpener();
	const openPreview = useReviewFilePreviewOpener();
	const imagePreviewPathsKey = useMemo(
		() => previewableImagePathsIn(files, diffScope).join(PATH_SEPARATOR),
		[files, diffScope],
	);
	const imagePreviewPaths = useMemo<ReadonlySet<string>>(
		() =>
			new Set(
				imagePreviewPathsKey ? imagePreviewPathsKey.split(PATH_SEPARATOR) : [],
			),
		[imagePreviewPathsKey],
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
	const stableDiscardablePaths = useStableSet(discardablePaths);
	const stablePendingDiscardPaths = useStableSet(pendingDiscardPaths);
	const isDiscardable = useMemo(
		() => (filePath: string) =>
			stableDiscardablePaths ? stableDiscardablePaths.has(filePath) : true,
		[stableDiscardablePaths],
	);
	const isDiscarding = useMemo(
		() => (filePath: string) =>
			stablePendingDiscardPaths
				? stablePendingDiscardPaths.has(filePath)
				: false,
		[stablePendingDiscardPaths],
	);

	// Marks are stored against the revision they were set at, so a row the agent
	// touched again reads as unviewed and climbs back out of the reviewed group.
	const { isViewed: isPathViewed } = useViewedChanges(workspaceId);
	const isViewed = useCallback(
		(file: ReviewFileSummary) =>
			isPathViewed(file.path, reviewFileRevision(file)),
		[isPathViewed],
	);

	const { attachDiff } = useAttachToChat({ scope: diffScope, workspaceCwd });

	const actions = useMemo<ReviewFileActions>(
		() => ({
			attachDiff,
			copyTarget,
			invokeTarget,
			isDiscardable,
			isDiscarding,
			isViewed,
			onDiscardFile,
			openFile,
			openInTargets,
		}),
		[
			attachDiff,
			copyTarget,
			invokeTarget,
			isDiscardable,
			isDiscarding,
			isViewed,
			onDiscardFile,
			openFile,
			openInTargets,
		],
	);

	return { actions, isViewed };
}

/**
 * Keeps a set's previous identity while its members are unchanged, so a source
 * that rebuilds an equal set on every refresh does not invalidate the consumers
 * keyed on it.
 * @param next - The set this render received
 * @returns The earlier set when it has the same members, otherwise `next`
 */
function useStableSet(
	next: ReadonlySet<string> | undefined,
): ReadonlySet<string> | undefined {
	const [stable, setStable] = useState(next);

	if (stable !== next && !haveSameMembers(stable, next)) {
		setStable(next);
		return next;
	}

	return stable;
}

/**
 * Whether two optional sets hold exactly the same members.
 * @param first - One set, or undefined
 * @param second - The other set, or undefined
 * @returns True when both are absent or both hold the same members
 */
function haveSameMembers(
	first: ReadonlySet<string> | undefined,
	second: ReadonlySet<string> | undefined,
): boolean {
	if (!(first && second)) {
		return first === second;
	}

	return (
		first.size === second.size && [...first].every((path) => second.has(path))
	);
}

/**
 * Paths in a change set that belong in the image preview instead of a diff: a
 * previewable image the workspace still holds. Git renders a changed image as
 * "Binary files differ", so the preview is the only view that shows the change.
 * Only scopes whose new side is the working tree qualify — a commit's image is a
 * historical blob the preview cannot read from disk.
 *
 * A symlink to a directory is held back even when its name carries an image
 * extension: the preview would follow the link and find a directory, whereas the
 * diff shows the one thing that actually changed — the path the link points at.
 * @param files - The change set's file rows.
 * @param diffScope - The scope those rows were listed at.
 * @returns Workspace-relative paths a row click should preview.
 */
function previewableImagePathsIn(
	files: readonly ReviewFileSummary[],
	diffScope: WorkspaceGitDiffScope | undefined,
): string[] {
	if (!diffNewSideIsWorkingTree(diffScope)) {
		return [];
	}

	return files
		.filter(
			(file) =>
				file.status !== 'deleted' &&
				isPreviewableImagePath(file.path) &&
				isPreviewableWorkspaceFile(file),
		)
		.map((file) => file.path);
}
