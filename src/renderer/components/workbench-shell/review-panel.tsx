import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useAtom } from 'jotai';
import {
	EyeIcon,
	ListIcon,
	ListTreeIcon,
	RefreshCwIcon,
	SearchIcon,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { workspaceGitStatusQuery } from '@/renderer/api/ensemble';
import { Button } from '@/renderer/components/ui/button';
import { Tabs, TabsContent } from '@/renderer/components/ui/tabs';
import { useHotkey } from '@/renderer/hooks/use-hotkey';
import { useReviewableChanges } from '@/renderer/hooks/workbench-shell/review-files/use-reviewable-changes';
import { cn } from '@/renderer/lib/utils';
import { mapGitStatusToReviewFiles } from '@/renderer/lib/workbench/review-files';
import {
	changesSourceByWorkspaceAtom,
	changesViewModeAtom,
} from '@/renderer/state/workspace';
import type {
	ReviewPanelTab,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type {
	ChangesSource,
	ChangesViewMode,
} from '@/renderer/types/workbench-shell';
import type { WorkspaceGitDiffScope } from '@/shared/ipc/contracts/workspace-git';

import { ChecksPanel } from './checks-panel/checks-panel';
import { useReviewActions } from './review-actions/review-actions-context';
import { AllFilesList } from './review-files/all-files-list';
import { AllFilesSearchDialog } from './review-files/all-files-search-dialog';
import {
	ChangesOverflowMenu,
	ChangesSourceBadge,
} from './review-files/changes-source-menu';
import {
	DiscardChangesDialog,
	type DiscardChangesTarget,
} from './review-files/discard-changes-dialog';
import { ReviewFileList } from './review-files/review-file-list';

/** Resolves the active change source to the git diff scope a query needs. */
function sourceToScope(
	source: ChangesSource,
	baseRef: string | null,
): WorkspaceGitDiffScope {
	if (source.kind === 'commit') {
		return { commitHash: source.hash, kind: 'commit' };
	}
	// "All changes" means the whole branch — but it can only diff against a base
	// when one is known; otherwise it degrades to the working-tree change set.
	if (source.kind === 'all' && baseRef) {
		return { baseRef, kind: 'branch' };
	}
	return { kind: 'working-tree' };
}

/** Empty-state copy tailored to the active change source. */
function emptyStateForSource(source: ChangesSource): {
	message: string;
	title: string;
} {
	if (source.kind === 'uncommitted') {
		return {
			message: 'Everything here is committed.',
			title: 'No uncommitted changes yet',
		};
	}
	if (source.kind === 'commit') {
		return {
			message: `${source.shortHash} touched no files.`,
			title: 'No changes in this commit',
		};
	}
	return {
		message: 'Changes on this branch appear here.',
		title: 'No changes yet',
	};
}

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

	// The Changes tab can show every branch change, only uncommitted edits, or a
	// single commit — picked per workspace and persisted.
	const [sourceMap, setSourceMap] = useAtom(changesSourceByWorkspaceAtom);
	const storedSource = sourceMap[workspace.id];
	const source = useMemo<ChangesSource>(
		() => storedSource ?? { kind: 'all' },
		[storedSource],
	);
	const setSource = useCallback(
		(next: ChangesSource) => {
			setSourceMap((current) => ({ ...current, [workspace.id]: next }));
		},
		[setSourceMap, workspace.id],
	);

	const baseRef = workspace.landingSummary?.branchSource.baseBranch ?? null;
	const scope = useMemo(
		() => sourceToScope(source, baseRef),
		[source, baseRef],
	);

	// The Review action only makes sense when there's something to review, so gate
	// it on the *whole* branch diff vs base — committed-on-branch and uncommitted
	// edits alike — independent of the user's selected source. Shares the
	// branch-scoped query key with the header/Checks Create PR action, so React
	// Query dedupes it; when source is the default "all" + a known base it also
	// matches `scope` below, adding no extra git read.
	const canReview = useReviewableChanges(workspace);

	// Source-aware status drives both the tab count and the file list. The
	// working-tree scope reuses the live model's query (same key), so only the
	// branch/commit views issue an extra git read — for the active workspace.
	const { data: sourceStatusData, isLoading: isSourceStatusLoading } = useQuery(
		{
			...workspaceGitStatusQuery(workspace.pathLabel ?? null, scope),
			placeholderData: keepPreviousData,
		},
	);
	const statusData =
		sourceStatusData && !sourceStatusData.error ? sourceStatusData : null;
	// Until the source query resolves, the "all"/"uncommitted" views borrow the
	// live model's already-loaded change set so rows don't blink away on every
	// switch or first paint. A commit view has no model equivalent — it loads.
	const useModelChanges = !statusData && source.kind !== 'commit';
	const sourceFiles = useMemo(
		() =>
			statusData
				? mapGitStatusToReviewFiles(statusData.files)
				: useModelChanges
					? workspace.reviewFiles
					: [],
		[statusData, useModelChanges, workspace.reviewFiles],
	);
	const changesCount = statusData
		? statusData.summary.files
		: useModelChanges
			? workspace.changeSummary.files
			: 0;

	// Only working-tree (uncommitted) files revert cleanly. The live model's
	// `reviewFiles` is exactly that set, so cross-reference it to decide which
	// rows expose a Discard action regardless of the active source.
	const discardablePaths = useMemo(
		() => new Set(workspace.reviewFiles.map((file) => file.path)),
		[workspace.reviewFiles],
	);
	const emptyState = useMemo(() => emptyStateForSource(source), [source]);

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
	useHotkey('files.search', openFileSearch, {
		enabled: activeTab === 'files',
	});

	// ⌥⌘U jumps straight to the uncommitted change set, switching tabs if needed.
	const showUncommitted = useCallback(() => {
		onTabChange('changes');
		setSource({ kind: 'uncommitted' });
	}, [onTabChange, setSource]);
	useHotkey('changes.uncommitted', showUncommitted);

	const [discardTarget, setDiscardTarget] =
		useState<DiscardChangesTarget | null>(null);

	// Route every discard through the confirm dialog rather than reverting
	// inline: the git operation is irreversible, so it stays behind an explicit,
	// cancelable step. A rename carries both its new path and `renamedFrom` so
	// the original is restored alongside the new copy's removal.
	const handleDiscardFile = useCallback(
		(filePath: string) => {
			const file = sourceFiles.find((entry) => entry.path === filePath);
			const paths = file?.renamedFrom
				? [filePath, file.renamedFrom]
				: [filePath];
			setDiscardTarget({ fileCount: 1, paths, title: filePath });
		},
		[sourceFiles],
	);

	// Discard every uncommitted change at once. Only working-tree files revert,
	// so this always targets the live model's `reviewFiles` regardless of the
	// active source view; renames contribute both paths.
	const handleDiscardAll = useCallback(() => {
		const uncommitted = workspace.reviewFiles;
		if (uncommitted.length === 0) {
			return;
		}
		const paths = uncommitted.flatMap((file) =>
			file.renamedFrom ? [file.path, file.renamedFrom] : [file.path],
		);
		setDiscardTarget({
			fileCount: uncommitted.length,
			paths,
			title: `all ${uncommitted.length} uncommitted ${
				uncommitted.length === 1 ? 'change' : 'changes'
			}`,
		});
	}, [workspace.reviewFiles]);

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
					diffScope={scope}
					discardablePaths={discardablePaths}
					emptyState={emptyState}
					error={
						source.kind === 'commit'
							? sourceStatusData?.error?.message
							: workspace.reviewFilesError
					}
					files={sourceFiles}
					isLoading={source.kind === 'commit' && isSourceStatusLoading}
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
