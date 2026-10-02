/**
 * Reads a document's boundaries as *sets* and works out how they relate.
 *
 * A boundary already carries the only thing an Euler drawing needs: the ids it
 * `wraps`. Subset means one region nests inside another, a bare intersection
 * means the two share a lens, and everything else is siblings. Nothing else in
 * the document has to say so, which is why the organic mode needs no new field
 * on the boundary itself.
 *
 * Containment is the relation that *places* things — a nested region is packed
 * inside its parent. A cross-cutting set places nothing: its members already sit
 * wherever their directory region put them, and its curve is drawn over the top
 * once the packing is done.
 */
import type { ArchitectureBoundary } from '@/shared/architecture-diagram';

/** A boundary reduced to the component ids that actually exist in the document. */
export interface BoundarySet {
	boundary: ArchitectureBoundary;
	/** Composite identity, `kind:label`, matching {@link DiagramFrame.id}. */
	id: string;
	members: ReadonlySet<string>;
}

/** A region in the containment forest, with the members it places itself. */
export interface RegionNode {
	children: readonly RegionNode[];
	/** How many regions enclose this one, 0 for a root. */
	depth: number;
	/** Members this region places directly, none of which belong to a child. */
	own: readonly string[];
	set: BoundarySet;
}

/** Every boundary sorted into the role it plays in the layout. */
export interface SetForest {
	/** Sets that intersect another without nesting; drawn, never placed. */
	crossCutting: readonly BoundarySet[];
	/** Components enclosed by no region at all. */
	loose: readonly string[];
	roots: readonly RegionNode[];
}

/**
 * True when every member of the first set is also a member of the second.
 * @param inner - The candidate subset
 * @param outer - The candidate superset
 * @returns True when `inner` is contained in `outer`
 */
function isSubset(
	inner: ReadonlySet<string>,
	outer: ReadonlySet<string>,
): boolean {
	for (const member of inner) {
		if (!outer.has(member)) {
			return false;
		}
	}
	return true;
}

/**
 * True when two sets share at least one member.
 * @param left - One set
 * @param right - The other
 * @returns True when the intersection is non-empty
 */
function intersects(
	left: ReadonlySet<string>,
	right: ReadonlySet<string>,
): boolean {
	const [smaller, larger] =
		left.size <= right.size ? [left, right] : [right, left];
	for (const member of smaller) {
		if (larger.has(member)) {
			return true;
		}
	}
	return false;
}

/**
 * Reduces each boundary to the members that exist, dropping the ones that wrap
 * nothing at all — a dangling boundary is reported by the compiler rather than
 * laid out.
 * @param boundaries - The document's boundaries
 * @param known - Every component id in the document
 * @returns One set per boundary that has at least one real member
 */
function toSets(
	boundaries: readonly ArchitectureBoundary[],
	known: ReadonlySet<string>,
): BoundarySet[] {
	return boundaries.flatMap((boundary) => {
		const members = new Set(boundary.wraps.filter((id) => known.has(id)));
		if (members.size === 0) {
			return [];
		}
		return [{ boundary, id: `${boundary.kind}:${boundary.label}`, members }];
	});
}

/**
 * True when two sets can both belong to a containment forest: one inside the
 * other, or nothing in common at all.
 * @param left - One set
 * @param right - The other
 * @returns True when the pair nests or is disjoint
 */
function isLaminar(left: BoundarySet, right: BoundarySet): boolean {
	return (
		!intersects(left.members, right.members) ||
		isSubset(left.members, right.members) ||
		isSubset(right.members, left.members)
	);
}

/**
 * Splits the sets into the ones that can form a containment forest and the ones
 * that cross it.
 *
 * Crossing is a relation between two sets, not a property of one, so which of a
 * crossing pair becomes the region and which becomes the lens has to be chosen.
 * The larger set wins, and declaration order breaks a tie: the outer structure
 * of a document is the skeleton worth packing against, and a set that cuts
 * across it is the one a reader expects to see drawn over the top.
 * @param sets - Every boundary, in declaration order
 * @returns The forest-forming sets and the crossing ones, both in declaration order
 */
