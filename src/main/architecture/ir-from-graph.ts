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
 * Marks a role lens's label as a role rather than a directory path.
 *
 * Both kinds of boundary are labelled with derived data and the schema requires
 * a `kind` and `label` pair to be unique, so a repository with a top-level
 * `frontend/` directory would otherwise emit a region and a lens under one
 * name and be rejected. A symbol rather than a word, because main cannot reach
 * the renderer's translations and an English noun here would be English in
 * every language.
 */
const ROLE_LENS_LABEL_PREFIX = '@';

/**
 * Caps the IR schema applies to the strings this module writes, mirrored from
 * `src/shared/architecture-diagram/schema.ts`. The seed is validated against
 * that schema before it is persisted, and a document it rejects leaves the
 * workspace with a diagram nothing can read — so a pathologically long
 * directory name is truncated here rather than failing the scan.
 */
const LABEL_LIMITS = {
	/** A component label, a boundary label, or the diagram title. */
	label: 120,
	/** A component's sublabel, which carries its parent path. */
	sublabel: 240,
	/** A source reference's path. */
	sourcePath: 240,
} as const;

/**
 * Truncates a derived string to what the IR schema accepts.
 * @param value - The string as derived from the repository
 * @param limit - Longest form the schema takes
 * @returns The string, shortened from the end when it is over the limit
 */
function clampToLimit(value: string, limit: number): string {
	return value.length <= limit ? value : value.slice(0, limit);
}

/**
 * Assigns every node a component id no other node holds.
 *
 * {@link componentIdForModule} is lossy — it folds case and collapses every
 * non-alphanumeric run — so `src/API` and `src/api`, or `packages/ui/kit` and
 * `packages/ui-kit`, land on one id. The compiler and the delta comparator both
 * index components into a `Map` where the last entry wins, so a collision
 * renders two directories as one box and silently re-aims the loser's edges.
 * Ids are assigned in sorted order so the same tree always resolves a collision
 * the same way, which is what keeps the delta comparator matching across scans.
 * @param nodes - Every node in the graph
 * @returns Module id → the component id that stands for it
 */
function assignComponentIds(
	nodes: readonly ModuleGraphNode[],
): ReadonlyMap<string, string> {
	const assigned = new Map<string, string>();
	const taken = new Set<string>();
	for (const moduleId of nodes.map((node) => node.id).sort()) {
		const base = componentIdForModule(moduleId);
		let candidate = base;
		let suffix = 2;
		while (taken.has(candidate)) {
			candidate = `${base}-${suffix}`;
			suffix += 1;
		}
		taken.add(candidate);
		assigned.set(moduleId, candidate);
	}
	return assigned;
}

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
 * @param componentIds - Module id → the component id that stands for it
 * @returns The component to draw
 */
