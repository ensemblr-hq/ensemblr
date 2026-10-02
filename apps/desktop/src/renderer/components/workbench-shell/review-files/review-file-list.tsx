import { GitPullRequestArrowIcon, TriangleAlertIcon } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
	ContextMenu,
	ContextMenuTrigger,
} from '@/renderer/components/ui/context-menu';
import { PanelPlaceholder } from '@/renderer/components/workbench-shell/panel-placeholder';
import { useBuildReviewFileActions } from '@/renderer/hooks/workbench-shell/review-files/use-build-review-file-actions';
import { useReviewFileRows } from '@/renderer/hooks/workbench-shell/review-files/use-review-file-rows';
import { useRowContextMenuTarget } from '@/renderer/hooks/workbench-shell/review-files/use-row-context-menu-target';
import { describeWorkspaceGitFailure } from '@/renderer/lib/workbench/git-failure-copy';
import {
	groupReviewFilesByConflict,
	markConflictedFiles,
	sortReviewFilesByViewed,
} from '@/renderer/lib/workbench/review-files';
import type {
	ReviewFileMenuTarget,
	ReviewFileSummary,
} from '@/renderer/types/workbench';
import type { ChangesViewMode } from '@/renderer/types/workbench-shell';
import type {
	WorkspaceGitDiffScope,
	WorkspaceGitFailure,
} from '@/shared/ipc/contracts/workspace-git';

import { ReviewFileActionsProvider } from './review-file-actions-context';
import { ReviewFileVirtualList } from './review-file-virtual-list';
import { ReviewFilesContextMenuContent } from './review-files-context-menu';

/**
 * Renders the changes panel as either a flat list or a collapsible folder tree.
 * Rows marked viewed dim, and in the flat list they sink below the rest. Memoized
 * so a review panel render that leaves these props alone skips the row model.
 */
export const ReviewFileList = memo(function ReviewFileList({
	conflictPaths,
	diffScope,
	discardablePaths,
	emptyState,
	error,
	files,
	isLoading = false,
	onDiscardFile,
	pendingDiscardPaths,
	viewMode,
	workspaceCwd,
	workspaceId,
}: {
	/**
	 * Paths that cannot merge cleanly. They take a conflicted status mark in both
	 * view modes, and split the flat list into two groups.
	 */
	conflictPaths?: ReadonlySet<string>;
	/** Which diff a row click opens — the active source's scope. */
	diffScope?: WorkspaceGitDiffScope;
	/** Paths that can be discarded (uncommitted); others hide the discard action. */
	discardablePaths?: ReadonlySet<string>;
	/** Overrides the empty-state copy for the active source; defaults to the all-changes copy. */
	emptyState?: { message: string; title: string };
	error?: WorkspaceGitFailure;
	files: ReviewFileSummary[];
	/** True while the source's status query is in flight with no rows yet. */
	isLoading?: boolean;
	onDiscardFile: (filePath: string) => void;
	/** Paths a discard is currently running against; their rows mute until it settles. */
	pendingDiscardPaths?: ReadonlySet<string>;
	viewMode: ChangesViewMode;
	/** Absolute workspace root an attached diff is written under. */
	workspaceCwd: string;
	workspaceId: string;
}) {
	const { t } = useTranslation();
	const markedFiles = useMemo(
		() => markConflictedFiles(files, conflictPaths),
		[conflictPaths, files],
	);

	const { actions, isViewed } = useBuildReviewFileActions({
		diffScope,
		discardablePaths,
		files: markedFiles,
		onDiscardFile,
		pendingDiscardPaths,
		workspaceCwd,
		workspaceId,
	});

	// Only the flat list reorders: the folder tree's order is its structure, so a
	// viewed file there dims in place rather than jumping out of its directory.
	const listedFiles = useMemo(
		() => sortReviewFilesByViewed(markedFiles, isViewed),
		[markedFiles, isViewed],
	);

	const conflictGroups = useMemo(
		() => groupReviewFilesByConflict(markedFiles, listedFiles, conflictPaths),
		[conflictPaths, markedFiles, listedFiles],
	);

	const { rows, toggleDirectory } = useReviewFileRows({
		conflictGroups,
		listedFiles,
		markedFiles,
		viewMode,
	});

	const buildMenuTarget = useCallback(
		(path: string): ReviewFileMenuTarget => {
			const row = files.find((file) => file.path === path);

			return {
				path,
				...(row?.symlinkTargetKind
					? { symlinkTargetKind: row.symlinkTargetKind }
					: {}),
			};
		},
		[files],
	);
	const { handleContextCapture, menuTarget } =
		useRowContextMenuTarget(buildMenuTarget);

	if (error) {
		return (
			<PanelPlaceholder
				{...describeWorkspaceGitFailure(error)}
				icon={TriangleAlertIcon}
				tone='danger'
			/>
		);
	}

	if (!files.length) {
		if (isLoading) {
			return (
				<div className='flex h-full items-center justify-center px-8 text-center text-muted-foreground text-xs'>
					{t('review:changes.loading', 'Loading changes…')}
				</div>
			);
		}
		return (
			<PanelPlaceholder
				icon={GitPullRequestArrowIcon}
				{...(emptyState ?? {
					message: t('review:changes.empty.message', 'Changes appear here.'),
					title: t('review:changes.empty.title', 'No file changes yet'),
				})}
			/>
		);
	}

	return (
		<ReviewFileActionsProvider value={actions}>
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<div className='h-full'>
						<ReviewFileVirtualList
							isTree={viewMode === 'folders'}
							onContextMenuCapture={handleContextCapture}
							onToggleDirectory={toggleDirectory}
							rows={rows}
						/>
					</div>
				</ContextMenuTrigger>
				<ReviewFilesContextMenuContent target={menuTarget} />
			</ContextMenu>
		</ReviewFileActionsProvider>
	);
});
