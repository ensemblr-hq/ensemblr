/**
 * Scans a workspace's source tree into a directory-level module graph.
 *
 * Nodes are directories rather than files: a repository's concern folders are
 * the granularity a human reasons about, and a file-level graph of a real
 * codebase is thousands of nodes nobody can read. Edges are cross-directory
 * import relationships, weighted by how many files carry them.
 *
 * The fingerprint is the whole cost-control story. It hashes the *topology* —
 * which nodes exist and which edges connect them — and nothing else, so editing
 * a function body leaves it unchanged and the rebuild downstream is skipped.
 */
import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

/** One directory in the graph, with the traffic through it. */
export interface ModuleGraphNode {
	/** How many files in the tree import something from this directory. */
	fanIn: number;
	/** How many other directories this one imports from. */
	fanOut: number;
	/** How many source files it holds, at any depth below the aggregation cap. */
	fileCount: number;
	/** Path depth, 0 for the repository root. */
	depth: number;
	/** Workspace-relative directory path; `.` for the root. */
	id: string;
}

/** One directed import relationship between two directories. */
export interface ModuleGraphEdge {
	from: string;
	to: string;
	/** How many distinct files carry this relationship. */
	weight: number;
}

/** A scanned module graph plus the hash of its topology. */
export interface ModuleGraph {
	edges: readonly ModuleGraphEdge[];
	/** Stable hash of the node ids and edges; equal hashes mean equal shape. */
	fingerprint: string;
	nodes: readonly ModuleGraphNode[];
	/** Directories dropped to stay inside {@link SCAN_LIMITS.maxNodes}, if any. */
	omittedNodeCount: number;
	/** Files read; reported so a scan that hit a cap can say so. */
	scannedFileCount: number;
}

/**
 * Directory names never descended into: build output, dependencies, vendored
 * trees. Every dot-directory is skipped separately, which covers `.git`,
 * `.vite`, `.next`, and the tool folders alongside them.
 */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
	'__pycache__',
	'build',
	'coverage',
	'dist',
	'node_modules',
	'out',
	'target',
	'vendor',
]);

/** File extensions the import scanner understands. */
const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
	'.cjs',
	'.cts',
	'.js',
	'.jsx',
	'.mjs',
	'.mts',
	'.ts',
	'.tsx',
]);

/** Bounds that keep a scan of an unexpectedly large repository finite. */
export const SCAN_LIMITS = {
	/** Aggregation depth: `src/main/agent-runtime/x.ts` collapses to `src/main/agent-runtime`. */
	maxDepth: 3,
	/** Largest source file read; anything bigger is generated or vendored. */
	maxFileBytes: 512 * 1024,
	/** Most files read in one scan. */
	maxFiles: 20_000,
	/** Most nodes kept; the busiest survive and the rest are reported as omitted. */
	maxNodes: 48,
} as const;

/**
 * How many files are read at once. Reading them one after another spends the
 * whole scan waiting on the disk, and reading all of them at once exhausts the
 * process's file descriptors on a repository of any size.
 */
const READ_BATCH_SIZE = 64;

/**
 * Every way a module specifier appears in JavaScript or TypeScript source:
 * static `import`/`export … from`, bare side-effect `import`, dynamic
 * `import()`, and CommonJS `require()`. Deliberately a regex rather than a
 * parser — the graph needs specifiers, not an AST, and a parse failure on one
 * exotic file must not cost the whole scan.
 */
const SPECIFIER_PATTERNS: readonly RegExp[] = [
	/(?:^|[\s;}])(?:import|export)\s[\s\S]*?\sfrom\s*['"]([^'"]+)['"]/g,
	/(?:^|[\s;}])import\s*['"]([^'"]+)['"]/g,
	/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
	/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/**
 * Collapses a workspace-relative file path to the directory that stands for it,
 * capped at {@link SCAN_LIMITS.maxDepth} segments.
 * @param relativeFilePath - Path of the file, relative to the workspace root
 * @returns The node id the file belongs to
 */
