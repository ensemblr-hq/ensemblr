/**
 * Compares two architecture snapshots and says what moved.
 *
 * Ported from archify's `delta/architecture-delta.mjs` (MIT) — the field-group
 * tables and the `statusFor` ladder, not its proof/provenance machinery. The
 * grouping is what makes the badge honest: a node whose `row` shifted because
 * the grid seeder re-packed reads as *moved*, not as *changed*, so a re-layout
 * does not light up the whole diagram.
 *
 * Entities are matched by id, which is why every producer in this app emits a
 * connection `id`: without one, an edge is unmatchable and every edge would
 * come back added-and-removed on each rebuild.
 */
import type {
	ArchitectureBoundary,
	ArchitectureComponent,
	ArchitectureConnection,
	ArchitectureIR,
} from './types.ts';

/** What happened to one entity between two snapshots. */
export type ArchitectureDeltaStatus =
	| 'added'
	| 'changed'
	| 'evidence-changed'
	| 'geometry-changed'
	| 'moved'
	| 'removed'
	| 'rerouted';

/** Which group of fields moved, which is what {@link ArchitectureDeltaStatus} is derived from. */
type FieldClassification =
	| 'evidence'
	| 'geometry'
	| 'scope'
	| 'semantic'
	| 'topology';

/** Fields of a component, grouped by what a change to them means. */
const COMPONENT_FIELDS = {
	evidence: ['sources'],
	geometry: ['row', 'col', 'pos', 'size'],
	semantic: ['type', 'label', 'sublabel', 'tag'],
} as const satisfies Partial<Record<FieldClassification, readonly string[]>>;

/** Fields of a connection, grouped by what a change to them means. */
const CONNECTION_FIELDS = {
	geometry: [
		'fromSide',
		'toSide',
		'route',
		'via',
		'labelAt',
		'labelDx',
		'labelDy',
		'labelSegment',
	],
	semantic: ['label', 'variant'],
	topology: ['from', 'to'],
} as const satisfies Partial<Record<FieldClassification, readonly string[]>>;

/** Fields of a boundary, grouped by what a change to them means. */
const BOUNDARY_FIELDS = {
	geometry: ['pad'],
	scope: ['wraps'],
} as const satisfies Partial<Record<FieldClassification, readonly string[]>>;

/** The delta for one entity, keyed by the id it was matched on. */
export interface ArchitectureEntityDelta {
	/** Field paths that differ, e.g. `label`; empty for added and removed. */
	changedFields: readonly string[];
	id: string;
	status: ArchitectureDeltaStatus;
}

/** What changed between two snapshots, per entity collection. */
export interface ArchitectureDelta {
	boundaries: readonly ArchitectureEntityDelta[];
	components: readonly ArchitectureEntityDelta[];
	connections: readonly ArchitectureEntityDelta[];
}

/** A delta with nothing in it, for the first snapshot a workspace ever takes. */
export const EMPTY_ARCHITECTURE_DELTA: ArchitectureDelta = {
	boundaries: [],
	components: [],
	connections: [],
};

/**
 * Reads a named field off an entity whose type does not carry an index
 * signature, so the field tables above can stay plain string lists.
 * @param entity - The component, connection, or boundary
 * @param field - Field name from one of the tables
 * @returns The field's value, or undefined when the entity omits it
 */
function readField(entity: object, field: string): unknown {
	return Reflect.get(entity, field);
}

/**
 * Value equality over the JSON-ish shapes the IR holds. Field values are
 * primitives, string arrays, number pairs, or source-ref objects, so a stable
 * serialization is the whole comparison.
 * @param left - First value
 * @param right - Second value
 * @returns True when the two are indistinguishable in the IR
 */
