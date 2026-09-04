/**
 * Solves the organic layout: an Euler drawing of the document's boundaries.
 *
 * Placement comes from *containment*. Each region packs its child regions and
 * its own nodes into one round cluster, bottom-up, so a region is inside its
 * parent because it was literally packed inside it — the outlines then nest
 * without anything having to force them to.
 *
 * A cross-cutting set places nothing. Its members already sit wherever their
 * region put them, and its curve is drawn over the result — but only when that
 * curve can be drawn honestly. A set whose members are scattered would need an
 * outline swallowing half the diagram, which says "these are all in the set"
 * and is a lie; that one is reported as a problem instead of drawn.
 */
import type {
	ArchitectureComponent,
	ArchitectureIR,
	DiagramPoint,
} from '@/shared/architecture-diagram';
import type { DiagramFrame } from './layout-types';
import { pointInPolygon, regionOutline } from './outline';
import { type PackItem, packCluster } from './pack';
import {
	type BoundarySet,
	buildSetForest,
	flattenRegions,
	type RegionNode,
} from './set-forest';
import { FRAME_METRICS, SOLVED_NODE_SIZE } from './tracks';

/** Spacing the organic solver lays out against. */
const ORGANIC = {
	/** Clear space between a region's innermost outline and its members. */
	basePad: 26,
	/** Non-members a lens may enclose before it stops being drawn at all. */
	maxForeignInLens: 1,
	/** Swaps tried before the refinement gives up on tightening the lenses. */
	maxRefinementPasses: 12,
	/** Canvas margin around everything. */
	margin: 40,
	/** How much further out each enclosing region's outline runs. */
	padStep: 22,
} as const;

/** Prefix distinguishing a packed child region from a component in a cluster. */
const REGION_ITEM_PREFIX = 'region:';

/** A component's position and size, as the solver resolves them. */
interface PlacedNode {
	height: number;
	width: number;
	x: number;
	y: number;
}

/** Everything the compiler needs from the organic mode. */
export interface OrganicSolution {
	frames: readonly DiagramFrame[];
	positions: ReadonlyMap<string, DiagramPoint>;
	problems: readonly string[];
}

/**
 * The box a component occupies, which it may declare and otherwise inherits.
 * @param component - The component to size
 * @returns Its width and height
 */
function sizeOf(component: ArchitectureComponent): readonly [number, number] {
	return component.size ?? SOLVED_NODE_SIZE;
}

/**
 * How far outside its members a region's outline runs. Deeper regions hug their
 * contents and each enclosing one stands further off, which is what leaves a
 * visible band between a parent's curve and its child's.
 * @param depth - How many regions enclose this one
 * @param deepest - The deepest region in the forest
 * @returns The padding in pixels
 */
function padForDepth(depth: number, deepest: number): number {
	return ORGANIC.basePad + (deepest - depth) * ORGANIC.padStep;
}

/**
 * Ranks components by the cross-cutting set they belong to, so the packer keeps
 * a lens's members adjacent — which is the difference between a lens that can be
 * drawn around them and one that would have to swallow the diagram.
 * @param crossCutting - The document's cross-cutting sets
 * @returns Component id → its rank, with non-members ranked last
 */
function crossCuttingRanks(
	crossCutting: readonly BoundarySet[],
): ReadonlyMap<string, number> {
	const ranks = new Map<string, number>();
	for (const [index, set] of crossCutting.entries()) {
		for (const member of set.members) {
			if (!ranks.has(member)) {
				ranks.set(member, index);
			}
		}
	}
	return ranks;
}

/** A packed region: where each of its descendants sits, relative to its own corner. */
interface PackedRegion {
	height: number;
	nodes: ReadonlyMap<string, PlacedNode>;
	width: number;
}

/**
 * Packs a region and everything below it into one cluster, bottom-up.
 * @param region - The region to pack
 * @param context - Sizes, ranks, and the forest's depth
 * @returns The cluster's size and every descendant node's place within it
 */
