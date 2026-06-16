import { Icon } from '@iconify/react';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { Fragment, useMemo } from 'react';

import { Button } from '@/renderer/components/ui/button';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import {
	useWorkspaceFileDiffOpener,
	type WorkspaceFileDiffOpener,
} from '@/renderer/components/workbench-shell/conversation-panel/file-preview-context';
import { useFileTreeExpansion } from '@/renderer/hooks/workbench-shell/review-files/use-file-tree-expansion';
import { cn } from '@/renderer/lib/utils';
import {
	buildFileTree,
	type FileTreeNode,
	fileTreeIndentClassName,
	getCompactFileDirectory,
	getWorkspaceFileIconName,
	listDirectoryPaths,
} from '@/renderer/lib/workbench';
import type { ReviewFileSummary } from '@/renderer/types/workbench';
import type { ChangesViewMode } from '@/renderer/types/workbench-shell';

const fileStatusLabel: Record<ReviewFileSummary['status'], string> = {
	added: 'A',
	deleted: 'D',
	modified: 'M',
	renamed: 'R',
	untracked: 'U',
};

/** Renders the changes panel as either a flat list or a collapsible folder tree. */
export function ReviewFileList({
	error,
	files,
	viewMode,
}: {
	error?: string;
	files: ReviewFileSummary[];
	viewMode: ChangesViewMode;
}) {
	// Read the diff opener once here rather than in every file row: a large
	// change set would otherwise create one context subscription per row.
	const openWorkspaceFileDiff = useWorkspaceFileDiffOpener();
	// Binary and empty untracked files report 0/0 lines but are still changes.
	const visibleFiles = files.filter(
		(file) => file.additions || file.deletions || file.status !== 'modified',
	);

	return (
		<ScrollArea className='h-full'>
			<div className='flex flex-col gap-1 p-3'>
				{error ? (
					<div className='rounded-md border border-status-danger/40 bg-pane px-3 py-4 text-status-danger text-xs leading-5'>
						Could not read workspace changes: {error}
					</div>
				) : visibleFiles.length ? (
					viewMode === 'folders' ? (
						<ReviewFileTree
							files={visibleFiles}
							openWorkspaceFileDiff={openWorkspaceFileDiff}
						/>
					) : (
						visibleFiles.map((file) => (
							<ReviewFileButton
								file={file}
								key={file.id}
								openWorkspaceFileDiff={openWorkspaceFileDiff}
								showPath
							/>
						))
					)
				) : (
					<div className='rounded-md border border-border bg-pane px-3 py-4 text-muted-foreground text-xs leading-5'>
						No changes in this workspace yet. Edits made by Pi or in your editor
						will appear here.
					</div>
				)}
			</div>
		</ScrollArea>
	);
}

/** Collapsible directory tree of changed files. */
function ReviewFileTree({
	files,
	openWorkspaceFileDiff,
}: {
	files: ReviewFileSummary[];
	openWorkspaceFileDiff: WorkspaceFileDiffOpener | null;
}) {
	const tree = useMemo(() => buildFileTree(files), [files]);
	const knownDirectoryPaths = useMemo(() => listDirectoryPaths(tree), [tree]);
	// Folders start expanded: the changes set is small, and reviewers want to
	// see every touched file at a glance.
	const { isExpanded, toggleDirectory } = useFileTreeExpansion(
		true,
		knownDirectoryPaths,
	);

	return (
		<div className='flex flex-col gap-1' role='tree'>
			{tree.directories.map((directory) => (
				<ReviewDirectoryBranch
					isExpanded={isExpanded}
					key={directory.path}
					level={0}
					node={directory}
					onDirectoryToggle={toggleDirectory}
					openWorkspaceFileDiff={openWorkspaceFileDiff}
				/>
			))}
			{tree.files.map((file) => (
				<ReviewFileButton
					ariaLevel={1}
					file={file}
					key={file.id}
					openWorkspaceFileDiff={openWorkspaceFileDiff}
					showPath
				/>
			))}
		</div>
	);
}

/** Single directory branch in the review file tree, with collapsible children. */
function ReviewDirectoryBranch({
	isExpanded,
	level,
	node,
	onDirectoryToggle,
	openWorkspaceFileDiff,
}: {
	isExpanded: (path: string) => boolean;
	level: number;
	node: FileTreeNode<ReviewFileSummary>;
	onDirectoryToggle: (path: string) => void;
	openWorkspaceFileDiff: WorkspaceFileDiffOpener | null;
}) {
	const compactDirectory = getCompactFileDirectory(node);
	const isCollapsed = !isExpanded(compactDirectory.node.path);

	return (
		<Fragment>
			<ReviewFolderRow
				isCollapsed={isCollapsed}
				labelParts={compactDirectory.labelParts}
				level={level}
				onToggle={() => onDirectoryToggle(compactDirectory.node.path)}
				path={compactDirectory.node.path}
			/>
			{isCollapsed ? null : (
				<>
					{compactDirectory.node.directories.map((directory) => (
						<ReviewDirectoryBranch
							isExpanded={isExpanded}
							key={directory.path}
							level={level + 1}
							node={directory}
							onDirectoryToggle={onDirectoryToggle}
							openWorkspaceFileDiff={openWorkspaceFileDiff}
						/>
					))}
					{compactDirectory.node.files.map((file) => (
						<ReviewFileButton
							ariaLevel={level + 2}
							file={file}
							key={file.id}
							level={level + 1}
							openWorkspaceFileDiff={openWorkspaceFileDiff}
							showPath={false}
						/>
					))}
				</>
			)}
		</Fragment>
	);
}

