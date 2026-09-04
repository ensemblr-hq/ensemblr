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
	ARCHITECTURE_COMPONENT_TYPES,
	ARCHITECTURE_IR_SCHEMA_VERSION,
	type ArchitectureBoundary,
	type ArchitectureComponent,
	type ArchitectureComponentType,
	type ArchitectureConnection,
	type ArchitectureIR,
} from '../../shared/architecture-diagram.ts';

import type { ModuleGraph, ModuleGraphNode } from './module-graph.ts';

/** Most boundaries drawn, well under the ceiling the agent skill documents. */
const MAX_BOUNDARIES = 20;

/** Most cross-cutting role sets drawn; more than two lenses is a hairball. */
const MAX_ROLE_LENSES = 2;

/**
 * Most members a role lens may hold. A lens is read by seeing what falls inside
 * it, and an outline stretched around a dozen boxes scattered over two regions
 * has to swallow everything between them — which the renderer refuses to draw.
 */
const MAX_LENS_MEMBERS = 6;

/** Regions a role has to fall across before it reads as crossing the structure. */
const MIN_REGIONS_CROSSED = 2;

/**
 * Type a directory falls back to when no vocabulary in its path matched, which
 * means "unclassified" rather than "backend" — so it is never a set worth
 * drawing a curve around.
 */
const UNCLASSIFIED_TYPE: ArchitectureComponentType = 'backend';

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
	return matched?.type ?? UNCLASSIFIED_TYPE;
}

/**
 * Every directory path that encloses a node, itself included — the prefixes a
 * region can be drawn around.
 * @param moduleId - Workspace-relative directory path
 * @returns Each enclosing path, shallowest first
 */
function enclosingPaths(moduleId: string): readonly string[] {
	if (moduleId === '.') {
		return [];
	}
	const segments = moduleId.split('/');
	return segments.map((_, index) => segments.slice(0, index + 1).join('/'));
}

/**
 * Builds one component from a graph node.
 *
 * It names no placement at all: under the organic layout a component is placed
 * by the regions that enclose it, so a seeded `row`/`col` would be a coordinate
 * nothing reads.
 * @param node - The scanned directory
 * @returns The component to draw
 */
function toComponent(node: ModuleGraphNode): ArchitectureComponent {
	const segments = node.id === '.' ? [] : node.id.split('/');
	const leaf = segments.at(-1);
	const parent = segments.slice(0, -1).join('/');
	return {
		id: componentIdForModule(node.id),
		label: leaf ?? ROOT_NODE_LABEL,
		// The root node stands for whatever files sit loose at the top of the
		// repository rather than for one directory, so it gets no source: a click
		// target of `.` resolves to nothing openable and reads as a broken link.
		...(leaf ? { sources: [{ path: node.id }] } : {}),
		...(parent ? { sublabel: parent } : {}),
		type: componentTypeForModule(node.id),
	};
}

/**
 * Builds the nested regions: one per directory path that encloses more than a
 * single node, so `src`, `src/main`, and `src/main/agent-runtime` each get a
 * curve and the deeper ones are drawn inside the shallower.
 *
 * A path whose members are exactly its parent's members is dropped. Two regions
 * enclosing the same nodes draw as two curves with nothing between them, and
 * the deeper label is the more specific true statement about that group.
 * @param nodes - Every node in the graph
 * @returns The regions, shallowest first
 */
