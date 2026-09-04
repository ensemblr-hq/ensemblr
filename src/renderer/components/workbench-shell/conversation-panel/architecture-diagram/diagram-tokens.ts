/**
 * Colour and delta vocabulary shared by the diagram's SVG parts.
 *
 * Every value is a Tailwind class rather than a literal colour, so the diagram
 * inherits the app's theme and follows light/dark and any future palette
 * without a second set of definitions. This is the concrete win over embedding
 * a pre-rendered artifact, whose colours are baked at render time.
 */
import type {
	ArchitectureComponentType,
	ArchitectureConnectionVariant,
	ArchitectureDeltaStatus,
} from '@/shared/architecture-diagram';

/** Fill and stroke classes for each component role. */
export const COMPONENT_TONE: Record<
	ArchitectureComponentType,
	{ fill: string; stroke: string; text: string }
> = {
	backend: {
		fill: 'fill-sky-500/10',
		stroke: 'stroke-sky-500/50',
		text: 'fill-sky-600 dark:fill-sky-300',
	},
	cloud: {
		fill: 'fill-violet-500/10',
		stroke: 'stroke-violet-500/50',
		text: 'fill-violet-600 dark:fill-violet-300',
	},
	database: {
		fill: 'fill-emerald-500/10',
		stroke: 'stroke-emerald-500/50',
		text: 'fill-emerald-600 dark:fill-emerald-300',
	},
	external: {
		fill: 'fill-muted',
		stroke: 'stroke-border',
		text: 'fill-muted-foreground',
	},
	frontend: {
		fill: 'fill-amber-500/10',
		stroke: 'stroke-amber-500/50',
		text: 'fill-amber-600 dark:fill-amber-300',
	},
	messagebus: {
		fill: 'fill-cyan-500/10',
		stroke: 'stroke-cyan-500/50',
		text: 'fill-cyan-600 dark:fill-cyan-300',
	},
	security: {
		fill: 'fill-rose-500/10',
		stroke: 'stroke-rose-500/50',
		text: 'fill-rose-600 dark:fill-rose-300',
	},
};

/**
 * Stroke class, dash pattern, and width for each connection variant.
 *
 * Weighted well above archify's hairlines: at 1.25px in `stroke-border` an edge
 * is within a shade of the panel background, which is what made the scanned
 * diagram read as boxes with nothing between them.
 */
export const CONNECTION_TONE: Record<
	ArchitectureConnectionVariant,
	{ dashArray?: string; stroke: string; width: number }
> = {
	dashed: {
		dashArray: '5 4',
		stroke: 'stroke-muted-foreground/70',
		width: 1.5,
	},
	default: { stroke: 'stroke-muted-foreground/50', width: 1.5 },
	emphasis: { stroke: 'stroke-sky-500/80', width: 1.75 },
	security: { stroke: 'stroke-rose-500/80', width: 1.75 },
};

/** Width of the invisible band that makes a hairline edge hoverable. */
export const EDGE_HIT_WIDTH = 14;

/**
 * Outline colour for a node or edge the last rebuild changed. `null` means the
 * entity is unchanged and takes no badge at all — the common case, which must
 * stay visually quiet.
 */
export const DELTA_TONE: Record<ArchitectureDeltaStatus, string> = {
	added: 'stroke-emerald-500',
	changed: 'stroke-amber-500',
	'evidence-changed': 'stroke-amber-500/70',
	'geometry-changed': 'stroke-sky-500/60',
	moved: 'stroke-sky-500/60',
	removed: 'stroke-rose-500',
	rerouted: 'stroke-sky-500/60',
};

/**
 * Font sizes the node text shrinks between.
 *
 * Raised over archify's because the scanner writes real paths into `sublabel`:
 * `src/renderer/components` at archify's preferred 9 inside a 120px box fits
 * only by dropping to the 6px floor, which is the unreadable grey line the
 * scanned diagram was covered in. The larger solved node earns the extra size.
 */
export const NODE_TEXT_SIZES = {
	labelMinimum: 8,
	labelPreferred: 12.5,
	sublabelMinimum: 7,
	sublabelPreferred: 10,
} as const;
