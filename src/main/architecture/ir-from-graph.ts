/**
 * Seeds an {@link ArchitectureIR} from a scanned module graph, deterministically
 * and with no model in the loop.
 *
 * Seeding is what makes the optional agent pass cheap: the agent edits a
 * diagram that is already correct — renaming boundaries, dropping noise,
 * re-ordering cells — rather than authoring one from an empty document.
 *
 * Every string this module writes is derived from the repository itself
 * (directory names, path segments). Main cannot reach the renderer's i18n
 * instance, so authored English here would be English in every language; the
 * counts and explanations that *are* prose live in the renderer, keyed off the
 * numbers the graph carries.
 */
import path from 'node:path';

import {
	ARCHITECTURE_IR_SCHEMA_VERSION,
	type ArchitectureBoundary,
	type ArchitectureComponent,
	type ArchitectureComponentType,
	type ArchitectureConnection,
	type ArchitectureIR,
} from '../../shared/architecture-diagram.ts';

import type { ModuleGraph, ModuleGraphNode } from './module-graph.ts';

/** Columns the seeded grid fills before wrapping to the next row. */
const GRID_COLUMNS = 4;

/** Most edges drawn; the heaviest survive so the diagram stays readable. */
const MAX_EDGES = 120;

/**
 * Label for the node holding the repository's loose top-level files. Not a
 * directory name, so it is spelled rather than derived — and `.` on its own
 * reads as a rendering fault.
 */
const ROOT_NODE_LABEL = 'root';

/** Smallest group that earns a boundary frame; one node in a frame is noise. */
const MIN_BOUNDARY_MEMBERS = 2;

/**
 * Path fragments that imply a component's role, most specific first. A
 * directory matches the first row whose fragments it contains, so `security`
 * beats the `lib` that would otherwise claim `src/lib/security`.
 */
const TYPE_HEURISTICS: readonly {
	fragments: readonly string[];
	type: ArchitectureComponentType;
}[] = [
	{
		fragments: [
			'auth',
			'security',
			'permission',
			'crypto',
			'secret',
			'keychain',
		],
		type: 'security',
	},
	{
		fragments: [
			'storage',
			'database',
			'repositor',
			'migration',
			'schema',
			'model',
			'entities',
			'prisma',
			'sql',
		],
		type: 'database',
	},
	{
		fragments: [
			'ipc',
			'preload',
			'bridge',
			'queue',
			'event',
			'bus',
			'pubsub',
			'messaging',
			'broker',
			'socket',
		],
		type: 'messagebus',
	},
	{
		fragments: [
			'renderer',
			'component',
			'ui',
			'view',
			'page',
			'screen',
			'widget',
			'client',
			'frontend',
			'style',
		],
		type: 'frontend',
	},
	{
		fragments: [
			'infra',
			'deploy',
			'terraform',
			'docker',
			'kubernetes',
			'k8s',
			'cloud',
			'ci',
		],
		type: 'cloud',
	},
	{
		fragments: ['vendor', 'third-party', 'external', 'integration', 'sdk'],
		type: 'external',
	},
];

/**
 * Turns a directory path into an id the IR schema accepts, which must start
 * with a letter and hold only letters, digits, hyphens, and underscores.
 * @param moduleId - Workspace-relative directory path, or `.` for the root
 * @returns A schema-legal component id
 */
export function componentIdForModule(moduleId: string): string {
	const slug = moduleId
		.replaceAll(/[^a-zA-Z0-9]+/g, '-')
		.replaceAll(/^-+|-+$/g, '')
		.toLowerCase();
	return slug.length > 0 && /^[a-zA-Z]/.test(slug) ? slug : `m-${slug}`;
}

/**
 * Picks the role a directory reads as, from the vocabulary in its path.
 * @param moduleId - Workspace-relative directory path
 * @returns The component type to render it as
 */
export function componentTypeForModule(
	moduleId: string,
): ArchitectureComponentType {
	const haystack = moduleId.toLowerCase();
	const matched = TYPE_HEURISTICS.find((rule) =>
		rule.fragments.some((fragment) => haystack.includes(fragment)),
	);
	return matched?.type ?? 'backend';
}

/**
 * The top-level directory a node belongs to, which is the grouping its
 * boundary frame is built from.
 * @param moduleId - Workspace-relative directory path
 * @returns The first path segment, or `.` for a root-level node
 */
function groupOf(moduleId: string): string {
	return moduleId === '.' ? '.' : (moduleId.split('/')[0] ?? '.');
}

/**
 * Orders groups by how much of the graph's traffic runs through them, so the
 * busiest part of the repository lands at the top of the diagram.
 * @param nodes - Every node in the graph
 * @returns Group names, heaviest first, ties broken by name
 */
function orderedGroups(nodes: readonly ModuleGraphNode[]): readonly string[] {
	const weight = new Map<string, number>();
	for (const node of nodes) {
		const group = groupOf(node.id);
		weight.set(group, (weight.get(group) ?? 0) + node.fanIn + node.fanOut);
	}
	return [...weight.keys()].sort((left, right) => {
		const byWeight = (weight.get(right) ?? 0) - (weight.get(left) ?? 0);
		return byWeight !== 0 ? byWeight : left.localeCompare(right);
	});
}

