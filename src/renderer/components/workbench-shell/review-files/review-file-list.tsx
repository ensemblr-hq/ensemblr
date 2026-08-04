import { GitPullRequestArrowIcon, TriangleAlertIcon } from 'lucide-react';
import { type MouseEvent, useCallback, useMemo, useState } from 'react';

import {
	ContextMenu,
	ContextMenuTrigger,
} from '@/renderer/components/ui/context-menu';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import {
	useReviewFilePreviewOpener,
	useWorkspaceFileDiffOpener,
} from '@/renderer/components/workbench-shell/conversation-panel/file-preview-context';
import { PanelPlaceholder } from '@/renderer/components/workbench-shell/panel-placeholder';
import { useOpenTargets } from '@/renderer/hooks/workbench-shell/use-open-targets';
import { diffNewSideIsWorkingTree } from '@/renderer/lib/diff/scope';
import { describeWorkspaceGitFailure } from '@/renderer/lib/workbench/git-failure-copy';
import type {
	ReviewFileActions,
	ReviewFileMenuTarget,
	ReviewFileSummary,
} from '@/renderer/types/workbench';
import type { ChangesViewMode } from '@/renderer/types/workbench-shell';
import type {
	WorkspaceGitDiffScope,
	WorkspaceGitFailure,
} from '@/shared/ipc/contracts/workspace-git';
import { isPreviewableImagePath } from '@/shared/preview-image';

import { ReviewFileActionsProvider } from './review-file-actions-context';
import { ReviewFileRow } from './review-file-row';
import { ReviewFileTree } from './review-file-tree';
import { ReviewFilesContextMenuContent } from './review-files-context-menu';

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

/** Renders the changes panel as either a flat list or a collapsible folder tree. */
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
	// Read the openers and open-in targets once here rather than in every file
	// row: a large change set would otherwise create one subscription per row.
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

	const actions = useMemo<ReviewFileActions>(
		() => ({
			copyTarget,
			invokeTarget,
			isDiscardable,
			onDiscardFile,
			openFile,
			openInTargets,
		}),
		[
			copyTarget,
			invokeTarget,
			isDiscardable,
			onDiscardFile,
			openFile,
			openInTargets,
		],
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
									files.map((file) => (
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