export function moduleIdForFile(relativeFilePath: string): string {
	const segments = relativeFilePath.split(/[\\/]/).slice(0, -1);
	if (segments.length === 0) {
		return '.';
	}
	return segments.slice(0, SCAN_LIMITS.maxDepth).join('/');
}

/**
 * Extracts every module specifier a source file references.
 * @param source - The file's text
 * @returns Specifiers in source order, with duplicates kept
 */
export function extractSpecifiers(source: string): readonly string[] {
	const specifiers: string[] = [];
	for (const pattern of SPECIFIER_PATTERNS) {
		pattern.lastIndex = 0;
		for (const match of source.matchAll(pattern)) {
			const specifier = match[1];
			if (specifier) {
				specifiers.push(specifier);
			}
		}
	}
	return specifiers;
}

/**
 * Resolves a relative specifier to the workspace-relative file path it names,
 * with extension and `/index` guessing left to the caller — the graph only
 * needs the directory, so an unresolvable extension changes nothing.
 * @param fromFile - Workspace-relative path of the importing file
 * @param specifier - The specifier as written
 * @returns The workspace-relative target path, or null when it leaves the repo
 */
function resolveRelativeSpecifier(
	fromFile: string,
	specifier: string,
): string | null {
	if (!specifier.startsWith('.')) {
		return null;
	}
	const resolved = path.normalize(path.join(path.dirname(fromFile), specifier));
	return resolved.startsWith('..') ? null : resolved;
}

/**
 * Resolves an alias specifier — `@/renderer/lib/x` — to a workspace-relative
 * path, so this repository's own `@/*` imports land on the right node instead
 * of being dropped as external.
 * @param specifier - The specifier as written
 * @param aliasRoots - Alias prefix → workspace-relative directory
 * @returns The workspace-relative target path, or null when no alias matches
 */
function resolveAliasSpecifier(
	specifier: string,
	aliasRoots: ReadonlyMap<string, string>,
): string | null {
	for (const [prefix, root] of aliasRoots) {
		if (specifier.startsWith(prefix)) {
			return path.normalize(path.join(root, specifier.slice(prefix.length)));
		}
	}
	return null;
}

/**
 * Reads the `compilerOptions.paths` aliases out of a workspace's `tsconfig.json`
 * so alias imports resolve to real directories. Comment-tolerant, because a
 * tsconfig is JSON with comments in practice; an unreadable one simply yields
 * no aliases.
 * @param workspaceCwd - Absolute path of the workspace root
 * @returns Alias prefix → workspace-relative directory
 */