function partitionLaminar(sets: readonly BoundarySet[]): {
	crossCutting: BoundarySet[];
	nesting: BoundarySet[];
} {
	const ranked = [...sets.entries()].sort(
		([leftIndex, left], [rightIndex, right]) => {
			const bySize = right.members.size - left.members.size;
			return bySize !== 0 ? bySize : leftIndex - rightIndex;
		},
	);
	const accepted: BoundarySet[] = [];
	const crossing = new Set<BoundarySet>();
	for (const [, set] of ranked) {
		if (accepted.every((other) => isLaminar(set, other))) {
			accepted.push(set);
		} else {
			crossing.add(set);
		}
	}
	return {
		crossCutting: sets.filter((set) => crossing.has(set)),
		nesting: sets.filter((set) => !crossing.has(set)),
	};
}

/**
 * The region a set nests directly inside: the smallest of the sets that contain
 * it. Equal sets cannot nest by size, so declaration order breaks the tie and
 * the one declared first becomes the parent.
 * @param index - Position of the set being placed
 * @param sets - Every containment-forming set, in declaration order
 * @returns The parent's index, or null when the set is a root
 */
function parentIndexOf(
	index: number,
	sets: readonly BoundarySet[],
): number | null {
	const child = sets[index] as BoundarySet;
	const childSize = child.members.size;
	let best: number | null = null;
	let bestSize = Number.POSITIVE_INFINITY;
	for (const [candidate, set] of sets.entries()) {
		if (candidate === index || !isSubset(child.members, set.members)) {
			continue;
		}
		const size = set.members.size;
		const isStrictlyLarger = size > childSize;
		const isEarlierTwin = size === childSize && candidate < index;
		if (!isStrictlyLarger && !isEarlierTwin) {
			continue;
		}
		if (best === null || size < bestSize) {
			best = candidate;
			bestSize = size;
		}
	}
	return best;
}

/**
 * Builds one region and everything below it, handing each member to the
 * deepest region that holds it.
 * @param index - Position of this region's set
 * @param sets - Every containment-forming set
 * @param childrenOf - Child indices per parent index
 * @param depth - How many regions enclose this one
 * @returns The region, with its subtree
 */
function toRegion(
	index: number,
	sets: readonly BoundarySet[],
	childrenOf: ReadonlyMap<number | null, number[]>,
	depth: number,
): RegionNode {
	const set = sets[index] as BoundarySet;
	const children = (childrenOf.get(index) ?? []).map((child) =>
		toRegion(child, sets, childrenOf, depth + 1),
	);
	const claimed = new Set(children.flatMap((child) => [...child.set.members]));
	return {
		children,
		depth,
		own: [...set.members].filter((member) => !claimed.has(member)),
		set,
	};
}

/**
 * Sorts a document's boundaries into the regions that place components and the
 * cross-cutting sets that only outline them.
 * @param boundaries - The document's boundaries
 * @param componentIds - Every component id, in document order
 * @returns The containment forest, the cross-cutting sets, and the loose components
 */
export function buildSetForest(
	boundaries: readonly ArchitectureBoundary[],
	componentIds: readonly string[],
): SetForest {
	const known = new Set(componentIds);
	const sets = toSets(boundaries, known);
	const { crossCutting, nesting } = partitionLaminar(sets);

	const childrenOf = new Map<number | null, number[]>();
	for (const index of nesting.keys()) {
		const parent = parentIndexOf(index, nesting);
		childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), index]);
	}
	const roots = (childrenOf.get(null) ?? []).map((index) =>
		toRegion(index, nesting, childrenOf, 0),
	);

	const enclosed = new Set(nesting.flatMap((set) => [...set.members]));
	return {
		crossCutting,
		loose: componentIds.filter((id) => !enclosed.has(id)),
		roots,
	};
}

/**
 * Every region in a forest, parents before their children — the order the
 * canvas has to paint in so a nested blob sits over the one enclosing it.
 * @param roots - The forest's root regions
 * @returns Every region, shallowest first
 */
export function flattenRegions(roots: readonly RegionNode[]): RegionNode[] {
	return roots.flatMap((root) => [root, ...flattenRegions(root.children)]);
}
