import { Icon } from '@iconify/react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import {
	Fragment,
	type MouseEvent,
	memo,
	useCallback,
	useMemo,
	useRef,
	useState,
} from 'react';

import { readWorkspaceDirectory } from '@/renderer/api/ensemble-queries';
import { Button } from '@/renderer/components/ui/button';
import {
	ContextMenu,
	ContextMenuTrigger,
} from '@/renderer/components/ui/context-menu';
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
	flattenFileTree,
	getWorkspaceFileIconName,
	listDirectoryPaths,
} from '@/renderer/lib/workbench';
import type { WorkspaceFileSummary } from '@/renderer/types/workbench';

import {
	AllFilesContextMenuContent,
	type FileTreeMenuTarget,
} from './all-files-context-menu';

/** Fixed row height (px). Rows are single-line (truncated), so heights are uniform. */
const ROW_HEIGHT = 28;
/** Extra rows rendered above/below the viewport to keep scrolling smooth. */
const ROW_OVERSCAN = 12;
/**
 * Assumed viewport height before the scroll element is measured. Lets the very
 * first render (and SSR/static markup in tests) emit rows instead of an empty
 * pane that fills in a frame later; the real height takes over once mounted.
 */
const INITIAL_VIEWPORT_HEIGHT = 1200;

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
	if (!files.length) {
		return (
			<div className='p-2.5'>
				<p className='rounded-md border border-border bg-pane px-3 py-4 text-muted-foreground text-xs leading-5'>
					Repository files will appear here when the workspace file service is
					wired.
				</p>
			</div>
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
	const { invokeTarget, openTargets } = useOpenTargets({ workspaceId });

	// Children of ignored directories the main process left collapsed (e.g.
	// node_modules), fetched one level per expand and merged into the flat list
	// so the tree can browse any folder regardless of size.
	//
	// Known limitation: these lazily-fetched entries are local state, not part of
	// the `files` query, so they are NOT live-refreshed by the fs watcher or the
	// poll (which the watcher deliberately ignores for `node_modules` anyway).
	// An ignored folder expanded here shows a point-in-time snapshot until the
	// workspace remounts (`key={workspaceCwd}` on the tree). Acceptable: ignored
	// dirs rarely need live tracking, and `loadedDirsRef` prevents refetch churn.
	const [lazyChildren, setLazyChildren] = useState<WorkspaceFileSummary[]>([]);
	const loadedDirsRef = useRef<Set<string>>(new Set());

	const allFiles = useMemo(() => {
		if (lazyChildren.length === 0) {
			return files;
		}
		// Drop any lazily-fetched child already present in the base list: a path
		// in both would otherwise yield duplicate rows, since `buildFileTree`
		// pushes files without de-duping.
		const basePaths = new Set(files.map((entry) => entry.path));
		const extra = lazyChildren.filter((entry) => !basePaths.has(entry.path));
		return extra.length > 0 ? [...files, ...extra] : files;
	}, [files, lazyChildren]);
	const tree = useMemo(() => buildFileTree(allFiles), [allFiles]);
	const knownDirectoryPaths = useMemo(() => listDirectoryPaths(tree), [tree]);
	// Folders start collapsed: the full repo tree would be overwhelming if every
	// directory rendered open.
	const { isExpanded, toggleDirectory } = useFileTreeExpansion(
		false,
		knownDirectoryPaths,
	);

	// Only the currently visible rows; collapsed subtrees are skipped, so this
	// recomputes cheaply on every toggle and feeds the virtualizer directly.
	const rows = useMemo(
		() => flattenFileTree(tree, isExpanded),
		[tree, isExpanded],
	);

	const loadIgnoredDirectory = useCallback(
		async (directoryPath: string) => {
			if (!workspaceCwd || loadedDirsRef.current.has(directoryPath)) {
				return;
			}
			loadedDirsRef.current.add(directoryPath);
			const result = await readWorkspaceDirectory({
				path: directoryPath,
				workspaceCwd,
			});
			if (result.error) {
				// Let a later expand retry.
				loadedDirsRef.current.delete(directoryPath);
				return;
			}
			setLazyChildren((previous) => {
				const seen = new Set(previous.map((entry) => entry.path));
				const additions = result.entries
					.filter((entry) => !seen.has(entry.path))
					.map((entry) => ({
						id: `wsfile:${entry.path}`,
						isIgnored: entry.isIgnored,
						kind: entry.kind,
						name: entry.name,
						path: entry.path,
					}));
				return additions.length > 0 ? [...previous, ...additions] : previous;
			});
		},
		[workspaceCwd],
	);

	// `willExpand` comes from the row (which already knows its open state) so this
	// stays free of `isExpanded`, keeping a stable identity across toggles — a
	// prerequisite for the memoized rows below to actually skip re-rendering.
	const handleDirectoryToggle = useCallback(
		(node: FileTreeNode<WorkspaceFileSummary>, willExpand: boolean) => {
			toggleDirectory(node.path);
			// On first expand of an ignored directory left collapsed by the main
			// process (no enumerated children), fetch its contents lazily.
			if (
				willExpand &&
				node.isIgnored &&
				node.directories.length === 0 &&
				node.files.length === 0
			) {
				void loadIgnoredDirectory(node.path);
			}
		},
		[toggleDirectory, loadIgnoredDirectory],
	);

	// Resolve the open-in targets once for the whole tree instead of filtering
	// per row on every render.
	const openInTargets = useMemo(
		() =>
			(openTargets ?? []).filter((target) => target.behavior !== 'copy-path'),
		[openTargets],
	);
	const copyTarget = useMemo(
		() => (openTargets ?? []).find((target) => target.behavior === 'copy-path'),
		[openTargets],
	);
	const hasMenu = openInTargets.length > 0 || Boolean(copyTarget);

	const [menuTarget, setMenuTarget] = useState<FileTreeMenuTarget | null>(null);
	const handleContextCapture = useCallback(
		(event: MouseEvent<HTMLDivElement>) => {
			if (!hasMenu) {
				return;
			}
			const rowElement = (event.target as HTMLElement).closest<HTMLElement>(
				'[data-row-path]',
			);
			if (!rowElement?.dataset.rowPath) {
				// Right-click landed below the rows: don't open an empty menu.
				event.preventDefault();
				event.stopPropagation();
				return;
			}
			setMenuTarget({
				relativePath: rowElement.dataset.rowPath,
				relativePathKind:
					rowElement.dataset.rowKind === 'directory' ? 'directory' : 'file',
			});
		},
		[hasMenu],
	);

	const scrollRef = useRef<HTMLDivElement>(null);
	const virtualizer = useVirtualizer({
		count: rows.length,
		estimateSize: () => ROW_HEIGHT,
		getScrollElement: () => scrollRef.current,
		initialRect: { height: INITIAL_VIEWPORT_HEIGHT, width: 0 },
		overscan: ROW_OVERSCAN,
	});

	const listBody = (
		<div
			className='h-full overflow-y-auto p-2.5'
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
				aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${node.path}`}
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
	return (
		<Button
			aria-label={`Open ${file.path} preview`}
			aria-level={level + 1}
			className={cn(
				'h-7 w-full justify-start gap-2.5 rounded-md px-2 py-0.5 text-left font-normal',
				fileTreeIndentClassName(level),
				// Git-ignored entries stay visible but dimmed, VS Code style.
				file.isIgnored && 'opacity-50',
			)}
			data-row-kind='file'
			data-row-path={file.path}
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
	);
});
