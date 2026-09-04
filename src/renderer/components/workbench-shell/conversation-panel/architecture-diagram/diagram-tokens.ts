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

/** Stroke class and dash pattern for each connection variant. */
export const CONNECTION_TONE: Record<
	ArchitectureConnectionVariant,
	{ dashArray?: string; stroke: string }
> = {
	dashed: { dashArray: '4 3', stroke: 'stroke-muted-foreground/60' },
	default: { stroke: 'stroke-border' },
	emphasis: { stroke: 'stroke-sky-500/70' },
	security: { stroke: 'stroke-rose-500/70' },
};

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

/** Font sizes the node text shrinks between, matching archify's architecture renderer. */
export const NODE_TEXT_SIZES = {
	labelMinimum: 7,
	labelPreferred: 11,
	sublabelMinimum: 6,
	sublabelPreferred: 9,
} as const;
