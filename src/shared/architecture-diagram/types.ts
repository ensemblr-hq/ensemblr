/**
 * The architecture diagram's intermediate representation.
 *
 * Modelled on archify's `architecture.schema.json` (MIT) so a document authored
 * there loads here and an export back stays a key rename rather than a
 * re-model. Field names are camelCased to match the rest of `src/shared`;
 * {@link import('./schema.ts').architectureIrSchema} accepts archify's
 * snake_case spellings on the way in.
 */

/** A point in diagram user space, `[x, y]`. */
export type DiagramPoint = readonly [number, number];

/** A box's width and height in diagram user space, `[width, height]`. */
export type DiagramSize = readonly [number, number];

/** Semantic role of a component, which picks its fill and its legend row. */
export type ArchitectureComponentType =
	| 'backend'
	| 'cloud'
	| 'database'
	| 'external'
	| 'frontend'
	| 'messagebus'
	| 'security';

/** Every component type, in legend order. */
export const ARCHITECTURE_COMPONENT_TYPES: readonly ArchitectureComponentType[] =
	[
		'frontend',
		'backend',
		'database',
		'cloud',
		'security',
		'messagebus',
		'external',
	];

/** Visual weight of a connection, which picks its stroke and arrowhead. */
export type ArchitectureConnectionVariant =
	| 'dashed'
	| 'default'
	| 'emphasis'
	| 'security';

/** Side of a component box an edge leaves from or arrives at. */
export type ArchitectureSide = 'bottom' | 'left' | 'right' | 'top';

/** How an edge's interior points are derived when it carries no explicit `via`. */
export type ArchitectureRouteMode =
	| 'auto'
	| 'orthogonal-h'
	| 'orthogonal-v'
	| 'straight';

/** A file the component stands for, which a click opens in the file preview. */
export interface ArchitectureSourceRef {
	/** Last line of the range, when the reference spans one. */
	endLine?: number;
	/** Human label for the reference, shown instead of the bare path. */
	label?: string;
	/** First line of interest, 1-based. */
	line?: number;
	/** Workspace-relative path. */
	path: string;
}

/**
 * One node. Placement is either an explicit `pos` (which wins) or a grid
 * `row`/`col` resolved against {@link ArchitectureLayout}.
 */
export interface ArchitectureComponent {
	col?: number;
	/** Matches `^[a-zA-Z][a-zA-Z0-9_-]*$`; unique within the document. */
	id: string;
	label: string;
	pos?: DiagramPoint;
	row?: number;
	size?: DiagramSize;
	/** Up to three files this node stands for, in click-through order. */
	sources?: readonly ArchitectureSourceRef[];
	sublabel?: string;
	tag?: string;
	type: ArchitectureComponentType;
}

/**
 * A frame drawn behind the components it `wraps`, sized to their bounding box.
 * Boundaries never place anything — they only enclose.
 */
export interface ArchitectureBoundary {
	kind: 'region' | 'security-group';
	label: string;
	/** Padding around the member bounding box; defaults to the layout's. */
	pad?: number;
	/** Component ids enclosed by this frame. */
	wraps: readonly string[];
}

/**
 * One edge. `id` is always emitted by everything that builds an IR here: the
 * delta comparator matches connections across snapshots by it, and a document
 * without one degrades to "every edge changed".
 */
export interface ArchitectureConnection {
	from: string;
	fromSide?: ArchitectureSide;
	id: string;
	label?: string;
	labelAt?: DiagramPoint;
	labelDx?: number;
	labelDy?: number;
	labelSegment?: number;
	route?: ArchitectureRouteMode;
	to: string;
	toSide?: ArchitectureSide;
	/** Authored interior points; when present they replace automatic routing. */
	via?: readonly DiagramPoint[];
	variant?: ArchitectureConnectionVariant;
}

/**
 * How the document is placed.
 *
 * `grid` resolves each component's `row`/`col` against a fixed-cell grid, and
 * every other field here configures it. `organic` places nothing by hand: the
 * renderer packs the components inside the boundaries that enclose them and
 * draws each boundary as a closed curve, so a component needs no `row`, no
 * `col`, and no `pos` — its membership is its placement.
 */
export interface ArchitectureLayout {
	cellH?: number;
	cellW?: number;
	cols?: number;
	gapX?: number;
	gapY?: number;
	mode: 'grid' | 'organic';
	origin?: DiagramPoint;
}

/** Document-level metadata. `title` is the only required field. */
export interface ArchitectureMeta {
	subtitle?: string;
	title: string;
	/** Explicit canvas size; the compiler derives one when absent. */
	viewBox?: DiagramSize;
}

/** An annotation card rendered beside the diagram. */
export interface ArchitectureCard {
	dot: 'amber' | 'cyan' | 'emerald' | 'orange' | 'rose' | 'slate' | 'violet';
	items: readonly string[];
	title: string;
}

/**
 * Workspace-relative path the diagram is stored at. Shared because both ends
 * name it: main reads and writes the file, and the renderer's empty state tells
 * the user where a drawn diagram will land.
 */
export const ARCHITECTURE_FILE_RELATIVE_PATH = '.ensemblr/architecture.json';

/** Schema version every IR this build writes carries. */
export const ARCHITECTURE_IR_SCHEMA_VERSION = 1;

/** A complete architecture diagram document. */
export interface ArchitectureIR {
	boundaries?: readonly ArchitectureBoundary[];
	cards?: readonly ArchitectureCard[];
	components: readonly ArchitectureComponent[];
	connections?: readonly ArchitectureConnection[];
	layout?: ArchitectureLayout;
	meta: ArchitectureMeta;
	schemaVersion: number;
}
