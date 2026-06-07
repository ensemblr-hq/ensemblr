import { Icon } from '@iconify/react';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { Fragment, useState } from 'react';

import {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from '@/renderer/components/ui/command';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { cn } from '@/renderer/lib/utils';
import { getWorkspaceFileIconName } from '@/renderer/lib/workbench';
import type {
	ReviewFileSummary,
	WorkspaceFileSummary,
} from '@/renderer/types/workbench';
import type { ChangesViewMode } from '@/renderer/types/workbench-shell';

const fileStatusLabel: Record<ReviewFileSummary['status'], string> = {
	added: 'A',
	deleted: 'D',
	modified: 'M',
	renamed: 'R',
	untracked: 'U',
};

interface ReviewFileTreeNode {
	directories: ReviewFileTreeNode[];
	files: ReviewFileSummary[];
	name: string;
	path: string;
}

interface MutableReviewFileTreeNode extends ReviewFileTreeNode {
	directoryMap: Map<string, MutableReviewFileTreeNode>;
}

/** Renders the changes panel as either a flat list or a collapsible folder tree. */
export function ReviewFileList({
	files,
	viewMode,
}: {
	files: ReviewFileSummary[];
	viewMode: ChangesViewMode;
}) {
	const visibleFiles = files.filter((file) => file.additions || file.deletions);

	return (
		<ScrollArea className='h-full'>
			<div className='flex flex-col gap-1 p-3'>
				{visibleFiles.length ? (
					viewMode === 'folders' ? (
						<ReviewFileTree files={visibleFiles} />
					) : (
						visibleFiles.map((file) => (
							<ReviewFileButton file={file} key={file.id} showPath />
						))
					)
				) : (
					<div className='rounded-md border border-border bg-pane px-3 py-4 text-muted-foreground text-xs leading-5'>
						File state will appear here when the Git workspace service is wired.
					</div>
				)}
			</div>
		</ScrollArea>
	);
}

/** Collapsible directory tree of changed files. */
function ReviewFileTree({ files }: { files: ReviewFileSummary[] }) {
	const [collapsedDirectoryPaths, setCollapsedDirectoryPaths] = useState<
		Set<string>
	>(() => new Set());
	const tree = buildReviewFileTree(files);
	const toggleDirectory = (path: string) => {
		setCollapsedDirectoryPaths((current) => {
			const next = new Set(current);

			if (next.has(path)) {
				next.delete(path);
				return next;
			}

			next.add(path);
			return next;
		});
	};

	return (
		<>
			{tree.files.map((file) => (
				<ReviewFileButton file={file} key={file.id} showPath />
			))}
			{tree.directories.map((directory) => (
				<ReviewDirectoryBranch
					collapsedDirectoryPaths={collapsedDirectoryPaths}
					key={directory.path}
					level={0}
					node={directory}
					onDirectoryToggle={toggleDirectory}
				/>
			))}
		</>
	);
}

/** Single directory branch in the review file tree, with collapsible children. */
function ReviewDirectoryBranch({
	collapsedDirectoryPaths,
	level,
	node,
	onDirectoryToggle,
}: {
	collapsedDirectoryPaths: Set<string>;
	level: number;
	node: ReviewFileTreeNode;
	onDirectoryToggle: (path: string) => void;
}) {
	const compactDirectory = getCompactReviewDirectory(node);
	const isCollapsed = collapsedDirectoryPaths.has(compactDirectory.node.path);

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
							collapsedDirectoryPaths={collapsedDirectoryPaths}
							key={directory.path}
							level={level + 1}
							node={directory}
							onDirectoryToggle={onDirectoryToggle}
						/>
					))}
					{compactDirectory.node.files.map((file) => (
						<ReviewFileButton
							file={file}
							key={file.id}
							level={level + 1}
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
	const folderIconName = getWorkspaceFileIconName({
		kind: 'directory',
		name: labelParts[0] ?? path,
	});

	return (
		<button
			aria-expanded={!isCollapsed}
			aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${path}`}
			className={cn(
				'flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-left text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
				reviewFileIndentClassName(level),
			)}
			onClick={onToggle}
			type='button'
		>
			<FolderChevronIcon aria-hidden='true' className='size-3 shrink-0' />
			<Icon
				aria-hidden='true'
				className='size-3.5 shrink-0'
				icon={folderIconName}
			/>
			<span className='min-w-0 truncate font-mono'>
				{labelParts.map((label, index) => (
					<Fragment key={`${label}-${index}`}>
						{index > 0 ? (
							<span className='px-1 text-muted-foreground/70'>/</span>
						) : null}
						<span>{label}</span>
					</Fragment>
				))}
			</span>
		</button>
	);
}

/** Clickable row representing a single file change. */
function ReviewFileButton({
	file,
	level = 0,
	showPath,
}: {
	file: ReviewFileSummary;
	level?: number;
	showPath: boolean;
}) {
	const fileName = getReviewFileName(file.path);

	return (
		<button
			aria-label={`Open ${file.path} diff`}
			className={cn(
				'grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
				reviewFileIndentClassName(level),
			)}
			type='button'
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
		</button>
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
		<div className='flex min-w-0 max-w-28 shrink-0 items-center justify-end gap-1 font-mono text-[0.6875rem] tabular-nums'>
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

/**
 * Builds a tree structure from flat review-file rows by their path segments.
 * @param files - Flat list of file changes.
 * @returns The root tree node.
 */
function buildReviewFileTree(
	files: ReviewFileSummary[],
): MutableReviewFileTreeNode {
	const root = createReviewFileTreeNode('', '');

	for (const file of files) {
		const pathParts = file.path.split('/').filter(Boolean);
		const fileName = pathParts.pop();

		if (!fileName) {
			continue;
		}

		let currentNode = root;

		for (const directoryName of pathParts) {
			const directoryPath = currentNode.path
				? `${currentNode.path}/${directoryName}`
				: directoryName;
			let nextNode = currentNode.directoryMap.get(directoryName);

			if (!nextNode) {
				nextNode = createReviewFileTreeNode(directoryName, directoryPath);
				currentNode.directoryMap.set(directoryName, nextNode);
				currentNode.directories.push(nextNode);
			}

			currentNode = nextNode;
		}

		currentNode.files.push(file);
	}

	return root;
}

/** Constructs an empty mutable tree node for a directory. */
function createReviewFileTreeNode(
	name: string,
	path: string,
): MutableReviewFileTreeNode {
	return {
		directories: [],
		directoryMap: new Map(),
		files: [],
		name,
		path,
	};
}

/**
 * Walks down chains of single-child directories so the tree shows `a/b/c` as
 * one row instead of three.
 * @param node - Starting directory.
 * @returns The compact node plus the label parts that were merged.
 */
function getCompactReviewDirectory(node: ReviewFileTreeNode): {
	labelParts: string[];
	node: ReviewFileTreeNode;
} {
	const labelParts = [node.name];
	let compactNode = node;

	while (
		compactNode.files.length === 0 &&
		compactNode.directories.length === 1
	) {
		compactNode = compactNode.directories[0];
		labelParts.push(compactNode.name);
	}

	return { labelParts, node: compactNode };
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

/** Maps a tree depth to the matching Tailwind left-padding class. */
function reviewFileIndentClassName(level: number) {
	if (level <= 0) {
		return '';
	}

	if (level === 1) {
		return 'pl-6';
	}

	if (level === 2) {
		return 'pl-10';
	}

	if (level === 3) {
		return 'pl-14';
	}

	return 'pl-16';
}

/** Flat scrollable list of every workspace file (files tab). */
export function AllFilesList({ files }: { files: WorkspaceFileSummary[] }) {
	return (
		<ScrollArea className='h-full'>
			<ul className='flex flex-col gap-0.5 p-2.5'>
				{files.length ? (
					files.map((file) => (
						<li key={file.id}>
							<button
								aria-label={getWorkspaceFileActionLabel(file)}
								className='flex min-h-7 w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-0.5 text-left text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
								type='button'
							>
								<WorkspaceFileIcon file={file} />
								<span className='min-w-0 truncate font-mono text-xs leading-none'>
									{file.name}
								</span>
							</button>
						</li>
					))
				) : (
					<li className='rounded-md border border-border bg-pane px-3 py-4 text-muted-foreground text-xs leading-5'>
						Repository files will appear here when the workspace file service is
						wired.
					</li>
				)}
			</ul>
		</ScrollArea>
	);
}

/** ⌘P-style file search dialog that opens a preview when a file is selected. */
export function AllFilesSearchDialog({
	files,
	onOpenChange,
	open,
}: {
	files: WorkspaceFileSummary[];
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	const searchableFiles = files.filter((file) => file.kind === 'file');
	const closeSearch = () => {
		onOpenChange(false);
	};

	return (
		<CommandDialogtext-xxs
			className='top-20 max-w-xl translate-y-0 shadow-2xl sm:max-w-xl'
			description='Open a repository file from the All files tab.'
			onOpenChange={onOpenChange}
			open={open}
			title='Search files'
		>
			<Command className='rounded-xl border-0'>
				<CommandInput placeholder='Search files' />
				<CommandList className='max-h-80'>
					<CommandEmpty>No files match your search.</CommandEmpty>
					<CommandGroup heading='Files'>
						{searchableFiles.map((file) => (
							<CommandItem
								aria-label={`Open ${file.path} preview`}
								className='min-h-10'
								key={file.id}
								onSelect={closeSearch}
								value={`${file.name} ${file.path}`}
							>
								<WorkspaceFileIcon file={file} />
								<div className='min-w-0 flex-1'>
									<div className='truncate text-xs'>{file.name}</div>
									{file.path !== file.name ? (
										<div className='truncate text-[0.6875rem] text-muted-foreground'>
											{file.path}
										</div>
									) : null}
								</div>
							</CommandItem>
						))}
					</CommandGroup>
				</CommandList>
			</Command>
		</CommandDialog>
	);
}

/** Computes the aria-label for an All-files row, branching on file vs. folder. */
function getWorkspaceFileActionLabel(file: WorkspaceFileSummary) {
	return file.kind === 'directory'
		? `Open ${file.name} directory`
		: `Open ${file.name} preview`;
}

/** Renders the VSCode-style icon for a workspace file or folder. */
function WorkspaceFileIcon({ file }: { file: WorkspaceFileSummary }) {
	return (
		<Icon
			aria-hidden='true'
			className='size-3.5 shrink-0'
			icon={getWorkspaceFileIconName(file)}
		/>
	);
}