function toRegions(
	nodes: readonly ModuleGraphNode[],
): readonly ArchitectureBoundary[] {
	const byPath = new Map<string, string[]>();
	for (const node of nodes) {
		for (const enclosing of enclosingPaths(node.id)) {
			byPath.set(enclosing, [
				...(byPath.get(enclosing) ?? []),
				componentIdForModule(node.id),
			]);
		}
	}
	const candidates = [...byPath.entries()].filter(
		([, wraps]) => wraps.length >= MIN_BOUNDARY_MEMBERS,
	);
	const distinct = candidates.filter(([candidatePath, wraps]) =>
		candidates.every(
			([otherPath, otherWraps]) =>
				otherPath === candidatePath ||
				otherWraps.length !== wraps.length ||
				!otherPath.startsWith(`${candidatePath}/`),
		),
	);
	return distinct
		.sort(([leftPath, leftWraps], [rightPath, rightWraps]) => {
			const byDepth = leftPath.split('/').length - rightPath.split('/').length;
			if (byDepth !== 0) {
				return byDepth;
			}
			const bySize = rightWraps.length - leftWraps.length;
			return bySize !== 0 ? bySize : leftPath.localeCompare(rightPath);
		})
		.slice(0, MAX_BOUNDARIES - MAX_ROLE_LENSES)
		.map(([label, wraps]) => ({ kind: 'region' as const, label, wraps }));
}

/**
 * The innermost region holding a component, which is the one that places it.
 * @param componentId - The component to locate
 * @param regions - Every region the document declares
 * @returns The smallest region's label, or null when no region holds it
 */
function deepestRegionOf(
	componentId: string,
	regions: readonly ArchitectureBoundary[],
): string | null {
	const holders = regions.filter((region) =>
		region.wraps.includes(componentId),
	);
	return holders.length === 0
		? null
		: (holders.reduce((smallest, region) =>
				region.wraps.length < smallest.wraps.length ? region : smallest,
			).label ?? null);
}

/**
 * Builds the cross-cutting lenses: a role whose members are placed by more than
 * one region, which is the one thing about a repository the directory tree
 * cannot say — `ipc` living in both the main process and the shared contracts
 * is a concern that crosses the structure rather than sitting inside it.
 *
 * The label is the role's own id rather than a sentence, for the same reason
 * every other string here is a path: main cannot reach the renderer's
 * translations, so authored English would be English in every language.
 * @param nodes - Every node in the graph
 * @param regions - The regions already emitted, which a lens has to cross
 * @returns The lenses, tightest first
 */
function toRoleLenses(
	nodes: readonly ModuleGraphNode[],
	regions: readonly ArchitectureBoundary[],
): readonly ArchitectureBoundary[] {
	const byRole = new Map<ArchitectureComponentType, string[]>();
	for (const node of nodes) {
		const role = componentTypeForModule(node.id);
		byRole.set(role, [
			...(byRole.get(role) ?? []),
			componentIdForModule(node.id),
		]);
	}
	return ARCHITECTURE_COMPONENT_TYPES.flatMap((role) => {
		const wraps = byRole.get(role) ?? [];
		const homes = new Set(wraps.map((id) => deepestRegionOf(id, regions)));
		if (
			role === UNCLASSIFIED_TYPE ||
			homes.size < MIN_REGIONS_CROSSED ||
			wraps.length < MIN_BOUNDARY_MEMBERS ||
			wraps.length > MAX_LENS_MEMBERS
		) {
			return [];
		}
		return [
			{
				kind:
					role === 'security'
						? ('security-group' as const)
						: ('region' as const),
				label: role,
				wraps,
			},
		];
	})
		.sort((left, right) => left.wraps.length - right.wraps.length)
		.slice(0, MAX_ROLE_LENSES);
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
 * The document's boundaries: the nested regions, plus the role lenses that cross
 * them.
 * @param nodes - Every node in the graph
 * @returns The boundaries, regions first
 */
function withRoleLenses(
	nodes: readonly ModuleGraphNode[],
): readonly ArchitectureBoundary[] {
	const regions = toRegions(nodes);
	return [...regions, ...toRoleLenses(nodes, regions)];
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
	return {
		boundaries: withRoleLenses(graph.nodes),
		components: graph.nodes.map(toComponent),
		connections: toConnections(graph),
		layout: { mode: 'organic' },
		meta: { title: path.basename(workspaceCwd) || workspaceCwd || '/' },
		schemaVersion: ARCHITECTURE_IR_SCHEMA_VERSION,
	};
}
