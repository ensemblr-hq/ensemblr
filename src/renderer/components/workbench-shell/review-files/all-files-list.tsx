import { Icon } from '@iconify/react';
import {
	ChevronDownIcon,
	ChevronRightIcon,
	FolderOpenIcon,
} from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import {
	ContextMenu,
	ContextMenuTrigger,
} from '@/renderer/components/ui/context-menu';
import { useReviewFilePreviewOpener } from '@/renderer/components/workbench-shell/conversation-panel/file-preview-context';
import { PanelPlaceholder } from '@/renderer/components/workbench-shell/panel-placeholder';
import { useWorkspaceFileTree } from '@/renderer/hooks/workbench-shell/review-files/use-workspace-file-tree';
import { useOpenTargets } from '@/renderer/hooks/workbench-shell/use-open-targets';
import { cn } from '@/renderer/lib/utils';
import {
	fileTreeIndentClassName,
	getWorkspaceFileIconName,
} from '@/renderer/lib/workbench';
import type {
	FileTreeNode,
	ReviewFilePreviewOpener,
	WorkspaceFileSummary,
} from '@/renderer/types/workbench';

import { AllFilesContextMenuContent } from './all-files-context-menu';
import { FileTreeLabel } from './file-tree-label';

/** Collapsible folder tree of every workspace file (files tab). */
export function AllFilesList({
	files,
	workspaceCwd,
	workspaceId,
}: {
	files: WorkspaceFileSummary[];
	workspaceCwd: string;
	workspaceId: string;
}) {
	const { t } = useTranslation();

	if (!files.length) {
		return (
			<PanelPlaceholder
				icon={FolderOpenIcon}
				message={t(
					'workbench:all-files.empty.message',
					'Files appear here as soon as they are created.',
				)}
				title={t('workbench:all-files.empty.title', 'No files yet')}
			/>
		);
	}

	return (
		<WorkspaceFileTree
			files={files}
			key={workspaceCwd}
			workspaceCwd={workspaceCwd}
			workspaceId={workspaceId}
		/>
	);
}

/**
 * Builds the tree from the flat file list, flattens it to the visible rows, and
 * renders them through a virtualizer so only the on-screen rows mount. A single
 * shared right-click menu serves every row.
 */