async function readPathAliases(
	workspaceCwd: string,
): Promise<ReadonlyMap<string, string>> {
	const aliases = new Map<string, string>();
	try {
		const raw = await readFile(
			path.join(workspaceCwd, 'tsconfig.json'),
			'utf8',
		);
		const withoutComments = raw
			.replaceAll(/\/\*[\s\S]*?\*\//g, '')
			.replaceAll(/(^|[^:])\/\/.*$/gm, '$1');
		const parsed = JSON.parse(withoutComments) as {
			compilerOptions?: { paths?: Record<string, string[]> };
		};
		for (const [pattern, targets] of Object.entries(
			parsed.compilerOptions?.paths ?? {},
		)) {
			const target = targets[0];
			if (!pattern.endsWith('/*') || !target?.endsWith('/*')) {
				continue;
			}
			aliases.set(
				pattern.slice(0, -1),
				path.normalize(target.slice(0, -2).replace(/^\.\//, '')),
			);
		}
	} catch {
		// A workspace without a readable tsconfig simply has no aliases; the
		// graph still resolves every relative import.
	}
	return aliases;
}

/** One source file found by the walk. */
interface ScannedFile {
	absolutePath: string;
	relativePath: string;
}

/**
 * Walks the workspace collecting source files, skipping the directories in
 * {@link SKIPPED_DIRECTORIES} and stopping at {@link SCAN_LIMITS.maxFiles}.
 * @param workspaceCwd - Absolute path of the workspace root
 * @returns The source files found, in walk order
 */
async function collectSourceFiles(
	workspaceCwd: string,
): Promise<readonly ScannedFile[]> {
	const files: ScannedFile[] = [];
	const queue: string[] = [workspaceCwd];
	while (queue.length > 0 && files.length < SCAN_LIMITS.maxFiles) {
		const directory = queue.shift() as string;
		for (const entry of await readEntries(directory)) {
			const absolutePath = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				if (isWalkableDirectory(entry.name)) {
					queue.push(absolutePath);
				}
			} else if (isSourceFile(entry)) {
				files.push({
					absolutePath,
					relativePath: path.relative(workspaceCwd, absolutePath),
				});
			}
			if (files.length >= SCAN_LIMITS.maxFiles) {
				break;
			}
		}
	}
	return files;
}

/**
 * Reads one directory, answering with nothing when it cannot be read. A
 * permission-denied folder costs that folder's nodes, not the whole scan.
 * @param directory - Absolute path to read
 * @returns Its entries, or an empty list
 */
async function readEntries(directory: string): Promise<readonly Dirent[]> {
	try {
		return await readdir(directory, { withFileTypes: true });
	} catch {
		return [];
	}
}

/**
 * True when the walk should descend into a directory.
 * @param name - The directory's own name, not its path
 * @returns True for a directory that can hold first-party source
 */
function isWalkableDirectory(name: string): boolean {
	return !name.startsWith('.') && !SKIPPED_DIRECTORIES.has(name);
}

/**
 * True when an entry is a source file the import scanner understands.
 * @param entry - A directory entry from the walk
 * @returns True for a readable file with a source extension
 */
function isSourceFile(entry: Dirent): boolean {
	return entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name));
}

/**
 * Hashes a graph's topology. Node ids and edges are sorted first, so the same
 * shape scanned twice hashes the same regardless of walk order, and only a
 * genuine structural change moves it.
 * @param nodeIds - Every node id in the graph
 * @param edges - Every edge in the graph
 * @returns A hex digest of the topology
 */
export function fingerprintTopology(
	nodeIds: readonly string[],
	edges: readonly ModuleGraphEdge[],
): string {
	const hash = createHash('sha256');
	for (const id of [...nodeIds].sort()) {
		hash.update(`n:${id}\n`);
	}
	for (const edge of [...edges]
		.map((edge) => `e:${edge.from}>${edge.to}`)
		.sort()) {
		hash.update(`${edge}\n`);
	}
	return hash.digest('hex');
}

/**
 * Scans a workspace into a module graph.
 *
 * Every file is read once; a file that cannot be read or is implausibly large
 * is skipped rather than failing the scan, because a diagram that is missing
 * one generated bundle beats no diagram at all.
 * @param workspaceCwd - Absolute path of the workspace root
 * @returns The graph and its topology fingerprint
 */
export async function scanModuleGraph(
	workspaceCwd: string,
): Promise<ModuleGraph> {
	const [aliasRoots, files] = await Promise.all([
		readPathAliases(workspaceCwd),
		collectSourceFiles(workspaceCwd),
	]);
	const fileCounts = new Map<string, number>();
	const edgeWeights = new Map<string, number>();

	for (const file of files) {
		const moduleId = moduleIdForFile(file.relativePath);
		fileCounts.set(moduleId, (fileCounts.get(moduleId) ?? 0) + 1);
	}

	for (let offset = 0; offset < files.length; offset += READ_BATCH_SIZE) {
		const batch = files.slice(offset, offset + READ_BATCH_SIZE);
		const sources = await Promise.all(
			batch.map((file) => readSourceFile(file.absolutePath)),
		);
		for (const [index, source] of sources.entries()) {
			const file = batch[index];
			if (source === null || !file) {
				continue;
			}
			for (const target of importedModuleIds(file, source, aliasRoots)) {
				const key = `${moduleIdForFile(file.relativePath)}\u0000${target}`;
				edgeWeights.set(key, (edgeWeights.get(key) ?? 0) + 1);
			}
		}
	}

	return buildGraph({
		edgeWeights,
		fileCounts,
		scannedFileCount: files.length,
	});
}

