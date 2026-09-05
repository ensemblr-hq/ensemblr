import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual';
import { useAtomValue } from 'jotai';
import {
	type MouseEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';

import { useFileTreeExpansion } from '@/renderer/hooks/workbench-shell/review-files/use-file-tree-expansion';
import { useLazyIgnoredDirectories } from '@/renderer/hooks/workbench-shell/review-files/use-lazy-ignored-directories';
import { toWorkspaceLookupPath } from '@/renderer/lib/agent-timeline';
import {
	buildFileTree,
	flattenFileTree,
	listDirectoryPaths,
} from '@/renderer/lib/workbench';
import { workspaceDirectoryRevealRequestAtom } from '@/renderer/state/workspace';
import type {
	FileTreeMenuTarget,
	FileTreeNode,
	WorkspaceFileSummary,
} from '@/renderer/types/workbench';

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

/**
 * Lists a directory path plus its parents, outermost first.
 * @param path - Workspace-relative directory path.
 * @returns Ancestor paths ending with the requested directory.
 */
function directoryPathAndAncestors(path: string): string[] {
	const parts = path.split('/').filter(Boolean);
	return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
}

/**
 * Finds a directory node in the tree by workspace-relative path.
 * @param node - Tree node to search from.
 * @param path - Directory path to find.
 * @returns The matching node, if present.
 */
function findDirectoryNode(
	node: FileTreeNode<WorkspaceFileSummary>,
	path: string,
): FileTreeNode<WorkspaceFileSummary> | null {
	if (node.path === path) {
		return node;
	}
	for (const directory of node.directories) {
		const found = findDirectoryNode(directory, path);
		if (found) {
			return found;
		}
	}
	return null;
}

/**
 * Whether a directory node is an ignored folder the main process left collapsed,
 * so its children still have to be fetched before it can be shown open.
 * @param node - The directory node about to expand
 * @returns True when the node is ignored and carries no enumerated children
 */
function needsLazyLoad(node: FileTreeNode<WorkspaceFileSummary>): boolean {
	return Boolean(
		node.isIgnored && node.directories.length === 0 && node.files.length === 0,
	);
}

/**
 * Folder expansion state, plus the pending "reveal this directory" request that
 * drives it: the target and its ancestors are expanded, an ignored folder's
 * children are lazily loaded when the target has none, and the path is recorded
 * for the scroll pass that follows.
 *
 * A request marked `exclusive` closes everything else — the architecture
 * diagram asks for that, because a node pointing at one directory in a tree of
 * hundreds is only useful if that directory is the one thing the user can see
 * when they arrive. Every other reveal only opens, so clicking a file path in a
 * tool result does not collapse the folders the user opened themselves.
 *
 * Expansion is owned here rather than passed in so the reveal effect drives its
 * own state instead of calling back out to its caller's.
 * @param input - The tree, its known directory paths, and the lazy loader
 * @returns The expansion controls and the path still waiting to be scrolled to
 */
function useDirectoryReveal({
	knownDirectoryPaths,
	knownDirectoryPathSet,
	loadIgnoredDirectory,
	tree,
	workspaceCwd,
	workspaceId,
}: {
	knownDirectoryPaths: string[];
	knownDirectoryPathSet: ReadonlySet<string>;
	loadIgnoredDirectory: (directoryPath: string) => void;
	tree: FileTreeNode<WorkspaceFileSummary>;
	workspaceCwd: string;
	workspaceId: string;
}) {
	// Folders start collapsed: the full repo tree would be overwhelming if every
	// directory rendered open.
	const { expandDirectories, isExpanded, revealOnly, toggleDirectory } =
		useFileTreeExpansion(false, knownDirectoryPaths);
	const revealRequest = useAtomValue(workspaceDirectoryRevealRequestAtom);
	const handledRevealRequestIdRef = useRef<number | null>(null);
	const pendingRevealPathRef = useRef<string | null>(null);

	useEffect(() => {
		if (
			!revealRequest ||
			revealRequest.workspaceId !== workspaceId ||
			handledRevealRequestIdRef.current === revealRequest.id
		) {
			return;
		}
		const directoryPath = toWorkspaceLookupPath(
			revealRequest.path,
			workspaceCwd,
		);
		if (!knownDirectoryPathSet.has(directoryPath)) {
			return;
		}
		handledRevealRequestIdRef.current = revealRequest.id;
		const chain = directoryPathAndAncestors(directoryPath).filter((path) =>
			knownDirectoryPathSet.has(path),
		);
		if (revealRequest.exclusive) {
			revealOnly(chain);
		} else {
			expandDirectories(chain);
		}
		pendingRevealPathRef.current = directoryPath;
		const directoryNode = findDirectoryNode(tree, directoryPath);
		if (directoryNode && needsLazyLoad(directoryNode)) {
			loadIgnoredDirectory(directoryPath);
		}
	}, [
		expandDirectories,
		knownDirectoryPathSet,
		loadIgnoredDirectory,
		revealOnly,
		revealRequest,
		tree,
		workspaceCwd,
		workspaceId,
	]);

	return { isExpanded, pendingRevealPathRef, toggleDirectory };
}

/**
 * Tracks which row a right-click landed on so one shared context menu can serve
 * every row, and swallows a right-click that landed below the last row rather
 * than opening an empty menu.
 * @returns The row the menu should act on, and the capture handler that sets it
 */
function useFileTreeContextMenu() {
	const [menuTarget, setMenuTarget] = useState<FileTreeMenuTarget | null>(null);

	const handleContextCapture = useCallback(
		(event: MouseEvent<HTMLDivElement>) => {
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
		[],
	);

	return { handleContextCapture, menuTarget };
}

/**
 * Scrolls a freshly revealed directory into view once its row exists, which only
 * happens after the expand that created it has flushed.
 * @param pendingRevealPathRef - Path awaiting a scroll, cleared once served
 * @param rows - The currently visible rows
 * @param virtualizer - Virtualizer owning the scroll position
 */
function useScrollToRevealedDirectory(
	pendingRevealPathRef: { current: string | null },
	rows: ReturnType<typeof flattenFileTree<WorkspaceFileSummary>>,
	virtualizer: Virtualizer<HTMLDivElement, Element>,
): void {
	useEffect(() => {
		const pendingPath = pendingRevealPathRef.current;
		if (!pendingPath) {
			return;
		}
		const rowIndex = rows.findIndex(
			(row) => row.type === 'directory' && row.node.path === pendingPath,
		);
		if (rowIndex < 0) {
			return;
		}
		pendingRevealPathRef.current = null;
		virtualizer.scrollToIndex(rowIndex, { align: 'center' });
	}, [pendingRevealPathRef, rows, virtualizer]);
}

/**
 * The workspace file tree's whole model: the merged file list including lazily
 * loaded ignored folders, the built tree flattened to visible rows, expansion
 * and reveal handling, and the shared right-click menu target.
 * @param files - The workspace's enumerated files
 * @param workspaceCwd - Absolute workspace path directory reads resolve against
 * @param workspaceId - Workspace the reveal requests are scoped to
 * @returns The rows to render plus the handlers the tree binds to
 */
export function useWorkspaceFileTree({
	files,
	workspaceCwd,
	workspaceId,
}: {
	files: WorkspaceFileSummary[];
	workspaceCwd: string;
	workspaceId: string;
}) {
	const { allFiles, loadIgnoredDirectory } = useLazyIgnoredDirectories({
		files,
		workspaceCwd,
	});

	const tree = useMemo(() => buildFileTree(allFiles), [allFiles]);
	const knownDirectoryPaths = useMemo(() => listDirectoryPaths(tree), [tree]);
	const knownDirectoryPathSet = useMemo(
		() => new Set(knownDirectoryPaths),
		[knownDirectoryPaths],
	);
	const { isExpanded, pendingRevealPathRef, toggleDirectory } =
		useDirectoryReveal({
			knownDirectoryPaths,
			knownDirectoryPathSet,
			loadIgnoredDirectory,
			tree,
			workspaceCwd,
			workspaceId,
		});

	// Only the currently visible rows; collapsed subtrees are skipped, so this
	// recomputes cheaply on every toggle and feeds the virtualizer directly.
	const rows = useMemo(
		() => flattenFileTree(tree, isExpanded),
		[tree, isExpanded],
	);

	// `willExpand` comes from the row (which already knows its open state) so this
	// stays free of `isExpanded`, keeping a stable identity across toggles — a
	// prerequisite for the memoized rows to actually skip re-rendering.
	const handleDirectoryToggle = useCallback(
		(node: FileTreeNode<WorkspaceFileSummary>, willExpand: boolean) => {
			toggleDirectory(node.path);
			// On first expand of an ignored directory left collapsed by the main
			// process (no enumerated children), fetch its contents lazily.
			if (willExpand && needsLazyLoad(node)) {
				loadIgnoredDirectory(node.path);
			}
		},
		[toggleDirectory, loadIgnoredDirectory],
	);

	const { handleContextCapture, menuTarget } = useFileTreeContextMenu();

	const scrollRef = useRef<HTMLDivElement>(null);
	const virtualizer = useVirtualizer({
		count: rows.length,
		estimateSize: () => ROW_HEIGHT,
		getScrollElement: () => scrollRef.current,
		initialRect: { height: INITIAL_VIEWPORT_HEIGHT, width: 0 },
		overscan: ROW_OVERSCAN,
	});
	useScrollToRevealedDirectory(pendingRevealPathRef, rows, virtualizer);

	return {
		handleContextCapture,
		handleDirectoryToggle,
		menuTarget,
		rows,
		scrollRef,
		virtualizer,
	};
}
