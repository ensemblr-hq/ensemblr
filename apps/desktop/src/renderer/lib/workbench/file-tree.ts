import type { CSSProperties } from 'react';

import type { FileTreeNode, FlatFileTreeRow } from '@/renderer/types/workbench';

/** File-tree node augmented with a directory lookup map for fast child access while the tree is being built. */
interface MutableFileTreeNode<TFile> extends FileTreeNode<TFile> {
	directoryMap: Map<string, MutableFileTreeNode<TFile>>;
}

/** Minimal shape required to place an entry in the tree. */
interface FileTreeEntry {
	isIgnored?: boolean;
	kind?: 'directory' | 'file';
	path: string;
}

/**
 * Builds a directory tree from a flat list of path-bearing entries.
 *
 * Entries whose `kind` is `'directory'` create (possibly empty) folder nodes;
 * every other entry is treated as a file and attached to its parent directory.
 * Missing ancestor directories are created on demand, so a files-only list
 * (e.g. changed files with no explicit directory rows) still yields a full
 * tree.
 * @param entries - Flat file/directory rows with repo-relative `/` paths.
 * @returns The root node; its own `name`/`path` are empty strings.
 */
export function buildFileTree<TFile extends FileTreeEntry>(
	entries: readonly TFile[],
): FileTreeNode<TFile> {
	const root = createFileTreeNode<TFile>('', '');

	for (const entry of entries) {
		const parts = entry.path.split('/').filter(Boolean);

		if (parts.length === 0) {
			continue;
		}

		if (entry.kind === 'directory') {
			const directoryNode = ensureDirectoryNode(root, parts);
			// Tag the leaf directory ignored; ancestors synthesized for tracked
			// files stay normal so only the ignored folder itself dims.
			if (entry.isIgnored) {
				directoryNode.isIgnored = true;
			}
			continue;
		}

		const parentNode = ensureDirectoryNode(root, parts.slice(0, -1));
		parentNode.files.push(entry);
	}

	sortFileTreeNode(root);

	return root;
}

/**
 * Recursively orders a node's children: directories alphabetically by name,
 * files alphabetically by path. Sorting by path (not name) keeps the function
 * usable for entries that carry no `name` field. Mutates the freshly built,
 * not-yet-returned nodes in place.
 * @param node - Node whose subtree should be ordered.
 */
function sortFileTreeNode<TFile extends FileTreeEntry>(
	node: FileTreeNode<TFile>,
): void {
	node.directories.sort((a, b) => a.name.localeCompare(b.name));
	node.files.sort((a, b) => a.path.localeCompare(b.path));

	for (const directory of node.directories) {
		sortFileTreeNode(directory);
	}
}

/**
 * Collects every directory path in the tree (depth-first). Lets callers prune
 * stale expansion state when the underlying file list changes, since toggle
 * keys are always a subset of these paths.
 * @param node - Tree node to walk from.
 * @returns Every descendant directory path.
 */
export function listDirectoryPaths<TFile>(node: FileTreeNode<TFile>): string[] {
	const paths: string[] = [];

	for (const directory of node.directories) {
		paths.push(directory.path, ...listDirectoryPaths(directory));
	}

	return paths;
}

/**
 * Walks the directory chain named by `parts`, creating nodes as needed.
 * @param root - Tree root to walk from.
 * @param parts - Directory segment names, outermost first.
 * @returns The deepest node in the chain (the root when `parts` is empty).
 */
function ensureDirectoryNode<TFile>(
	root: MutableFileTreeNode<TFile>,
	parts: readonly string[],
): MutableFileTreeNode<TFile> {
	let currentNode = root;

	for (const directoryName of parts) {
		const directoryPath = currentNode.path
			? `${currentNode.path}/${directoryName}`
			: directoryName;
		let nextNode = currentNode.directoryMap.get(directoryName);

		if (!nextNode) {
			nextNode = createFileTreeNode<TFile>(directoryName, directoryPath);
			currentNode.directoryMap.set(directoryName, nextNode);
			currentNode.directories.push(nextNode);
		}

		currentNode = nextNode;
	}

	return currentNode;
}

/** Constructs an empty mutable tree node for a directory. */
function createFileTreeNode<TFile>(
	name: string,
	path: string,
): MutableFileTreeNode<TFile> {
	return {
		directories: [],
		directoryMap: new Map(),
		files: [],
		name,
		path,
	};
}

/**
 * Collapses chains of single-child directories so the tree shows `a/b/c` as one
 * row instead of three.
 * @param node - Starting directory node.
 * @returns The deepest reachable node plus the merged label segments.
 */
export function getCompactFileDirectory<TFile>(node: FileTreeNode<TFile>): {
	labelParts: string[];
	node: FileTreeNode<TFile>;
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

/**
 * Flattens a tree into the ordered list of currently *visible* rows so callers
 * can virtualize them instead of mounting one component per node.
 *
 * Mirrors the recursive render exactly: directories precede files at each level,
 * single-child chains are compacted (`a/b/c` as one row), and a directory's
 * descendants are emitted only when `isExpanded` reports its compacted path
 * open. Collapsed subtrees are skipped, so the walk costs O(visible rows), not
 * O(tree).
 * @param root - Root node from {@link buildFileTree}.
 * @param isExpanded - Reports whether a directory path is currently expanded.
 * @returns Visible rows in render order.
 */
export function flattenFileTree<TFile extends FileTreeEntry>(
	root: FileTreeNode<TFile>,
	isExpanded: (path: string) => boolean,
): FlatFileTreeRow<TFile>[] {
	const rows: FlatFileTreeRow<TFile>[] = [];

	const walk = (node: FileTreeNode<TFile>, level: number): void => {
		const setSize = node.directories.length + node.files.length;

		for (const [index, directory] of node.directories.entries()) {
			const { labelParts, node: compactNode } =
				getCompactFileDirectory(directory);
			const expanded = isExpanded(compactNode.path);

			rows.push({
				isExpanded: expanded,
				isIgnored: compactNode.isIgnored ?? false,
				key: compactNode.path,
				labelParts,
				level,
				node: compactNode,
				posInSet: index + 1,
				setSize,
				type: 'directory',
			});

			if (expanded) {
				walk(compactNode, level + 1);
			}
		}

		for (const [index, file] of node.files.entries()) {
			rows.push({
				file,
				key: file.path,
				level,
				posInSet: node.directories.length + index + 1,
				setSize,
				type: 'file',
			});
		}
	};

	walk(root, 0);

	return rows;
}

/** Spacing steps of left padding a nested row starts from before any depth is added. */
const FILE_TREE_BASE_INDENT_STEPS = 2;

/** Spacing steps each level of depth adds to a row's left padding. */
const FILE_TREE_LEVEL_INDENT_STEPS = 4;

/**
 * Indents a file-tree row by one fixed step per level of depth, with no cap, so
 * a child always sits right of its parent however deep the tree goes. It is an
 * inline style rather than a class because the depth is unbounded and Tailwind
 * only generates the classes it finds spelled out in source.
 * @param level - Zero-based depth of the row in the tree.
 * @returns The padding for a nested row, or undefined at the root so the row
 * keeps the padding its own classes give it.
 */
export function fileTreeIndentStyle(level: number): CSSProperties | undefined {
	if (level <= 0) {
		return undefined;
	}

	const steps =
		FILE_TREE_BASE_INDENT_STEPS + FILE_TREE_LEVEL_INDENT_STEPS * level;

	return { paddingLeft: `calc(var(--spacing) * ${steps})` };
}