function sameFieldValue(left: unknown, right: unknown): boolean {
	if (left === right) {
		return true;
	}
	if (left === undefined || right === undefined) {
		return false;
	}
	return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Maps the groups whose fields moved onto the badge an entity should carry.
 * Identity and meaning outrank evidence, which outranks pure geometry.
 * @param classifications - Groups that hold at least one changed field
 * @param kind - Which collection the entity belongs to, which names its geometry verb
 * @returns The status, or null when nothing in any group moved
 */
function statusFor(
	classifications: readonly FieldClassification[],
	kind: 'boundary' | 'component' | 'connection',
): ArchitectureDeltaStatus | null {
	if (
		classifications.some(
			(value) =>
				value === 'topology' || value === 'semantic' || value === 'scope',
		)
	) {
		return 'changed';
	}
	if (classifications.includes('evidence')) {
		return 'evidence-changed';
	}
	if (classifications.includes('geometry')) {
		if (kind === 'connection') {
			return 'rerouted';
		}
		return kind === 'component' ? 'moved' : 'geometry-changed';
	}
	return null;
}

/**
 * Collects which field groups differ between two versions of an entity.
 * @param before - The entity in the older snapshot
 * @param after - The entity in the newer snapshot
 * @param groups - The field table for this entity kind
 * @returns The groups that moved and the individual fields inside them
 */
function fieldChanges(
	before: object,
	after: object,
	groups: Partial<Record<FieldClassification, readonly string[]>>,
): {
	changedFields: readonly string[];
	classifications: readonly FieldClassification[];
} {
	const classifications: FieldClassification[] = [];
	const changedFields: string[] = [];
	for (const [classification, fields] of Object.entries(groups)) {
		const changed = fields.filter(
			(field) =>
				!sameFieldValue(readField(before, field), readField(after, field)),
		);
		if (changed.length > 0) {
			classifications.push(classification as FieldClassification);
		}
		changedFields.push(...changed);
	}
	return {
		changedFields: changedFields.sort(),
		classifications: classifications.sort(),
	};
}

/**
 * Diffs one id-keyed collection.
 * @param before - Entities in the older snapshot, keyed by id
 * @param after - Entities in the newer snapshot, keyed by id
 * @param groups - The field table for this entity kind
 * @param kind - Which collection this is, which names its geometry verb
 * @returns One entry per entity that is new, gone, or different
 */
function compareEntities(
	before: ReadonlyMap<string, object>,
	after: ReadonlyMap<string, object>,
	groups: Partial<Record<FieldClassification, readonly string[]>>,
	kind: 'boundary' | 'component' | 'connection',
): readonly ArchitectureEntityDelta[] {
	const ids = [...new Set([...before.keys(), ...after.keys()])].sort();
	return ids.flatMap((id) => {
		const left = before.get(id);
		const right = after.get(id);
		if (!left) {
			return [{ changedFields: [], id, status: 'added' as const }];
		}
		if (!right) {
			return [{ changedFields: [], id, status: 'removed' as const }];
		}
		const fields = fieldChanges(left, right, groups);
		const status = statusFor(fields.classifications, kind);
		return status ? [{ changedFields: fields.changedFields, id, status }] : [];
	});
}

/**
 * Indexes components by id.
 * @param ir - The snapshot to index
 * @returns Components keyed by id
 */
function componentIndex(
	ir: ArchitectureIR,
): ReadonlyMap<string, ArchitectureComponent> {
	return new Map(ir.components.map((component) => [component.id, component]));
}

/**
 * Indexes connections by id.
 * @param ir - The snapshot to index
 * @returns Connections keyed by id
 */
function connectionIndex(
	ir: ArchitectureIR,
): ReadonlyMap<string, ArchitectureConnection> {
	return new Map(
		(ir.connections ?? []).map((connection) => [connection.id, connection]),
	);
}

/**
 * Indexes boundaries by `kind:label`, which is the only identity a boundary
 * has — the schema gives it no id.
 * @param ir - The snapshot to index
 * @returns Boundaries keyed by their composite identity
 */
function boundaryIndex(
	ir: ArchitectureIR,
): ReadonlyMap<string, ArchitectureBoundary> {
	return new Map(
		(ir.boundaries ?? []).map((boundary) => [
			`${boundary.kind}:${boundary.label}`,
			boundary,
		]),
	);
}

/**
 * Compares two snapshots of one workspace's architecture.
 * @param before - The previous snapshot's IR, or null when there is none
 * @param after - The current snapshot's IR
 * @returns Per-collection deltas; empty throughout when `before` is null
 */
export function diffArchitectureIr(
	before: ArchitectureIR | null,
	after: ArchitectureIR,
): ArchitectureDelta {
	if (!before) {
		return EMPTY_ARCHITECTURE_DELTA;
	}
	return {
		boundaries: compareEntities(
			boundaryIndex(before),
			boundaryIndex(after),
			BOUNDARY_FIELDS,
			'boundary',
		),
		components: compareEntities(
			componentIndex(before),
			componentIndex(after),
			COMPONENT_FIELDS,
			'component',
		),
		connections: compareEntities(
			connectionIndex(before),
			connectionIndex(after),
			CONNECTION_FIELDS,
			'connection',
		),
	};
}

/**
 * Builds the id → status lookup the renderer paints badges from.
 * @param entries - One collection's deltas
 * @returns Status keyed by entity id
 */
export function toDeltaStatusMap(
	entries: readonly ArchitectureEntityDelta[],
): ReadonlyMap<string, ArchitectureDeltaStatus> {
	return new Map(entries.map((entry) => [entry.id, entry.status]));
}