/**
 * Assigns each node a grid cell. Every group starts on a fresh row and fills
 * rows left to right, which is what keeps boundary frames non-overlapping
 * horizontal bands rather than interleaved rectangles.
 * @param nodes - Every node in the graph
 * @returns Node id → its cell
 */
function assignCells(
	nodes: readonly ModuleGraphNode[],
): ReadonlyMap<string, { col: number; row: number }> {
	const byGroup = new Map<string, ModuleGraphNode[]>();
	for (const node of nodes) {
		const group = groupOf(node.id);
		byGroup.set(group, [...(byGroup.get(group) ?? []), node]);
	}
	const cells = new Map<string, { col: number; row: number }>();
	let row = 0;
	for (const group of orderedGroups(nodes)) {
		const members = [...(byGroup.get(group) ?? [])].sort((left, right) => {
			const byFanIn = right.fanIn - left.fanIn;
			if (byFanIn !== 0) {
				return byFanIn;
			}
			const byDepth = left.depth - right.depth;
			return byDepth !== 0 ? byDepth : left.id.localeCompare(right.id);
		});
		for (const [index, member] of members.entries()) {
			cells.set(member.id, {
				col: index % GRID_COLUMNS,
				row: row + Math.floor(index / GRID_COLUMNS),
			});
		}
		row += Math.max(1, Math.ceil(members.length / GRID_COLUMNS));
	}
	return cells;
}

/**
 * Builds one component from a graph node.
 * @param node - The scanned directory
 * @param cell - Its assigned grid cell
 * @returns The component to draw
 */
function toComponent(
	node: ModuleGraphNode,
	cell: { col: number; row: number },
): ArchitectureComponent {
	const segments = node.id === '.' ? [] : node.id.split('/');
	const leaf = segments.at(-1);
	const parent = segments.slice(0, -1).join('/');
	return {
		col: cell.col,
		id: componentIdForModule(node.id),
		label: leaf ?? ROOT_NODE_LABEL,
		row: cell.row,
		// The root node stands for whatever files sit loose at the top of the
		// repository rather than for one directory, so it gets no source: a click
		// target of `.` resolves to nothing openable and reads as a broken link.
		...(leaf ? { sources: [{ path: node.id }] } : {}),
		...(parent ? { sublabel: parent } : {}),
		type: componentTypeForModule(node.id),
	};
}

/**
 * Builds the boundary frames, one per top-level directory that holds more than
 * a single node.
 * @param nodes - Every node in the graph
 * @returns The frames, in group order
 */
function toBoundaries(
	nodes: readonly ModuleGraphNode[],
): readonly ArchitectureBoundary[] {
	const byGroup = new Map<string, string[]>();
	for (const node of nodes) {
		const group = groupOf(node.id);
		byGroup.set(group, [
			...(byGroup.get(group) ?? []),
			componentIdForModule(node.id),
		]);
	}
	return orderedGroups(nodes).flatMap((group) => {
		const wraps = byGroup.get(group) ?? [];
		if (wraps.length < MIN_BOUNDARY_MEMBERS || group === '.') {
			return [];
		}
		return [{ kind: 'region' as const, label: group, wraps }];
	});
}

/**
 * Builds the connections, keeping the heaviest edges when the graph has more
 * than the diagram can show without becoming a hairball.
 * @param graph - The scanned graph
 * @returns The connections to draw
 */
function toConnections(graph: ModuleGraph): readonly ArchitectureConnection[] {
	const heaviestWeight = Math.max(1, ...graph.edges.map((edge) => edge.weight));
	return [...graph.edges]
		.sort((left, right) => {
			const byWeight = right.weight - left.weight;
			return byWeight !== 0
				? byWeight
				: `${left.from}>${left.to}`.localeCompare(`${right.from}>${right.to}`);
		})
		.slice(0, MAX_EDGES)
		.map((edge) => ({
			from: componentIdForModule(edge.from),
			id: `e-${componentIdForModule(edge.from)}-to-${componentIdForModule(edge.to)}`,
			to: componentIdForModule(edge.to),
			variant:
				edge.weight >= heaviestWeight / 2
					? ('emphasis' as const)
					: ('default' as const),
		}));
}

/**
 * Seeds a diagram from a scanned graph.
 * @param graph - The scanned module graph
 * @param workspaceCwd - Absolute workspace path, whose basename titles the diagram
 * @returns A complete, drawable IR
 */
export function irFromModuleGraph(
	graph: ModuleGraph,
	workspaceCwd: string,
): ArchitectureIR {
	const cells = assignCells(graph.nodes);
	return {
		boundaries: toBoundaries(graph.nodes),
		components: graph.nodes.map((node) =>
			toComponent(node, cells.get(node.id) ?? { col: 0, row: 0 }),
		),
		connections: toConnections(graph),
		layout: { cols: GRID_COLUMNS, mode: 'grid' },
		meta: { title: path.basename(workspaceCwd) || workspaceCwd || '/' },
		schemaVersion: ARCHITECTURE_IR_SCHEMA_VERSION,
	};
}
