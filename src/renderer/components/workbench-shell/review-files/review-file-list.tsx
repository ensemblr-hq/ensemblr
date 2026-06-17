import { type MouseEvent, useCallback, useMemo, useState } from 'react';

import {
	ContextMenu,
	ContextMenuTrigger,
} from '@/renderer/components/ui/context-menu';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import {
	useWorkspaceFileDiffOpener,
	type WorkspaceFileDiffOpener,
} from '@/renderer/components/workbench-shell/conversation-panel/file-preview-context';
import { useOpenTargets } from '@/renderer/hooks/workbench-shell/use-open-targets';
import type { ReviewFileSummary } from '@/renderer/types/workbench';
import type { ChangesViewMode } from '@/renderer/types/workbench-shell';
import type { WorkspaceGitDiffScope } from '@/shared/ipc/contracts/workspace-git';

import {
	type ReviewFileActions,
	ReviewFileActionsProvider,
} from './review-file-actions-context';
import { ReviewFileEmptyState } from './review-file-empty-state';
import { ReviewFileRow } from './review-file-row';
import { ReviewFileTree } from './review-file-tree';
import {
	type ReviewFileMenuTarget,
	ReviewFilesContextMenuContent,
} from './review-files-context-menu';

/** Renders the changes panel as either a flat list or a collapsible folder tree. */
export function ReviewFileList({
	diffScope,
	discardablePaths,
	emptyState,
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
	error?: string;
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
	const { invokeTarget, openTargets } = useOpenTargets({ workspaceId });
	const openInTargets = useMemo(
		() =>
			(openTargets ?? []).filter((target) => target.behavior !== 'copy-path'),
		[openTargets],
	);
	const copyTarget = useMemo(
		() => (openTargets ?? []).find((target) => target.behavior === 'copy-path'),
		[openTargets],
	);
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
			openDiff,
			openInTargets,
		}),
		[
			copyTarget,
			invokeTarget,
			isDiscardable,
			onDiscardFile,
			openDiff,
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
			<ScrollArea className='h-full'>
				<div className='p-3'>
					<div className='rounded-md border border-status-danger/40 bg-pane px-3 py-4 text-status-danger text-xs leading-5'>
						Could not read workspace changes: {error}
					</div>
				</div>
			</ScrollArea>
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
		return <ReviewFileEmptyState {...emptyState} />;
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
