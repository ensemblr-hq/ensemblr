import { Icon } from '@iconify/react';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { Fragment, useMemo } from 'react';

import { Button } from '@/renderer/components/ui/button';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import {
	type ReviewFilePreviewOpener,
	useReviewFilePreviewOpener,
} from '@/renderer/components/workbench-shell/conversation-panel/file-preview-context';
import { useFileTreeExpansion } from '@/renderer/hooks/workbench-shell/review-files/use-file-tree-expansion';
import { useOpenTargets } from '@/renderer/hooks/workbench-shell/use-open-targets';
import { cn } from '@/renderer/lib/utils';
import {
	buildFileTree,
	type FileTreeNode,
	fileTreeIndentClassName,
	getCompactFileDirectory,
	getWorkspaceFileIconName,
	listDirectoryPaths,
} from '@/renderer/lib/workbench';
import type { WorkspaceFileSummary } from '@/renderer/types/workbench';

import {
	FileTreeContextMenu,
	FileTreeMenuProvider,
} from './file-tree-context-menu';

/** Collapsible folder tree of every workspace file (files tab). */
export function AllFilesList({
	files,
	workspaceId,
}: {
	files: WorkspaceFileSummary[];
	workspaceId: string;
}) {
	return (
		<ScrollArea className='h-full'>
			<div className='flex flex-col gap-0.5 p-2.5'>
				{files.length ? (
					<WorkspaceFileTree files={files} workspaceId={workspaceId} />
				) : (
					<p className='rounded-md border border-border bg-pane px-3 py-4 text-muted-foreground text-xs leading-5'>
						Repository files will appear here when the workspace file service is
						wired.
					</p>
				)}
			</div>
		</ScrollArea>
	);
}

/** Builds the tree from the flat file list and renders directories before files. */
function WorkspaceFileTree({
	files,
	workspaceId,
}: {
	files: WorkspaceFileSummary[];
	workspaceId: string;
}) {
	const openFilePreview = useReviewFilePreviewOpener();
	const { invokeTarget, openTargets } = useOpenTargets({ workspaceId });
	const tree = useMemo(() => buildFileTree(files), [files]);
	const knownDirectoryPaths = useMemo(() => listDirectoryPaths(tree), [tree]);
	// Stable identity so every row's context subscription doesn't re-render on
	// each tree re-render; `openTargets` only changes when detection completes.
	const menuValue = useMemo(
		() => ({ invokeTarget, openTargets }),
		[invokeTarget, openTargets],
	);
	// Folders start collapsed: the full repo tree would be overwhelming if every
	// directory rendered open.
	const { isExpanded, toggleDirectory } = useFileTreeExpansion(
		false,
		knownDirectoryPaths,
	);

	return (
		<FileTreeMenuProvider value={menuValue}>
			<div className='flex flex-col gap-0.5' role='tree'>
				{tree.directories.map((directory) => (
					<WorkspaceDirectoryBranch
						isExpanded={isExpanded}
						key={directory.path}
						level={0}
						node={directory}
						onDirectoryToggle={toggleDirectory}
						openFilePreview={openFilePreview}
					/>
				))}
				{tree.files.map((file) => (
					<WorkspaceFileRow
						file={file}
						key={file.id}
						level={0}
						openFilePreview={openFilePreview}
					/>
				))}
			</div>
		</FileTreeMenuProvider>
	);
}

/** Single directory branch in the workspace tree, with collapsible children. */
function WorkspaceDirectoryBranch({
	isExpanded,
	level,
	node,
	onDirectoryToggle,
	openFilePreview,
}: {
	isExpanded: (path: string) => boolean;
	level: number;
	node: FileTreeNode<WorkspaceFileSummary>;
	onDirectoryToggle: (path: string) => void;
	openFilePreview: ReviewFilePreviewOpener | null;
}) {
	const compactDirectory = getCompactFileDirectory(node);
	const isCollapsed = !isExpanded(compactDirectory.node.path);

	return (
		<Fragment>
			<WorkspaceFolderRow
				isCollapsed={isCollapsed}
				labelParts={compactDirectory.labelParts}
				level={level}
				onToggle={() => onDirectoryToggle(compactDirectory.node.path)}
				path={compactDirectory.node.path}
			/>
			{isCollapsed ? null : (
				<>
					{compactDirectory.node.directories.map((directory) => (
						<WorkspaceDirectoryBranch
							isExpanded={isExpanded}
							key={directory.path}
							level={level + 1}
							node={directory}
							onDirectoryToggle={onDirectoryToggle}
							openFilePreview={openFilePreview}
						/>
					))}
					{compactDirectory.node.files.map((file) => (
						<WorkspaceFileRow
							file={file}
							key={file.id}
							level={level + 1}
							openFilePreview={openFilePreview}
						/>
					))}
				</>
			)}
		</Fragment>
	);
}

/** Folder row with a collapse chevron, folder icon, and compacted label. */
function WorkspaceFolderRow({
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
		<FileTreeContextMenu relativePath={path} relativePathKind='directory'>
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
		</FileTreeContextMenu>
	);
}

/** Clickable row that opens a workspace file in the preview pane. */
function WorkspaceFileRow({
	file,
	level,
	openFilePreview,
}: {
	file: WorkspaceFileSummary;
	level: number;
	openFilePreview: ReviewFilePreviewOpener | null;
}) {
	return (
		<FileTreeContextMenu relativePath={file.path} relativePathKind='file'>
			<Button
				aria-label={`Open ${file.path} preview`}
				aria-level={level + 1}
				className={cn(
					'h-auto min-h-7 w-full justify-start gap-2.5 rounded-md px-2 py-0.5 text-left font-normal',
					fileTreeIndentClassName(level),
				)}
				onClick={openFilePreview ? () => openFilePreview(file.path) : undefined}
				role='treeitem'
				size='sm'
				variant='ghost'
			>
				<Icon
					aria-hidden='true'
					className='size-3.5 shrink-0'
					icon={getWorkspaceFileIconName(file)}
				/>
				<span className='min-w-0 truncate font-mono text-xs leading-none'>
					{file.name}
				</span>
			</Button>
		</FileTreeContextMenu>
	);
}