function WorkspaceFileTree({
	files,
	workspaceCwd,
	workspaceId,
}: {
	files: WorkspaceFileSummary[];
	workspaceCwd: string;
	workspaceId: string;
}) {
	const openFilePreview = useReviewFilePreviewOpener();
	const { copyTarget, invokeTarget, openInTargets } = useOpenTargets({
		workspaceId,
	});

	const hasMenu =
		openInTargets.length > 0 || Boolean(copyTarget) || Boolean(openFilePreview);

	const {
		handleContextCapture,
		handleDirectoryToggle,
		menuTarget,
		rows,
		scrollRef,
		virtualizer,
	} = useWorkspaceFileTree({ files, hasMenu, workspaceCwd, workspaceId });

	const listBody = (
		<div
			className='sleek-scrollbar h-full overflow-y-auto p-2.5'
			onContextMenuCapture={handleContextCapture}
			ref={scrollRef}
		>
			<div
				className='relative w-full'
				role='tree'
				style={{ height: `${virtualizer.getTotalSize()}px` }}
			>
				{virtualizer.getVirtualItems().map((virtualRow) => {
					const row = rows[virtualRow.index];

					return (
						<div
							className='absolute top-0 left-0 w-full'
							key={row.key}
							style={{
								height: `${virtualRow.size}px`,
								transform: `translateY(${virtualRow.start}px)`,
							}}
						>
							{row.type === 'directory' ? (
								<WorkspaceFolderRow
									isExpanded={row.isExpanded}
									isIgnored={row.isIgnored}
									labelParts={row.labelParts}
									level={row.level}
									node={row.node}
									onToggle={handleDirectoryToggle}
								/>
							) : (
								<WorkspaceFileRow
									file={row.file}
									level={row.level}
									openFilePreview={openFilePreview}
								/>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>{listBody}</ContextMenuTrigger>
			{hasMenu ? (
				<AllFilesContextMenuContent
					copyTarget={copyTarget}
					invokeTarget={invokeTarget}
					openFilePreview={openFilePreview}
					openInTargets={openInTargets}
					target={menuTarget}
				/>
			) : null}
		</ContextMenu>
	);
}

/** Folder row with a collapse chevron, folder icon, and compacted label. */
const WorkspaceFolderRow = memo(
	function WorkspaceFolderRow({
		isExpanded,
		isIgnored,
		labelParts,
		level,
		node,
		onToggle,
	}: {
		isExpanded: boolean;
		isIgnored: boolean;
		labelParts: string[];
		level: number;
		node: FileTreeNode<WorkspaceFileSummary>;
		onToggle: (
			node: FileTreeNode<WorkspaceFileSummary>,
			willExpand: boolean,
		) => void;
	}) {
		const { t } = useTranslation();
		const isCollapsed = !isExpanded;
		const FolderChevronIcon = isCollapsed ? ChevronRightIcon : ChevronDownIcon;
		// A collapsed row only advertises its own name; the merged `a / b / c` chain
		// is shown once expanded, when its single-child descendants are revealed.
		const visibleLabelParts = isCollapsed ? labelParts.slice(0, 1) : labelParts;
		const folderIconName = getWorkspaceFileIconName(
			{ kind: 'directory', name: visibleLabelParts.at(-1) ?? node.path },
			{ isExpanded: !isCollapsed },
		);

		return (
			<Button
				aria-expanded={!isCollapsed}
				aria-label={
					isCollapsed
						? t('workbench:file-tree.expand-folder', 'Expand {{path}}', {
								path: node.path,
							})
						: t('workbench:file-tree.collapse-folder', 'Collapse {{path}}', {
								path: node.path,
							})
				}
				aria-level={level + 1}
				// Highlight only on hover: drop the ghost variant's persistent
				// open-state fill (`aria-expanded:bg-muted`) while keeping the hover
				// fill for expanded folders.
				className={cn(
					'h-7 w-full justify-start gap-1.5 rounded-md px-2 text-xs aria-expanded:bg-transparent aria-expanded:hover:bg-muted',
					fileTreeIndentClassName(level),
					// Git-ignored folders stay visible but dimmed, VS Code style.
					isIgnored && 'opacity-50',
				)}
				data-row-kind='directory'
				data-row-path={node.path}
				onClick={() => onToggle(node, isCollapsed)}
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
	},
	// Custom comparator: `flattenFileTree` allocates a fresh `labelParts` array
	// every pass, so a default shallow compare would re-render every visible
	// folder on each toggle. We compare its contents instead. NOTE: this lists
	// every prop explicitly — when adding a prop to this component, add it here
	// too, or memo will silently skip renders on stale props.
	(previous, next) =>
		previous.isExpanded === next.isExpanded &&
		previous.isIgnored === next.isIgnored &&
		previous.level === next.level &&
		previous.node === next.node &&
		previous.onToggle === next.onToggle &&
		previous.labelParts.length === next.labelParts.length &&
		previous.labelParts.every((part, index) => part === next.labelParts[index]),
);

/** Clickable row that opens a workspace file in the preview pane. */
const WorkspaceFileRow = memo(function WorkspaceFileRow({
	file,
	level,
	openFilePreview,
}: {
	file: WorkspaceFileSummary;
	level: number;
	openFilePreview: ReviewFilePreviewOpener | null;
}) {
	const { t } = useTranslation();

	return (
		<Button
			aria-label={t(
				'workbench:all-files.open-preview',
				'Open {{path}} preview',
				{
					path: file.path,
				},
			)}
			aria-level={level + 1}
			className={cn(
				'h-7 w-full justify-start gap-1.5 rounded-md px-2 py-0.5 text-left font-normal',
				fileTreeIndentClassName(level),
				// Git-ignored entries stay visible but dimmed, VS Code style.
				file.isIgnored && 'opacity-50',
			)}
			data-row-kind='file'
			data-row-path={file.path}
			onClick={openFilePreview ? () => openFilePreview(file.path) : undefined}
			onDoubleClick={
				openFilePreview
					? () => openFilePreview(file.path, { preview: false })
					: undefined
			}
			role='treeitem'
			size='sm'
			variant='ghost'
		>
			<span aria-hidden='true' className='size-3 shrink-0' />
			<Icon
				aria-hidden='true'
				className='size-3.5 shrink-0'
				icon={getWorkspaceFileIconName(file)}
			/>
			<span className='min-w-0 truncate font-mono text-xs leading-none'>
				{file.name}
			</span>
		</Button>
	);
});