/** Single folder row in the review tree, with collapse chevron and label. */
function ReviewFolderRow({
	isCollapsed,
	labelParts,
	level,
	onToggle,
	path,
}: {
	isCollapsed: boolean;
	labelParts: string[];
	level: number;
	onToggle: () => void;
	path: string;
}) {
	const FolderChevronIcon = isCollapsed ? ChevronRightIcon : ChevronDownIcon;
	// A collapsed row only advertises its own name; the merged `a / b / c` chain
	// is shown once expanded, when its single-child descendants are revealed.
	const visibleLabelParts = isCollapsed ? labelParts.slice(0, 1) : labelParts;
	const folderIconName = getWorkspaceFileIconName(
		{ kind: 'directory', name: visibleLabelParts.at(-1) ?? path },
		{ isExpanded: !isCollapsed },
	);

	return (
		<Button
			aria-expanded={!isCollapsed}
			aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${path}`}
			aria-level={level + 1}
			// Highlight only on hover: drop the ghost variant's persistent
			// open-state fill (`aria-expanded:bg-muted`) while keeping the hover
			// fill for expanded folders.
			className={cn(
				'h-7 w-full justify-start gap-1.5 rounded-md px-2 text-xs aria-expanded:bg-transparent aria-expanded:hover:bg-muted',
				fileTreeIndentClassName(level),
			)}
			onClick={onToggle}
			role='treeitem'
			size='sm'
			variant='ghost'
		>
			<FolderChevronIcon aria-hidden='true' className='size-3 shrink-0' />
			<Icon
				aria-hidden='true'
				className='size-3.5 shrink-0'
				icon={folderIconName}
			/>
			<span className='min-w-0 truncate font-mono'>
				{visibleLabelParts.map((label, index) => (
					<Fragment key={`${label}-${index}`}>
						{index > 0 ? (
							<span className='px-1 text-muted-foreground/70'>/</span>
						) : null}
						<span>{label}</span>
					</Fragment>
				))}
			</span>
		</Button>
	);
}

/** Clickable row representing a single file change. */
function ReviewFileButton({
	ariaLevel,
	file,
	level = 0,
	openWorkspaceFileDiff,
	showPath,
}: {
	/** Tree depth (1-based) when rendered inside the folder tree; omit in the flat list. */
	ariaLevel?: number;
	file: ReviewFileSummary;
	level?: number;
	openWorkspaceFileDiff: WorkspaceFileDiffOpener | null;
	showPath: boolean;
}) {
	const fileName = getReviewFileName(file.path);

	return (
		<Button
			aria-label={`Open ${file.path} diff`}
			aria-level={ariaLevel}
			onClick={
				openWorkspaceFileDiff
					? () => openWorkspaceFileDiff(file.path)
					: undefined
			}
			className={cn(
				'grid h-auto w-full grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-md px-2 py-1.5 font-normal',
				fileTreeIndentClassName(level),
			)}
			role={ariaLevel === undefined ? undefined : 'treeitem'}
			size='sm'
			variant='ghost'
		>
			<div className='flex min-w-0 items-center gap-2 text-xs'>
				<Icon
					aria-hidden='true'
					className='size-3.5 shrink-0'
					icon={getWorkspaceFileIconName({ kind: 'file', name: fileName })}
				/>
				{showPath ? (
					<ReviewFilePath path={file.path} />
				) : (
					<span className='min-w-0 truncate'>{fileName}</span>
				)}
			</div>
			<ReviewFileStats file={file} />
		</Button>
	);
}

/** Renders a file path with a dimmed directory prefix. */
function ReviewFilePath({ path }: { path: string }) {
	const directory = getReviewFileDirectory(path);
	const fileName = getReviewFileName(path);

	return (
		<span className='min-w-0 truncate'>
			{directory ? (
				<span className='text-muted-foreground'>{directory}/</span>
			) : null}
			<span>{fileName}</span>
		</span>
	);
}

/** Trailing status badge and +/- diff numbers for a file row. */
function ReviewFileStats({ file }: { file: ReviewFileSummary }) {
	const statusLabel =
		file.status === 'modified' ? null : fileStatusLabel[file.status];

	return (
		<div className='flex min-w-0 max-w-28 shrink-0 items-center justify-end gap-1 font-mono text-xxs tabular-nums'>
			{statusLabel ? (
				<span className='truncate text-muted-foreground'>{statusLabel}</span>
			) : null}
			{file.additions > 0 ? (
				<span className='shrink-0 text-status-ok'>+{file.additions}</span>
			) : null}
			{file.deletions > 0 ? (
				<span className='shrink-0 text-status-danger'>-{file.deletions}</span>
			) : null}
		</div>
	);
}

/** Returns the parent-directory portion of a file path, or `''` when none. */
function getReviewFileDirectory(path: string) {
	const lastSeparatorIndex = path.lastIndexOf('/');

	return lastSeparatorIndex === -1 ? '' : path.slice(0, lastSeparatorIndex);
}

/** Returns the basename portion of a file path. */
function getReviewFileName(path: string) {
	const lastSeparatorIndex = path.lastIndexOf('/');

	return lastSeparatorIndex === -1 ? path : path.slice(lastSeparatorIndex + 1);
}
