import { GitPullRequestArrowIcon, TriangleAlertIcon } from 'lucide-react';
import { type MouseEvent, useCallback, useMemo, useState } from 'react';

import {
	ContextMenu,
	ContextMenuTrigger,
} from '@/renderer/components/ui/context-menu';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { useWorkspaceFileDiffOpener } from '@/renderer/components/workbench-shell/conversation-panel/file-preview-context';
import { PanelPlaceholder } from '@/renderer/components/workbench-shell/panel-placeholder';
import { useOpenTargets } from '@/renderer/hooks/workbench-shell/use-open-targets';
import { describeWorkspaceGitFailure } from '@/renderer/lib/workbench/git-failure-copy';
import {
	reviewFileRevision,
	sortReviewFilesByViewed,
} from '@/renderer/lib/workbench/review-files';
import { useViewedChanges } from '@/renderer/state/workspace';
import type {
	ReviewFileActions,
	ReviewFileMenuTarget,
	ReviewFileSummary,
	WorkspaceFileDiffOpener,
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
	// Read the diff opener and open-in targets once here rather than in every
	// file row: a large change set would otherwise create one subscription per
	// row.
	const rawOpenDiff = useWorkspaceFileDiffOpener();
	// Inject the active source's scope so a row opens the matching diff (e.g. a
	// commit's own diff), not always the working tree.
	const openDiff = useMemo<WorkspaceFileDiffOpener | null>(
		() =>
			rawOpenDiff
				? (filePath: string) => rawOpenDiff(filePath, diffScope)
				: null,
		[rawOpenDiff, diffScope],
	);
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
			openDiff,
			openInTargets,
		}),
		[
			copyTarget,
			invokeTarget,
			isDiscardable,
			isViewed,
			onDiscardFile,
			openDiff,
			openInTargets,
		],
	);

	// Only the flat list reorders: the folder tree's order is its structure, so a
	// viewed file there dims in place rather than jumping out of its directory.
	const listedFiles = useMemo(
		() => sortReviewFilesByViewed(files, isViewed),
		[files, isViewed],
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

	return (
		<ReviewFileActionsProvider value={actions}>
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<div className='h-full' onContextMenuCapture={handleContextCapture}>
						<ScrollArea className='h-full'>
							<div className='flex flex-col gap-1 p-3'>
								{viewMode === 'folders' ? (
									<ReviewFileTree files={files} />
								) : (
									listedFiles.map((file) => (
										<ReviewFileRow file={file} key={file.id} showPath />
									))
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
