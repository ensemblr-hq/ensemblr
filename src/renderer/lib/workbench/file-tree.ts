/** A directory node in a workspace file tree: nested directories plus files. */
export interface FileTreeNode<TFile> {
	directories: FileTreeNode<TFile>[];
	files: TFile[];
	name: string;
	path: string;
}

interface MutableFileTreeNode<TFile> extends FileTreeNode<TFile> {
	directoryMap: Map<string, MutableFileTreeNode<TFile>>;
}

/** Minimal shape required to place an entry in the tree. */
interface FileTreeEntry {
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
			ensureDirectoryNode(root, parts);
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

/** Maps a tree depth to the matching Tailwind left-padding class. */
export function fileTreeIndentClassName(level: number): string {
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
