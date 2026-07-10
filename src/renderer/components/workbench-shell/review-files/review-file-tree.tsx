import { Icon } from '@iconify/react';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { Fragment, useMemo } from 'react';

import { Button } from '@/renderer/components/ui/button';
import { useFileTreeExpansion } from '@/renderer/hooks/workbench-shell/review-files/use-file-tree-expansion';
import { cn } from '@/renderer/lib/utils';
import {
	buildFileTree,
	fileTreeIndentClassName,
	getCompactFileDirectory,
	getWorkspaceFileIconName,
	listDirectoryPaths,
} from '@/renderer/lib/workbench';
import type {
	FileTreeNode,
	ReviewFileSummary,
} from '@/renderer/types/workbench';

import { FileTreeLabel } from './file-tree-label';
import { ReviewFileRow } from './review-file-row';

/** Collapsible directory tree of changed files. */
export function ReviewFileTree({ files }: { files: ReviewFileSummary[] }) {
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
				/>
			))}
			{tree.files.map((file) => (
				<ReviewFileRow ariaLevel={1} file={file} key={file.id} showPath />
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
}: {
	isExpanded: (path: string) => boolean;
	level: number;
	node: FileTreeNode<ReviewFileSummary>;
	onDirectoryToggle: (path: string) => void;
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
						/>
					))}
					{compactDirectory.node.files.map((file) => (
						<ReviewFileRow
							ariaLevel={level + 2}
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
			<FileTreeLabel parts={visibleLabelParts} />
		</Button>
	);
}