/**
 * The module ids one file imports from, excluding its own.
 * @param file - The file being read
 * @param source - Its text
 * @param aliasRoots - Alias prefix → workspace-relative directory
 * @returns Distinct target module ids
 */
function importedModuleIds(
	file: ScannedFile,
	source: string,
	aliasRoots: ReadonlyMap<string, string>,
): ReadonlySet<string> {
	const moduleId = moduleIdForFile(file.relativePath);
	const targets = new Set<string>();
	for (const specifier of extractSpecifiers(source)) {
		const target =
			resolveRelativeSpecifier(file.relativePath, specifier) ??
			resolveAliasSpecifier(specifier, aliasRoots);
		if (!target) {
			continue;
		}
		const targetModuleId = moduleIdForFile(target);
		if (targetModuleId !== moduleId) {
			targets.add(targetModuleId);
		}
	}
	return targets;
}

/**
 * Reads one source file, returning null when it is unreadable or too large to
 * be hand-written code.
 * @param absolutePath - Absolute path of the file
 * @returns The file's text, or null when it was skipped
 */
async function readSourceFile(absolutePath: string): Promise<string | null> {
	try {
		const stats = await stat(absolutePath);
		if (stats.size > SCAN_LIMITS.maxFileBytes) {
			return null;
		}
		return await readFile(absolutePath, 'utf8');
	} catch {
		return null;
	}
}

/**
 * Assembles the node and edge lists from the raw counts, trimming to
 * {@link SCAN_LIMITS.maxNodes} by keeping the directories with the most traffic.
 * @param edgeWeights - Edge key (`from\u0000to`) → number of files carrying it
 * @param fileCounts - Node id → source files it holds
 * @param scannedFileCount - How many files the walk read
 * @returns The finished graph
 */
function buildGraph({
	edgeWeights,
	fileCounts,
	scannedFileCount,
}: {
	edgeWeights: ReadonlyMap<string, number>;
	fileCounts: ReadonlyMap<string, number>;
	scannedFileCount: number;
}): ModuleGraph {
	const allEdges = [...edgeWeights.entries()].map(([key, weight]) => {
		const [from = '', to = ''] = key.split(' ');
		return { from, to, weight };
	});
	const degree = new Map<string, number>();
	for (const edge of allEdges) {
		degree.set(edge.from, (degree.get(edge.from) ?? 0) + edge.weight);
		degree.set(edge.to, (degree.get(edge.to) ?? 0) + edge.weight);
	}

	const ranked = [...fileCounts.keys()].sort((left, right) => {
		const byDegree = (degree.get(right) ?? 0) - (degree.get(left) ?? 0);
		if (byDegree !== 0) {
			return byDegree;
		}
		const byFiles = (fileCounts.get(right) ?? 0) - (fileCounts.get(left) ?? 0);
		return byFiles !== 0 ? byFiles : left.localeCompare(right);
	});
	const kept = new Set(ranked.slice(0, SCAN_LIMITS.maxNodes));
	const edges = allEdges.filter(
		(edge) => kept.has(edge.from) && kept.has(edge.to),
	);

	const fanIn = new Map<string, number>();
	const fanOut = new Map<string, number>();
	for (const edge of edges) {
		fanOut.set(edge.from, (fanOut.get(edge.from) ?? 0) + 1);
		fanIn.set(edge.to, (fanIn.get(edge.to) ?? 0) + 1);
	}

	const nodes = [...kept].sort().map((id) => ({
		depth: id === '.' ? 0 : id.split('/').length,
		fanIn: fanIn.get(id) ?? 0,
		fanOut: fanOut.get(id) ?? 0,
		fileCount: fileCounts.get(id) ?? 0,
		id,
	}));

	return {
		edges,
		fingerprint: fingerprintTopology(
			nodes.map((node) => node.id),
			edges,
		),
		nodes,
		omittedNodeCount: ranked.length - kept.size,
		scannedFileCount,
	};
}
