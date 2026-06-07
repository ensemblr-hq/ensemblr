import { useAtom } from 'jotai';
import {
	CheckIcon,
	EyeIcon,
	ListIcon,
	ListTreeIcon,
	MoreVerticalIcon,
	SearchIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';

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
import { cn } from '@/renderer/lib/utils';
import { changesViewModeAtom } from '@/renderer/state/workspace';
import type {
	ReviewPanelTab,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type { ChangesViewMode } from '@/renderer/types/workbench-shell';

import { ChecksPanel } from './checks-panel';
import {
	AllFilesList,
	AllFilesSearchDialog,
	ReviewFileList,
} from './review-files';

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

	useEffect(() => {
		if (activeTab !== 'files') {
			return;
		}

		const handleKeyDown = (event: KeyboardEvent) => {
			if (
				!(event.metaKey || event.ctrlKey) ||
				event.key.toLowerCase() !== 'p'
			) {
				return;
			}

			event.preventDefault();
			setIsFileSearchOpen(true);
		};

		window.addEventListener('keydown', handleKeyDown);

		return () => {
			window.removeEventListener('keydown', handleKeyDown);
		};
	}, [activeTab]);

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
					onFileSearchOpen={() => setIsFileSearchOpen(true)}
					workspace={workspace}
				/>
			</div>
			<TabsContent className='min-h-0 overflow-hidden' value='files'>
				<AllFilesList files={workspace.workspaceFiles} />
			</TabsContent>
			<TabsContent className='min-h-0 overflow-hidden' value='changes'>
				<ReviewFileList
					files={workspace.reviewFiles}
					viewMode={changesViewMode}
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
		</Tabs>
	);
}

/** Tab-aware action cluster on the review panel header. */
function ReviewPanelActions({
	activeTab,
	changesViewMode,
	onChangesViewModeToggle,
	onFileSearchOpen,
	workspace,
}: {
	activeTab: ReviewPanelTab;
	changesViewMode: ChangesViewMode;
	onChangesViewModeToggle: () => void;
	onFileSearchOpen: () => void;
	workspace: WorkspaceShellModel;
}) {
	if (activeTab === 'checks') {
		return <div className='w-0 shrink-0' />;
	}

	const ChangesViewIcon =
		changesViewMode === 'folders' ? ListIcon : ListTreeIcon;

	return (
		<div className='flex shrink-0 items-center gap-0.5'>
			{activeTab === 'changes' ? (
				<>
					<Button
						className='text-accent-strong hover:text-foreground'
						size='xs'
						variant='ghost'
					>
						<EyeIcon data-icon='inline-start' />
						<span className='review-panel-action-label'>Review</span>
					</Button>
					<Button
						aria-pressed={changesViewMode === 'folders'}
						className={cn(
							changesViewMode === 'folders' && 'bg-muted text-foreground',
						)}
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
					<ChangesOverflowMenu workspace={workspace} />
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

/** Dropdown listing commit ranges and uncommitted-changes options. */
function ChangesOverflowMenu({
	workspace,
}: {
	workspace: WorkspaceShellModel;
}) {
	return (
		<DropdownMenu>
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
								{workspace.changeSummary.files} files changed
							</div>
						</div>
						<DropdownMenuShortcut>⌥U</DropdownMenuShortcut>
					</DropdownMenuItem>
				</div>
				<DropdownMenuSeparator className='my-0' />
				<div className='p-1'>
					<DropdownMenuItem className='items-start px-2 py-2'>
						<div className='min-w-0'>
							<div className='truncate font-medium text-sm'>
								Refine right sidebar PR header states
							</div>
							<div className='truncate text-muted-foreground text-xs'>
								0dc9887 • Philipp Soldunov • 29m ago
							</div>
						</div>
					</DropdownMenuItem>
					<DropdownMenuItem className='items-start px-2 py-2'>
						<div className='min-w-0'>
							<div className='truncate font-medium text-sm'>
								THE-102 rework workbench shell
							</div>
							<div className='truncate text-muted-foreground text-xs'>
								4339956 • Philipp Soldunov • 1h ago
							</div>
						</div>
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
		<button
			aria-pressed={isActive}
			className={cn(
				'flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-2.5 text-xs transition-colors',
				isActive
					? 'bg-muted font-medium text-foreground'
					: 'text-muted-foreground hover:text-foreground',
			)}
			onClick={onSelect}
			type='button'
		>
			<span>{label}</span>
			{typeof count === 'number' ? (
				<span className='shrink-0 font-mono text-muted-foreground tabular-nums'>
					{count}
				</span>
			) : null}
		</button>
	);
}