function packRegion(
	region: RegionNode,
	context: {
		deepest: number;
		ranks: ReadonlyMap<string, number>;
		sizes: ReadonlyMap<string, readonly [number, number]>;
	},
): PackedRegion {
	const packedChildren = new Map<string, PackedRegion>();
	for (const child of region.children) {
		packedChildren.set(child.set.id, packRegion(child, context));
	}

	const items: PackItem[] = [];
	for (const child of region.children) {
		const packed = packedChildren.get(child.set.id) as PackedRegion;
		const pad = padForDepth(child.depth, context.deepest);
		items.push({
			height: packed.height + pad * 2,
			id: `${REGION_ITEM_PREFIX}${child.set.id}`,
			rank: rankOfRegion(child, context.ranks),
			width: packed.width + pad * 2,
		});
	}
	for (const member of region.own) {
		const [width, height] = context.sizes.get(member) ?? SOLVED_NODE_SIZE;
		items.push({
			height,
			id: member,
			rank: context.ranks.get(member) ?? Number.MAX_SAFE_INTEGER,
			width,
		});
	}

	return toPackedRegion(
		packCluster(items, region.children.length > 0),
		packedChildren,
		context.deepest,
		region.children,
	);
}

/**
 * The rank a packed region carries into its parent's cluster, taken from the
 * best-ranked member inside it so a region holding lens members sits beside the
 * other members of that lens.
 * @param region - The region being ranked
 * @param ranks - Component ranks from the cross-cutting sets
 * @returns The region's rank
 */
function rankOfRegion(
	region: RegionNode,
	ranks: ReadonlyMap<string, number>,
): number {
	let best = Number.MAX_SAFE_INTEGER;
	for (const member of region.set.members) {
		best = Math.min(best, ranks.get(member) ?? Number.MAX_SAFE_INTEGER);
	}
	return best;
}

/**
 * Turns one cluster's placements into absolute node positions, folding each
 * packed child region's own contents in at the offset it was placed at.
 * @param cluster - The packed cluster
 * @param packedChildren - Each child region's own packing, by set id
 * @param deepest - The deepest region in the forest
 * @param children - The regions that were packed as rigid boxes
 * @returns The cluster's size and every descendant node's place within it
 */
function toPackedRegion(
	cluster: ReturnType<typeof packCluster>,
	packedChildren: ReadonlyMap<string, PackedRegion>,
	deepest: number,
	children: readonly RegionNode[],
): PackedRegion {
	const nodes = new Map<string, PlacedNode>();
	for (const placement of cluster.placements) {
		if (!placement.id.startsWith(REGION_ITEM_PREFIX)) {
			nodes.set(placement.id, {
				height: placement.height,
				width: placement.width,
				x: placement.x,
				y: placement.y,
			});
			continue;
		}
		const setId = placement.id.slice(REGION_ITEM_PREFIX.length);
		const child = children.find((entry) => entry.set.id === setId);
		const packed = packedChildren.get(setId);
		if (!child || !packed) {
			continue;
		}
		const pad = padForDepth(child.depth, deepest);
		for (const [id, node] of packed.nodes) {
			nodes.set(id, {
				...node,
				x: node.x + placement.x + pad,
				y: node.y + placement.y + pad,
			});
		}
	}
	return { height: cluster.height, nodes, width: cluster.width };
}

/**
 * Packs the whole document: every root region as a cluster of its own, plus the
 * components no region encloses, all dropped into one outer cluster.
 * @param roots - The forest's root regions
 * @param loose - Components enclosed by no region
 * @param context - Sizes, ranks, and the forest's depth
 * @returns Every component's box, in canvas coordinates
 */
function packDocument(
	roots: readonly RegionNode[],
	loose: readonly string[],
	context: {
		deepest: number;
		ranks: ReadonlyMap<string, number>;
		sizes: ReadonlyMap<string, readonly [number, number]>;
	},
): ReadonlyMap<string, PlacedNode> {
	const packedRoots = new Map<string, PackedRegion>();
	const items: PackItem[] = [];
	for (const root of roots) {
		const packed = packRegion(root, context);
		packedRoots.set(root.set.id, packed);
		const pad = padForDepth(root.depth, context.deepest);
		items.push({
			height: packed.height + pad * 2,
			id: `${REGION_ITEM_PREFIX}${root.set.id}`,
			rank: rankOfRegion(root, context.ranks),
			width: packed.width + pad * 2,
		});
	}
	for (const member of loose) {
		const [width, height] = context.sizes.get(member) ?? SOLVED_NODE_SIZE;
		items.push({
			height,
			id: member,
			rank: context.ranks.get(member) ?? Number.MAX_SAFE_INTEGER,
			width,
		});
	}

	const outer = toPackedRegion(
		packCluster(items, roots.length > 0),
		packedRoots,
		context.deepest,
		roots,
	);
	return new Map(
		[...outer.nodes].map(([id, node]) => [
			id,
			{ ...node, x: node.x + ORGANIC.margin, y: node.y + ORGANIC.margin },
		]),
	);
}