function toComponent(
	node: ModuleGraphNode,
	componentIds: ReadonlyMap<string, string>,
): ArchitectureComponent {
	const segments = node.id === '.' ? [] : node.id.split('/');
	const leaf = segments.at(-1);
	const parent = segments.slice(0, -1).join('/');
	const openable = leaf && node.id.length <= LABEL_LIMITS.sourcePath;
	return {
		id: componentIds.get(node.id) ?? componentIdForModule(node.id),
		label: clampToLimit(leaf ?? ROOT_NODE_LABEL, LABEL_LIMITS.label),
		// The root node stands for whatever files sit loose at the top of the
		// repository rather than for one directory, so it gets no source: a click
		// target of `.` resolves to nothing openable and reads as a broken link.
		...(openable ? { sources: [{ path: node.id }] } : {}),
		...(parent
			? { sublabel: clampToLimit(parent, LABEL_LIMITS.sublabel) }
			: {}),
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
 * @param componentIds - Module id → the component id that stands for it
 * @returns The regions, shallowest first
 */
function toRegions(
	nodes: readonly ModuleGraphNode[],
	componentIds: ReadonlyMap<string, string>,
): readonly ArchitectureBoundary[] {
	const byPath = new Map<string, string[]>();
	for (const node of nodes) {
		const componentId = componentIds.get(node.id);
		if (!componentId) {
			continue;
		}
		for (const enclosing of enclosingPaths(node.id)) {
			byPath.set(enclosing, [...(byPath.get(enclosing) ?? []), componentId]);
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
		.map(([label, wraps]) => ({
			kind: 'region' as const,
			label: clampToLimit(label, LABEL_LIMITS.label),
			wraps,
		}));
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
 * translations, so authored English would be English in every language. It
 * carries {@link ROLE_LENS_LABEL_PREFIX} so it cannot read as, or collide with,
 * the directory path a region is labelled with.
 * @param nodes - Every node in the graph
 * @param regions - The regions already emitted, which a lens has to cross
 * @param componentIds - Module id → the component id that stands for it
 * @returns The lenses, tightest first
 */
function toRoleLenses(
	nodes: readonly ModuleGraphNode[],
	regions: readonly ArchitectureBoundary[],
	componentIds: ReadonlyMap<string, string>,
): readonly ArchitectureBoundary[] {
	const byRole = new Map<ArchitectureComponentType, string[]>();
	for (const node of nodes) {
		const componentId = componentIds.get(node.id);
		if (!componentId) {
			continue;
		}
		const role = componentTypeForModule(node.id);
		byRole.set(role, [...(byRole.get(role) ?? []), componentId]);
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
				label: `${ROLE_LENS_LABEL_PREFIX}${role}`,
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
 * Endpoints are read out of the assignment map rather than derived again, so an
 * edge names the id a collision actually gave its directory; an edge either end
 * of which the graph did not keep is dropped, because an endpoint resolving to
 * nothing is an edge the renderer discards without a word.
 * @param graph - The scanned graph
 * @param componentIds - Module id → the component id that stands for it
 * @returns The connections to draw
 */
function toConnections(
	graph: ModuleGraph,
	componentIds: ReadonlyMap<string, string>,
): readonly ArchitectureConnection[] {
	const heaviestWeight = Math.max(1, ...graph.edges.map((edge) => edge.weight));
	return [...graph.edges]
		.sort((left, right) => {
			const byWeight = right.weight - left.weight;
			return byWeight !== 0
				? byWeight
				: `${left.from}>${left.to}`.localeCompare(`${right.from}>${right.to}`);
		})
		.slice(0, MAX_EDGES)
		.flatMap((edge) => {
			const from = componentIds.get(edge.from);
			const to = componentIds.get(edge.to);
			if (!from || !to) {
				return [];
			}
			return [
				{
					from,
					id: `e-${from}-to-${to}`,
					to,
					variant:
						edge.weight >= heaviestWeight / 2
							? ('emphasis' as const)
							: ('default' as const),
				},
			];
		});
}

/**
 * The document's boundaries: the nested regions, plus the role lenses that cross
 * them, with no two of one kind sharing a label.
 *
 * Both labels are derived — a region's from a directory path, a lens's from a
 * role — and the schema rejects a repeated `kind` and `label` pair, so the last
 * pass suffixes rather than letting a truncated path or an exotic directory
 * name cost the whole document.
 * @param nodes - Every node in the graph
 * @param componentIds - Module id → the component id that stands for it
 * @returns The boundaries, regions first
 */
function toBoundaries(
	nodes: readonly ModuleGraphNode[],
	componentIds: ReadonlyMap<string, string>,
): readonly ArchitectureBoundary[] {
	const regions = toRegions(nodes, componentIds);
	return withDistinctLabels([
		...regions,
		...toRoleLenses(nodes, regions, componentIds),
	]);
}

/**
 * Renames any boundary repeating a `kind` and `label` its predecessor claimed.
 * @param boundaries - The boundaries in document order
 * @returns The same boundaries, each with a label unique within its kind
 */
function withDistinctLabels(
	boundaries: readonly ArchitectureBoundary[],
): readonly ArchitectureBoundary[] {
	const taken = new Set<string>();
	return boundaries.map((boundary) => {
		let label = boundary.label;
		let suffix = 2;
		while (taken.has(`${boundary.kind}:${label}`)) {
			label = `${clampToLimit(boundary.label, LABEL_LIMITS.label - 4)}-${suffix}`;
			suffix += 1;
		}
		taken.add(`${boundary.kind}:${label}`);
		return { ...boundary, label };
	});
}

/**
 * Titles the diagram after the repository it describes.
 *
 * Not after the workspace directory: every Ensemblr workspace is a git worktree
 * whose directory is named after its branch, so a basename here would title the
 * committed document with whatever branch happened to create it — and the seed
 * is scanned once, so that title would outlive the branch and reach every
 * future clone. The basename remains as the last resort for a caller with no
 * repository record, because the schema requires a non-empty title.
 * @param repositoryName - Name of the repository the workspace was cut from
 * @param workspaceCwd - Absolute path of the workspace root
 * @returns The diagram title
 */
function diagramTitle({
	repositoryName,
	workspaceCwd,
}: {
	repositoryName?: string | null;
	workspaceCwd: string;
}): string {
	const candidate =
		repositoryName?.trim() ||
		path.basename(workspaceCwd) ||
		workspaceCwd ||
		'/';
	return clampToLimit(candidate, LABEL_LIMITS.label);
}

/**
 * Seeds a diagram from a scanned graph.
 * @param graph - The scanned module graph
 * @param source - The repository the graph was scanned from, which titles it
 * @returns A complete, drawable IR
 */
export function irFromModuleGraph(
	graph: ModuleGraph,
	source: { repositoryName?: string | null; workspaceCwd: string },
): ArchitectureIR {
	const componentIds = assignComponentIds(graph.nodes);
	return {
		boundaries: toBoundaries(graph.nodes, componentIds),
		components: graph.nodes.map((node) => toComponent(node, componentIds)),
		connections: toConnections(graph, componentIds),
		layout: { mode: 'organic' },
		meta: { title: diagramTitle(source) },
		schemaVersion: ARCHITECTURE_IR_SCHEMA_VERSION,
	};
}
