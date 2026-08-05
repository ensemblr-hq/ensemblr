import { GitPullRequestArrowIcon, TriangleAlertIcon } from 'lucide-react';
import { type MouseEvent, useCallback, useMemo, useState } from 'react';

import {
	ContextMenu,
	ContextMenuTrigger,
} from '@/renderer/components/ui/context-menu';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { PanelPlaceholder } from '@/renderer/components/workbench-shell/panel-placeholder';
import { useBuildReviewFileActions } from '@/renderer/hooks/workbench-shell/review-files/use-build-review-file-actions';
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
import { ReviewFileRow } from './review-file-row';
import { ReviewFileTree } from './review-file-tree';
import { ReviewFilesContextMenuContent } from './review-files-context-menu';

/**
 * Renders the changes panel as either a flat list or a collapsible folder tree.
 * Rows marked viewed dim, and in the flat list they sink below the rest.
 */
export function ReviewFileList({
	conflictPaths,
	diffScope,
	discardablePaths,
	emptyState = {
		message: 'Changes appear here.',
		title: 'No file changes yet',
	},
	error,
	files,
	isLoading = false,
	onDiscardFile,
	viewMode,
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
	/** Overrides the empty-state copy for the active source. */
	emptyState?: { message: string; title: string };
	error?: WorkspaceGitFailure;
	files: ReviewFileSummary[];
	/** True while the source's status query is in flight with no rows yet. */
	isLoading?: boolean;
	onDiscardFile: (filePath: string) => void;
	viewMode: ChangesViewMode;
	workspaceId: string;
}) {
	const markedFiles = useMemo(
		() => markConflictedFiles(files, conflictPaths),
		[conflictPaths, files],
	);

	const { actions, isViewed } = useBuildReviewFileActions({
		diffScope,
		discardablePaths,
		files: markedFiles,
		onDiscardFile,
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

	// One shared right-click menu serves every row; the clicked row is captured
	// here from its `data-row-path` so we don't mount a menu per file.
	const [menuTarget, setMenuTarget] = useState<ReviewFileMenuTarget | null>(
		null,
	);
	const handleContextCapture = useCallback(
		(event: MouseEvent<HTMLDivElement>) => {
			const rowElement = (event.target as HTMLElement).closest<HTMLElement>(
				'[data-row-path]',
			);
			if (!rowElement?.dataset.rowPath) {
				// Right-click landed off a file row (folder header, empty area): don't
				// open an empty menu.
				event.preventDefault();
				event.stopPropagation();
				return;
			}
			setMenuTarget({ path: rowElement.dataset.rowPath });
		},
		[],
	);

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
					Loading changes…
				</div>
			);
		}
		return <PanelPlaceholder icon={GitPullRequestArrowIcon} {...emptyState} />;
	}

	const flatList = conflictGroups ? (
		<>
			<ReviewFileGroup files={conflictGroups.conflicted} label='Conflicts' />
			<ReviewFileGroup files={conflictGroups.clean} label='Clean' />
		</>
	) : (
		listedFiles.map((file) => (
			<ReviewFileRow file={file} key={file.id} showPath />
		))
	);

	return (
		<ReviewFileActionsProvider value={actions}>
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<div className='h-full' onContextMenuCapture={handleContextCapture}>
						<ScrollArea className='h-full'>
							<div className='flex flex-col gap-1 p-3'>
								{viewMode === 'folders' ? (
									<ReviewFileTree files={markedFiles} />
								) : (
									flatList
								)}
							</div>
						</ScrollArea>
					</div>
				</ContextMenuTrigger>
				<ReviewFilesContextMenuContent target={menuTarget} />
			</ContextMenu>
		</ReviewFileActionsProvider>
	);
}

/** One labelled band of the flat list, used when conflicts split it in two. */
function ReviewFileGroup({
	files,
	label,
}: {
	files: readonly ReviewFileSummary[];
	label: string;
}) {
	if (files.length === 0) {
		return null;
	}

	return (
		<section className='flex min-w-0 flex-col gap-1'>
			<h3 className='px-2 pt-1 font-semibold text-muted-foreground text-xs'>
				{label}
			</h3>
			{files.map((file) => (
				<ReviewFileRow file={file} key={file.id} showPath />
			))}
		</section>
	);
}