/**
 * Builds the frame for one set: its outline, its bounding box, and the title
 * band that rides on top of it.
 * @param set - The set to outline
 * @param depth - How many frames enclose it
 * @param placed - Every component's box
 * @param pad - How far outside its members the outline runs
 * @param isLens - True when the set crosses the regions instead of being one
 * @returns The frame and its polygon, or null when it has nothing to enclose
 */
function toFrame(
	set: BoundarySet,
	depth: number,
	placed: ReadonlyMap<string, PlacedNode>,
	pad: number,
	isLens = false,
): { frame: DiagramFrame; polygon: readonly DiagramPoint[] } | null {
	const rects = [...set.members].flatMap((member) => {
		const node = placed.get(member);
		return node ? [node] : [];
	});
	const outline = regionOutline(rects, pad);
	if (!outline) {
		return null;
	}
	const xs = outline.polygon.map((point) => point[0]);
	const ys = outline.polygon.map((point) => point[1]);
	const minX = Math.min(...xs);
	const minY = Math.min(...ys);
	const width = Math.max(...xs) - minX;
	const topmost = outline.polygon.reduce((best, point) =>
		point[1] < best[1] ? point : best,
	);
	return {
		frame: {
			boundary: set.boundary,
			depth,
			height: Math.max(...ys) - minY,
			id: set.id,
			isLens,
			outline: outline.d,
			title: {
				height: FRAME_METRICS.labelHeight,
				width: Math.max(0, Math.min(width, set.boundary.label.length * 5 + 10)),
				x: topmost[0] - (set.boundary.label.length * 5 + 10) / 2,
				y:
					topmost[1] - FRAME_METRICS.labelClearance - FRAME_METRICS.labelHeight,
			},
			width,
			x: minX,
			y: minY,
		},
		polygon: outline.polygon,
	};
}

/**
 * How many components a lens would enclose without wrapping them, which is what
 * decides whether it can be drawn at all.
 * @param polygon - The lens outline
 * @param set - The set it stands for
 * @param placed - Every component's box
 * @returns The count of enclosed non-members
 */
function foreignInside(
	polygon: readonly DiagramPoint[],
	set: BoundarySet,
	placed: ReadonlyMap<string, PlacedNode>,
): number {
	let count = 0;
	for (const [id, node] of placed) {
		if (set.members.has(id)) {
			continue;
		}
		const centre: DiagramPoint = [
			node.x + node.width / 2,
			node.y + node.height / 2,
		];
		if (pointInPolygon(centre, polygon)) {
			count += 1;
		}
	}
	return count;
}

/**
 * The region that places each component, which is the only place it may move to.
 * @param regions - Every region in the forest
 * @returns Component id → the id of the region that placed it
 */
function homeRegions(
	regions: readonly RegionNode[],
): ReadonlyMap<string, string> {
	const homes = new Map<string, string>();
	for (const region of regions) {
		for (const member of region.own) {
			homes.set(member, region.set.id);
		}
	}
	return homes;
}

/**
 * How many strangers all the lenses enclose between them, which is the score the
 * refinement drives down.
 * @param lenses - The cross-cutting sets
 * @param placed - Every component's box
 * @returns The total foreign count
 */
function totalForeign(
	lenses: readonly BoundarySet[],
	placed: ReadonlyMap<string, PlacedNode>,
): number {
	let total = 0;
	for (const lens of lenses) {
		const outline = regionOutline(
			[...lens.members].flatMap((member) => {
				const node = placed.get(member);
				return node ? [node] : [];
			}),
			ORGANIC.basePad,
		);
		if (outline) {
			total += foreignInside(outline.polygon, lens, placed);
		}
	}
	return total;
}

