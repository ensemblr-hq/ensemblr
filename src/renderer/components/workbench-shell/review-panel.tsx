import { useQuery } from '@tanstack/react-query';
import { useAtom } from 'jotai';
import {
	CheckIcon,
	EyeIcon,
	ListIcon,
	ListTreeIcon,
	MoreVerticalIcon,
	RefreshCwIcon,
	SearchIcon,
	Undo2Icon,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { workspaceCommitsQuery } from '@/renderer/api/ensemble';
import { Button } from '@/renderer/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { Tabs, TabsContent } from '@/renderer/components/ui/tabs';
import { useHotkey } from '@/renderer/hooks/use-hotkey';
import { cn } from '@/renderer/lib/utils';
import { changesViewModeAtom } from '@/renderer/state/workspace';
import type {
	ReviewPanelTab,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type { ChangesViewMode } from '@/renderer/types/workbench-shell';

import { ChecksPanel } from './checks-panel/checks-panel';
import { useReviewActions } from './review-actions/review-actions-context';
import { AllFilesList } from './review-files/all-files-list';
import { AllFilesSearchDialog } from './review-files/all-files-search-dialog';
import {
	DiscardChangesDialog,
	type DiscardChangesTarget,
} from './review-files/discard-changes-dialog';
import { ReviewFileList } from './review-files/review-file-list';

/** Tabbed review surface for files, changes, and checks. */
export function ReviewPanel({
	activeTab,
	onTabChange,
	workspace,
}: {
	activeTab: ReviewPanelTab;
	onTabChange: (tab: ReviewPanelTab) => void;
	workspace: WorkspaceShellModel;
}) {
	const [changesViewMode, setChangesViewMode] = useAtom(changesViewModeAtom);
	const [isFileSearchOpen, setIsFileSearchOpen] = useState(false);
	const reviewTabs: Array<{
		count?: number;
		id: ReviewPanelTab;
		label: string;
	}> = [
		{ id: 'files', label: 'All files' },
		{
			count: workspace.changeSummary.files,
			id: 'changes',
			label: 'Changes',
		},
		{ id: 'checks', label: 'Checks' },
	];

	const openFileSearch = useCallback(() => {
		setIsFileSearchOpen(true);
	}, []);
	useHotkey('files.search', openFileSearch, {
		enabled: activeTab === 'files',
	});

	const [discardTarget, setDiscardTarget] =
		useState<DiscardChangesTarget | null>(null);

	// Route every discard through the confirm dialog rather than reverting
	// inline: the git operation is irreversible, so it stays behind an explicit,
	// cancelable step.
	const handleDiscardFile = useCallback((filePath: string) => {
		setDiscardTarget({ fileCount: 1, paths: [filePath], title: filePath });
	}, []);

	const changedPaths = useMemo(
		() => workspace.reviewFiles.map((file) => file.path),
		[workspace.reviewFiles],
	);
	const handleDiscardAll = useCallback(() => {
		if (!changedPaths.length) {
			return;
		}
		setDiscardTarget({
			fileCount: changedPaths.length,
			paths: changedPaths,
			title: `all ${changedPaths.length} changed ${
				changedPaths.length === 1 ? 'file' : 'files'
			}`,
		});
	}, [changedPaths]);

	const handleDiscardDialogChange = useCallback((open: boolean) => {
		if (!open) {
			setDiscardTarget(null);
		}
	}, []);

	return (
		<Tabs
			className='review-panel h-full min-h-0 gap-0 border-border border-b'
			onValueChange={(value) => onTabChange(value as ReviewPanelTab)}
			value={activeTab}
		>
			<div className='flex h-12 shrink-0 items-center justify-between gap-2 overflow-hidden border-border border-b px-3'>
				<div className='no-scrollbar min-w-0 flex-1 overflow-x-auto overflow-y-hidden'>
					<div className='flex w-max min-w-full items-center gap-1'>
						{reviewTabs.map((tab) => (
							<ReviewTabButton
								count={tab.count}
								isActive={activeTab === tab.id}
								key={tab.id}
								label={tab.label}
								onSelect={() => onTabChange(tab.id)}
							/>
						))}
					</div>
				</div>
				<ReviewPanelActions
					activeTab={activeTab}
					changesViewMode={changesViewMode}
					onChangesViewModeToggle={() =>
						setChangesViewMode((current) =>
							current === 'list' ? 'folders' : 'list',
						)
					}
					onDiscardAll={handleDiscardAll}
					onFileSearchOpen={() => setIsFileSearchOpen(true)}
					workspace={workspace}
				/>
			</div>
			<TabsContent className='min-h-0 overflow-hidden' value='files'>
				<AllFilesList
					files={workspace.workspaceFiles}
					workspaceCwd={workspace.pathLabel}
					workspaceId={workspace.id}
				/>
			</TabsContent>
			<TabsContent className='min-h-0 overflow-hidden' value='changes'>
				<ReviewFileList
					error={workspace.reviewFilesError}
					files={workspace.reviewFiles}
					onDiscardFile={handleDiscardFile}
					viewMode={changesViewMode}
					workspaceId={workspace.id}
				/>
			</TabsContent>
			<TabsContent className='min-h-0 overflow-hidden' value='checks'>
				<ChecksPanel workspace={workspace} />
			</TabsContent>
			<AllFilesSearchDialog
				files={workspace.workspaceFiles}
				onOpenChange={setIsFileSearchOpen}
				open={isFileSearchOpen}
			/>
			<DiscardChangesDialog
				onOpenChange={handleDiscardDialogChange}
				open={discardTarget !== null}
				target={discardTarget}
				workspaceCwd={workspace.pathLabel}
			/>
		</Tabs>
	);
}

/** Tab-aware action cluster on the review panel header. */
function ReviewPanelActions({
	activeTab,
	changesViewMode,
	onChangesViewModeToggle,
	onDiscardAll,
	onFileSearchOpen,
	workspace,
}: {
	activeTab: ReviewPanelTab;
	changesViewMode: ChangesViewMode;
	onChangesViewModeToggle: () => void;
	onDiscardAll: () => void;
	onFileSearchOpen: () => void;
	workspace: WorkspaceShellModel;
}) {
	const reviewActions = useReviewActions();

	if (activeTab === 'checks') {
		return <ChecksRefreshButton />;
	}

	const ChangesViewIcon =
		changesViewMode === 'folders' ? ListIcon : ListTreeIcon;

	return (
		<div className='flex shrink-0 items-center gap-0.5'>
			{activeTab === 'changes' ? (
				<>
					<Button
						className='text-accent-strong hover:text-foreground'
						onClick={() => reviewActions?.runAgentAction('review')}
						size='xs'
						variant='ghost'
					>
						<EyeIcon data-icon='inline-start' />
						<span className='review-panel-action-label'>Review</span>
					</Button>
					<Button
						aria-pressed={changesViewMode === 'folders'}
						onClick={onChangesViewModeToggle}
						size='icon-sm'
						variant='ghost'
					>
						<ChangesViewIcon />
						<span className='sr-only'>
							{changesViewMode === 'folders'
								? 'Show changes as list'
								: 'Show changes as folders'}
						</span>
					</Button>
					<ChangesOverflowMenu
						onDiscardAll={onDiscardAll}
						workspace={workspace}
					/>
				</>
			) : activeTab === 'files' ? (
				<Button onClick={onFileSearchOpen} size='icon-sm' variant='ghost'>
					<SearchIcon />
					<span className='sr-only'>Search files</span>
				</Button>
			) : (
				<Button size='icon-sm' variant='ghost'>
					<MoreVerticalIcon />
					<span className='sr-only'>Open review menu</span>
				</Button>
			)}
		</div>
	);
}

/** Manual gh snapshot refresh for the Checks tab. */
function ChecksRefreshButton() {
	const reviewActions = useReviewActions();

	return (
		<div className='flex shrink-0 items-center gap-0.5'>
			<Button
				disabled={reviewActions?.isRefreshingPullRequest}
				onClick={() => reviewActions?.refreshPullRequest()}
				size='icon-sm'
				variant='ghost'
			>
				<RefreshCwIcon
					className={cn(
						reviewActions?.isRefreshingPullRequest ? 'animate-spin' : undefined,
					)}
				/>
				<span className='sr-only'>Refresh pull request status</span>
			</Button>
		</div>
	);
}

/** Dropdown listing the working-tree change set and recent commits. */
function ChangesOverflowMenu({
	onDiscardAll,
	workspace,
}: {
	onDiscardAll: () => void;
	workspace: WorkspaceShellModel;
}) {
	// Defer the `git log` call until the menu actually opens — there's no reason
	// to read commits for every workspace the user merely glances at.
	const [open, setOpen] = useState(false);
	const hasChanges = workspace.changeSummary.files > 0;
	const { data, isError, isPending } = useQuery({
		...workspaceCommitsQuery(workspace.pathLabel),
		enabled: open && Boolean(workspace.pathLabel),
	});
	const commits = data?.commits ?? [];
	const hasCommitFailure = isError || Boolean(data?.error);

	return (
		<DropdownMenu onOpenChange={setOpen} open={open}>
			<DropdownMenuTrigger asChild>
				<Button size='icon-sm' variant='ghost'>
					<MoreVerticalIcon />
					<span className='sr-only'>Open changes menu</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='end' className='w-80 p-0'>
				<div className='p-1'>
					<DropdownMenuItem className='h-9 px-2 text-sm'>
						<span className='min-w-0 flex-1 truncate'>All changes</span>
						<CheckIcon aria-hidden='true' className='size-4' />
					</DropdownMenuItem>
					<DropdownMenuItem className='items-start px-2 py-2'>
						<div className='min-w-0 flex-1'>
							<div className='truncate font-medium text-sm'>
								Uncommitted changes
							</div>
							<div className='text-muted-foreground text-xs'>
								{workspace.changeSummary.files > 0
									? `${workspace.changeSummary.files} files changed`
									: 'No uncommitted changes'}
							</div>
						</div>
						<DropdownMenuShortcut>⌥⌘U</DropdownMenuShortcut>
					</DropdownMenuItem>
				</div>
				<DropdownMenuSeparator className='my-0' />
				<div className='max-h-72 overflow-y-auto p-1'>
					{hasCommitFailure ? (
						<div className='px-2 py-2 text-muted-foreground text-xs'>
							Could not load commits.
						</div>
					) : isPending ? (
						<div className='px-2 py-2 text-muted-foreground text-xs'>
							Loading commits…
						</div>
					) : commits.length ? (
						commits.map((commit) => (
							<DropdownMenuItem
								className='items-start px-2 py-2'
								key={commit.hash}
							>
								<div className='min-w-0'>
									<div className='truncate font-medium text-sm'>
										{commit.subject}
									</div>
									<div className='truncate text-muted-foreground text-xs'>
										{commit.shortHash} • {commit.author} • {commit.relativeTime}
									</div>
								</div>
							</DropdownMenuItem>
						))
					) : (
						<div className='px-2 py-2 text-muted-foreground text-xs'>
							No commits yet.
						</div>
					)}
				</div>
				<DropdownMenuSeparator className='my-0' />
				<div className='p-1'>
					<DropdownMenuItem
						className='h-9 gap-2 px-2 text-sm text-status-danger focus:text-status-danger'
						disabled={!hasChanges}
						onSelect={onDiscardAll}
					>
						<Undo2Icon aria-hidden='true' className='size-4' />
						<span className='min-w-0 flex-1'>Discard all changes</span>
					</DropdownMenuItem>
				</div>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** Individual tab button rendered inside the review-panel header. */
function ReviewTabButton({
	count,
	isActive,
	label,
	onSelect,
}: {
	count?: number;
	isActive: boolean;
	label: string;
	onSelect: () => void;
}) {
	return (
		<Button
			aria-pressed={isActive}
			className={cn(
				'h-8 shrink-0 gap-2 rounded-md px-2.5 text-xs',
				isActive ? 'font-medium' : undefined,
			)}
			onClick={onSelect}
			size='sm'
			variant='ghost'
		>
			<span>{label}</span>
			{typeof count === 'number' ? (
				<span className='shrink-0 font-mono text-muted-foreground tabular-nums'>
					{count}
				</span>
			) : null}
		</Button>
	);
}
