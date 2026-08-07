import { useAtom } from 'jotai';
import {
	EyeIcon,
	ListIcon,
	ListTreeIcon,
	RefreshCwIcon,
	SearchIcon,
} from 'lucide-react';
import { useCallback, useState } from 'react';

import { Button } from '@/renderer/components/ui/button';
import { Tabs, TabsContent } from '@/renderer/components/ui/tabs';
import { useHotkey } from '@/renderer/hooks/use-hotkey';
import { useChangesSource } from '@/renderer/hooks/workbench-shell/review-files/use-changes-source';
import { useDiscardChanges } from '@/renderer/hooks/workbench-shell/review-files/use-discard-changes';
import { useReviewableChanges } from '@/renderer/hooks/workbench-shell/review-files/use-reviewable-changes';
import { useWorkspaceConflicts } from '@/renderer/hooks/workbench-shell/review-files/use-workspace-conflicts';
import { cn } from '@/renderer/lib/utils';
import { changesViewModeAtom } from '@/renderer/state/workspace';
import type {
	ReviewPanelTab,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type {
	ChangesSource,
	ChangesViewMode,
} from '@/renderer/types/workbench-shell';
import { ChecksPanel } from './checks-panel/checks-panel';
import { useReviewActions } from './review-actions/review-actions-context';
import { AllFilesList } from './review-files/all-files-list';
import { AllFilesSearchDialog } from './review-files/all-files-search-dialog';
import {
	ChangesOverflowMenu,
	ChangesSourceBadge,
} from './review-files/changes-source-menu';
import { DiscardChangesDialog } from './review-files/discard-changes-dialog';
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

	// The Review action only makes sense when there's something to review, so gate
	// it on the *whole* branch diff vs base — committed-on-branch and uncommitted
	// edits alike — independent of the user's selected source. Shares the
	// branch-scoped query key with the header/Checks Create PR action, so React
	// Query dedupes it, adding no extra git read.
	const canReview = useReviewableChanges(workspace);

	const { paths: conflictPaths } = useWorkspaceConflicts(workspace);

	const {
		changesCount,
		discardablePaths,
		emptyState,
		isCommitLoading,
		scope,
		setSource,
		source,
		sourceError,
		sourceFiles,
	} = useChangesSource(workspace);

	const reviewTabs: Array<{
		count?: number;
		id: ReviewPanelTab;
		label: string;
	}> = [
		{ id: 'files', label: 'All files' },
		{
			count: changesCount,
			id: 'changes',
			label: 'Changes',
		},
		{ id: 'checks', label: 'Checks' },
	];

	const openFileSearch = useCallback(() => {
		setIsFileSearchOpen(true);
	}, []);
	useHotkey('files.search', openFileSearch);

	// ⌥⌘U jumps straight to the uncommitted change set, switching tabs if needed.
	const showUncommitted = useCallback(() => {
		onTabChange('changes');
		setSource({ kind: 'uncommitted' });
	}, [onTabChange, setSource]);
	useHotkey('changes.uncommitted', showUncommitted);

	const {
		discardTarget,
		handleDiscardAll,
		handleDiscardDialogChange,
		handleDiscardFile,
	} = useDiscardChanges({ sourceFiles, workspace });

	return (
		<Tabs
			className='review-panel h-full min-h-0 gap-0 border-border border-b'
			onValueChange={(value) => onTabChange(value as ReviewPanelTab)}
			value={activeTab}
		>
			<div className='flex h-10 shrink-0 items-center justify-between gap-2 overflow-hidden border-border border-b px-3'>
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
					canReview={canReview}
					changesViewMode={changesViewMode}
					onChangesViewModeToggle={() =>
						setChangesViewMode((current) =>
							current === 'list' ? 'folders' : 'list',
						)
					}
					onDiscardAll={handleDiscardAll}
					onFileSearchOpen={() => setIsFileSearchOpen(true)}
					onSelectSource={setSource}
					source={source}
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
					conflictPaths={conflictPaths}
					diffScope={scope}
					discardablePaths={discardablePaths}
					emptyState={emptyState}
					error={sourceError}
					files={sourceFiles}
					isLoading={isCommitLoading}
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
	canReview,
	changesViewMode,
	onChangesViewModeToggle,
	onDiscardAll,
	onFileSearchOpen,
	onSelectSource,
	source,
	workspace,
}: {
	activeTab: ReviewPanelTab;
	canReview: boolean;
	changesViewMode: ChangesViewMode;
	onChangesViewModeToggle: () => void;
	onDiscardAll: () => void;
	onFileSearchOpen: () => void;
	onSelectSource: (source: ChangesSource) => void;
	source: ChangesSource;
	workspace: WorkspaceShellModel;
}) {
	if (activeTab === 'checks') {
		return <ChecksRefreshButton />;
	}

	const ChangesViewIcon =
		changesViewMode === 'folders' ? ListIcon : ListTreeIcon;

	return (
		<div className='flex shrink-0 items-center gap-0.5'>
			{activeTab === 'changes' ? (
				<>
					<ReviewActionButton canReview={canReview} />
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
					{/* When a non-default source is active its badge owns the slot; the
					    badge's ✕ is the way back, so the overflow trigger is hidden to
					    avoid clutter. The menu only appears in the default "All" state. */}
					{source.kind === 'all' ? (
						<ChangesOverflowMenu
							onDiscardAll={onDiscardAll}
							onSelectSource={onSelectSource}
							source={source}
							workspace={workspace}
						/>
					) : (
						<ChangesSourceBadge
							onClear={() => onSelectSource({ kind: 'all' })}
							source={source}
						/>
					)}
				</>
			) : (
				// Only 'changes' and 'files' remain here ('checks' returns early).
				<>
					<ReviewActionButton canReview={canReview} />
					<Button onClick={onFileSearchOpen} size='icon-sm' variant='ghost'>
						<SearchIcon />
						<span className='sr-only'>Search files</span>
					</Button>
				</>
			)}
		</div>
	);
}

/** Kicks off the review agent action; shared by the Changes and All files tabs. */
function ReviewActionButton({ canReview }: { canReview: boolean }) {
	const reviewActions = useReviewActions();

	// Nothing to review when the branch diff is empty — hide the affordance.
	if (!canReview) {
		return null;
	}

	return (
		<Button
			className='text-accent-strong hover:text-foreground'
			onClick={() => reviewActions?.runAgentAction('review')}
			size='xs'
			variant='ghost'
		>
			<EyeIcon data-icon='inline-start' />
			<span className='review-panel-action-label'>Review</span>
		</Button>
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