/**
 * Tightens the lenses by trading a lens member's slot for a neighbour's.
 *
 * The packer places by containment, which leaves a lens's members wherever their
 * own regions put them — usually far apart, so the curve between them would have
 * to swallow everything in between. A swap moves a member to a slot that faces
 * the rest of its set.
 *
 * A component may only trade with another in the *same* region and of the same
 * size, so every containment the packing established survives untouched: the
 * regions' member sets do not change, only which box sits where inside them.
 * @param placed - Every component's box
 * @param lenses - The cross-cutting sets to tighten
 * @param homes - The region that placed each component
 * @returns The placement, with the best swaps applied
 */
function refineForLenses(
	placed: ReadonlyMap<string, PlacedNode>,
	lenses: readonly BoundarySet[],
	homes: ReadonlyMap<string, string>,
): ReadonlyMap<string, PlacedNode> {
	if (lenses.length === 0) {
		return placed;
	}
	const inALens = new Set(lenses.flatMap((lens) => [...lens.members]));
	let current = new Map(placed);
	let score = totalForeign(lenses, current);

	for (
		let pass = 0;
		pass < ORGANIC.maxRefinementPasses && score > 0;
		pass += 1
	) {
		let bestSwap: readonly [string, string] | null = null;
		for (const member of [...inALens].sort()) {
			const home = homes.get(member);
			const box = current.get(member);
			if (!home || !box) {
				continue;
			}
			for (const [candidate, other] of [...current].sort(([left], [right]) =>
				left.localeCompare(right),
			)) {
				if (
					inALens.has(candidate) ||
					homes.get(candidate) !== home ||
					other.width !== box.width ||
					other.height !== box.height
				) {
					continue;
				}
				const trial = new Map(current);
				trial.set(member, { ...box, x: other.x, y: other.y });
				trial.set(candidate, { ...other, x: box.x, y: box.y });
				const trialScore = totalForeign(lenses, trial);
				if (trialScore < score) {
					score = trialScore;
					bestSwap = [member, candidate];
				}
			}
		}
		if (!bestSwap) {
			break;
		}
		const [member, candidate] = bestSwap;
		const box = current.get(member) as PlacedNode;
		const other = current.get(candidate) as PlacedNode;
		current = new Map(current);
		current.set(member, { ...box, x: other.x, y: other.y });
		current.set(candidate, { ...other, x: box.x, y: box.y });
	}
	return current;
}

/**
 * Solves an organic document into node positions and Euler frames.
 * @param ir - The document to lay out
 * @returns Positions, frames in paint order, and any set that could not be drawn
 */
export function solveOrganicLayout(ir: ArchitectureIR): OrganicSolution {
	const sizes = new Map(
		ir.components.map((component) => [component.id, sizeOf(component)]),
	);
	const forest = buildSetForest(
		ir.boundaries ?? [],
		ir.components.map((component) => component.id),
	);
	const regions = flattenRegions(forest.roots);
	const deepest = regions.reduce(
		(best, region) => Math.max(best, region.depth),
		0,
	);
	const ranks = crossCuttingRanks(forest.crossCutting);
	const placed = refineForLenses(
		packDocument(forest.roots, forest.loose, { deepest, ranks, sizes }),
		forest.crossCutting,
		homeRegions(regions),
	);

	const problems: string[] = [];
	const frames: DiagramFrame[] = [];
	for (const region of regions) {
		const built = toFrame(
			region.set,
			region.depth,
			placed,
			padForDepth(region.depth, deepest),
		);
		if (built) {
			frames.push(built.frame);
		}
	}
	for (const set of forest.crossCutting) {
		const built = toFrame(set, deepest + 1, placed, ORGANIC.basePad, true);
		if (!built) {
			continue;
		}
		const foreign = foreignInside(built.polygon, set, placed);
		if (foreign > ORGANIC.maxForeignInLens) {
			problems.push(
				`Boundary "${set.boundary.label}" could not be drawn without enclosing ${foreign} components it does not wrap.`,
			);
			continue;
		}
		frames.push(built.frame);
	}

	return {
		frames: [...frames].sort((left, right) => left.depth - right.depth),
		positions: new Map(
			[...placed].map(([id, node]) => [id, [node.x, node.y] as DiagramPoint]),
		),
		problems,
	};
}
